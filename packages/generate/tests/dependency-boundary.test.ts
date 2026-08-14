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
  "ContractAxis",
  "ContractDeclaredType",
  "DEFAULT_SENSITIVE_KEYS",
  "MCP_SUITE_JSON_SCHEMA",
  "REDACTED",
  "RunnerRedactionOptions",
  "SpecFindingsResult",
  "SuiteValidationIssue",
  "TestCaseSpec",
  "TestSuiteSpec",
  "canonicalJson",
  "checkAssertionSubstance",
  "checkInputContract",
  "deepFreeze",
  "deriveContractAxes",
  "sha256",
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
  // export ... from 도 같이 센다. 재수출도 이 패키지가 runner에서 가져오는 심볼이기 때문이다.
  // import만 세면 canonical.ts의 재수출 한 줄로 ADR-0009의 경계를 우회할 수 있다.
  // 인용부호는 캡처해서 backreference로 짝을 맞춘다. 큰따옴표만 보면 작은따옴표로 쓴 구문이
  // 빠져나간다. biome이 큰따옴표로 포매팅한다고 해도 경계 장치에 우회 경로를 두지 않는다.
  const statement = /^(?:import|export)\s+([^"';]*?)\s+from\s+(["'])@ohmymcp\/runner\2/gm;
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
  it("승인 목록에 canonicalJson · deepFreeze · sha256 이 있다", () => {
    expect(APPROVED_RUNNER_SYMBOLS).toEqual(
      expect.arrayContaining(["canonicalJson", "deepFreeze", "sha256"]),
    );
  });

  it('export ... from "@ohmymcp/runner" 구문의 심볼도 수집한다', () => {
    const source = 'export { canonicalJson, deepFreeze, sha256 } from "@ohmymcp/runner";\n';
    expect(runnerImports(source).sort()).toEqual(["canonicalJson", "deepFreeze", "sha256"]);
  });

  it("작은따옴표로 쓴 재수출도 수집한다", () => {
    const source = "export { runSuite } from '@ohmymcp/runner';\n";
    expect(runnerImports(source)).toContain("runSuite");
  });

  it("인용부호 짝이 맞지 않는 구문은 수집하지 않는다", () => {
    expect(runnerImports("export { runSuite } from \"@ohmymcp/runner';\n")).toEqual([]);
  });

  it("목록에 없는 심볼을 재수출하면 수집 결과에 잡힌다", () => {
    // 정규식만 넓히고 검증하지 않으면 다음에 누가 되돌려도 아무도 모른다.
    const source = 'export { runSuite } from "@ohmymcp/runner";\n';
    expect(runnerImports(source)).toContain("runSuite");
    expect(APPROVED_RUNNER_SYMBOLS).not.toContain("runSuite");
  });

  it("generate는 cli를 참조하지 않는다", async () => {
    for (const file of await sourceFiles())
      expect(await readFile(file, "utf8")).not.toContain("@ohmymcp/cli");
  });
});
