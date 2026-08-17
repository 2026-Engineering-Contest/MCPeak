import type { ToolDef } from "@ohmymcp/core";
import { type TestSuiteSpec, validateMcpSuite } from "@ohmymcp/runner";
import { deepFreeze, sha256 } from "./canonical.js";
import { type CoverageResult, computeCoverage } from "./coverage.js";
import { safeBaseName } from "./filename.js";
import { analyzeToolProvenance, type ToolProvenance } from "./provenance.js";
import { buildGeneratedCases } from "./render.js";
import { GenerateTestsError } from "./schema.js";

/**
 * 위반 케이스를 기본 생성하기 시작해 v2로 올린다(ADR-0022). 이 값이 baselineFingerprint
 * 계산에 들어가므로 정책이 바뀐 사실이 지문에 남는다.
 */
export const BASELINE_POLICY_VERSION = "schema-baseline-v2" as const;
export const DEFAULT_BASELINE_TIMEOUT_MS = 10_000;

export interface BaselineSuiteOptions {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly defaultTimeoutMs?: number;
}

/** 미지원 키워드로 케이스를 만들지 못해 건너뛴 툴. 오류가 이미 만든 문장을 그대로 싣는다. */
export interface SkippedTool {
  /**
   * 입력 `tools` 배열에서의 위치. 소비자가 제외할 툴을 고르는 키는 이름이 아니라 이것이다.
   * 이름은 서버가 중복 선언할 수 있고(`computeCoverage` 가 `duplicateTool` 로 처리한다),
   * 이름으로 제외하면 동명의 **지원** 툴까지 함께 빠진다.
   */
  readonly index: number;
  readonly name: string;
  readonly path: string;
  readonly message: string;
}

export interface BaselineGenerationResult {
  readonly policyVersion: typeof BASELINE_POLICY_VERSION;
  readonly suite: TestSuiteSpec;
  readonly suiteFingerprint: string;
  readonly baselineFingerprint: string;
  readonly coverage: CoverageResult;
  /**
   * 건너뛴 툴 목록. tools 입력 순서다. suite 밖에 실리므로 전 툴 지원 서버의 출력
   * 바이트와 지문은 이 필드 도입 전과 같다(#88 의 재승인 문제를 만들지 않는다).
   */
  readonly skippedTools: readonly SkippedTool[];
  /**
   * 툴별 값 출처. **명세 파일에는 들어가지 않는다.** 들어가면 승인 지문의 계산 대상이 되고,
   * 우리 판정 규칙이 바뀔 때마다 사용자 명세의 지문이 흔들려 "명세가 바뀌었다" 경고가 일상이
   * 된다. 건너뛴 툴은 케이스가 없으므로 세지 않는다.
   */
  readonly provenance: readonly ToolProvenance[];
}

function invalidOption(path: string, message: string, hint: string): never {
  throw new GenerateTestsError("INVALID_OPTIONS", path, message, hint);
}

/** ToolDef 목록을 한 개의 결정론적 Runner suite로 합성한다. */
export function createBaselineSuite(
  tools: readonly ToolDef[],
  options: BaselineSuiteOptions,
): BaselineGenerationResult {
  if (!Array.isArray(tools)) {
    throw new GenerateTestsError(
      "INVALID_TOOL",
      "tools",
      "tools는 ToolDef 배열이어야 합니다.",
      "도구 목록 배열을 전달하세요.",
    );
  }
  if (typeof options?.suiteId !== "string" || !/\S/.test(options.suiteId)) {
    invalidOption(
      "options.suiteId",
      "suite ID가 비어 있습니다.",
      "비어 있지 않은 suite ID를 지정하세요.",
    );
  }
  if (typeof options.suiteName !== "string" || !/\S/.test(options.suiteName)) {
    invalidOption(
      "options.suiteName",
      "suite 이름이 비어 있습니다.",
      "비어 있지 않은 suite 이름을 지정하세요.",
    );
  }
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_BASELINE_TIMEOUT_MS;
  if (!Number.isSafeInteger(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
    invalidOption(
      "options.defaultTimeoutMs",
      "baseline timeout이 유효하지 않습니다.",
      "0보다 큰 정수 timeout을 지정하세요.",
    );
  }

  const usedNames = new Set<string>();
  const skippedTools: SkippedTool[] = [];
  const generatedTools: ToolDef[] = [];
  const cases = tools.flatMap((tool, index) => {
    const initialName = safeBaseName(typeof tool?.name === "string" ? tool.name : "", index);
    let baseName = initialName;
    for (let occurrence = 2; usedNames.has(baseName); occurrence++)
      baseName = `${initialName}-${occurrence}`;
    usedNames.add(baseName);
    try {
      const built = buildGeneratedCases(tool, index, baseName);
      generatedTools.push(tool);
      return built;
    } catch (error) {
      // 미지원 키워드만 툴 단위로 격리한다(도그푸딩 실측: 툴 하나가 서버 전체를 막았다).
      // 다른 코드는 입력 자체의 결함이라 종전대로 전체를 멈춘다.
      if (error instanceof GenerateTestsError && error.code === "UNSUPPORTED_SCHEMA") {
        skippedTools.push({ index, name: tool.name, path: error.path, message: error.message });
        return [];
      }
      throw error;
    }
  });
  // 전부 건너뛰었으면 저장할 것이 없다. 첫 오류를 그대로 던져 종전 화면을 유지한다.
  if (cases.length === 0 && skippedTools.length > 0) {
    const first = skippedTools[0] as SkippedTool;
    throw new GenerateTestsError(
      "UNSUPPORTED_SCHEMA",
      first.path,
      `모든 툴(${tools.length}개)의 스키마를 지원하지 않아 생성할 케이스가 없습니다. 첫 원인: ${first.message}`,
      "지원 키워드만 쓰는 툴이 하나도 없습니다. 케이스를 손으로 작성하거나 서버 스키마를 확인하세요.",
    );
  }
  const suite: TestSuiteSpec = {
    schemaVersion: 1,
    id: options.suiteId,
    name: options.suiteName,
    defaultTimeoutMs,
    cases,
  };
  if (!validateMcpSuite(suite).valid) {
    throw new GenerateTestsError(
      "GENERATED_SUITE_INVALID",
      "suite",
      "생성한 baseline suite가 Runner 계약을 만족하지 않습니다.",
      "도구 목록과 suite 옵션을 확인하세요.",
    );
  }
  const suiteFingerprint = sha256(suite);
  const result: BaselineGenerationResult = {
    policyVersion: BASELINE_POLICY_VERSION,
    suite,
    suiteFingerprint,
    baselineFingerprint: sha256({ policyVersion: BASELINE_POLICY_VERSION, suite }),
    // 건너뛴 툴을 분모에 넣으면 케이스가 있을 수 없는 축이 "미검증" 으로 쌓인다.
    // 건너뜀은 skippedTools 가 따로 고지한다.
    coverage: computeCoverage({ suite, tools: generatedTools }),
    skippedTools,
    provenance: generatedTools.map((tool) => analyzeToolProvenance(tool)),
  };
  return deepFreeze(result);
}
