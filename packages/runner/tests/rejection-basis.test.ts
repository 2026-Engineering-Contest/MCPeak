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
  classifyRejectionBasis({
    expectsRejection: true,
    rejected: true,
    toolName: tool,
    bodyText: body,
  });

describe("classifyRejectionBasis", () => {
  it("거절을 기대하지 않는 케이스는 판정 대상이 아니다", () => {
    expect(
      classifyRejectionBasis({
        expectsRejection: false,
        rejected: true,
        toolName: "t",
        bodyText: "무엇이든",
      }),
    ).toBe("notApplicable");
  });

  it("거절을 기대하지 않으면 rejected 와 무관하게 판정 대상이 아니다", () => {
    expect(
      classifyRejectionBasis({
        expectsRejection: false,
        rejected: true,
        toolName: "t",
        bodyText: "MCP error -32602: x",
      }),
    ).toBe("notApplicable");
    expect(
      classifyRejectionBasis({
        expectsRejection: false,
        rejected: false,
        toolName: "t",
        bodyText: "MCP error -32602: x",
      }),
    ).toBe("notApplicable");
  });

  /**
   * 거절이 없었으면 확인할 근거도 없다. 본문이 화이트리스트 모양이어도 `verified` 가 아니다.
   * 그 케이스는 이미 `isError` 단언 실패로 빨간색이라, 미확인 목록과 AI 진단에 실을 이유가 없다.
   */
  it("거절을 기대했지만 거절이 오지 않으면 판정 대상이 아니다", () => {
    expect(
      classifyRejectionBasis({
        expectsRejection: true,
        rejected: false,
        toolName: "t",
        bodyText: "MCP error -32602: x",
      }),
    ).toBe("notApplicable");
    expect(
      classifyRejectionBasis({
        expectsRejection: true,
        rejected: false,
        toolName: "t",
        bodyText: null,
      }),
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

  it("TS SDK 의 출력 검증 실패는 같은 -32602 라도 확인하지 않는다", () => {
    // `McpServer` 가 핸들러의 structuredContent 를 outputSchema 로 검증하다 실패하면 같은 코드로
    // 이 문장을 낸다. 입력 거절이 아니라 서버 결함이다. 이것을 verified 로 찍으면 거절 기대
    // 케이스에서 출력 계약 위반이 초록으로 숨는다.
    expect(
      classify(
        "convert_units",
        "MCP error -32602: Output validation error: Invalid structured content for tool convert_units: Invalid input: expected number, received undefined at converted",
      ),
    ).toBe("unverified");
  });

  it("-32602 코드만 있고 입력 검증 문장이 아니면 확인하지 않는다", () => {
    expect(classify("echo", "MCP error -32602: Tool echo not found")).toBe("unverified");
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

  it("MCPeak 목의 inputSchema 위반 거절은 고정 접미어로 확인한다", () => {
    expect(
      classify(
        "get_weather",
        [
          "→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)",
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
        ].join("\n"),
      ),
    ).toBe("verified");
  });

  it("MCPeak 목의 고정 문장 뒤에 내용이 더 있으면 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        [
          "→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)",
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
          "추가 오류",
        ].join("\n"),
      ),
    ).toBe("unverified");
  });

  it("MCPeak 목의 고정 안내만 흉내낸 본문은 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        [
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
        ].join("\n"),
      ),
    ).toBe("unverified");
  });

  it("임의 오류 뒤에 MCPeak 목의 고정 안내를 붙여도 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        [
          "서버 내부 오류",
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
        ].join("\n"),
      ),
    ).toBe("unverified");
  });

  it("MCPeak 목의 위반 진단 사이에 임의 오류가 섞이면 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        [
          "→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 0 (number)",
          "서버 내부 오류",
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
        ].join("\n"),
      ),
    ).toBe("unverified");
  });

  it("다른 툴의 MCPeak 목 위반 진단은 확인하지 않는다", () => {
    expect(
      classify(
        "get_weather",
        [
          "→ 툴 'add' 의 'a' 은(는) number 이어야 합니다. 받은 값: \"1\" (string)",
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
        ].join("\n"),
      ),
    ).toBe("unverified");
  });

  it("MCPeak 목의 여러 inputSchema 위반 진단 형식을 함께 확인한다", () => {
    expect(
      classify(
        "get_weather",
        [
          "→ 툴 'get_weather' 호출에 필수 필드 'city' 이(가) 없습니다. 받은 인자: {}",
          '→ 툴 \'get_weather\' 의 \'unit\' 은(는) 선언된 값 중 하나여야 합니다: "c", "f". 받은 값: "k"',
          "→ 툴 'get_weather' 의 'days' 은(는) 7 이하여야 합니다. 받은 값: 99",
          "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
          "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
        ].join("\n"),
      ),
    ).toBe("verified");
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

  // #280. 리포터가 `→` 글머리를 겹쳐 찍지 않게 고쳤다. 그 변경은 표시 계층에만 있고
  // 이 판정이 보는 응답 본문에는 닿지 않아야 한다. 본문에서 `→` 를 지우는 방향으로
  // 고치면 목 거절이 통째로 unverified 로 떨어지는데, 그러면 크래시가 숨는 쪽이 아니라
  // 정상 거절이 경고를 다는 쪽으로 새서 화면이 늘 시끄러워진다.
  it("목 거절 지문은 → 글머리를 그대로 요구한다", () => {
    const body = [
      "→ 툴 'get_weather' 의 'city' 은(는) string 이어야 합니다. 받은 값: 12345 (number)",
      "→ 이 툴이 tools/list 로 선언한 inputSchema 가 그렇게 요구합니다.",
      "→ 거절이 의도한 것이면 responses 에 이 인자를 넣어 응답을 지정하세요.",
    ].join("\n");

    expect(classify("get_weather", body)).toBe("verified");
    // 글머리를 벗긴 본문은 지문이 아니다.
    expect(classify("get_weather", body.replaceAll("→ ", ""))).toBe("unverified");
  });
});
