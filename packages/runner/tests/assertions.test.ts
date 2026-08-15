import type { ToolDef } from "@ohmymcp/core";
import { describe, expect, it, vi } from "vitest";
import toolsListFixture from "../../../fixtures/tools-list.sample.json";
import { assertBodyMatchesSchema, assertIsError, assertToolExists } from "../src/assertions.js";
import { MAX_VALUE_STRING_CHARS, normalizeThrownValue } from "../src/diagnostics.js";
import type { BodyMatchesSchemaAssertionSpec } from "../src/spec/types.js";

const tools = toolsListFixture.tools as ToolDef[];

describe("Runner assertion", () => {
  it("없는 툴을 구조화된 진단으로 실패시킨다", () => {
    expect(assertToolExists(tools, { type: "toolExists", tool: "missing" })).toEqual({
      spec: { type: "toolExists", tool: "missing" },
      status: "failed",
      diagnostic: {
        code: "TOOL_NOT_FOUND",
        message: "툴 'missing'를 찾을 수 없습니다.",
        expected: "missing",
        actual: ["add", "get_weather"],
        hint: "서버의 tools/list 응답과 테스트 명세를 확인하세요.",
      },
    });
  });

  it("존재하는 get_weather 툴을 통과시킨다", () => {
    expect(assertToolExists(tools, { type: "toolExists", tool: "get_weather" })).toEqual({
      spec: { type: "toolExists", tool: "get_weather" },
      status: "passed",
    });
  });

  it("실제 툴 이름을 UTF-16 순서로 중복 제거한다", () => {
    const localeCompare = vi.spyOn(String.prototype, "localeCompare");

    expect(
      assertToolExists(
        ["가", "a", "A", "a"].map((name) => ({ name, inputSchema: {} })),
        { type: "toolExists", tool: "missing" },
      ).diagnostic?.actual,
    ).toEqual(["A", "a", "가"]);
    expect(localeCompare).not.toHaveBeenCalled();
  });

  it("isError 불일치를 구조화된 진단으로 실패시킨다", () => {
    expect(
      assertIsError(
        { content: null, isError: true, raw: { secret: "not-in-report" } },
        { type: "isError", expected: false },
      ),
    ).toEqual({
      spec: { type: "isError", expected: false },
      status: "failed",
      diagnostic: {
        code: "IS_ERROR_MISMATCH",
        message: "정상 응답을 기대했지만 오류 응답을 받았습니다.",
        expected: false,
        actual: true,
        hint: "툴 입력값과 서버의 오류 응답을 확인하세요.",
      },
    });
  });

  it("isError true와 false 일치를 통과시킨다", () => {
    for (const expected of [true, false]) {
      expect(
        assertIsError(
          { content: null, isError: expected, raw: null },
          { type: "isError", expected },
        ),
      ).toEqual({ spec: { type: "isError", expected }, status: "passed" });
    }
  });

  it("오류 응답을 기대했지만 정상 응답이면 실패한다", () => {
    expect(
      assertIsError(
        { content: null, isError: false, raw: null },
        { type: "isError", expected: true },
      ),
    ).toMatchObject({
      diagnostic: {
        code: "IS_ERROR_MISMATCH",
        message: "오류 응답을 기대했지만 정상 응답을 받았습니다.",
        expected: true,
        actual: false,
      },
    });
  });

  it("isError 실패에 서버 응답 본문을 notes로 싣는다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: "알 수 없는 도시: example", form: "text" }),
    );

    expect(result.diagnostic?.notes).toEqual(["알 수 없는 도시: example"]);
  });

  it("JSON 본문을 한 줄로 싣는다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: { error: "unknown city", city: "example" }, form: "json" }),
    );

    expect(result.diagnostic?.notes).toEqual(['{"error":"unknown city","city":"example"}']);
  });

  it("본문 추출에 실패하면 notes를 붙이지 않는다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: false, failure: { code: "CONTENT_NOT_ARRAY", actual: "null" } }),
    );

    expect(result.diagnostic?.notes).toBeUndefined();
  });

  it("오류 응답을 기대한 케이스가 실패해도 본문을 싣는다", () => {
    const result = assertIsError(
      { content: null, isError: false, raw: null },
      { type: "isError", expected: true },
      () => ({ ok: true, body: "서울: 맑음", form: "text" }),
    );

    expect(result.diagnostic?.notes).toEqual(["서울: 맑음"]);
  });

  it("본문의 민감한 키를 가린 뒤 싣는다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: { token: "sk-abc", error: "denied" }, form: "json" }),
    );

    expect(result.diagnostic?.notes).toEqual(['{"token":"[REDACTED]","error":"denied"}']);
  });

  it("본문이 sensitiveValues와 같으면 가린 뒤 싣는다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: "sk-abc", form: "text" }),
      { redaction: { sensitiveValues: ["sk-abc"] } },
    );

    expect(result.diagnostic?.notes).toEqual(["[REDACTED]"]);
  });

  it("상한을 넘는 본문을 자르고 원본 길이를 남긴다", () => {
    const body = "가".repeat(MAX_VALUE_STRING_CHARS + 30);
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body, form: "text" }),
    );

    expect(result.diagnostic?.notes).toEqual([
      `${"가".repeat(MAX_VALUE_STRING_CHARS)}…(총 ${MAX_VALUE_STRING_CHARS + 30}자)`,
    ]);
  });

  it("본문이 여러 줄이면 줄마다 notes 항목이 된다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: "첫 줄입니다.\n\n둘째 줄입니다.", form: "text" }),
    );

    // 빈 줄은 버린다. 서버가 보낸 글자는 그대로 두고 줄만 나눈다.
    expect(result.diagnostic?.notes).toEqual(["첫 줄입니다.", "둘째 줄입니다."]);
  });

  it("여러 줄 본문을 나누기 전에 전체 길이로 자른다", () => {
    const head = "가".repeat(MAX_VALUE_STRING_CHARS - 2);
    const body = `${head}\n${"나".repeat(50)}`;
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body, form: "text" }),
    );

    // 줄마다 따로 잘랐다면 두 줄이 온전히 남는다. 전체에 걸어야 둘째 줄이 한 글자로 줄어든다.
    expect(result.diagnostic?.notes).toEqual([head, `나…(총 ${MAX_VALUE_STRING_CHARS + 49}자)`]);
  });

  it("isError가 통과하면 본문을 넘겨도 진단이 없다", () => {
    const result = assertIsError(
      { content: null, isError: false, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: "서울: 맑음", form: "text" }),
    );

    expect(result).toEqual({ spec: { type: "isError", expected: false }, status: "passed" });
  });

  it("진단에서 raw와 관련 없는 content를 제외한다", () => {
    const result = assertIsError(
      { content: { secret: "content-secret" }, isError: true, raw: { secret: "raw-secret" } },
      { type: "isError", expected: false },
    );
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("content-secret");
    expect(serialized).not.toContain("raw-secret");
  });
});

describe("normalizeThrownValue", () => {
  it("Error를 JSON 진단값으로 정규화한다", () => {
    expect(normalizeThrownValue(new Error("Connection closed"))).toEqual({
      type: "error",
      name: "Error",
      message: "Connection closed",
    });
  });

  it("비 Error throw를 안전하게 정규화한다", () => {
    const toJSON = vi.fn(() => ({ secret: "must-not-run" }));
    const circular: { self?: unknown; toJSON: typeof toJSON } = { toJSON };
    circular.self = circular;
    const thrownValues: unknown[] = [
      "text",
      12.5,
      true,
      null,
      undefined,
      BigInt(42),
      Symbol("symbol-description"),
      function namedFunction() {},
      { toJSON },
      circular,
      Number.NaN,
      Infinity,
    ];

    for (const thrown of thrownValues) {
      expect(() => JSON.stringify(normalizeThrownValue(thrown))).not.toThrow();
    }
    expect(normalizeThrownValue(Number.NaN)).toEqual({ type: "number", value: "NaN" });
    expect(normalizeThrownValue(Infinity)).toEqual({ type: "number", value: "Infinity" });
    expect(toJSON).not.toHaveBeenCalled();
  });
});

describe("assertBodyMatchesSchema", () => {
  const spec: BodyMatchesSchemaAssertionSpec = {
    type: "bodyMatchesSchema",
    schema: { type: "object", required: ["temp"], properties: { temp: { type: "number" } } },
  };

  it("추출 성공에 위반이 없으면 통과한다", () => {
    const result = assertBodyMatchesSchema({ ok: true, body: { temp: 21 }, form: "json" }, spec);
    expect(result.status).toBe("passed");
    expect(result.diagnostic).toBeUndefined();
  });

  it("추출 성공에 위반이 있으면 실패한다", () => {
    const result = assertBodyMatchesSchema(
      { ok: true, body: { temperature: 21 }, form: "json" },
      spec,
    );
    expect(result.status).toBe("failed");
    expect(result.diagnostic?.code).toBe("BODY_SCHEMA_MISMATCH");
  });

  it("추출 실패면 실패한다", () => {
    const result = assertBodyMatchesSchema(
      { ok: false, failure: { code: "CONTENT_BLOCK_COUNT", actual: 2 } },
      spec,
    );
    expect(result.status).toBe("failed");
    expect(result.diagnostic?.code).toBe("BODY_EXTRACTION_FAILED");
  });

  it("extraction이 undefined면 skipped다", () => {
    const result = assertBodyMatchesSchema(undefined, spec);
    expect(result.status).toBe("skipped");
    expect(result.diagnostic?.code).toBe("OPERATION_RESULT_UNAVAILABLE");
  });
});
