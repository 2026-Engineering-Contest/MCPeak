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

/**
 * 변경 하나의 경로와 나머지 문장(계획서 §6.2 표의 문장 그대로). 화면이 경로만 `<code>` 로 그린다.
 * `text` 는 경로 뒤에 이어지는 부분이고 앞 공백이 없다.
 */
export function describeChangeParts(change: ToolChange): {
  readonly path: string;
  readonly text: string;
} {
  switch (change.kind) {
    case "schema-key-removed":
      return {
        path: change.path,
        text: `에서 '${change.key}' 키를 지웠습니다. 검증 의미는 같습니다.`,
      };
    case "description-cleaned":
      return {
        path: change.path,
        text: `설명을 정리했습니다: "${change.before}" → "${change.after}"`,
      };
    case "description-removed":
      return {
        path: change.path,
        text: `설명을 지웠습니다(${REASON_TEXT[change.reason]}): "${change.before}"`,
      };
  }
}

/** 변경 하나를 한국어 한 줄로. 경로와 문장을 공백 하나로 잇는다(백틱 없음). */
export function describeChange(change: ToolChange): string {
  const { path, text } = describeChangeParts(change);
  return `${path} ${text}`;
}

export type DiffLine =
  | { readonly kind: "same"; readonly text: string }
  | { readonly kind: "removed"; readonly text: string }
  | { readonly kind: "added"; readonly text: string };

/**
 * 줄 단위 LCS. `before` 배열은 원본의 모든 줄(same·removed), `after` 배열은 압축의 모든 줄(same·added)
 * 이다. 줄 순서는 입력 그대로다. LCS 가 여럿이면 앞쪽 줄을 먼저 맞춘다(결정론).
 *
 * 도구 정의 JSON 은 줄 수가 작아 O(n·m) 표로 충분하다.
 */
export function diffLines(
  before: string,
  after: string,
): { readonly before: readonly DiffLine[]; readonly after: readonly DiffLine[] } {
  const a = before.split("\n");
  const b = after.split("\n");
  const width = b.length + 1;
  // table[i * width + j] 는 a[i..] 와 b[j..] 의 LCS 길이다. 마지막 행과 열은 0 이다.
  const table = new Uint32Array((a.length + 1) * width);
  const lcs = (i: number, j: number): number => table[i * width + j] ?? 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j] ? lcs(i + 1, j + 1) + 1 : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }

  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const removed = a[i];
    const added = b[j];
    if (removed !== undefined && removed === added) {
      left.push({ kind: "same", text: removed });
      right.push({ kind: "same", text: added });
      i += 1;
      j += 1;
    } else if (added !== undefined && (removed === undefined || lcs(i, j + 1) >= lcs(i + 1, j))) {
      // 길이가 같으면 압축 쪽 줄을 먼저 넘긴다. 원본의 지금 줄이 남아 있어 그 줄이 먼저 맞는다.
      right.push({ kind: "added", text: added });
      j += 1;
    } else if (removed !== undefined) {
      left.push({ kind: "removed", text: removed });
      i += 1;
    }
  }
  return { before: left, after: right };
}
