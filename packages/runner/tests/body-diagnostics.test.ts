import { describe, expect, it } from "vitest";
import {
  bodyExtractionFailedDiagnostic,
  bodySchemaMismatchDiagnostic,
  MAX_OBSERVED_KEYS,
  MAX_VALUE_STRING_CHARS,
  type RunnerRedactionOptions,
  type SchemaViolation,
  type SchemaViolationDiagnostic,
  structuredContentSchemaMismatchDiagnostic,
} from "../src/index.js";

/** 설계 §3.1 문안. 완전 일치로 고정한다. */
const STRUCTURE_HINT =
  "응답의 형식이 기대와 다릅니다. 서버의 응답 형식 변경이 의도된 것이라면 테스트의 기대 스키마를 업데이트하세요.";
const VALUE_HINT =
  "응답 형식은 같고 값만 다릅니다. 서버가 돌려준 값이 맞다면 테스트의 기대값을 고치고, 아니라면 서버 로직을 확인하세요. 값이 실행마다 바뀐다면 --determinism 으로 확인하세요.";
const TRUNCATED_HINT = "표시된 위반을 고친 뒤 나머지를 다시 확인하세요.";
const STRUCTURED_STRUCTURE_HINT =
  "서버의 outputSchema 또는 structuredContent 변경이 의도된 것인지 확인하세요.";

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
    expect(diagnostic.hint).toBe(STRUCTURE_HINT);
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

/** 설계 §3.1. hint 를 위반 부류로 가른다. */
describe("위반 부류별 해결 문구", () => {
  const constMismatch: SchemaViolation = {
    code: "CONST_MISMATCH",
    path: "$.temp",
    expected: 25,
    actual: 21,
  };

  it("구조 위반이 하나라도 있으면 형식 변경 문구를 낸다", () => {
    const diagnostic = bodySchemaMismatchDiagnostic({
      violations: [
        {
          code: "REQUIRED_MISSING",
          path: "$",
          expected: "temperature",
          actual: null,
          observedKeys: ["temp"],
        },
        constMismatch,
      ],
      totalViolations: 2,
    });
    expect(diagnostic.hint).toBe(STRUCTURE_HINT);
  });

  it("값 위반만 있으면 기대값을 고치라는 문구를 낸다", () => {
    expect(one(constMismatch).hint).toBe(VALUE_HINT);
  });

  it("범위·길이 위반도 값 부류로 본다", () => {
    const diagnostic = bodySchemaMismatchDiagnostic({
      violations: [
        { code: "MAXIMUM", path: "$.temp", expected: 60, actual: 210 },
        { code: "MIN_LENGTH", path: "$.city", expected: 1, actual: 0 },
      ],
      totalViolations: 2,
    });
    expect(diagnostic.hint).toBe(VALUE_HINT);
  });

  it("잘린 결과는 기존 문구를 유지한다", () => {
    const diagnostic = bodySchemaMismatchDiagnostic({
      violations: [constMismatch],
      totalViolations: 11,
    });
    expect(diagnostic.hint).toBe(TRUNCATED_HINT);
  });

  it("구조화 응답은 구조 위반에 출력 계약 문구를 유지한다", () => {
    const diagnostic = structuredContentSchemaMismatchDiagnostic(
      {
        violations: [{ code: "TYPE_MISMATCH", path: "$.temp", expected: "number", actual: "21" }],
        totalViolations: 1,
      },
      { type: "object" },
      { temp: "21" },
    );
    expect(diagnostic.hint).toBe(STRUCTURED_STRUCTURE_HINT);
  });

  it("구조화 응답도 값 위반만 있으면 값 문구를 낸다", () => {
    const diagnostic = structuredContentSchemaMismatchDiagnostic(
      { violations: [constMismatch], totalViolations: 1 },
      { type: "object" },
      { temp: 21 },
    );
    expect(diagnostic.hint).toBe(VALUE_HINT);
  });
});

/** 설계 §3.5. 값 불일치가 여럿이면 기대와 실제를 나란히 놓는다. */
describe("값 불일치 diff", () => {
  const WEATHER = { city: "서울", condition: "흐림", temp: 21 };
  const weatherViolations: SchemaViolation[] = [
    { code: "CONST_MISMATCH", path: "$.condition", expected: "맑음", actual: "흐림" },
    { code: "CONST_MISMATCH", path: "$.temp", expected: 25, actual: 21 },
  ];
  const diffOf = (
    violations: SchemaViolation[],
    body: unknown,
    options?: RunnerRedactionOptions,
    totalViolations = violations.length,
  ) =>
    bodySchemaMismatchDiagnostic(
      { violations, totalViolations },
      options,
      body as Parameters<typeof bodySchemaMismatchDiagnostic>[2],
    );

  it("값 불일치가 1건이면 diff 를 만들지 않는다", () => {
    const diagnostic = diffOf([weatherViolations[1] as SchemaViolation], WEATHER);
    expect("diff" in diagnostic).toBe(false);
  });

  it("값 불일치가 2건 이상이면 diff 를 만든다", () => {
    expect(diffOf(weatherViolations, WEATHER).diff).toEqual([
      "  {",
      '    "city": "서울",',
      '-   "condition": "맑음",',
      '+   "condition": "흐림",',
      '-   "temp": 25',
      '+   "temp": 21',
      "  }",
    ]);
  });

  it("위반이 아닌 필드가 길어 diff 가 8KiB 를 넘으면 만들지 않는다", () => {
    // 한글은 UTF-8 로 3바이트다. 3000자는 글자 수로는 8192 미만이고 바이트로는 9000을 넘는다.
    // 글자 수로 세면 이 diff 가 통과해 버린다.
    const body = { ...WEATHER, note: "가".repeat(3000) };
    expect("diff" in diffOf(weatherViolations, body)).toBe(false);
  });

  it("위반이 아닌 필드가 있어도 8KiB 이하면 diff 를 만든다", () => {
    const body = { ...WEATHER, note: "가".repeat(2000) };
    expect(diffOf(weatherViolations, body).diff).toContain(`    "note": "${"가".repeat(2000)}",`);
  });

  it("본문을 넘기지 않으면 diff 를 만들지 않는다", () => {
    expect("diff" in diffOf(weatherViolations, undefined)).toBe(false);
  });

  it("잘린 결과는 diff 를 만들지 않는다", () => {
    expect("diff" in diffOf(weatherViolations, WEATHER, undefined, 11)).toBe(false);
  });

  it("배열 안의 값 불일치도 인덱스로 짚는다", () => {
    const diagnostic = diffOf(
      [
        { code: "CONST_MISMATCH", path: "$.items[1].t", expected: 20, actual: 2 },
        { code: "CONST_MISMATCH", path: "$.items[0].t", expected: 10, actual: 1 },
      ],
      { items: [{ t: 1 }, { t: 2 }] },
    );
    expect(diagnostic.diff).toEqual([
      "  {",
      '    "items": [',
      "      {",
      '-       "t": 10',
      '+       "t": 1',
      "      },",
      "      {",
      '-       "t": 20',
      '+       "t": 2',
      "      }",
      "    ]",
      "  }",
    ]);
  });

  it("경로를 풀 수 없으면 diff 를 만들지 않는다", () => {
    const diagnostic = diffOf(
      [
        { code: "CONST_MISMATCH", path: "$.a.b", expected: 5, actual: 1 },
        { code: "CONST_MISMATCH", path: "$.c", expected: 3, actual: 2 },
      ],
      { "a.b": 1, c: 2 },
    );
    expect("diff" in diagnostic).toBe(false);
  });

  it("다른 위반이 섞이면 diff 를 만들지 않는다", () => {
    const diagnostic = diffOf(
      [
        ...weatherViolations,
        { code: "TYPE_MISMATCH", path: "$.city", expected: "number", actual: "서울" },
      ],
      WEATHER,
    );
    expect("diff" in diagnostic).toBe(false);
  });

  it("기대값이 스칼라가 아니면 diff 를 만들지 않는다", () => {
    const diagnostic = diffOf(
      [
        weatherViolations[0] as SchemaViolation,
        { code: "CONST_MISMATCH", path: "$.temp", expected: { value: 25 }, actual: 21 },
      ],
      WEATHER,
    );
    expect("diff" in diagnostic).toBe(false);
  });

  it("diff 는 서버의 키 순서와 무관하다", () => {
    const reordered = { temp: 21, condition: "흐림", city: "서울" };
    expect(diffOf(weatherViolations, reordered).diff).toEqual(
      diffOf(weatherViolations, WEATHER).diff,
    );
  });

  it("가림 대상 경로에 위반이 있으면 diff 를 만들지 않는다", () => {
    const diagnostic = diffOf(
      [
        { code: "CONST_MISMATCH", path: "$.token", expected: "sk-expected", actual: "sk-actual" },
        weatherViolations[1] as SchemaViolation,
      ],
      { ...WEATHER, token: "sk-actual" },
    );
    expect("diff" in diagnostic).toBe(false);
  });

  it("diff 의 다른 줄에 있는 민감값도 가린다", () => {
    const diff = diffOf(weatherViolations, { ...WEATHER, token: "sk-live-123" }).diff;
    expect(diff).toBeDefined();
    expect(diff?.join("\n")).not.toContain("sk-live-123");
    expect(diff).toContain('    "token": "[REDACTED]"');
  });
});
