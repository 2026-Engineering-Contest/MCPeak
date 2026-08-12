import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@ohmymcp/runner": fileURLToPath(new URL("./packages/runner/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/tests/**/*.test.ts"],
  },
});
