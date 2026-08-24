import type { McpClient } from "@mcpeak/core";
import type { ConnectionLostCause, RunnerReport, TestSuiteSpec } from "@mcpeak/runner";
import {
  type RejectionBasis,
  RunnerPayloadLimitError,
  renderReport,
  runSuite,
} from "@mcpeak/runner";
import { escapeTerminalText } from "./repair-render.js";

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
 * - `connectionLost`: 연결이 끝나 남은 케이스를 부를 대상이 없어졌다(#279 · ADR-0073).
 *   러너가 `stopReason` 으로 알려 준 경우와, `runSuite` 가 통째로 던진 경우가 여기 온다.
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
 * 연결 상실 사유별 문장. `runner` 의 `reporter.ts`·`junit.ts` 가 쓰는 어휘를 그대로 따른다.
 * 같은 죽음을 `test` 에서 볼 때와 `generate` 에서 볼 때 다른 낱말로 부르면 두 번 배우게 된다.
 */
const CONNECTION_LOST_TEXT: Readonly<Record<ConnectionLostCause, string>> = {
  processExited: "서버 프로세스가 종료됐습니다",
  transportFailed: "서버와의 연결이 끊겼습니다",
  httpSessionLost: "서버가 세션을 잃었습니다",
};

/**
 * 종료 코드·시그널 괄호. 둘 다 관측하지 못했으면 괄호를 만들지 않는다. `(없음)` 은 관측하지
 * 못한 것을 관측했다고 말하는 것이다. reporter.ts 의 같은 이름 함수와 같은 규칙이다.
 */
const exitParens = (stop: { readonly exitCode?: number; readonly signal?: string }): string => {
  const parts: string[] = [];
  if (stop.exitCode !== undefined) parts.push(`종료 코드 ${stop.exitCode}`);
  if (stop.signal !== undefined) parts.push(`시그널 ${escapeTerminalText(stop.signal)}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
};

/**
 * 러너가 케이스를 다 돌기 전에 멈춘 경우의 중단 사유. `stopReason` 이 그 사실을 말한다.
 *
 * 이것을 읽지 않으면 실행되지도 않은 `notRun` 케이스가 실패 목록에 섞여 분류 화면으로 간다.
 * 사용자가 그것을 `서버 결함` 으로 고르면 서버에 보낸 적도 없는 호출이 회귀 테스트가 된다.
 *
 * **연결이 끝났는지를 여기서 짐작하지 않는다.** 러너가 core 의 오류 코드로 판정해 넘겨준
 * `connectionLost` 만 연결 상실이다(#279 · ADR-0073). 예전에는 이 파일이 진단 코드가
 * `OPERATION_FAILED` 인 첫 케이스를 연결 끊김으로 읽었는데, 그 코드는 서버가 살아서 낸 평범한
 * 툴 오류에도 붙는다. 그래서 툴 하나가 오류를 내면 멀쩡히 돌아간 뒤 케이스의 판정까지 버리고
 * "연결이 끊겼습니다" 라고 말했다.
 */
const abortedFromStop = (report: RunnerReport): DryRunResult["aborted"] => {
  const stop = report.stopReason;
  if (stop === undefined) return undefined;
  // 화면에 쓰는 것은 이름이다. 이름을 못 찾으면 식별자라도 말한다 — 자리를 비우면 사용자가
  // 어느 케이스에서 멈췄는지 알 데가 없다.
  const nameOf = (caseId: string): string =>
    escapeTerminalText(
      report.cases.find((result) => result.spec.id === caseId)?.spec.name ?? caseId,
    );
  const suffix = "남은 케이스는 실행되지 않았습니다.";
  if (stop.type === "connectionLost")
    return {
      reason: "connectionLost",
      detail: `케이스 '${nameOf(stop.caseId)}' 에서 ${CONNECTION_LOST_TEXT[stop.cause]}${exitParens(stop)}. ${suffix}`,
    };
  if (stop.type === "timeout")
    return {
      reason: "stopped",
      detail: `케이스 '${nameOf(stop.caseId)}' 가 제한 시간 안에 끝나지 않았습니다. ${suffix}`,
    };
  return {
    reason: "stopped",
    detail:
      stop.caseId === undefined
        ? `실행이 중단됐습니다. ${suffix}`
        : `케이스 '${nameOf(stop.caseId)}' 에서 실행이 중단됐습니다. ${suffix}`,
  };
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
  const aborted = abortedFromStop(report);
  if (aborted !== undefined)
    return {
      // 실행된 케이스까지만 남긴다. `notRun` 은 러너가 뒤에 채워 넣은 자리표시자이고 판정이
      // 아니다. 패딩은 언제나 뒤쪽에만 붙으므로 첫 `notRun` 앞에서 자르면 된다.
      //
      // 연결이 끊긴 케이스 자신은 남는다. 그 호출은 실제로 나갔고 실패는 사실이다. 그리고 그
      // 길이가 곧 "몇 번째에서 끊겼는가" 이고 호출 측이 화면에 쓴다.
      outcomes: outcomes.filter((outcome) => outcome.status !== "notRun"),
      aborted,
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
