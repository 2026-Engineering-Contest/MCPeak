// 소스를 빌드 없이 raw node 로 돌리기 위한 리졸버 훅.
//
// Node 의 ESM 리졸버는 ".js" 를 ".ts" 로 매핑하지 않는다. 그래서 `src/` 를 그대로
// 실행하면 형제 모듈 import 가 ERR_MODULE_NOT_FOUND 로 죽는다. 이 훅이 그 한 칸을
// 메운다 — 상대 ".js" 명세자에 대해 같은 자리의 ".ts" 가 실재할 때만 그쪽으로 돌린다.
//
// 이것이 있어서 `src/` 는 저장소의 다른 패키지와 같은 ".js" 관례를 쓸 수 있다.
// 확장자를 ".ts" 로 쓰면 mock 을 TS 로 import 하는 소비자의 타입체크가 TS5097 로
// 깨진다 (#110). 관례를 바꾸는 대신 테스트 하네스가 비용을 진다.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function resolve(specifier, context, next) {
  // 상대 경로만 본다. 베어 명세자(@mcpeak/core 등)는 node_modules 로 가야 한다.
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL !== undefined) {
    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    // 실재할 때만 돌린다. 없으면 원래 명세자로 두어 Node 가 평소의 오류를 내게 한다.
    if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
  }
  return next(specifier, context);
}
