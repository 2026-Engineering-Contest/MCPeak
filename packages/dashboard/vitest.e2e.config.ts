import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { NEEDS_BUILD, resolve } from "../../vitest.config.js";

/**
 * 빌드 산출물을 실제로 띄우는 스펙 전용 설정. `pnpm --filter @mcpeak/dashboard test:e2e`
 * 가 이것을 물고, CI 는 **`build` 잡에서만** 부른다.
 *
 * 루트 `vitest.config.ts` 의 `e2e` 갈래에서 이 파일을 뺀 이유가 여기 있다 — `verify` 잡은
 * `pnpm build` 없이 돌고 워크스페이스 별칭이 패키지를 **소스로** 해석하므로, `dist/` 가
 * 없는 상태에서 `relayBinPath()` 가 가리키는 중계기를 띄울 수 없다. 거기 두면 이유 없이
 * 빨개진다. `.github/workflows/ci.yml` 의 "Verify built …" 스텝들과 같은 판단이다.
 *
 * `resolve` 도 `include` 도 루트에서 **가져온다.** 목록이 두 벌이 되면 한쪽만 고쳐지는
 * 날이 오고, 루트의 `NEEDS_BUILD` 에서 빠진 스펙은 루트 e2e 갈래에서도 제외되지 않으므로
 * 두 곳 중 어디서도 안 도는 상태가 조용히 생긴다.
 */
export default defineConfig({
  resolve,
  test: {
    name: "e2e-build",
    root: fileURLToPath(new URL("../..", import.meta.url)),
    include: NEEDS_BUILD,
    // 실프로세스 스펙이다. 파일끼리도 직렬로 둔다 — 루트 e2e 갈래와 같은 이유(#119).
    fileParallelism: false,
  },
});
