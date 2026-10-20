import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PerfBaseline, PerfReport } from "@mcpeak/perf";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DELAY_MS, startOrigin } from "../../perf/tests/fixtures/loopback-origin.js";
import { run } from "../src/index.js";

vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));

/**
 * 설계 §10.3 의 CLI 경로 E2E 와 §1.3 의 C4·C5·C8(계획 §11.2). `run()` 을 소스에서 불러 실제 진입점과
 * 같은 배선을 탄다. 픽스처 서버의 외부 주소 변수는 `MCPEAK_` 접두라 `--env` 로 넘길 수 없으므로 서버
 * 명령 앞에 `env` 를 붙여 넘긴다. 지연 값도 숫자를 박지 않고 `DELAY_MS` 로 만든다(계획 E16).
 */

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const serialServer = join(root, "packages/perf/tests/fixtures/serial-server.mjs");
const serialSuite = join(root, "packages/perf/tests/fixtures/serial-server.suite.json");
const weatherServer = join(root, "examples/weather-server/server.mjs");
const weatherSuite = join(root, "examples/weather-server/server.suite.json");

/** 한 실행이 픽스처 케이스 전부를 5회씩 부른다. serial 하나가 DELAY_MS × 2 × 5 를 쓴다. */
const E2E_TIMEOUT_MS = 60_000;

let dir: string;
let origin: Awaited<ReturnType<typeof startOrigin>>;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcpeak-perf-cli-e2e-"));
  origin = await startOrigin();
});

afterAll(async () => {
  await origin?.close();
  await rm(dir, { recursive: true, force: true });
});

/** `run()` 을 돌리고 stdout·stderr 를 모은다. */
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

/** 픽스처 서버 명령. `unset` 을 주면 그 변수를 지운 채 띄운다(프리로드 끊기). */
function serialCommand(unset: readonly string[] = []): string[] {
  return [
    "env",
    ...unset.flatMap((name) => ["-u", name]),
    `MCPEAK_PERF_FIXTURE_ORIGIN=${origin.origin}`,
    `MCPEAK_PERF_FIXTURE_DELAY_MS=${DELAY_MS}`,
    process.execPath,
    serialServer,
  ];
}

const perfSerial = (options: readonly string[], unset: readonly string[] = []): string[] => [
  "perf",
  serialSuite,
  ...options,
  "--",
  ...serialCommand(unset),
];

const perfWeather = (options: readonly string[]): string[] => [
  "perf",
  weatherSuite,
  ...options,
  "--",
  process.execPath,
  weatherServer,
];

const UNOBSERVED = ["NODE_OPTIONS", "MCPEAK_PERF_TRACE_DIR"];

describe.sequential("perf CLI e2e", { timeout: E2E_TIMEOUT_MS }, () => {
  it("기준선 왕복", async () => {
    const baseline = join(dir, "perf.baseline.json");

    const written = await cli(perfSerial(["--baseline", baseline, "--update-baseline"]));
    expect(written.code, written.stderr).toBe(0);
    const base = JSON.parse(await readFile(baseline, "utf8")) as PerfBaseline;
    expect(base.cases.find((c) => c.id === "serial")?.requestsP50).toBe(2);

    const compared = await cli(perfSerial(["--baseline", baseline]));
    expect(compared.code, compared.stdout).toBe(0);
    expect(compared.stdout).toContain(`기준선 비교 (${baseline})\n→ 회귀 없음.`);

    const lowered: PerfBaseline = {
      ...base,
      cases: base.cases.map((c) => (c.id === "serial" ? { ...c, requestsP50: 0 } : c)),
    };
    await writeFile(baseline, `${JSON.stringify(lowered, null, 2)}\n`, "utf8");
    const regressed = await cli(perfSerial(["--baseline", baseline]));
    expect(regressed.code, regressed.stdout).toBe(2);
    expect(regressed.stdout).toContain("→ 'serial' 호출당 외부 요청 2건, 기준 0건\n");
  });

  it("--json 의 stdout 은 JSON 하나다", async () => {
    const result = await cli(perfSerial(["--tool", "serial", "--json"]));

    expect(result.code, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as PerfReport;
    expect(result.stdout).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(result.stderr).toBe(
      "측정: 케이스 1개 × 5회\n" +
        "측정 중 1/5 · serial (1/5회)\n" +
        "측정 중 2/5 · serial (2/5회)\n" +
        "측정 중 3/5 · serial (3/5회)\n" +
        "측정 중 4/5 · serial (4/5회)\n" +
        "측정 중 5/5 · serial (5/5회)\n" +
        "측정 완료: 호출 5회\n",
    );
    expect(report.settings.observation).toBe("preload");
    expect(report.cases.map((c) => c.id)).toEqual(["serial"]);
  });

  it("CLI 경로의 관측 없음", async () => {
    const text = await cli(perfSerial([], UNOBSERVED));
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("관측 안 함(Node 프리로드가 실리지 않음)");
    expect(text.stdout).not.toContain("외부 대기 p50");
    expect(text.stdout).toContain(
      "진단 없음: 외부 호출을 관측하지 못해 분해와 진단을 하지 않았습니다.",
    );

    const json = await cli(perfSerial(["--json"], UNOBSERVED));
    expect(json.code, json.stderr).toBe(0);
    const report = JSON.parse(json.stdout) as PerfReport;
    expect(report.settings.observation).toBe("none");
    expect(report.findings).toEqual([]);
    expect(report.cases.length).toBeGreaterThan(0);
    for (const c of report.cases) {
      expect(Object.keys(c), c.id).not.toContain("external");
      expect(Object.keys(c), c.id).not.toContain("inside");
      expect(Object.keys(c), c.id).not.toContain("requests");
    }
    // 응답 시간은 남는다. 관측이 없어도 잰 것은 버리지 않는다.
    expect(report.cases.find((c) => c.id === "serial")?.total?.p50).toBeGreaterThanOrEqual(
      DELAY_MS * 2,
    );
  });

  it("도그푸딩", async () => {
    const text = await cli(perfWeather([]));
    expect(text.code, text.stderr).toBe(0);
    expect(text.stdout).toContain("관측 Node 프리로드(fetch, node:http, http2, undici)");

    const json = await cli(perfWeather(["--json"]));
    expect(json.code, json.stderr).toBe(0);
    const report = JSON.parse(json.stdout) as PerfReport;
    expect(report.settings.observation).toBe("preload");
    expect(report.cases.length).toBeGreaterThan(0);
    for (const c of report.cases) {
      // n 이 0 이면 requests 가 없어 아래 단언이 아무것도 가르지 못한다.
      expect(c.n, c.id).toBeGreaterThan(0);
      expect(c.requests?.p50, c.id).toBe(0);
    }
  });
});
