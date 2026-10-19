import { defineConfig } from "tsdown";

// 이 파일은 의도적으로 .mjs 이고, build 스크립트는 --config-loader native 를 쓴다.
// tsdown 은 process.features.typescript 유무로 설정 로더를 자동 선택하는데,
// 그러면 같은 설정 파일이 실행 환경에 따라 다른 경로로 로드된다. native 로
// 고정해 그 분기를 없앤다(결정론성, CLAUDE.md). native 로더는 순수 ESM 만
// 읽으므로 설정 파일은 .ts 가 아니라 .mjs 여야 한다.
export default defineConfig({
  // 출력 경로를 **객체로 명시한다.** 배열로 두면 tsdown 이 entry 들의 공통 디렉터리를 루트로
  // 잡으므로, entry 가 늘거나 줄면 그 루트가 바뀌어 산출물 경로가 조용히 옮겨간다. 발행된
  // 경로가 entry 목록의 변화에 끌려가는 것은 결정론성 문제다(CLAUDE.md). 여기서 못 박는다.
  //
  // preload 가 별도 entry 인 것이 요점이다. `child-env.ts` 는 자식의 NODE_OPTIONS 에 넣을
  // 경로를 `new URL("./child/preload.mjs", import.meta.url)` 로 가리키므로, 출력이
  // `dist/index` 옆의 `dist/child/preload.mjs` 에 있어야 상대 경로가 맞는다.
  entry: {
    index: "src/index.ts",
    "child/preload": "src/child/preload.mjs",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
