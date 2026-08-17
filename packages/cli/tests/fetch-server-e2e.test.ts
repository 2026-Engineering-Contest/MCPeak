import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@ohmymcp/core", async () => import("../../core/src/index.js"));
vi.mock("@ohmymcp/runner", async () => import("../../runner/src/index.js"));
vi.mock("@ohmymcp/generate", async () => import("../../generate/src/index.js"));

/**
 * 실서버를 띄우는 E2E 다. 다른 태스크와 병렬로 돌리지 않는다.
 *
 * **`mcp<2` 로 고정한다.** Python `mcp` 2.x 에서 `McpError` 임포트가 깨져 서버가 시작조차
 * 못 하고, 그것을 우리 도구의 결함으로 오진하기 쉽다(`docs/adoption.md` §1.5).
 */
const FETCH_SERVER_ARGS = ["--with", "mcp<2", "mcp-server-fetch"] as const;

/** uvx 가 없으면 이 E2E 를 돌릴 수 없다. 조용히 통과시키지 않고 건너뛴 사실을 이름으로 남긴다. */
const hasUvx = ((): boolean => {
  try {
    execFileSync("uvx", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// uvx 가 패키지를 내려받는 첫 회차는 네트워크에 달렸다. 캐시가 있으면 몇 초에 끝난다.
const E2E_TIMEOUT_MS = 300_000;

// skip 은 러너 출력에서 초록으로 보인다. 왜 안 돌았는지 적지 않으면 "돌았는데 통과" 와
// 구분되지 않는다. 커버리지 화면에서 침묵을 거짓말로 본 것과 같은 자리다.
if (!hasUvx)
  console.warn(
    "[fetch-server-e2e] uvx 가 없어 mcp-server-fetch E2E 를 건너뜁니다. " +
      "이 실행은 계획서 완료 조건 §1.1-3(실서버에서 케이스 1개 이상)을 검증하지 않았습니다. " +
      "해결: uv 를 설치하면(https://docs.astral.sh/uv) 이 테스트가 돕니다.",
  );

describe.sequential("mcp-server-fetch E2E (실서버)", () => {
  it.skipIf(!hasUvx)(
    "exclusiveMaximum 을 가진 툴에서 케이스가 나온다 (uvx 필요)",
    async () => {
      // 이 서버는 툴이 1개고 exclusiveMaximum 을 가져 이 계획 전에는 케이스가 0개였다.
      // 계획의 완료 조건 §1.1-3 이 이 단언이다.
      const directory = await mkdtemp(join(tmpdir(), "ohmymcp-fetch-e2e-"));
      const suitePath = join(directory, "fetch.json");
      try {
        const code = await run([
          "generate",
          "--suite-id",
          "fetch",
          "--name",
          "fetch",
          "--out",
          suitePath,
          "--command",
          "uvx",
          ...FETCH_SERVER_ARGS.flatMap((value) => ["--arg", value]),
          "--baseline-only",
        ]);
        expect(code).toBe(0);

        const suite = JSON.parse(await readFile(suitePath, "utf8")) as {
          cases: { id: string; operation: { tool: string; input: Record<string, unknown> } }[];
        };
        expect(suite.cases.length).toBeGreaterThan(0);

        const happy = suite.cases[0];
        expect(happy?.operation.tool).toBe("fetch");
        // format: "uri" 가 표에 있으므로 하드코딩 값이 그대로 들어간다. RFC 2606 예약 도메인이라
        // dry run 이 외부에 부작용을 내지 않는다.
        expect(happy?.operation.input.url).toBe("https://example.com");

        // 범위 제약이 검증 축이 됐으므로 그 축을 덮는 케이스도 함께 나와야 한다.
        expect(suite.cases.some((item) => item.id.includes("-range-"))).toBe(true);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    E2E_TIMEOUT_MS,
  );
});
