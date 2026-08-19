import { describe, expect, it } from "vitest";
import { findSchemaViolations, unanalyzableReason } from "../src/input-validation.js";

/** 검사 대상 스키마를 짧게 만든다. 테스트마다 필요한 것만 넣는다. */
const schema = (properties: Record<string, unknown>, required: string[] = []): unknown => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
});

describe("findSchemaViolations — required", () => {
  it("required 필드가 없으면 잡는다", () => {
    expect(findSchemaViolations(schema({ city: { type: "string" } }, ["city"]), {})).toEqual([
      { kind: "requiredMissing", field: "city" },
    ]);
  });

  it("required 필드가 있으면 잡지 않는다", () => {
    expect(
      findSchemaViolations(schema({ city: { type: "string" } }, ["city"]), { city: "서울" }),
    ).toEqual([]);
  });

  it("값이 null 이어도 키가 있으면 누락이 아니다", () => {
    // JSON Schema 의 required 는 키의 존재만 본다. null 은 값이 있는 것이다.
    const found = findSchemaViolations(schema({ city: {} }, ["city"]), { city: null });
    expect(found).toEqual([]);
  });
});

describe("findSchemaViolations — type", () => {
  const cases: ReadonlyArray<[string, unknown, unknown, boolean]> = [
    ["string", "서울", 0, true],
    ["number", 1.5, "example", true],
    ["integer", 3, 1.5, true],
    ["boolean", true, "example", true],
    ["object", { a: 1 }, "example", true],
    ["array", [1], "example", true],
    ["null", null, "example", true],
  ];

  for (const [declared, ok, bad] of cases) {
    it(`${declared} — 지킨 값은 통과하고 어긴 값은 잡는다`, () => {
      expect(findSchemaViolations(schema({ f: { type: declared } }), { f: ok })).toEqual([]);
      expect(findSchemaViolations(schema({ f: { type: declared } }), { f: bad })).toHaveLength(1);
      expect(findSchemaViolations(schema({ f: { type: declared } }), { f: bad })[0]).toMatchObject({
        kind: "typeMismatch",
        field: "f",
        declared,
      });
    });
  }

  it("integer 에 정수는 통과하고 소수는 잡는다", () => {
    expect(findSchemaViolations(schema({ n: { type: "integer" } }), { n: 3 })).toEqual([]);
    expect(findSchemaViolations(schema({ n: { type: "integer" } }), { n: 1.5 })).toEqual([
      { kind: "typeMismatch", field: "n", declared: "integer", found: "number" },
    ]);
  });

  it("모르는 type 은 침묵한다", () => {
    expect(findSchemaViolations(schema({ f: { type: "그런거없음" } }), { f: 1 })).toEqual([]);
  });
});

describe("findSchemaViolations — enum", () => {
  it("enum 밖 값을 잡는다", () => {
    expect(
      findSchemaViolations(schema({ unit: { type: "string", enum: ["c", "f"] } }), { unit: "k" }),
    ).toEqual([{ kind: "enumMismatch", field: "unit", allowed: ["c", "f"], found: "k" }]);
  });

  it("enum 안 값은 통과한다", () => {
    expect(
      findSchemaViolations(schema({ unit: { type: "string", enum: ["c", "f"] } }), { unit: "c" }),
    ).toEqual([]);
  });

  it("enum 에 객체가 섞이면 검사하지 않는다", () => {
    // 동등 비교 규칙을 정해야 하는데 여기서 정하면 오탐이 난다. 침묵이 낫다 (ADR-0048).
    expect(findSchemaViolations(schema({ f: { enum: [{ a: 1 }, "x"] } }), { f: "y" })).toEqual([]);
  });
});

describe("findSchemaViolations — range", () => {
  const at = (keyword: string, limit: number, found: number) => [
    { kind: "rangeMismatch", field: "f", keyword, limit, found },
  ];

  it("minimum · maximum", () => {
    expect(findSchemaViolations(schema({ f: { minimum: 1 } }), { f: 0 })).toEqual(
      at("minimum", 1, 0),
    );
    expect(findSchemaViolations(schema({ f: { maximum: 7 } }), { f: 99 })).toEqual(
      at("maximum", 7, 99),
    );
    expect(findSchemaViolations(schema({ f: { minimum: 1, maximum: 7 } }), { f: 3 })).toEqual([]);
  });

  it("exclusiveMinimum · exclusiveMaximum — 경계값 자체가 위반이다", () => {
    expect(findSchemaViolations(schema({ f: { exclusiveMinimum: 0 } }), { f: 0 })).toEqual(
      at("exclusiveMinimum", 0, 0),
    );
    expect(findSchemaViolations(schema({ f: { exclusiveMaximum: 10 } }), { f: 10 })).toEqual(
      at("exclusiveMaximum", 10, 10),
    );
    expect(findSchemaViolations(schema({ f: { exclusiveMinimum: 0 } }), { f: 1 })).toEqual([]);
  });

  it("minLength · maxLength — found 는 실제 길이다", () => {
    expect(findSchemaViolations(schema({ f: { minLength: 3 } }), { f: "ab" })).toEqual(
      at("minLength", 3, 2),
    );
    expect(findSchemaViolations(schema({ f: { maxLength: 3 } }), { f: "abcd" })).toEqual(
      at("maxLength", 3, 4),
    );
  });

  it("minItems · maxItems — found 는 실제 개수다", () => {
    expect(findSchemaViolations(schema({ f: { minItems: 2 } }), { f: [1] })).toEqual(
      at("minItems", 2, 1),
    );
    expect(findSchemaViolations(schema({ f: { maxItems: 2 } }), { f: [1, 2, 3] })).toEqual(
      at("maxItems", 2, 3),
    );
  });

  it("길이는 UTF-16 단위가 아니라 코드 포인트로 센다", () => {
    // "😀" 는 String.length 로 2 다. maxLength: 1 을 어겼다고 하면 정상 값을 거절하는 오탐이다.
    // JSON Schema 의 length 는 코드 포인트 수다.
    expect(findSchemaViolations(schema({ f: { maxLength: 1 } }), { f: "😀" })).toEqual([]);
    expect(findSchemaViolations(schema({ f: { minLength: 2 } }), { f: "😀" })).toEqual([
      { kind: "rangeMismatch", field: "f", keyword: "minLength", limit: 2, found: 1 },
    ]);
  });

  it("길이 제약은 그 타입의 값에만 적용한다", () => {
    // minLength 가 걸린 필드에 배열이 오면 길이 검사를 하지 않는다. 타입 축이 볼 일이다.
    expect(findSchemaViolations(schema({ f: { minLength: 3 } }), { f: [1] })).toEqual([]);
  });
});

describe("findSchemaViolations — 순서와 개수 (ADR-0048 §5)", () => {
  it("한 필드에 타입과 범위가 동시에 어긋나면 타입 1건만 낸다", () => {
    const found = findSchemaViolations(schema({ n: { type: "integer", minimum: 10 } }), { n: "x" });
    expect(found).toEqual([
      { kind: "typeMismatch", field: "n", declared: "integer", found: "string" },
    ]);
  });

  it("한 필드에 enum 과 범위가 동시에 어긋나면 enum 1건만 낸다", () => {
    const found = findSchemaViolations(
      schema({ n: { type: "integer", enum: [10, 20], minimum: 100 } }),
      { n: 5 },
    );
    expect(found).toEqual([{ kind: "enumMismatch", field: "n", allowed: [10, 20], found: 5 }]);
  });

  it("required 누락이 전부 먼저 나오고, 그다음 properties 선언 순서다", () => {
    const s = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "string" },
        c: { type: "string" },
      },
      required: ["c", "a"],
    };
    const found = findSchemaViolations(s, { b: 1 });
    expect(found).toEqual([
      { kind: "requiredMissing", field: "c" },
      { kind: "requiredMissing", field: "a" },
      { kind: "typeMismatch", field: "b", declared: "string", found: "number" },
    ]);
  });
});

describe("findSchemaViolations — 해석할 수 없는 스키마 (ADR-0048 §4)", () => {
  for (const keyword of ["anyOf", "oneOf", "allOf", "not", "$ref", "if"]) {
    it(`루트에 ${keyword} 가 있으면 그 툴 전체를 검사하지 않는다`, () => {
      const s = { type: "object", properties: { f: { type: "string" } }, [keyword]: [] };
      expect(findSchemaViolations(s, { f: 0 })).toEqual([]);
      expect(unanalyzableReason(s)).toContain(keyword);
    });
  }

  it("루트 type 이 object 가 아니면 검사하지 않는다", () => {
    expect(findSchemaViolations({ type: "string" }, { f: 0 })).toEqual([]);
    expect(unanalyzableReason({ type: "string" })).toBeDefined();
  });

  it("루트 type 이 배열이면 검사하지 않는다", () => {
    expect(unanalyzableReason({ type: ["object", "null"] })).toBeDefined();
  });

  it("필드에 anyOf 가 있으면 그 필드만 건너뛰고 나머지는 검사한다", () => {
    const s = schema({ a: { anyOf: [{ type: "string" }] }, b: { type: "string" } }, ["c"]);
    expect(findSchemaViolations(s, { a: 0, b: 1 })).toEqual([
      { kind: "requiredMissing", field: "c" },
      { kind: "typeMismatch", field: "b", declared: "string", found: "number" },
    ]);
  });

  it("필드 type 이 배열이면 그 필드를 검사하지 않는다", () => {
    // 루트 type 배열과 같은 규칙이다 — 어느 쪽으로 읽어야 할지 정보가 없다. 타입 축만 빼고
    // enum·range 를 계속 보면 그 필드가 반쯤 검사된 상태로 남아 규칙이 갈린다.
    expect(findSchemaViolations(schema({ f: { type: ["string", "null"] } }), { f: 0 })).toEqual([]);
    expect(
      findSchemaViolations(schema({ f: { type: ["string", "null"], minimum: 10 } }), { f: 0 }),
    ).toEqual([]);
  });

  it("해석 가능한 스키마는 unanalyzableReason 이 undefined 다", () => {
    expect(unanalyzableReason(schema({ f: { type: "string" } }, ["f"]))).toBeUndefined();
  });

  it("type 이 없어도 properties 가 있으면 검사한다", () => {
    // JSON Schema 에서 type 생략은 흔하다. 이것까지 포기하면 미탐이 지나치게 넓어진다.
    expect(findSchemaViolations({ properties: { f: { type: "string" } } }, { f: 0 })).toHaveLength(
      1,
    );
  });
});

describe("findSchemaViolations — 검사하지 않는 것", () => {
  it("properties 에 없는 필드는 보지 않는다 (additionalProperties 를 읽지 않는다)", () => {
    const s = { ...(schema({ a: { type: "string" } }) as object), additionalProperties: false };
    expect(findSchemaViolations(s, { a: "x", b: 1 })).toEqual([]);
  });

  it("중첩 객체 내부는 보지 않는다", () => {
    const s = schema({ o: { type: "object", properties: { inner: { type: "string" } } } });
    expect(findSchemaViolations(s, { o: { inner: 0 } })).toEqual([]);
  });

  it("배열 원소 내부는 보지 않는다", () => {
    const s = schema({ xs: { type: "array", items: { type: "string" } } });
    expect(findSchemaViolations(s, { xs: [0, 1] })).toEqual([]);
  });

  it("인자가 없으면 required 만 본다", () => {
    expect(findSchemaViolations(schema({ a: { type: "string" } }, ["a"]), undefined)).toEqual([
      { kind: "requiredMissing", field: "a" },
    ]);
  });
});
