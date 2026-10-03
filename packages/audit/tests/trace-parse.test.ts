import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseTrace } from "../src/sandbox/trace.js";
import type { SandboxPhase, SyscallEvent } from "../src/types.js";

const SANDBOX = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "sandbox");

/**
 * `trace-*.txt` 는 전부 격리 이미지 안에서 `strace -f -qq -s 256 -e trace=…` 로 떠 온 원문이다
 * (채집 명령은 docs/reports/2026-10-03-sandbox-T4.md). 파일마다 그때의 작업 디렉터리가 다르다.
 */
const CWD: Readonly<Record<string, string>> = {
  "trace-rename2.txt": "/tmp",
  "trace-weather-start.txt": "/workspace",
  "trace-npx-start.txt": "/workspace",
};
const PROBE_CWD = "/srv/probe";

const START: SandboxPhase = { kind: "start" };
const CALL: SandboxPhase = { kind: "call", toolIndex: 0, toolName: "read_note", callId: "p" };

function linesOf(name: string): string[] {
  return readFileSync(join(SANDBOX, name), "utf8").split("\n");
}

function parseFixture(name: string, phase: SandboxPhase = START) {
  return parseTrace(linesOf(name), phase, CWD[name] ?? PROBE_CWD);
}

type Open = Extract<SyscallEvent, { kind: "open" }>;
type Exec = Extract<SyscallEvent, { kind: "exec" }>;
type Alter = Extract<SyscallEvent, { kind: "alter" }>;
type Connect = Extract<SyscallEvent, { kind: "connect" }>;

const opens = (events: readonly SyscallEvent[]) =>
  events.filter((event): event is Open => event.kind === "open");
const execs = (events: readonly SyscallEvent[]) =>
  events.filter((event): event is Exec => event.kind === "exec");
const alters = (events: readonly SyscallEvent[]) =>
  events.filter((event): event is Alter => event.kind === "alter");
const connects = (events: readonly SyscallEvent[]) =>
  events.filter((event): event is Connect => event.kind === "connect");

/**
 * 채집한 줄 그대로다(trace-exec.txt 에서 이 한 줄만 뺐다). `/bin/echo` 에 300자 인자를 넘긴 실행이고,
 * strace 가 `-s 256` 에서 문자열을 자르고 `"…"...` 로 표시했다. 경로는 문자열이 아니라서 잘리지 않고
 * (trace-longpath.txt), 잘리는 것은 execve 의 argv 다.
 */
const TRUNCATED_LINE = `23    execve("/bin/echo", ["/bin/echo", "${"z".repeat(256)}"...], 0x1eb3bc00 /* 6 vars */) = 0`;

describe("parseTrace", () => {
  it("openat 의 O_RDONLY 는 write false, O_WRONLY|O_CREAT 는 write true", () => {
    const events = opens(parseFixture("trace-open.txt").events);
    const byPath = (path: string) => events.filter((event) => event.path === path);

    expect(byPath("/home/node/.aws/credentials")).toEqual([
      {
        kind: "open",
        phase: START,
        path: "/home/node/.aws/credentials",
        write: false,
        result: "ok",
      },
    ]);
    // 같은 파일을 O_WRONLY|O_CREAT|O_TRUNC, O_WRONLY|O_CREAT|O_APPEND, O_RDWR 로 차례로 열었다.
    expect(byPath("/tmp/mcpeak-probe.txt").map((event) => event.write)).toEqual([true, true, true]);
    // O_RDONLY|O_NONBLOCK|O_CLOEXEC|O_DIRECTORY (readdir) 는 읽기다.
    expect(byPath("/home/node")).toEqual([
      { kind: "open", phase: START, path: "/home/node", write: false, result: "ok" },
    ]);
    expect(byPath("/var/mcpeak/trace")).toEqual([
      { kind: "open", phase: START, path: "/var/mcpeak/trace", write: true, result: "ok" },
    ]);
  });

  it("반환값 -1 ENOENT 는 missing, -1 EROFS 와 -1 EACCES 는 denied", () => {
    const events = opens(parseFixture("trace-open.txt").events);
    const resultOf = (path: string) => events.find((event) => event.path === path)?.result;

    expect(resultOf("/home/node/nope")).toBe("missing");
    expect(resultOf("/etc/hostname/x")).toBe("missing"); // ENOTDIR
    expect(resultOf("/etc/shadow")).toBe("denied"); // EACCES
    expect(resultOf("/home/node/mcpeak-probe")).toBe("denied"); // EROFS
    expect(resultOf("/etc/mcpeak-probe")).toBe("denied");
    expect(resultOf("/home/node/.gitconfig")).toBe("ok");
  });

  it("execve 의 argv 배열을 원소로 나눈다(공백이 든 인자 포함)", () => {
    const events = execs(parseFixture("trace-exec.txt").events);
    const echo = events.find((event) => event.path === "/bin/echo");
    expect(echo).toEqual({
      kind: "exec",
      phase: START,
      path: "/bin/echo",
      // strace 는 탭·줄바꿈·따옴표·역슬래시를 이스케이프하고 한글은 8진수 바이트로 찍는다.
      argv: ["/bin/echo", "two words", "tab\there", 'quote"q', "back\\slash", "한글", "new\nline"],
      result: "ok",
    });
    expect(events.find((event) => event.argv[0] === "/bin/sh")?.argv).toEqual([
      "/bin/sh",
      "-c",
      'echo "hello world"; id',
    ]);
    // execFile("du") 는 PATH 를 훑는다. 실패한 줄은 error, 성공은 한 줄이다.
    const du = events.filter((event) => event.argv[0] === "du");
    expect(du.map((event) => [event.path, event.result])).toEqual([
      ["/usr/local/sbin/du", "error"],
      ["/usr/local/bin/du", "error"],
      ["/usr/sbin/du", "error"],
      ["/usr/bin/du", "ok"],
    ]);
  });

  it("connect 의 AF_INET, AF_INET6, AF_UNIX 를 각각 읽는다", () => {
    const events = connects(parseFixture("trace-connect.txt").events);
    expect(events).toContainEqual({
      kind: "connect",
      phase: START,
      family: "inet",
      address: "169.254.169.254",
      port: 80,
    });
    expect(events).toContainEqual({
      kind: "connect",
      phase: START,
      family: "inet",
      address: "127.0.0.1",
      port: 8080,
    });
    expect(events).toContainEqual({
      kind: "connect",
      phase: START,
      family: "inet6",
      address: "::1",
      port: 8080,
    });
    expect(events).toContainEqual({
      kind: "connect",
      phase: START,
      family: "inet6",
      address: "2001:db8::1",
      port: 443,
    });
    expect(events).toContainEqual({
      kind: "connect",
      phase: START,
      family: "unix",
      address: "/tmp/mcpeak-no-such.sock",
      port: 0,
    });
    // 이름 조회(UDP 53)도 connect 로 찍힌다. TCP 와 구분되지 않는다.
    expect(events.some((event) => event.family === "inet" && event.port === 53)).toBe(true);
    // glibc 가 nscd 소켓을 두드린다.
    expect(events.some((event) => event.address === "/var/run/nscd/socket")).toBe(true);
  });

  it("<unfinished ...> 와 <... resumed> 로 갈라진 줄을 하나로 잇는다", () => {
    const lines = linesOf("trace-split.txt");
    const unfinished = lines.filter((line) => line.endsWith("<unfinished ...>")).length;
    expect(unfinished).toBeGreaterThan(0);

    const whole = parseTrace(lines, START, PROBE_CWD);
    expect(whole.unparsed).toBe(0);
    // 갈라진 줄을 버리면 사건 수가 그만큼 준다. 이은 결과는 "갈라지지 않은 줄 + 갈라진 쌍" 과 같다.
    const complete = lines.filter(
      (line) => /^\d+\s+(openat|execve|connect)\(/.test(line) && !line.endsWith("<unfinished ...>"),
    ).length;
    expect(whole.events).toHaveLength(complete + unfinished);

    // 다른 프로세스의 줄이 사이에 끼어도 같은 PID 의 꼬리와 이어진다.
    const split = parseTrace(
      [
        '31    execve("/bin/sh", ["/bin/sh", "-c", "cat /etc/hostname > /dev/null"], 0x1eb38a70 /* 6 vars */ <unfinished ...>',
        '32    openat(AT_FDCWD, "/lib/aarch64-linux-gnu/libc.so.6", O_RDONLY|O_CLOEXEC <unfinished ...>',
        "31    <... execve resumed>)             = 0",
        "32    <... openat resumed>)             = 3",
      ],
      START,
      PROBE_CWD,
    );
    expect(split).toEqual({
      unparsed: 0,
      events: [
        {
          kind: "exec",
          phase: START,
          path: "/bin/sh",
          argv: ["/bin/sh", "-c", "cat /etc/hostname > /dev/null"],
          result: "ok",
        },
        {
          kind: "open",
          phase: START,
          path: "/lib/aarch64-linux-gnu/libc.so.6",
          write: false,
          result: "ok",
        },
      ],
    });
  });

  it("짝이 없는 <unfinished ...> 와 <... resumed> 는 unparsed 로 센다", () => {
    const result = parseTrace(
      [
        "25    <... openat resumed>)             = 46",
        '26    openat(AT_FDCWD, "/home/node/nope", O_RDONLY|O_CLOEXEC <unfinished ...>',
      ],
      START,
      PROBE_CWD,
    );
    expect(result).toEqual({ events: [], unparsed: 2 });
  });

  it("줄 머리의 PID 는 사건에 싣지 않는다", () => {
    const { events } = parseFixture("trace-exec.txt");
    for (const event of events) {
      expect(Object.keys(event)).not.toContain("pid");
      const allowed =
        event.kind === "open"
          ? ["kind", "phase", "path", "write", "result"]
          : event.kind === "exec"
            ? ["kind", "phase", "path", "argv", "result"]
            : event.kind === "alter"
              ? ["kind", "phase", "path", "via", "result"]
              : ["kind", "phase", "family", "address", "port"];
      expect(Object.keys(event).sort()).toEqual([...allowed].sort());
    }
    // PID 만 다른 두 줄은 같은 사건이 된다.
    const a = parseTrace(
      ['10    openat(AT_FDCWD, "/etc/hosts", O_RDONLY|O_CLOEXEC) = 3'],
      START,
      "/",
    );
    const b = parseTrace(
      ['4711  openat(AT_FDCWD, "/etc/hosts", O_RDONLY|O_CLOEXEC) = 9'],
      START,
      "/",
    );
    expect(a).toEqual(b);
  });

  it("사건의 phase 는 넘겨받은 단계 그대로다", () => {
    const { events } = parseFixture("trace-open.txt", CALL);
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) expect(event.phase).toEqual(CALL);
  });

  it("-s 256 으로 잘린 경로(…)는 unparsed 로 세고 사건으로 만들지 않는다", () => {
    expect(parseTrace([TRUNCATED_LINE], START, PROBE_CWD)).toEqual({ events: [], unparsed: 1 });
    // 경로는 strace 가 자르지 않는다. 360자를 넘는 경로가 그대로 사건이 된다.
    const long = parseFixture("trace-longpath.txt");
    expect(long.unparsed).toBe(0);
    expect(opens(long.events).map((event) => event.path)).toEqual([
      `/tmp/${"p".repeat(120)}/${"q".repeat(120)}/${"r".repeat(120)}`,
    ]);
  });

  it("모르는 줄은 던지지 않고 unparsed 로 센다", () => {
    const result = parseTrace(
      [
        "이 줄은 strace 출력이 아니다",
        '10    mkdirat(AT_FDCWD, "/tmp/d", 0777) = 0',
        '10    openat(AT_FDCWD, "/etc/hosts", O_RDONLY',
        '10    openat(7, "relative-to-fd", O_RDONLY|O_CLOEXEC) = 3',
        "10    connect(3, {sa_family=AF_NETLINK, nl_pid=0, nl_groups=00000000}, 12) = 0",
        "",
        '10    openat(AT_FDCWD, "/etc/hosts", O_RDONLY|O_CLOEXEC) = 3',
      ],
      START,
      "/",
    );
    expect(result.unparsed).toBe(5);
    expect(result.events).toEqual([
      { kind: "open", phase: START, path: "/etc/hosts", write: false, result: "ok" },
    ]);
  });

  it("신호 줄(--- SIGCHLD … ---)과 종료 줄(+++ … +++)은 사건도 unparsed 도 아니다", () => {
    const result = parseTrace(
      [
        "10    --- SIGCHLD {si_signo=SIGCHLD, si_code=CLD_EXITED, si_pid=17, si_uid=1000, si_status=0, si_utime=0, si_stime=0} ---",
        "17    +++ exited with 0 +++",
      ],
      START,
      "/",
    );
    expect(result).toEqual({ events: [], unparsed: 0 });
  });

  it("unlinkat 과 unlink 가 via unlink 인 alter 사건이 되고, AT_REMOVEDIR 과 rmdir 은 via rmdir 이다", () => {
    const events = alters(parseFixture("trace-alter.txt").events);
    const find = (path: string, via: Alter["via"]) =>
      events.find((event) => event.path === path && event.via === via);

    expect(find("/tmp/b.txt", "unlink")).toEqual({
      kind: "alter",
      phase: START,
      path: "/tmp/b.txt",
      via: "unlink",
      result: "ok",
    });
    expect(find("/tmp/d", "rmdir")?.result).toBe("ok");
    expect(find("/tmp/missing.txt", "unlink")?.result).toBe("missing");
    expect(find("/home/node/.ssh", "rmdir")?.result).toBe("denied");
    expect(find("/etc/hostname", "unlink")?.result).toBe("denied");
    // 상대 경로로 지운 것도 cwd 에 이어 붙는다.
    expect(events.filter((event) => event.path === "/home/node/.gitconfig")).toContainEqual({
      kind: "alter",
      phase: START,
      path: "/home/node/.gitconfig",
      via: "unlink",
      result: "denied",
    });

    // x86_64 에만 있는 unlink·rmdir 은 이 머신(arm64)에서 떠 올 수 없었다. 위 unlinkat 줄에서 dirfd 와
    // flags 인자를 뺀 꼴이고, strace 가 인자를 찍는 방식은 같다. CI(x86_64)의 E2E 가 실물을 처음 본다.
    const legacy = parseTrace(
      [
        '10    unlink("/tmp/b.txt") = 0',
        '10    rmdir("/home/node/.ssh") = -1 EROFS (Read-only file system)',
      ],
      START,
      PROBE_CWD,
    );
    expect(legacy).toEqual({
      unparsed: 0,
      events: [
        { kind: "alter", phase: START, path: "/tmp/b.txt", via: "unlink", result: "ok" },
        { kind: "alter", phase: START, path: "/home/node/.ssh", via: "rmdir", result: "denied" },
      ],
    });
  });

  it("rename·renameat·renameat2 가 rename-from 과 rename-to 두 사건이 된다", () => {
    // renameat (Node 의 fs.rename 이 arm64 에서 부른다)
    const viaRenameat = alters(parseFixture("trace-alter.txt").events);
    expect(viaRenameat.filter((event) => event.path.startsWith("/tmp/"))).toEqual(
      expect.arrayContaining([
        { kind: "alter", phase: START, path: "/tmp/a.txt", via: "rename-from", result: "ok" },
        { kind: "alter", phase: START, path: "/tmp/b.txt", via: "rename-to", result: "ok" },
      ]),
    );
    expect(viaRenameat).toEqual(
      expect.arrayContaining([
        {
          kind: "alter",
          phase: START,
          path: "/home/node/.gitconfig",
          via: "rename-from",
          result: "denied",
        },
        {
          kind: "alter",
          phase: START,
          path: "/home/node/.gitconfig.bak",
          via: "rename-to",
          result: "denied",
        },
        // EXDEV 는 denied 도 missing 도 아니다.
        { kind: "alter", phase: START, path: "/tmp/stolen", via: "rename-to", result: "error" },
      ]),
    );

    // renameat2 (coreutils 의 mv 가 부른다). 작업 디렉터리가 /tmp 라 상대 경로가 그 아래로 풀린다.
    const viaRenameat2 = alters(parseFixture("trace-rename2.txt").events);
    expect(viaRenameat2).toEqual([
      { kind: "alter", phase: START, path: "/tmp/a.txt", via: "rename-from", result: "ok" },
      { kind: "alter", phase: START, path: "/tmp/b.txt", via: "rename-to", result: "ok" },
      { kind: "alter", phase: START, path: "/tmp/b.txt", via: "rename-from", result: "ok" },
      { kind: "alter", phase: START, path: "/tmp/c.txt", via: "rename-to", result: "ok" },
      {
        kind: "alter",
        phase: START,
        path: "/home/node/.gitconfig",
        via: "rename-from",
        result: "denied",
      },
      {
        kind: "alter",
        phase: START,
        path: "/home/node/.gitconfig.bak",
        via: "rename-to",
        result: "denied",
      },
    ]);

    // x86_64 에만 있는 rename 은 떠 올 수 없었다(위 unlink 와 같은 사정). renameat 줄에서 dirfd 를 뺀 꼴이다.
    const legacy = parseTrace(['10    rename("/tmp/a.txt", "/tmp/b.txt") = 0'], START, PROBE_CWD);
    expect(legacy).toEqual({
      unparsed: 0,
      events: [
        { kind: "alter", phase: START, path: "/tmp/a.txt", via: "rename-from", result: "ok" },
        { kind: "alter", phase: START, path: "/tmp/b.txt", via: "rename-to", result: "ok" },
      ],
    });
  });

  it("상대 경로 '../../home/node/.aws/credentials' 가 cwd 에 이어 붙어 '/home/node/.aws/credentials' 가 된다", () => {
    const events = opens(parseFixture("trace-relative.txt").events);
    expect(events[0]).toEqual({
      kind: "open",
      phase: START,
      path: "/home/node/.aws/credentials",
      write: false,
      result: "ok",
    });
    // cwd 가 더 깊으면 같은 줄이 다른 곳을 가리킨다.
    const deeper = parseTrace(linesOf("trace-relative.txt"), START, "/workspace/a/b/c");
    expect(opens(deeper.events)[0]?.path).toBe("/workspace/a/home/node/.aws/credentials");
  });

  it("'./a/../b' 같은 경로의 점 조각이 접힌다", () => {
    const events = opens(parseFixture("trace-relative.txt").events);
    expect(events.map((event) => event.path)).toEqual([
      "/home/node/.aws/credentials",
      "/srv/probe/b",
      "/srv/probe/probe.mjs",
    ]);
    // 절대 경로 안의 점 조각도 접는다. 서버가 문자열로 이어 붙인 경로가 미끼 대조에 걸려야 한다.
    const absolute = parseTrace(
      [
        '10    openat(AT_FDCWD, "/home/node/notes/../.aws/./credentials", O_RDONLY|O_CLOEXEC) = 17',
        '10    openat(AT_FDCWD, "/../../etc/passwd", O_RDONLY|O_CLOEXEC) = 17',
      ],
      START,
      PROBE_CWD,
    );
    expect(opens(absolute.events).map((event) => event.path)).toEqual([
      "/home/node/.aws/credentials",
      "/etc/passwd",
    ]);
  });

  it("절대 경로는 cwd 와 무관하게 그대로다", () => {
    const a = parseTrace(linesOf("trace-open.txt"), START, "/srv/probe");
    const b = parseTrace(linesOf("trace-open.txt"), START, "/somewhere/else/entirely");
    expect(a).toEqual(b);
    expect(opens(a.events).map((event) => event.path)).toContain("/home/node/.aws/credentials");
  });

  it("tests/fixtures/sandbox/trace-*.txt 전부에서 unparsed 가 0", () => {
    const names = readdirSync(SANDBOX)
      .filter((name) => /^trace-.*\.txt$/.test(name))
      .sort();
    expect(names.length).toBeGreaterThanOrEqual(9);
    for (const name of names) {
      const result = parseFixture(name);
      expect({ name, unparsed: result.unparsed }).toEqual({ name, unparsed: 0 });
      expect(result.events.length).toBeGreaterThan(0);
    }
  });

  it("같은 줄을 두 번 해석하면 결과가 같다", () => {
    expect(parseFixture("trace-weather-start.txt")).toEqual(
      parseFixture("trace-weather-start.txt"),
    );
  });
});
