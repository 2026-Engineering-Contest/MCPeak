import type {
  AuthoringSessionView,
  McpToolContext,
  TestAuthoringProvider,
} from "@ohmymcp/generate";
import {
  canonicalJson,
  type JsonValue,
  REDACTED,
  type RunnerRedactionOptions,
  type TestCaseSpec,
  type TestSuiteSpec,
} from "@ohmymcp/runner";
import type { RepairTarget } from "./repair-target.js";

/**
 * 실패한 케이스의 입력값 교정안을 authoring provider 에게 묻고, 돌아온 명세가 권한 경계를
 * 지켰는지 검사한다. 요청 문안은 설계 문서 §4.4 가, 권한 경계는 §4.3 이 전량 고정한다.
 *
 * AI 는 **값 후보만 낸다.** 판정은 실제 서버가 한다. 그래서 이 모듈이 돌려주는 것은 명세가
 * 아니라 입력값 하나이고, 그것마저 §4.3 을 전부 통과한 것만 나간다.
 */

export interface ProposeRepairOptions {
  readonly target: RepairTarget;
  readonly session: AuthoringSessionView;
  readonly tools: readonly McpToolContext[];
  readonly provider: TestAuthoringProvider;
  readonly prepare: typeof import("@ohmymcp/generate").prepareAuthoringRequest;
  readonly dispatch: typeof import("@ohmymcp/generate").dispatchAuthoringRequest;
  readonly redaction?: RunnerRedactionOptions;
}

/** 요청 문안에서 서버 응답 본문이 시작하는 자리. 치환 뒤 본문이 남았는지 여기서 확인한다. */
const SERVER_LABEL = "서버 응답: ";

/** 설계 문서 §4.4 의 문안. 값만 채운다. 문장을 새로 만들지 마라. */
const buildInstruction = (target: RepairTarget): string =>
  [
    "시험 실행에서 아래 케이스가 실패했습니다. 입력값만 고쳐 주세요.",
    "단언과 케이스 구조는 바꾸지 마세요.",
    "",
    `케이스: ${target.caseName} (id: ${target.caseId})`,
    `툴: ${target.tool}`,
    `보낸 입력: ${canonicalJson(target.input)}`,
    `${SERVER_LABEL}${target.serverMessage}`,
  ].join("\n");

/**
 * 치환을 거친 요청에 서버 응답 본문이 남아 있는가. 본문이 통째로 지워졌으면 보낼 근거가
 * 없으므로 요청하지 않는다(설계 §4.4). 라벨 자체가 사라진 경우도 같다.
 */
const hasServerMessage = (instruction: string): boolean => {
  const at = instruction.indexOf(SERVER_LABEL);
  if (at < 0) return false;
  const body = instruction.slice(at + SERVER_LABEL.length);
  return body.split(REDACTED).join("").trim() !== "";
};

/** 깊은 동등 비교. 키 순서에 좌우되지 않도록 정규화 직렬화로 대조한다. */
const same = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);

/** 대상 케이스의 입력값. `callTool` 이 아니면 입력이라는 것이 없다. */
const inputOf = (spec: TestCaseSpec): Readonly<Record<string, JsonValue>> | undefined =>
  spec.operation.type === "callTool" ? spec.operation.input : undefined;

const toolOf = (spec: TestCaseSpec): string | undefined =>
  spec.operation.type === "callTool" ? spec.operation.tool : undefined;

/**
 * 응답의 권한 경계를 검사한다. 허용되는 변경은 **대상 케이스 `operation.input` 안의 값** 하나
 * 뿐이고, 설계 문서 §4.3 의 금지 항목을 하나라도 어기면 제안 전체를 폐기한다. 부분 수용은
 * 하지 않는다. 여기가 뚫리면 AI 가 서버에 맞춰 단언을 무력화하는 경로가 열리고, 그 순간
 * "서버가 틀렸을 가능성" 이 사라져 시험 실행 게이트의 존재 이유가 없어진다.
 */
export function acceptProposal(options: {
  readonly target: RepairTarget;
  readonly before: TestSuiteSpec;
  readonly after: TestSuiteSpec;
}): Readonly<Record<string, JsonValue>> | undefined {
  const { target, before, after } = options;

  // 케이스 밖의 스위트 메타데이터가 같다. 지금 호출부는 입력값만 꺼내 쓰므로 여기를 뚫려도
  // 명세에 실릴 경로가 없지만, 이 함수가 권한 경계 자체다. 경계를 넘은 응답을 조금이라도
  // 수용하면 §4.3 이 금지한 부분 수용이 된다.
  if (!same({ ...before, cases: [] }, { ...after, cases: [] })) return undefined;

  // 케이스 수가 같다. 추가·삭제를 여기서 막는다.
  if (after.cases.length !== before.cases.length) return undefined;

  const index = before.cases.findIndex((spec) => spec.id === target.caseId);
  if (index < 0) return undefined;

  // 대상 케이스 외의 어떤 케이스도 before 와 deep equal 이다. 자리 이동도 위반으로 본다.
  // 순서가 바뀌면 뒤 단계의 화면 번호와 재실행 대상이 어긋난다.
  for (let position = 0; position < before.cases.length; position++) {
    if (position === index) continue;
    if (!same(before.cases[position], after.cases[position])) return undefined;
  }

  const beforeCase = before.cases[index] as TestCaseSpec;
  const afterCase = after.cases[index] as TestCaseSpec;

  // 대상 케이스의 operation.tool 이 같다. `callTool` 이 아니게 바뀐 것도 툴 교체로 본다.
  const beforeTool = toolOf(beforeCase);
  const afterTool = toolOf(afterCase);
  if (beforeTool === undefined || afterTool !== beforeTool) return undefined;

  // 대상 케이스의 assertions 가 before 와 deep equal 이다. 기대값 변경을 막는 것이 §4.3 의 핵심이다.
  if (!same(beforeCase.assertions, afterCase.assertions)) return undefined;

  // 대상 케이스의 id·name·timeoutMs 가 같다.
  if (afterCase.id !== beforeCase.id) return undefined;
  if (afterCase.name !== beforeCase.name) return undefined;
  if (afterCase.timeoutMs !== beforeCase.timeoutMs) return undefined;

  const beforeInput = inputOf(beforeCase);
  const afterInput = inputOf(afterCase);
  if (beforeInput === undefined || afterInput === undefined) return undefined;

  // 대상 케이스 operation.input 의 키 집합이 같다. 키 추가·삭제를 막는다.
  const beforeKeys = Object.keys(beforeInput);
  const afterKeys = Object.keys(afterInput);
  if (beforeKeys.length !== afterKeys.length) return undefined;
  const known = new Set(beforeKeys);
  if (afterKeys.some((key) => !known.has(key))) return undefined;

  // 값이 하나 이상 실제로 바뀌었다. 아무것도 안 고친 응답은 재실행할 이유가 없다.
  if (same(beforeInput, afterInput)) return undefined;

  return afterInput;
}

/**
 * 교정안을 provider 에게 요청한다. 실패는 전부 `undefined` 로 접는다. 교정은 선택이지
 * 전제가 아니라서, 여기서 던지면 교정 실패가 시험 실행을 통째로 죽인다.
 */
export async function proposeRepair(
  options: ProposeRepairOptions,
): Promise<Readonly<Record<string, JsonValue>> | undefined> {
  // 서버 응답이 없으면 보낼 근거가 없다. 요청하지 않고 사람 입력으로 넘긴다(설계 §4.4).
  if (options.target.serverMessage === "") return undefined;

  const before = options.session.approvedDraft.suite;
  try {
    const preview = options.prepare({
      mode: "revise",
      instruction: buildInstruction(options.target),
      baseline: options.session.baseline.suite,
      candidate: before,
      tools: options.tools,
      providerId: options.provider.id,
      model: options.provider.model ?? "",
      redaction: options.redaction,
    });
    // 치환이 본문을 지웠으면 보낸 뒤 판단하지 않는다. 지운 것을 물어봐야 답이 없다.
    if (!hasServerMessage(preview.request.instruction)) return undefined;

    const result = await options.dispatch({
      provider: options.provider,
      preview,
      approval: { approved: true, fingerprint: preview.fingerprint },
    });
    if (result.status !== "preview") return undefined;

    return acceptProposal({
      target: options.target,
      before,
      after: result.preview.result.suite,
    });
  } catch {
    return undefined;
  }
}
