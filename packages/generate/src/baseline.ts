import type { ToolDef } from "@ohmymcp/core";
import { type TestSuiteSpec, validateMcpSuite } from "@ohmymcp/runner";
import { deepFreeze, sha256 } from "./canonical.js";
import { createGeneratedCase, GenerateTestsError, safeGeneratedBaseName } from "./index.js";

export const BASELINE_POLICY_VERSION = "schema-baseline-v1" as const;
export const DEFAULT_BASELINE_TIMEOUT_MS = 10_000;

export interface BaselineSuiteOptions {
  readonly suiteId: string;
  readonly suiteName: string;
  readonly defaultTimeoutMs?: number;
}

export interface BaselineGenerationResult {
  readonly policyVersion: typeof BASELINE_POLICY_VERSION;
  readonly suite: TestSuiteSpec;
  readonly suiteFingerprint: string;
  readonly baselineFingerprint: string;
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
  const cases = tools.map((tool, index) => {
    const initialName = safeGeneratedBaseName(
      typeof tool?.name === "string" ? tool.name : "",
      index,
    );
    let baseName = initialName;
    for (let occurrence = 2; usedNames.has(baseName); occurrence++)
      baseName = `${initialName}-${occurrence}`;
    usedNames.add(baseName);
    return createGeneratedCase(tool, index, baseName);
  });
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
  };
  return deepFreeze(result);
}
