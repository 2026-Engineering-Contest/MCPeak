import { describe, expect, it } from "vitest";
import type { SpecFinding } from "../src/index.js";
import { describeSpecFinding, MAX_FINDINGS_PER_CASE } from "../src/index.js";

/** 문장 검사에 필요한 필드만 넘기고 나머지는 기본값을 쓴다. */
const finding = (over: Partial<SpecFinding> & Pick<SpecFinding, "code">): SpecFinding => ({
  severity: "blocking",
  caseId: "weather-ok",
  path: "input.city",
  ...over,
});

describe("describeSpecFinding 문안 (설계 문서 §7)", () => {
  it("TOOL_NOT_DECLARED", () => {
    expect(describeSpecFinding(finding({ code: "TOOL_NOT_DECLARED", actual: "get_wether" }))).toBe(
      "서버가 선언하지 않은 툴입니다: 'get_wether'",
    );
  });

  it("TOOL_NOT_DECLARED, suggestion 있음", () => {
    expect(
      describeSpecFinding(
        finding({ code: "TOOL_NOT_DECLARED", actual: "get_wether", suggestion: "get_weather" }),
      ),
    ).toBe("서버가 선언하지 않은 툴입니다: 'get_wether'. 비슷한 툴: 'get_weather'");
  });

  it("REQUIRED_MISSING", () => {
    expect(describeSpecFinding(finding({ code: "REQUIRED_MISSING", expected: "city" }))).toBe(
      "필수 필드 'city' 가 입력에 없습니다",
    );
  });

  it("REQUIRED_MISSING, suggestion 있음", () => {
    expect(
      describeSpecFinding(
        finding({ code: "REQUIRED_MISSING", expected: "city", suggestion: "citi" }),
      ),
    ).toBe("필수 필드 'city' 가 입력에 없습니다. 비슷한 필드: 'citi'");
  });

  it("UNDECLARED_FIELD", () => {
    expect(describeSpecFinding(finding({ code: "UNDECLARED_FIELD", actual: "citi" }))).toBe(
      "'citi' 는 서버가 선언하지 않은 필드입니다",
    );
  });

  it("UNDECLARED_FIELD, suggestion 있음", () => {
    expect(
      describeSpecFinding(
        finding({ code: "UNDECLARED_FIELD", actual: "citi", suggestion: "city" }),
      ),
    ).toBe("'citi' 는 서버가 선언하지 않은 필드입니다. 비슷한 필드: 'city'");
  });

  it("TYPE_MISMATCH", () => {
    expect(
      describeSpecFinding(finding({ code: "TYPE_MISMATCH", expected: "string", actual: "number" })),
    ).toBe("input.city 의 타입이 다릅니다. 선언: 'string', 명세: 'number'");
  });

  it("ENUM_MISMATCH", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "ENUM_MISMATCH",
          path: "input.units",
          expected: ["c", "f"],
          actual: "celsius",
        }),
      ),
    ).toBe('input.units 값 \'celsius\' 는 선언된 값이 아닙니다. 허용: ["c","f"]');
  });

  it("ENUM_MISMATCH, suggestion 있음", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "ENUM_MISMATCH",
          path: "input.units",
          expected: ["c", "f"],
          actual: "celsius",
          suggestion: "c",
        }),
      ),
    ).toBe("input.units 값 'celsius' 는 선언된 값이 아닙니다. 허용: [\"c\",\"f\"]. 비슷한 값: 'c'");
  });

  it("SCHEMA_NOT_ANALYZABLE", () => {
    expect(
      describeSpecFinding(
        finding({ code: "SCHEMA_NOT_ANALYZABLE", severity: "advisory", actual: "get_weather" }),
      ),
    ).toBe("'get_weather' 의 입력 스키마를 해석하지 못해 이 툴의 입력 검사를 건너뜁니다");
  });

  it("UNCONSTRAINED_SCHEMA", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "UNCONSTRAINED_SCHEMA",
          severity: "advisory",
          path: "assertions[0].schema",
        }),
      ),
    ).toBe("assertions[0].schema 스키마에 제약이 없어 어떤 응답이든 통과합니다");
  });

  it("VACUOUS_MIN_LENGTH", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "VACUOUS_MIN_LENGTH",
          severity: "advisory",
          path: "assertions[0].schema.minLength",
        }),
      ),
    ).toBe("assertions[0].schema.minLength 는 0이라 모든 문자열이 통과합니다");
  });

  it("VACUOUS_MIN_ITEMS", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "VACUOUS_MIN_ITEMS",
          severity: "advisory",
          path: "assertions[0].schema.minItems",
        }),
      ),
    ).toBe("assertions[0].schema.minItems 는 0이라 모든 배열이 통과합니다");
  });
});

describe("describeSpecFinding 표기 규칙", () => {
  it("suggestion 이 있을 때와 없을 때 문장이 다르다", () => {
    const base = finding({ code: "REQUIRED_MISSING", expected: "city" });
    expect(describeSpecFinding({ ...base, suggestion: "citi" })).not.toBe(
      describeSpecFinding(base),
    );
  });

  it("반환 문자열에 개행이 없다", () => {
    const samples: SpecFinding[] = [
      finding({ code: "TOOL_NOT_DECLARED", actual: "get_wether", suggestion: "get_weather" }),
      finding({ code: "REQUIRED_MISSING", expected: "city", suggestion: "citi" }),
      finding({ code: "UNDECLARED_FIELD", actual: "citi", suggestion: "city" }),
      finding({ code: "TYPE_MISMATCH", expected: "string", actual: "number" }),
      finding({ code: "ENUM_MISMATCH", expected: ["c", "f"], actual: "celsius", suggestion: "c" }),
      finding({ code: "SCHEMA_NOT_ANALYZABLE", actual: "get_weather" }),
      finding({ code: "UNCONSTRAINED_SCHEMA", path: "assertions[0].schema" }),
      finding({ code: "VACUOUS_MIN_LENGTH", path: "assertions[0].schema.minLength" }),
      finding({ code: "VACUOUS_MIN_ITEMS", path: "assertions[0].schema.minItems" }),
    ];
    for (const sample of samples) expect(describeSpecFinding(sample)).not.toMatch(/\n/);
  });

  it("문자열 expected 는 작은따옴표로 감싸이고 배열 expected 는 JSON 표기다", () => {
    expect(
      describeSpecFinding(finding({ code: "TYPE_MISMATCH", expected: "string", actual: "number" })),
    ).toContain("선언: 'string'");
    expect(
      describeSpecFinding(
        finding({ code: "ENUM_MISMATCH", expected: ["c", "f"], actual: "celsius" }),
      ),
    ).toContain('허용: ["c","f"]');
  });

  it("숫자 expected 는 따옴표 없이 JSON 표기로 찍힌다", () => {
    expect(
      describeSpecFinding(finding({ code: "ENUM_MISMATCH", expected: [1, 2], actual: 3 })),
    ).toBe("input.city 값 3 는 선언된 값이 아닙니다. 허용: [1,2]");
  });
});

describe("공유 상수", () => {
  it("MAX_FINDINGS_PER_CASE 는 schema-match 의 상한과 같은 10 이다", () => {
    expect(MAX_FINDINGS_PER_CASE).toBe(10);
  });
});
