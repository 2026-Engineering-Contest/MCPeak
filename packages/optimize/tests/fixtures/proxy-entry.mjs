// 소스 기준으로 프록시를 띄우는 테스트용 진입점. 배포되는 진입점은 src/proxy-stdio.ts 이고,
// 이 파일은 빌드 없이 **그 진입점 자체**를 실행하기 위한 것이다. CI 의 verify 잡은 빌드 없이
// `pnpm test` 를 돌리므로 @mcpeak/core 의 dist 가 없다.
//
// mock 의 stdio-entry.mjs 와 두 가지가 다르다.
//
// 1. 해석 훅을 여기서 직접 건다. mock 은 상대 ".js" → ".ts" 만 메우면 되지만, 프록시는
//    `@mcpeak/core` 를 **런타임에** import 한다(connectStdio). 베어 명세자도 소스로 돌려야
//    해서, 등록용 파일을 따로 두지 않고 in-thread 동기 훅(`module.registerHooks`, Node 22.15+)
//    으로 한 파일에 담았다.
// 2. 자식은 `--experimental-transform-types` 로 띄워야 한다. core 소스에 매개변수 프로퍼티
//    (`constructor(readonly options ...)`)가 있어 strip-only 모드는
//    ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX 로 죽는다. 배선은 tests/proxy-e2e.test.ts 의 NODE_FLAGS.
//
// 인자는 배포 진입점과 같다: <overlay.json> (-- <executable> [args...] | --url <URL>)
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const workspace = {
  "@mcpeak/core": new URL("../../../core/src/index.ts", import.meta.url).href,
};

registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(workspace, specifier)) return next(workspace[specifier], context);
    // 상대 ".js" 는 같은 자리의 ".ts" 가 실재할 때만 돌린다. 없으면 Node 가 평소의 오류를 낸다.
    if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL !== undefined) {
      const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
});

// 정적 import 는 훅 등록보다 먼저 풀리므로 동적 import 로 부른다. 진입점은 스스로 main 을 돈다.
await import("../../src/proxy-stdio.ts");
