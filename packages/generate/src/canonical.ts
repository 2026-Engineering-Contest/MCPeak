import { createHash } from "node:crypto";

type CanonicalValue = null | boolean | number | string | CanonicalValue[] | CanonicalObject;
type CanonicalObject = { [key: string]: CanonicalValue };

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** 배열 순서와 UTF-16 key 정렬을 보존하는 JSON 직렬화다. */
export function canonicalJson(value: unknown): string {
  const active = new Set<object>();

  const visit = (current: unknown): string => {
    if (current === null || typeof current === "boolean" || typeof current === "string") {
      return JSON.stringify(current);
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current))
        throw new TypeError("canonical JSON에는 유한한 숫자만 사용할 수 있습니다.");
      return JSON.stringify(current);
    }
    if (typeof current === "undefined")
      throw new TypeError("canonical JSON에는 undefined를 사용할 수 없습니다.");
    if (!Array.isArray(current) && !plainObject(current)) {
      throw new TypeError("canonical JSON에는 일반 객체만 사용할 수 있습니다.");
    }
    if (active.has(current))
      throw new TypeError("canonical JSON에는 순환 참조를 사용할 수 없습니다.");
    active.add(current);
    try {
      if (Array.isArray(current)) {
        const values: string[] = [];
        for (let index = 0; index < current.length; index++) {
          if (!(index in current))
            throw new TypeError("canonical JSON에는 sparse array를 사용할 수 없습니다.");
          values.push(visit(current[index]));
        }
        return `[${values.join(",")}]`;
      }
      return `{${Object.keys(current)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${visit(current[key])}`)
        .join(",")}}`;
    } finally {
      active.delete(current);
    }
  };

  return visit(value);
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** JSON-compatible 값 전체를 재귀적으로 동결한다. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
