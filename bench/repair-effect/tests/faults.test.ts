import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { applyFault, FAULTS } from "../src/lib/faults.ts";

const source = readFileSync(new URL("../server/everything-server.ts", import.meta.url), "utf8");

test("결함은 8개이고 순서가 고정돼 있다", () => {
  assert.deepEqual(FAULTS.map((f) => f.id), ["F1", "F2", "F3", "F4", "F5", "F6", "C1", "C2"]);
});

test("도구 결함 6개, 대조 결함 2개", () => {
  assert.equal(FAULTS.filter((f) => f.area === "tool").length, 6);
  assert.equal(FAULTS.filter((f) => f.area === "control").length, 2);
});

for (const fault of FAULTS) {
  test(`${fault.id}: 치환 대상이 원본에 정확히 한 번 나온다`, () => {
    assert.equal(source.split(fault.find).length - 1, 1);
  });

  test(`${fault.id}: 주입 결과는 원본과 다르고 대상 문자열이 사라진다`, () => {
    const out = applyFault(source, fault);
    assert.notEqual(out, source);
    assert.equal(out.split(fault.find).length - 1, 0);
  });
}

test("결함 코드에 결함임을 알리는 주석이 없다", () => {
  for (const fault of FAULTS) {
    // C1 의 replace 안에는 'test://static-text' 처럼 URI 스킴의 "//" 가 그대로 들어 있다.
    // 이것은 주석이 아니므로 "://" 형태는 걸러내고 진짜 "//" 주석만 잡는다.
    assert.doesNotMatch(fault.replace, /(?<!:)\/\/|\/\*|fault|bug|결함/i);
  }
});

test("대상이 없으면 applyFault 가 던진다", () => {
  assert.throws(() => applyFault("nothing here", FAULTS[0]!), /F1/);
});
