import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDir = fileURLToPath(new URL("../src", import.meta.url));
/** 실패 화면에 찍는 경로. 로컬 절대 경로를 내보내지 않는다(CONTRIBUTING §5-7). */
const sourceDirLabel = "packages/generate/src";
const adrPath = fileURLToPath(
  new URL("../../../docs/adr/0009-generate가-runner에-의존하는-예외.md", import.meta.url),
);

/**
 * `generate → runner` 의존은 ADR-0009로 승인된 예외다. 승인 범위를 코드로 고정한다.
 * 이 목록 밖 심볼을 가져오면 이 테스트가 깨진다. 목록을 늘리려면 ADR을 먼저 고쳐야 한다.
 */
const APPROVED_RUNNER_SYMBOLS = [
  "ContractAxis",
  "ContractAxisKind",
  "ContractDeclaredType",
  "ContractRange",
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
  "isSensitiveKey",
  "matchCoveredAxes",
  "sha256",
  "validateMcpSuite",
];

function approvedRunnerSymbolsFromAdr(source: string): string[] {
  const background = source.split(/^## 배경\s*$/m)[1]?.split(/^##\s/m)[0] ?? "";
  const rows = background.split(/\r?\n/);
  const headerIndex = rows.findIndex((row) => {
    const columns = row
      .trim()
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((column) => column.trim());
    return columns[0] === "종류" && columns[1] === "심볼";
  });
  if (headerIndex < 0) return [];

  const symbols: string[] = [];
  for (const row of rows.slice(headerIndex + 2)) {
    if (!row.trim().startsWith("|")) break;
    const symbolColumn = row.split("|")[2] ?? "";
    for (const match of symbolColumn.matchAll(/`([^`]+)`/g)) symbols.push(match[1] ?? "");
  }
  return symbols;
}

async function sourceFiles(): Promise<string[]> {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(sourceDir, entry.name));
}

/** runner를 가리키는 import·export 구문 하나. `clause`는 `from` 앞의 절, `text`는 구문 원문이다. */
interface RunnerStatement {
  readonly clause: string;
  readonly text: string;
  /** `import "@mcpeak/runner";` — 절이 아예 없는 side-effect import. */
  readonly sideEffectOnly: boolean;
}

/** runner를 가리키는 구문을 뽑는다. 심볼 수집과 경계 위반 검사가 같은 판정을 쓰게 하는 자리다. */
function runnerStatements(source: string): RunnerStatement[] {
  // 줄 시작 앵커를 건다. render.ts는 생성 파일에 넣을 import 문을 문자열 리터럴로 들고 있는데
  // (들여쓰기된 `'import { defineMcpSuite } from "@mcpeak/runner";'`), 그것은 이 패키지의
  // 의존이 아니다. 실제 import 문만 열 0에서 시작한다.
  // clause에 따옴표와 세미콜론을 허용하지 않아 앞선 import 문으로도 넘어가지 않는다.
  // export ... from 도 같이 센다. 재수출도 이 패키지가 runner에서 가져오는 심볼이기 때문이다.
  // import만 세면 canonical.ts의 재수출 한 줄로 ADR-0009의 경계를 우회할 수 있다.
  // 인용부호는 캡처해서 backreference로 짝을 맞춘다. 큰따옴표만 보면 작은따옴표로 쓴 구문이
  // 빠져나간다. biome이 큰따옴표로 포매팅한다고 해도 경계 장치에 우회 경로를 두지 않는다.
  //
  // 알려진 한계: 동적 `await import("@mcpeak/runner")`는 정적 검사 대상이 아니다.
  const statement = /^(?:import|export)\s+([^"';]*?)\s+from\s+(["'])@mcpeak\/runner\2/gm;
  // `from`이 없는 side-effect import는 위 정규식에 안 걸린다. `import` 뒤에 인용부호가 바로 오므로
  // 명시 import 구문과 겹치지 않는다. 가져오는 심볼은 0개지만 의존 자체는 생기고, ADR-0009의
  // 승인 표는 심볼로 적혀 있어 이 줄을 표현할 방법이 없다. 그래서 경계 위반으로 다룬다.
  const sideEffect = /^import\s+(["'])@mcpeak\/runner\1/gm;

  const found = [
    ...[...source.matchAll(statement)].map((match) => ({
      index: match.index,
      clause: match[1] ?? "",
      text: match[0],
      sideEffectOnly: false,
    })),
    ...[...source.matchAll(sideEffect)].map((match) => ({
      index: match.index,
      clause: "",
      text: match[0],
      sideEffectOnly: true,
    })),
  ];
  // 두 번 훑으므로 등장 순서로 다시 세운다. 실패 화면의 줄 순서가 정규식 실행 순서에 따라
  // 흔들리면 안 된다 — 같은 입력에 같은 출력이 이 저장소의 핵심 가치다.
  return found
    .sort((left, right) => left.index - right.index)
    .map(({ clause, text, sideEffectOnly }) => ({ clause, text, sideEffectOnly }));
}

/** `import ... from "@mcpeak/runner"` 구문에서 가져오는 심볼 이름만 뽑는다. */
function runnerImports(source: string): string[] {
  const names: string[] = [];
  for (const { clause } of runnerStatements(source)) {
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

/**
 * 승인 목록으로 범위를 좁힐 수 없는 runner 구문을 뽑는다.
 *
 * `import * as` · `export *` · `export * as` · default import · default 혼합 · side-effect import가
 * 여기 해당한다. 판정은 `*`를 찾는 것이 아니라 **중괄호 밖에 이름이 남는가**다. `*`만 열거하면
 * default import가 같은 방식으로 빠져나간다 — 둘 다 "가져온 것을 목록으로 좁힐 수 없다"는 같은
 * 문제다. side-effect import는 반대로 가져오는 것이 0개라 승인 표에 적을 수 없다.
 *
 * 심볼 수집(`runnerImports`)과 나눠 둔 이유는 처방이 다르기 때문이다. 목록 밖 심볼은 "ADR을
 * 고쳐 목록을 늘려라"지만, 이쪽은 "명시 import로 바꿔라"다. 한 목록에 섞으면 화면이 틀린 처방을
 * 준다.
 */
function unscopedRunnerStatements(source: string): string[] {
  const offenders: string[] = [];
  for (const { clause, text, sideEffectOnly } of runnerStatements(source)) {
    if (sideEffectOnly) {
      offenders.push(text.trim());
      continue;
    }
    const outsideBraces = clause.replace(/\{[\s\S]*?\}/g, "");
    // `import type { A }` 의 선행 `type`은 이름이 아니다. 쉼표와 공백을 걷어낸 뒤 남는 것이 있으면
    // 중괄호 밖에서 무언가를 가져오고 있다는 뜻이다.
    const remainder = outsideBraces.replace(/^\s*type\s+/, "").replace(/[\s,]/g, "");
    if (remainder.length > 0) offenders.push(text.trim());
  }
  return offenders;
}

const UNSCOPED_STATEMENT_HINT = [
  "→ ADR-0009는 generate → runner 의존을 '승인된 심볼 목록'으로만 허용합니다.",
  "→ 아래 구문은 가져오는 것을 그 목록으로 표현할 수 없어 장치를 통째로 우회합니다.",
  '→ 필요한 심볼만 명시해서 가져오세요: import { canonicalJson } from "@mcpeak/runner"',
  '→ side-effect import(import "@mcpeak/runner")라면 심볼 없이 의존만 생깁니다. 줄을 지우세요.',
  "→ 새 심볼이 정말 필요하면 ADR-0009의 승인 표를 먼저 고치세요.",
].join("\n");

describe("dependency boundary", () => {
  it("packages/generate가 runner에서 가져오는 심볼은 승인 목록과 정확히 일치한다", async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const used = new Set<string>();
    for (const file of files)
      for (const name of runnerImports(await readFile(file, "utf8"))) used.add(name);
    expect([...used].sort()).toEqual(APPROVED_RUNNER_SYMBOLS);
  });

  it("ADR-0009의 승인 심볼 표가 코드의 승인 목록과 정확히 일치한다", async () => {
    const adrSymbols = approvedRunnerSymbolsFromAdr(await readFile(adrPath, "utf8"));
    expect(adrSymbols.length).toBeGreaterThan(0);
    expect(adrSymbols.sort()).toEqual(APPROVED_RUNNER_SYMBOLS);
  });

  it("승인 목록에 canonicalJson · deepFreeze · sha256 이 있다", () => {
    expect(APPROVED_RUNNER_SYMBOLS).toEqual(
      expect.arrayContaining(["canonicalJson", "deepFreeze", "sha256"]),
    );
  });

  it('export ... from "@mcpeak/runner" 구문의 심볼도 수집한다', () => {
    const source = 'export { canonicalJson, deepFreeze, sha256 } from "@mcpeak/runner";\n';
    expect(runnerImports(source).sort()).toEqual(["canonicalJson", "deepFreeze", "sha256"]);
  });

  it("작은따옴표로 쓴 재수출도 수집한다", () => {
    const source = "export { runSuite } from '@mcpeak/runner';\n";
    expect(runnerImports(source)).toContain("runSuite");
  });

  it("인용부호 짝이 맞지 않는 구문은 수집하지 않는다", () => {
    expect(runnerImports("export { runSuite } from \"@mcpeak/runner';\n")).toEqual([]);
  });

  it("목록에 없는 심볼을 재수출하면 수집 결과에 잡힌다", () => {
    // 정규식만 넓히고 검증하지 않으면 다음에 누가 되돌려도 아무도 모른다.
    const source = 'export { runSuite } from "@mcpeak/runner";\n';
    expect(runnerImports(source)).toContain("runSuite");
    expect(APPROVED_RUNNER_SYMBOLS).not.toContain("runSuite");
  });

  it("네임스페이스 import는 경계 위반으로 잡힌다", () => {
    const source = 'import * as runner from "@mcpeak/runner";\n';
    expect(unscopedRunnerStatements(source)).toEqual(['import * as runner from "@mcpeak/runner"']);
    // 심볼 수집만으로는 안 잡힌다. 두 검사가 나뉘어 있다는 사실을 고정한다.
    expect(runnerImports(source)).toEqual([]);
  });

  it("wildcard 재수출은 경계 위반으로 잡힌다", () => {
    const source = 'export * from "@mcpeak/runner";\n';
    expect(unscopedRunnerStatements(source)).toEqual(['export * from "@mcpeak/runner"']);
    expect(runnerImports(source)).toEqual([]);
  });

  it("export * as 네임스페이스 재수출도 경계 위반이다", () => {
    const source = 'export * as runner from "@mcpeak/runner";\n';
    expect(unscopedRunnerStatements(source)).toEqual(['export * as runner from "@mcpeak/runner"']);
  });

  it("default import와 default 혼합 import도 경계 위반이다", () => {
    // `*`만 찾는 규칙이면 이 둘이 그대로 빠져나간다. 판정 기준이 "중괄호 밖 이름"인 이유다.
    expect(unscopedRunnerStatements('import runner from "@mcpeak/runner";\n')).toEqual([
      'import runner from "@mcpeak/runner"',
    ]);
    const mixed = 'import runner, { canonicalJson } from "@mcpeak/runner";\n';
    expect(unscopedRunnerStatements(mixed)).toEqual([
      'import runner, { canonicalJson } from "@mcpeak/runner"',
    ]);
    // 명시한 쪽은 심볼로도 잡힌다. 위반 검사가 심볼 수집을 가리지 않는다.
    expect(runnerImports(mixed)).toEqual(["canonicalJson"]);
  });

  it("side-effect import도 경계 위반이다", () => {
    // 가져오는 심볼이 0개라 ADR-0009의 승인 표(심볼 목록)에 적을 방법이 없다.
    const source = 'import "@mcpeak/runner";\n';
    expect(unscopedRunnerStatements(source)).toEqual(['import "@mcpeak/runner"']);
    expect(unscopedRunnerStatements("import '@mcpeak/runner';\n")).toEqual([
      "import '@mcpeak/runner'",
    ]);
    expect(runnerImports(source)).toEqual([]);
  });

  it("side-effect import도 줄 시작 앵커와 인용부호 짝 규칙을 따른다", () => {
    expect(unscopedRunnerStatements('  import "@mcpeak/runner";\n')).toEqual([]);
    expect(unscopedRunnerStatements("import \"@mcpeak/runner';\n")).toEqual([]);
  });

  it("동적 import는 이 검사의 대상이 아니다", () => {
    // 알려진 한계를 고정한다. 정적 정규식의 사정권 밖이고, 넓히면 문자열 리터럴까지 딸려온다.
    expect(unscopedRunnerStatements('const runner = await import("@mcpeak/runner");\n')).toEqual(
      [],
    );
  });

  it("위반 구문은 파일에 등장한 순서대로 돌려준다", () => {
    // 두 정규식을 따로 훑으므로 순서를 다시 세운다. 같은 입력에 같은 출력이어야 한다.
    const source = [
      'export * from "@mcpeak/runner";',
      'import { canonicalJson } from "@mcpeak/runner";',
      'import "@mcpeak/runner";',
      'import * as runner from "@mcpeak/runner";',
      "",
    ].join("\n");
    expect(unscopedRunnerStatements(source)).toEqual([
      'export * from "@mcpeak/runner"',
      'import "@mcpeak/runner"',
      'import * as runner from "@mcpeak/runner"',
    ]);
  });

  it("명시 import·재수출·type import는 위반이 아니다", () => {
    for (const source of [
      'import { canonicalJson } from "@mcpeak/runner";\n',
      'export { sha256 } from "@mcpeak/runner";\n',
      'import type { TestSuiteSpec } from "@mcpeak/runner";\n',
      'import { type ContractAxis, sha256 } from "@mcpeak/runner";\n',
      "export { deepFreeze } from '@mcpeak/runner';\n",
    ])
      expect(unscopedRunnerStatements(source), source).toEqual([]);
  });

  it("위반 검사도 줄 시작 앵커와 인용부호 짝 규칙을 그대로 따른다", () => {
    // 들여쓴 구문은 render.ts가 생성 파일에 넣을 문자열이지 이 패키지의 의존이 아니다.
    expect(unscopedRunnerStatements('  import * as runner from "@mcpeak/runner";\n')).toEqual([]);
    expect(unscopedRunnerStatements("import * as runner from \"@mcpeak/runner';\n")).toEqual([]);
  });

  it("generate 소스에 범위를 좁힐 수 없는 runner 구문이 없다", async () => {
    const files = await sourceFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files)
      for (const statement of unscopedRunnerStatements(await readFile(file, "utf8")))
        offenders.push(`${join(sourceDirLabel, basename(file))}: ${statement}`);
    expect(offenders, UNSCOPED_STATEMENT_HINT).toEqual([]);
  });

  it("generate는 cli를 참조하지 않는다", async () => {
    for (const file of await sourceFiles())
      expect(await readFile(file, "utf8")).not.toContain("@mcpeak/cli");
  });
});
