import { describe, expect, it } from "vitest";
import { mergeSchemas, resolveLocalRef } from "../src/composition.js";
import type { JsonSchema } from "../src/schema.js";

const root: JsonSchema = {
  type: "object",
  properties: { x: { $defs: { y: { type: "boolean" } } } },
  items: [{ type: "string" }, { type: "number" }],
  $defs: {
    A: { type: "string" },
    "a/b": { type: "integer" },
    "a~b": { type: "null" },
    이름: { type: "boolean" },
    문자열값: "스키마 객체가 아니다",
  },
  definitions: { A: { type: "number" } },
};

const defs = root.$defs as Record<string, JsonSchema>;

describe("resolveLocalRef", () => {
  it.each([
    ["#/$defs/A", defs.A],
    ["#/definitions/A", (root.definitions as Record<string, JsonSchema>).A],
    ["#", root],
    ["#/properties/x/$defs/y", { type: "boolean" }],
    ["#/$defs/a~1b", defs["a/b"]],
    ["#/$defs/a~0b", defs["a~b"]],
    ["#/$defs/%EC%9D%B4%EB%A6%84", defs.이름],
    ["#/items/1", { type: "number" }],
  ])("%j 는 대상 객체를 돌려준다", (ref, expected) => {
    expect(resolveLocalRef(ref, root, "p")).toEqual(expected);
  });

  it.each(["http://x/#/a", "other.json#/a", "a"])("%j 는 루트 밖이라 거절한다", (ref) => {
    expect(() => resolveLocalRef(ref, root, "p")).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        message: expect.stringMatching(/^루트 스키마 밖을/),
      }),
    );
    expect(() => resolveLocalRef(ref, root, "p")).toThrow(
      expect.objectContaining({ message: expect.stringContaining(`"${ref}"`) }),
    );
  });

  it.each([
    ["#/$defs/없음", "없음"],
    ["#/$defs/문자열값", "문자열값"],
  ])("%j 는 대상을 찾지 못한다", (ref, last) => {
    expect(() => resolveLocalRef(ref, root, "p")).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        message: expect.stringMatching(/^\$ref 대상을 찾지 못했습니다/),
        hint: expect.stringContaining(last),
      }),
    );
  });

  it("$ref 값이 문자열이 아니면 거절한다", () => {
    expect(() => resolveLocalRef(5, root, "p")).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });
});

describe("mergeSchemas", () => {
  const merge = (outer: JsonSchema, inner: JsonSchema) => mergeSchemas(outer, inner, "p.$ref");
  const conflictAt = (outer: JsonSchema, inner: JsonSchema, path: string) => {
    expect(() => merge(outer, inner)).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA", path }),
    );
  };

  it("required 는 합집합이고 outer 순서가 앞이다", () => {
    expect(merge({ required: ["b", "a"] }, { required: ["a", "c"] }).required).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("properties 는 이름 단위 합집합이다", () => {
    expect(
      merge({ properties: { a: { type: "string" } } }, { properties: { b: { type: "number" } } })
        .properties,
    ).toEqual({ a: { type: "string" }, b: { type: "number" } });
  });

  it("같은 이름의 properties 가 다르면 충돌이다", () => {
    conflictAt(
      { properties: { x: { type: "string" } } },
      { properties: { x: { type: "number" } } },
      "p.$ref.properties.x",
    );
  });

  it("같은 이름의 properties 가 JSON 으로 같으면 허용한다", () => {
    expect(
      merge({ properties: { x: { type: "string" } } }, { properties: { x: { type: "string" } } })
        .properties,
    ).toEqual({ x: { type: "string" } });
  });

  it("하한은 큰 값, 상한은 작은 값이다", () => {
    expect(merge({ minimum: 1 }, { minimum: 5 }).minimum).toBe(5);
    expect(merge({ maximum: 10 }, { maximum: 3 }).maximum).toBe(3);
    expect(merge({ minLength: 2 }, { minLength: 7 }).minLength).toBe(7);
    expect(merge({ maxItems: 9 }, { maxItems: 4 }).maxItems).toBe(4);
  });

  it("enum 은 교집합이고 outer 순서다", () => {
    expect(merge({ enum: [3, 1, 2] }, { enum: [2, 3] }).enum).toEqual([3, 2]);
  });

  it("enum 교집합이 비면 충돌이다", () => {
    conflictAt({ enum: [1] }, { enum: [2] }, "p.$ref.enum");
  });

  it("type 이 다르면 충돌이다", () => {
    conflictAt({ type: "string" }, { type: "number" }, "p.$ref.type");
  });

  it("type 이 같으면 하나다", () => {
    expect(merge({ type: "string" }, { type: "string" }).type).toBe("string");
  });

  it("default 가 다르면 outer 가 남는다", () => {
    expect(merge({ default: "outer" }, { default: "inner" }).default).toBe("outer");
  });

  it("title 은 outer 다", () => {
    expect(merge({ title: "outer" }, { title: "inner" }).title).toBe("outer");
  });

  it("$defs 는 outer 다", () => {
    expect(
      merge({ $defs: { A: { type: "string" } } }, { $defs: { A: { type: "number" } } }).$defs,
    ).toEqual({ A: { type: "string" } });
  });

  it("inner 의 anyOf 는 남는다", () => {
    expect(merge({ type: "object" }, { anyOf: [{ required: ["x"] }] }).anyOf).toEqual([
      { required: ["x"] },
    ]);
    expect(merge({ anyOf: [{ required: ["x"] }] }, { anyOf: [{ required: ["y"] }] }).anyOf).toEqual(
      [{ required: ["y"] }],
    );
  });

  it("모르는 키가 양쪽에 같으면 하나, 다르면 충돌이다", () => {
    expect(merge({ deprecated: true }, { deprecated: true }).deprecated).toBe(true);
    conflictAt({ deprecated: true }, { deprecated: false }, "p.$ref.deprecated");
  });
});
