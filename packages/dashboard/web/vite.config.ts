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
 * Vite 설정이면서 동시에 vitest 설정이다.
 *
 * 루트 `vitest.config.ts`의 `include`는 packages 아래 각 패키지의 tests 디렉터리까지만 잡고 `web/tests/`는
 * 잡지 못한다(계획 문서 확인 사항). 루트 vitest 설정은 T3 범위 밖이라 건드릴 수 없으므로,
 * 이 파일 자체에 `test` 블록을 둬 `pnpm vitest run --config packages/dashboard/web/vite.config.ts`로
 * 독립 실행한다. 동시에 `pnpm --filter @ohmymcp-hsu/dashboard build`가 실행하는
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
    include: ["tests/**/*.test.ts"],
  },
});
