import type { ToolDef } from "@mcpeak/core";
import {
  type ContractAxisKind,
  deriveContractAxes,
  matchCoveredAxes,
  type TestSuiteSpec,
} from "@mcpeak/runner";

/**
 * UTF-16 코드 단위 안정 비교. `runner` 의 `ordering.ts` 에 같은 것이 있지만 그 파일은 패키지
 * 내부 전용이라 `index.ts` 로 나오지 않는다.
 *
 * **의도된 중복이다.** 대안은 `runner` 가 이 세 글자 함수를 공개 API 로 내보내는 것인데,
 * 그러자고 ADR-0009 의 승인 심볼 목록을 넓히고 `runner` 의 공개 표면을 늘리는 것이 더 비싸다.
 * `localeCompare` 를 쓰지 않는 이유는 결과가 로캘과 ICU 데이터에 따라 달라지기 때문이다.
 */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface AxisCoverage {
  readonly kind: ContractAxisKind;
  readonly field: string | null;
  /** 이 축을 덮는 케이스의 id. 없으면 미검증이다. */
  readonly caseId: string | null;
}

export interface ToolCoverage {
  readonly tool: string;
  readonly analyzable: boolean;
  /** ContractAxesResult 의 것을 그대로 싣는다. 중복 선언이면 "duplicateTool" 이다. */
  readonly unanalyzableReason: string | null;
  /** §4.4 순서. analyzable 이 false 면 빈 배열이다. */
  readonly axes: readonly AxisCoverage[];
  /** caseId 가 있는 축의 개수. */
  readonly verified: number;
  /** axes.length. analyzable 이 false 면 0 이다. */
  readonly total: number;
  readonly unanalyzedFields: readonly string[];
}

export interface CoverageResult {
  /** 서버가 선언한 순서가 아니라 툴 이름 UTF-16 코드 단위 오름차순. */
  readonly tools: readonly ToolCoverage[];
  /** 모든 툴의 verified 합. */
  readonly verified: number;
  /** 모든 툴의 total 합. */
  readonly total: number;
}

/** 명세가 각 축을 덮는지 판정한다. 서버를 호출하지 않는다. */
export function computeCoverage(options: {
  readonly suite: TestSuiteSpec;
  readonly tools: readonly ToolDef[];
}): CoverageResult {
  const { suite, tools } = options;
  // 이름으로만 조회한다. 배열 순서가 결과를 바꾸지 않아야 한다.
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) duplicated.add(tool.name);
    seen.add(tool.name);
  }
  const declared = new Map<string, ToolDef>();
  for (const tool of tools) if (!declared.has(tool.name)) declared.set(tool.name, tool);

  const toolCoverages: ToolCoverage[] = [];
  for (const name of [...declared.keys()].sort(byCodeUnit)) {
    const tool = declared.get(name) as ToolDef;
    const derived = deriveContractAxes(tool, { duplicated: duplicated.has(name) });
    // 축 키는 kind 와 field 쌍이다. 같은 툴 안에서 유일하다(설계서 §3.2).
    const coveredBy = new Map<string, string>();
    for (const testCase of suite.cases)
      for (const axis of matchCoveredAxes({ testCase, tool })) {
        const key = `${axis.kind} ${axis.field ?? ""}`;
        // 첫 케이스만 남긴다. suite.cases 순서를 쓰므로 결정론적이다.
        if (!coveredBy.has(key)) coveredBy.set(key, testCase.id);
      }
    // 축은 derived.axes 로만 만든다. matchCoveredAxes 결과는 caseId 를 채우는 데만 쓴다.
    // 반대로 하면 중복 툴처럼 축이 빈 경우에 분모는 0인데 분자만 늘어난다.
    const axes: AxisCoverage[] = derived.axes.map((axis) => ({
      kind: axis.kind,
      field: axis.field,
      caseId: coveredBy.get(`${axis.kind} ${axis.field ?? ""}`) ?? null,
    }));
    toolCoverages.push({
      tool: name,
      analyzable: derived.analyzable,
      unanalyzableReason: derived.unanalyzableReason,
      axes,
      verified: axes.filter((axis) => axis.caseId !== null).length,
      total: axes.length,
      unanalyzedFields: derived.unanalyzedFields,
    });
  }
  return {
    tools: toolCoverages,
    verified: toolCoverages.reduce((sum, item) => sum + item.verified, 0),
    total: toolCoverages.reduce((sum, item) => sum + item.total, 0),
  };
}
