import type { McpClient } from "@mcpeak/core";
import type { RunnerReport, TestSuiteSpec } from "@mcpeak/runner";
import {
  type RejectionBasis,
  RunnerPayloadLimitError,
  renderReport,
  runSuite,
} from "@mcpeak/runner";

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
  /**
   * 거절 근거를 확인했는가 (#89). **판정과 무관하다.** `status` 와 저장 여부를 바꾸지 않는다.
   * 승인 화면(설계 §5.2)이 `"unverified"` 인 케이스만 골라 보여준다.
   */
  readonly rejectionBasis: RejectionBasis;
  /**
   * 확인 못 한 거절의 응답 본문. `rejectionBasis` 가 `"unverified"` 여도 **없을 수 있다.**
   * 호출이 오류로 끝난 케이스는 읽을 본문이 아예 없다(설계 §4.2).
   */
  readonly rejectionBody?: string;
}

/**
 * 시험 실행이 끝까지 못 간 사유.
 *
 * - `connectionLost`: 호출이 오류로 돌아왔다. 그 지점부터 남은 케이스는 믿을 수 없다.
 * - `payloadLimit`: 케이스나 보고서가 상한을 넘겼다.
 * - `stopped`: 러너가 중간에 멈췄다(제한 시간 초과·중단 신호). 남은 케이스는 실행되지 않았다.
 */
export type DryRunAbortReason = "connectionLost" | "payloadLimit" | "stopped";

export interface DryRunResult {
  readonly outcomes: readonly DryRunCaseOutcome[];
  /** 시험 실행 자체가 끝까지 못 간 경우. 케이스 판정과 다른 실패다. */
  readonly aborted?: {
    readonly reason: DryRunAbortReason;
    readonly detail: string;
  };
}

export interface RunDryRunOptions {
  readonly client: McpClient;
  readonly suite: TestSuiteSpec;
}

/** 보고서가 상한을 넘긴 경우의 안내. 케이스 수 말고는 사용자가 손댈 수 있는 것이 없다. */
const REPORT_LIMIT_DETAIL = "보고서가 1MB 상한을 넘었습니다. 케이스 수를 줄인 뒤 다시 시도하세요.";

/**
 * 케이스 하나가 상한을 넘긴 경우의 안내. 케이스 수를 줄이라고 하면 안 된다. 넘긴 것은 그
 * 케이스 하나이고, 나머지를 지워도 같은 오류가 그대로 난다.
 */
const caseLimitDetail = (caseId: string | undefined): string =>
  `케이스${caseId === undefined ? "" : ` '${caseId}'`} 가 상한을 넘었습니다. 그 케이스의 이름·입력·단언을 줄인 뒤 다시 시도하세요.`;

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

/**
 * 러너가 케이스를 다 돌기 전에 멈춘 경우를 찾는다. `stopReason` 이 그 사실을 말한다.
 *
 * 이것을 읽지 않으면 실행되지도 않은 `notRun` 케이스가 실패 목록에 섞여 분류 화면으로 간다.
 * 사용자가 그것을 `서버 결함` 으로 고르면 서버에 보낸 적도 없는 호출이 회귀 테스트가 된다.
 */
const stopDetail = (report: RunnerReport): string | undefined => {
  const stop = report.stopReason;
  if (stop === undefined) return undefined;
  const name = report.cases.find((result) => result.spec.id === stop.caseId)?.spec.name;
  const suffix = "남은 케이스는 실행되지 않았습니다.";
  if (stop.type === "timeout")
    return `케이스 '${name ?? stop.caseId}' 가 제한 시간 안에 끝나지 않았습니다. ${suffix}`;
  return name === undefined
    ? `실행이 중단됐습니다. ${suffix}`
    : `케이스 '${name}' 에서 실행이 중단됐습니다. ${suffix}`;
};

const toResult = (report: RunnerReport): DryRunResult => {
  const blocks = caseBlocks(report);
  const outcomes = report.cases.map((result, index) => ({
    caseId: result.spec.id,
    caseName: result.spec.name,
    status: result.status,
    detail: blocks[index] ?? "",
    rejectionBasis: result.rejectionBasis,
    // 값이 없으면 키를 만들지 않는다. runner 가 같은 규칙으로 넘겨준 것을 그대로 옮긴다.
    ...(result.rejectionBody === undefined ? {} : { rejectionBody: result.rejectionBody }),
  }));
  const lost = firstConnectionLoss(report);
  if (lost !== undefined)
    return {
      // 끊긴 케이스까지는 남긴다. 그 길이가 곧 "몇 번째에서 끊겼는가" 이고 호출 측이 화면에 쓴다.
      outcomes: outcomes.slice(0, lost.index + 1),
      aborted: { reason: "connectionLost", detail: lost.message },
    };
  const stopped = stopDetail(report);
  if (stopped !== undefined)
    return {
      // 실행된 케이스까지만 남긴다. `notRun` 은 러너가 뒤에 채워 넣은 자리표시자이고 판정이
      // 아니다. 패딩은 언제나 뒤쪽에만 붙으므로 첫 `notRun` 앞에서 자르면 된다.
      outcomes: outcomes.filter((outcome) => outcome.status !== "notRun"),
      aborted: { reason: "stopped", detail: stopped },
    };
  return { outcomes };
};

/**
 * 후보 명세 전량을 실행한다. 케이스를 골라내지 않는다. 설계 문서 §4.4 가 근거다.
 * 실행 순서는 `cases` 배열 순서이고 정렬하지 않는다.
 */
export async function runDryRun(options: RunDryRunOptions): Promise<DryRunResult> {
  const execution = runSuite({ client: options.client, suite: options.suite });
  let report: RunnerReport;
  try {
    report = await execution.report;
  } catch (error) {
    if (error instanceof RunnerPayloadLimitError)
      return {
        outcomes: [],
        aborted: {
          reason: "payloadLimit",
          detail: error.scope === "report" ? REPORT_LIMIT_DETAIL : caseLimitDetail(error.caseId),
        },
      };
    return {
      outcomes: [],
      aborted: { reason: "connectionLost", detail: CONNECTION_LOST_DETAIL },
    };
  }
  // 보고서가 나와도 호출이 남아 있을 수 있다. 제한 시간을 넘긴 케이스의 요청이 그렇다.
  // 이 경로는 연결을 닫지 않고 검토 메뉴로 돌아가므로, 기다리지 않으면 그 응답이 다음 회차
  // 도중에 도착해 카세트에 섞인다. 같은 입력에 회차마다 다른 카세트가 나오는 길이다.
  //
  // `drain` 은 남은 호출이 없으면 즉시 끝난다. 기다리는 비용은 이미 무언가 잘못된 경로에서만
  // 든다. 상한을 넘겨도 판정은 바꾸지 않는다. 그때는 보고서에 이미 중단 사유가 들어 있다.
  await execution.drain;
  return toResult(report);
}
