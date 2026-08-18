import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyRejectionBasis } from "../src/rejection-basis.js";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/rejection-bodies.json", import.meta.url)), "utf8"),
) as {
  관찰: { source: string; tool: string; kind: string; body: string | null; expected: string }[];
  탐침: { source: string; tool: string; kind: string; body: string | null; expected: string }[];
};

const classify = (tool: string | null, body: string | null) =>
  classifyRejectionBasis({ expectsRejection: true, toolName: tool, bodyText: body });

describe("classifyRejectionBasis", () => {
  it("거절을 기대하지 않는 케이스는 판정 대상이 아니다", () => {
    expect(
      classifyRejectionBasis({ expectsRejection: false, toolName: "t", bodyText: "무엇이든" }),
    ).toBe("notApplicable");
  });

  it("본문이 없으면 확인하지 않는다", () => {
    expect(classify("t", null)).toBe("unverified");
  });

  it("TS SDK 의 -32602 응답을 확인한다", () => {
    expect(
      classify(
        "echo",
        "MCP error -32602: Input validation error: Invalid arguments for tool echo: Invalid input: expected string, received number at message",
      ),
    ).toBe("verified");
  });

  it("Python 하위 SDK 의 검증 오류를 확인한다", () => {
    expect(classify("fetch", "Input validation error: 'url' is a required property")).toBe(
      "verified",
    );
  });

  it("FastMCP 의 입력 검증 오류를 확인한다", () => {
    expect(
      classify(
        "calculate",
        "Error executing tool calculate: 1 validation error for calculateArguments\nexpression\n  Field required",
      ),
    ).toBe("verified");
  });

  it("errors 복수형도 확인한다", () => {
    expect(
      classify(
        "calculate",
        "Error executing tool calculate: 2 validation errors for calculateArguments\nexpression\n  Field required",
      ),
    ).toBe("verified");
  });

  it("FastMCP 가 응답 모델 검증에서 터진 것은 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        "Error executing tool get_weather: 2 validation errors for WeatherResponse\ntemperature\n  Input should be a valid number",
      ),
    ).toBe("unverified");
  });

  it("툴 이름이 다른 Arguments 모델은 확인하지 않는다", () => {
    expect(classify("a", "Error executing tool a: 1 validation error for bArguments")).toBe(
      "unverified",
    );
  });

  it("핸들러 예외 문구는 확인하지 않는다", () => {
    expect(classify("get_weather", "Cannot read properties of undefined (reading 'city')")).toBe(
      "unverified",
    );
  });

  it("손으로 쓴 거절 문장은 확인하지 않는다", () => {
    expect(classify("get_weather", "→ 'city' 는 문자열이어야 합니다.")).toBe("unverified");
  });

  it("툴 이름의 정규식 메타문자를 리터럴로 다룬다", () => {
    // 이스케이프를 빼면 `a.b` 의 `.` 이 임의 문자와 맞아 `aXbArguments` 를 verified 로 찍는다.
    expect(classify("a.b", "Error executing tool a.b: 1 validation error for aXbArguments")).toBe(
      "unverified",
    );
  });

  it("툴 이름이 null 이면 FastMCP 지문을 쓰지 않는다", () => {
    expect(
      classify(null, "Error executing tool calculate: 1 validation error for calculateArguments"),
    ).toBe("unverified");
  });

  it("앞쪽 공백을 무시한다", () => {
    expect(classify("fetch", "  Input validation error: 'url' is a required property")).toBe(
      "verified",
    );
  });

  it("관찰 80건을 픽스처가 적은 대로 분류한다", () => {
    const actual = fixture.관찰.map((row) => classify(row.tool, row.body));
    expect(actual).toEqual(fixture.관찰.map((row) => row.expected));
    expect(actual.filter((value) => value === "verified")).toHaveLength(64);
    expect(actual.filter((value) => value === "unverified")).toHaveLength(16);
  });

  it("탐침 6건을 픽스처가 적은 대로 분류한다", () => {
    const actual = fixture.탐침.map((row) => classify(row.tool, row.body));
    expect(actual).toEqual(fixture.탐침.map((row) => row.expected));
    // 크래시 4건이 하나도 verified 로 새지 않는다. 이 단언이 이 설계의 안전선이다.
    const crashes = fixture.탐침.filter((row) => row.expected === "unverified");
    expect(crashes).toHaveLength(4);
  });
});
