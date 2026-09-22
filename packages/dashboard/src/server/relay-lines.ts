/**
 * 중계기 stderr 를 타입 있는 줄로 바꾼다. **순수** — 프로세스도 시간도 모른다.
 *
 * **자식 서버의 stderr 가 같은 채널로 흐른다**(설계 §8). JSON 이 아닌 줄은 건너뛰되 건수를
 * 센다 — 전부 건너뛰어 「기록 0 건」이 되면 사용자는 자기 서버가 조용한 줄 알고, 그것이
 * 거짓이면 진단이 통째로 틀어진다.
 *
 * **응답 줄에는 `method` 가 없다**(`relay-log.ts` 의 `jsonResponse`). 메서드 이름이 필요한
 * 쪽은 같은 `id` 의 요청 줄에서 가져온다. 여기서 지어내지 않는다.
 */

export type RelayLine =
  | { readonly kind: "up"; readonly url: string }
  | {
      readonly kind: "request";
      readonly id: number;
      readonly method: string;
      readonly tool?: string;
      readonly args?: unknown;
      readonly case?: string;
    }
  | {
      readonly kind: "response";
      readonly id: number;
      readonly ok: boolean;
      readonly tool?: string;
      readonly bytes?: number;
      readonly ms?: number;
      readonly body?: unknown;
      readonly code?: number;
      readonly message?: string;
      readonly case?: string;
    }
  | { readonly kind: "drop"; readonly method: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const optional = <T>(key: string, value: unknown, guard: (v: unknown) => v is T) =>
  guard(value) ? { [key]: value } : {};

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isDefined = (value: unknown): value is unknown => value !== undefined;

function toLine(raw: Record<string, unknown>): RelayLine | null {
  if (raw.dir === "up" && typeof raw.url === "string") return { kind: "up", url: raw.url };
  if (raw.dir === "drop" && typeof raw.method === "string")
    return { kind: "drop", method: raw.method };
  if (raw.dir === "req" && typeof raw.id === "number" && typeof raw.method === "string") {
    return {
      kind: "request",
      id: raw.id,
      method: raw.method,
      ...optional("tool", raw.tool, isString),
      ...optional("args", raw.args, isDefined),
      ...optional("case", raw.case, isString),
    };
  }
  if (raw.dir === "res" && typeof raw.id === "number" && typeof raw.ok === "boolean") {
    return {
      kind: "response",
      id: raw.id,
      ok: raw.ok,
      ...optional("tool", raw.tool, isString),
      ...optional("bytes", raw.bytes, isNumber),
      ...optional("ms", raw.ms, isNumber),
      ...optional("body", raw.body, isDefined),
      ...optional("code", raw.code, isNumber),
      ...optional("message", raw.message, isString),
      ...optional("case", raw.case, isString),
    };
  }
  return null;
}

/**
 * 파싱 못 한 stderr 줄을 얼마나 들고 있을지. 기동 실패 진단에 붙일 최소한의 맥락이면
 * 충분하고, 커지면 그 자체가 누적 이벤트처럼 메모리에 쌓인다. 합쳐서 8줄이다.
 *
 * **머리와 꼬리를 같이 남긴다.** 꼬리만 남기던 때 가장 흔한 실패에서 진단이 적극적으로
 * 오도했다 — node 크래시는 **첫 줄이 원인**(`Error: Cannot find module '…/dist/relay.mjs'`)
 * 이고 뒤는 스택 프레임이라, 마지막 8줄을 남기면 원인이 밀려 나가고 프레임만 남는다.
 * 반대로 머리만 남기면 기동 줄을 수십 개 찍고 뒤에서 죽는 수다스러운 서버에서 원인이
 * 꼬리에 있어 또 놓친다. 어느 쪽인지 줄을 보기 전에는 알 수 없으므로 둘 다 남긴다.
 */
export const RELAY_SKIPPED_HEAD_LINES = 3;
export const RELAY_SKIPPED_TAIL_LINES = 5;

/**
 * 진단에 붙일 버린 줄. `omitted` 가 0 보다 크면 가운데를 잘랐다는 뜻이고, 그 사실은
 * **화면에 보여야 한다** — 조용한 생략은 남은 줄이 연속인 것처럼 읽혀 진단을 틀리게 만든다.
 */
export interface SkippedLines {
  readonly head: readonly string[];
  readonly tail: readonly string[];
  readonly omitted: number;
}

export class RelayLineReader {
  /** JSON 이 아니거나 우리 모양이 아니어서 버린 줄의 수. 빈 줄은 세지 않는다. */
  skipped = 0;
  /** 청크 경계에 걸린 반쪽 줄. */
  private buffer = "";
  /** 버린 줄의 **처음** `RELAY_SKIPPED_HEAD_LINES` 개. 한 번 차면 바뀌지 않는다. */
  private readonly head: string[] = [];
  /** 머리를 채운 뒤의 마지막 `RELAY_SKIPPED_TAIL_LINES` 개. 링버퍼처럼 밀어낸다. */
  private readonly tail: string[] = [];
  /** 머리에도 꼬리에도 못 남고 밀려난 줄의 수. */
  private omitted = 0;

  /** 기동 실패 진단에 붙일 자리. 값 유출은 호출부가 알아서 가린다 — 여기는 원문 그대로다. */
  get skippedLines(): SkippedLines {
    return { head: this.head, tail: this.tail, omitted: this.omitted };
  }

  push(chunk: string): readonly RelayLine[] {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    // 마지막 조각은 아직 줄이 아니다. 다음 청크와 이어 붙인다.
    this.buffer = parts.pop() ?? "";
    const lines: RelayLine[] = [];
    for (const part of parts) {
      if (part.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(part);
      } catch {
        this.recordSkipped(part);
        continue;
      }
      const line = isRecord(parsed) ? toLine(parsed) : null;
      if (line === null) {
        this.recordSkipped(part);
        continue;
      }
      lines.push(line);
    }
    return lines;
  }

  private recordSkipped(part: string): void {
    this.skipped += 1;
    if (this.head.length < RELAY_SKIPPED_HEAD_LINES) {
      this.head.push(part);
      return;
    }
    this.tail.push(part);
    // 꼬리에서 밀려난 줄이 곧 생략된 줄이다. 머리는 밀려나지 않으므로 여기서만 센다.
    if (this.tail.length > RELAY_SKIPPED_TAIL_LINES) {
      this.tail.shift();
      this.omitted += 1;
    }
  }
}
