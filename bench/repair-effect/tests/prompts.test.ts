import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE_PROMPT, buildPrompt } from "../src/lib/prompts.ts";

test("plain 은 기본 프롬프트 그대로", () => {
  assert.equal(buildPrompt("plain", null), BASE_PROMPT);
});

test("plain 은 진단을 받아도 무시한다", () => {
  assert.equal(buildPrompt("plain", "진단"), BASE_PROMPT);
});

test("diagnosed 는 기본 프롬프트로 시작하고 진단 전문을 담는다", () => {
  const out = buildPrompt("diagnosed", "원인: test_simple_text 가 text 를 빠뜨림");
  assert.ok(out.startsWith(BASE_PROMPT));
  assert.ok(out.includes("원인: test_simple_text 가 text 를 빠뜨림"));
});

test("diagnosed 인데 진단이 없으면 실패를 못 찾았다고 알린다", () => {
  const out = buildPrompt("diagnosed", null);
  assert.ok(out.startsWith(BASE_PROMPT));
  assert.ok(out.includes("mcpeak 은 이 서버에서 실패를 찾지 못했다."));
});

test("기본 프롬프트는 설계 문서의 문장과 같다", () => {
  assert.equal(
    BASE_PROMPT,
    "이 디렉터리의 everything-server.ts 는 MCP 서버다. 이 서버가 MCP 사양을 위반하는 결함이 있다는\n보고를 받았다. 결함을 찾아 고쳐라. 결함과 관계없는 코드는 바꾸지 마라.",
  );
});
