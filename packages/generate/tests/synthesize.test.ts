import { describe, expect, it } from "vitest";
import { FORMAT_VALUES } from "../src/constraints.js";
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

  it.each([
    // 한 칸 옮긴 +1 이 상한을 넘는 좁은 구간. 확률·비율 파라미터에서 흔한 선언이다.
    [{ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 }, 0.5],
    [{ type: "number", exclusiveMinimum: 0, maximum: 0.5 }, 0.25],
    [{ type: "number", exclusiveMinimum: 1, maximum: 1.5 }, 1.25],
    // 넘지 않으면 종전대로 한 칸 옮긴다.
    [{ type: "number", exclusiveMinimum: 0, maximum: 10 }, 1],
    // 하한이 minimum 이면 그 값 자체가 언제나 범위 안이다.
    [{ type: "number", minimum: 0, exclusiveMaximum: 0.5 }, 0],
  ])("좁은 배타 구간 %j → %s", (schema, expected) => {
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
    ["time", "00:00:00Z"],
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

describe("additionalProperties: false 후보 검사", () => {
  const strict = {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
    additionalProperties: false,
  };

  it("default 에 선언 밖 키가 있으면 후보 불만족으로 UNSUPPORTED_SCHEMA 다", () => {
    expect(() => value({ ...strict, default: { a: "x", b: 1 } })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("default 가 선언 안이면 그대로 쓴다", () => {
    expect(value({ ...strict, default: { a: "x" } })).toEqual({ a: "x" });
  });

  it("additionalProperties 가 true 면 선언 밖 키를 허용한다", () => {
    expect(value({ ...strict, additionalProperties: true, default: { a: "x", b: 1 } })).toEqual({
      a: "x",
      b: 1,
    });
  });
});

describe("pattern 단계 순서", () => {
  it("const 가 pattern 을 만족하면 const 다", () => {
    expect(value({ type: "string", pattern: "^[a-z]+$", const: "zz" })).toBe("zz");
  });

  it("default 가 pattern 을 어기면 후보 불만족이다", () => {
    expect(() => value({ type: "string", pattern: "^[a-z]+$", default: "ZZ" })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("알려진 format 값이 pattern 을 통과하면 format 값이다", () => {
    expect(value({ type: "string", format: "uuid", pattern: "^[0-9a-f-]{36}$" })).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
  });

  it("알려진 format 값이 pattern 을 통과하지 못하면 생성기로 간다", () => {
    expect(value({ type: "string", format: "uri", pattern: "^ftp://[a-z]+$" })).toBe("ftp://a");
  });

  it("표 밖 format 은 생성기로 간다", () => {
    expect(value({ type: "string", format: "hostname", pattern: "^[a-z]+$" })).toBe("a");
  });

  it("pattern 과 minLength 가 함께 오면 채운다", () => {
    expect(value({ type: "string", pattern: "^[a-z]+$", minLength: 3 })).toBe("aaa");
  });

  // zod 4.4.3 + @modelcontextprotocol/sdk 1.30.0 이 draft-07 로 실제로 내는 pattern 이다
  // (설계 §1.2 실측). 이 세 건이 깨지면 zod 서버의 문자열 필드가 통째로 생성기로 내려간다.
  it.each([
    [
      "uuid",
      "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$",
    ],
    [
      "date-time",
      "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z))$",
    ],
    [
      "email",
      "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$",
    ],
  ])("zod 가 붙이는 %s pattern 을 FORMAT_VALUES 값이 통과한다", (format, pattern) => {
    expect(value({ type: "string", format, pattern })).toBe(FORMAT_VALUES.get(format));
  });
});

describe("$ref 합성", () => {
  const inner = {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" } },
  };

  /** 설계 §1.2 의 zod `rec` 스키마. `kids` 는 선택이라 필수 경로가 순환하지 않는다. */
  const recursive = (required: readonly string[], extra: Record<string, unknown> = {}) => ({
    type: "object",
    properties: { root: { $ref: "#/definitions/__schema0" } },
    required: ["root"],
    definitions: {
      __schema0: {
        type: "object",
        properties: {
          v: { type: "string" },
          kids: { type: "array", items: { $ref: "#/definitions/__schema0" }, ...extra },
        },
        required,
      },
    },
  });

  it("pydantic 형태 $defs 참조를 합성한다", () => {
    expect(
      value({
        type: "object",
        required: ["who"],
        properties: { who: { $ref: "#/$defs/Inner" } },
        $defs: { Inner: inner },
      }),
    ).toEqual({ who: { name: "example" } });
  });

  it("zod 형태 definitions 참조를 합성한다", () => {
    expect(
      value({
        type: "object",
        required: ["who"],
        properties: { who: { $ref: "#/definitions/__schema0" } },
        definitions: { __schema0: inner },
      }),
    ).toEqual({ who: { name: "example" } });
  });

  it("$ref 옆 default 는 후보로 쓴다", () => {
    expect(
      value({ $ref: "#/$defs/Inner", default: { name: "d" }, $defs: { Inner: inner } }),
    ).toEqual({ name: "d" });
  });

  it("배열 items 의 $ref 를 합성한다", () => {
    expect(
      value({
        type: "array",
        items: { $ref: "#/$defs/Inner" },
        minItems: 2,
        $defs: { Inner: inner },
      }),
    ).toEqual([{ name: "example" }, { name: "example" }]);
  });

  it("선택 필드의 재귀는 통과한다", () => {
    expect(value(recursive(["v"]))).toEqual({ root: { v: "example" } });
  });

  it("필수 경로의 재귀는 UNSUPPORTED_SCHEMA 다", () => {
    expect(() => value(recursive(["v", "kids"], { minItems: 1 }))).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        path: "p.properties.root.properties.kids.items",
        message: expect.stringMatching(/^필수 경로에 순환 참조/),
      }),
    );
    expect(() => value(recursive(["v", "kids"], { minItems: 1 }))).toThrow(
      expect.objectContaining({
        message: expect.stringContaining('"#/definitions/__schema0"'),
      }),
    );
  });

  it("루트 자신 참조(#)는 필수 경로에서 거절된다", () => {
    expect(() =>
      value({ type: "object", required: ["self"], properties: { self: { $ref: "#" } } }),
    ).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        message: expect.stringMatching(/^필수 경로에 순환 참조/),
      }),
    );
  });
});

describe("anyOf / oneOf 합성", () => {
  it("nullable 은 첫 갈래 string 이다", () => {
    expect(value({ anyOf: [{ type: "string" }, { type: "null" }] })).toBe("example");
  });

  it("null 이 첫 갈래면 null 이다", () => {
    expect(value({ anyOf: [{ type: "null" }, { type: "string" }] })).toBe(null);
  });

  it("enum nullable 은 enum[0] 이다", () => {
    expect(value({ anyOf: [{ type: "string", enum: ["x", "y"] }, { type: "null" }] })).toBe("x");
  });

  it("union 은 첫 갈래다", () => {
    expect(value({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("example");
  });

  it("첫 갈래가 미지원이면 다음 갈래다", () => {
    expect(value({ anyOf: [{ type: "string", not: {} }, { type: "number" }] })).toBe(0);
  });

  it("갈래에 type 이 없으면 바깥 type 을 물려받는다", () => {
    expect(
      value({
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" }, c: { type: "string" } },
        anyOf: [{ required: ["a"] }, { required: ["b", "c"] }],
      }),
    ).toEqual({ a: "example" });
  });

  it("바깥 required 와 갈래 required 는 합쳐진다", () => {
    expect(
      value({
        type: "object",
        required: ["a"],
        properties: { a: { type: "string" }, b: { type: "string" } },
        anyOf: [{ required: ["b"] }],
      }),
    ).toEqual({ a: "example", b: "example" });
  });

  it("default 가 어느 갈래든 만족하면 default 다", () => {
    expect(value({ anyOf: [{ type: "string" }, { type: "null" }], default: null })).toBe(null);
  });

  it("default 가 어느 갈래도 안 맞으면 후보 불만족이다", () => {
    expect(() => value({ anyOf: [{ type: "string" }, { type: "null" }], default: 3 })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("oneOf 는 정확히 한 갈래만 만족하는 값을 고른다", () => {
    // 두 갈래 모두 0 을 만들고 0 은 number 이자 integer 라 어느 쪽도 배타적이지 않다.
    expect(() => value({ oneOf: [{ type: "number" }, { type: "integer" }] })).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        message: expect.stringMatching(/^'oneOf' 의 어느 갈래로 만든 값도/),
      }),
    );
  });

  it("discriminatedUnion 은 첫 객체 갈래다", () => {
    expect(
      value({
        oneOf: [
          {
            type: "object",
            properties: { k: { type: "string", const: "a" }, a: { type: "string" } },
            required: ["k", "a"],
          },
          {
            type: "object",
            properties: { k: { type: "string", const: "b" }, b: { type: "number" } },
            required: ["k", "b"],
          },
        ],
      }),
    ).toEqual({ k: "a", a: "example" });
  });

  it("전 갈래 미지원이면 첫 갈래 원인이다", () => {
    const schema = {
      anyOf: [
        { type: "string", not: {} },
        { type: "string", allOf: [] },
      ],
    };
    expect(() => value(schema)).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED_SCHEMA",
        path: "p.anyOf",
        message: expect.stringMatching(/^'anyOf' 의 갈래 2개를 모두/),
      }),
    );
    expect(() => value(schema)).toThrow(
      expect.objectContaining({ message: expect.stringMatching(/첫 원인:.*'not'/) }),
    );
  });

  it("갈래의 모순 제약은 전체 중단이다", () => {
    expect(() =>
      value({ anyOf: [{ type: "integer", minimum: 5, maximum: 1 }, { type: "string" }] }),
    ).toThrow(expect.objectContaining({ code: "INVALID_SCHEMA_CONSTRAINT" }));
  });

  it("$ref 와 anyOf 가 함께 있으면 $ref 를 먼저 푼다", () => {
    expect(
      value({
        $ref: "#/$defs/Base",
        anyOf: [{ required: ["x"] }],
        $defs: { Base: { type: "object", properties: { x: { type: "string" } } } },
      }),
    ).toEqual({ x: "example" });
  });

  it("갈래 안의 anyOf 도 푼다", () => {
    expect(
      value({
        anyOf: [{ anyOf: [{ type: "string" }, { type: "number" }] }, { type: "boolean" }],
      }),
    ).toBe("example");
  });
});

describe("순환 $ref 의 후보 검사", () => {
  /** 값을 소비하지 않고 자기를 가리키는 정의. 재방문 가드가 없으면 스택이 터진다. */
  const selfRef = { $defs: { A: { $ref: "#/$defs/A" } } };

  it("oneOf 의 순환 갈래는 만족하지 않는 것으로 센다", () => {
    // 순환 갈래가 true 로 세어지면 만족 갈래가 2개가 되어 배타 판정이 깨지고 문안 8 로 던진다.
    // 즉 이 단언은 가드가 실제로 false 를 돌려주는지를 가른다.
    expect(
      value({
        type: "object",
        required: ["v"],
        properties: { v: { oneOf: [{ type: "string" }, { $ref: "#/$defs/A" }] } },
        ...selfRef,
      }),
    ).toEqual({ v: "example" });
  });

  it("갈래가 순환뿐이면 hang 없이 UNSUPPORTED_SCHEMA 다", () => {
    expect(() => value({ anyOf: [{ $ref: "#/$defs/A" }], ...selfRef })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });
});

describe("additionalProperties 가 스키마 객체일 때 후보 검사", () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
    additionalProperties: { type: "number" },
  };

  it("선언 밖 키가 그 스키마를 어기면 후보 불만족이다", () => {
    expect(() => value({ ...schema, default: { a: "x", b: "문자열" } })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("선언 밖 키가 그 스키마를 만족하면 default 를 그대로 쓴다", () => {
    expect(value({ ...schema, default: { a: "x", b: 1 } })).toEqual({ a: "x", b: 1 });
  });
});

describe("propertyNames 합성과 후보 검사", () => {
  const map = {
    type: "object",
    propertyNames: { type: "string", pattern: "^[a-z]+$" },
    additionalProperties: { type: "number" },
  };

  it("임의 키 맵은 빈 객체다", () => {
    // 필수 키가 없다. 키 이름을 우리가 지어내지 않으므로 만들 것이 없는 것이 맞다(ADR-0087).
    expect(value(map)).toEqual({});
  });

  it("required 가 있으면 그 키만 만든다", () => {
    expect(
      value({ ...map, required: ["known"], properties: { known: { type: "number" } } }),
    ).toEqual({ known: 0 });
  });

  it("default 의 선언 밖 키 이름이 propertyNames 를 어기면 후보 불만족이다", () => {
    expect(() => value({ ...map, default: { BAD: 1 } })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("default 의 선언 밖 키 이름이 propertyNames 를 만족하면 그 default 를 쓴다", () => {
    expect(value({ ...map, default: { ok: 1 } })).toEqual({ ok: 1 });
  });

  it("키는 propertyNames 로 값은 additionalProperties 로 본다", () => {
    // 키 이름은 통과하고 값이 숫자가 아니라 떨어지는 경우.
    expect(() => value({ ...map, default: { ok: "문자열" } })).toThrow(
      expect.objectContaining({ code: "UNSUPPORTED_SCHEMA" }),
    );
  });

  it("선언된 키에는 propertyNames 를 적용하지 않는다", () => {
    // 'BAD' 는 propertyNames 의 pattern 을 어기지만 properties 에 선언돼 있다. 우리가 거절하면
    // 사용자가 자기 properties 를 못 쓴다(ADR-0087).
    expect(value({ ...map, required: ["BAD"], properties: { BAD: { type: "number" } } })).toEqual({
      BAD: 0,
    });
  });
});
