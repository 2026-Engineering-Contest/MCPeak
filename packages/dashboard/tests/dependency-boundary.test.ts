import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const packagesDir = fileURLToPath(new URL("../..", import.meta.url));
const packageNames = ["core", "runner", "generate", "record", "mock", "cli", "dashboard"] as const;
type PackageName = (typeof packageNames)[number];

/**
 * 상위 패키지는 인접 층을 건너뛰어도 아래 패키지를 직접 쓸 수 있다.
 * 이 목록 밖 참조는 역방향이거나 승인되지 않은 옆 방향 참조다.
 */
const ALLOWED_INTERNAL_DEPENDENCIES: Readonly<Record<PackageName, readonly PackageName[]>> = {
  core: [],
  runner: ["core"],
  generate: ["core", "runner"],
  record: [],
  mock: ["core"],
  cli: ["core", "runner", "generate", "record", "mock"],
  dashboard: ["core", "runner", "generate", "record", "mock", "cli"],
};

interface PackageManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files.sort();
}

function internalImports(source: string, fileName: string): PackageName[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = new Set<PackageName>();

  const addSpecifier = (node: ts.Node | undefined) => {
    if (node === undefined) return;
    const specifier = ts.isLiteralTypeNode(node) ? node.literal : node;
    if (!ts.isStringLiteralLike(specifier)) return;
    const match = specifier.text.match(/^@mcpeak\/([^/]+)/);
    const packageName = match?.[1];
    if (packageNames.includes(packageName as PackageName)) found.add(packageName as PackageName);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addSpecifier(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      addSpecifier(node.argument);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      addSpecifier(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...found].sort();
}

async function manifest(packageName: PackageName): Promise<PackageManifest> {
  return JSON.parse(
    await readFile(join(packagesDir, packageName, "package.json"), "utf8"),
  ) as PackageManifest;
}

async function importedInternalPackages(packageName: PackageName): Promise<PackageName[]> {
  const sourceDirectories = [join(packagesDir, packageName, "src")];
  if (packageName === "dashboard") {
    sourceDirectories.push(join(packagesDir, packageName, "web", "src"));
  }
  const imported = new Set<PackageName>();
  for (const directory of sourceDirectories) {
    for (const file of await sourceFiles(directory)) {
      for (const dependency of internalImports(await readFile(file, "utf8"), file)) {
        imported.add(dependency);
      }
    }
  }
  return [...imported].sort();
}

function declaredInternalPackages(packageManifest: PackageManifest): PackageName[] {
  return Object.keys(packageManifest.dependencies ?? {})
    .filter((dependency) => dependency.startsWith("@mcpeak/"))
    .map((dependency) => dependency.slice("@mcpeak/".length) as PackageName)
    .sort();
}

describe("workspace dependency boundary", () => {
  it("dashboard의 내부 의존 선언은 실제 소스 import와 정확히 일치한다", async () => {
    expect(
      declaredInternalPackages(await manifest("dashboard")),
      "→ package.json dependencies와 src·web/src의 @mcpeak import를 맞추세요.",
    ).toEqual(await importedInternalPackages("dashboard"));
  });

  it("정적·동적·타입 import를 세고 문자열과 주석은 세지 않는다", () => {
    const source = [
      'import type { ToolDef } from "@mcpeak/core";',
      'export { validateMcpSuite } from "@mcpeak/runner";',
      'const loadGenerate = () => import("@mcpeak/generate");',
      'type RecordModule = typeof import("@mcpeak/record/external");',
      'const example = "@mcpeak/mock";',
      '// import("@mcpeak/cli/commands")',
    ].join("\n");
    expect(internalImports(source, "example.ts")).toEqual(["core", "generate", "record", "runner"]);
  });

  it.each(packageNames)("%s는 허용된 하위 패키지만 의존한다", async (name) => {
    const declared = declaredInternalPackages(await manifest(name));
    expect(
      declared.filter((dependency) => !ALLOWED_INTERNAL_DEPENDENCIES[name].includes(dependency)),
      "→ 역방향·순환 의존을 제거하거나 ADR-0091의 허용 경계를 먼저 검토하세요.",
    ).toEqual([]);
  });
});
