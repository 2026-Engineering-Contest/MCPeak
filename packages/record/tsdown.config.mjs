import { defineConfig } from "tsdown";

// 이 파일은 의도적으로 .mjs 이고, build 스크립트는 --config-loader native 를 쓴다.
// tsdown 은 process.features.typescript 유무로 설정 로더를 자동 선택하는데,
// 그러면 같은 설정 파일이 실행 환경에 따라 다른 경로로 로드된다. native 로
// 고정해 그 분기를 없앤다(결정론성, CLAUDE.md). native 로더는 순수 ESM 만
// 읽으므로 설정 파일은 .ts 가 아니라 .mjs 여야 한다.
export default defineConfig({
  // 세 진입점을 함께 낸다. 공통 루트가 `src` 라 출력이 `dist/index`, `dist/external/index`,
  // `dist/external/child/bootstrap` 으로 구조를 유지한다.
  //
  // bootstrap 이 별도 entry 인 것이 요점이다. Coordinator 는 자식을 띄울 때
  // `new URL("./child/bootstrap.mjs", import.meta.url)` 로 그 파일을 가리키므로, 번들에
  // 삼켜지면 가리킬 파일이 사라진다. entry 로 두면 `dist/external/` 옆에 남는다.
  //
  // 자식은 별도 프로세스라 모듈 인스턴스를 공유하지 않는다. bootstrap 번들이 runtime 코드를
  // 한 벌 더 갖는 것은 중복이 아니라 자립이다 — 상대 경로가 깨질 여지가 없다.
  entry: ["src/index.ts", "src/external/index.ts", "src/external/child/bootstrap.mjs"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
