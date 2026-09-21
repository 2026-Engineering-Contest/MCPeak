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

export class RelayLineReader {
  /** JSON 이 아니거나 우리 모양이 아니어서 버린 줄의 수. 빈 줄은 세지 않는다. */
  skipped = 0;
  /** 청크 경계에 걸린 반쪽 줄. */
  private buffer = "";

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
        this.skipped += 1;
        continue;
      }
      const line = isRecord(parsed) ? toLine(parsed) : null;
      if (line === null) {
        this.skipped += 1;
        continue;
      }
      lines.push(line);
    }
    return lines;
  }
}
