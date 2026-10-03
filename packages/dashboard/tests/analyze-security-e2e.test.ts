import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as audit from "@mcpeak/audit";
import { nodeAuditDependencies, runAuditCommand } from "@mcpeak/cli/commands";
import * as core from "@mcpeak/core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AnalyzeSecurityRequest,
  AnalyzeSecurityResponse,
  ApiError,
  RunEvent,
  RunSummary,
  StartRunResponse,
} from "../src/api-types.js";
import { type DashboardServer, startDashboardServer } from "../src/index.js";

/**
 * 보안 탭의 서버 통로(`POST /api/analyze/security`, `GET /api/analyze/security/<runId>`, 진행 SSE)를
 * 실제 예제 서버에 붙여 HTTP 만으로 관통한다(계획서 §1.3, §7.5). 판정 기준은 `mcpeak audit --json` 의
 * 커맨드 함수(`runAuditCommand`)를 직접 돌린 결과다. 파일명이 `*-e2e.test.ts` 라 러너가 직렬 갈래로
 * 수집한다.
 *
 * Docker 갈래의 skip 과 승격은 `packages/cli/tests/audit-sandbox-e2e.test.ts` 와 같은 규칙, 같은 변수다.
 * - `MCPEAK_SKIP_DOCKER_E2E=1`: Docker 가 있어도 건너뛴다(CI 의 verify 잡).
 * - `MCPEAK_REQUIRE_DOCKER_E2E=1`: Docker 가 없으면 건너뛰지 않고 실패한다(CI 의 e2e 잡).
 * - 둘 다 없으면 `docker version` 의 종료 코드로 정한다.
 * PATH 에서 docker 를 뺀 스펙은 Docker 없이도 돌아 어느 갈래에서도 실행된다.
 *
 * **잔존은 테스트가 치우지 않는다.** 격리 점검 뒤에 컨테이너·네트워크·볼륨을 세고, 남아 있으면
 * 실패한다. 테스트가 치우면 정리 결함이 가려진다.
 */
const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const repoRoot = resolve(here, "../../..");
const examples = join(repoRoot, "examples");
const weatherServer = join(examples, "weather-server/server.mjs");
const auditTarget = join(examples, "audit-target-server/server.mjs");
const auditExpectedPath = join(examples, "audit-target-server/server.audit.expected.json");
const sandboxTarget = join(examples, "sandbox-target-server/server.mjs");
const sandboxExpectedPath = join(examples, "sandbox-target-server/server.sandbox.expected.json");

/** 실서버 기동·tools/list 왕복이 들어가 기본 5초로는 모자랄 수 있다. */
const REAL_SERVER_TIMEOUT_MS = 60_000;
/** `audit-sandbox-e2e.test.ts` 의 같은 이름과 같은 값. 이미지를 처음 만드는 실행은 몇 분이 걸린다. */
const E2E_TIMEOUT_MS = 600_000;

const DOCKER_MISSING_LINE =
  "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)";

const SKIP = process.env.MCPEAK_SKIP_DOCKER_E2E === "1";
const REQUIRE = process.env.MCPEAK_REQUIRE_DOCKER_E2E === "1";
const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const DOCKER = !SKIP && docker("version").status === 0;
const dockerIt = DOCKER ? it : it.skip;

if (SKIP)
  console.warn("[analyze-security-e2e] MCPEAK_SKIP_DOCKER_E2E=1 이라 Docker E2E 를 건너뜁니다.");
else if (!DOCKER) console.warn("[analyze-security-e2e] Docker 가 없어 건너뜁니다");

const weatherArgv = ["--command", process.execPath, "--arg", weatherServer];
const auditTargetArgv = ["--command", process.execPath, "--arg", auditTarget];

/** 격리 없는 스펙이 쓰는 임시 루트. 기준 파일은 여기에만 쓴다. */
let root: string;
/** PATH 스펙이 PATH 로 줄 빈 디렉터리. */
let emptyPathDir: string;
let plain: DashboardServer;
/** 저장소 루트를 root 로 띄운 서버. 격리 스펙이 쓴다. 이 서버로는 기준 파일을 쓰지 않는다. */
let inRepo: DashboardServer;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "mcpeak-analyze-security-e2e-"));
  emptyPathDir = await mkdtemp(join(tmpdir(), "mcpeak-analyze-security-e2e-path-"));
  plain = await startDashboardServer({ port: 0, root });
  inRepo = await startDashboardServer({ port: 0, root: repoRoot });
});

afterAll(async () => {
  await plain?.close();
  await inRepo?.close();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  if (emptyPathDir !== undefined) await rm(emptyPathDir, { recursive: true, force: true });
});

const base = (server: DashboardServer) => `http://127.0.0.1:${server.port}`;

function post(server: DashboardServer, body: AnalyzeSecurityRequest): Promise<Response> {
  return fetch(`${base(server)}/api/analyze/security`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** SSE 를 `done` 이벤트까지 읽는다. `routes.test.ts` 의 `collectSseEvents` 와 같되 개수가 아니라 `done` 으로 끝낸다. */
async function eventsUntilDone(url: string): Promise<RunEvent[]> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("SSE 응답에 body가 없습니다.");
  const decoder = new TextDecoder();
  let buffer = "";
  const events: RunEvent[] = [];
  while (!events.some((event) => event.kind === "done")) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      const data = block.split("\n").find((line) => line.startsWith("data: "));
      if (data !== undefined) events.push(JSON.parse(data.slice("data: ".length)) as RunEvent);
      separatorIndex = buffer.indexOf("\n\n");
    }
  }
  controller.abort();
  return events;
}

interface CheckResult {
  readonly status: number;
  readonly text: string;
  readonly events: readonly RunEvent[];
}

/** 점검 하나를 HTTP 만으로 끝까지 돌린다: 시작, 진행 SSE 를 `done` 까지, 결과 조회. */
async function check(server: DashboardServer, body: AnalyzeSecurityRequest): Promise<CheckResult> {
  const started = await post(server, body);
  const startedText = await started.text();
  expect(started.status, startedText).toBe(200);
  const { runId } = JSON.parse(startedText) as StartRunResponse;
  const events = await eventsUntilDone(`${base(server)}/api/runs/${runId}/events`);
  const result = await fetch(`${base(server)}/api/analyze/security/${runId}`);
  return { status: result.status, text: await result.text(), events };
}

function okBody(result: CheckResult): AnalyzeSecurityResponse {
  expect(result.status, result.text).toBe(200);
  return JSON.parse(result.text) as AnalyzeSecurityResponse;
}

/** `mcpeak audit --json` 의 커맨드 함수를 대시보드를 거치지 않고 직접 돌린다. */
async function direct(argv: readonly string[]) {
  let stdout = "";
  let stderr = "";
  const code = await runAuditCommand(["--json", ...argv], {
    ...nodeAuditDependencies(core, audit),
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
    },
  });
  return { code, stdout, stderr };
}

const ruleIds = (body: AnalyzeSecurityResponse) =>
  body.report.findings.map((finding) => finding.ruleId);

const labelled = (...args: string[]) =>
  docker(...args, "--filter", "label=mcpeak.audit=1", "-q").stdout;

describe.sequential("analyze security e2e", () => {
  if (REQUIRE && !DOCKER)
    it("MCPEAK_REQUIRE_DOCKER_E2E=1 이면 Docker 가 없을 때 건너뛰지 않고 실패한다", () => {
      throw new Error(
        SKIP
          ? "MCPEAK_REQUIRE_DOCKER_E2E=1 과 MCPEAK_SKIP_DOCKER_E2E=1 이 함께 켜져 있습니다. 둘 중 하나만 주세요."
          : "MCPEAK_REQUIRE_DOCKER_E2E=1 인데 `docker version` 이 실패했습니다. Docker 가 설치돼 있고 데몬이 떠 있는지 확인하세요.",
      );
    });

  it(
    "weather-server: reportText 가 runAuditCommand 를 직접 돌린 stdout 과 바이트 단위로 같고 발견이 0 이다",
    async () => {
      const body = okBody(await check(plain, { argv: weatherArgv }));
      const expected = await direct(weatherArgv);
      expect(body.reportText).toBe(expected.stdout);
      expect(expected.code).toBe(0);
      expect(body.exitCode).toBe(0);
      expect(body.report.findings.filter((finding) => !finding.ruleId.startsWith("flow/"))).toEqual(
        [],
      );
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "audit-target-server: reportText 가 직접 돌린 stdout 과 같고 기대 파일과 같다",
    async () => {
      const body = okBody(await check(plain, { argv: auditTargetArgv }));
      const expected = await direct(auditTargetArgv);
      expect(body.reportText).toBe(expected.stdout);
      expect(body.exitCode).toBe(2);
      expect({
        exitCode: body.report.exitCode,
        counts: body.report.counts,
        findings: body.report.findings,
      }).toEqual(JSON.parse(await readFile(auditExpectedPath, "utf8")));
      expect(body.views.length).toBe(body.report.findings.length);
      // 숨은 문자는 CLI 리포트와 같은 표기(`<U+200B>`)로 드러난다. 이 기대 문자열은 ASCII 뿐이다.
      expect(body.views[1]).toEqual({
        where: "도구 'get<U+200B>time' 의 name",
        tool: "get<U+200B>time",
        toolIndex: 1,
      });
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "같은 요청 두 번의 결과 본문이 바이트 단위로 같다",
    async () => {
      const first = await check(plain, { argv: auditTargetArgv });
      const second = await check(plain, { argv: auditTargetArgv });
      expect(first.status, first.text).toBe(200);
      expect(second.status, second.text).toBe(200);
      expect(second.text).toBe(first.text);
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "rendered 는 renderReport(report) 와 같다",
    async () => {
      const body = okBody(await check(plain, { argv: auditTargetArgv }));
      expect(body.rendered).toBe(audit.renderReport(body.report));
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "기준 파일을 루트 아래에 새로 쓰고, 둘째 실행은 비교만 한다",
    async () => {
      const request = { argv: weatherArgv, baselinePath: "weather.baseline.json" };
      const written = join(root, "weather.baseline.json");

      const first = okBody(await check(plain, request));
      const created = first.report.findings.filter(
        (finding) => finding.ruleId === "surface/baseline-created",
      );
      expect(created.map((finding) => finding.message)).toEqual([
        "기준 파일을 만들었습니다: weather.baseline.json",
      ]);
      expect(existsSync(written)).toBe(true);
      const afterFirst = await readFile(written);

      const second = okBody(await check(plain, request));
      expect(ruleIds(second)).not.toContain("surface/baseline-created");
      expect(ruleIds(second)).not.toContain("surface/changed");
      expect((await readFile(written)).equals(afterFirst)).toBe(true);
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "루트 밖 기준 파일 경로는 400 이고 아무것도 쓰지 않는다",
    async () => {
      const response = await post(plain, {
        argv: weatherArgv,
        baselinePath: "../escape.baseline.json",
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as ApiError).error).toBe("허용되지 않는 경로입니다.");
      expect(existsSync(join(dirname(root), "escape.baseline.json"))).toBe(false);
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "기준 파일이 아닌 파일은 갱신으로 덮어쓰지 않는다",
    async () => {
      const suite = join(root, "suite.json");
      await writeFile(suite, '{"a":1}\n', "utf8");
      const response = await post(plain, {
        argv: weatherArgv,
        baselinePath: "suite.json",
        updateBaseline: true,
      });
      expect(response.status).toBe(400);
      const { error } = (await response.json()) as ApiError;
      expect(error.split("\n")[0]).toBe("기준 파일이 아닌 파일은 덮어쓰지 않습니다: suite.json");
      expect(await readFile(suite, "utf8")).toBe('{"a":1}\n');
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "없는 명령이면 결과가 400 이고 CLI 의 연결 실패 문장이 그대로 온다",
    async () => {
      const argv = ["--command", "mcpeak-no-such-binary-xyz"];
      const result = await check(plain, { argv });
      expect(result.status, result.text).toBe(400);
      const { error } = JSON.parse(result.text) as ApiError;
      const expected = await direct(argv);
      expect(expected.stdout).toBe("");
      expect(error).toBe(expected.stderr.replace(/\n+$/, ""));
      // `audit` 의 연결 실패 문장은 `오류 [코드]` 꼴이 아니라 화살표 줄로 시작한다(optimize 와 다르다).
      expect(error.split("\n")[0]).toBe("→ 서버에 붙지 못했습니다: mcpeak-no-such-binary-xyz");
      expect(error).toContain("해결:");
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "점검 run 은 Runs 목록에 없다",
    async () => {
      // 이 스펙만 골라 돌려도 점검 run 이 하나는 있도록 여기서 한 번 돌린다.
      okBody(await check(plain, { argv: weatherArgv }));
      const response = await fetch(`${base(plain)}/api/runs`);
      expect(response.status).toBe(200);
      const runs = (await response.json()) as RunSummary[];
      expect(runs.filter((run) => run.flow === "audit")).toEqual([]);
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  it(
    "PATH 에서 docker 를 뺀 격리 점검은 '행위 관측 안 함' 을 말하고 단계 1 결과로 끝난다",
    async () => {
      const withoutSandbox = okBody(await check(inRepo, { argv: weatherArgv }));
      // 빈 디렉터리 하나만 PATH 로 둔다. 서버는 절대 경로(process.execPath)로 띄우므로 영향이 없다.
      // 점검은 이 프로세스 안에서 돌므로 POST 부터 done 까지 PATH 를 바꿔 둔다.
      vi.stubEnv("PATH", emptyPathDir);
      let result: CheckResult;
      try {
        result = await check(inRepo, {
          argv: weatherArgv,
          sandbox: { compareHost: false, allowHosts: [] },
        });
      } finally {
        vi.unstubAllEnvs();
      }
      const body = okBody(result);
      expect(body.sandboxLine).toBe(DOCKER_MISSING_LINE);
      expect(body.report.sandbox).toEqual({
        status: "unavailable",
        reason: { code: "docker-missing", detail: "" },
      });
      // 격리가 켜지지 않았고 probe 를 주지 않았으므로 readonly 로 돌아간다.
      expect(body.report.probe).toBe("readonly");
      expect(body.exitCode).toBe(withoutSandbox.exitCode);
    },
    REAL_SERVER_TIMEOUT_MS,
  );

  dockerIt(
    "sandbox-target-server 를 격리로 점검한 결과가 기대 파일과 같고 진행 문장이 SSE 로 흐른다",
    async () => {
      const result = await check(inRepo, {
        argv: ["--command", process.execPath, "--arg", sandboxTarget],
        sandbox: { compareHost: true, allowHosts: [] },
      });
      const body = okBody(result);
      expect({
        exitCode: body.report.exitCode,
        counts: body.report.counts,
        findings: body.report.findings,
      }).toEqual(JSON.parse(await readFile(sandboxExpectedPath, "utf8")));
      expect(body.report.sandbox?.status).toBe("ran");
      expect(
        body.sandboxLine?.startsWith("격리 실행: Docker 컨테이너 안에서 서버를 띄웠습니다"),
        String(body.sandboxLine),
      ).toBe(true);
      const progress = result.events
        .flatMap((event) => (event.kind === "stderr" ? [event.html] : []))
        .join("");
      expect(progress).toContain("격리 컨테이너를 준비합니다.");
      expect(body.cleanupError).toBe("");
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "격리 점검 뒤 컨테이너·네트워크·볼륨이 남지 않는다",
    () => {
      expect({
        containers: labelled("ps", "-a"),
        networks: labelled("network", "ls"),
        volumes: labelled("volume", "ls"),
      }).toEqual({ containers: "", networks: "", volumes: "" });
    },
    E2E_TIMEOUT_MS,
  );
});
