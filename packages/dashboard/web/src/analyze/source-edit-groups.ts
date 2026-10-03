import type { SourceEditResult, SourceEditStatus } from "../../../src/api-types.js";
import { describeChangeParts } from "./tool-diff.js";

export interface SourceEditGroup {
  readonly status: SourceEditStatus;
  /** 변경의 경로(`change.path`). */
  readonly path: string;
  /** `describeChangeParts(change).text`. */
  readonly text: string;
  readonly detail: string;
  /** 이 묶음에 든 도구 이름. 응답 순서 그대로이고 같은 이름이 두 번 올 수 있다. */
  readonly tools: readonly string[];
}

/**
 * 상태·경로·변경 문장·사유가 전부 같은 결과를 한 묶음으로 합친다. 묶음 순서는 `ready` 가 먼저이고,
 * 같은 쪽 안에서는 처음 나온 순서다(안정 정렬).
 */
export function groupSourceEditResults(
  results: readonly SourceEditResult[],
): readonly SourceEditGroup[] {
  // Map 은 넣은 순서를 지킨다. 묶음의 자리는 그 묶음이 처음 나온 자리다.
  const byKey = new Map<string, { readonly group: SourceEditGroup; readonly tools: string[] }>();
  for (const result of results) {
    const { path, text } = describeChangeParts(result.change);
    // 네 값을 배열째 직렬화한다. 구분자로 이으면 값 안의 구분자 때문에 다른 묶음이 겹칠 수 있다.
    const key = JSON.stringify([result.status, path, text, result.detail]);
    const found = byKey.get(key);
    if (found !== undefined) {
      found.tools.push(result.tool);
      continue;
    }
    const tools = [result.tool];
    byKey.set(key, {
      group: { status: result.status, path, text, detail: result.detail, tools },
      tools,
    });
  }
  const groups = [...byKey.values()].map((entry) => entry.group);
  return [
    ...groups.filter((group) => group.status === "ready"),
    ...groups.filter((group) => group.status !== "ready"),
  ];
}

/** 묶음의 도구 표기. 1개면 그 이름, 2개 이상이면 `${첫 이름} 외 ${n - 1}개`. */
export function toolsLabel(tools: readonly string[]): string {
  const [first = ""] = tools;
  return tools.length > 1 ? `${first} 외 ${tools.length - 1}개` : first;
}
