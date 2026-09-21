import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { relayBinPath } from "../src/index.js";

/** 패키지 루트. `tests/` 의 한 칸 위다. */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

describe("relayBinPath", () => {
  it("package.json 의 bin 을 패키지 루트 기준으로 해석한다", () => {
    // 경로를 여기 다시 적지 않는다. 매니페스트와 **어긋나지 않는 것**이 계약이고,
    // 문자열을 박아 두면 bin 을 바꿀 때 이 테스트가 같이 틀려서 아무것도 안 잡는다.
    expect(relayBinPath()).toBe(join(ROOT, manifest.bin["mcpeak-relay"] ?? ""));
  });

  it("절대경로를 돌려준다 — 대시보드가 임시 cwd 에서 spawn 한다", () => {
    expect(isAbsolute(relayBinPath())).toBe(true);
  });

  it("소스로 돌 때도 dist 산출물을 가리킨다", () => {
    // vitest 는 `src/index.ts` 를 읽는다. `src/relay.mjs` 는 없으므로, 여기서 `src/` 를
    // 가리키면 발행본과 소스 실행이 갈린다. 실측으로 닫은 자리다(계획서 머리).
    expect(relayBinPath()).toBe(join(ROOT, "dist", "relay.mjs"));
  });
});
