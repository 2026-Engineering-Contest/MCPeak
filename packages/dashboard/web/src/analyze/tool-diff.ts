import type { ToolDef } from "@mcpeak/core";
import type { AnalyzeTokensResponse } from "../../../src/api-types.js";

/**
 * 토큰 탭의 도구별 before/after 비교(계획서 2026-10-03 단계화면-비교 §3.1). web 은
 * `@mcpeak/core`·`@mcpeak/optimize` 를 타입으로만 import 한다(번들에 서버 코드가 섞인다).
 */

type ToolChange = AnalyzeTokensResponse["overlay"]["tools"][number]["changes"][number];
type RemovedReason = Extract<ToolChange, { kind: "description-removed" }>["reason"];

/** 비교에 보일 세 필드. 오버레이 바이트 계산과 같은 범위다. */
export interface ToolSide {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}

/** 2칸 들여쓰기 JSON. `description` 이 없으면 키를 싣지 않는다. 키 순서는 name, description, inputSchema. */
export function formatToolSide(tool: ToolSide): string {
  return JSON.stringify(
    {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      inputSchema: tool.inputSchema,
    },
    null,
    2,
  );
}

/** 이름으로 원본을 찾는다. 없으면 undefined(화면은 "원본 정의를 찾지 못했습니다." 를 보인다). */
export function findSourceTool(sourceTools: readonly ToolDef[], name: string): ToolDef | undefined {
  return sourceTools.find((tool) => tool.name === name);
}

const REASON_TEXT: Record<RemovedReason, string> = {
  "restates-name": "이름을 되풀이함",
  empty: "비어 있음",
  "duplicate-of-tool-description": "도구 설명과 같음",
  promoted: "공통 파라미터로 서버 instructions 에 옮김",
};

/** 변경 하나를 한국어 한 줄로. 계획서 §3.1 표의 문장을 글자 그대로 쓴다. */
export function describeChange(change: ToolChange): string {
  switch (change.kind) {
    case "schema-key-removed":
      return `\`${change.path}\` 에서 '${change.key}' 키를 지웠습니다. 검증 의미는 같습니다.`;
    case "description-cleaned":
      return `\`${change.path}\` 설명을 정리했습니다: "${change.before}" → "${change.after}"`;
    case "description-removed":
      return `\`${change.path}\` 설명을 지웠습니다(${REASON_TEXT[change.reason]}): "${change.before}"`;
  }
}
