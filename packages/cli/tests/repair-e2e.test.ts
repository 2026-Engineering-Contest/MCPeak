import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { run } from "../src/index.js";
import type { RepairBundle } from "../src/repair-bundle.js";
import { type RepairCommandDependencies, runRepairCommand } from "../src/repair-command.js";

/**
 * 워크스페이스 산출물 대신 소스를 본다. `cli-integration-e2e.test.ts` 와 같은 방식이라 빌드가
 * 낡아도 낡은 계약으로 판정하지 않는다.
 */
vi.mock("@mcpeak/core", async () => import("../../core/src/index.js"));
vi.mock("@mcpeak/runner", async () => import("../../runner/src/index.js"));

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const brokenServerSource = join(here, "fixtures/broken-weather-server.mjs");

/** 결함이 드러나는 케이스 하나짜리 명세. 프로토타입 속성을 도시 이름으로 준다. */
const SUITE = {
  schemaVersion: 1,
  id: "broken-weather",
  name: "결함 심은 weather 서버",
  defaultTimeoutMs: 10_000,
  cases: [
    {
      id: "get-weather-unknown-city",
      name: "없는 도시는 도구 오류를 반환한다",
      operation: { type: "callTool", tool: "get_weather", input: { city: "toString" } },
      assertions: [{ type: "isError", expected: true }],
    },
  ],
};

let workspace: string;
let suitePath: string;
let bundlePath: string;
let testExitCode: number;
/** 실패했을 때 무엇이 화면에 나왔는지 판정에 쓴다. */
const testWrites = { out: [] as string[], err: [] as string[] };

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "mcpeak-repair-e2e-"));
  suitePath = join(workspace, "suite.json");
  bundlePath = join(workspace, "bundle.json");
  await writeFile(suitePath, JSON.stringify(SUITE), "utf8");
  const stdout = vi.spyOn(process.stdout, "write").mockImplementation((text) => {
    testWrites.out.push(String(text));
    return true;
  });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation((text) => {
    testWrites.err.push(String(text));
    return true;
  });
  try {
    testExitCode = await run([
      "test",
      suitePath,
      "--command",
      process.execPath,
      "--arg",
      // fixture 경로에서 그대로 띄운다. 사본을 또 만들 이유가 없다.
      brokenServerSource,
      "--repair-bundle",
      bundlePath,
    ]);
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
  }
}, 60_000);

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

async function readBundle(): Promise<RepairBundle> {
  return JSON.parse(await readFile(bundlePath, "utf8")) as RepairBundle;
}

/** 가짜 provider. 실제 codex·claude 프로세스를 부르지 않는다. */
function fakeProvider(id: "codex" | "claude", model: string) {
  return {
    id,
    model,
    diagnose: async () => ({
      status: "diagnosis",
      causes: [
        {
          caseId: "get-weather-unknown-city",
          summary: "도시 존재 검사가 프로토타입 속성을 통과시킨다",
          location: "get_weather 핸들러의 도시 존재 검사",
          evidence: "city='toString' 입력에 isError:false 와 빈 본문",
          target: "server",
        },
      ],
      shortfall: "",
    }),
  };
}

/**
 * 진단 통로는 `generate` 의 실제 구현을 쓴다. provider 만 가짜다. 요청 조립·승인 검사·응답
 * 검증이 전부 실제 코드로 돌아야 이 E2E 가 의미가 있다.
 */
async function repairDependencies(): Promise<{
  value: RepairCommandDependencies;
  writes: { out: string[]; err: string[] };
}> {
  const generate = await import("../../generate/src/index.js");
  const writes = { out: [] as string[], err: [] as string[] };
  return {
    writes,
    value: {
      readFile: (path) => readFile(path, "utf8"),
      writeStdout: (text) => writes.out.push(text),
      writeStderr: (text) => writes.err.push(text),
      diagnosis: {
        prepare: generate.prepareDiagnosisRequest,
        dispatch: generate.dispatchDiagnosisRequest,
        providers: {
          codex: (model) => fakeProvider("codex", model) as never,
          claude: (model) => fakeProvider("claude", model) as never,
        },
      },
    },
  };
}

describe("repair E2E", () => {
  it("깨진 서버로 test --repair-bundle 을 돌리면 종료 코드 1 이고 번들이 만들어진다", async () => {
    // 실패는 케이스 실패여야 한다. 서버가 부팅에 실패해도 종료 코드는 1 이라 그것만으로는
    // 이 시나리오가 돌았는지 알 수 없다. 연결 실패가 아니라는 것을 함께 본다.
    expect(testWrites.err.join("")).not.toContain("MCP_CONNECTION_FAILED");
    expect(testExitCode).toBe(1);
    const bundle = await readBundle();
    expect(bundle.bundleVersion).toBe(1);
    expect(bundle.spec.suiteId).toBe("broken-weather");
  });

  it("번들에 실패 케이스와 서버 응답 본문이 실린다", async () => {
    const bundle = await readBundle();
    const failure = bundle.failures.find((item) => item.caseId === "get-weather-unknown-city");
    expect(failure).toBeDefined();
    expect(failure?.tool).toBe("get_weather");
    expect(failure?.input).toEqual({ city: "toString" });
    const diagnostic = failure?.diagnostics.find((item) => item.code === "IS_ERROR_MISMATCH");
    expect(diagnostic).toBeDefined();
    // ADR-0027 이 넣은 서버 응답 본문. 결함이 만든 빈 성공 응답이 여기 그대로 있다.
    expect(diagnostic?.notes?.join("\n")).toContain("toString");
  });

  it("repair --yes 가 종료 코드 0 으로 끝나고 원인 후보를 찍는다", async () => {
    const deps = await repairDependencies();
    const code = await runRepairCommand(
      [bundlePath, "--provider", "codex", "--model", "gpt-5-codex", "--yes"],
      deps.value,
    );
    expect(code).toBe(0);
    const screen = deps.writes.out.join("");
    expect(screen).toContain("── 서버 수정 방향 (codex / gpt-5-codex) ──");
    expect(screen).toContain("원인 후보  도시 존재 검사가 프로토타입 속성을 통과시킨다");
    expect(screen).toContain("※ AI 제안입니다. 파일을 고치지 않았고 명세도 그대로입니다.");
  });

  /**
   * 판정 근거를 셋으로 나눈다. "서버 파일을 지운 뒤에도 repair 가 돈다" 는 약한 판정이다.
   * repair 는 서버 경로를 애초에 모르므로, 파일이 있든 없든 같은 이유로 초록이 된다. 그래서
   * repair 에 서버를 띄울 **수단 자체가 없다**는 것을 본다.
   *
   * 1. 번들 어디에도 실행 명령·인자·서버 경로가 없다. 띄우려 해도 무엇을 띄울지 모른다.
   * 2. repair 의존성에 `connect` 가 없다. `test` 경로의 그 필드가 여기엔 아예 없다.
   * 3. 서버가 하나도 안 떠 있는 상태에서 repair 가 0 으로 끝나고 stderr 가 비어 있다.
   */
  it("repair 가 MCP 서버 프로세스를 띄우지 않는다", async () => {
    const bundle = await readBundle();
    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(brokenServerSource);
    expect(serialized).not.toContain(process.execPath);
    expect("command" in bundle).toBe(false);
    const deps = await repairDependencies();
    expect("connect" in deps.value).toBe(false);
    const code = await runRepairCommand(
      [bundlePath, "--provider", "codex", "--model", "gpt-5-codex", "--yes"],
      deps.value,
    );
    expect(code).toBe(0);
    expect(deps.writes.out.join("")).toContain("원인 후보");
    expect(deps.writes.err.join("")).toBe("");
  });
});
