import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuditReport, SandboxReport } from "@mcpeak/audit";
import * as realAudit from "@mcpeak/audit";
import type { AuditCommandDependencies } from "@mcpeak/cli/commands";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyzeSecurityRequest } from "../src/api-types.js";
import { analyzeSecurity, prepareSecurityRun } from "../src/server/analyze-security.js";

function fakeCoreModule(): typeof import("@mcpeak/core") {
  return {
    connectStdio: vi.fn(),
    connectHttp: vi.fn(),
  } as unknown as typeof import("@mcpeak/core");
}

type Runner = (argv: readonly string[], deps: AuditCommandDependencies) => Promise<number>;

/** runner 가 받은 argv·deps 를 잡아 두고 `body` 를 돌린다. */
function capturingRunner(
  body: (deps: AuditCommandDependencies) => Promise<number> | number = () => 1,
) {
  const seen: { argv?: readonly string[]; deps?: AuditCommandDependencies } = {};
  const runner = vi.fn<Runner>(async (argv, deps) => {
    seen.argv = argv;
    seen.deps = deps;
    return body(deps);
  });
  return { runner, seen };
}

/** `loadAudit` 는 실제 `@mcpeak/audit` 다. 문장을 만드는 함수가 전부 순수 함수라 fake 가 필요 없다. */
function loadersFor(core = fakeCoreModule()) {
  return { core, loaders: { loadCore: async () => core, loadAudit: async () => realAudit } };
}

/** `io.writeStderr` 로 흘러간 글자를 호출 단위로 남긴다. */
function capturingIo() {
  const written: string[] = [];
  return { written, io: { writeStderr: (text: string) => void written.push(text) } };
}

/** 숨은 문자가 든 도구 이름. 이스케이프로 적는다(파일에 실제 숨은 문자를 두지 않는다). */
const HIDDEN_TOOL_NAME = "get" + "\u200B" + "time";

const SAMPLE: AuditReport = {
  schemaVersion: 1,
  generator: { name: "@mcpeak/audit", version: "0.0.0" },
  server: {
    name: "sample",
    version: "1.0.0",
    toolCount: 2,
    promptCount: 0,
    resourceCount: 0,
    hasInstructions: false,
    capabilityKeys: ["tools"],
  },
  probe: "readonly",
  probedTools: [],
  findings: [
    {
      ruleId: "desc/hidden-unicode",
      severity: "high",
      location: { kind: "tool", toolIndex: 1, toolName: HIDDEN_TOOL_NAME, path: "name" },
      message: "보이지 않는 문자가 있습니다",
      fix: "문자를 지우세요",
      evidence: ["U+200B"],
    },
    {
      ruleId: "protocol/plaintext",
      severity: "medium",
      location: { kind: "protocol", path: "" },
      message: "평문 연결입니다",
      fix: "https 를 쓰세요",
      evidence: [],
    },
    {
      ruleId: "flow/toxic-combination",
      severity: "info",
      location: { kind: "server", path: "" },
      message: "세 역할이 함께 있습니다",
      fix: "역할을 나누세요",
      evidence: [],
    },
  ],
  skipped: [
    { family: "surface", reason: "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다." },
  ],
  counts: { high: 1, medium: 1, low: 0, info: 0 },
  exitCode: 2,
};

function withSandbox(sandbox: SandboxReport): AuditReport {
  return { ...SAMPLE, sandbox };
}

/** `mcpeak audit --json` 이 stdout 에 내는 꼴. */
function reportText(report: AuditReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const ARGV = ["--json", "--command", "node", "--arg", "s.mjs"] as const;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-dashboard-security-"));
});

afterEach(async () => {
  delete process.env.ANALYZE_T;
  await rm(root, { recursive: true, force: true });
});

/** 리포트를 내고 `exitCode` 로 끝나는 점검 한 번의 body. */
async function bodyOf(report: AuditReport, exitCode = 2) {
  const { runner } = capturingRunner((deps) => {
    deps.writeStdout(reportText(report));
    return exitCode;
  });
  const result = await analyzeSecurity(
    ARGV,
    capturingIo().io,
    { root },
    {
      runner,
      loaders: loadersFor().loaders,
    },
  );
  if (!result.outcome.ok) throw new Error(`ok 여야 하는데 실패했습니다: ${result.outcome.error}`);
  return { exitCode: result.exitCode, body: result.outcome.body };
}

describe("prepareSecurityRun", () => {
  const prepare = (request: AnalyzeSecurityRequest) =>
    prepareSecurityRun(root, request, { loaders: { loadAudit: async () => realAudit } });

  it("옵션이 없으면 --json 뒤에 argv 를 그대로 붙인다", async () => {
    expect(await prepare({ argv: ["--command", "node", "--arg", "s.mjs"] })).toEqual({
      ok: true,
      argv: ["--json", "--command", "node", "--arg", "s.mjs"],
    });
  });

  it("probe·baseline·update·sandbox 순서로 조립한다", async () => {
    expect(
      await prepare({
        argv: ["--command", "node"],
        probe: "none",
        baselinePath: "b.json",
        updateBaseline: true,
        sandbox: { compareHost: true, allowHosts: ["a.example.com", "b.example.com"] },
      }),
    ).toEqual({
      ok: true,
      argv: [
        "--probe",
        "none",
        "--baseline",
        "b.json",
        "--update-baseline",
        "--sandbox",
        "--compare-host",
        "--allow-host",
        "a.example.com",
        "--allow-host",
        "b.example.com",
        "--json",
        "--command",
        "node",
      ],
    });
    expect(existsSync(join(root, "b.json"))).toBe(false);
  });

  it("값 자리의 -- 로 시작하는 토큰은 값이다", async () => {
    const result = await prepare({ argv: ["--command", "node", "--arg", "--json"] });
    expect(result.ok).toBe(true);
    expect(result.ok ? result.argv.slice(-4) : []).toEqual([
      "--command",
      "node",
      "--arg",
      "--json",
    ]);
  });

  it("대상 옵션이 아닌 토큰은 거절한다", async () => {
    for (const argv of [
      ["--baseline", "x.json"],
      ["--json"],
      ["--sandbox-mount", "/"],
      ["--command"],
    ]) {
      const result = await prepare({ argv });
      expect(result.ok).toBe(false);
      const error = result.ok ? "" : result.error;
      expect(error).toMatch(/^오류 \[ANALYZE_USAGE\]:/);
      expect(error).toContain("\n해결:");
      expect(error.split("\n")[0]?.endsWith(`: '${argv[0]}'`)).toBe(true);
    }
  });

  it("ANALYZE_USAGE 문장은 계약의 두 줄 그대로다", async () => {
    expect(await prepare({ argv: ["--json"] })).toEqual({
      ok: false,
      error:
        "오류 [ANALYZE_USAGE]: argv 에는 대상 옵션(--command, --arg, --env, --url, --header-env)과 그 값만 실을 수 있습니다: '--json'\n해결: 점검 옵션은 요청의 probe·baselinePath·updateBaseline·sandbox 필드로 보내세요.",
    });
  });

  it("루트 밖 기준 파일 경로는 거절한다", async () => {
    for (const baselinePath of ["../b.json", "/tmp/b.json"]) {
      expect(await prepare({ argv: [], baselinePath })).toEqual({
        ok: false,
        error: "허용되지 않는 경로입니다.",
      });
    }
  });

  it(".json 이 아닌 기준 파일 경로는 거절한다", async () => {
    expect(await prepare({ argv: [], baselinePath: "b.txt" })).toEqual({
      ok: false,
      error: "기준 파일은 .json 확장자 파일만 쓸 수 있습니다.",
    });
  });

  it("갱신 대상이 기준 파일이 아니면 거절하고 파일을 건드리지 않는다", async () => {
    await writeFile(join(root, "suite.json"), '{"a":1}', "utf8");
    const result = await prepare({ argv: [], baselinePath: "suite.json", updateBaseline: true });
    expect(result).toEqual({
      ok: false,
      error:
        "기준 파일이 아닌 파일은 덮어쓰지 않습니다: suite.json\n→ 기준 파일 갱신은 이전에 mcpeak audit 가 만든 기준 파일만 바꿉니다. 다른 경로를 쓰세요.",
    });
    expect(await readFile(join(root, "suite.json"), "utf8")).toBe('{"a":1}');
  });

  it("갱신 대상을 읽지 못하면 거절한다", async () => {
    // 디렉터리는 ENOENT 가 아닌 오류(EISDIR)로 읽기에 실패한다.
    await mkdir(join(root, "dir.json"));
    expect(await prepare({ argv: [], baselinePath: "dir.json", updateBaseline: true })).toEqual({
      ok: false,
      error: "기준 파일을 읽지 못했습니다: dir.json",
    });
  });

  it("갱신 대상이 유효한 기준 파일이면 통과한다", async () => {
    const baseline = {
      schemaVersion: 1,
      server: { name: "s", version: "1" },
      tools: [],
      surfaceHash: "0".repeat(64),
    };
    await writeFile(join(root, "base.json"), JSON.stringify(baseline), "utf8");
    expect(
      await prepare({
        argv: ["--command", "node"],
        baselinePath: "base.json",
        updateBaseline: true,
      }),
    ).toEqual({
      ok: true,
      argv: ["--baseline", "base.json", "--update-baseline", "--json", "--command", "node"],
    });
  });

  it("갱신 없이는 파일 내용을 보지 않는다", async () => {
    await writeFile(join(root, "suite.json"), '{"a":1}', "utf8");
    const result = await prepare({ argv: [], baselinePath: "suite.json" });
    expect(result).toEqual({ ok: true, argv: ["--baseline", "suite.json", "--json"] });
  });

  it("audit 모듈을 못 읽으면 ANALYZE_RUNTIME_UNAVAILABLE 문장이다", async () => {
    await writeFile(join(root, "suite.json"), '{"a":1}', "utf8");
    const result = await prepareSecurityRun(
      root,
      { argv: [], baselinePath: "suite.json", updateBaseline: true },
      { loaders: { loadAudit: () => Promise.reject(new Error("missing")) } },
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/^오류 \[ANALYZE_RUNTIME_UNAVAILABLE\]:/);
  });
});

describe("analyzeSecurity", () => {
  it("runner 에 argv 를 그대로 넘긴다", async () => {
    const { runner, seen } = capturingRunner();
    await analyzeSecurity(
      ARGV,
      capturingIo().io,
      { root },
      { runner, loaders: loadersFor().loaders },
    );
    expect(seen.argv).toEqual(["--json", "--command", "node", "--arg", "s.mjs"]);
  });

  it("의존성은 nodeAuditDependencies 의 것이고 sandbox.cwd 만 대시보드 루트다", async () => {
    const { runner, seen } = capturingRunner();
    const { core, loaders } = loadersFor();
    await analyzeSecurity(ARGV, capturingIo().io, { root }, { runner, loaders });
    expect(seen.deps?.audit).toBe(realAudit.audit);
    expect(seen.deps?.connectStdio).toBe(core.connectStdio);
    expect(seen.deps?.sandbox.cwd).toBe(root);
    expect(typeof seen.deps?.sandbox.createBackend).toBe("function");
    expect(typeof seen.deps?.random).toBe("function");
  });

  it("readFile·writeFile 은 상대경로를 루트 기준으로 푼다", async () => {
    let read: string | undefined;
    const { runner } = capturingRunner(async (deps) => {
      await deps.writeFile("b.json", "x");
      read = await deps.readFile("b.json");
      return 1;
    });
    await analyzeSecurity(
      ARGV,
      capturingIo().io,
      { root },
      { runner, loaders: loadersFor().loaders },
    );
    expect(read).toBe("x");
    expect(existsSync(join(root, "b.json"))).toBe(true);
  });

  it("candidateEnv 가 process.env 보다 먼저다", async () => {
    process.env.ANALYZE_T = "from-process";
    const { runner, seen } = capturingRunner();
    await analyzeSecurity(
      ARGV,
      capturingIo().io,
      { root },
      {
        runner,
        loaders: loadersFor().loaders,
        candidateEnv: { ANALYZE_T: "from-candidate" },
      },
    );
    expect(seen.deps?.readEnv("ANALYZE_T")).toBe("from-candidate");
    expect(seen.deps?.readEnv("ANALYZE_NONE")).toBeUndefined();
  });

  it("candidateEnv 가 없으면 process.env 를 읽는다", async () => {
    process.env.ANALYZE_T = "from-process";
    const { runner, seen } = capturingRunner();
    await analyzeSecurity(
      ARGV,
      capturingIo().io,
      { root },
      { runner, loaders: loadersFor().loaders },
    );
    expect(seen.deps?.readEnv("ANALYZE_T")).toBe("from-process");
  });

  it("stdout 을 reportText 로, 파싱한 값을 report 로, renderReport 결과를 rendered 로 싣는다", async () => {
    const { exitCode, body } = await bodyOf(SAMPLE);
    expect(exitCode).toBe(2);
    expect(body.reportText).toBe(reportText(SAMPLE));
    expect(body.report).toEqual(SAMPLE);
    expect(body.rendered).toBe(realAudit.renderReport(SAMPLE));
    expect(body.exitCode).toBe(2);
    expect(body.cleanupError).toBe("");
  });

  it("views 는 findings 와 같은 길이이고 audit 의 함수가 만든 글자다", async () => {
    const { body } = await bodyOf(SAMPLE);
    expect(body.views).toEqual([
      { where: "도구 'get<U+200B>time' 의 name", tool: "get<U+200B>time", toolIndex: 1 },
      { where: "프로토콜", tool: null, toolIndex: -1 },
      { where: "서버 전체", tool: null, toolIndex: -1 },
    ]);
  });

  it("sandbox 가 없으면 sandboxLine 은 null 이고 limits 는 단계 1 의 두 줄이다", async () => {
    const { body } = await bodyOf(SAMPLE);
    expect(body.sandboxLine).toBeNull();
    expect(body.limits).toHaveLength(2);
    expect(body.limits[1]).toBe("행위 관측(Docker 격리)은 mcpeak audit --sandbox 로 켭니다.");
  });

  it("docker-missing 이면 sandboxLine 이 그 문장이다", async () => {
    const { body } = await bodyOf(
      withSandbox({ status: "unavailable", reason: { code: "docker-missing", detail: "" } }),
    );
    expect(body.sandboxLine).toBe(
      "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)",
    );
  });

  it("격리가 돌았으면 sandboxLine 이 격리 실행 줄이고 limits 는 다섯 줄이다", async () => {
    const { body } = await bodyOf(
      withSandbox({
        status: "ran",
        backend: "docker",
        image: "mcpeak-audit:abc",
        network: "live",
        compareHost: false,
        callCount: 3,
        declaredHosts: ["api.example.com"],
        requests: [],
      }),
    );
    expect(
      body.sandboxLine?.startsWith("격리 실행: Docker 컨테이너 안에서 서버를 띄웠습니다"),
    ).toBe(true);
    expect(body.limits).toHaveLength(5);
  });

  it("stderr 는 전부 io 로 흘리고, 리포트 뒤의 것만 cleanupError 다", async () => {
    const { runner } = capturingRunner((deps) => {
      deps.writeStderr("격리 컨테이너를 준비합니다.\n");
      deps.writeStdout(reportText(SAMPLE));
      deps.writeStderr("오류 [SANDBOX_CLEANUP_FAILED]: x\n");
      return 1;
    });
    const { io, written } = capturingIo();
    const result = await analyzeSecurity(
      ARGV,
      io,
      { root },
      { runner, loaders: loadersFor().loaders },
    );
    expect(written).toEqual([
      "격리 컨테이너를 준비합니다.\n",
      "오류 [SANDBOX_CLEANUP_FAILED]: x\n",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.outcome.ok).toBe(true);
    if (!result.outcome.ok) return;
    expect(result.outcome.body.cleanupError).toBe("오류 [SANDBOX_CLEANUP_FAILED]: x");
    expect(result.outcome.body.exitCode).toBe(1);
  });

  it("리포트 없이 끝나면 ok:false 이고 error 는 stderr 누적에서 끝 개행만 뗀 것이다", async () => {
    const { runner } = capturingRunner((deps) => {
      deps.writeStderr("오류 [CLI_USAGE]: x\n해결: y\n");
      return 1;
    });
    const result = await analyzeSecurity(
      ARGV,
      capturingIo().io,
      { root },
      {
        runner,
        loaders: loadersFor().loaders,
      },
    );
    expect(result).toEqual({
      exitCode: 1,
      outcome: { ok: false, error: "오류 [CLI_USAGE]: x\n해결: y" },
    });
  });

  it("runner 를 바꾸지 않으면 실제 runAuditCommand 가 돌고, 대상이 없으면 CLI 의 문장이 error 다", async () => {
    // 대상 옵션이 없어 CLI 가 연결 전에 사용법 오류로 끝난다. 서버를 띄우지 않는다.
    const { io, written } = capturingIo();
    const result = await analyzeSecurity(
      ["--json"],
      io,
      { root },
      { loaders: loadersFor().loaders },
    );
    expect(result.exitCode).toBe(1);
    expect(result.outcome.ok).toBe(false);
    const error = result.outcome.ok ? "" : result.outcome.error;
    expect(error).toMatch(/^오류 \[/);
    expect(written.join("")).toBe(`${error}\n`);
  });

  it("모듈을 못 읽으면 ANALYZE_RUNTIME_UNAVAILABLE 문장이고 runner 를 부르지 않는다", async () => {
    const { runner } = capturingRunner();
    const { io, written } = capturingIo();
    const result = await analyzeSecurity(
      ARGV,
      io,
      { root },
      {
        runner,
        loaders: {
          loadCore: async () => fakeCoreModule(),
          loadAudit: () => Promise.reject(new Error("missing")),
        },
      },
    );
    const error =
      "오류 [ANALYZE_RUNTIME_UNAVAILABLE]: 점검에 필요한 @mcpeak/core·@mcpeak/audit 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.";
    expect(result).toEqual({ exitCode: 1, outcome: { ok: false, error } });
    expect(written).toEqual([`${error}\n`]);
    expect(runner).toHaveBeenCalledTimes(0);
  });

  it("runner 가 던지면 ANALYZE_FAILED 문장이고 던지지 않는다", async () => {
    const { runner } = capturingRunner(() => {
      throw new Error("boom\nstack");
    });
    const { io, written } = capturingIo();
    const result = await analyzeSecurity(
      ARGV,
      io,
      { root },
      { runner, loaders: loadersFor().loaders },
    );
    const error =
      "오류 [ANALYZE_FAILED]: 점검이 예기치 않게 끝났습니다: boom\n해결: 같은 서버에 mcpeak audit 를 터미널에서 직접 돌려 같은 오류가 나는지 확인하세요.";
    expect(result).toEqual({ exitCode: 1, outcome: { ok: false, error } });
    expect(written).toEqual([`${error}\n`]);
  });

  it("stdout 이 JSON 이 아니면 ANALYZE_FAILED 문장이다", async () => {
    const { runner } = capturingRunner((deps) => {
      deps.writeStdout("not json\n");
      return 0;
    });
    const result = await analyzeSecurity(
      ARGV,
      capturingIo().io,
      { root },
      {
        runner,
        loaders: loadersFor().loaders,
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.outcome.ok).toBe(false);
    const error = result.outcome.ok ? "" : result.outcome.error;
    expect(error).toMatch(/^오류 \[ANALYZE_FAILED\]: 점검 결과를 읽지 못했습니다: /);
    expect(error.split("\n")[1]).toBe(
      "해결: 같은 서버에 mcpeak audit --json 을 터미널에서 직접 돌려 출력이 JSON 인지 확인하세요.",
    );
  });
});
