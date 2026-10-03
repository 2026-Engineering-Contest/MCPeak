import { isJsonObject, type JsonObject, type StagedTool } from "./normalize.js";
import type { ToolChange } from "./types.js";

/** 계획서 §3.3 의 1: 이보다 짧은 설명은 승격해도 절감이 사전 항목 한 줄보다 작다. */
const MIN_DESCRIPTION_LENGTH = 20;
/** 계획서 §3.3 의 2: 2개는 우연히 같을 수 있다. 실험에서 3 이상은 전부 의도된 공통 인자였다. */
const MIN_TOOL_COUNT = 3;
/** 계획서 §3.3 의 4: 사전 블록 머리글. */
const DICTIONARY_HEADER = "Common parameters (shared by several tools):";

export interface PromotedParameter {
  readonly name: string;
  readonly description: string;
}

function topLevelProperties(tool: StagedTool): JsonObject | undefined {
  if (!isJsonObject(tool.inputSchema)) return undefined;
  const properties = tool.inputSchema.properties;
  return isJsonObject(properties) ? properties : undefined;
}

function promotableDescription(schema: unknown): string | undefined {
  if (!isJsonObject(schema)) return undefined;
  const description = schema.description;
  return typeof description === "string" && description.length >= MIN_DESCRIPTION_LENGTH
    ? description
    : undefined;
}

/**
 * 변환 C(계획서 §3.3). 변환 B 를 거친 목록을 받는다. 최상위 속성만 본다.
 * 사전 항목 순서는 첫 등장 도구의 순서다(Map 의 삽입 순서).
 */
export function promoteCommonParameters(
  tools: readonly StagedTool[],
  instructions: string,
): { tools: StagedTool[]; instructions: string; promoted: PromotedParameter[] } {
  const counts = new Map<string, { parameter: PromotedParameter; count: number }>();
  for (const tool of tools) {
    for (const [name, schema] of Object.entries(topLevelProperties(tool) ?? {})) {
      const description = promotableDescription(schema);
      if (description === undefined) continue;
      const key = `${name}\u0000${description}`;
      const entry = counts.get(key);
      if (entry === undefined) counts.set(key, { parameter: { name, description }, count: 1 });
      else entry.count += 1;
    }
  }
  const common = new Map(
    [...counts]
      .filter(([, entry]) => entry.count >= MIN_TOOL_COUNT)
      .map(([k, e]) => [k, e.parameter]),
  );
  if (common.size === 0) return { tools: [...tools], instructions, promoted: [] };

  const promotedTools = tools.map((tool) => {
    const properties = topLevelProperties(tool);
    if (properties === undefined) return tool;
    const changes: ToolChange[] = [];
    const nextProperties: JsonObject = {};
    for (const [name, schema] of Object.entries(properties)) {
      const description = promotableDescription(schema);
      if (description !== undefined && common.has(`${name}\u0000${description}`)) {
        const { description: _promoted, ...rest } = schema as JsonObject;
        nextProperties[name] = rest;
        changes.push({
          kind: "description-removed",
          path: `inputSchema.properties.${name}.description`,
          before: description,
          reason: "promoted",
        });
      } else {
        nextProperties[name] = schema;
      }
    }
    if (changes.length === 0) return tool;
    return {
      ...tool,
      inputSchema: { ...(tool.inputSchema as JsonObject), properties: nextProperties },
      changes: [...tool.changes, ...changes],
    };
  });

  const promoted = [...common.values()];
  const dictionary = [
    DICTIONARY_HEADER,
    ...promoted.map((p) => `- ${p.name}: ${p.description}`),
  ].join("\n");
  // 원본 끝의 개행을 걷어 내야 "빈 줄 하나"가 된다. 그대로 붙이면 빈 줄이 둘이 된다.
  const base = instructions.trimEnd();
  return {
    tools: promotedTools,
    instructions: base === "" ? dictionary : `${base}\n\n${dictionary}`,
    promoted,
  };
}
