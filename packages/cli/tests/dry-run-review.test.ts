import { describe, expect, it } from "vitest";
import type { DryRunCaseOutcome, DryRunResult } from "../src/dry-run.js";
import { reviewDryRun } from "../src/dry-run-review.js";
import type { ReviewIO } from "../src/generate-command.js";
import type { RepairAttempt } from "../src/repair-target.js";

interface FakeIO extends ReviewIO {
  /** 화면에 찍힌 전문. */
  readonly output: () => string;
  /** `input` 이 불린 횟수. 되묻기를 세는 데 쓴다. */
  readonly inputCalls: () => number;
}

/** 답변을 순서대로 돌려주는 인메모리 IO. 답변이 떨어지면 테스트가 실패하도록 던진다. */
const fakeIO = (answers: readonly string[]): FakeIO => {
  const written: string[] = [];
  const queue = [...answers];
  let calls = 0;
  return {
    interactive: true,
    output: () => written.join(""),
    inputCalls: () => calls,
    async input(message) {
      calls += 1;
      written.push(message);
      const answer = queue.shift();
      if (answer === undefined) throw new Error("예상보다 많이 물었습니다.");
      return answer;
    },
    async choose() {
      throw new Error("이 화면은 choose 를 쓰지 않습니다.");
    },
    async confirm() {
      throw new Error("이 화면은 confirm 을 쓰지 않습니다.");
    },
    write(text) {
      written.push(text);
    },
  };
};

const outcome = (
  caseId: string,
  status: DryRunCaseOutcome["status"],
  detail = "",
): DryRunCaseOutcome => ({
  caseId,
  caseName: `${caseId} 케이스`,
  status,
  detail,
  rejectionBasis: "notApplicable",
});

const resultOf = (outcomes: readonly DryRunCaseOutcome[]): DryRunResult => ({ outcomes });

describe("reviewDryRun", () => {
  it("실패 0건이면 사용자에게 아무것도 묻지 않고 cleared true 다", async () => {
    const io = fakeIO([]);
    const result = await reviewDryRun(io, resultOf([outcome("a", "passed")]));
    expect(result.cleared).toBe(true);
    expect(io.inputCalls()).toBe(0);
    expect(io.output()).toBe("");
  });

  it("실패 0건이면 통과 케이스가 전부 approvals 에 passed 로 들어간다", async () => {
    const result = await reviewDryRun(
      fakeIO([]),
      resultOf([outcome("a", "passed"), outcome("b", "passed")]),
    );
    expect(result.approvals).toEqual([
      { id: "a", status: "passed" },
      { id: "b", status: "passed" },
    ]);
    expect(result.specErrors).toEqual([]);
  });

  it("실패 케이스에 s 를 고르면 approvals 에 serverDefect 로 들어간다", async () => {
    const result = await reviewDryRun(
      fakeIO(["s"]),
      resultOf([outcome("a", "passed"), outcome("b", "failed", "    isError  기대와 다릅니다.")]),
    );
    expect(result.cleared).toBe(true);
    expect(result.approvals).toEqual([
      { id: "a", status: "passed" },
      { id: "b", status: "serverDefect" },
    ]);
  });

  it("실패 케이스에 m 을 고르면 cleared false 이고 specErrors 에 caseId 가 있다", async () => {
    const result = await reviewDryRun(
      fakeIO(["m"]),
      resultOf([outcome("a", "passed"), outcome("b", "failed")]),
    );
    expect(result.cleared).toBe(false);
    expect(result.specErrors).toEqual(["b"]);
  });

  it("실패 케이스에 ? 를 고르면 cleared false 이고 specErrors 가 비어 있다", async () => {
    const result = await reviewDryRun(fakeIO(["?"]), resultOf([outcome("b", "failed")]));
    expect(result.cleared).toBe(false);
    expect(result.specErrors).toEqual([]);
  });

  it("cleared 가 false 면 approvals 가 빈 배열이다", async () => {
    const result = await reviewDryRun(
      fakeIO(["s", "m"]),
      resultOf([outcome("a", "failed"), outcome("b", "failed")]),
    );
    expect(result.cleared).toBe(false);
    expect(result.approvals).toEqual([]);
  });

  it("approvals 순서가 outcomes 순서와 같다", async () => {
    const result = await reviewDryRun(
      fakeIO(["s"]),
      resultOf([outcome("a", "passed"), outcome("b", "failed"), outcome("c", "passed")]),
    );
    expect(result.approvals.map((approval) => approval.id)).toEqual(["a", "b", "c"]);
  });

  it("대문자 S 도 서버 결함으로 받는다", async () => {
    const result = await reviewDryRun(fakeIO(["S"]), resultOf([outcome("b", "failed")]));
    expect(result.approvals).toEqual([{ id: "b", status: "serverDefect" }]);
  });

  it("앞뒤 공백이 있어도 받는다", async () => {
    const result = await reviewDryRun(fakeIO(["  s  "]), resultOf([outcome("b", "failed")]));
    expect(result.cleared).toBe(true);
  });

  it("x 를 주면 같은 질문을 다시 묻는다", async () => {
    const io = fakeIO(["x", "s"]);
    const result = await reviewDryRun(io, resultOf([outcome("b", "failed")]));
    expect(io.inputCalls()).toBe(2);
    expect(result.cleared).toBe(true);
  });

  it("aborted 가 있으면 아무것도 묻지 않고 cleared false 다", async () => {
    const io = fakeIO([]);
    const result = await reviewDryRun(io, {
      outcomes: [outcome("a", "passed"), outcome("b", "failed")],
      aborted: { reason: "connectionLost", detail: "툴 'add' 호출 중 오류가 발생했습니다." },
    });
    expect(result).toEqual({ cleared: false, approvals: [], specErrors: [] });
    expect(io.inputCalls()).toBe(0);
    expect(io.output()).toBe("");
  });

  it("요약 줄에 0건인 종류가 안 나온다", async () => {
    const io = fakeIO(["s", "s"]);
    await reviewDryRun(io, resultOf([outcome("a", "failed"), outcome("b", "failed")]));
    // 선택지 줄에도 같은 낱말이 나오므로 요약 줄만 떼어 본다. 요약 앞의 조각은 마지막 질문의
    // 프롬프트다. 개행은 실제 터미널에서 사용자의 엔터가 만든다.
    const summary = io.output().slice(io.output().indexOf("  분류:"));
    expect(summary).toBe("  분류: 서버 결함 2건\n");
  });

  it("실패 케이스 번호가 1 부터 매겨진다", async () => {
    const io = fakeIO(["s", "s"]);
    await reviewDryRun(
      io,
      resultOf([outcome("a", "passed"), outcome("b", "failed"), outcome("c", "failed")]),
    );
    expect(io.output()).toContain("  [1] b 케이스\n");
    expect(io.output()).toContain("  [2] c 케이스\n");
    expect(io.output()).not.toContain("[3]");
  });

  it("선택지 문안이 설계 문서 §8.3 과 같다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(io, resultOf([outcome("b", "failed", "    isError  기대와 다릅니다.")]));
    expect(io.output()).toBe(
      [
        // 실패 사유는 결과 화면(§8.2)이 이미 같은 번호로 보여줬다. 여기서 다시 찍지 않는다.
        "  [1] b 케이스\n",
        "      [s] 서버 결함  명세가 옳다. 이 케이스를 회귀 테스트로 남긴다\n",
        "      [m] 명세 오류  추측이 틀렸다. 저장 전에 고친다\n",
        "      [?] 판단 보류  분류를 미룬다. 저장은 막힌다\n",
        "      선택: ",
        "\n",
        "  분류: 서버 결함 1건\n",
      ].join(""),
    );
  });
});

const attempt = (field: string, value: RepairAttempt["value"]): RepairAttempt => ({
  field,
  value,
  passed: false,
});

const historyOf = (
  entries: Readonly<Record<string, readonly RepairAttempt[]>>,
): ReadonlyMap<string, readonly RepairAttempt[]> => new Map(Object.entries(entries));

/** 실패 케이스 한 건짜리 실행. 이력 블록만 떼어 보기 좋게 고정한다. */
const oneFailure = (caseId = "b"): DryRunResult =>
  resultOf([outcome(caseId, "failed", "    isError  기대와 다릅니다.")]);

describe("reviewDryRun / 시도 이력", () => {
  it("attempts 를 안 넘기면 화면이 지금과 같다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(io, oneFailure());

    expect(io.output()).toBe(
      [
        "  [1] b 케이스\n",
        "      [s] 서버 결함  명세가 옳다. 이 케이스를 회귀 테스트로 남긴다\n",
        "      [m] 명세 오류  추측이 틀렸다. 저장 전에 고친다\n",
        "      [?] 판단 보류  분류를 미룬다. 저장은 막힌다\n",
        "      선택: ",
        "\n",
        "  분류: 서버 결함 1건\n",
      ].join(""),
    );
  });

  it("이력이 있으면 선택지 위에 이력 블록이 나온다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(
      io,
      oneFailure(),
      historyOf({ b: [attempt("city", "example"), attempt("city", "서울")] }),
    );

    expect(io.output()).toBe(
      [
        "  [1] b 케이스\n",
        "      입력값을 두 번 고쳐 봤지만 결과가 같습니다.\n",
        '        city: "example" → 오류\n',
        '        city: "서울" → 오류\n',
        "\n",
        "      [s] 서버 결함  명세가 옳다. 이 케이스를 회귀 테스트로 남긴다\n",
        "      [m] 명세 오류  추측이 틀렸다. 저장 전에 고친다\n",
        "      [?] 판단 보류  분류를 미룬다. 저장은 막힌다\n",
        "      선택: ",
        "\n",
        "  분류: 서버 결함 1건\n",
      ].join(""),
    );
  });

  it("시도가 1건이면 '한 번' 이라고 나온다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(io, oneFailure(), historyOf({ b: [attempt("city", "example")] }));

    expect(io.output()).toContain("      입력값을 한 번 고쳐 봤지만 결과가 같습니다.\n");
  });

  it("시도가 2건이면 '두 번' 이라고 나온다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(
      io,
      oneFailure(),
      historyOf({ b: [attempt("city", "example"), attempt("city", "서울")] }),
    );

    expect(io.output()).toContain("      입력값을 두 번 고쳐 봤지만 결과가 같습니다.\n");
  });

  it("값이 JSON.stringify 형태로 나온다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(
      io,
      oneFailure(),
      historyOf({ b: [attempt("city", "서울"), attempt("days", 3)] }),
    );

    expect(io.output()).toContain('"서울" → 오류\n');
    expect(io.output()).toContain("3 → 오류\n");
  });

  it("필드명 길이가 다르면 콜론이 세로로 맞는다", async () => {
    const io = fakeIO(["s"]);
    await reviewDryRun(
      io,
      oneFailure(),
      historyOf({ b: [attempt("city", "서울"), attempt("timezone", "KST")] }),
    );

    expect(io.output()).toContain('        city    : "서울" → 오류\n');
    expect(io.output()).toContain('        timezone: "KST" → 오류\n');
  });

  it("이력이 없는 케이스에는 블록이 안 나온다", async () => {
    const io = fakeIO(["s", "s"]);
    await reviewDryRun(
      io,
      resultOf([outcome("a", "failed"), outcome("b", "failed")]),
      historyOf({ b: [attempt("city", "서울")] }),
    );

    const first = io.output().slice(0, io.output().indexOf("  [2]"));
    expect(first).not.toContain("입력값을");
    expect(io.output()).toContain("  [2] b 케이스\n      입력값을 한 번 고쳐 봤지만");
  });

  it("이력이 붙어도 반환값 규칙이 그대로다", async () => {
    const result = await reviewDryRun(
      fakeIO(["s"]),
      resultOf([outcome("a", "passed"), outcome("b", "failed")]),
      historyOf({ b: [attempt("city", "서울")] }),
    );

    expect(result).toEqual({
      cleared: true,
      approvals: [
        { id: "a", status: "passed" },
        { id: "b", status: "serverDefect" },
      ],
      specErrors: [],
    });
  });
});
