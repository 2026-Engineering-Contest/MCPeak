import { createHash } from "node:crypto";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;
type CanonicalObject = { [key: string]: CanonicalValue };

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/**
 * 배열 순서와 UTF-16 key 정렬을 보존하는 JSON 직렬화다.
 *
 * 재귀가 아니라 명시적 프레임 스택으로 순회한다. 재귀판은 깊이 1500 부근에서 RangeError 로
 * 죽었는데, validateMcpSuite 는 그 깊이를 통과시킨다. 즉 검증을 통과한 명세가 지문 계산에서만
 * 죽었다. schema-match.ts 와 spec/validation.ts 의 json() 이 같은 이유로 같은 방식을 쓴다.
 *
 * 출력은 재귀판과 바이트 단위로 같다. 조각을 순서대로 parts 에 쌓고 마지막에 이어 붙이는데,
 * 여는 괄호는 방문 시점에 넣고 쉼표와 닫는 괄호는 emit 프레임으로 예약해 순서를 고정한다.
 */
export function canonicalJson(value: unknown): string {
  type Frame =
    | { type: "visit"; value: unknown }
    /** 배열 원소 하나. hole 검사를 그 원소를 방문하는 시점에 해야 재귀판과 에러가 같다. */
    | { type: "element"; array: unknown[]; index: number }
    | { type: "emit"; text: string }
    | { type: "leave"; value: object };

  const active = new Set<object>();
  const parts: string[] = [];
  const frames: Frame[] = [{ type: "visit", value }];

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    if (frame.type === "emit") {
      parts.push(frame.text);
      continue;
    }
    if (frame.type === "leave") {
      active.delete(frame.value);
      continue;
    }
    if (frame.type === "element") {
      // 프로토타입 체인이 아니라 own property 만 본다. Array.prototype 에 인덱스가 정의돼
      // 있으면 hole 이 상속값으로 채워져 지문이 전역 상태에 따라 달라진다.
      if (!Object.hasOwn(frame.array, frame.index))
        throw new TypeError("canonical JSON에는 sparse array를 사용할 수 없습니다.");
      frames.push({ type: "visit", value: frame.array[frame.index] });
      continue;
    }

    const current = frame.value;
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      parts.push(JSON.stringify(current));
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new TypeError("canonical JSON에는 유한한 숫자만 사용할 수 있습니다.");
      parts.push(JSON.stringify(current));
      continue;
    }
    if (typeof current === "undefined")
      throw new TypeError("canonical JSON에는 undefined를 사용할 수 없습니다.");
    if (!Array.isArray(current) && !plainObject(current)) {
      throw new TypeError("canonical JSON에는 일반 객체만 사용할 수 있습니다.");
    }
    if (active.has(current))
      throw new TypeError("canonical JSON에는 순환 참조를 사용할 수 없습니다.");
    active.add(current);

    if (Array.isArray(current)) {
      parts.push("[");
      // 스택은 나중에 넣은 것을 먼저 꺼내므로 역순으로 넣는다.
      frames.push({ type: "emit", text: "]" });
      frames.push({ type: "leave", value: current });
      for (let index = current.length - 1; index >= 0; index--) {
        frames.push({ type: "element", array: current, index });
        if (index > 0) frames.push({ type: "emit", text: "," });
      }
      continue;
    }

    parts.push("{");
    const keys = Object.keys(current).sort();
    frames.push({ type: "emit", text: "}" });
    frames.push({ type: "leave", value: current });
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index] as string;
      frames.push({ type: "visit", value: current[key] });
      frames.push({ type: "emit", text: `${JSON.stringify(key)}:` });
      if (index > 0) frames.push({ type: "emit", text: "," });
    }
  }

  return parts.join("");
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * JSON-compatible 값 전체를 재귀적으로 동결한다.
 *
 * canonicalJson 과 같은 이유로 명시적 스택을 쓴다. 자식을 먼저 얼리고 부모를 나중에 어는
 * 순서는 재귀판과 같다. seen 은 순환 입력에서 프레임이 무한히 느는 것을 막는다. 재귀판은
 * 같은 입력에서 스택이 넘쳤다.
 */
export function deepFreeze<T>(value: T): T {
  type Frame = { type: "visit" | "freeze"; value: unknown };
  const frames: Frame[] = [{ type: "visit", value }];
  const seen = new Set<object>();

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) break;
    const current = frame.value;
    if (frame.type === "freeze") {
      Object.freeze(current as object);
      continue;
    }
    // 이미 동결됐다고 건너뛰지 않는다. Object.freeze 는 얕아서 상위만 동결된 입력이 실재하고,
    // 그때 하위가 변경 가능한 채로 남는다. 순환은 seen 이 막으므로 isFrozen 은 필요 없다.
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    frames.push({ type: "freeze", value: current });
    for (const key of Reflect.ownKeys(current))
      frames.push({ type: "visit", value: (current as Record<PropertyKey, unknown>)[key] });
  }

  return value;
}
