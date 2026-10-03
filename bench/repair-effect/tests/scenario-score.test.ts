import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseServerScenarios, scoreChecks } from "../src/lib/scenario-score.ts";

test("모든 check 가 SUCCESS 면 통과", () => {
  assert.equal(scoreChecks([{ id: "a", status: "SUCCESS" }, { id: "b", status: "SUCCESS" }]), "pass");
});

test("WARNING 과 INFO 는 통과로 친다", () => {
  assert.equal(scoreChecks([{ id: "a", status: "SUCCESS" }, { id: "b", status: "WARNING" }, { id: "c", status: "INFO" }]), "pass");
});

test("FAILURE 가 하나라도 있으면 실패", () => {
  assert.equal(scoreChecks([{ id: "a", status: "SUCCESS" }, { id: "b", status: "FAILURE" }]), "fail");
});

test("check 가 없으면 실패", () => {
  assert.equal(scoreChecks([]), "fail");
});

test("모르는 상태값은 실패로 본다", () => {
  assert.equal(scoreChecks([{ id: "a", status: "ERROR" }]), "fail");
  assert.equal(scoreChecks([{ id: "a", status: "SKIPPED" }]), "fail");
});

test("list 출력에서 서버 시나리오만 뽑는다", () => {
  const text = readFileSync(new URL("./fixtures/list-output.txt", import.meta.url), "utf8");
  assert.deepEqual(parseServerScenarios(text), [
    "dns-rebinding-protection",
    "json-schema-2020-12",
    "server-initialize",
    "tools-list",
  ]);
});
