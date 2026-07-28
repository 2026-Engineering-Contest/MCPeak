import { defineConfig } from "tsdown";

// 이 파일은 의도적으로 .mjs 이고, build 스크립트는 --config-loader native 를 쓴다.
// tsdown 은 process.features.typescript 유무로 설정 로더를 자동 선택하는데,
// 그러면 같은 설정 파일이 실행 환경에 따라 다른 경로로 로드된다. native 로
// 고정해 그 분기를 없앤다(결정론성, CLAUDE.md). native 로더는 순수 ESM 만
// 읽으므로 설정 파일은 .ts 가 아니라 .mjs 여야 한다.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
