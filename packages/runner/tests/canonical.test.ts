import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/index.js";

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
});
