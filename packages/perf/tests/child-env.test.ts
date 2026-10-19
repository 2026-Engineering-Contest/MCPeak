import { describe, expect, it } from "vitest";
import { childEnvironment, PERF_TRACE_DIR_ENV } from "../src/child-env.js";

/** `child-env.ts` 가 `import.meta.url` 기준으로 가리키는 프리로드의 URL. 테스트 파일에서 같은 파일을 가리킨다. */
const PRELOAD_URL = new URL("../src/child/preload.mjs", import.meta.url).href;

describe("childEnvironment", () => {
  it("NODE_OPTIONS 는 기존 값 뒤에 덧붙인다", () => {
    const env = childEnvironment({
      traceDir: "/tmp/trace",
      existingNodeOptions: "--max-old-space-size=4096",
    });
    expect(env.NODE_OPTIONS).toBe(`--max-old-space-size=4096 --import=${PRELOAD_URL}`);
    expect(env.NODE_OPTIONS).toMatch(
      /^--max-old-space-size=4096 --import=file:\/\/.*\/child\/preload\.mjs$/,
    );
  });

  it("기존 값이 없으면 import 만", () => {
    expect(childEnvironment({ traceDir: "/tmp/trace" }).NODE_OPTIONS).toBe(
      `--import=${PRELOAD_URL}`,
    );
    expect(
      childEnvironment({ traceDir: "/tmp/trace", existingNodeOptions: undefined }).NODE_OPTIONS,
    ).toBe(`--import=${PRELOAD_URL}`);
    expect(childEnvironment({ traceDir: "/tmp/trace", existingNodeOptions: "" }).NODE_OPTIONS).toBe(
      `--import=${PRELOAD_URL}`,
    );
  });

  it("MCPEAK_PERF_TRACE_DIR 이 traceDir", () => {
    const env = childEnvironment({ traceDir: "/tmp/trace-dir" });
    expect(PERF_TRACE_DIR_ENV).toBe("MCPEAK_PERF_TRACE_DIR");
    expect(env[PERF_TRACE_DIR_ENV]).toBe("/tmp/trace-dir");
  });

  it("반환 객체의 키는 NODE_OPTIONS 와 MCPEAK_PERF_TRACE_DIR 둘뿐이다", () => {
    const env = childEnvironment({ traceDir: "/tmp/trace", existingNodeOptions: "--no-warnings" });
    expect(Object.keys(env).sort()).toEqual(["MCPEAK_PERF_TRACE_DIR", "NODE_OPTIONS"]);
  });
});
