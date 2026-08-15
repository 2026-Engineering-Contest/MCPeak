/**
 * 매칭 키로 만들 수 없는 인자를 가려내는 계층.
 *
 * `index.ts` 에서 떼어낸 이유가 둘이다. 하나는 테스트가 판정 함수를 직접 부르려면 export 가
 * 필요한데 `index.ts` 는 패키지 진입점이라 그것이 곧 공개 API 가 되기 때문이고, 다른 하나는
 * 키 규칙이 한 덩어리로 같이 바뀌기 때문이다.
 *
 * 거부 집합은 `record` 의 `stableStringify`(ADR-0003)와 같다. 두 패키지가 같은 인자에 다른
 * 판정을 내리면 사용자가 혼란스럽다. 다만 `record` 는 키를 SHA-256 으로 해시하고 목은 하지
 * 않는다 — 목의 키는 파일에 남지 않고 실패 메시지에 그대로 찍히기 때문이다.
 */

/**
 * 매칭 키를 만들 때 허용하는 최대 중첩 깊이. 루트가 깊이 0 이다.
 *
 * 재귀인 `stableKey` 는 4000 단계쯤에서 스택이 터진다(측정값). 상한을 실패 지점 가까이
 * 두면 Node 버전과 스택 여유에 따라 흔들리므로 충분히 멀리 잡았다.
 * 상한을 없애려면 `record` 의 `stableStringify` 처럼 명시적 프레임 스택으로 다시 써야 한다 —
 * 그것이 업그레이드 경로다. 지금은 "프로세스가 읽을 수 없는 오류로 죽는 것" 만 닫는다.
 */
export const MAX_KEY_DEPTH = 512;

/**
 * `stableKey` 로 키를 만들 수 없는 값. 판별 유니온이라 문장이 쓰는 필드가
 * `kind` 마다 정확히 하나로 정해진다 — 없는 필드를 참조할 수 없다.
 *
 * `path` 는 루트가 `"args"`, 중첩은 `args.items[2].when`.
 * `tooDeep` 에는 `path` 가 없다. 512 단계짜리 경로는 문장에 넣을 수 없다.
 */
export type KeyViolation =
  | { kind: "circular"; path: string }
  | { kind: "sparse"; path: string }
  | { kind: "nonFinite"; path: string; found: string }
  | { kind: "notJson"; path: string; found: string }
  | { kind: "tooDeep"; depth: number };

/** plain object 인가. `Date` · `Map` · 클래스 인스턴스를 거른다. */
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 문장에 넣을 짧은 표기. */
function describeValue(value: unknown): string {
  if (typeof value === "number") return String(value); // NaN · Infinity
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return "bigint";
  return (value as object)?.constructor?.name ?? "알 수 없는 값";
}

/**
 * 키로 만들 수 없는 값을 찾는다. 없으면 `undefined`.
 *
 * 던지지 않는 순수 함수다 — 판정과 문장을 분리해야 판정을 표로 전량 고정할 수 있다.
 * 거부 집합은 `record` 의 `stableStringify`(ADR-0003)와 같다. 두 패키지가 같은 인자에
 * 다른 판정을 내리면 사용자가 혼란스럽다.
 */
export function findKeyViolation(value: unknown): KeyViolation | undefined {
  // 조상 집합. 형제가 같은 객체를 참조하는 것은 순환이 아니므로 빠져나올 때 지운다.
  const active = new Set<object>();

  function walk(current: unknown, path: string, depth: number): KeyViolation | undefined {
    if (depth > MAX_KEY_DEPTH) return { kind: "tooDeep", depth };
    if (current === undefined || current === null) return undefined;
    if (typeof current === "boolean" || typeof current === "string") return undefined;
    if (typeof current === "number") {
      return Number.isFinite(current)
        ? undefined
        : { kind: "nonFinite", path, found: describeValue(current) };
    }
    if (typeof current !== "object" || (!Array.isArray(current) && !isPlainObject(current))) {
      return { kind: "notJson", path, found: describeValue(current) };
    }
    if (active.has(current)) return { kind: "circular", path };

    active.add(current);
    try {
      if (Array.isArray(current)) {
        for (let i = 0; i < current.length; i++) {
          if (!Object.hasOwn(current, i)) return { kind: "sparse", path: `${path}[${i}]` };
          const found = walk(current[i], `${path}[${i}]`, depth + 1);
          if (found) return found;
        }
        return undefined;
      }
      const obj = current as Record<string, unknown>;
      for (const key of Object.keys(obj).sort()) {
        if (obj[key] === undefined) continue; // stableKey 와 같은 규칙
        const found = walk(obj[key], `${path}.${key}`, depth + 1);
        if (found) return found;
      }
      return undefined;
    } finally {
      active.delete(current);
    }
  }

  return walk(value, "args", 0);
}

/**
 * 위반을 사람이 읽는 문장으로 바꾼다. 실패 메시지가 곧 제품이다 (CLAUDE.md).
 *
 * 변하는 값(`path` · `found`) 뒤에 조사를 붙이지 않는다. 받침 유무가 갈려서
 * 어느 쪽으로 고정해도 한쪽이 틀린다 — `docs/reports/task-b6.md` 에서 모델 이름으로
 * 같은 문제를 겪고 내린 결론이다. 그래서 값은 전부 콜론이나 대시 뒤에 둔다.
 */
function keyViolationMessage(violation: KeyViolation, source: string): string {
  const head = `→ ${source} 의 인자로 매칭 키를 만들 수 없습니다`;
  switch (violation.kind) {
    case "circular":
      return [
        `${head}: 순환 참조`,
        `→ 위치: ${violation.path}`,
        "→ JSON 에는 순환 참조가 없어서 이 주입은 어떤 호출과도 맞지 않습니다. 참조를 끊고 값을 펼쳐 넘기세요.",
      ].join("\n");
    case "sparse":
      return [
        `${head}: 희소 배열`,
        `→ 위치: ${violation.path} — 비어 있는 자리`,
        "→ 와이어를 건너오면 빈 자리가 null 로 채워집니다. 빈 자리에 null 을 명시하세요.",
      ].join("\n");
    case "nonFinite":
      return [
        `${head}: 유한하지 않은 수`,
        `→ 위치: ${violation.path} — 발견: ${violation.found}`,
        "→ JSON 에는 NaN · Infinity 가 없습니다. 유한한 수를 쓰거나 그 상태를 나타내는 문자열을 쓰세요.",
      ].join("\n");
    case "notJson":
      return [
        `${head}: JSON 으로 표현할 수 없는 값`,
        `→ 위치: ${violation.path} — 발견: ${violation.found}`,
        "→ 매칭 키가 되는 것은 객체 · 배열 · 문자열 · 유한한 수 · 불리언 · null 뿐입니다. 직렬화한 값으로 바꿔 넘기세요 (예: Date → toISOString()).",
      ].join("\n");
    case "tooDeep":
      return [
        `${head}: 중첩이 너무 깊습니다`,
        `→ 위치: 깊이 ${violation.depth} — 상한: ${MAX_KEY_DEPTH}`,
        "→ 목에 넘기는 인자는 테스트가 읽을 수 있는 크기여야 합니다. 필요한 필드만 넘기세요.",
      ].join("\n");
  }
}

/**
 * 주입 경로 전용. 키로 만들 수 없는 값이면 던진다.
 *
 * `source` 는 문장에 들어갈 진입점 표기다 — `mock.on('add', ...)` 또는
 * `정의 파일의 responses[0]`. 툴 이름을 따로 받지 않는 이유는 `source` 가 이미 담고 있어
 * 두 인자가 어긋날 여지만 생기기 때문이다.
 */
export function assertKeyable(value: unknown, source: string): void {
  const violation = findKeyViolation(value);
  if (violation !== undefined) throw new Error(keyViolationMessage(violation, source));
}

/**
 * 조회 경로에서 깊이 상한을 넘었을 때. 핸들러가 잡아 isError 응답으로 바꾼다.
 *
 * 생성자 매개변수 프로퍼티(`constructor(readonly depth: number)`)를 안 쓴다 — 그 문법은
 * "지우기만 하면 되는" TS 문법이 아니라 실제 코드 생성이 필요해서, `tests/fixtures/stdio-entry.mjs`
 * 가 이 파일을 raw node(`--experimental-strip-types`)로 돌릴 때 "parameter property is not
 * supported in strip-only mode" 로 죽는다(실측). 필드 선언 + 본문 대입으로 우회한다.
 */
export class KeyDepthError extends Error {
  readonly depth: number;
  constructor(depth: number) {
    super(`중첩이 너무 깊습니다 (깊이 ${depth}, 상한 ${MAX_KEY_DEPTH})`);
    this.name = "KeyDepthError";
    this.depth = depth;
  }
}
