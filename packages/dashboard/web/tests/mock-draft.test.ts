import { describe, expect, it } from "vitest";
import {
  addPickedResponse,
  buildMockDefinition,
  EMPTY_MOCK_DRAFT,
  isBlankResult,
  type MockDraft,
  mockFilePath,
  newResponseDraft,
  newToolDraft,
  preservedKeysNote,
  type ResponseDraft,
  replaceResult,
  serializeMockDefinition,
  type ToolDraft,
} from "../src/mock-builder/draft.js";

const weatherTool: ToolDraft = {
  name: "get_weather",
  description: "",
  schemaMode: "fields",
  fields: [{ name: "city", type: "string", required: true }],
  schemaJson: "",
  extra: {},
};

const response = (overrides: Partial<ResponseDraft> = {}): ResponseDraft => ({
  tool: "get_weather",
  anyArgs: false,
  argsJson: '{"city":"Seoul"}',
  resultJson: '{"temperature":21.5}',
  isError: false,
  origin: "manual",
  extra: {},
  ...overrides,
});

const draftOf = (tools: ToolDraft[], responses: ResponseDraft[]): MockDraft => ({
  tools,
  responses,
  extra: {},
});

const WEATHER_SCHEMA = {
  type: "object",
  properties: { city: { type: "string" } },
  required: ["city"],
};

describe("buildMockDefinition", () => {
  it("인자 무관이면 args 키가 없고, isError 는 켰을 때만 true 로 들어간다", () => {
    const draft = draftOf(
      [weatherTool],
      [
        response(),
        response({
          argsJson: '{"city":"Nowhere"}',
          resultJson: '{"error":"unknown"}',
          isError: true,
        }),
        response({
          anyArgs: true,
          argsJson: "이 값은 보지 않는다",
          resultJson: '{"temperature":0}',
        }),
      ],
    );
    expect(buildMockDefinition(draft)).toEqual({
      ok: true,
      definition: {
        tools: [{ name: "get_weather", inputSchema: WEATHER_SCHEMA }],
        responses: [
          { tool: "get_weather", args: { city: "Seoul" }, result: { temperature: 21.5 } },
          {
            tool: "get_weather",
            args: { city: "Nowhere" },
            result: { error: "unknown" },
            isError: true,
          },
          { tool: "get_weather", result: { temperature: 0 } },
        ],
      },
    });
  });

  it("args 가 null 이면 null 인자 응답이다", () => {
    const built = buildMockDefinition(draftOf([weatherTool], [response({ argsJson: "null" })]));
    expect(built.ok && built.definition.responses[0]).toEqual({
      tool: "get_weather",
      args: null,
      result: { temperature: 21.5 },
    });
  });

  it("도구 여러 개와 JSON 모드 스키마를 그대로 싣는다", () => {
    const draft = draftOf(
      [
        weatherTool,
        {
          ...newToolDraft("search"),
          schemaMode: "json",
          schemaJson: '{"type":"object","properties":{"tags":{"type":"array"}}}',
        },
      ],
      [response({ tool: "search", anyArgs: true, resultJson: "[]" })],
    );
    const built = buildMockDefinition(draft);
    expect(built.ok && built.definition.tools.map((tool) => tool.inputSchema)).toEqual([
      WEATHER_SCHEMA,
      { type: "object", properties: { tags: { type: "array" } } },
    ]);
  });

  it("설명과 보존 키를 알려진 키 뒤에 원래 순서로 싣는다. 공백뿐인 설명은 뺀다", () => {
    const built = buildMockDefinition({
      tools: [
        {
          ...weatherTool,
          description: "도시의 현재 날씨",
          extra: { annotations: { readOnlyHint: true }, "x-owner": "mock" },
        },
        { ...newToolDraft("ping"), description: "   " },
      ],
      responses: [response({ extra: { note: "녹화에서 가져옴" } })],
      extra: { $comment: "손으로 적은 메모" },
    });
    if (!built.ok) throw new Error(built.errors.join("\n"));
    expect(serializeMockDefinition(built.definition)).toBe(
      `${JSON.stringify(
        {
          tools: [
            {
              name: "get_weather",
              description: "도시의 현재 날씨",
              inputSchema: WEATHER_SCHEMA,
              annotations: { readOnlyHint: true },
              "x-owner": "mock",
            },
            { name: "ping", inputSchema: { type: "object", properties: {} } },
          ],
          responses: [
            {
              tool: "get_weather",
              args: { city: "Seoul" },
              result: { temperature: 21.5 },
              note: "녹화에서 가져옴",
            },
          ],
          $comment: "손으로 적은 메모",
        },
        null,
        2,
      )}\n`,
    );
  });

  it("이름 · 필드 · JSON 문제를 전부 모아 문장으로 준다", () => {
    const draft = draftOf(
      [
        { ...weatherTool, name: " " },
        {
          ...weatherTool,
          fields: [
            { name: "", type: "string", required: false },
            { name: "city", type: "string", required: false },
            { name: "city", type: "number", required: false },
          ],
        },
        { ...newToolDraft("search"), schemaMode: "json", schemaJson: "{ type: object" },
        weatherTool,
      ],
      [
        response({ tool: "" }),
        response({ argsJson: "{city:'Seoul'}" }),
        response({ resultJson: "" }),
      ],
    );
    expect(buildMockDefinition(draft)).toEqual({
      ok: false,
      errors: [
        "도구 1번의 이름이 비어 있습니다. 목이 tools/list 로 내보낼 이름을 적으세요.",
        "도구 'get_weather' 의 입력 필드 1번 이름이 비어 있습니다.",
        "도구 'get_weather' 에 입력 필드 'city' 이(가) 두 번 있습니다.",
        "도구 'search' 의 입력 스키마 JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요.",
        "도구 'get_weather' 이(가) 두 번 있습니다. 목은 이름으로 도구를 찾으므로 하나로 합치세요.",
        "응답 1번의 도구를 고르세요.",
        "응답 2번 ('get_weather') 의 args JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요. 인자를 가리지 않으려면 \"인자 무관\" 을 켜세요.",
        "응답 3번 ('get_weather') 의 result JSON 을 읽을 수 없습니다. 따옴표·쉼표·괄호 짝을 확인하세요.",
      ],
    });
  });

  it("앞뒤 공백은 이름에서 지운다", () => {
    const built = buildMockDefinition(
      draftOf(
        [
          {
            ...weatherTool,
            name: " get_weather ",
            fields: [{ name: " city ", type: "string", required: true }],
          },
        ],
        [response({ tool: " get_weather " })],
      ),
    );
    expect(built.ok && built.definition.tools[0]?.name).toBe("get_weather");
    expect(built.ok && built.definition.tools[0]?.inputSchema).toEqual(WEATHER_SCHEMA);
    expect(built.ok && built.definition.responses[0]?.tool).toBe("get_weather");
  });

  it("빈 초안은 빈 정의다", () => {
    expect(buildMockDefinition(EMPTY_MOCK_DRAFT)).toEqual({
      ok: true,
      definition: { tools: [], responses: [] },
    });
  });
});

describe("serializeMockDefinition", () => {
  it("두 칸 들여쓰기에 끝 줄바꿈 하나다. 같은 초안이면 같은 바이트다", () => {
    const draft = draftOf([weatherTool], [response({ anyArgs: true })]);
    const first = buildMockDefinition(draft);
    const second = buildMockDefinition(draft);
    if (!first.ok || !second.ok) throw new Error("초안이 유효해야 한다");
    const bytes = serializeMockDefinition(first.definition);
    expect(bytes).toBe(serializeMockDefinition(second.definition));
    expect(bytes).toBe(
      [
        "{",
        '  "tools": [',
        "    {",
        '      "name": "get_weather",',
        '      "inputSchema": {',
        '        "type": "object",',
        '        "properties": {',
        '          "city": {',
        '            "type": "string"',
        "          }",
        "        },",
        '        "required": [',
        '          "city"',
        "        ]",
        "      }",
        "    }",
        "  ],",
        '  "responses": [',
        "    {",
        '      "tool": "get_weather",',
        '      "result": {',
        '        "temperature": 21.5',
        "      }",
        "    }",
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
  });
});

describe("녹화 응답 넣기", () => {
  const body = { temperature: 21.5, source: "https://api.open-meteo.com/docs" };

  it("addPickedResponse: 도구가 없으면 이름만 채운 도구를 함께 추가하고, 본문을 가공 없이 result 에 넣는다", () => {
    const next = addPickedResponse(EMPTY_MOCK_DRAFT, {
      tool: "get_weather",
      argsJson: '{"city":"Seoul"}',
      body,
    });
    expect(next.tools).toEqual([newToolDraft("get_weather")]);
    expect(next.responses).toEqual([
      {
        tool: "get_weather",
        anyArgs: false,
        argsJson: '{"city":"Seoul"}',
        resultJson: JSON.stringify(body, null, 2),
        isError: false,
        origin: "recording",
        extra: {},
      },
    ]);
  });

  it("addPickedResponse: 도구가 있으면 늘리지 않는다. argsJson 이 null 이면 인자 무관이다", () => {
    const next = addPickedResponse(draftOf([weatherTool], []), {
      tool: "get_weather",
      argsJson: null,
      body,
    });
    expect(next.tools).toEqual([weatherTool]);
    expect(next.responses[0]?.anyArgs).toBe(true);
  });

  it("replaceResult: 그 줄의 result 만 바꾸고 녹화 응답으로 표시한다", () => {
    const start = draftOf([weatherTool], [response(), response({ argsJson: '{"city":"Busan"}' })]);
    const next = replaceResult(start, 1, body);
    expect(next.responses[0]).toEqual(start.responses[0]);
    expect(next.responses[1]).toEqual({
      ...start.responses[1],
      resultJson: JSON.stringify(body, null, 2),
      origin: "recording",
    });
  });

  it.each([
    ["", true],
    ["  {}  ", true],
    ["{ }", false],
    ['{"a":1}', false],
    ["[]", false],
  ])("isBlankResult(%j) = %s", (text, blank) => {
    expect(isBlankResult(text)).toBe(blank);
  });
});

describe("초안 기본값 · 안내 · 경로", () => {
  it("새 응답은 인자 지정 · 빈 객체로 시작한다", () => {
    expect(newResponseDraft("get_weather")).toEqual({
      tool: "get_weather",
      anyArgs: false,
      argsJson: "{}",
      resultJson: "{}",
      isError: false,
      origin: "manual",
      extra: {},
    });
  });

  it("보존 키 안내 문장", () => {
    expect(preservedKeysNote({})).toBeNull();
    expect(preservedKeysNote({ outputSchema: {}, annotations: {} })).toBe(
      "폼에 칸이 없는 키 2개를 그대로 보존합니다: outputSchema, annotations",
    );
  });

  it("파일 경로는 한 세그먼트로 인코딩한다", () => {
    expect(mockFilePath("mocks/weather mock.json")).toBe("/api/mocks/mocks%2Fweather%20mock.json");
  });
});
