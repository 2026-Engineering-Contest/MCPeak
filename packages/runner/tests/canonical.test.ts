import { describe, expect, it } from "vitest";
import { canonicalJson, deepFreeze, sha256 } from "../src/index.js";

describe("canonicalJson · sha256 (generate 에서 이관)", () => {
  it("sha256은 같은 값에 항상 같은 해시를 준다", () => {
    const value = { id: "weather", cases: [{ id: "call", input: { city: "서울" } }] };
    expect(sha256(value)).toBe(sha256(structuredClone(value)));
  });

  it("sha256은 결과가 /^[0-9a-f]{64}$/ 를 만족한다", () => {
    expect(sha256("x")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256은 key 순서가 다른 동등한 객체에 같은 해시를 준다", () => {
    expect(sha256({ a: 1, b: { c: 2, d: [3, 4] } })).toBe(sha256({ b: { d: [3, 4], c: 2 }, a: 1 }));
  });

  it("sha256은 배열 순서가 다르면 다른 해시를 준다", () => {
    // 배열 순서는 의미가 있으므로 달라야 한다.
    expect(sha256([1, 2])).not.toBe(sha256([2, 1]));
  });
});

/**
 * suiteFingerprint 가 이 함수의 예외 동작에 기댄다. 검증을 통과한 명세에는 아래 값들이 없다는
 * 전제이므로, 그 전제가 깨졌을 때 조용히 통과하지 않고 던지는지를 여기서 고정한다.
 */
describe("canonicalJson 방어 계약", () => {
  it("undefined 를 넣으면 TypeError 를 던진다", () => {
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it("NaN 을 넣으면 TypeError 를 던진다", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });

  it("Infinity 를 넣으면 TypeError 를 던진다", () => {
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  it("순환 참조를 넣으면 TypeError 를 던진다", () => {
    const cyclic: Record<string, unknown> = { name: "a" };
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow(TypeError);
  });

  it("sparse array 를 넣으면 TypeError 를 던진다", () => {
    const sparse = [1, 2, 3];
    delete sparse[1];
    expect(() => canonicalJson(sparse)).toThrow(TypeError);
  });

  it("Object.create(null) 로 만든 객체를 받는다", () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare.a = 1;
    expect(canonicalJson(bare)).toBe('{"a":1}');
  });

  it("class 인스턴스를 넣으면 TypeError 를 던진다", () => {
    class Suite {
      id = "weather";
    }
    expect(() => canonicalJson(new Suite())).toThrow(TypeError);
  });

  it("Array.prototype 에 인덱스가 정의돼 있어도 hole 을 거절한다", () => {
    // 프로토타입 체인까지 보면 hole 이 상속값으로 채워져 지문이 전역 상태에 따라 달라진다.
    const sparse = [1, 2, 3];
    delete sparse[1];
    try {
      Object.defineProperty(Array.prototype, "1", {
        value: 99,
        configurable: true,
        writable: true,
      });
      expect(sparse[1]).toBe(99);
      expect(() => canonicalJson(sparse)).toThrow(TypeError);
    } finally {
      // 되돌리지 않으면 이 프로세스의 다른 테스트 파일이 오염된다.
      delete (Array.prototype as unknown as Record<string, unknown>)["1"];
    }
    expect(1 in Array.prototype).toBe(false);
  });
});

describe("deepFreeze", () => {
  it("상위만 Object.freeze 한 객체를 deepFreeze 하면 자식도 동결된다", () => {
    // Object.freeze 는 얕다. 이미 동결됐다고 자식 순회를 건너뛰면 하위가 변경 가능한 채로 남는다.
    const value = Object.freeze({ child: { leaf: [1, 2] } });
    expect(Object.isFrozen(value.child)).toBe(false);

    deepFreeze(value);

    expect(Object.isFrozen(value.child)).toBe(true);
    expect(Object.isFrozen(value.child.leaf)).toBe(true);
  });

  it("순환 참조가 있는 객체를 deepFreeze 해도 끝난다", () => {
    const cyclic: Record<string, unknown> = { name: "a", child: { leaf: true } };
    cyclic.self = cyclic;

    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
    expect(Object.isFrozen(cyclic.child)).toBe(true);
  });
});

/**
 * validateMcpSuite 는 깊이 10000 짜리 입력을 통과시킨다(deep-and-cyclic-input.test.ts).
 * 직렬화가 재귀였을 때는 그 깊이에서 RangeError 로 죽어서, 검증을 통과한 명세가 지문 계산에서만
 * 죽었다. 명시적 스택으로 바꾼 이유가 이것이므로 여기서 고정한다.
 */
describe("canonicalJson 깊이 회귀", () => {
  /** 깊이 n 의 {"next":...} 중첩. 기대 문자열을 직렬화기와 무관하게 따로 만든다. */
  const deepObject = (depth: number) => {
    let value: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < depth; index++) value = { next: value };
    return value;
  };
  const expectedObject = (depth: number) =>
    `${'{"next":'.repeat(depth)}{"leaf":true}${"}".repeat(depth)}`;

  const deepArray = (depth: number) => {
    let value: unknown[] = [0];
    for (let index = 0; index < depth; index++) value = [value];
    return value;
  };
  const expectedArray = (depth: number) => `${"[".repeat(depth)}[0]${"]".repeat(depth)}`;

  it("깊이 10000 객체를 던지지 않고 직렬화한다", () => {
    expect(canonicalJson(deepObject(10_000))).toBe(expectedObject(10_000));
  });

  it("깊이 20000 객체를 던지지 않고 직렬화한다", () => {
    expect(canonicalJson(deepObject(20_000))).toBe(expectedObject(20_000));
  });

  it("깊이 20000 배열을 던지지 않고 직렬화한다", () => {
    expect(canonicalJson(deepArray(20_000))).toBe(expectedArray(20_000));
  });

  it("깊이 20000 에서도 sha256 이 hex 64자를 낸다", () => {
    expect(sha256(deepObject(20_000))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("깊이 20000 객체를 deepFreeze 해도 던지지 않는다", () => {
    const deep = deepObject(20_000);
    expect(() => deepFreeze(deep)).not.toThrow();
    expect(Object.isFrozen(deep)).toBe(true);
    expect(Object.isFrozen(deep.next)).toBe(true);
  });
});
