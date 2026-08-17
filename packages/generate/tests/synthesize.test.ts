import { describe, expect, it } from "vitest";
import { synthesizeValue } from "../src/synthesize.js";

const value = (schema: Record<string, unknown>) => synthesizeValue(schema, "p");

describe("숫자 하한 경계값", () => {
  it.each([
    [{ type: "integer", minimum: 1, maximum: 10 }, 1],
    [{ type: "integer", minimum: 0 }, 0],
    [{ type: "integer", minimum: -5 }, -5],
    [{ type: "integer", exclusiveMinimum: 0 }, 1],
    [{ type: "number", exclusiveMinimum: 0 }, 1],
    [{ type: "integer", maximum: 10 }, 10],
    [{ type: "integer", exclusiveMaximum: 1000000 }, 999999],
    [{ type: "number", exclusiveMaximum: 100 }, 99],
    [{ type: "integer" }, 0],
    [{ type: "number" }, 0],
    [{ type: "integer", minimum: 1, exclusiveMaximum: 5 }, 1],
  ])("%j → %s", (schema, expected) => {
    expect(value(schema)).toBe(expected);
  });

  it("integer 의 소수 하한은 정수로 올린다", () => {
    // minimum 1.2 를 그대로 쓰면 자기 type 을 어긴 값이 된다.
    expect(value({ type: "integer", minimum: 1.2 })).toBe(2);
  });
});

describe("문자열 길이", () => {
  it.each([
    [{ type: "string" }, "example"],
    [{ type: "string", minLength: 3 }, "example"],
    [{ type: "string", minLength: 10 }, "examplexxx"],
    [{ type: "string", maxLength: 3 }, "exa"],
    [{ type: "string", minLength: 2, maxLength: 4 }, "exam"],
    [{ type: "string", maxLength: 0 }, ""],
  ])("%j → %s", (schema, expected) => {
    expect(value(schema)).toBe(expected);
  });
});

describe("format 표", () => {
  it.each([
    ["uri", "https://example.com"],
    ["uri-reference", "https://example.com"],
    ["iri", "https://example.com"],
    ["date", "2000-01-01"],
    ["date-time", "2000-01-01T00:00:00Z"],
    ["time", "00:00:00"],
    ["duration", "P1D"],
    ["email", "user@example.com"],
    ["idn-email", "user@example.com"],
    ["uuid", "00000000-0000-4000-8000-000000000000"],
    ["hostname", "example.com"],
    ["ipv4", "192.0.2.1"],
    ["ipv6", "2001:db8::1"],
  ])("format %s → %s", (format, expected) => {
    expect(value({ type: "string", format })).toBe(expected);
  });

  it("표 밖 format 은 거절하지 않고 example 을 넣는다", () => {
    expect(value({ type: "string", format: "json-pointer" })).toBe("example");
  });

  it("format 이 길이 제약보다 우선한다", () => {
    // 자르면 형식이 깨져 둘 다 못 지킨다. 길이가 안 맞으면 dry run 이 잡는다.
    expect(value({ type: "string", format: "uri", maxLength: 5 })).toBe("https://example.com");
  });
});

describe("배열 개수", () => {
  it.each([
    [{ type: "array", items: { type: "string" } }, ["example"]],
    [{ type: "array", items: { type: "string" }, minItems: 2 }, ["example", "example"]],
    [{ type: "array", items: { type: "string" }, maxItems: 0 }, []],
    [{ type: "array", items: { type: "integer", minimum: 3 }, minItems: 2 }, [3, 3]],
    [{ type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 }, ["example"]],
  ])("%j → %j", (schema, expected) => {
    expect(value(schema)).toEqual(expected);
  });
});

describe("우선순위가 제약보다 앞선다", () => {
  it("default 가 범위를 만족하면 default 를 쓴다", () => {
    expect(value({ type: "integer", minimum: 5, default: 7 })).toBe(7);
  });

  it("enum[0] 이 범위를 만족하면 그것을 쓴다", () => {
    expect(value({ type: "integer", minimum: 5, enum: [7, 9] })).toBe(7);
  });

  it("default 가 범위 밖이면 거절한다", () => {
    expect(() => value({ type: "integer", minimum: 5, default: 1 })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("default 가 길이 제약을 어기면 거절한다", () => {
    expect(() => value({ type: "string", minLength: 5, default: "ab" })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("examples[0] 이 minItems 를 어기면 거절한다", () => {
    expect(() =>
      value({ type: "array", items: { type: "string" }, minItems: 2, examples: [["a"]] }),
    ).toThrow(expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }));
  });

  it("format 이 있으면 후보의 길이 제약은 보지 않는다", () => {
    expect(
      value({ type: "string", format: "uri", maxLength: 5, default: "https://example.com" }),
    ).toBe("https://example.com");
  });
});

describe("중첩", () => {
  it("객체 안의 제약을 지킨다", () => {
    expect(
      value({
        type: "object",
        required: ["count", "url"],
        properties: {
          count: { type: "integer", minimum: 1 },
          url: { type: "string", format: "uri" },
        },
      }),
    ).toEqual({ count: 1, url: "https://example.com" });
  });

  it("같은 입력을 두 번 합성하면 바이트로 같다", () => {
    const schema = {
      type: "object",
      required: ["count", "tags"],
      properties: {
        count: { type: "integer", minimum: 1, maximum: 10 },
        tags: { type: "array", items: { type: "string" }, minItems: 2 },
      },
    };
    expect(JSON.stringify(value(schema))).toBe(JSON.stringify(value(schema)));
  });
});
