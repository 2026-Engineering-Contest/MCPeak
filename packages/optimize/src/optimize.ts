import type { ToolDef } from "@mcpeak/core";
import { assertLossless } from "./lossless-gate.js";
import { normalizeTool, type StagedTool } from "./normalize.js";
import { promoteCommonParameters } from "./promote.js";
import { stripNoise } from "./strip-noise.js";
import {
  type OptimizedTool,
  type OptimizeInput,
  type OptimizeOverlay,
  OVERLAY_SCHEMA_VERSION,
} from "./types.js";

const encoder = new TextEncoder();
const utf8Bytes = (text: string) => encoder.encode(text).length;

/**
 * 도구 하나의 크기. `{name, description, input_schema}` 를 compact JSON 으로 직렬화한 UTF-8 바이트다.
 * description 이 없으면 빈 문자열로 센다. 실험 스크립트(`tok.mjs`)와 같은 기준이라야 숫자를
 * 대조할 수 있다.
 */
function toolBytes(tool: Pick<ToolDef, "name" | "description" | "inputSchema">): number {
  return utf8Bytes(
    JSON.stringify({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema,
    }),
  );
}

/** 변환은 default·enum 같은 데이터 값을 참조로 옮긴다. 결과가 입력과 객체를 공유하지 않게 복제한다. */
function toOptimizedTool(staged: StagedTool, before: number): OptimizedTool {
  return {
    name: staged.name,
    ...(staged.description === undefined ? {} : { description: staged.description }),
    inputSchema: structuredClone(staged.inputSchema),
    ...(staged.outputSchema === undefined
      ? {}
      : { outputSchema: structuredClone(staged.outputSchema) }),
    changes: staged.changes,
    bytes: { before, after: toolBytes(staged) },
  };
}

/** 순수 함수. 같은 입력에 같은 출력. 내부에서 assertLossless 를 통과시킨 뒤 반환한다. */
export function optimize(input: OptimizeInput, generatorVersion: string): OptimizeOverlay {
  // 계획서 §3: 순서는 A → B → C 로 고정한다. 바꾸면 C 의 반복 계수가 달라진다.
  const staged = input.tools.map((tool) => stripNoise(normalizeTool({ ...tool, changes: [] })));
  const promotion = promoteCommonParameters(staged, input.instructions);

  const tools = promotion.tools.map((tool, index) =>
    toOptimizedTool(tool, toolBytes(input.tools[index] as ToolDef)),
  );
  assertLossless(input.tools, tools);

  const bytesBefore = tools.reduce((sum, tool) => sum + tool.bytes.before, 0);
  const bytesAfter = tools.reduce((sum, tool) => sum + tool.bytes.after, 0);
  const instructionsGrowth = utf8Bytes(promotion.instructions) - utf8Bytes(input.instructions);
  return {
    schemaVersion: OVERLAY_SCHEMA_VERSION,
    generator: { name: "@mcpeak/optimize", version: generatorVersion },
    source: {
      toolCount: input.tools.length,
      toolNames: input.tools.map((tool) => tool.name).sort(),
      instructions: input.instructions,
      bytes: bytesBefore,
      otherCapabilities: [...input.otherCapabilities],
    },
    instructions: promotion.instructions,
    tools,
    totals: {
      bytesBefore,
      bytesAfter,
      bytesAfterWithInstructions: bytesAfter + instructionsGrowth,
      promotedParameters: promotion.promoted.length,
    },
  };
}
