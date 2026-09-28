import type { JsonValue } from "../../../src/api-types.js";
import { type FieldDraft, fieldsToSchema, type JsonObject } from "./schema-fields.js";

/**
 * 목 만들기 폼의 상태와, 그것을 `mock.json` 으로 옮기는 순수 함수들.
 *
 * web 은 `@mcpeak/mock` 을 import 하지 않는다. 그래서 출력 모양(`MockDefinitionJson`)을 여기
 * 다시 적고, 그 정의가 맞는지는 저장할 때 서버가 `assertMockDefinition` 으로 본다. 여기서
 * 잡는 것은 **JSON 을 만들 수조차 없는 문제**(빈 이름 · 읽을 수 없는 JSON · 중복 이름)뿐이다.
 *
 * `extra` 는 폼에 칸이 없는 키다. 기존 파일에서 읽은 그대로 들고 있다가 알려진 키 **뒤에**
 * 원래 순서로 되돌려 쓴다 — 조용히 사라지면 사용자는 저장한 뒤에야 안다(설계 §기존 목 열기).
 */

export interface ToolDraft {
  readonly name: string;
  /** 공백뿐이면 저장하지 않는다. */
  readonly description: string;
  /** `fields` 면 평면 폼, `json` 이면 `schemaJson` 이 inputSchema 의 정본이다. */
  readonly schemaMode: "fields" | "json";
  readonly fields: readonly FieldDraft[];
  readonly schemaJson: string;
  readonly extra: JsonObject;
}

export interface ResponseDraft {
  /** 고른 도구의 이름. */
  readonly tool: string;
  /** 켜면 `args` 를 적지 않는다 — 목이 인자를 가리지 않는다(ANY). */
  readonly anyArgs: boolean;
  readonly argsJson: string;
  readonly resultJson: string;
  readonly isError: boolean;
  /**
   * 녹화본에서 가져온 result 인가. `mock.json` 에는 실리지 않는다. body URL 경고를 녹화 응답에만
   * 띄우는 데 쓴다 — 손으로 친 값에 "녹화 때 가려지지 않는 자리" 라고 말하면 틀린 문장이다.
   */
  readonly origin: "manual" | "recording";
  readonly extra: JsonObject;
}

export interface MockDraft {
  readonly tools: readonly ToolDraft[];
  readonly responses: readonly ResponseDraft[];
  readonly extra: JsonObject;
}

export const EMPTY_MOCK_DRAFT: MockDraft = { tools: [], responses: [], extra: {} };

export function newToolDraft(name = ""): ToolDraft {
  return { name, description: "", schemaMode: "fields", fields: [], schemaJson: "", extra: {} };
}

export function newResponseDraft(tool = ""): ResponseDraft {
  return {
    tool,
    anyArgs: false,
    argsJson: "{}",
    resultJson: "{}",
    isError: false,
    origin: "manual",
    extra: {},
  };
}

/** `@mcpeak/mock` 의 `ToolDef` 와 같은 모양 + 보존 키. 키 순서는 name · description · inputSchema · 보존 키. */
export interface MockToolJson {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: JsonValue;
  readonly [key: string]: JsonValue | undefined;
}

/** `@mcpeak/mock` 의 `MockResponse` 와 같은 모양 + 보존 키. 키 순서는 tool · args · result · isError · 보존 키. */
export interface MockResponseJson {
  readonly tool: string;
  readonly args?: JsonValue;
  readonly result: JsonValue;
  readonly isError?: true;
  readonly [key: string]: JsonValue | undefined;
}

export interface MockDefinitionJson {
  readonly tools: readonly MockToolJson[];
  readonly responses: readonly MockResponseJson[];
  readonly [key: string]:
    | JsonValue
    | undefined
    | readonly MockToolJson[]
    | readonly MockResponseJson[];
}

export type BuildResult =
  | { readonly ok: true; readonly definition: MockDefinitionJson }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * JSON.parse 의 오류 문구는 엔진마다 다르다. 싣지 않고 **무엇을 볼지**만 말한다 — 같은 입력에
 * 같은 문장이 나와야 한다.
 */
const JSON_HINT = "따옴표·쉼표·괄호 짝을 확인하세요.";

function parseJson(text: string): { readonly value: JsonValue } | null {
  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch {
    return null;
  }
}

function fieldProblems(label: string, fields: readonly FieldDraft[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  fields.forEach((field, index) => {
    const name = field.name.trim();
    if (name === "") {
      problems.push(`${label} 의 입력 필드 ${index + 1}번 이름이 비어 있습니다.`);
      return;
    }
    if (seen.has(name)) problems.push(`${label} 에 입력 필드 '${name}' 이(가) 두 번 있습니다.`);
    seen.add(name);
  });
  return problems;
}

/**
 * 초안 → 목 정의. 문제는 멈추지 않고 **전부** 모은다 — 저장을 누를 때마다 하나씩 알게 하면
 * 사용자는 같은 버튼을 문제 수만큼 누른다. 순서는 도구 → 응답, 각 안에서는 화면 순서다.
 */
export function buildMockDefinition(draft: MockDraft): BuildResult {
  const errors: string[] = [];
  const tools: MockToolJson[] = [];
  const seenTools = new Set<string>();

  draft.tools.forEach((tool, index) => {
    const name = tool.name.trim();
    const label = name === "" ? `도구 ${index + 1}번` : `도구 '${name}'`;
    if (name === "") {
      errors.push(
        `도구 ${index + 1}번의 이름이 비어 있습니다. 목이 tools/list 로 내보낼 이름을 적으세요.`,
      );
    }
    let inputSchema: JsonValue | undefined;
    if (tool.schemaMode === "json") {
      const parsed = parseJson(tool.schemaJson);
      if (parsed === null) {
        errors.push(`${label} 의 입력 스키마 JSON 을 읽을 수 없습니다. ${JSON_HINT}`);
      } else {
        inputSchema = parsed.value;
      }
    } else {
      const problems = fieldProblems(label, tool.fields);
      errors.push(...problems);
      if (problems.length === 0) {
        inputSchema = fieldsToSchema(
          tool.fields.map((field) => ({ ...field, name: field.name.trim() })),
        );
      }
    }
    if (name !== "" && seenTools.has(name)) {
      errors.push(`${label} 이(가) 두 번 있습니다. 목은 이름으로 도구를 찾으므로 하나로 합치세요.`);
    }
    if (name !== "") seenTools.add(name);
    if (inputSchema === undefined) return;
    const description = tool.description.trim();
    tools.push({
      name,
      ...(description === "" ? {} : { description }),
      inputSchema,
      ...tool.extra,
    });
  });

  const responses: MockResponseJson[] = [];
  draft.responses.forEach((response, index) => {
    const tool = response.tool.trim();
    if (tool === "") {
      errors.push(`응답 ${index + 1}번의 도구를 고르세요.`);
      return;
    }
    const label = `응답 ${index + 1}번 ('${tool}')`;
    const args = response.anyArgs ? undefined : parseJson(response.argsJson);
    if (args === null) {
      errors.push(
        `${label} 의 args JSON 을 읽을 수 없습니다. ${JSON_HINT} 인자를 가리지 않으려면 "인자 무관" 을 켜세요.`,
      );
    }
    const result = parseJson(response.resultJson);
    if (result === null) errors.push(`${label} 의 result JSON 을 읽을 수 없습니다. ${JSON_HINT}`);
    if (args === null || result === null) return;
    responses.push({
      tool,
      ...(args === undefined ? {} : { args: args.value }),
      result: result.value,
      ...(response.isError ? { isError: true as const } : {}),
      ...response.extra,
    });
  });

  return errors.length === 0
    ? { ok: true, definition: { tools, responses, ...draft.extra } }
    : { ok: false, errors };
}

/** 저장 바이트. 키 순서는 `buildMockDefinition` 이 고정하므로 같은 초안이면 같은 바이트다. */
export function serializeMockDefinition(definition: MockDefinitionJson): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

/** 녹화본에서 고른 응답. `argsJson` 이 `null` 이면 인자 무관(ANY)이다. */
export interface PickedResponse {
  readonly tool: string;
  readonly argsJson: string | null;
  readonly body: JsonValue;
}

/**
 * 고른 응답을 "응답 추가" 한 줄로 넣는다. 본문은 **가공 없이** result 에 들어간다 — 필요 없는
 * 필드를 지우는 것은 사람이 한다(설계 §목적). 도구가 폼에 없으면 이름만 채운 도구도 함께 넣는다.
 */
export function addPickedResponse(draft: MockDraft, pick: PickedResponse): MockDraft {
  const tool = pick.tool.trim();
  const hasTool = draft.tools.some((existing) => existing.name.trim() === tool);
  return {
    ...draft,
    tools: hasTool ? draft.tools : [...draft.tools, newToolDraft(tool)],
    responses: [
      ...draft.responses,
      {
        ...newResponseDraft(tool),
        anyArgs: pick.argsJson === null,
        argsJson: pick.argsJson ?? "{}",
        resultJson: JSON.stringify(pick.body, null, 2),
        origin: "recording",
      },
    ],
  };
}

/** 이미 있는 응답 줄의 result 만 녹화 본문으로 바꾼다. 도구 · args · isError 는 그대로다. */
export function replaceResult(draft: MockDraft, index: number, body: JsonValue): MockDraft {
  return {
    ...draft,
    responses: draft.responses.map((response, i) =>
      i === index
        ? { ...response, resultJson: JSON.stringify(body, null, 2), origin: "recording" as const }
        : response,
    ),
  };
}

/** 바꾸기 전에 확인을 받지 않아도 되는 result 인가 — 비었거나 새 응답의 기본값 `{}` 이다. */
export function isBlankResult(resultJson: string): boolean {
  const trimmed = resultJson.trim();
  return trimmed === "" || trimmed === "{}";
}

/** 보존 키가 있으면 알리는 문장. 없으면 `null`. */
export function preservedKeysNote(extra: JsonObject): string | null {
  const keys = Object.keys(extra);
  return keys.length === 0
    ? null
    : `폼에 칸이 없는 키 ${keys.length}개를 그대로 보존합니다: ${keys.join(", ")}`;
}

/** `GET` · `PUT /api/mocks/<path>`. 경로 전체를 한 세그먼트로 인코딩한다(`/api/suites` 와 같은 규칙). */
export function mockFilePath(path: string): string {
  return `/api/mocks/${encodeURIComponent(path)}`;
}
