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
