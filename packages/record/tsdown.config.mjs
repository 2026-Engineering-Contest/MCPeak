import { defineConfig } from "tsdown";

// 이 파일은 의도적으로 .mjs 이고, build 스크립트는 --config-loader native 를 쓴다.
// tsdown 은 process.features.typescript 유무로 설정 로더를 자동 선택하는데,
// 그러면 같은 설정 파일이 실행 환경에 따라 다른 경로로 로드된다. native 로
// 고정해 그 분기를 없앤다(결정론성, CLAUDE.md). native 로더는 순수 ESM 만
// 읽으므로 설정 파일은 .ts 가 아니라 .mjs 여야 한다.
export default defineConfig({
  // 출력 경로를 **객체로 명시한다.** 배열로 두면 tsdown 이 entry 들의 공통 디렉터리를 루트로
  // 잡는데, 카세트(`src/index.ts`)가 사라지면서 그 루트가 `src` 에서 `src/external` 로
  // 좁아져 산출물이 `dist/external/index` → `dist/index` 로 조용히 옮겨간다. 발행된 경로가
  // 무관한 파일의 삭제에 따라 움직이는 것은 결정론성 문제다(CLAUDE.md). 여기서 못 박는다.
  //
  // bootstrap 이 별도 entry 인 것은 그대로 요점이다. Coordinator 는 자식을 띄울 때
  // `new URL("./child/bootstrap.mjs", import.meta.url)` 로 그 파일을 가리키므로, 출력이
  // `dist/external/index` 옆의 `dist/external/child/` 에 있어야 상대 경로가 맞는다.
  //
  // 자식은 별도 프로세스라 모듈 인스턴스를 공유하지 않는다. bootstrap 번들이 runtime 코드를
  // 한 벌 더 갖는 것은 중복이 아니라 자립이다 — 상대 경로가 깨질 여지가 없다.
  entry: {
    "external/index": "src/external/index.ts",
    "external/child/bootstrap": "src/external/child/bootstrap.mjs",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
