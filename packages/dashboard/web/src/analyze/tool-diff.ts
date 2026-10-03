import type { ToolDef } from "@mcpeak/core";
import type { CSSProperties } from "react";
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

/** 비교 칸의 `<pre>`. 원본·압축이 같은 모양이어야 나란히 읽힌다. */
export const DIFF_PRE_CLASS =
  "overflow-x-auto whitespace-pre rounded-sm border border-line bg-surface px-3 py-2 font-mono text-xs text-ink";

/** 줄 앞 표시 글자 한 칸. 색을 못 보는 화면에서도 지운 줄과 바뀐 줄이 갈린다. */
export const DIFF_MARK: Record<DiffLine["kind"], string> = { same: " ", removed: "-", added: "+" };

/** 지운 줄·바뀐 줄의 색. 라이트·다크 양쪽에 이미 정의된 상태 색을 그대로 쓴다. */
export const DIFF_STYLE: Record<DiffLine["kind"], CSSProperties | undefined> = {
  same: undefined,
  removed: { backgroundColor: "var(--status-failed-bg)", color: "var(--status-failed-fg)" },
  added: { backgroundColor: "var(--status-done-bg)", color: "var(--status-done-fg)" },
};

/**
 * 줄 단위 LCS 를 따라 걸은 순서. `diffLines` 와 `diffHunks` 가 같은 표와 같은 걸음을 쓴다. LCS 가
 * 여럿이면 앞쪽 줄을 먼저 맞춘다(결정론).
 *
 * 도구 정의 JSON 과 서버 스크립트는 줄 수가 작아 O(n·m) 표로 충분하다.
 */
function walkLines(before: string, after: string): readonly DiffLine[] {
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

  const steps: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    const removed = a[i];
    const added = b[j];
    if (removed !== undefined && removed === added) {
      steps.push({ kind: "same", text: removed });
      i += 1;
      j += 1;
    } else if (added !== undefined && (removed === undefined || lcs(i, j + 1) >= lcs(i + 1, j))) {
      // 길이가 같으면 압축 쪽 줄을 먼저 넘긴다. 원본의 지금 줄이 남아 있어 그 줄이 먼저 맞는다.
      steps.push({ kind: "added", text: added });
      j += 1;
    } else if (removed !== undefined) {
      steps.push({ kind: "removed", text: removed });
      i += 1;
    }
  }
  return steps;
}

/**
 * 줄 단위 LCS. `before` 배열은 원본의 모든 줄(same·removed), `after` 배열은 압축의 모든 줄(same·added)
 * 이다. 줄 순서는 입력 그대로다.
 */
export function diffLines(
  before: string,
  after: string,
): { readonly before: readonly DiffLine[]; readonly after: readonly DiffLine[] } {
  const steps = walkLines(before, after);
  return {
    before: steps.filter((line) => line.kind !== "added"),
    after: steps.filter((line) => line.kind !== "removed"),
  };
}

export interface HunkLine {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
  /** 원본 파일의 줄 번호(1 기반). added 면 undefined. */
  readonly beforeNo?: number;
  /** 고친 파일의 줄 번호(1 기반). removed 면 undefined. */
  readonly afterNo?: number;
}

/** 걸은 순서를 통합 diff 순서로 바꾸고 줄 번호를 붙인다. 같은 자리의 removed 가 added 보다 먼저다. */
function unifiedLines(steps: readonly DiffLine[]): readonly HunkLine[] {
  const lines: HunkLine[] = [];
  let beforeNo = 0;
  let afterNo = 0;
  let pendingAdded: HunkLine[] = [];
  for (const step of steps) {
    if (step.kind === "added") {
      afterNo += 1;
      pendingAdded.push({ kind: "added", text: step.text, afterNo });
    } else if (step.kind === "removed") {
      beforeNo += 1;
      lines.push({ kind: "removed", text: step.text, beforeNo });
    } else {
      lines.push(...pendingAdded);
      pendingAdded = [];
      beforeNo += 1;
      afterNo += 1;
      lines.push({ kind: "same", text: step.text, beforeNo, afterNo });
    }
  }
  lines.push(...pendingAdded);
  return lines;
}

/**
 * 파일 전체 대신 달라진 줄과 그 앞뒤 `context` 줄만 묶음으로 돌려준다. 묶음 사이가 `2 * context` 줄
 * 이하로 가까우면 하나로 합친다. 달라진 줄이 없으면 빈 배열이다.
 */
export function diffHunks(
  before: string,
  after: string,
  context = 2,
): readonly (readonly HunkLine[])[] {
  const lines = unifiedLines(walkLines(before, after));
  // 묶음의 [from, to) 범위. 문맥이 앞 묶음과 닿거나 겹치면 앞 묶음을 늘린다.
  const ranges: { from: number; to: number }[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.kind === "same") continue;
    const from = Math.max(0, index - context);
    const to = Math.min(lines.length, index + context + 1);
    const last = ranges.at(-1);
    if (last !== undefined && from <= last.to) {
      last.to = to;
    } else {
      ranges.push({ from, to });
    }
  }
  return ranges.map(({ from, to }) => lines.slice(from, to));
}
