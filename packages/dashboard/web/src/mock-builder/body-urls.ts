import type { JsonValue } from "../../../src/api-types.js";
import type { MockDraft } from "./draft.js";

/**
 * body 안의 URL 문자열은 녹화 때 **가려지지 않는다**(ADR-0062). 녹화본은 개수만 세고 값은
 * 저장하지 않으므로 `loadSession` 결과에 그 정보가 없다. 그래서 가져온 본문을 여기서 다시 센다.
 *
 * 판정은 record 가 녹화 때 쓰는 것과 같다(`runtime.mjs` 의 `absoluteHttpUrl`): 문자열 **전체**가
 * http(s) 절대 URL 인 값만, 서로 다른 값의 개수. 기준이 다르면 화면과 녹화 요약이 다른 수를 말한다.
 * 값은 모으기만 하고 화면에 따로 내놓지 않는다 — 경고가 새 유출 경로가 되면 안 된다.
 */
function isAbsoluteHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

function collect(value: JsonValue, found: Set<string>): void {
  if (typeof value === "string") {
    if (isAbsoluteHttpUrl(value)) found.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value as readonly JsonValue[]) collect(item, found);
    return;
  }
  if (value !== null && typeof value === "object") {
    // 값만 본다. 키 이름은 대상이 아니다(record 와 같다).
    for (const item of Object.values(value as { readonly [key: string]: JsonValue })) {
      collect(item, found);
    }
  }
}

export function countBodyUrls(value: JsonValue): number {
  const found = new Set<string>();
  collect(value, found);
  return found.size;
}

function parsedOrUndefined(text: string): JsonValue | undefined {
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/** 응답 한 줄의 result 에 든 URL 수. 읽을 수 없는 JSON 은 0 이다 — 그 문제는 조립이 말한다. */
export function responseUrlCount(resultJson: string): number {
  const parsed = parsedOrUndefined(resultJson);
  return parsed === undefined ? 0 : countBodyUrls(parsed);
}

/** 녹화본에서 가져온 응답들의 result 전체에서 서로 다른 URL 수. */
export function recordingUrlCount(draft: MockDraft): number {
  const found = new Set<string>();
  for (const response of draft.responses) {
    if (response.origin !== "recording") continue;
    const parsed = parsedOrUndefined(response.resultJson);
    if (parsed !== undefined) collect(parsed, found);
  }
  return found.size;
}

/**
 * 경고 문장. 저장을 막지 않는다 — 판정은 사람이 한다(설계 §표시 억제).
 * `response` 는 응답 한 줄 아래, `definition` 은 저장 버튼 위에 뜬다.
 */
export function bodyUrlWarning(count: number, place: "response" | "definition"): readonly string[] {
  if (count === 0) return [];
  return place === "response"
    ? [
        `→ 이 응답 본문에 URL 이 ${count}개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.`,
        "→ 저장 전에 result 에서 해당 값을 확인하세요.",
      ]
    : [
        `→ 녹화본에서 가져온 result 에 URL 이 ${count}개 있습니다. 녹화 때 가려지지 않는 자리라 자격증명이 담겼을 수 있습니다.`,
        "→ 저장은 막지 않습니다. 값을 확인한 뒤 저장하세요.",
      ];
}
