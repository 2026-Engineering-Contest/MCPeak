import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOverlay } from "../src/overlay.js";
import { OptimizeError } from "../src/types.js";

/**
 * `parseOverlay` 는 프록시가 오버레이 파일을 받는 유일한 관문이다. 여기서 막지 못한 파일은
 * 프록시가 낡거나 깨진 정의로 서비스하게 만든다. 실패 문장은 §7.3 의 "<원인 한 줄>" 자리에
 * 그대로 들어가므로 한 줄이어야 하고, 어느 필드가 무엇이어야 하는지 말해야 한다.
 */

const LABEL = "server.optimize.json";

/** T1 의 optimize() 가 실제로 낸 파일. 올바른 오버레이의 기준이다. */
function validOverlay(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL("./fixtures/synthetic.expected.overlay.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

/** 던진 오류가 OVERLAY_INVALID 인지 확인하고 문장을 돌려준다. */
function rejects(raw: unknown): string {
  try {
    parseOverlay(raw, LABEL);
  } catch (error) {
    expect(error).toBeInstanceOf(OptimizeError);
    expect((error as OptimizeError).code).toBe("OVERLAY_INVALID");
    const message = (error as Error).message;
    expect(message.includes("\n"), `원인은 한 줄이어야 합니다: ${message}`).toBe(false);
    return message;
  }
  throw new Error("잘못된 오버레이인데 통과했다.");
}

describe("parseOverlay", () => {
  it("optimize() 가 낸 오버레이를 그대로 받는다", () => {
    const raw = validOverlay();
    expect(parseOverlay(raw, LABEL)).toEqual(raw);
  });

  it("schemaVersion 이 다르면 기대값과 실제값을 함께 말한다", () => {
    expect(rejects({ ...validOverlay(), schemaVersion: 2 })).toBe(
      `${LABEL}: 'schemaVersion' 값이 형식에 맞지 않습니다. 기대: 1, 실제: 2`,
    );
  });

  it("tools 가 없으면 tools 자리를 가리킨다", () => {
    const { tools: _omitted, ...raw } = validOverlay();
    expect(rejects(raw)).toBe(
      `${LABEL}: 'tools' 값이 형식에 맞지 않습니다. 기대: 배열, 실제: (없음)`,
    );
  });

  it("source.toolNames 가 없으면 그 경로를 가리킨다", () => {
    const raw = validOverlay();
    const { toolNames: _omitted, ...source } = raw.source as Record<string, unknown>;
    expect(rejects({ ...raw, source })).toBe(
      `${LABEL}: 'source.toolNames' 값이 형식에 맞지 않습니다. 기대: 배열, 실제: (없음)`,
    );
  });
});
