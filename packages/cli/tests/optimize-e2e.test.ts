import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connectStdio } from "@mcpeak/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";

vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));

/**
 * 계획서 §1.3 의 E2E 와 §8.6. 대상은 examples/weather-server 이고, 우리 도구로 우리를 검증한다.
 *
 * (1) `mcpeak optimize` 가 오버레이를 쓴다.
 * (2) 그 오버레이로 띄운 프록시에 core 로 붙으면 `listTools()` 가 오버레이의 도구와 같다.
 * (3) 기존 `server.suite.json` 을 프록시에 돌린 `mcpeak test` 의 판정·케이스 수가 원본과 같다.
 */

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const server = join(root, "examples/weather-server/server.mjs");
const suite = join(root, "examples/weather-server/server.suite.json");
/**
 * 프록시는 `@mcpeak/optimize` 의 배포 진입점을 소스로 띄운다. CI 의 verify 는 빌드 없이 돌아
 * dist 가 없다. 그 진입점과 두 플래그가 필요한 이유는 optimize 쪽 proxy-entry.mjs 머리말에 있다.
 */
const proxyEntry = join(root, "packages/optimize/tests/fixtures/proxy-entry.mjs");
const PROXY_NODE_FLAGS = ["--experimental-transform-types", "--no-warnings"];

const E2E_TIMEOUT_MS = 30_000;

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcpeak-optimize-e2e-"));
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

const optimizeArgs = (out: string, ...extra: string[]): string[] => [
  "optimize",
  "--out",
  out,
  ...extra,
  "--",
  process.execPath,
  server,
];

/** 프록시를 띄우는 명령. `mcpeak test` 의 `--` 뒤와 core 의 connectStdio 가 같은 것을 쓴다. */
const proxyCommand = (overlay: string): string[] => [
  process.execPath,
  ...PROXY_NODE_FLAGS,
  proxyEntry,
  overlay,
  "--",
  process.execPath,
  server,
];

/** `mcpeak test --json` 보고서에서 비교할 부분. 판정과 케이스 수, 케이스별 판정이다. */
function verdicts(report: string): unknown {
  const parsed = JSON.parse(report) as {
    status: string;
    summary: unknown;
    cases: { spec: { id: string }; status: string }[];
  };
  return {
    status: parsed.status,
    summary: parsed.summary,
    cases: parsed.cases.map((item) => ({ id: item.spec.id, status: item.status })),
  };
}

describe.sequential("optimize e2e", { timeout: E2E_TIMEOUT_MS }, () => {
  it("weather-server 에 대해 오버레이를 쓰고 리포트를 stdout 에 낸다", async () => {
    const out = join(dir, "report.optimize.json");

    const result = await cli(optimizeArgs(out));

    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const overlay = JSON.parse(await readFile(out, "utf8"));
    expect(overlay).toMatchObject({
      schemaVersion: 1,
      generator: { name: "@mcpeak/optimize" },
      source: { toolCount: 2, toolNames: ["add", "get_weather"], otherCapabilities: [] },
    });
    expect(
      result.stdout.startsWith("mcpeak optimize 결과\n서버 도구 2개, instructions 없음\n"),
    ).toBe(true);
    expect(
      result.stdout.endsWith(
        "이 오버레이는 tools/list 만 바꿉니다. tools/call 은 원본 이름과 인자로 서버에 전달됩니다.\n",
      ),
    ).toBe(true);
  });

  it("같은 명령을 2회 실행한 오버레이 파일과 stdout 이 바이트 단위로 같다", async () => {
    const first = join(dir, "first.optimize.json");
    const second = join(dir, "second.optimize.json");

    const a = await cli(optimizeArgs(first));
    const b = await cli(optimizeArgs(second));

    expect([a.code, b.code]).toEqual([0, 0]);
    expect(Buffer.compare(await readFile(first), await readFile(second))).toBe(0);
    // 리포트에는 파일 경로가 들어가지 않으므로 출력 파일 이름이 달라도 같아야 한다.
    expect(Buffer.compare(Buffer.from(a.stdout), Buffer.from(b.stdout))).toBe(0);
  });

  it("--json 이면 stdout 이 오버레이 JSON 하나다", async () => {
    const out = join(dir, "json.optimize.json");

    const result = await cli(optimizeArgs(out, "--json"));

    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(await readFile(out, "utf8"));
    expect(() => JSON.parse(result.stdout)).not.toThrow();
  });

  it("프록시의 listTools 가 mcpeak optimize 가 쓴 오버레이의 도구와 같다", async () => {
    const out = join(dir, "proxy.optimize.json");
    expect((await cli(optimizeArgs(out))).code).toBe(0);
    const overlay = JSON.parse(await readFile(out, "utf8")) as {
      tools: { name: string; description?: string; inputSchema: unknown }[];
    };
    const [command, ...args] = proxyCommand(out);

    const proxy = await connectStdio({ command: command as string, args });
    try {
      expect(await proxy.client.listTools()).toEqual(
        overlay.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          inputSchema: tool.inputSchema,
        })),
      );
    } finally {
      await proxy.close();
    }
  });

  it("프록시를 대상으로 server.suite.json 을 돌린 mcpeak test 의 판정·케이스 수가 원본과 같다", async () => {
    const out = join(dir, "suite.optimize.json");
    expect((await cli(optimizeArgs(out))).code).toBe(0);

    const direct = await cli(["test", suite, "--json", "--", process.execPath, server]);
    const viaProxy = await cli(["test", suite, "--json", "--", ...proxyCommand(out)]);

    expect(direct.code).toBe(0);
    expect(viaProxy.code).toBe(direct.code);
    expect(verdicts(viaProxy.stdout)).toEqual(verdicts(direct.stdout));
    // 원본이 실제로 케이스를 돌렸다는 전제. 0 건끼리 같으면 이 단언은 아무것도 가르지 못한다.
    expect((verdicts(direct.stdout) as { cases: unknown[] }).cases.length).toBeGreaterThan(0);
  });
});
