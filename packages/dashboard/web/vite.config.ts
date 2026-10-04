import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * 이 설정 파일의 `test.include`는 `web` 디렉터리 기준 상대경로다. `pnpm vitest run --config`는
 * 프로세스 cwd(레포 루트)를 기준으로 삼으므로, `root`를 명시하지 않으면 `tests/**`가 아무 것도
 * 못 찾는다. Vite build도 `root`가 없으면 cwd 기준으로 index.html을 찾아 마찬가지로 깨진다.
 */
const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * 테스트가 값으로 import 하는 워크스페이스 패키지를 소스로 해석한다. 각 패키지의 `exports` 는 `dist` 만
 * 가리키고, CI 의 verify 잡은 `build` 없이 `pnpm test` 를 돌린다. 이 alias 가 없으면 로컬은 남아 있는
 * `dist` 로 녹색이고 CI 만 `Failed to resolve entry for package` 로 죽는다. 루트 `vitest.config.ts` 의
 * alias 는 이 프로젝트에 내려오지 않는다(이 파일을 프로젝트 설정으로 그대로 읽는다).
 *
 * `audit` 의 소스가 `core` 를 값으로 import 하므로 둘을 함께 적는다. `test.alias` 에만 둔다. 번들에는
 * 영향을 주지 않는다. web 소스는 이 패키지들을 타입으로만 import 한다.
 */
const testAliases = Object.fromEntries(
  (["audit", "core"] as const).map((name) => [
    `@mcpeak/${name}`,
    fileURLToPath(new URL(`../../${name}/src/index.ts`, import.meta.url)),
  ]),
);

/**
 * Vite 설정이면서 동시에 vitest 설정이다.
 *
 * 루트 `vitest.config.ts`의 `include`는 packages 아래 각 패키지의 tests 디렉터리까지만 잡고 `web/tests/`는
 * 잡지 못한다(계획 문서 확인 사항). 루트 vitest 설정은 T3 범위 밖이라 건드릴 수 없으므로,
 * 이 파일 자체에 `test` 블록을 둬 `pnpm vitest run --config packages/dashboard/web/vite.config.ts`로
 * 독립 실행한다. 동시에 `pnpm --filter @mcpeak/dashboard build`가 실행하는
 * `vite build web --outDir ../dist/web`도 이 파일을 Vite 설정으로 그대로 읽는다.
 */
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:7357",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    alias: testAliases,
    // .tsx도 잡는다. UI 구현계획(U0~U4)의 컴포넌트 테스트가 tests/*.test.tsx라서
    // .ts만 잡으면 그 파일들이 0개 수집된 채 초록으로 보인다(검사 대상 0개 거짓 신호).
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
