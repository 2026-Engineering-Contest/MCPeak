import type { SandboxPhase, SyscallEvent } from "../types.js";

/**
 * strace 출력 줄들을 사건으로 바꾼다. 해석 못 한 줄은 버리지 않고 센다.
 * cwd 는 서버의 작업 디렉터리다. 상대 경로를 여기에 이어 붙여 절대 경로로 만든다.
 */
export type TraceParser = (
  lines: readonly string[],
  phase: SandboxPhase,
  cwd: string,
) => {
  readonly events: readonly SyscallEvent[];
  readonly unparsed: number;
};

/** 인자 하나. strace 가 찍은 꼴을 종류별로 나눈 것이다. */
type Arg =
  | { readonly kind: "string"; readonly value: string; readonly truncated: boolean }
  | { readonly kind: "array"; readonly items: readonly Arg[] }
  | { readonly kind: "raw"; readonly text: string };

const UNFINISHED = "<unfinished ...>";

/** `\n`·`\t` 같은 한 글자 이스케이프. strace 는 그 밖의 바이트를 8진수(`\355`)로 찍는다. */
const SIMPLE_ESCAPES: Readonly<Record<string, number>> = {
  n: 0x0a,
  t: 0x09,
  r: 0x0d,
  f: 0x0c,
  v: 0x0b,
  a: 0x07,
  b: 0x08,
  e: 0x1b,
  '"': 0x22,
  "\\": 0x5c,
};

/** 줄을 읽어 나가는 자리. 해석이 어긋나면 `ParseFailure` 를 던지고, 부른 쪽이 그 줄을 unparsed 로 센다. */
class Cursor {
  readonly text: string;
  position = 0;

  constructor(text: string) {
    this.text = text;
  }

  peek(): string {
    return this.text[this.position] ?? "";
  }

  startsWith(prefix: string): boolean {
    return this.text.startsWith(prefix, this.position);
  }

  expect(prefix: string): void {
    if (!this.startsWith(prefix)) throw new ParseFailure();
    this.position += prefix.length;
  }

  rest(): string {
    return this.text.slice(this.position);
  }
}

class ParseFailure extends Error {}

/** 따옴표로 시작하는 C 문자열 하나. 바이트로 모아 UTF-8 로 푼다(한글은 8진수 바이트 여러 개로 온다). */
function readString(cursor: Cursor): Arg {
  cursor.expect('"');
  const bytes: number[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") bytes.push(...Buffer.from(plain, "utf8"));
    plain = "";
  };
  for (;;) {
    const char = cursor.peek();
    if (char === "") throw new ParseFailure();
    cursor.position += 1;
    if (char === '"') break;
    if (char !== "\\") {
      plain += char;
      continue;
    }
    flush();
    const escaped = cursor.peek();
    cursor.position += 1;
    if (/[0-7]/.test(escaped)) {
      let digits = escaped;
      while (digits.length < 3 && /[0-7]/.test(cursor.peek())) {
        digits += cursor.peek();
        cursor.position += 1;
      }
      bytes.push(Number.parseInt(digits, 8) & 0xff);
    } else if (escaped === "x") {
      const hex = cursor.text.slice(cursor.position, cursor.position + 2);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new ParseFailure();
      cursor.position += 2;
      bytes.push(Number.parseInt(hex, 16));
    } else {
      const byte = SIMPLE_ESCAPES[escaped];
      if (byte === undefined) throw new ParseFailure();
      bytes.push(byte);
    }
  }
  flush();
  // `-s` 상한에서 잘린 문자열은 닫는 따옴표 뒤에 `...` 이 붙는다.
  const truncated = cursor.startsWith("...");
  if (truncated) cursor.position += 3;
  return { kind: "string", value: Buffer.from(bytes).toString("utf8"), truncated };
}

/** 따옴표 없는 인자 하나. 괄호·중괄호·대괄호와 그 안의 문자열을 건너 같은 깊이의 `,` 또는 닫는 괄호까지 읽는다. */
function readRaw(cursor: Cursor): Arg {
  const start = cursor.position;
  let depth = 0;
  for (;;) {
    const char = cursor.peek();
    if (char === "") throw new ParseFailure();
    if (char === '"') {
      readString(cursor);
      continue;
    }
    if (depth === 0 && (char === "," || char === ")" || char === "]")) break;
    if (char === "(" || char === "{" || char === "[") depth += 1;
    if (char === ")" || char === "}" || char === "]") depth -= 1;
    cursor.position += 1;
  }
  const text = cursor.text.slice(start, cursor.position).trim();
  if (text === "") throw new ParseFailure();
  return { kind: "raw", text };
}

function readArg(cursor: Cursor): Arg {
  if (cursor.peek() === '"') return readString(cursor);
  if (cursor.peek() === "[") {
    cursor.position += 1;
    return { kind: "array", items: readList(cursor, "]") };
  }
  return readRaw(cursor);
}

/** `, ` 로 나뉜 인자들을 닫는 글자까지 읽는다. */
function readList(cursor: Cursor, close: string): Arg[] {
  const items: Arg[] = [];
  if (cursor.peek() === close) {
    cursor.position += 1;
    return items;
  }
  for (;;) {
    items.push(readArg(cursor));
    if (cursor.peek() === close) {
      cursor.position += 1;
      return items;
    }
    cursor.expect(", ");
  }
}

interface Syscall {
  readonly name: string;
  readonly args: readonly Arg[];
  /** 반환값. `?` (끝나기 전에 프로세스가 죽음)면 undefined. */
  readonly value: number | undefined;
  /** 실패했을 때의 errno 이름. */
  readonly errno: string | undefined;
}

/** `이름(인자…) = 반환값 [ERRNO (설명)]` 한 줄. */
function readSyscall(text: string): Syscall {
  const head = /^([a-z_0-9]+)\(/.exec(text);
  if (head === null) throw new ParseFailure();
  const cursor = new Cursor(text);
  cursor.position = head[0].length;
  const args = readList(cursor, ")");
  const tail = /^\s*=\s*(-?\d+|0x[0-9a-f]+|\?)(?:\s+([A-Z][A-Z0-9_]*)\b.*)?\s*$/.exec(
    cursor.rest(),
  );
  if (tail === null) throw new ParseFailure();
  const value = tail[1] === "?" ? undefined : Number(tail[1]);
  return { name: head[1] as string, args, value, errno: tail[2] };
}

/** `.`·`..`·빈 조각을 문자열로 접는다. 심볼릭 링크는 풀지 않는다. */
function foldPath(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

/**
 * 경로 인자를 컨테이너 안 절대 경로로 만든다. 상대 경로는 dirfd 가 `AT_FDCWD` 일 때만 cwd 에 이어 붙인다.
 * 다른 디렉터리 fd 기준의 상대 경로는 그 fd 가 어디인지 이 줄만으로 알 수 없어 해석하지 않는다.
 */
function pathOf(arg: Arg | undefined, dirfd: Arg | undefined, cwd: string): string {
  if (arg === undefined || arg.kind !== "string" || arg.truncated) throw new ParseFailure();
  if (arg.value.startsWith("/")) return foldPath(arg.value);
  const atCwd = dirfd === undefined || (dirfd.kind === "raw" && dirfd.text === "AT_FDCWD");
  if (!atCwd || arg.value === "") throw new ParseFailure();
  return foldPath(`${cwd}/${arg.value}`);
}

function flagsOf(arg: Arg | undefined): readonly string[] {
  if (arg === undefined || arg.kind !== "raw") throw new ParseFailure();
  return arg.text.split("|");
}

const WRITE_FLAGS = new Set(["O_WRONLY", "O_RDWR", "O_CREAT", "O_TRUNC", "O_APPEND"]);
const DENIED = new Set(["EACCES", "EPERM", "EROFS"]);
const MISSING = new Set(["ENOENT", "ENOTDIR"]);

function fileResult(call: Syscall): "ok" | "denied" | "missing" | "error" {
  if (call.value !== undefined && call.value >= 0) return "ok";
  if (call.errno !== undefined && DENIED.has(call.errno)) return "denied";
  if (call.errno !== undefined && MISSING.has(call.errno)) return "missing";
  return "error";
}

/** `{sa_family=AF_INET, sin_port=htons(80), sin_addr=inet_addr("1.2.3.4")}` 꼴의 주소. */
function connectEvent(call: Syscall, phase: SandboxPhase): SyscallEvent {
  const address = call.args[1];
  if (address === undefined || address.kind !== "raw") throw new ParseFailure();
  const text = address.text;
  const family = /^\{sa_family=(AF_[A-Z0-9_]+)/.exec(text)?.[1];
  if (family === "AF_INET") {
    const match = /sin_port=htons\((\d+)\), sin_addr=inet_addr\("([0-9.]+)"\)/.exec(text);
    if (match === null) throw new ParseFailure();
    return {
      kind: "connect",
      phase,
      family: "inet",
      address: match[2] as string,
      port: Number(match[1]),
    };
  }
  if (family === "AF_INET6") {
    const match =
      /sin6_port=htons\((\d+)\),.*inet_pton\(AF_INET6, "([0-9a-fA-F:.]+)", &sin6_addr\)/.exec(text);
    if (match === null) throw new ParseFailure();
    return {
      kind: "connect",
      phase,
      family: "inet6",
      address: (match[2] as string).toLowerCase(),
      port: Number(match[1]),
    };
  }
  if (family === "AF_UNIX") {
    // 추상 소켓은 `sun_path=@"이름"` 으로 찍힌다.
    const at = text.indexOf("sun_path=");
    if (at < 0) throw new ParseFailure();
    const cursor = new Cursor(text);
    cursor.position = at + "sun_path=".length;
    const abstract = cursor.peek() === "@";
    if (abstract) cursor.position += 1;
    const path = readString(cursor);
    if (path.kind !== "string" || path.truncated) throw new ParseFailure();
    return {
      kind: "connect",
      phase,
      family: "unix",
      address: abstract ? `@${path.value}` : path.value,
      port: 0,
    };
  }
  throw new ParseFailure();
}

/**
 * 시스템 콜 하나를 사건으로 바꾼다. 이름은 §3.0 이 추적하는 것 전부다. arm64 에는 `unlinkat`·`renameat`·
 * `renameat2` 만 있고 x86_64 에는 `unlink`·`rmdir`·`rename` 이 더 있어서 두 쪽 이름을 다 받는다.
 */
function toEvents(call: Syscall, phase: SandboxPhase, cwd: string): SyscallEvent[] {
  const { args } = call;
  switch (call.name) {
    case "openat":
    case "open": {
      const at = call.name === "openat" ? 1 : 0;
      const dirfd = call.name === "openat" ? args[0] : undefined;
      const write = flagsOf(args[at + 1]).some((flag) => WRITE_FLAGS.has(flag));
      return [
        {
          kind: "open",
          phase,
          path: pathOf(args[at], dirfd, cwd),
          write,
          result: fileResult(call),
        },
      ];
    }
    case "execve": {
      const argv = args[1];
      if (argv === undefined || argv.kind !== "array") throw new ParseFailure();
      const values = argv.items.map((item) => {
        // 잘린 인자, 그리고 원소 수 상한에서 `...` 로 줄인 배열은 argv 를 온전히 알 수 없다.
        if (item.kind !== "string" || item.truncated) throw new ParseFailure();
        return item.value;
      });
      return [
        {
          kind: "exec",
          phase,
          path: pathOf(args[0], undefined, cwd),
          argv: values,
          result: call.value === 0 ? "ok" : "error",
        },
      ];
    }
    case "connect":
      return [connectEvent(call, phase)];
    case "unlinkat": {
      const via = flagsOf(args[2]).includes("AT_REMOVEDIR") ? "rmdir" : "unlink";
      return [
        {
          kind: "alter",
          phase,
          path: pathOf(args[1], args[0], cwd),
          via,
          result: fileResult(call),
        },
      ];
    }
    case "unlink":
    case "rmdir":
      return [
        {
          kind: "alter",
          phase,
          path: pathOf(args[0], undefined, cwd),
          via: call.name,
          result: fileResult(call),
        },
      ];
    case "rename":
    case "renameat":
    case "renameat2": {
      const at = call.name !== "rename";
      const from = at ? pathOf(args[1], args[0], cwd) : pathOf(args[0], undefined, cwd);
      const to = at ? pathOf(args[3], args[2], cwd) : pathOf(args[1], undefined, cwd);
      const result = fileResult(call);
      return [
        { kind: "alter", phase, path: from, via: "rename-from", result },
        { kind: "alter", phase, path: to, via: "rename-to", result },
      ];
    }
    default:
      throw new ParseFailure();
  }
}

/**
 * 줄 머리의 PID 는 갈라진 줄(`<unfinished ...>` 와 `<... resumed>`)을 잇는 데만 쓰고 사건에는 싣지 않는다.
 * 실행마다 달라지는 값이기 때문이다. 신호 줄(`--- SIG… ---`)과 종료 줄(`+++ … +++`)은 시스템 콜이
 * 아니라서 사건도 unparsed 도 아니다. 그 밖에 해석하지 못한 줄은 전부 unparsed 로 센다. 짝을 찾지 못한
 * 반쪽 줄도 센다.
 */
export const parseTrace: TraceParser = (lines, phase, cwd) => {
  const events: SyscallEvent[] = [];
  let unparsed = 0;
  /** PID 별로 아직 끝나지 않은 줄의 앞쪽. */
  const pending = new Map<string, string>();

  for (const line of lines) {
    if (line.trim() === "") continue;
    const head = /^(?:(\d+)\s+)?(.*)$/.exec(line);
    const pid = head?.[1] ?? "";
    let body = head?.[2] ?? "";
    if (/^--- .* ---$/.test(body) || /^\+\+\+ .* \+\+\+$/.test(body)) continue;

    if (body.endsWith(UNFINISHED)) {
      if (pending.has(pid)) unparsed += 1;
      pending.set(pid, body.slice(0, -UNFINISHED.length).trimEnd());
      continue;
    }
    const resumed = /^<\.\.\. ([a-z_0-9]+) resumed>(.*)$/.exec(body);
    if (resumed !== null) {
      const front = pending.get(pid);
      pending.delete(pid);
      if (front === undefined || !front.startsWith(`${resumed[1]}(`)) {
        unparsed += 1;
        continue;
      }
      body = `${front}${resumed[2]}`;
    }

    try {
      events.push(...toEvents(readSyscall(body), phase, cwd));
    } catch (error) {
      if (!(error instanceof ParseFailure)) throw error;
      unparsed += 1;
    }
  }
  return { events, unparsed: unparsed + pending.size };
};
