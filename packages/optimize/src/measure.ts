import type { OptimizeOverlay, ToolChange } from "./types.js";

const encoder = new TextEncoder();

/** 문자열의 UTF-8 바이트 수. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

/**
 * 도구 정의 한 개의 크기. `{name, description, input_schema}` 를 compact JSON 으로 직렬화한
 * UTF-8 바이트다. description 이 없으면 JSON.stringify 가 키째 빼므로 그대로 둔다.
 */
export function measureToolBytes(tool: {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}): number {
  return utf8Bytes(
    JSON.stringify({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }),
  );
}

/** 변환별 기여(바이트). 세 값의 합이 `bytesBefore - bytesAfterWithInstructions` 와 같다. */
export interface Contributions {
  /** 무손실 정규화로 줄어든 바이트. 전체 감소에서 나머지 둘을 뺀 값이다. */
  readonly lossless: number;
  /** 잡음 제거로 줄어든 바이트. */
  readonly noise: number;
  /** 공통 파라미터 승격의 순감소. 도구에서 지운 설명에서 사전 크기를 뺀 값이라 음수일 수 있다. */
  readonly promotion: number;
  /** instructions 에 더해진 사전 크기. */
  readonly dictionary: number;
}

/**
 * compact JSON 에서 `"description":"..."` 키 하나를 지웠을 때 줄어드는 바이트.
 * 형제 키와 잇는 쉼표 1바이트를 더한다. 설명이 객체의 유일한 키였다면 1바이트 과대 계상이며,
 * 그 오차는 lossless 쪽에서 상쇄된다(합계는 항상 정확하다).
 */
function removedKeyBytes(before: string): number {
  return utf8Bytes(`"description":${JSON.stringify(before)}`) + 1;
}

function changeBytes(change: ToolChange): { noise: number; promoted: number } {
  switch (change.kind) {
    case "schema-key-removed":
      // 무손실 정규화는 따로 세지 않고 나머지 몫으로 둔다(measureContributions).
      return { noise: 0, promoted: 0 };
    case "description-cleaned":
      return {
        noise: utf8Bytes(JSON.stringify(change.before)) - utf8Bytes(JSON.stringify(change.after)),
        promoted: 0,
      };
    case "description-removed":
      switch (change.reason) {
        case "restates-name":
        case "empty":
          return { noise: removedKeyBytes(change.before), promoted: 0 };
        case "promoted":
          return { noise: 0, promoted: removedKeyBytes(change.before) };
        case "duplicate-of-tool-description":
          // 계획서 §3.1 대로 무손실 정규화에 속한다. 나머지 몫으로 들어가게 여기서는 세지 않는다.
          return { noise: 0, promoted: 0 };
      }
  }
}

/**
 * 오버레이의 changes 를 kind·reason 으로 나눠 변환별 기여를 센다.
 * 잡음 제거와 승격은 changes 에 남은 문자열로 직접 계산하고, 무손실 정규화는 지운 값을
 * changes 가 싣지 않으므로 도구 전체 감소에서 나머지를 뺀 값으로 둔다.
 */
export function measureContributions(overlay: OptimizeOverlay): Contributions {
  let noise = 0;
  let promotedRemoved = 0;
  for (const tool of overlay.tools) {
    for (const change of tool.changes) {
      const bytes = changeBytes(change);
      noise += bytes.noise;
      promotedRemoved += bytes.promoted;
    }
  }
  const { bytesBefore, bytesAfter, bytesAfterWithInstructions } = overlay.totals;
  const dictionary = bytesAfterWithInstructions - bytesAfter;
  return {
    lossless: bytesBefore - bytesAfter - noise - promotedRemoved,
    noise,
    promotion: promotedRemoved - dictionary,
    dictionary,
  };
}
