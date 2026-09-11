import { describe, expect, it } from "vitest";
import { parseRunTally } from "../src/run-tally.js";

/**
 * 진행 카드가 믿는 숫자의 출처. **요약 줄이 없으면 null** 이 이 파일이 지키는 절반이다 —
 * 실행 중에는 케이스별 진행이 오지 않으므로(`mcpeak test` 는 끝에 한 번 쓴다) 여기서 무엇이든
 * 숫자를 내면 화면이 그 숫자를 지어낸 것이 된다.
 *
 * 줄 모양은 runner `reporter.test.ts` 가 고정한 것을 그대로 옮겼다.
 */
describe("parseRunTally", () => {
  it("요약 줄의 항목을 필드로 옮긴다", () => {
    expect(parseRunTally("2 passed, 1 failed  (3 total)")).toEqual({
      passed: 2,
      failed: 1,
      timedOut: 0,
      cancelled: 0,
      notRun: 0,
      total: 3,
    });
  });

  it("다섯 낱말을 모두 읽는다", () => {
    expect(
      parseRunTally("1 passed, 1 failed, 1 timed out, 1 cancelled, 1 not run  (5 total)"),
    ).toEqual({ passed: 1, failed: 1, timedOut: 1, cancelled: 1, notRun: 1, total: 5 });
  });

  it("보고서 한가운데의 요약 줄을 찾는다", () => {
    const report = [
      "S  (2 cases)",
      "",
      "✓ a  이름1",
      "✗ b  이름2",
      "",
      "1 passed, 1 failed  (2 total)",
      "",
    ];
    expect(parseRunTally(report.join("\n"))?.failed).toBe(1);
  });

  it("케이스가 0건이면 total 만 있는 줄도 읽는다", () => {
    expect(parseRunTally("  (0 total)")?.total).toBe(0);
  });

  it("요약 줄이 여럿이면 마지막 판정을 쓴다", () => {
    const text = "1 failed  (1 total)\n...\n1 passed  (1 total)\n";
    expect(parseRunTally(text)?.passed).toBe(1);
    expect(parseRunTally(text)?.failed).toBe(0);
  });

  it("요약 줄이 없으면 null 이다 — 실행 중의 출력이 이렇다", () => {
    expect(parseRunTally("")).toBeNull();
    expect(parseRunTally("▸ 시험 실행 중... 3/10\n✓ 통과 3건")).toBeNull();
  });

  it("항목 합이 total 과 다르면 요약 줄로 믿지 않는다", () => {
    expect(parseRunTally("2 passed  (3 total)")).toBeNull();
  });

  it("모르는 낱말이 끼면 요약 줄로 믿지 않는다", () => {
    expect(parseRunTally("2 passed, 1 skipped  (3 total)")).toBeNull();
  });
});
