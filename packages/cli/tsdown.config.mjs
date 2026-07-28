import { defineConfig } from "tsdown";

// 이 파일은 의도적으로 .mjs 이고, build 스크립트는 --config-loader native 를 쓴다.
// tsdown 은 process.features.typescript 가 없는 Node 20 에서 설정 로더를 unrun 으로
// 자동 선택하는데, unrun 은 설치돼 있지 않은 선택적 peer 라 빌드가 깨진다.
// native 로더는 순수 ESM 만 읽으므로 .ts 설정을 쓸 수 없다. 이 조합이라야
// Node 20/22/24 에서 로더가 동일하게 결정된다.
export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
