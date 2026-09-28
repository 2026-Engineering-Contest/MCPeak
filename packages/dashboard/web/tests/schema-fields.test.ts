import { describe, expect, it } from "vitest";
import { fieldsToSchema, schemaToFields } from "../src/mock-builder/schema-fields.js";

describe("fieldsToSchema", () => {
  it("필드 순서대로 properties 를, 필수만 required 에 담는다", () => {
    expect(
      fieldsToSchema([
        { name: "city", type: "string", required: true },
        { name: "days", type: "integer", required: false },
      ]),
    ).toEqual({
      type: "object",
      properties: { city: { type: "string" }, days: { type: "integer" } },
      required: ["city"],
    });
  });

  it("필수가 없으면 required 키가 없다", () => {
    expect(fieldsToSchema([{ name: "verbose", type: "boolean", required: false }])).toEqual({
      type: "object",
      properties: { verbose: { type: "boolean" } },
    });
  });

  it("필드가 없으면 빈 properties 다", () => {
    expect(fieldsToSchema([])).toEqual({ type: "object", properties: {} });
  });
});

describe("schemaToFields", () => {
  it("fieldsToSchema 결과를 되돌린다", () => {
    const fields = [
      { name: "city", type: "string" as const, required: true },
      { name: "lat", type: "number" as const, required: false },
    ];
    expect(schemaToFields(fieldsToSchema(fields))).toEqual({ ok: true, fields });
  });

  it("properties 가 없는 object 는 빈 필드다", () => {
    expect(schemaToFields({ type: "object" })).toEqual({ ok: true, fields: [] });
  });

  it.each([
    [{ type: "array" }, '최상위 type 이 "object" 가 아닙니다.'],
    [
      { type: "object", properties: {}, additionalProperties: false },
      "최상위 키 'additionalProperties' 는 평면 폼에 자리가 없습니다.",
    ],
    [
      { type: "object", properties: { unit: { type: "string", enum: ["c", "f"] } } },
      "필드 'unit' 의 'enum' 은(는) 평면 폼에 자리가 없습니다.",
    ],
    [
      { type: "object", properties: { at: { type: "object" } } },
      "필드 'at' 의 타입 \"object\" 은(는) 평면 폼이 다루지 않습니다 (string · number · integer · boolean 만).",
    ],
    [
      { type: "object", properties: { tags: { type: "array" } } },
      "필드 'tags' 의 타입 \"array\" 은(는) 평면 폼이 다루지 않습니다 (string · number · integer · boolean 만).",
    ],
    [{ type: "object", properties: { any: {} } }, "필드 'any' 에 type 이 없습니다."],
    [
      { type: "object", properties: { city: { type: "string" } }, required: ["country"] },
      "required 의 'country' 이(가) properties 에 없습니다.",
    ],
    [
      { type: "object", properties: {}, required: ["toString"] },
      "required 의 'toString' 이(가) properties 에 없습니다.",
    ],
  ])("평면이 아니면 이유를 준다: %j", (schema, reason) => {
    expect(schemaToFields(schema)).toEqual({ ok: false, reason });
  });
});
