import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BENCH_ROOT, MODEL, RESULTS_DIR } from "../lib/paths.ts";
import type { RunRecord } from "../lib/aggregate.ts";
import { renderReport, type ReportInput } from "../lib/report-render.ts";

/**
 * 벤더링된 everything-server.ts 가 고정된 업스트림 커밋(NOTICE.md 와 같은 값).
 * 벤치마크 코드는 git 을 실행하지 않으므로 하드코딩한다.
 */
const CONFORMANCE_COMMIT = "1573ad5fc857d569ef405296e5d61de3ee6f921c";

/**
 * docs/plans/2026-09-23-repair-효과-벤치마크-설계.md 8절 "전제와 한계" 다섯 항목을
 * 그대로 옮긴 것이다. 설계 문서가 바뀌면 이 배열도 손으로 맞춰야 한다.
 */
const PREMISES: readonly string[] = [
  "결함은 우리가 주입했고, 대상 서버는 공식 참조 서버 하나다",
  "수리 에이전트는 Claude Code + Sonnet 5 하나다",
  "에이전트는 코드 실행을 못 하는 조건이다",
  "mcpeak 은 도구 영역만 본다. 대조 결함 결과가 이 한계를 그대로 보여 준다",
  "반복 5회라 소수의 우연이 숫자를 흔들 수 있다",
];

interface Baseline {
  readonly passing: readonly string[];
}

interface PackageJson {
  readonly dependencies: Record<string, string>;
}

async function readBaseline(): Promise<Baseline> {
  const text = await readFile(join(RESULTS_DIR, "baseline.json"), "utf8");
  return JSON.parse(text) as Baseline;
}

async function readRuns(): Promise<RunRecord[]> {
  const text = await readFile(join(RESULTS_DIR, "runs.json"), "utf8");
  return JSON.parse(text) as RunRecord[];
}

async function readDetection(): Promise<ReportInput["detection"]> {
  const text = await readFile(join(RESULTS_DIR, "detection.json"), "utf8");
  return JSON.parse(text) as ReportInput["detection"];
}

async function readPackageVersions(): Promise<{ conformanceVersion: string; sdkVersion: string }> {
  const text = await readFile(join(BENCH_ROOT, "package.json"), "utf8");
  const pkg = JSON.parse(text) as PackageJson;
  return {
    conformanceVersion: pkg.dependencies["@modelcontextprotocol/conformance"] ?? "알 수 없음",
    sdkVersion: pkg.dependencies["@modelcontextprotocol/sdk"] ?? "알 수 없음",
  };
}

async function main(): Promise<void> {
  const [baseline, records, detection, versions] = await Promise.all([
    readBaseline(),
    readRuns(),
    readDetection(),
    readPackageVersions(),
  ]);

  const input: ReportInput = {
    records,
    detection,
    baselinePassingCount: baseline.passing.length,
    premises: PREMISES,
    fixed: {
      conformanceCommit: CONFORMANCE_COMMIT,
      conformanceVersion: versions.conformanceVersion,
      sdkVersion: versions.sdkVersion,
      model: MODEL,
    },
  };

  const markdown = renderReport(input);
  await writeFile(join(RESULTS_DIR, "report.md"), markdown, "utf8");
  console.log("results/report.md 작성 완료");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
