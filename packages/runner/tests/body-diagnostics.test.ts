import { describe, expect, it } from "vitest";
import {
  bodyExtractionFailedDiagnostic,
  bodySchemaMismatchDiagnostic,
  MAX_OBSERVED_KEYS,
  MAX_VALUE_STRING_CHARS,
  type RunnerRedactionOptions,
  type SchemaViolation,
  type SchemaViolationDiagnostic,
} from "../src/index.js";

/** 위반 하나만 담은 진단을 만든다. */
const one = (violation: SchemaViolation, options?: RunnerRedactionOptions) =>
  bodySchemaMismatchDiagnostic({ violations: [violation], totalViolations: 1 }, options);

/** 위반 하나만 담은 진단에서 그 위반을 꺼낸다. */
const first = (violation: SchemaViolation, options?: RunnerRedactionOptions) => {
  const entry = one(violation, options).violations?.[0];
  if (entry === undefined) throw new Error("위반 진단 하나를 기대했습니다.");
  return entry as SchemaViolationDiagnostic;
};

const messageOf = (violation: SchemaViolation, options?: RunnerRedactionOptions) =>
  first(violation, options).message;

describe("위반 문장", () => {
  it("TYPE_MISMATCH 문장을 만든다", () => {
    expect(
      messageOf({ code: "TYPE_MISMATCH", path: "$.temp", expected: "number", actual: "21" }),
    ).toBe('$.temp: 타입이 다릅니다. 기대: number, 실제: string ("21")');
  });

  it("CONST_MISMATCH 문장을 만든다", () => {
    expect(
      messageOf({ code: "CONST_MISMATCH", path: "$.city", expected: "서울", actual: "Seoul" }),
    ).toBe('$.city: 값이 다릅니다. 기대: "서울", 실제: "Seoul"');
  });

  it("ENUM_MISMATCH 문장을 만든다", () => {
    expect(
      messageOf({
        code: "ENUM_MISMATCH",
        path: "$.condition",
        expected: ["맑음", "흐림", "비"],
        actual: "맑음 후 비",
      }),
    ).toContain('"맑음" | "흐림" | "비"');
  });

  it("REQUIRED_MISSING 문장을 만든다", () => {
    expect(
      messageOf({
        code: "REQUIRED_MISSING",
        path: "$",
        expected: "temp",
        actual: null,
        observedKeys: ["city", "condition", "temperature"],
      }),
    ).toBe("$.temp: 필수 필드가 없습니다. 발견된 필드: 'city', 'condition', 'temperature'");
  });

  it("ADDITIONAL_PROPERTY 문장을 만든다", () => {
    expect(
      messageOf({
        code: "ADDITIONAL_PROPERTY",
        path: "$.temperature",
        expected: null,
        actual: 21,
      }),
    ).toBe("$.temperature: 스키마에 없는 필드입니다.");
  });

  it("MIN_ITEMS 문장을 만든다", () => {
    expect(messageOf({ code: "MIN_ITEMS", path: "$.hourly", expected: 24, actual: 3 })).toBe(
      "$.hourly: 배열 원소가 부족합니다. 기대: 24개 이상, 실제: 3개",
    );
  });

  it("MIN_LENGTH 문장을 만든다", () => {
    expect(messageOf({ code: "MIN_LENGTH", path: "$.city", expected: 1, actual: 0 })).toContain(
      "기대: 1자 이상, 실제: 0자",
    );
  });

  it("MAX_LENGTH 문장을 만든다", () => {
    expect(
      messageOf({ code: "MAX_LENGTH", path: "$.summary", expected: 200, actual: 812 }),
    ).toContain("기대: 200자 이하, 실제: 812자");
  });

  it("STRING_CONTAINS 문장을 만든다", () => {
    expect(
      messageOf({
        code: "STRING_CONTAINS",
        path: "$",
        expected: "사용 가능한 도시",
        actual: "→ 'city' 는 문자열이어야 합니다.",
      }),
    ).toContain('기대: "사용 가능한 도시" 포함');
  });

  it("MINIMUM 문장을 만든다", () => {
    expect(messageOf({ code: "MINIMUM", path: "$.temp", expected: -90, actual: -273 })).toContain(
      "기대: -90 이상, 실제: -273",
    );
  });

  it("MAXIMUM 문장을 만든다", () => {
    expect(messageOf({ code: "MAXIMUM", path: "$.temp", expected: 60, actual: 210 })).toContain(
      "기대: 60 이하, 실제: 210",
    );
  });
});

describe("요약 문장", () => {
  const violation = (index: number): SchemaViolation => ({
    code: "TYPE_MISMATCH",
    path: `$[${index}]`,
    expected: "number",
    actual: "x",
  });

  it("상한 이하 요약 문장을 만든다", () => {
    const diagnostic = bodySchemaMismatchDiagnostic({
      violations: [violation(0), violation(1), violation(2)],
      totalViolations: 3,
    });
    expect(diagnostic.code).toBe("BODY_SCHEMA_MISMATCH");
    expect(diagnostic.message).toBe("응답이 기대 스키마와 다릅니다. 위반 3건.");
    expect(diagnostic.hint).toBe("스키마 변경이 의도된 것이라면 테스트를 업데이트하세요.");
    expect(diagnostic.totalViolations).toBe(3);
  });

  it("상한 초과 요약 문장을 만든다", () => {
    const diagnostic = bodySchemaMismatchDiagnostic({
      violations: Array.from({ length: 10 }, (_, index) => violation(index)),
      totalViolations: 20,
    });
    expect(diagnostic.message).toBe(
      "응답이 기대 스키마와 다릅니다. 위반 20건 중 10건을 표시합니다.",
    );
    expect(diagnostic.hint).toBe("표시된 위반을 고친 뒤 나머지를 다시 확인하세요.");
  });
});

describe("추출 실패 문장", () => {
  it("CONTENT_NOT_ARRAY 문장을 만든다", () => {
    const diagnostic = bodyExtractionFailedDiagnostic({
      code: "CONTENT_NOT_ARRAY",
      actual: "object",
    });
    expect(diagnostic.code).toBe("BODY_EXTRACTION_FAILED");
    expect(diagnostic.message).toContain("실제 타입: object");
    expect(diagnostic.hint).toBe("bodyMatchesSchema는 text 블록 1개짜리 응답에만 쓸 수 있습니다.");
  });

  it("CONTENT_BLOCK_COUNT 문장을 만든다", () => {
    const diagnostic = bodyExtractionFailedDiagnostic({ code: "CONTENT_BLOCK_COUNT", actual: 2 });
    expect(diagnostic.message).toContain("content 블록이 2개입니다");
    expect(diagnostic.hint).toBe("서버 응답 구조를 확인하거나 이 단언을 제거하세요.");
  });

  it("CONTENT_BLOCK_NOT_TEXT 문장을 만든다", () => {
    const diagnostic = bodyExtractionFailedDiagnostic({
      code: "CONTENT_BLOCK_NOT_TEXT",
      actual: "image",
    });
    expect(diagnostic.message).toContain("실제 type: image");
    expect(diagnostic.hint).toBe("bodyMatchesSchema는 text 블록에만 쓸 수 있습니다.");
  });
});

describe("값 요약과 상한", () => {
  it("812자 문자열을 200자로 자르고 원본 길이를 남긴다", () => {
    const entry = first({
      code: "CONST_MISMATCH",
      path: "$.summary",
      expected: "짧은 값",
      actual: "가".repeat(812),
    });
    expect(Array.from(entry.actual as string)).toHaveLength(MAX_VALUE_STRING_CHARS);
    expect(entry.actualChars).toBe(812);
  });

  it("서로게이트 페어를 쪼개지 않는다", () => {
    const entry = first({
      code: "CONST_MISMATCH",
      path: "$.summary",
      expected: "짧은 값",
      actual: `${"가".repeat(MAX_VALUE_STRING_CHARS - 1)}🌞뒤`,
    });
    const points = Array.from(entry.actual as string);
    expect(points).toHaveLength(MAX_VALUE_STRING_CHARS);
    expect(points.at(-1)).toBe("🌞");
    // 짝을 잃은 서로게이트가 남지 않았는지 본다.
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(entry.actual as string)).toBe(false);
  });

  it("키 50개 객체의 observedKeys를 20개로 자른다", () => {
    const keys = Array.from({ length: 50 }, (_, index) => `key${String(index).padStart(2, "0")}`);
    const entry = first({
      code: "REQUIRED_MISSING",
      path: "$",
      expected: "temp",
      actual: null,
      observedKeys: keys,
    });
    expect(entry.observedKeys).toHaveLength(MAX_OBSERVED_KEYS);
    expect(entry.observedKeysTotal).toBe(50);
    expect(entry.message).toContain("외 30개");
  });

  it("큰 객체를 요약값으로 바꾼다", () => {
    const entry = first({
      code: "TYPE_MISMATCH",
      path: "$",
      expected: "array",
      actual: { city: "서울", temp: 21, condition: "맑음" },
    });
    expect(entry.actual).toEqual({ kind: "object", keys: 3 });
    expect(entry.message).toContain("실제: object (키 3개)");
  });

  it("큰 배열을 요약값으로 바꾼다", () => {
    const entry = first({
      code: "TYPE_MISMATCH",
      path: "$",
      expected: "object",
      actual: Array.from({ length: 1000 }, () => 0),
    });
    expect(entry.actual).toEqual({ kind: "array", items: 1000 });
    expect(entry.message).toContain("실제: array (원소 1000개)");
  });

  it("민감값을 자르기 전에 REDACTED로 바꾼다", () => {
    const secret = "s".repeat(300);
    const entry = first(
      { code: "CONST_MISMATCH", path: "$.value", expected: "기대값", actual: secret },
      { sensitiveValues: [secret] },
    );
    expect(entry.actual).toBe("[REDACTED]");
    expect(entry.actualChars).toBeUndefined();
  });

  it("민감 키를 REDACTED로 바꾼다", () => {
    const entry = first({
      code: "TYPE_MISMATCH",
      path: "$.token",
      expected: "number",
      actual: "abcdef",
    });
    expect(entry.actual).toBe("[REDACTED]");
  });

  it("expected는 sanitize하지 않는다", () => {
    const entry = first(
      { code: "CONST_MISMATCH", path: "$.city", expected: "서울", actual: "Seoul" },
      { sensitiveValues: ["서울"] },
    );
    expect(entry.expected).toBe("서울");
  });

  it("같은 위반 목록을 두 번 넣으면 문장 바이트가 같다", () => {
    const violations: SchemaViolation[] = [
      { code: "TYPE_MISMATCH", path: "$.temp", expected: "number", actual: "21" },
      {
        code: "REQUIRED_MISSING",
        path: "$",
        expected: "city",
        actual: null,
        observedKeys: ["condition", "temperature"],
      },
    ];
    const left = bodySchemaMismatchDiagnostic({ violations, totalViolations: 2 });
    const right = bodySchemaMismatchDiagnostic({ violations, totalViolations: 2 });
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
  });
});
