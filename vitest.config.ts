import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 워크스페이스 패키지를 소스로 해석한다. `tsconfig.base.json`의 `paths`와 같은 목록이어야 한다.
 *
 * 각 패키지의 `exports`는 `dist`만 가리키므로, 이 alias가 없으면 테스트가 빌드 산출물을 요구한다.
 * CI의 verify 잡은 `build` 없이 `pnpm test`를 돌리기 때문에(빌드는 별도 잡) 런타임 import 하나만
 * 빠져도 `Failed to resolve entry for package`로 죽는다. 타입체크는 tsconfig paths로 통과하므로
 * 목록이 어긋나면 타입체크 녹색과 테스트 실패가 동시에 나타난다.
 */
const workspaceAliases = Object.fromEntries(
  (["core", "runner", "generate", "record", "mock"] as const).map((name) => [
    `@ohmymcp/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  ]),
);

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
  },
});
