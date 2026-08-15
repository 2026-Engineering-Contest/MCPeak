import { describe, expect, it } from "vitest";
import { findKeyViolation, MAX_KEY_DEPTH } from "../src/key-violation.js";

/** 깊이 n 짜리 중첩 객체를 만든다. 루트가 깊이 0. */
function nest(depth: number): unknown {
  let value: unknown = null;
  for (let i = 0; i < depth; i++) value = { a: value };
  return value;
}

describe("findKeyViolation — 통과하는 값", () => {
  it.each([
    ["빈 객체", {}],
    ["원시값만", { a: 1, b: "x", c: true, d: null }],
    ["중첩 객체", { a: { b: { c: 1 } } }],
    ["배열", { items: [1, "x", null, { a: 1 }] }],
    ["undefined 프로퍼티", { a: 1, b: undefined }],
    ["배열 안 undefined", { items: [1, undefined, 3] }],
    [
      "같은 객체를 두 번 참조 (순환 아님)",
      (() => {
        const s = { x: 1 };
        return { a: s, b: s };
      })(),
    ],
  ])("%s", (_name, value) => {
    expect(findKeyViolation(value)).toBeUndefined();
  });
});

describe("findKeyViolation — 거부하는 값", () => {
  it.each([
    ["루트의 NaN", { n: NaN }, { kind: "nonFinite", path: "args.n", found: "NaN" }],
    [
      "중첩된 Infinity",
      { a: { b: Infinity } },
      { kind: "nonFinite", path: "args.a.b", found: "Infinity" },
    ],
    [
      "배열 안 NaN",
      { items: [1, NaN] },
      { kind: "nonFinite", path: "args.items[1]", found: "NaN" },
    ],
    ["Date", { when: new Date(0) }, { kind: "notJson", path: "args.when", found: "Date" }],
    ["함수", { f: () => {} }, { kind: "notJson", path: "args.f", found: "function" }],
    ["Map", { m: new Map() }, { kind: "notJson", path: "args.m", found: "Map" }],
  ])("%s", (_name, value, expected) => {
    expect(findKeyViolation(value)).toEqual(expected);
  });

  it("희소 배열", () => {
    // biome-ignore lint/suspicious/noSparseArray: 희소 배열 판정을 테스트하려면 빈 슬롯이 필요하다.
    expect(findKeyViolation({ items: [1, , 3] })).toEqual({
      kind: "sparse",
      path: "args.items[1]",
    });
  });

  it("순환 참조", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(findKeyViolation(circular)).toEqual({ kind: "circular", path: "args.self" });
  });

  it("상한을 넘는 깊이", () => {
    const violation = findKeyViolation(nest(MAX_KEY_DEPTH + 2));
    expect(violation).toEqual({ kind: "tooDeep", depth: MAX_KEY_DEPTH + 1 });
  });

  it("상한과 같은 깊이는 통과한다", () => {
    expect(findKeyViolation(nest(MAX_KEY_DEPTH))).toBeUndefined();
  });
});
