import type { ToolDef } from "@ohmymcp/core";
import { describe, expect, it, vi } from "vitest";
import toolsListFixture from "../../../fixtures/tools-list.sample.json";
import { assertIsError, assertToolExists } from "../src/assertions.js";
import { normalizeThrownValue } from "../src/diagnostics.js";

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
