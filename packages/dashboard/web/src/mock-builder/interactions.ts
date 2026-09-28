import type { JsonValue, SessionInteractionEntry } from "../../../src/api-types.js";

/** 외부 호출 한 건을 화면에 어떻게 보이고 고를 수 있는지. */
export type InteractionView =
  | { readonly pickable: true; readonly label: string; readonly body: JsonValue }
  | { readonly pickable: false; readonly label: string; readonly reason: string };

/**
 * 응답이 있는 호출만 고를 수 있다(설계 §녹화본에서 고를 수 있는 것). 못 고르는 행은 숨기지
 * 않고 이유를 적는다 — 빠진 행은 사용자가 녹화가 덜 됐는지 우리가 버렸는지 알 수 없다.
 *
 * url 은 녹화 때 경로가 지워진 표시용 값 그대로다. 여기서 다시 가공하지 않는다.
 */
export function describeInteraction(entry: SessionInteractionEntry): InteractionView {
  const request = `${entry.method} ${entry.url}`;
  const outcome = entry.outcome;
  switch (outcome.kind) {
    case "response":
      return { pickable: true, label: `${request} · ${outcome.status}`, body: outcome.body };
    case "throw": {
      const detail =
        outcome.code === undefined
          ? outcome.failureKind
          : `${outcome.failureKind} · ${outcome.code}`;
      return {
        pickable: false,
        label: request,
        reason: `→ 이 호출은 응답 본문이 없어 목의 답으로 쓸 수 없습니다 — fetch 가 실패했습니다 (${detail})`,
      };
    }
    case "incomplete":
      return {
        pickable: false,
        label: request,
        reason: "→ 녹화가 끝나지 않은 호출입니다. 응답이 저장되지 않아 목의 답으로 쓸 수 없습니다.",
      };
  }
}

/** `GET /api/sessions/<path>/interactions`. 경로 전체를 한 세그먼트로 인코딩한다. */
export function interactionsPath(sessionPath: string): string {
  return `/api/sessions/${encodeURIComponent(sessionPath)}/interactions`;
}
