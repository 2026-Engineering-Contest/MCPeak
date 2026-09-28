import type { JsonValue } from "../../../src/api-types.js";
import { isBlankResult, newResponseDraft, type ResponseDraft, type ToolDraft } from "./draft.js";
import { FIELD_TYPES, type FieldType } from "./schema-fields.js";

/**
 * 응답 줄의 args 가 도구와 맞는지 그 줄에서 말한다(설계 §사용 훑기 반영 U1 · U3 · U4).
 *
 * 목 서버는 부를 때 인자를 `inputSchema` 로 먼저 검사한다(ADR-0048). 그래서 필수 입력이 빠진
 * args 를 적은 응답은 어떤 호출에도 쓰이지 않는다 — 그 입력 없이 부르면 검사에서 거절되고,
 * 넣고 부르면 args 가 달라 걸리지 않는다. 저장은 막지 않는다. 판단은 사람이 한다.
 */

/** 도구의 입력 필드 하나. JSON 모드에서 타입을 모르면 `null`. */
export interface InputField {
  readonly name: string;
  readonly type: FieldType | null;
  readonly required: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFieldType(value: unknown): value is FieldType {
  return typeof value === "string" && (FIELD_TYPES as readonly string[]).includes(value);
}

/** JSON 모드에서 `properties` 를 읽을 수 없으면 `null` — 그때는 아무 말도 하지 않는다. */
export function inputFields(tool: ToolDraft): readonly InputField[] | null {
  if (tool.schemaMode === "fields") {
    return tool.fields
      .filter((field) => field.name.trim() !== "")
      .map((field) => ({ name: field.name, type: field.type, required: field.required }));
  }
  let schema: unknown;
  try {
    schema = JSON.parse(tool.schemaJson);
  } catch {
    return null;
  }
  if (!isRecord(schema)) return null;
  const properties = schema.properties ?? {};
  if (!isRecord(properties)) return null;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  return Object.entries(properties).map(([name, property]) => ({
    name,
    type: isRecord(property) && isFieldType(property.type) ? property.type : null,
    required: required.includes(name),
  }));
}

/** 같은 이름이 둘이면 첫 도구. 중복은 저장 때 따로 걸린다. */
export function findTool(tools: readonly ToolDraft[], name: string): ToolDraft | undefined {
  const wanted = name.trim();
  return tools.find((tool) => tool.name.trim() === wanted);
}

const BLANK: Readonly<Record<FieldType, JsonValue>> = {
  string: "",
  number: 0,
  integer: 0,
  boolean: false,
};

/** args 가 비었거나 `{}` 일 때만 도구의 입력 필드로 채운다. 사람이 적은 args 는 덮지 않는다. */
export function prefillArgs(response: ResponseDraft, tool: ToolDraft | undefined): ResponseDraft {
  if (tool === undefined || !isBlankResult(response.argsJson)) return response;
  const fields = inputFields(tool);
  if (fields === null || fields.length === 0) return response;
  const args: Record<string, JsonValue> = {};
  for (const field of fields) args[field.name] = field.type === null ? null : BLANK[field.type];
  return { ...response, argsJson: JSON.stringify(args) };
}

/** [응답 추가] 의 새 줄. 이름이 있는 첫 도구를 고르고 args 를 채운다. */
export function newResponseFor(tools: readonly ToolDraft[]): ResponseDraft {
  const first = tools.find((tool) => tool.name.trim() !== "");
  return prefillArgs(newResponseDraft(first?.name.trim() ?? ""), first);
}

/** 응답 줄의 도구가 폼에 없을 때 그 줄에 띄울 문장(U4). 맞으면 `null`. */
export function toolProblem(tool: string, toolNames: readonly string[]): string | null {
  const name = tool.trim();
  if (name === "") return "→ 어느 도구의 답인지 고르세요.";
  return toolNames.includes(name)
    ? null
    : `→ '${name}' 도구가 폼에 없습니다. 위 도구 목록에서 다시 고르세요.`;
}

/**
 * args 가 도구의 입력 필드와 어긋나는 곳(U1 · U3). 빠진 필수 입력을 필드 순서로, 모르는 키를
 * args 순서로 적고, 하나라도 있으면 끝에 고칠 곳을 붙인다.
 *
 * 말하지 않는 경우: 인자 무관 · 도구가 폼에 없음(U4 가 말한다) · 스키마를 못 읽음 · args 가
 * JSON 객체가 아님(저장 때의 문장이 따로 있다).
 */
export function argsProblems(
  response: ResponseDraft,
  tools: readonly ToolDraft[],
): readonly string[] {
  if (response.anyArgs) return [];
  const tool = findTool(tools, response.tool);
  if (tool === undefined) return [];
  const fields = inputFields(tool);
  if (fields === null) return [];
  let args: unknown;
  try {
    args = JSON.parse(response.argsJson);
  } catch {
    return [];
  }
  if (!isRecord(args)) return [];

  const name = tool.name.trim();
  const keys = Object.keys(args);
  const known = new Set(fields.map((field) => field.name));
  const listed =
    fields.length === 0
      ? "입력 필드가 없는 도구입니다."
      : `입력 필드는 ${fields.map((field) => `'${field.name}'`).join(", ")} 입니다.`;
  const lines: string[] = [];
  for (const field of fields) {
    if (field.required && !keys.includes(field.name)) {
      lines.push(
        `→ args 에 ${name} 의 필수 입력 '${field.name}' 값이 없습니다. 목 서버가 이 호출을 인자 검사에서 거절하므로 이 응답은 쓰이지 않습니다.`,
      );
    }
  }
  for (const key of keys) {
    if (!known.has(key))
      lines.push(`→ args 의 '${key}' 키는 ${name} 의 입력 필드에 없습니다. ${listed}`);
  }
  if (lines.length > 0) {
    lines.push("→ 도구에 입력 필드를 추가했거나 이름을 바꿨다면 args 도 같이 고치세요.");
  }
  return lines;
}
