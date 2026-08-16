import type { RepairBundle } from "./repair-bundle.js";

/**
 * 터미널 제어 문자를 무해한 토큰으로 바꾼다.
 *
 * `packages/cli/src/test-command.ts` 의 `escapeTerminalText` 와 같은 계열이다. 그 함수를
 * import 하지 않고 사본을 두는 근거는 ADR-0013 이고 `process-diagnostics.ts` 의 선례와 같다.
 * 이 모듈이 찍는 문자열은 **외부 provider 가 준 산문**이라 원문 보존보다 화면 무해성이 앞선다.
 *
 * TAB(0x09)도 이스케이프한다. `process-diagnostics.ts` 사본만 TAB 을 남기는데 그것은 서버
 * stderr 의 스택트레이스 들여쓰기를 보존하기 위해서다. AI 산문에는 보존할 들여쓰기가 없고,
 * 우리가 만든 라벨 정렬을 TAB 이 흔들면 화면이 어긋난다.
 */
export const escapeTerminalText = (value: string): string =>
  Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    // 0x7f..0x9f 는 DEL 과 C1 제어 문자다. U+009B 를 8비트 CSI 로 해석하는 터미널이 있다.
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

/**
 * 화면에 찍는 `shortfall` 의 문자 수 상한.
 *
 * 검증(`validateDiagnosisResult`)은 `summary`·`location`·`evidence` 만 자르고 `shortfall` 은
 * 그대로 통과시킨다(설계서 §5.6-5). provider 가 장문을 보내면 그 한 항목이 터미널 한 화면을
 * 밀어내 경계 문장까지 스크롤 밖으로 나간다. 경계 문장은 사용자가 명세 쪽으로 빠질 출구라
 * 화면에서 사라지면 안 된다. 그래서 **표시 단계에서** 자른다. 값 자체는 안 바꾼다.
 * 상한은 `MAX_CAUSE_CHARS` 와 같은 500 이다. 두 값이 다르면 항목마다 길이가 들쭉날쭉해진다.
 */
export const SHORTFALL_DISPLAY_CHARS = 500;

/** 코드 포인트 단위로 자른다. 서로게이트 쌍(이모지)의 중간이 끊기지 않는다. */
function clampDisplay(text: string, limit: number): string {
  const points = [...text];
  return points.length <= limit ? text : `${points.slice(0, limit).join("")}…`;
}

/**
 * 경계 문장 둘. **모든 경로에서** 찍는다. `unsure` 여도, 진단이 잘 나와도 찍는다.
 * 이것이 없으면 사용자가 멀쩡한 서버 코드를 판다. 억제 조건을 만들지 않는다. 설계서 §6.3.
 */
export const REPAIR_BOUNDARY_LINES =
  "※ AI 제안입니다. 파일을 고치지 않았고 명세도 그대로입니다.\n※ 명세 쪽이 틀렸다고 판단되면 `ohmymcp generate` 로 다시 승인받으세요.\n";

/** 비대화형에서 `--yes` 없이 부른 경우. 물어볼 수 없는 곳에서 조용히 보내지 않는다. */
export const REPAIR_CONFIRM_REQUIRED_LINE =
  "오류 [REPAIR_CONFIRM_REQUIRED]: 확인을 받을 수 없는 환경입니다. 전송 내용을 보여줄 수 없어 보내지 않았습니다.\n해결: 내용을 확인했다면 `--yes` 를 붙여 다시 실행하세요.\n";

/** 사용자가 `n` 을 답한 경로. 실패가 아니라 의도한 종료다. */
export const REPAIR_CANCELLED_LINE = "전송하지 않았습니다.\n";

const APPROVAL_LABEL: Readonly<Record<RepairBundle["spec"]["approval"], string>> = {
  matched: "승인 지문 일치",
  mismatched: "승인 지문 불일치",
  absent: "승인 지문 없음",
};

/**
 * 지문이 승인 상태가 아닐 때 결과 맨 위에 붙는 블록. 결과가 `unsure` 여도 붙는다. 설계서 §6.5.
 * `matched` 면 빈 문자열이다.
 */
export function renderApprovalNotice(approval: RepairBundle["spec"]["approval"]): string {
  if (approval === "matched") return "";
  if (approval === "mismatched")
    return "⚠ 이 명세는 승인 상태가 아닙니다 (지문 불일치).\n  실패 원인이 서버가 아니라 명세일 수 있습니다. 아래 제안은 그 전제로 받았습니다.\n\n";
  return "⚠ 이 명세는 승인 지문이 없습니다.\n  실제 서버로 검증된 적이 없는 명세일 수 있습니다. 아래 제안은 그 전제로 받았습니다.\n\n";
}

/** KB 표기. 소수 한 자리다. 바이트 그대로 찍으면 큰 수를 눈으로 못 읽는다. */
function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export interface RepairConfirmView {
  readonly providerId: "codex" | "claude";
  readonly model: string;
  /** 번들에 담긴 실패 총 수. */
  readonly totalFailures: number;
  /** 실제로 보내는 실패 수. */
  readonly sentFailures: number;
  /** 상한에 걸려 뺀 실패 수. 0 이면 괄호를 안 찍는다. */
  readonly omittedFailures: number;
  readonly maxCases: number;
  readonly approval: RepairBundle["spec"]["approval"];
  readonly includeStderr: boolean;
  /** 전송하는 stderr. `--no-stderr` 이거나 번들에 없으면 undefined 다. */
  readonly stderr?: string;
  readonly requestBytes: number;
}

/**
 * 전송 확인 화면(설계서 §6.1). 질문 줄은 붙이지 않는다. 그것은 `ReviewIO.confirm` 이 찍는다.
 */
export function renderRepairConfirm(view: RepairConfirmView): string {
  const scope =
    view.omittedFailures === 0
      ? `실패 ${view.totalFailures}건 중 ${view.sentFailures}건`
      : `실패 ${view.totalFailures}건 중 ${view.sentFailures}건 (--max-cases ${view.maxCases}, ${view.omittedFailures}건 제외)`;
  let stderrLine: string;
  if (!view.includeStderr) stderrLine = "(전송하지 않음)";
  else if (view.stderr === undefined || view.stderr === "") stderrLine = "없음";
  else {
    const lines = view.stderr.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    stderrLine = `${lines.length}줄 ${kilobytes(Buffer.byteLength(view.stderr, "utf8"))} (--no-stderr 로 제외할 수 있습니다)`;
  }
  return [
    "repair 요청을 보냅니다.\n",
    "\n",
    // model 은 사용자가 CLI 로 준 문자열이다. AI 출력과 같은 이유로 제어 문자를 이스케이프한다.
    `  provider   ${view.providerId} (${escapeTerminalText(view.model)})\n`,
    `  대상       ${scope}\n`,
    `  명세 상태  ${APPROVAL_LABEL[view.approval]}\n`,
    `  stderr     ${stderrLine}\n`,
    `  전송 크기  ${kilobytes(view.requestBytes)}\n`,
    "\n",
    "※ 위 내용이 외부 provider 로 전송됩니다.\n",
    "※ stderr 는 서버가 자유롭게 쓰는 텍스트라 경로·토큰·데이터가 섞일 수 있습니다.\n",
  ].join("");
}

export interface RepairResultCause {
  readonly caseId: string;
  readonly summary: string;
  readonly location: string;
  readonly evidence: string;
  readonly target: "server" | "spec";
}

export type RepairResultView =
  | {
      readonly status: "diagnosis";
      readonly causes: readonly RepairResultCause[];
      readonly discarded: number;
    }
  | { readonly status: "unsure"; readonly shortfall: string; readonly discarded: number };

/**
 * 제안이 전부 폐기돼 남은 항목이 0 인 경우의 문안.
 *
 * 사용자가 알아야 할 것은 셋이다. AI 가 답을 냈다는 사실, 우리가 왜 버렸는지, 다음에 무엇을
 * 할 수 있는지. **폐기 사유를 항목별로 갖고 있지 않으므로** 두 가능성을 그대로 적는다.
 * 하나로 단정하면 없는 정보를 지어내는 것이 되고, 사용자는 틀린 쪽을 고치러 간다.
 */
function renderAllDiscarded(discarded: number): string {
  return [
    `AI 가 원인 후보 ${discarded}건을 냈지만 전부 검증에서 제외했습니다.\n`,
    "판단 근거가 없어서가 아니라 답이 요청 범위를 벗어나서입니다.\n",
    "\n",
    "  제외 사유  요청에 없는 케이스를 가리켰거나, 승인된 명세를 고치라는 제안이었습니다.\n",
    "             둘 중 어느 쪽인지는 구분해 두지 않아 말씀드릴 수 없습니다.\n",
    "\n",
    "  → 명세가 실제로 틀렸다고 보시면 `ohmymcp generate` 로 다시 승인받으세요.\n",
    "    승인된 명세를 고치라는 제안은 그 전에는 화면에 올리지 않습니다.\n",
    "  → 그렇지 않으면 같은 번들로 한 번 더 물어보세요. 같은 입력에도 답은 달라집니다.\n",
  ].join("");
}

/** 케이스 머리줄. 툴이 없는 케이스(listTools)는 괄호를 안 찍는다. */
function caseHeading(caseId: string, tool: string | undefined): string {
  const id = escapeTerminalText(caseId);
  return tool === undefined ? `${id}\n` : `${id}  (${escapeTerminalText(tool)})\n`;
}

/**
 * 결과 화면(설계서 §6.2·§6.4·§6.5).
 *
 * 문안은 CLI 가 소유한다. AI 는 필드만 채운다. 라벨·들여쓰기·순서·경계 문장은 전부 우리 것이다.
 * 케이스 순서는 **번들 순서**다. AI 응답 순서로 정렬하지 않는다. 같은 실행을 두 번 볼 때 화면이
 * 달라지면 안 된다.
 */
export function renderRepairResult(options: {
  bundle: RepairBundle;
  result: RepairResultView;
  providerId: "codex" | "claude";
  model: string;
}): string {
  const parts: string[] = [
    `── 서버 수정 방향 (${options.providerId} / ${escapeTerminalText(options.model)}) ──\n`,
    "\n",
    renderApprovalNotice(options.bundle.spec.approval),
  ];
  if (options.result.status === "unsure") {
    /**
     * `unsure` 는 두 가지 다른 일이다. 하나로 뭉치면 화면이 거짓말을 한다.
     *
     * `discarded` 가 0 이면 provider 가 실제로 판단을 못 한 것이고, 그때만 "근거가 부족" 이
     * 사실이다. `discarded` 가 0 보다 크면 **답은 왔는데 우리가 경계 밖이라 버린 것**이다.
     * 그 경로에 "근거가 부족" 을 찍으면 사용자는 번들에 정보를 더 담아야 한다고 읽는다.
     * 실제로 그 화면을 보고 "구현이 실패한 것 아니냐" 는 질문이 나왔다.
     */
    if (options.result.discarded > 0) parts.push(renderAllDiscarded(options.result.discarded));
    else parts.push("판단 근거가 부족해 원인 후보를 제시하지 못했습니다.\n");
    // shortfall 이 비면 이 줄만 뺀다. 침묵하지는 않는다. 위 문장은 남는다. 설계서 §6.4.
    if (options.result.shortfall !== "") {
      const text = escapeTerminalText(
        clampDisplay(options.result.shortfall, SHORTFALL_DISPLAY_CHARS),
      );
      const [first, ...rest] = text.split("\n");
      parts.push("\n", `  → ${first}\n`);
      for (const line of rest) parts.push(`    ${line}\n`);
    }
  } else {
    // 번들 순서로 훑고, 그 케이스에 달린 제안을 응답 안 상대 순서대로 찍는다.
    const byCase = new Map<string, RepairResultCause[]>();
    for (const cause of options.result.causes) {
      const list = byCase.get(cause.caseId) ?? [];
      list.push(cause);
      byCase.set(cause.caseId, list);
    }
    let first = true;
    for (const failure of options.bundle.failures) {
      const causes = byCase.get(failure.caseId);
      if (causes === undefined) continue;
      for (const cause of causes) {
        if (!first) parts.push("\n");
        first = false;
        parts.push(caseHeading(failure.caseId, failure.tool));
        parts.push(`  원인 후보  ${escapeTerminalText(cause.summary)}\n`);
        // 빈 값이면 그 줄만 뺀다. 빈 라벨은 화면에 정보가 아니라 소음이다.
        if (cause.location !== "")
          parts.push(`  확인할 곳  ${escapeTerminalText(cause.location)}\n`);
        if (cause.evidence !== "")
          parts.push(`  근거       ${escapeTerminalText(cause.evidence)}\n`);
        // 승인 상태가 아닐 때만 spec 항목이 통과한다(§5.6-4). 그 사실을 화면이 말한다.
        if (cause.target === "spec" && options.bundle.spec.approval !== "matched")
          parts.push("  분류       명세 쪽 원인으로 봄\n");
      }
    }
  }
  // 전부 폐기된 경로는 위 문안이 개수와 사유를 이미 말했다. 같은 수를 두 번 찍지 않는다.
  if (options.result.discarded > 0 && options.result.status !== "unsure")
    parts.push(
      "\n",
      `※ 제안 ${options.result.discarded}건이 검증에서 제외됐습니다 (요청에 없는 케이스이거나 명세 수정 제안).\n`,
    );
  parts.push("\n", REPAIR_BOUNDARY_LINES);
  return parts.join("");
}

/** provider 실패 안내. 닫힌 enum 만 화면에 오고 raw stdout·stderr 는 오지 않는다. */
export function renderRepairProviderFailure(failure: {
  providerId: "codex" | "claude";
  code: string;
  reason?: string;
}): string {
  const reason = failure.reason === undefined ? "" : ` (${failure.reason})`;
  return `오류 [REPAIR_PROVIDER_FAILED]: ${failure.providerId} 에게 진단을 받지 못했습니다. 코드: ${failure.code}${reason}\n해결: \`${failure.providerId} --version\` 으로 설치와 인증을 확인한 뒤 다시 실행하세요. 파일은 하나도 바뀌지 않았습니다.\n`;
}

/** 응답이 계약을 못 지킨 경우. 우리가 버렸다는 사실을 말한다. */
export const REPAIR_INVALID_RESULT_LINE =
  "오류 [REPAIR_RESULT_INVALID]: provider 응답이 진단 형식을 지키지 않아 버렸습니다.\n해결: 같은 번들로 다시 실행하거나 다른 `--model` 로 시도하세요. 파일은 하나도 바뀌지 않았습니다.\n";

/**
 * 응답이 `maxResultBytes` 를 넘어 거절된 경우. 형식이 틀린 것과 다르다. 답은 형식을 지켰지만
 * 우리가 정한 상한 밖이라 받지 않은 것이고, 사용자가 할 일도 다르다. 같은 문장을 쓰면
 * "다른 모델로 시도하세요" 라는 엉뚱한 안내를 하게 된다.
 */
export const REPAIR_RESULT_LIMIT_LINE =
  "오류 [REPAIR_RESULT_LIMIT_EXCEEDED]: provider 응답이 허용 크기를 넘어 받지 않았습니다.\n해결: `--max-cases` 로 한 번에 묻는 실패 수를 줄여 다시 실행하세요. 파일은 하나도 바뀌지 않았습니다.\n";

/** 승인 검사에 걸린 경우. 사용자가 본 것과 나가는 것이 달라졌다는 뜻이다. */
export const REPAIR_APPROVAL_INVALIDATED_LINE =
  "오류 [REPAIR_APPROVAL_INVALIDATED]: 확인한 내용과 보내려는 내용이 달라 전송을 멈췄습니다.\n해결: 같은 번들로 다시 실행하세요. 파일은 하나도 바뀌지 않았습니다.\n";
