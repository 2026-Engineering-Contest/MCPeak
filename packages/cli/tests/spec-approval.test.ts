import type { TestSuiteSpec } from "@ohmymcp-hsu/runner";
import { suiteFingerprint } from "@ohmymcp-hsu/runner";
import { describe, expect, it } from "vitest";
import {
  caseApprovalStatus,
  checkSpecApproval,
  renderSpecApproval,
  type SpecApprovalResult,
  shouldShowSpecApproval,
} from "../src/spec-approval.js";

const suite: TestSuiteSpec = { schemaVersion: 1, id: "suite", name: "Suite", cases: [] };
/** 지문은 상수로 박지 않는다. 위 명세 리터럴이 바뀌면 단언도 같이 깨져야 한다. */
const fingerprint = suiteFingerprint(suite);
const WRONG_FINGERPRINT = "0".repeat(64);
const approved = (value: string): TestSuiteSpec => ({ ...suite, approval: { fingerprint: value } });

describe("checkSpecApproval", () => {
  it("approval 이 없으면 absent 이고 approvedFingerprint 키가 없다", () => {
    const result = checkSpecApproval(suite);
    expect(result.state).toBe("absent");
    expect(Object.hasOwn(result, "approvedFingerprint")).toBe(false);
  });
  it("approval.fingerprint 가 계산값과 같으면 matched 다", () => {
    expect(checkSpecApproval(approved(fingerprint))).toEqual({
      state: "matched",
      fingerprint,
      approvedFingerprint: fingerprint,
    });
  });
  it("approval.fingerprint 가 다르면 mismatched 이고 두 값이 모두 들어 있다", () => {
    expect(checkSpecApproval(approved(WRONG_FINGERPRINT))).toEqual({
      state: "mismatched",
      fingerprint,
      approvedFingerprint: WRONG_FINGERPRINT,
    });
  });
  it("fingerprint 는 항상 64자 hex 다", () => {
    for (const value of [suite, approved(fingerprint), approved(WRONG_FINGERPRINT)])
      expect(checkSpecApproval(value).fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("spec-approval / 케이스 판정", () => {
  const withCases = (): TestSuiteSpec => ({
    ...suite,
    approval: {
      fingerprint,
      cases: [
        { id: "ok-case", status: "passed" },
        { id: "broken-case", status: "serverDefect" },
      ],
    },
  });

  it("approval.cases 가 없으면 판정 조회가 undefined 다", () => {
    expect(caseApprovalStatus(approved(fingerprint), "ok-case")).toBeUndefined();
    expect(caseApprovalStatus(suite, "ok-case")).toBeUndefined();
  });
  it("serverDefect 인 id 를 조회하면 serverDefect 다", () => {
    expect(caseApprovalStatus(withCases(), "broken-case")).toBe("serverDefect");
    expect(caseApprovalStatus(withCases(), "ok-case")).toBe("passed");
  });
  it("cases 에 없는 id 를 조회하면 undefined 다", () => {
    expect(caseApprovalStatus(withCases(), "지워진-케이스")).toBeUndefined();
  });
});

describe("shouldShowSpecApproval", () => {
  const result = (state: SpecApprovalResult["state"]): SpecApprovalResult =>
    state === "absent"
      ? { state, fingerprint }
      : {
          state,
          fingerprint,
          approvedFingerprint: state === "matched" ? fingerprint : WRONG_FINGERPRINT,
        };

  it("전부 통과 + matched 면 침묵한다", () => {
    expect(shouldShowSpecApproval(result("matched"), true)).toBe(false);
  });
  it("전부 통과 + absent 면 침묵한다", () => {
    expect(shouldShowSpecApproval(result("absent"), true)).toBe(false);
  });
  it("전부 통과 + mismatched 면 표시한다", () => {
    expect(shouldShowSpecApproval(result("mismatched"), true)).toBe(true);
  });
  it("실패가 있고 matched 면 표시한다", () => {
    expect(shouldShowSpecApproval(result("matched"), false)).toBe(true);
  });
  it("실패가 있고 absent 면 표시한다", () => {
    expect(shouldShowSpecApproval(result("absent"), false)).toBe(true);
  });
  it("실패가 있고 mismatched 면 표시한다", () => {
    expect(shouldShowSpecApproval(result("mismatched"), false)).toBe(true);
  });
});

describe("renderSpecApproval", () => {
  const matched = renderSpecApproval(checkSpecApproval(approved(fingerprint)));
  const absent = renderSpecApproval(checkSpecApproval(suite));
  const mismatched = renderSpecApproval(checkSpecApproval(approved(WRONG_FINGERPRINT)));

  it("matched 문장은 앞 12자와 말줄임표를 담는다", () => {
    expect(matched.startsWith("명세: 승인 시점과 동일 (")).toBe(true);
    expect(matched).toBe(`명세: 승인 시점과 동일 (${fingerprint.slice(0, 12)}…)\n`);
    expect(matched).not.toContain(fingerprint);
  });
  it("absent 문장 2줄이 설계 문서 §7.2 와 같다", () => {
    expect(absent).toBe(
      "명세: 승인 지문이 없습니다 (미고정)\n" +
        "  → ohmymcp generate 로 승인한 명세가 아니거나 승인 이전 버전으로 만든 파일입니다.\n",
    );
  });
  it("mismatched 문장 3줄이 설계 문서 §7.2 와 같고 두 값이 각각 앞 12자다", () => {
    expect(mismatched).toBe(
      "명세: 승인 시점 이후 변경됨\n" +
        `  → 승인 ${WRONG_FINGERPRINT.slice(0, 12)}…   현재 ${fingerprint.slice(0, 12)}…\n` +
        "  → 실패 원인에서 명세 변경을 배제할 수 없습니다. 명세 diff 를 먼저 확인하세요.\n",
    );
  });
  it("세 문장 모두 개행으로 끝난다", () => {
    for (const text of [matched, absent, mismatched]) expect(text.endsWith("\n")).toBe(true);
  });
  it("반환에 ANSI 이스케이프가 없다", () => {
    // 지문은 우리가 만든 hex 라 제어 문자가 섞일 수 없고, 색도 입히지 않는다. 설계 문서 §7.2.
    for (const text of [matched, absent, mismatched]) expect(text.includes("\u001b")).toBe(false);
  });
});
