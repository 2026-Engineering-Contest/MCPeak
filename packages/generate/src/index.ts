import { constants } from "node:fs";
import { lstat, mkdir, open, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { ToolDef } from "@mcpeak/core";
import { nameDiscriminator, safeBaseName } from "./filename.js";
import { renderTool } from "./render.js";
import { fail } from "./schema.js";

export type {
  AuthoringDispatchResult,
  AuthoringProviderResult,
  AuthoringRequest,
  AuthoringRequestBinding,
  AuthoringRequestMode,
  AuthoringRequestPreview,
  McpToolContext,
  PublicProviderFailure,
  TestAuthoringProvider,
} from "./authoring-request.js";
export {
  DEFAULT_MAX_RESULT_BYTES,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  dispatchAuthoringRequest,
  MAX_PROMPT_BYTES,
  MAX_PROVIDER_TIMEOUT_MS,
  MAX_REQUEST_BYTES,
  MAX_TOOLS_BYTES,
  prepareAuthoringRequest,
  validateAuthoringProviderResult,
} from "./authoring-request.js";
export { AUTHORING_OUTPUT_SCHEMA, PROVIDER_OUTPUT_SCHEMA } from "./authoring-schema.js";
export {
  applyAuthoringChanges,
  createAuthoringDiff,
  createAuthoringSession,
  finalizeAuthoringDraft,
  getAuthoringExecutionSuite,
  reviewLocalAuthoringCandidate,
} from "./authoring-session.js";
export type {
  ApplyAuthoringChangesResult,
  AuthoringChange,
  AuthoringDiffPreview,
  AuthoringDraft,
  AuthoringExecutionSnapshot,
  AuthoringSessionView,
  CaseProvenance,
  GenerateReviewApproval,
  SanitizedAuthoringCandidate,
  TestCaseOrigin,
} from "./authoring-types.js";
export {
  BASELINE_POLICY_VERSION,
  type BaselineGenerationResult,
  type BaselineSuiteOptions,
  createBaselineSuite,
  DEFAULT_BASELINE_TIMEOUT_MS,
  type SkippedTool,
} from "./baseline.js";
/** suite fingerprint 계산의 단일 구현. cli가 자체 구현을 두면 두 벌이 갈라진다. */
export { canonicalJson, sha256 } from "./canonical.js";
export {
  type AxisCoverage,
  type CoverageResult,
  computeCoverage,
  type ToolCoverage,
} from "./coverage.js";
export { diagnosisPrompt } from "./diagnosis-prompt.js";
export type {
  DiagnosisDispatchResult,
  DiagnosisRequestBinding,
  DiagnosisRequestPreview,
  DiagnosisValidation,
} from "./diagnosis-request.js";
export {
  DEFAULT_MAX_REPAIR_CASES,
  dispatchDiagnosisRequest,
  MAX_REPAIR_STDERR_BYTES,
  prepareDiagnosisRequest,
  validateDiagnosisResult,
} from "./diagnosis-request.js";
export type {
  DiagnosisCause,
  DiagnosisDiagnostic,
  DiagnosisDiscarded,
  DiagnosisFailure,
  DiagnosisProcessDiagnostics,
  DiagnosisRequest,
  DiagnosisResult,
  ServerDiagnosisProvider,
} from "./diagnosis-schema.js";
export {
  buildDiagnosisProviderSchema,
  DIAGNOSIS_PROVIDER_SCHEMA,
  diagnosisCaseIds,
  MAX_CAUSE_CHARS,
} from "./diagnosis-schema.js";
export type {
  PreFillCase,
  PreFillDiscard,
  PreFillDispatchResult,
  PreFillOutputSchema,
  PreFillProposal,
  PreFillProvider,
  PreFillRequest,
  PreFillRequestBinding,
  PreFillRequestPreview,
  PreFillResult,
} from "./pre-fill.js";
export {
  dispatchPreFillRequest,
  preparePreFillRequest,
  previewPreFillRequest,
  validatePreFillResult,
} from "./pre-fill.js";
export {
  analyzeToolProvenance,
  type ToolProvenance,
  type ValueProvenance,
} from "./provenance.js";
export type {
  AuthoringProviderFailureCode,
  AuthoringProviderFailureReason,
  ProviderFailureClassification,
  ProviderProcessChild,
  ProviderProcessDeps,
  ProviderProcessResult,
  ProviderProcessSpec,
} from "./provider-process.js";
export {
  createClaudeAuthoringProvider,
  createClaudeProvider,
  createCodexAuthoringProvider,
  createCodexProvider,
  PROVIDER_ENV_ALLOWLIST,
} from "./providers.js";
export type {
  RejectionDiagnosisCase,
  RejectionDiagnosisDispatchResult,
  RejectionDiagnosisProvider,
  RejectionDiagnosisRequest,
  RejectionDiagnosisResult,
  RejectionDiagnosisValidation,
  RejectionVerdict,
} from "./rejection-diagnosis.js";
export {
  buildRejectionDiagnosisProviderSchema,
  dispatchRejectionDiagnosis,
  prepareRejectionDiagnosisRequests,
  REJECTION_MAX_REASON_CHARS,
  rejectionDiagnosisPrompt,
  validateRejectionDiagnosisResults,
} from "./rejection-diagnosis.js";
export type { GenerateTestsErrorCode } from "./schema.js";
export { GenerateTestsError } from "./schema.js";
export { buildViolationCases, type GeneratedCase } from "./violation-cases.js";

/** 테스트 코드를 생성할 때의 옵션. */
export interface GenerateOptions {
  outDir: string;
  /** 기존 생성 파일을 교체할지 여부. 기본값은 false다. */
  overwrite?: boolean;
}

type GeneratedDraft = {
  fileName: string;
  source: string;
};

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function assertPathInsideOutDir(outDir: string, path: string): void {
  const relativePath = relative(outDir, path);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    fail(
      "GENERATED_SUITE_INVALID",
      path,
      `생성 파일 경로가 출력 디렉터리를 벗어납니다: ${path}`,
      "도구 이름과 출력 디렉터리를 확인하세요.",
    );
  }
}

async function writeGeneratedFile(path: string, source: string, overwrite: boolean): Promise<void> {
  if (overwrite) {
    if (typeof constants.O_NOFOLLOW !== "number") {
      fail(
        "GENERATED_SUITE_INVALID",
        path,
        `이 환경에서는 생성 파일을 안전하게 덮어쓸 수 없습니다: ${path}`,
        "심볼릭 링크를 따라가지 않는 파일 열기를 지원하는 환경을 사용하세요.",
      );
    }

    let file: Awaited<ReturnType<typeof open>> | undefined;
    try {
      file = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      );
      await file.writeFile(source, { encoding: "utf8" });
    } catch (error) {
      if (isNodeError(error) && error.code === "ELOOP") {
        fail(
          "GENERATED_SUITE_INVALID",
          path,
          `심볼릭 링크인 생성 파일을 덮어쓸 수 없습니다: ${path}`,
          "심볼릭 링크를 제거하고 출력 디렉터리 안의 일반 파일을 사용하세요.",
        );
      }
      throw error;
    } finally {
      await file?.close();
    }
    return;
  }

  try {
    await writeFile(path, source, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      fail(
        "OUTPUT_FILE_EXISTS",
        path,
        `기존 생성 파일을 덮어쓸 수 없습니다: ${path}`,
        "기존 파일을 보존하거나 명시적으로 overwrite: true를 지정하세요.",
      );
    }
    throw error;
  }
}

function createDrafts(tools: ToolDef[]): GeneratedDraft[] {
  const entries = tools.map((tool, index) => {
    const name = typeof tool?.name === "string" ? tool.name : "";
    return { index, initialName: safeBaseName(name, index), name, tool };
  });
  const namesByInitialName = new Map<string, Set<string>>();
  for (const { initialName, name } of entries) {
    const names = namesByInitialName.get(initialName) ?? new Set<string>();
    names.add(name);
    namesByInitialName.set(initialName, names);
  }

  const usedNames = new Set<string>();
  const drafts = new Array<GeneratedDraft>(tools.length);
  const sortedEntries = [...entries].sort(
    (left, right) =>
      (left.initialName < right.initialName ? -1 : left.initialName > right.initialName ? 1 : 0) ||
      (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
      left.index - right.index,
  );

  for (const { index, initialName, name, tool } of sortedEntries) {
    const hasDistinctCollision = (namesByInitialName.get(initialName)?.size ?? 0) > 1;
    const stableName = hasDistinctCollision
      ? `${initialName}-${nameDiscriminator(name)}`
      : initialName;
    let baseName = stableName;
    for (let occurrence = 2; usedNames.has(baseName); occurrence++) {
      baseName = `${stableName}-${occurrence}`;
    }
    usedNames.add(baseName);

    drafts[index] = {
      fileName: `${baseName}.generated.ts`,
      source: renderTool(tool, index, baseName),
    };
  }

  return drafts;
}

/**
 * 도구 스키마마다 Runner의 선언형 suite 파일을 만들고 생성한 절대 경로를 반환한다.
 * 모든 스키마를 먼저 검증하므로 스키마 오류로 일부 파일만 생성되지 않는다.
 */
export async function generateTests(tools: ToolDef[], options: GenerateOptions): Promise<string[]> {
  if (!Array.isArray(tools)) {
    fail(
      "INVALID_TOOL",
      "tools",
      "tools는 ToolDef 배열이어야 합니다.",
      "도구 목록 배열을 전달하세요.",
    );
  }
  if (typeof options?.outDir !== "string" || !/\S/.test(options.outDir)) {
    fail(
      "INVALID_OPTIONS",
      "options.outDir",
      "출력 디렉터리가 비어 있습니다.",
      "생성 파일을 저장할 디렉터리를 지정하세요.",
    );
  }
  if (options.overwrite !== undefined && typeof options.overwrite !== "boolean") {
    fail(
      "INVALID_OPTIONS",
      "options.overwrite",
      "overwrite 옵션은 boolean이어야 합니다.",
      "기존 생성 파일을 교체하려면 true, 보존하려면 false를 지정하세요.",
    );
  }
  if (tools.length === 0) return [];

  const drafts = createDrafts(tools);
  const outDir = resolve(options.outDir);
  const paths = drafts.map(({ fileName }) => join(outDir, fileName));
  for (const path of paths) assertPathInsideOutDir(outDir, path);

  const overwrite = options.overwrite ?? false;
  if (!overwrite) {
    const existing = await Promise.all(
      paths.map(async (path) => ((await pathExists(path)) ? path : null)),
    );
    const existingPath = existing.find((path): path is string => path !== null);
    if (existingPath !== undefined) {
      fail(
        "OUTPUT_FILE_EXISTS",
        existingPath,
        `기존 생성 파일을 덮어쓸 수 없습니다: ${existingPath}`,
        "기존 파일을 보존하거나 명시적으로 overwrite: true를 지정하세요.",
      );
    }
  }

  await mkdir(outDir, { recursive: true });
  await Promise.all(
    drafts.map(({ source }, index) =>
      writeGeneratedFile(paths[index] as string, source, overwrite),
    ),
  );
  return paths;
}
