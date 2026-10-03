import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as auditModule from "@mcpeak/audit";
import * as core from "@mcpeak/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { nodeDockerIo } from "../src/audit-sandbox-io.js";
import { run } from "../src/index.js";

/**
 * 격리 계획서 §1.3·§8.7 의 Docker E2E. `mcpeak audit --sandbox` 를 실제 진입점(`run`)으로 돌려
 * examples/ 의 서버를 실제 컨테이너 안에서 띄운다. 우리 도구로 우리를 검증한다.
 *
 * skip 과 승격은 세 갈래다.
 * - `MCPEAK_SKIP_DOCKER_E2E=1`: Docker 가 있어도 건너뛴다(CI 의 verify 잡. 매트릭스라 두 번 돌고,
 *   이미지 빌드와 외부 API 에 기대는 스펙을 그 잡에 넣지 않는다).
 * - `MCPEAK_REQUIRE_DOCKER_E2E=1`: Docker 가 없으면 건너뛰지 않고 실패한다(CI 의 e2e 잡).
 * - 둘 다 없으면 `docker version` 의 종료 코드로 정한다.
 * 마지막 스펙(PATH 에서 docker 를 뺀 실행)은 Docker 없이도 돌아 어느 갈래에서도 실행된다.
 *
 * **잔존은 테스트가 치우지 않는다.** 스펙마다 끝에서 컨테이너·네트워크·볼륨·임시 디렉터리를 세고,
 * 남아 있으면 실패한다. 테스트가 치우면 정리 결함이 가려진다.
 *
 * live-weather 스펙은 외부 API(open-meteo, usgs, frankfurter)에 닿는다. 응답 값은 날마다 달라 값에
 * 기대는 단언을 두지 않는다. 재생 실행끼리의 바이트 비교와 녹화·재생의 한 줄 차이로 단언한다.
 */

const here = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(here, "../../..");
const examples = join(root, "examples");
const sandboxTarget = join(examples, "sandbox-target-server/server.mjs");
const expectedPath = join(examples, "sandbox-target-server/server.sandbox.expected.json");
const auditTarget = join(examples, "audit-target-server/server.mjs");
const weather = join(examples, "weather-server/server.mjs");
const liveWeather = join(examples, "live-weather-server/server.mjs");

// mock 예제는 dist 를 import 한다. 빌드 없이 도는 잡을 위해 소스 진입점으로 같은 정의 파일을 띄운다
// (audit-e2e.test.ts 의 같은 자리 주석 참조). 컨테이너에도 같은 경로로 보인다(마운트 범위가 저장소 루트다).
const mockEntry = join(root, "packages/mock/tests/fixtures/stdio-entry.mjs");
const mockResolve = new URL("../../mock/tests/fixtures/register-ts-resolve.mjs", import.meta.url)
  .href;

const SERVERS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["weather-server", [weather]],
  ["zod-notes-server", [join(examples, "zod-notes-server/server.mjs")]],
  ["live-weather-server", [liveWeather]],
  [
    "mock-server",
    ["--import", mockResolve, mockEntry, join(examples, "mock-server/weather.mock.json")],
  ],
  ["audit-target-server", [auditTarget]],
];

/** §1.3 의 여섯 규칙. 취약 예제에서 각각 정확히 한 번 나와야 한다. */
const SIX_RULES = [
  "behavior/child-process",
  "behavior/file-canary-read",
  "behavior/internal-address",
  "network/canary-exfiltration",
  "network/undeclared-destination",
  "surface/environment-dependent",
];

/** 감사 한 번이 수 초에서 수십 초다. 이미지를 처음 만드는 실행은 몇 분이 걸린다. */
const E2E_TIMEOUT_MS = 600_000;
/** 격리 안의 도구 호출 하나를 기다리는 시간. MCP 요청 제한(60초)보다 짧아야 우리 문장이 먼저 나온다. */
const CALL_WAIT_MS = 30_000;

const SKIP = process.env.MCPEAK_SKIP_DOCKER_E2E === "1";
const REQUIRE = process.env.MCPEAK_REQUIRE_DOCKER_E2E === "1";
const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const DOCKER = !SKIP && docker("version").status === 0;
const dockerIt = DOCKER ? it : it.skip;

if (SKIP)
  console.warn("[audit-sandbox-e2e] MCPEAK_SKIP_DOCKER_E2E=1 이라 Docker E2E 를 건너뜁니다.");
else if (!DOCKER) console.warn("[audit-sandbox-e2e] Docker 가 없어 건너뜁니다");

interface Finding {
  readonly ruleId: string;
  readonly severity: string;
  readonly location: { readonly kind: string; readonly toolName?: string };
  readonly evidence: readonly string[];
}
interface Report {
  readonly exitCode: number;
  readonly probe: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly findings: readonly Finding[];
  readonly sandbox?: {
    readonly status: string;
    readonly network?: string;
    readonly reason?: { readonly code: string; readonly detail: string };
  };
}
interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** `run()` 을 돌리고 stdout·stderr 를 모은다. 실제 진입점과 같은 배선을 탄다. */
async function cli(argv: string[]): Promise<CliResult> {
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

const reportOf = (result: CliResult) => JSON.parse(result.stdout) as Report;

/**
 * 같은 실행을 여러 스펙이 본다. 감사 한 번이 길어 스펙마다 다시 돌리지 않고 첫 결과를 나눠 쓴다.
 * 스펙을 하나만 골라 돌려도 그 스펙이 필요한 실행은 여기서 돈다.
 */
const runs = new Map<string, Promise<CliResult>>();
function once(key: string, argv: () => string[]): Promise<CliResult> {
  let found = runs.get(key);
  if (found === undefined) {
    found = cli(argv());
    runs.set(key, found);
  }
  return found;
}

const sandboxJson = (...server: readonly string[]) => [
  "audit",
  "--sandbox",
  "--json",
  "--",
  process.execPath,
  ...server,
];

/** 취약 예제에 `--sandbox --compare-host` 를 준 실행. */
const targetRun = () =>
  once("target", () => [
    "audit",
    "--sandbox",
    "--compare-host",
    "--json",
    "--",
    process.execPath,
    sandboxTarget,
  ]);

let dir: string;
const sessionPath = () => join(dir, "live-weather.sandbox-session.json");

/** live-weather 의 녹화 실행. 다섯 서버 스펙의 live-weather 실행을 겸한다. */
const recordRun = () =>
  once("live-weather:record", () => [
    "audit",
    "--sandbox",
    "--sandbox-session",
    sessionPath(),
    "--json",
    "--",
    process.execPath,
    liveWeather,
  ]);

/** 녹화가 끝난 뒤에 도는 재생 실행. */
async function replayRun(key: string): Promise<CliResult> {
  await recordRun();
  return once(`live-weather:replay:${key}`, () => [
    "audit",
    "--sandbox",
    "--sandbox-replay",
    sessionPath(),
    "--json",
    "--",
    process.execPath,
    liveWeather,
  ]);
}

const observed = (findings: readonly Finding[]) =>
  findings.filter((f) => f.ruleId.startsWith("behavior/") || f.ruleId.startsWith("network/"));

/** 호스트에 남은 격리 자원. 전부 빈 배열이어야 한다. */
async function leftovers() {
  const ids = (...args: string[]) =>
    docker(...args, "--filter", "label=mcpeak.audit=1", "-q")
      .stdout.split("\n")
      .filter((line) => line !== "");
  return {
    containers: ids("ps", "-a"),
    networks: ids("network", "ls"),
    volumes: ids("volume", "ls"),
    tmp: (await readdir(tmpdir())).filter((name) => name.startsWith("mcpeak-audit-sandbox-")),
  };
}
const NOTHING_LEFT = { containers: [], networks: [], volumes: [], tmp: [] };

/**
 * 백엔드를 직접 띄워 격리 안의 서버에 붙는다. CLI 가 넘기는 것과 같은 꼴의 명세를 쓴다. 감사를 거치지
 * 않고 호출 응답 자체를 봐야 하는 스펙이 쓴다.
 */
async function insideSandbox<T>(
  server: string,
  body: (
    connection: Awaited<ReturnType<typeof core.connectStdio>>,
    names: string[],
    handle: auditModule.SandboxHandle,
  ) => Promise<T>,
): Promise<T> {
  const random = () => randomBytes(8).toString("hex");
  const backend = auditModule.createDockerBackend(
    nodeDockerIo({ progress: () => {} }),
    auditModule.parseTrace,
  );
  const canaries = auditModule.planCanaries([], random);
  const handle = await backend.start({
    target: {
      kind: "stdio",
      command: process.execPath,
      args: [server],
      forwardedEnvNames: [],
      headerNames: [],
    },
    env: canaries.env,
    mountRoot: root,
    cwd: root,
    home: auditModule.planHome(random),
  });
  try {
    const connection = await core.connectStdio({
      command: handle.launchTarget.command ?? "",
      args: handle.launchTarget.args ?? [],
      env: handle.launchEnv,
    });
    try {
      return await body(connection, [...canaries.names], handle);
    } finally {
      await connection.close();
    }
  } finally {
    await handle.destroy();
  }
}

/** 격리 안의 `list_env_names` 응답(이름 목록)과 그 실행에 넣은 카나리 env 이름. */
let envNames: Promise<{ inside: string[]; canaries: string[] }> | undefined;
function listEnvNames() {
  envNames ??= (async () => {
    vi.stubEnv("MCPEAK_E2E_HOST_ONLY", "host-only-value");
    try {
      return await insideSandbox(sandboxTarget, async (connection, canaries) => {
        const result = await connection.client.callTool("list_env_names", {});
        const text = (result.content as ReadonlyArray<{ type: string; text?: string }>)
          .map((block) => block.text ?? "")
          .join("");
        return { inside: text.split("\n"), canaries };
      });
    } finally {
      vi.unstubAllEnvs();
    }
  })();
  return envNames;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "mcpeak-audit-e2e-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("audit sandbox e2e", () => {
  // 스펙이 실패해도 잔존은 본다. 실패한 실행이야말로 자원을 남기기 쉽다.
  afterEach(async () => {
    if (DOCKER) expect(await leftovers()).toEqual(NOTHING_LEFT);
  });

  if (REQUIRE && !DOCKER)
    it("MCPEAK_REQUIRE_DOCKER_E2E=1 이면 Docker 가 없을 때 건너뛰지 않고 실패한다", () => {
      throw new Error(
        SKIP
          ? "MCPEAK_REQUIRE_DOCKER_E2E=1 과 MCPEAK_SKIP_DOCKER_E2E=1 이 함께 켜져 있습니다. 둘 중 하나만 주세요."
          : "MCPEAK_REQUIRE_DOCKER_E2E=1 인데 `docker version` 이 실패했습니다. Docker 가 설치돼 있고 데몬이 떠 있는지 확인하세요.",
      );
    });

  dockerIt(
    "examples/sandbox-target-server 에 --sandbox --compare-host 를 돌리면 findings·counts·exitCode 가 server.sandbox.expected.json 과 같다",
    async () => {
      const expected = JSON.parse(await readFile(expectedPath, "utf8"));
      const result = await targetRun();
      const report = reportOf(result);
      expect({
        exitCode: report.exitCode,
        counts: report.counts,
        findings: report.findings,
      }).toEqual(expected);
      expect(result.code).toBe(2);
      expect(report.sandbox?.status).toBe("ran");
      expect(report.probe).toBe("all");
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "그 결과에서 §1.3 의 여섯 규칙이 각각 정확히 한 번이다",
    async () => {
      const { findings, counts } = reportOf(await targetRun());
      const seen = findings
        .map((f) => f.ruleId)
        .filter((ruleId) => !ruleId.startsWith("schema/"))
        .sort();
      expect(seen).toEqual(SIX_RULES);
      // 단계 1 의 info 두 건(제약 없는 path·url 인자)이 함께 실린다.
      expect(findings.filter((f) => f.ruleId.startsWith("schema/")).map((f) => f.ruleId)).toEqual([
        "schema/over-broad",
        "schema/over-broad",
      ]);
      expect(counts).toEqual({ high: 4, medium: 1, low: 1, info: 2 });
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt.each(SERVERS)(
    "%s 에 --sandbox 를 돌리면 behavior·network 의 info 밖 발견이 0",
    async (name, args) => {
      const result =
        name === "live-weather-server"
          ? await recordRun()
          : await once(`server:${name}`, () => sandboxJson(...args));
      const report = reportOf(result);
      expect(report.sandbox?.status).toBe("ran");
      expect(report.probe).toBe("all");
      const defects = observed(report.findings)
        .filter((f) => f.severity !== "info")
        .map((f) => ({ ruleId: f.ruleId, severity: f.severity, tool: f.location.toolName }));
      // live-weather 의 add_note 는 실제로 홈의 `.live-weather-notes.json` 에 쓴다. 오탐이 아니라
      // 규칙이 맞게 본 것이라, 그 한 건이 정확히 한 번 나오는 것을 고정한다(§1.3).
      expect(defects).toEqual(
        name === "live-weather-server"
          ? [{ ruleId: "behavior/write-outside", severity: "medium", tool: "add_note" }]
          : [],
      );
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "audit-target-server 의 단계 1 발견이 --sandbox 없이 돌린 것과 같다",
    async () => {
      const inside = reportOf(
        await once("server:audit-target-server", () => sandboxJson(auditTarget)),
      );
      const outside = reportOf(
        await once("audit-target:plain", () => [
          "audit",
          "--json",
          "--",
          process.execPath,
          auditTarget,
        ]),
      );
      expect(outside.sandbox).toBeUndefined();
      expect(outside.findings.length).toBeGreaterThan(0);
      expect(inside.findings).toEqual(outside.findings);
      expect(inside.counts).toEqual(outside.counts);
      expect(inside.exitCode).toBe(2);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "live-weather 의 get_forecast 호출 결과에 isError 가 없고 그 접속이 network/declared-destination 뿐이다",
    async () => {
      // 응답 자체는 감사 리포트에 실리지 않는다. 백엔드를 직접 띄워 게이트웨이를 거친 호출 결과를 본다.
      const result = await insideSandbox(liveWeather, async (connection, _names, handle) => {
        // 서버의 fetch 에는 제한 시간이 없다. 상류가 멈추면 호출이 MCP 요청 제한(60초)까지 매달리고
        // "protocol 오류" 한 줄만 남는다. 그 전에 끊고, 게이트웨이가 무엇을 봤는지를 실패 문장에 싣는다.
        const call = connection.client.callTool("get_forecast", { city: "Seoul" });
        call.catch(() => {});
        const waited = await Promise.race([
          call.then((value) => ({ value })),
          new Promise<undefined>((done) => setTimeout(() => done(undefined), CALL_WAIT_MS)),
        ]);
        if (waited !== undefined) return waited.value;
        const seen = await handle.snapshot();
        throw new Error(
          [
            `→ get_forecast 가 ${CALL_WAIT_MS / 1000}초 안에 답하지 않았습니다. 게이트웨이가 본 것:`,
            `→ 이름 조회: ${seen.dnsNames.map((entry) => entry.name).join(", ") || "없음"}`,
            `→ 요청: ${
              seen.requests
                .map((entry) => `${entry.method} ${entry.host}${entry.path} (${entry.served})`)
                .join(" | ") || "없음"
            }`,
            `→ 인증서 거부: ${seen.tlsRejections.map((entry) => entry.host).join(", ") || "없음"}`,
            `→ 서버의 접속: ${
              seen.events
                .flatMap((event) =>
                  event.kind === "connect" && event.family !== "unix"
                    ? [`${event.address}:${event.port}`]
                    : [],
                )
                .join(", ") || "없음"
            }`,
            `→ 읽지 못한 관측: ${seen.gaps.map((gap) => `${gap.source}: ${gap.reason}`).join(" | ") || "없음"}`,
            "요청이 없으면 서버가 게이트웨이에 닿지 못한 것이고, 요청이 있으면 상류가 답하지 않은 것입니다.",
          ].join("\n"),
        );
      });
      expect(result.isError ?? false).toBe(false);
      expect(JSON.stringify(result.content)).not.toBe("[]");

      // 감사에서는 그 접속이 선언된 목적지의 기록(info)으로만 남는다.
      const network = reportOf(await recordRun()).findings.filter((f) =>
        f.ruleId.startsWith("network/"),
      );
      expect(network.length).toBeGreaterThan(0);
      expect(new Set(network.map((f) => `${f.ruleId}:${f.severity}`))).toEqual(
        new Set(["network/declared-destination:info"]),
      );
      const hosts = network.map((f) => f.evidence[0]);
      expect(hosts).toContain("api.open-meteo.com");
      expect(hosts).toContain("geocoding-api.open-meteo.com");
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "live-weather 를 --sandbox-session 으로 한 번, --sandbox-replay 로 한 번 돌린 --json 이 sandbox.network 만 다르다",
    async () => {
      const recorded = await recordRun();
      const replayed = await replayRun("first");
      expect(reportOf(recorded).sandbox?.network).toBe("record");
      expect(reportOf(replayed).sandbox?.network).toBe("replay");
      const recordedLines = recorded.stdout.split("\n");
      const replayedLines = replayed.stdout.split("\n");
      expect(replayedLines.length).toBe(recordedLines.length);
      const different = recordedLines.flatMap((line, index) =>
        line === replayedLines[index] ? [] : [[line.trim(), replayedLines[index]?.trim()]],
      );
      expect(different).toEqual([['"network": "record",', '"network": "replay",']]);
      expect(replayed.code).toBe(recorded.code);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "--sandbox-replay 를 두 번 돌린 --json 이 바이트 단위로 같다",
    async () => {
      const first = await replayRun("first");
      const second = await replayRun("second");
      expect(first.stdout.length).toBeGreaterThan(0);
      expect(second.stdout).toBe(first.stdout);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "sandbox-target-server 에 --sandbox 를 두 번 돌린 --json 이 바이트 단위로 같다",
    async () => {
      const first = await targetRun();
      const second = await cli([
        "audit",
        "--sandbox",
        "--compare-host",
        "--json",
        "--",
        process.execPath,
        sandboxTarget,
      ]);
      expect(first.stdout.length).toBeGreaterThan(0);
      expect(second.stdout).toBe(first.stdout);
      // 카나리 값과 실행별 이름(컨테이너·네트워크·임시 경로)은 출력에 실리지 않는다.
      expect(first.stdout).not.toContain("MCPEAK_CANARY_");
      expect(first.stdout).not.toMatch(/mcpeak-audit-[0-9a-f]{16}/);
      expect(first.stdout).not.toContain("mcpeak-audit-sandbox-");
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "끝난 뒤 라벨 mcpeak.audit=1 인 컨테이너·네트워크·볼륨이 0개이고 os.tmpdir() 의 mcpeak-audit-sandbox-* 가 0개다",
    async () => {
      const result = await cli(sandboxJson(weather));
      expect(reportOf(result).sandbox?.status).toBe("ran");
      expect(await leftovers()).toEqual(NOTHING_LEFT);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "호스트에만 설정한 MCPEAK_E2E_HOST_ONLY 와 호스트의 USER·SHELL 이 list_env_names 응답에 없다(백엔드를 직접 띄워 core.connectStdio 로 호출한다)",
    async () => {
      const { inside } = await listEnvNames();
      expect(inside.length).toBeGreaterThan(0);
      expect(inside).not.toContain("MCPEAK_E2E_HOST_ONLY");
      expect(inside).not.toContain("USER");
      expect(inside).not.toContain("SHELL");
      // docker CLI 가 데몬을 찾는 변수도 컨테이너에는 들어가지 않는다.
      for (const name of inside) expect(name.startsWith("DOCKER_")).toBe(false);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "그 응답의 이름이 카나리 env 이름, HOME, PATH, CA 변수 다섯, 이미지 기본 env 뿐이다",
    async () => {
      const { inside, canaries } = await listEnvNames();
      const allowed = [
        ...canaries,
        "HOME",
        "PATH",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "GIT_SSL_CAINFO",
        // 이미지(node:22-bookworm-slim)와 Docker 가 넣는 것. PWD 는 이미지의 진입 셸
        // (docker-entrypoint.sh)이 넣는다. 값은 컨테이너 안의 작업 디렉터리다.
        "HOSTNAME",
        "NODE_VERSION",
        "PWD",
        "YARN_VERSION",
      ].sort();
      expect(canaries.length).toBeGreaterThan(0);
      expect([...inside].sort()).toEqual(allowed);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "--json 이어도 stderr 에 진행 줄이 나오고 stdout 은 JSON 하나뿐이다",
    async () => {
      const { stdout, stderr } = await targetRun();
      expect(stdout).toBe(`${JSON.stringify(JSON.parse(stdout), null, 2)}\n`);
      // 이미지를 처음 만드는 실행에만 나오는 한 줄은 뺀다. 그 줄도 stderr 로 간다(§6.4).
      const lines = stderr
        .split("\n")
        .filter((line) => !line.startsWith("격리 이미지를 처음 만듭니다("));
      expect(lines).toEqual([
        "격리 컨테이너를 준비합니다.",
        "도구 6개를 받았습니다. 호출을 시작합니다.",
        "[1/6] 도구 'read_note' 을 호출합니다(3회).",
        "[2/6] 도구 'fetch_status' 을 호출합니다(4회).",
        "[3/6] 도구 'disk_usage' 을 호출합니다(1회).",
        "[4/6] 도구 'sync_settings' 을 호출합니다(1회).",
        "[5/6] 도구 'ping' 을 호출합니다(1회).",
        "[6/6] 도구 'list_env_names' 을 호출합니다(1회).",
        "관측을 모으고 격리 자원을 정리합니다.",
        "",
      ]);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "서버가 감사 도중 죽어도(sandbox-target-server --crash-after-list) 잔존이 0이다",
    async () => {
      const result = await cli(sandboxJson(sandboxTarget, "--crash-after-list"));
      // 서버가 죽은 실행도 리포트를 낸다. 격리는 켜졌고 목록까지는 받았다.
      const report = reportOf(result);
      expect(report.sandbox?.status).toBe("ran");
      expect(result.code).toBe(report.exitCode);
      expect(await leftovers()).toEqual(NOTHING_LEFT);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "감사가 예외로 끝나도(읽을 수 없는 --baseline) 잔존이 0이다",
    async () => {
      // 디렉터리를 기준 파일로 준다. 읽으면 EISDIR 이다. 격리를 띄운 뒤에 읽으므로 예외 경로의 정리를 본다.
      const result = await cli([
        "audit",
        "--sandbox",
        "--baseline",
        dir,
        "--json",
        "--",
        process.execPath,
        weather,
      ]);
      expect(result.code).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("격리 컨테이너를 준비합니다.\n");
      expect(result.stderr).toContain(`→ 기준 파일을 읽을 수 없습니다: ${dir}\n`);
      expect(await leftovers()).toEqual(NOTHING_LEFT);
    },
    E2E_TIMEOUT_MS,
  );

  dockerIt(
    "--json 출력에 /.dockerenv 분기로 달라진 설명이 surface/environment-dependent 의 근거로 실려 있다",
    async () => {
      const found = reportOf(await targetRun()).findings.filter(
        (f) => f.ruleId === "surface/environment-dependent",
      );
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({
        severity: "high",
        location: { kind: "surface" },
        message: "격리 안과 이 머신에서 도구 'ping' 의 description 가 다릅니다",
        evidence: ["ping", "description"],
      });
    },
    E2E_TIMEOUT_MS,
  );

  it(
    "PATH 에서 docker 를 뺀 실행은 종료 코드가 단계 1 결과와 같고 리포트 둘째 줄이 docker-missing 문장이다",
    async () => {
      const plain = await cli(["audit", "--json", "--", process.execPath, weather]);
      // 빈 디렉터리 하나만 PATH 로 둔다. 서버는 절대 경로(process.execPath)로 띄우므로 영향이 없다.
      vi.stubEnv("PATH", dir);
      let human: CliResult;
      let json: CliResult;
      try {
        human = await cli(["audit", "--sandbox", "--", process.execPath, weather]);
        json = await cli(sandboxJson(weather));
      } finally {
        vi.unstubAllEnvs();
      }
      expect(human.code).toBe(plain.code);
      expect(human.stdout.split("\n")[1]).toBe(
        "행위 관측 안 함: Docker 를 찾을 수 없습니다. 서버는 격리 없이 이 머신에서 실행됐습니다. (설치: https://docs.docker.com/get-docker/)",
      );
      // 격리를 띄우지 않았으므로 진행 문장도 없다.
      expect(human.stderr).toBe("");

      const report = reportOf(json);
      expect(json.code).toBe(plain.code);
      expect(report.sandbox).toEqual({
        status: "unavailable",
        reason: { code: "docker-missing", detail: "" },
      });
      // 격리가 켜지지 않았고 사용자가 --probe 를 주지 않았으므로 readonly 로 돌아간다.
      expect(report.probe).toBe("readonly");
      expect(report.exitCode).toBe(reportOf(plain).exitCode);
    },
    E2E_TIMEOUT_MS,
  );
});
