import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL("../src", import.meta.url));

/**
 * `generate → runner` 의존은 ADR-0009로 승인된 예외다. 승인 범위를 코드로 고정한다.
 * 이 목록 밖 심볼을 가져오면 이 테스트가 깨진다. 목록을 늘리려면 ADR을 먼저 고쳐야 한다.
 */
const APPROVED_RUNNER_SYMBOLS = [
  "DEFAULT_SENSITIVE_KEYS",
  "MCP_SUITE_JSON_SCHEMA",
  "REDACTED",
  "RunnerRedactionOptions",
  "SuiteValidationIssue",
  "TestCaseSpec",
  "TestSuiteSpec",
  "validateMcpSuite",
];

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(sourceDir, entry.name));
}

/** `import ... from "@ohmymcp/runner"` 구문에서 가져오는 심볼 이름만 뽑는다. */
function runnerImports(source: string): string[] {
  const names: string[] = [];
  // 줄 시작 앵커를 건다. render.ts는 생성 파일에 넣을 import 문을 문자열 리터럴로 들고 있는데
  // (들여쓰기된 `'import { defineMcpSuite } from "@ohmymcp/runner";'`), 그것은 이 패키지의
  // 의존이 아니다. 실제 import 문만 열 0에서 시작한다.
  // clause에 따옴표와 세미콜론을 허용하지 않아 앞선 import 문으로도 넘어가지 않는다.
  const statement = /^import\s+([^"';]*?)\s+from\s+"@ohmymcp\/runner"/gm;
  for (const match of source.matchAll(statement)) {
    const clause = match[1] ?? "";
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (braces === null) continue;
    for (const raw of (braces[1] ?? "").split(",")) {
      const name = raw
        .replace(/^\s*type\s+/, "")
        .split(/\s+as\s+/)[0]
        ?.trim();
      if (name !== undefined && name.length > 0) names.push(name);
    }
  }
  return names;
}

describe("dependency boundary", () => {
  it("packages/generate가 runner에서 가져오는 심볼은 승인 목록과 정확히 일치한다", async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const file of files)
      for (const name of runnerImports(await readFile(file, "utf8"))) used.add(name);
    expect([...used].sort()).toEqual(APPROVED_RUNNER_SYMBOLS);
  });
  it("generate는 cli를 참조하지 않는다", async () => {
    for (const file of await sourceFiles())
      expect(await readFile(file, "utf8")).not.toContain("@ohmymcp/cli");
  });
});
