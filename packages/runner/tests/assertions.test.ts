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

  it("문장 안에 섞인 sensitiveValues도 가린다", () => {
    // 서버 오류 문장은 값이 문장 속에 박혀 나온다. 이 줄은 교정 제안 요청에 실려 외부
    // provider 로 나가므로 값 전체 일치만으로는 부족하다.
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: "토큰 sk-abc 이 만료되었습니다", form: "text" }),
      { redaction: { sensitiveValues: ["sk-abc"] } },
    );

    expect(result.diagnostic?.notes).toEqual(["토큰 [REDACTED] 이 만료되었습니다"]);
  });

  it("JSON 본문의 문장 안에 섞인 sensitiveValues도 가린다", () => {
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: { error: "토큰 sk-abc 만료" }, form: "json" }),
      { redaction: { sensitiveValues: ["sk-abc"] } },
    );

    expect(result.diagnostic?.notes).toEqual(['{"error":"토큰 [REDACTED] 만료"}']);
  });

  it("빈 문자열 sensitiveValues는 무시한다", () => {
    // 빈 문자열을 치환하면 모든 자리에 끼어들어 문장을 통째로 지운다.
    const result = assertIsError(
      { content: null, isError: true, raw: null },
      { type: "isError", expected: false },
      () => ({ ok: true, body: "도시를 찾을 수 없습니다", form: "text" }),
      { redaction: { sensitiveValues: [""] } },
    );

    expect(result.diagnostic?.notes).toEqual(["도시를 찾을 수 없습니다"]);
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

  it("Error 의 cause 체인을 함께 정규화한다", () => {
    // 서버가 준 거절 이유는 core 가 McpClientError.cause 에 보존한다. 여기서 버리면
    // 화면이 "protocol 오류로 거절되었습니다" 까지만 말하게 된다(adoption.md §2.5 넷째).
    const root = new Error(
      "MCP error -32601: Tool simulate-research-query requires task augmentation (taskSupport: 'required')",
    );
    root.name = "McpError";
    const wrapped = new Error("MCP 작업이 protocol 오류로 거절되었습니다.", { cause: root });
    wrapped.name = "McpClientError";
    expect(normalizeThrownValue(wrapped)).toEqual({
      type: "error",
      name: "McpClientError",
      message: "MCP 작업이 protocol 오류로 거절되었습니다.",
      cause: {
        type: "error",
        name: "McpError",
        message:
          "MCP error -32601: Tool simulate-research-query requires task augmentation (taskSupport: 'required')",
      },
    });
  });

  it("cause 가 없으면 cause 키를 만들지 않는다", () => {
    // 키가 undefined 로 생기면 기존 보고서의 JSON 바이트가 흔들린다.
    const normalized = normalizeThrownValue(new Error("plain"));
    expect(Object.hasOwn(normalized, "cause")).toBe(false);
  });

  it("cause 체인은 상한 3에서 자른다", () => {
    // 순환 cause(a.cause = b, b.cause = a)에서 무한히 내려가면 안 된다. 실측 체인은
    // 2단계(McpClientError → McpError)라 3이면 여유다.
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    a.cause = b;
    const normalized = normalizeThrownValue(a);
    expect(() => JSON.stringify(normalized)).not.toThrow();
    let depth = 0;
    let current: unknown = normalized;
    while (typeof current === "object" && current !== null && Object.hasOwn(current, "cause")) {
      depth += 1;
      current = (current as { cause: unknown }).cause;
    }
    // 순환 체인은 cause 가 항상 있으므로 정확히 상한만큼 내려간다. 이하가 아니라 일치로
    // 단언해야 상한이 조용히 줄어드는 회귀도 잡는다.
    expect(depth).toBe(3);
  });

  it("Error 가 아닌 cause 도 정규화해 싣는다", () => {
    // core 는 형태가 어긋난 결과 객체를 cause 로 넣기도 한다(client.ts 의 OPERATION_FAILED).
    const wrapped = new Error("wrap", { cause: { unexpected: true } });
    expect(normalizeThrownValue(wrapped)).toEqual({
      type: "error",
      name: "Error",
      message: "wrap",
      cause: { type: "object" },
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
