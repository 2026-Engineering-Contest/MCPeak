/**
 * AI 사전보완 배선. 제안 값을 **후보로만** 더하고 채택은 실제 서버 실행이 정한다(ADR-0025).
 *
 * **AI 값이 baseline 값을 덮어쓰지 않는다.** 실측에서 `server-filesystem` 은 baseline 6/14,
 * AI 1/14 였다. AI 가 덮어썼으면 5개를 잃는다. 그 툴들에서 baseline 은 통과하고 AI 는 실패하므로
 * 아래 규칙이 baseline 을 지킨다(설계서 §4.4).
 */

import type { McpClient, ToolDef } from "@mcpeak/core";
import type { PreFillResult, ToolProvenance } from "@mcpeak/generate";
import type {
  CallToolCaseSpec,
  JsonObject,
  JsonValue,
  TestCaseSpec,
  TestSuiteSpec,
} from "@mcpeak/runner";
import type { DryRunResult } from "./dry-run.js";
import { runDryRun } from "./dry-run.js";
import { RESET_GRADE_LINE, type ResetGrade, resetIsComparable } from "./reset-hook.js";

/** 어느 값을 쓰기로 했는지. */
export type PreFillSource = "baseline" | "ai";

export interface PreFillProposedField {
  readonly field: string;
  readonly value: JsonValue;
}

/** 제안을 받았지만 어느 갈래에도 못 들어간 케이스. 사유를 반드시 함께 싣는다(설계 §3.2). */
export interface PreFillExclusion {
  readonly caseId: string;
  readonly field: string;
  readonly reason: "명세에 없는 케이스" | "callTool 이 아닌 케이스" | "입력이 객체가 아닌 케이스";
}

export interface PreFillCaseOutcome {
  readonly caseId: string;
  readonly source: PreFillSource;
  /** baseline 도 AI 도 실패했다. 분류 화면이 이어받고 사후수리가 그다음이다. */
  readonly needsClassification: boolean;
  /** 보류(`needsClassification === true`)일 때만 있다. 그 케이스에 얹은 제안 값이다. */
  readonly proposedFields?: readonly PreFillProposedField[];
  /** 보류일 때만 있다. AI 회차에서 서버가 낸 위반 줄. 여러 줄이면 개행으로 잇는다. */
  readonly serverMessage?: string;
}

export interface ApplyPreFillResult {
  /** 채택 결과를 반영한 명세. 채택하지 않은 케이스는 baseline 그대로다. */
  readonly suite: TestSuiteSpec;
  /** 제안이 있던 케이스의 판정. 요청 순서다. */
  readonly cases: readonly PreFillCaseOutcome[];
  /** AI 값을 쓴 케이스 수. 화면이 그대로 적는다. */
  readonly adopted: number;
  /** 제안은 받았지만 baseline 을 유지한 케이스 수. */
  readonly notAdopted: number;
  /** baseline 값도 제안 값도 실패해 분류 화면으로 가는 수. `notAdopted` 에 포함된다. */
  readonly held: number;
  /** 제안은 받았지만 실행 대상에 못 들어간 제안. 어느 줄에도 안 세어지던 것을 사유와 함께 센다. */
  readonly excluded: readonly PreFillExclusion[];
  /** 비교를 실제로 했는가. false 면 adopted 가 0 이고 skippedReason 이 있다. */
  readonly compared: boolean;
  /** 비교를 못 한 사유. compared 가 true 면 undefined 다. 화면에 그대로 찍는다. */
  readonly skippedReason?: string;
}

/** 두 후보를 같은 초기 상태에서 못 돌렸을 때의 첫 줄. 아래에 등급 문장이 이어 붙는다. */
const COMPARE_SKIPPED_HEAD =
  "사전보완 비교를 건너뜁니다: 두 후보를 같은 초기 상태에서 실행할 수 없습니다.";

/**
 * 비교 불가 사유. 앞·사이 두 등급 중 비교 불가인 것의 문장을 이어 붙인다.
 *
 * 둘이 같은 등급이면 한 번만 찍는다. 다르면 **둘 다 찍는다.** `failed` 가 `none` 보다
 * 약하다고 보지 않는다. 둘은 다음에 할 일이 다르다. `none` 은 `--reset-cmd` 를 주는 것이고
 * `failed` 는 그 명령을 고치는 것이다.
 */
function compareSkippedReason(before: ResetGrade, between: ResetGrade): string {
  const lines: string[] = [];
  for (const grade of [before, between])
    if (!resetIsComparable(grade) && !lines.includes(RESET_GRADE_LINE[grade]))
      lines.push(RESET_GRADE_LINE[grade]);
  return [COMPARE_SKIPPED_HEAD, ...lines].join("\n");
}

/**
 * 시험 실행 상세의 본문 들여쓰기. `dry-run.ts` 의 `INDENT` 와 같은 값이다.
 * 그 파일을 다른 태스크가 고치고 있어 import 하지 않고 여기에 둔다.
 */
const DETAIL_INDENT = "    ";
/** 서버 위반 줄의 접두사. 들여쓰기 뒤에 붙는다. */
const VIOLATION_PREFIX = `${DETAIL_INDENT}→ `;

/**
 * 시험 실행 상세에서 서버가 낸 위반 줄만 뽑아 개행으로 잇는다.
 * 위반 줄이 없으면 들여쓰기가 있는 첫 본문 줄을 그대로 쓴다. 그것도 없으면 빈 문자열이다.
 * 관측하지 못한 것을 관측했다고 적지 않는다(설계 §4.1).
 */
function serverMessageOf(detail: string): string {
  const lines = detail.split("\n");
  const violations = lines
    .filter((line) => line.startsWith(VIOLATION_PREFIX))
    .map((line) => line.slice(VIOLATION_PREFIX.length));
  if (violations.length > 0) return violations.join("\n");
  const first = lines.find((line) => line.startsWith(DETAIL_INDENT) && line.trim() !== "");
  return first === undefined ? "" : first.slice(DETAIL_INDENT.length);
}

const plainObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 케이스 하나에 제안 값들을 얹은 입력. 원본을 바꾸지 않는다. */
function withProposals(
  input: JsonObject,
  proposals: readonly { readonly field: string; readonly value: JsonValue }[],
): JsonObject {
  const next: JsonObject = { ...input };
  for (const proposal of proposals) next[proposal.field] = proposal.value;
  return next;
}

/** 케이스 id 로 골라 만든 부분 명세. 원본의 케이스 순서를 유지한다. */
const subsetSuite = (
  suite: TestSuiteSpec,
  ids: ReadonlySet<string>,
  replace?: ReadonlyMap<string, JsonObject>,
): TestSuiteSpec => ({
  ...suite,
  cases: suite.cases
    .filter((item) => ids.has(item.id))
    .map((item) => withInput(item, replace?.get(item.id))),
});

/**
 * 케이스의 입력만 바꾼다. `TestCaseSpec` 은 유니온인데 판별자가 `operation.type` 이라
 * 중첩 속성으로는 좁혀지지 않는다. 좁힌 뒤 단언으로 넘긴다.
 */
function withInput(item: TestCaseSpec, input: JsonObject | undefined): TestCaseSpec {
  if (input === undefined || item.operation.type !== "callTool") return item;
  const callTool = item as CallToolCaseSpec;
  return { ...callTool, operation: { ...callTool.operation, input } };
}

const passedIds = (result: DryRunResult): ReadonlySet<string> =>
  new Set(
    result.outcomes.filter((outcome) => outcome.status === "passed").map((item) => item.caseId),
  );

/**
 * 제안 값을 baseline 값과 나란히 실행해 채택을 정한다.
 *
 * | baseline | AI | 채택 |
 * |---|---|---|
 * | 통과 | 통과 | **baseline** — 결정론적이고 재현 가능한 쪽이 기본값이다 |
 * | 통과 | 실패 | baseline |
 * | 실패 | 통과 | **AI** |
 * | 실패 | 실패 | baseline (분류 화면으로. 사후수리가 이어받는다) |
 *
 * 시험 실행이 중단되면(`aborted`) 그 회차의 판정을 믿지 않고 전부 baseline 을 유지한다.
 * 끊긴 연결에서 나온 "실패" 를 근거로 AI 값을 채택하면 서버가 옳은데 우리가 바꾸는 것이 된다.
 */
export async function applyPreFill(options: {
  readonly client: McpClient;
  readonly baseline: TestSuiteSpec;
  readonly preFill: PreFillResult;
  /** 시험 실행 주입점. 테스트가 실제 프로세스를 띄우지 않게 한다. */
  readonly dryRun?: (o: {
    readonly client: McpClient;
    readonly suite: TestSuiteSpec;
  }) => Promise<DryRunResult>;
  /**
   * 후보 실행 앞과 사이에 부른다. 없으면 비교하지 않고 전부 baseline 을 유지한다.
   * 테스트가 실제 명령을 실행하지 않게 주입으로 받는다.
   */
  readonly reset?: () => Promise<ResetGrade>;
}): Promise<ApplyPreFillResult> {
  const { client, baseline, preFill } = options;
  const run = options.dryRun ?? runDryRun;

  const byCase = new Map<string, PreFillProposedField[]>();
  for (const proposal of preFill.accepted) {
    const list = byCase.get(proposal.caseId) ?? [];
    list.push({ field: proposal.field, value: proposal.value });
    byCase.set(proposal.caseId, list);
  }
  // 제안이 하나도 없으면 서버를 부르지 않는다. 부를 이유가 없는 호출은 만들지 않는다.
  if (byCase.size === 0)
    return {
      suite: baseline,
      cases: [],
      adopted: 0,
      notAdopted: 0,
      held: 0,
      excluded: [],
      // 비교할 것이 없어 안 한 것이다. 못 한 것이 아니므로 사유를 만들지 않는다.
      compared: true,
    };

  // 실행 대상에 못 들어간 제안을 사유와 함께 모은다. 조용히 버리면 어느 줄에도 안 세어진다
  // (설계 §1.2). 순서는 `byCase` 의 삽입 순서, 즉 `preFill.accepted` 순서다.
  const excluded: PreFillExclusion[] = [];
  const specById = new Map(baseline.cases.map((item) => [item.id, item]));
  for (const [caseId, proposals] of byCase) {
    const item = specById.get(caseId);
    for (const proposal of proposals) {
      if (item === undefined) {
        excluded.push({ caseId, field: proposal.field, reason: "명세에 없는 케이스" });
        continue;
      }
      if (item.operation.type !== "callTool") {
        excluded.push({ caseId, field: proposal.field, reason: "callTool 이 아닌 케이스" });
        continue;
      }
      if (!plainObject(item.operation.input)) {
        excluded.push({ caseId, field: proposal.field, reason: "입력이 객체가 아닌 케이스" });
      }
    }
  }

  const targetIds = new Set<string>();
  const aiInputs = new Map<string, JsonObject>();
  for (const item of baseline.cases) {
    const proposals = byCase.get(item.id);
    if (proposals === undefined) continue;
    if (item.operation.type !== "callTool") continue;
    const input = item.operation.input;
    if (!plainObject(input)) continue;
    targetIds.add(item.id);
    aiInputs.set(item.id, withProposals(input, proposals));
  }
  if (targetIds.size === 0)
    return {
      suite: baseline,
      cases: [],
      adopted: 0,
      notAdopted: 0,
      held: 0,
      excluded,
      compared: true,
    };

  // 두 벌을 따로 돌린다. 한 명세에 섞어 돌리면 같은 툴을 두 번 부르는 순서가 카세트에 남아
  // 재생 때 어느 쪽이 어느 케이스인지 갈린다.
  //
  // 두 실행 **앞과 사이**에 초기화한다. 앞에 안 하면 이 단계 전의 실행이 바꾼 상태를 물려받고,
  // 사이에 안 하면 baseline 실행이 바꾼 상태에서 AI 후보가 돈다. 후자가 이 이슈의 증상이다.
  // 상태를 바꾸는 도구에서 AI 값만 통과해, "입력이 좋아서" 가 아니라 "앞 실행이 상태를
  // 바꿔서" 채택된다(이슈 #399).
  //
  // reset 을 안 넘기면 초기화 수단이 없는 것과 같다. "none" 으로 다룬다.
  const resetOnce = options.reset ?? (async (): Promise<ResetGrade> => "none");
  const gradeBefore = await resetOnce();
  const baselineRun = await run({ client, suite: subsetSuite(baseline, targetIds) });
  const gradeBetween = await resetOnce();
  const aiRun = await run({ client, suite: subsetSuite(baseline, targetIds, aiInputs) });
  // 둘 중 하나라도 비교 불가면 채택하지 않는다. 비교 조건이 안 갖춰졌으면 고르지 않는 것이
  // 옳다. 상태 차이를 입력 개선으로 오인해 채택한 값은 재현되지 않는 명세를 만들고, 그것은
  // 이 프로젝트의 핵심 가치인 결정론성을 정면으로 어긴다.
  const comparable = resetIsComparable(gradeBefore) && resetIsComparable(gradeBetween);
  const aborted = baselineRun.aborted !== undefined || aiRun.aborted !== undefined;
  const baselinePassed = passedIds(baselineRun);
  const aiPassed = passedIds(aiRun);
  const aiDetails = new Map(aiRun.outcomes.map((outcome) => [outcome.caseId, outcome.detail]));

  const cases: PreFillCaseOutcome[] = [];
  const adoptedIds = new Set<string>();
  for (const item of baseline.cases) {
    if (!targetIds.has(item.id)) continue;
    const basePass = baselinePassed.has(item.id);
    const aiPass = aiPassed.has(item.id);
    const useAi = comparable && !aborted && !basePass && aiPass;
    if (useAi) adoptedIds.add(item.id);
    // 비교를 못 했으면 "둘 다 실패" 라는 판정도 못 한다. 분류 화면으로 보내지 않는다.
    const held = comparable && !aborted && !basePass && !aiPass;
    // 보류일 때만 제안 값과 서버 응답을 싣는다. 아니면 키 자체를 만들지 않는다.
    cases.push({
      caseId: item.id,
      source: useAi ? "ai" : "baseline",
      needsClassification: held,
      ...(held
        ? {
            proposedFields: byCase.get(item.id) ?? [],
            serverMessage: serverMessageOf(aiDetails.get(item.id) ?? ""),
          }
        : {}),
    });
  }

  const adopted = adoptedIds.size;
  return {
    suite:
      adopted === 0
        ? baseline
        : {
            ...baseline,
            cases: baseline.cases.map((item) =>
              withInput(item, adoptedIds.has(item.id) ? aiInputs.get(item.id) : undefined),
            ),
          },
    cases,
    adopted,
    notAdopted: cases.length - adopted,
    held: cases.filter((item) => item.needsClassification).length,
    excluded,
    compared: comparable,
    ...(comparable ? {} : { skippedReason: compareSkippedReason(gradeBefore, gradeBetween) }),
  };
}

/** 표 밖 `format` 때문에 AI 없이 채울 수 없는 툴. 화면이 이것을 그대로 적는다. */
export interface UnknownFormatSkip {
  readonly tool: string;
  /** 필드 경로. 중첩이면 점 표기다. */
  readonly field: string;
  /** 그 필드에 선언된 `format` 이름. 못 읽으면 빈 문자열이다. */
  readonly format: string;
}

/** 점 표기 경로를 따라 필드 스키마를 찾는다. 못 찾으면 undefined 다. */
function schemaAt(inputSchema: unknown, path: string): Record<string, unknown> | undefined {
  let current: unknown = inputSchema;
  for (const segment of path.split(".")) {
    if (!plainObject(current)) return undefined;
    const properties = (current as Record<string, unknown>).properties;
    if (typeof properties !== "object" || properties === null) return undefined;
    current = (properties as Record<string, unknown>)[segment];
    // 배열이면 원소 스키마로 한 칸 내려간다. 출처 집계가 같은 방식으로 물려받았다.
    while (plainObject(current) && (current as Record<string, unknown>).type === "array")
      current = (current as Record<string, unknown>).items;
  }
  return plainObject(current) ? (current as Record<string, unknown>) : undefined;
}

/**
 * AI 를 부를 수 없는 경로에서 건너뛸 툴을 고른다.
 *
 * `--baseline-only` 처럼 **애초에 provider 를 안 부르기로 한 경로에서만** 쓴다. provider 가
 * 죽은 경우에는 쓰지 않는다. 그것은 사용자 서버의 문제가 아니라 우리 쪽 사정이고, 그것 때문에
 * 케이스를 잃는 손해가 더 크다.
 */
export function unknownFormatSkips(
  tools: readonly ToolDef[],
  provenance: readonly ToolProvenance[],
): readonly UnknownFormatSkip[] {
  // 출처를 못 구했으면 건너뛸 툴도 못 고른다. 여기서 던지면 부가 기능 하나가 생성 전체를
  // 죽인다. 커버리지 보고를 저장과 다른 오류 경계에 둔 것과 같은 판단이다.
  if (!Array.isArray(provenance)) return [];
  const declared = new Map<string, ToolDef>();
  for (const tool of tools) if (!declared.has(tool.name)) declared.set(tool.name, tool);
  const skips: UnknownFormatSkip[] = [];
  for (const item of provenance)
    for (const field of item.unknownFormatFields) {
      const schema = schemaAt(declared.get(item.tool)?.inputSchema, field);
      const format = schema?.format;
      skips.push({
        tool: item.tool,
        field,
        format: typeof format === "string" ? format : "",
      });
    }
  return skips;
}

/** 건너뛸 툴의 케이스를 명세에서 뺀다. 그 축은 커버리지에 미검증으로 남는다. */
export function dropSkippedTools(
  suite: TestSuiteSpec,
  skips: readonly UnknownFormatSkip[],
): TestSuiteSpec {
  if (skips.length === 0) return suite;
  const dropped = new Set(skips.map((skip) => skip.tool));
  return {
    ...suite,
    cases: suite.cases.filter(
      (item) => item.operation.type !== "callTool" || !dropped.has(item.operation.tool),
    ),
  };
}
