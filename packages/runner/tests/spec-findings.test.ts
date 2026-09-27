import { describe, expect, it } from "vitest";
import type { SpecFinding } from "../src/index.js";
import {
  describeAcceptedRejection,
  describeSpecFinding,
  MAX_FINDINGS_PER_CASE,
} from "../src/index.js";

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

  it("TYPE_MISMATCH 는 어느 쪽이 서버인지 낱말로 구분한다", () => {
    expect(
      describeSpecFinding(finding({ code: "TYPE_MISMATCH", expected: "string", actual: "number" })),
    ).toBe("input.city 의 타입이 다릅니다. 서버 선언: 'string', 명세: 'number'");
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
        finding({
          code: "SCHEMA_NOT_ANALYZABLE",
          severity: "advisory",
          actual: "get_weather",
          reason: "properties",
        }),
      ),
    ).toBe(
      "'get_weather' 의 inputSchema 에 properties 가 없거나 객체가 아니어서 입력 검사를 건너뜁니다. properties 와 required 를 채우세요",
    );
  });

  it("REJECTION_WITHOUT_VIOLATION", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "REJECTION_WITHOUT_VIOLATION",
          severity: "advisory",
          path: "operation.input",
        }),
      ),
    ).toBe(
      "거절을 기대하지만 입력이 서버 선언을 어기지 않습니다. 서버가 선언 밖 제약으로 거절한다면 그대로 두고, 아니라면 입력을 확인하세요",
    );
  });

  it("RANGE_MISMATCH", () => {
    expect(
      describeSpecFinding(
        finding({
          code: "RANGE_MISMATCH",
          severity: "advisory",
          path: "input.count",
          expected: { minimum: 1, maximum: 10 },
          actual: 0,
        }),
      ),
    ).toBe(
      "input.count 값 0 이 선언된 범위를 벗어납니다. 서버 선언: 1 이상 10 이하. 값을 범위 안으로 고치거나, 거절을 기대하는 케이스라면 expectError 를 지정하세요",
    );
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
      finding({ code: "VACUOUS_MIN_LENGTH", path: "assertions[0].schema.minLength" }),
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

describe("리뷰 회귀: 한 줄 계약", () => {
  it("actual 의 개행을 이스케이프해 줄바꿈이 생기지 않는다", () => {
    const text = describeSpecFinding(
      finding({ code: "TOOL_NOT_DECLARED", actual: "get\nweather" }),
    );
    expect(text).not.toContain("\n");
    expect(text).toBe("서버가 선언하지 않은 툴입니다: 'get\\nweather'");
  });

  it("suggestion 의 개행도 이스케이프한다", () => {
    const text = describeSpecFinding(
      finding({ code: "TOOL_NOT_DECLARED", actual: "a", suggestion: "b\nc" }),
    );
    expect(text).not.toContain("\n");
    expect(text).toContain("비슷한 툴: 'b\\nc'");
  });

  it("작은따옴표를 이스케이프해 감싸는 따옴표와 섞이지 않는다", () => {
    expect(describeSpecFinding(finding({ code: "TOOL_NOT_DECLARED", actual: "it's" }))).toBe(
      "서버가 선언하지 않은 툴입니다: 'it\\'s'",
    );
  });

  it("path 의 제어 문자도 이스케이프한다", () => {
    const text = describeSpecFinding(
      finding({
        code: "VACUOUS_MIN_LENGTH",
        path: "assertions[0].schema.properties.a\nb.minLength",
      }),
    );
    expect(text).not.toContain("\n");
    expect(text).toContain("properties.a\\nb");
  });
});

describe("REJECTION_WITHOUT_VIOLATION 문맥 (설계 §3.3)", () => {
  const unviolated = finding({
    code: "REJECTION_WITHOUT_VIOLATION",
    severity: "advisory",
    path: "operation.input",
  });
  const existing =
    "거절을 기대하지만 입력이 서버 선언을 어기지 않습니다. 서버가 선언 밖 제약으로 거절한다면 그대로 두고, 아니라면 입력을 확인하세요";

  it("문맥이 없으면 선언을 안 어기는 거절 기대에 기존 문장을 낸다", () => {
    expect(describeSpecFinding(unviolated)).toBe(existing);
  });

  it("서버가 받아들였다는 문맥이면 서버 제약 변경을 말한다", () => {
    const text = describeSpecFinding(unviolated, { rejectionAccepted: true });
    expect(text).toBe(
      "거절을 기대하지만 입력이 현재 서버 선언을 어기지 않고, 서버도 이 입력을 받아들였습니다. 명세를 만든 뒤 서버의 입력 제약이 사라졌을 수 있습니다. 의도한 변경이면 이 케이스를 지우고, 아니라면 서버의 입력 스키마와 검증을 확인하세요",
    );
    expect(text).not.toContain("입력을 확인하세요");
  });

  it("받아들이지 않았다는 문맥이면 기존 문장을 낸다", () => {
    expect(describeSpecFinding(unviolated, { rejectionAccepted: false })).toBe(existing);
  });
});

describe("describeAcceptedRejection 문안 (설계 §3.2)", () => {
  it("받아들인 필수 필드 누락을 말한다", () => {
    expect(
      describeAcceptedRejection([
        finding({ code: "REQUIRED_MISSING", path: "input.b", expected: "b" }),
      ]),
    ).toBe("서버가 필수 필드 'b' 가 빠진 입력을 받아들였습니다. 서버의 입력 검증을 확인하세요");
  });

  it("받아들인 타입 위반을 말한다", () => {
    expect(
      describeAcceptedRejection([
        finding({ code: "TYPE_MISMATCH", path: "input.a", expected: "number", actual: "string" }),
      ]),
    ).toBe(
      "서버가 input.a 에 선언과 다른 타입의 값을 받아들였습니다. 서버 선언: 'number', 명세: 'string'. 서버의 입력 검증을 확인하세요",
    );
  });

  it("받아들인 enum 위반을 말한다", () => {
    expect(
      describeAcceptedRejection([
        finding({
          code: "ENUM_MISMATCH",
          path: "input.units",
          expected: ["c", "f"],
          actual: "k",
        }),
      ]),
    ).toBe(
      '서버가 input.units 에 선언되지 않은 값 \'k\' 을 받아들였습니다. 허용: ["c","f"]. 서버의 입력 검증을 확인하세요',
    );
  });

  it("받아들인 범위 위반을 말한다", () => {
    const range = finding({
      code: "RANGE_MISMATCH",
      severity: "advisory",
      path: "input.title",
      expected: { minLength: 1, maxLength: 80 },
      actual: "",
    });
    expect(describeAcceptedRejection([range])).toBe(
      "서버가 input.title 에 선언된 범위 밖의 값 '' 을 받아들였습니다. 서버 선언: 1자 이상 80자 이하. 서버의 입력 검증을 확인하세요",
    );
    // 범위 표기는 describeSpecFinding 과 같은 함수에서 나온다.
    expect(describeSpecFinding(range)).toContain("서버 선언: 1자 이상 80자 이하.");
  });

  it("받아들인 선언 밖 필드는 선언 사실을 말한다", () => {
    const text = describeAcceptedRejection([
      finding({ code: "UNDECLARED_FIELD", path: "input.nope", actual: "nope" }),
    ]);
    expect(text).toBe(
      "서버가 선언하지 않은 필드 'nope' 가 든 입력을 받아들였습니다. 서버 스키마는 선언 밖 필드를 거절한다고 선언합니다(additionalProperties: false). 서버의 입력 검증을 확인하세요",
    );
    expect(text).toContain("additionalProperties: false");
  });

  it("위반이 여럿이면 첫 위반과 나머지 수를 말한다", () => {
    expect(
      describeAcceptedRejection([
        finding({ code: "REQUIRED_MISSING", path: "input.b", expected: "b" }),
        finding({ code: "UNDECLARED_FIELD", path: "input.nope", actual: "nope" }),
      ]),
    ).toBe(
      "서버가 필수 필드 'b' 가 빠진 입력을 받아들였습니다. 서버의 입력 검증을 확인하세요. 이 입력의 다른 위반 1건도 함께 받아들여졌습니다",
    );
  });

  it("억제 대상이 아닌 코드만 있으면 undefined", () => {
    expect(
      describeAcceptedRejection([
        finding({
          code: "VACUOUS_MIN_LENGTH",
          severity: "advisory",
          path: "assertions[0].schema.minLength",
        }),
      ]),
    ).toBeUndefined();
  });

  it("억제 대상이 아닌 코드는 첫 위반과 나머지 수에서 뺀다", () => {
    expect(
      describeAcceptedRejection([
        finding({ code: "TOOL_NOT_DECLARED", path: "operation.tool", actual: "x" }),
        finding({ code: "REQUIRED_MISSING", path: "input.b", expected: "b" }),
      ]),
    ).toBe("서버가 필수 필드 'b' 가 빠진 입력을 받아들였습니다. 서버의 입력 검증을 확인하세요");
  });

  it("빈 목록이면 undefined", () => {
    expect(describeAcceptedRejection([])).toBeUndefined();
  });

  it("반환에 줄바꿈이 없다", () => {
    const text = describeAcceptedRejection([
      finding({ code: "TYPE_MISMATCH", path: "input.a\nb", expected: "number", actual: "string" }),
    ]);
    expect(text).not.toContain("\n");
  });
});
