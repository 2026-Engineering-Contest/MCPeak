import { defineConfig } from "tsdown";

// 이 파일은 의도적으로 .mjs 다. .ts 설정은 tsdown 이 로드할 때 TS 로더(unrun/tsx)를
// 요구하는데, Node 20 에는 네이티브 TS 스트리핑이 없어 빌드가 깨진다.
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
});
