import { describe, expect, it } from "vitest";
import {
  argsProblems,
  inputFields,
  newResponseFor,
  prefillArgs,
  toolProblem,
} from "../src/mock-builder/args-check.js";
import { newResponseDraft, newToolDraft, type ToolDraft } from "../src/mock-builder/draft.js";

const weather: ToolDraft = {
  ...newToolDraft("get_weather"),
  fields: [
    { name: "city", type: "string", required: true },
    { name: "days", type: "integer", required: false },
  ],
};
const ping: ToolDraft = newToolDraft("ping");
const jsonTool: ToolDraft = {
  ...newToolDraft("search"),
  schemaMode: "json",
  schemaJson: JSON.stringify({
    type: "object",
    properties: { q: { type: "string" }, filter: { type: "object" } },
    required: ["q"],
  }),
};

const TAIL = "→ 도구에 입력 필드를 추가했거나 이름을 바꿨다면 args 도 같이 고치세요.";

describe("inputFields", () => {
  it("평면 폼은 이름이 빈 필드를 빼고 그대로 준다", () => {
    const tool = {
      ...weather,
      fields: [...weather.fields, { name: " ", type: "boolean" as const, required: false }],
    };
    expect(inputFields(tool)).toEqual([
      { name: "city", type: "string", required: true },
      { name: "days", type: "integer", required: false },
    ]);
  });

  it("JSON 모드는 properties · required 를 읽고, 모르는 타입은 null 이다", () => {
    expect(inputFields(jsonTool)).toEqual([
      { name: "q", type: "string", required: true },
      { name: "filter", type: null, required: false },
    ]);
  });

  it("JSON 을 읽을 수 없거나 properties 가 객체가 아니면 null 이다", () => {
    expect(inputFields({ ...jsonTool, schemaJson: "{" })).toBeNull();
    expect(inputFields({ ...jsonTool, schemaJson: '{"properties":[]}' })).toBeNull();
  });

  it("목 서버가 해석을 포기하는 스키마면 null 이다(unanalyzableReason 과 맞춘다)", () => {
    const allOfTool = {
      ...jsonTool,
      schemaJson: JSON.stringify({ allOf: [{ type: "object" }], required: ["city"] }),
    };
    expect(inputFields(allOfTool)).toBeNull();
    expect(argsProblems({ ...newResponseDraft("search"), argsJson: "{}" }, [allOfTool])).toEqual(
      [],
    );

    const arrayTypeTool = {
      ...jsonTool,
      schemaJson: JSON.stringify({
        type: ["object", "null"],
        properties: { q: { type: "string" } },
      }),
    };
    expect(inputFields(arrayTypeTool)).toBeNull();
  });
});

describe("prefillArgs · newResponseFor", () => {
  it("args 가 {} 이면 입력 필드를 빈 값으로 채운다", () => {
    expect(prefillArgs(newResponseDraft("get_weather"), weather).argsJson).toBe(
      '{"city":"","days":0}',
    );
  });

  it("args 가 비어 있어도 채운다. 스칼라가 아닌 타입은 넣지 않는다", () => {
    const blank = { ...newResponseDraft("search"), argsJson: "  " };
    expect(prefillArgs(blank, jsonTool).argsJson).toBe('{"q":""}');
  });

  it("사람이 적은 args 는 덮지 않는다", () => {
    const written = { ...newResponseDraft("get_weather"), argsJson: '{"city":"Seoul"}' };
    expect(prefillArgs(written, weather)).toBe(written);
  });

  it("도구가 없거나 입력 필드가 없으면 그대로다", () => {
    const response = newResponseDraft("ping");
    expect(prefillArgs(response, undefined)).toBe(response);
    expect(prefillArgs(response, ping)).toBe(response);
  });

  it("새 응답은 이름이 있는 첫 도구로 만들고 채운다", () => {
    expect(newResponseFor([newToolDraft(""), weather])).toEqual({
      ...newResponseDraft("get_weather"),
      argsJson: '{"city":"","days":0}',
    });
    expect(newResponseFor([])).toEqual(newResponseDraft(""));
  });
});

describe("toolProblem", () => {
  it("비어 있으면 고르라고, 폼에 없으면 다시 고르라고 말한다", () => {
    expect(toolProblem(" ", ["get_weather"])).toBe("→ 어느 도구의 답인지 고르세요.");
    expect(toolProblem("get_weathr", ["get_weather"])).toBe(
      "→ 'get_weathr' 도구가 폼에 없습니다. 위 도구 목록에서 다시 고르세요.",
    );
    expect(toolProblem(" get_weather ", ["get_weather"])).toBeNull();
  });
});

describe("argsProblems", () => {
  const respond = (tool: string, argsJson: string) => ({ ...newResponseDraft(tool), argsJson });

  it("필수 입력이 빠지면 쓰이지 않는다고 말하고, 끝에 고칠 곳을 붙인다", () => {
    expect(argsProblems(respond("get_weather", "{}"), [weather])).toEqual([
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 'city' 없이 부르면 목 서버가 인자 검사에서 거절하고, 넣고 부르면 args 가 달라 이 응답은 쓰이지 않습니다.",
      TAIL,
    ]);
  });

  it("입력 필드에 없는 키는 있는 필드를 알려 준다", () => {
    expect(argsProblems(respond("get_weather", '{"city":"Seoul","town":"x"}'), [weather])).toEqual([
      "→ args 의 'town' 키는 get_weather 의 입력 필드에 없습니다. 입력 필드는 'city', 'days' 입니다.",
      TAIL,
    ]);
  });

  it("입력 필드가 없는 도구면 그렇게 말한다", () => {
    expect(argsProblems(respond("ping", '{"x":1}'), [ping])).toEqual([
      "→ args 의 'x' 키는 ping 의 입력 필드에 없습니다. 입력 필드가 없는 도구입니다.",
      TAIL,
    ]);
  });

  it("빠진 필수 입력을 먼저, 모르는 키를 args 순서로 적는다", () => {
    expect(argsProblems(respond("get_weather", '{"b":1,"a":2}'), [weather])).toEqual([
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 'city' 없이 부르면 목 서버가 인자 검사에서 거절하고, 넣고 부르면 args 가 달라 이 응답은 쓰이지 않습니다.",
      "→ args 의 'b' 키는 get_weather 의 입력 필드에 없습니다. 입력 필드는 'city', 'days' 입니다.",
      "→ args 의 'a' 키는 get_weather 의 입력 필드에 없습니다. 입력 필드는 'city', 'days' 입니다.",
      TAIL,
    ]);
  });

  it("맞으면 아무 말도 하지 않는다", () => {
    expect(argsProblems(respond("get_weather", '{"city":"Seoul"}'), [weather])).toEqual([]);
  });

  it("선택 입력이 빈 문자열이면 그 응답이 좁게만 쓰인다고 말한다. 다른 문제가 없으면 그 줄만 있다", () => {
    expect(argsProblems(respond("get_weather", '{"city":"Seoul","days":""}'), [weather])).toEqual([
      "→ 선택 입력 'days' 값이 비어 있습니다. 이 응답은 args 가 똑같은 호출에만 쓰이므로, 'days' 없이 부르는 호출에 쓰려면 이 키를 지우세요.",
    ]);
  });

  it("필수 누락과 선택 빈 값이 같이 있으면 누락 · 꼬리 · 빈 값 순서다", () => {
    expect(argsProblems(respond("get_weather", '{"days":""}'), [weather])).toEqual([
      "→ args 에 get_weather 의 필수 입력 'city' 값이 없습니다. 'city' 없이 부르면 목 서버가 인자 검사에서 거절하고, 넣고 부르면 args 가 달라 이 응답은 쓰이지 않습니다.",
      TAIL,
      "→ 선택 입력 'days' 값이 비어 있습니다. 이 응답은 args 가 똑같은 호출에만 쓰이므로, 'days' 없이 부르는 호출에 쓰려면 이 키를 지우세요.",
    ]);
  });

  it.each([
    ["인자 무관", { ...respond("get_weather", "{}"), anyArgs: true }],
    ["폼에 없는 도구", respond("nope", "{}")],
    ["읽을 수 없는 args", respond("get_weather", "{")],
    ["객체가 아닌 args", respond("get_weather", "[]")],
    ["스키마를 못 읽는 JSON 모드", respond("search", "{}")],
  ])("%s 면 말하지 않는다", (_, response) => {
    expect(argsProblems(response, [weather, { ...jsonTool, schemaJson: "{" }])).toEqual([]);
  });
});
