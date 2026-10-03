import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as auditModule from "@mcpeak/audit";
import * as core from "@mcpeak/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runAuditCommand } from "../src/audit-command.js";
import { AUDIT_USAGE, GLOBAL_HELP } from "../src/help.js";
import { COMMANDS, nodeAuditDependencies, run } from "../src/index.js";

/**
 * 계획서 §1.3·§8.7 의 E2E. examples/ 의 서버를 실제 프로세스로 띄워 `mcpeak audit` 를 돌린다.
 * 우리 도구로 우리를 검증한다. 정상 예제 네 개는 결함이 없어야 하고, 표적 서버는 기대 목록과 같아야 한다.
 */

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const examples = join(root, "examples");
const target = join(examples, "audit-target-server/server.mjs");
const expectedPath = join(examples, "audit-target-server/server.audit.expected.json");

/**
 * mock 예제의 `server.mjs` 는 `@mcpeak/mock` 의 dist 를 import 한다. CI 의 verify 잡은 빌드 없이
 * `pnpm test` 를 돌려 dist 가 없다. 그래서 mock 패키지가 자기 E2E 에 쓰는 소스 진입점으로 **같은
 * 정의 파일**(examples/mock-server/weather.mock.json)을 띄운다. 서버가 내는 tools/list 는 같다.
 * `--import` 에 URL 을 넘기는 이유는 packages/mock/tests/stdio-e2e.test.ts 의 주석에 있다.
 */
const mockEntry = join(root, "packages/mock/tests/fixtures/stdio-entry.mjs");
const mockResolve = new URL("../../mock/tests/fixtures/register-ts-resolve.mjs", import.meta.url)
  .href;

const SERVERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["weather-server", [join(examples, "weather-server/server.mjs")]],
  ["zod-notes-server", [join(examples, "zod-notes-server/server.mjs")]],
  ["live-weather-server", [join(examples, "live-weather-server/server.mjs")]],
  [
    "mock-server",
    ["--import", mockResolve, mockEntry, join(examples, "mock-server/weather.mock.json")],
  ],
];

const E2E_TIMEOUT_MS = 60_000;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcpeak-audit-e2e-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** `run()` 을 돌리고 stdout·stderr 를 모은다. 실제 진입점과 같은 배선을 탄다. */
async function cli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const code = await run(argv);
    return {
      code,
      stdout: out.mock.calls.map(([value]) => String(value)).join(""),
      stderr: err.mock.calls.map(([value]) => String(value)).join(""),
    };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
}

interface Finding {
  readonly ruleId: string;
  readonly severity: string;
}

const auditJson = async (...argv: string[]) => {
  const result = await cli(["audit", "--json", ...argv]);
  return {
    ...result,
    report: JSON.parse(result.stdout) as { exitCode: number; findings: Finding[] },
  };
};

const defects = (findings: readonly Finding[]) =>
  findings.filter((f) => f.severity !== "info" && !f.ruleId.startsWith("flow/"));

describe("audit e2e", () => {
  it.each(SERVERS)(
    "%s 에서 info·flow 를 제외한 발견이 0건이고 종료 코드 0",
    async (_name, args) => {
      const { code, report, stderr } = await auditJson("--", process.execPath, ...args);
      expect(stderr).toBe("");
      expect(defects(report.findings)).toEqual([]);
      expect(report.exitCode).toBe(0);
      expect(code).toBe(0);
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "examples/audit-target-server 에서 기대 규칙 목록(§8.1 의 e2e 기대 파일)과 같고 종료 코드 2",
    async () => {
      const expected = JSON.parse(await readFile(expectedPath, "utf8"));
      const { code, report } = await auditJson("--", process.execPath, target);
      expect({
        exitCode: report.exitCode,
        counts: (report as unknown as { counts: unknown }).counts,
        findings: report.findings,
      }).toEqual(expected);
      expect(new Set(report.findings.map((f) => f.ruleId))).toEqual(
        new Set([
          "desc/injection",
          "desc/hidden-unicode",
          "schema/secret-field",
          "schema/annotation-mismatch",
          "secret/env-leak",
          "result/injection",
        ]),
      );
      expect(code).toBe(2);

      // 사람용 리포트도 같은 판정을 낸다. 문장 정본은 §6.1·§6.2 이고 report.test.ts 가 글자 단위로 고정한다.
      const human = await cli(["audit", "--", process.execPath, target]);
      expect(human.code).toBe(2);
      expect(human.stdout).toContain("판정: 심각 5건, 주의 1건, 낮음 0건, 정보 0건");
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "같은 명령을 2회 실행한 --json 출력이 바이트 단위로 같다",
    async () => {
      const first = await cli(["audit", "--json", "--", process.execPath, target]);
      const second = await cli(["audit", "--json", "--", process.execPath, target]);
      expect(first.stdout.length).toBeGreaterThan(0);
      expect(second.stdout).toBe(first.stdout);
      expect(first.stdout).not.toContain("MCPEAK_CANARY_");
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "--baseline 을 처음 주면 baseline-created, 두 번째는 발견 없음, 서버를 mutant 로 바꾸면 surface/changed",
    async () => {
      const baseline = join(dir, "zod-notes.baseline.json");
      const normal = join(examples, "zod-notes-server/server.mjs");
      const mutant = join(examples, "zod-notes-server/server.mutant.mjs");

      const created = await auditJson("--baseline", baseline, "--", process.execPath, normal);
      expect(created.report.findings.map((f) => f.ruleId)).toEqual(["surface/baseline-created"]);
      expect(created.code).toBe(0);
      expect(JSON.parse(await readFile(baseline, "utf8")).server.name).toBe(
        "example-zod-notes-server",
      );

      const unchanged = await auditJson("--baseline", baseline, "--", process.execPath, normal);
      expect(unchanged.report.findings).toEqual([]);
      expect(unchanged.code).toBe(0);

      const changed = await auditJson("--baseline", baseline, "--", process.execPath, mutant);
      const surface = changed.report.findings.filter((f) => f.ruleId.startsWith("surface/"));
      expect(surface.length).toBeGreaterThan(0);
      expect(surface.every((f) => f.ruleId === "surface/changed")).toBe(true);
      expect(changed.code).toBe(changed.report.exitCode);
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "카나리로 띄운 서버의 process.env 에 GITHUB_TOKEN 이 MCPEAK_CANARY_ 로 시작하는 값으로 들어간다 (audit-target-server 의 echo_env 도구로 확인하고, 그 응답이 secret/env-leak 으로 잡힌다)",
    async () => {
      const base = nodeAuditDependencies(core, auditModule);
      const stdout: string[] = [];
      let env: Readonly<Record<string, string>> = {};
      const code = await runAuditCommand(["audit", "--json", "--", process.execPath, target], {
        ...base,
        connectStdio: async (options) => {
          env = options.env ?? {};
          return base.connectStdio(options);
        },
        writeStdout: (text) => stdout.push(text),
        writeStderr: () => {},
      });
      const token = env.GITHUB_TOKEN ?? "";
      expect(token).toMatch(/^MCPEAK_CANARY_[0-9a-f]{16}$/);

      // 같은 env 로 서버를 다시 띄워 echo_env 가 정말 그 값을 돌려주는지 본다. 감사가 본 응답이 이것이다.
      const connection = await core.connectStdio({
        command: process.execPath,
        args: [target],
        env,
      });
      try {
        const result = await connection.client.callTool("echo_env", {});
        expect(JSON.stringify(result)).toContain(token);
      } finally {
        await connection.close();
      }

      const report = JSON.parse(stdout.join(""));
      const leak = report.findings.filter((f: Finding) => f.ruleId === "secret/env-leak");
      expect(leak).toHaveLength(1);
      expect(JSON.stringify(leak)).not.toContain(token);
      expect(code).toBe(2);
    },
    E2E_TIMEOUT_MS,
  );

  it("COMMANDS 에 audit 가 있고 help audit 가 AUDIT_USAGE 를 낸다", async () => {
    expect(COMMANDS).toContain("audit");
    const help = await cli(["help", "audit"]);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain(AUDIT_USAGE);
    const flag = await cli(["audit", "--help"]);
    expect(flag.code).toBe(0);
    expect(flag.stdout).toBe(help.stdout);
    expect(GLOBAL_HELP).toContain("  audit     ");
  });
});
