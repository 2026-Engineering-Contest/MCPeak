import type { McpClient } from "@ohmymcp/core";
import type { RunnerReport, TestSuiteSpec } from "@ohmymcp/runner";
import { RunnerPayloadLimitError, renderReport, runSuite } from "@ohmymcp/runner";

/**
 * 승인 직전에 후보 명세를 실제 서버에 한 번 돌린다. 화면에 아무것도 쓰지 않고 결과만 돌려준다.
 * 진행 표시와 stderr 꼬리는 호출 측(`generate-command`)의 몫이다. 이 모듈은 `McpClient` 만 안다.
 *
 * 실패 사유 문장을 여기서 만들지 않는다. `renderReport` 가 만든 케이스 블록을 그대로 담는다.
 * 같은 실패를 `test` 에서 볼 때와 `generate` 에서 볼 때 문장이 갈리면 사용자가 두 번 배운다.
 */

export interface DryRunCaseOutcome {
  readonly caseId: string;
  /** 화면에 쓰는 이름. `cases[].name` 을 그대로 옮긴다. */
  readonly caseName: string;
  readonly status: "passed" | "failed" | "timedOut" | "cancelled" | "notRun";
  /** 실패 사유 문장. `renderReport` 가 만든 케이스 블록을 그대로 담는다. 통과면 빈 문자열이다. */
  readonly detail: string;
}

export interface DryRunResult {
  readonly outcomes: readonly DryRunCaseOutcome[];
  /** 시험 실행 자체가 끝까지 못 간 경우. 케이스 판정과 다른 실패다. */
  readonly aborted?: {
    readonly reason: "connectionLost" | "payloadLimit";
    readonly detail: string;
  };
}

export interface RunDryRunOptions {
  readonly client: McpClient;
  readonly suite: TestSuiteSpec;
}

/** 보고서가 상한을 넘긴 경우의 안내. 케이스 수 말고는 사용자가 손댈 수 있는 것이 없다. */
const PAYLOAD_LIMIT_DETAIL = "보고서가 1MB 상한을 넘었습니다. 케이스 수를 줄인 뒤 다시 시도하세요.";

/** 툴 이름조차 알 수 없을 때의 안내. `runSuite` 가 통째로 던진 경우다. */
const CONNECTION_LOST_DETAIL = "MCP 서버 연결이 끊겼습니다.";

/** `renderReport` 의 진단·단언 줄 들여쓰기. reporter.ts 의 INDENT 와 같은 값이다. */
const INDENT = "    ";

/**
 * `renderReport` 출력에서 케이스별 블록을 잘라 낸다. 반환 배열의 순서와 길이는
 * `report.cases` 와 같다.
 *
 * 문장을 다시 만들지 않고 잘라 내기만 하는 것이 요점이다. 케이스 머리글 줄은 버린다.
 * 호출 측이 자기 번호와 이름으로 머리글을 다시 그리기 때문이고, 그대로 두면 같은 이름이
 * 두 줄 나온다.
 *
 * 경계 판정은 들여쓰기다. `renderReport` 는 케이스 본문 줄을 전부 4칸 들여쓰고 머리글만
 * 기호로 시작한다. 메시지 안의 개행은 렌더러가 이미 이스케이프하므로 본문 줄이 임의로
 * 늘어나지 않는다.
 */
const caseBlocks = (report: RunnerReport): readonly string[] => {
  const blocks: string[][] = [];
  // 0번은 제목 줄, 1번은 빈 줄이다. 케이스 구역은 그다음 빈 줄 앞에서 끝난다.
  for (const line of renderReport(report).split("\n").slice(2)) {
    if (line === "") break;
    if (line.startsWith(INDENT)) blocks.at(-1)?.push(line);
    else blocks.push([]);
  }
  return report.cases.map((_, index) => (blocks[index] ?? []).join("\n"));
};

/**
 * 연결이 끊긴 케이스의 위치를 찾는다. `runSuite` 는 호출이 던져도 멈추지 않고 다음 케이스로
 * 가므로, 서버가 죽으면 남은 케이스가 전부 같은 오류로 채워진다. 첫 번째만 사실이고 나머지는
 * 그 결과다. 그래서 첫 지점에서 자른다.
 */
const firstConnectionLoss = (
  report: RunnerReport,
): { readonly index: number; readonly message: string } | undefined => {
  for (const [index, result] of report.cases.entries()) {
    const diagnostic = result.operation.diagnostic;
    if (result.operation.status === "failed" && diagnostic?.code === "OPERATION_FAILED") {
      return { index, message: diagnostic.message };
    }
  }
  return undefined;
};

const toResult = (report: RunnerReport): DryRunResult => {
  const blocks = caseBlocks(report);
  const outcomes = report.cases.map((result, index) => ({
    caseId: result.spec.id,
    caseName: result.spec.name,
    status: result.status,
    detail: blocks[index] ?? "",
  }));
  const lost = firstConnectionLoss(report);
  if (lost === undefined) return { outcomes };
  return {
    // 끊긴 케이스까지는 남긴다. 그 길이가 곧 "몇 번째에서 끊겼는가" 이고 호출 측이 화면에 쓴다.
    outcomes: outcomes.slice(0, lost.index + 1),
    aborted: { reason: "connectionLost", detail: lost.message },
  };
};

/**
 * 후보 명세 전량을 실행한다. 케이스를 골라내지 않는다. 설계 문서 §4.4 가 근거다.
 * 실행 순서는 `cases` 배열 순서이고 정렬하지 않는다.
 */
export async function runDryRun(options: RunDryRunOptions): Promise<DryRunResult> {
  let report: RunnerReport;
  try {
    report = await runSuite({ client: options.client, suite: options.suite }).report;
  } catch (error) {
    return {
      outcomes: [],
      aborted: {
        reason: error instanceof RunnerPayloadLimitError ? "payloadLimit" : "connectionLost",
        detail:
          error instanceof RunnerPayloadLimitError ? PAYLOAD_LIMIT_DETAIL : CONNECTION_LOST_DETAIL,
      },
    };
  }
  return toResult(report);
}
