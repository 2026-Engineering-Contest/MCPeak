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
    `@ohmymcp-hsu/${name}`,
    fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url)),
  ]),
);

const resolve = { alias: workspaceAliases };

/**
 * 실제 서버·자식 프로세스를 띄우는 스펙의 파일명 규약. 이 glob 에 걸리면 e2e 갈래로 간다.
 *
 * 갈래 판정을 러너가 하는 것이 이 분리의 요점이다(#119). 사람이 실행 순서로 지키는 규칙은
 * 새 기여자가 모르면 그대로 깨지고, 실제로 파일이 5개에서 7개로 늘어나는 동안 두 번 깨졌다.
 * 프로세스를 띄우는 스펙을 새로 쓸 때 기억할 것은 하나다: 파일명을 `*-e2e.test.ts` 로 짓는다.
 */
const E2E_GLOB = "packages/*/tests/**/*-e2e.test.ts";

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        resolve,
        test: {
          name: "unit",
          include: ["packages/*/tests/**/*.test.ts"],
          exclude: ["**/node_modules/**", E2E_GLOB],
        },
      },
      {
        resolve,
        test: {
          name: "e2e",
          include: [E2E_GLOB],
          /**
           * e2e 갈래는 파일끼리도 직렬이다(#119). `describe.sequential` 은 파일 안만
           * 직렬화하고 파일 사이는 못 막는다. 실프로세스 스펙들이 병렬로 돌면 서로의
           * 타이밍 예산을 잠식해 단독 실행 녹색·전체 실행 빨강이 난다. 같은 이유로
           * 프로세스 잔존을 프로세스 수로 판정하는 단언도 병렬에서는 남의 서버를 센다.
           */
          fileParallelism: false,
        },
      },
    ],
  },
});
