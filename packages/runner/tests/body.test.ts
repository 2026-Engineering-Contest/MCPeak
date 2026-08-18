import type { ToolResult } from "@ohmymcp-hsu/core";
import { describe, expect, it } from "vitest";
import { extractResponseBody } from "../src/index.js";

/** content만 바꿔가며 추출을 검증한다. isError와 raw는 추출 규칙과 무관하다. */
const resultOf = (content: unknown): ToolResult => ({ content, isError: false, raw: null });

describe("extractResponseBody", () => {
  it("JSON 객체 텍스트를 구조로 해석한다", () => {
    expect(extractResponseBody(resultOf([{ type: "text", text: '{"a":1}' }]))).toEqual({
      ok: true,
      body: { a: 1 },
      form: "json",
    });
  });

  it("JSON 배열 텍스트를 구조로 해석한다", () => {
    expect(extractResponseBody(resultOf([{ type: "text", text: "[1,2]" }]))).toEqual({
      ok: true,
      body: [1, 2],
      form: "json",
    });
  });

  it("__proto__ 키를 자기 키로 가진 객체를 구조로 해석한다", () => {
    const extraction = extractResponseBody(resultOf([{ type: "text", text: '{"__proto__":1}' }]));
    expect(extraction.ok).toBe(true);
    if (!extraction.ok) throw new Error("추출 성공을 기대했습니다.");
    expect(extraction.form).toBe("json");
    expect(Object.hasOwn(extraction.body as object, "__proto__")).toBe(true);
  });

  it("JSON이 아닌 텍스트를 문자열 본문으로 본다", () => {
    expect(extractResponseBody(resultOf([{ type: "text", text: "→ 없습니다" }]))).toEqual({
      ok: true,
      body: "→ 없습니다",
      form: "text",
    });
  });

  it.each([
    ["21", "21"],
    ["null", "null"],
    ["true", "true"],
    ['"오류"', '"오류"'],
    ["", ""],
  ])("스칼라로 파싱되는 텍스트 %p는 문자열 본문으로 본다", (text, body) => {
    expect(extractResponseBody(resultOf([{ type: "text", text }]))).toEqual({
      ok: true,
      body,
      form: "text",
    });
  });

  it("content 블록이 0개이면 실패한다", () => {
    expect(extractResponseBody(resultOf([]))).toEqual({
      ok: false,
      failure: { code: "CONTENT_BLOCK_COUNT", actual: 0 },
    });
  });

  it("content 블록이 2개이면 실패한다", () => {
    expect(
      extractResponseBody(
        resultOf([
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ]),
      ),
    ).toEqual({ ok: false, failure: { code: "CONTENT_BLOCK_COUNT", actual: 2 } });
  });

  it("text가 아닌 블록이면 실패한다", () => {
    expect(extractResponseBody(resultOf([{ type: "image", data: "..." }]))).toEqual({
      ok: false,
      failure: { code: "CONTENT_BLOCK_NOT_TEXT", actual: "image" },
    });
  });

  it("type이 text인데 text가 문자열이 아니면 실패한다", () => {
    // 블록 type은 text가 맞으므로 CONTENT_BLOCK_NOT_TEXT가 아니라 전용 코드를 낸다.
    expect(extractResponseBody(resultOf([{ type: "text", text: 42 }]))).toEqual({
      ok: false,
      failure: { code: "CONTENT_TEXT_MISSING", actual: "number" },
    });
  });

  it("블록이 객체가 아니면 실패한다", () => {
    expect(extractResponseBody(resultOf([null]))).toEqual({
      ok: false,
      failure: { code: "CONTENT_BLOCK_NOT_TEXT", actual: "null" },
    });
  });

  it.each([
    [{ a: 1 }, "object"],
    [null, "null"],
    [undefined, "undefined"],
  ])("content가 배열이 아니면 실패한다: %p", (content, actual) => {
    expect(extractResponseBody(resultOf(content))).toEqual({
      ok: false,
      failure: { code: "CONTENT_NOT_ARRAY", actual },
    });
  });
});
