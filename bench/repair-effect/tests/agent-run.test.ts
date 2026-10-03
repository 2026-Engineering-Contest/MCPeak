import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { AGENT_ARGS, readUsage, runDir } from "../src/lib/agent-run.ts";
import { WORK_DIR } from "../src/lib/paths.ts";

test("AGENT_ARGS: 인자 목록이 사양과 정확히 일치한다", () => {
  const prompt = "테스트 프롬프트";
  assert.deepEqual(AGENT_ARGS(prompt), [
    "-p", prompt,
    "--restricted",
    "--tools", "Read,Edit,Write,Glob,Grep",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--permission-mode", "acceptEdits",
    "--model", "claude-sonnet-5",
    "--output-format", "stream-json",
    "--verbose",
    "--no-session-persistence",
  ]);
});

test("runDir: WORK_DIR/runs/<faultId>/<condition>/<attempt> 를 반환한다", () => {
  assert.equal(runDir("F3", "diagnosed", 2), join(WORK_DIR, "runs", "F3", "diagnosed", "2"));
  assert.equal(runDir("C1", "plain", 1), join(WORK_DIR, "runs", "C1", "plain", "1"));
});

test("readUsage: result 가 null 이면 둘 다 null", () => {
  assert.deepEqual(readUsage(null), { inputTokens: null, outputTokens: null });
});

test("readUsage: usage 필드가 없으면 둘 다 null", () => {
  assert.deepEqual(readUsage({ type: "result" }), { inputTokens: null, outputTokens: null });
});

test("readUsage: 숫자가 아니면 null 로 취급한다", () => {
  assert.deepEqual(
    readUsage({ usage: { input_tokens: "12", output_tokens: 34 } }),
    { inputTokens: null, outputTokens: 34 },
  );
});

test("readUsage: 정상 케이스", () => {
  assert.deepEqual(
    readUsage({ usage: { input_tokens: 12, output_tokens: 34 } }),
    { inputTokens: 12, outputTokens: 34 },
  );
});
