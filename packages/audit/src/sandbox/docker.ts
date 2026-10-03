import {
  AuditError,
  type Observation,
  type SandboxNetworkMode,
  type SandboxPhase,
  type SandboxUnavailable,
  type SandboxUnavailableCode,
  type SyscallEvent,
} from "../types.js";
import type { SandboxBackend, SandboxHandle, SandboxSpec } from "./backend.js";
import { sandboxImageTag } from "./image.js";
import type { TraceParser } from "./trace.js";

/**
 * Docker 구현의 바깥 접점. `audit` 패키지는 `node:child_process` 를 직접 쓰지 않고 CLI 가 넣어 준다.
 * 유닛테스트는 이 접점을 가짜로 바꿔 argv 를 단언한다.
 */
export interface DockerIo {
  /**
   * docker CLI 를 한 번 실행한다. 호스트 env 를 상속하고 extraEnv 를 덮는다. 없는 실행 파일이면
   * `code: "ENOENT"` 인 오류로 거절한다. 종료 코드가 0 이 아니어도 거절하지 않는다.
   */
  run(
    args: readonly string[],
    options?: {
      readonly extraEnv?: Readonly<Record<string, string>>;
      readonly timeoutMs?: number;
    },
  ): Promise<{ readonly code: number; readonly stdout: string; readonly stderr: string }>;
  /** docker CLI 가 데몬을 찾는 데 쓰는 호스트 변수 중 설정된 것. launchEnv 재료다. */
  dockerClientEnv(): Readonly<Record<string, string>>;
  /** os.tmpdir() 아래 `mcpeak-audit-sandbox-` 접두 디렉터리를 0755 로 만들고 절대 경로를 돌려준다. */
  makeTempDir(): Promise<string>;
  writeFile(path: string, content: string, mode: number): Promise<void>;
  readFile(path: string): Promise<string>;
  removeDir(path: string): Promise<void>;
  /** packages/audit/sandbox 아래의 Dockerfile 과 gateway 파일 전부. 경로는 sandbox 기준 상대 경로. */
  readSandboxSources(): Promise<ReadonlyArray<{ readonly path: string; readonly content: string }>>;
  /** sandbox 디렉터리의 호스트 절대 경로. `docker build` 의 컨텍스트다. */
  readonly sandboxDir: string;
  readonly fetch: typeof globalThis.fetch;
  /** 16자 소문자 hex. runId 와 베어러 토큰 재료다. */
  random(): string;
  /** 진행 문장을 stderr 로 낸다. */
  progress(line: string): void;
}

const LABEL = "mcpeak.audit=1";
const IMAGE_REPOSITORY = "mcpeak-audit-sandbox";
/** 이미지의 `node` 사용자. target 과 trace 를 읽는 일회용 컨테이너가 이 사용자로 돈다. */
const SANDBOX_USER = "1000:1000";
const CONTROL_PORT = 7000;
const CA_PATH = "/etc/mcpeak/ca.pem";
const TRACE_DIR = "/var/mcpeak";
/**
 * 값이 비밀이 아닌 고정 env. `-e NAME` 으로 넘기려면 값을 docker CLI 프로세스의 env 에 실어야 하는데,
 * HOME 은 CLI 자신의 것과 겹치고 SSL_CERT_FILE 은 Go 로 된 CLI 의 신뢰 저장소를 바꾼다. 그래서 env
 * 파일로 넘긴다. argv 에는 파일 경로만 실린다.
 */
const TARGET_FIXED_ENV: ReadonlyArray<readonly [string, string]> = [
  ["HOME", "/home/node"],
  ["NODE_EXTRA_CA_CERTS", CA_PATH],
  ["SSL_CERT_FILE", CA_PATH],
  ["REQUESTS_CA_BUNDLE", CA_PATH],
  ["CURL_CA_BUNDLE", CA_PATH],
  ["GIT_SSL_CAINFO", CA_PATH],
];
const STRACE = [
  "strace",
  "-f",
  "-qq",
  "-s",
  "256",
  "-e",
  "trace=openat,execve,connect,?unlink,unlinkat,?rmdir,?rename,?renameat,renameat2",
  "-o",
  `${TRACE_DIR}/trace`,
];

/** 게이트웨이 준비 대기. 100ms 간격으로 100번이면 10초이고 `core` 의 접속 제한과 같다. */
const HEALTH_ATTEMPTS = 100;
const HEALTH_INTERVAL_MS = 100;
const DOCKER_TIMEOUT_MS = 30_000;
const BUILD_TIMEOUT_MS = 600_000;
const CONTROL_TIMEOUT_MS = 5_000;
/** 관측과 녹화는 본문이 실려 클 수 있다. */
const CONTROL_BULK_TIMEOUT_MS = 30_000;

const CLEANUP_HINT =
  "해결: docker rm -f $(docker ps -aq --filter label=mcpeak.audit=1) , docker network prune -f --filter label=mcpeak.audit=1, docker volume rm $(docker volume ls -q --filter label=mcpeak.audit=1) 로 직접 치우세요.";

type ResourceKind = "container" | "network" | "volume" | "tmp";

/** 치울 자원 하나. `present` 는 만들었고 아직 치우지 못했다는 뜻이다. */
interface Resource {
  readonly kind: ResourceKind;
  readonly id: string;
  present: boolean;
}

const RESOURCE_NOUN: Readonly<Record<ResourceKind, string>> = {
  container: "컨테이너",
  network: "네트워크",
  volume: "볼륨",
  tmp: "임시 디렉터리",
};
/** 이미 없는 자원을 지우려 할 때 docker 가 내는 문장. 없으면 치운 것이다. */
const ALREADY_GONE: Readonly<Record<Exclude<ResourceKind, "tmp">, RegExp>> = {
  container: /no such container/i,
  network: /not found|no such network/i,
  volume: /no such volume/i,
};

type DockerOutcome =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly reason: string };

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? ""
  );
}

function messageOf(error: unknown): string {
  return firstLine(error instanceof Error ? error.message : String(error));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `start` 가 던지는 오류. audit() 은 `unavailable` 을 리포트에 싣고 단계 1 경로로 돈다. */
function unavailableError(code: SandboxUnavailableCode, detail: string): Error {
  const unavailable: SandboxUnavailable = { code, detail };
  const what =
    code === "image-build-failed"
      ? "격리 이미지를 만들지 못했습니다"
      : "격리 컨테이너를 띄우지 못했습니다";
  return Object.assign(new Error(`${what}: ${detail}`), { unavailable });
}

function unavailableIn(error: unknown): SandboxUnavailable | undefined {
  if (!isRecord(error) && !(error instanceof Error)) return undefined;
  const found = (error as { unavailable?: unknown }).unavailable;
  return isRecord(found) ? (found as unknown as SandboxUnavailable) : undefined;
}

function sessionUnreadable(path: string, cause: string): AuditError {
  return new AuditError(
    "SANDBOX_SESSION_UNREADABLE",
    `→ 세션 파일을 읽을 수 없습니다: ${path}\n→ ${cause}\n해결: mcpeak audit --sandbox --sandbox-session ${path} 로 먼저 녹화하세요.`,
  );
}

/** 남은 자원을 종류별로 센다. 0 인 종류는 적지 않는다. */
function describeLeft(left: readonly Resource[]): string {
  return (["container", "network", "volume", "tmp"] as const)
    .map((kind) => ({ kind, count: left.filter((resource) => resource.kind === kind).length }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => `${RESOURCE_NOUN[kind]} ${count}개`)
    .join(", ");
}

/**
 * `parse` 를 주입으로 받는다. 이 백엔드의 테스트는 가짜 해석기를 쓰고, 실제 `parseTrace` 는 CLI
 * 배선이 넣는다.
 */
export function createDockerBackend(io: DockerIo, parse: TraceParser): SandboxBackend {
  /** docker 를 한 번 부른다. 던지지 않는다. 실패의 첫 줄을 이유로 돌려준다. */
  async function docker(
    args: readonly string[],
    options: { readonly extraEnv?: Readonly<Record<string, string>>; readonly timeoutMs?: number },
  ): Promise<DockerOutcome> {
    try {
      const result = await io.run(args, { timeoutMs: DOCKER_TIMEOUT_MS, ...options });
      if (result.code === 0) return { ok: true, stdout: result.stdout };
      return {
        ok: false,
        reason:
          firstLine(result.stderr) || `docker ${args[0]} 이 종료 코드 ${result.code} 로 끝났습니다`,
      };
    } catch (error) {
      return { ok: false, reason: messageOf(error) };
    }
  }

  /** 아직 남은 자원을 순서대로 치운다. 하나가 실패해도 끝까지 간다. */
  async function cleanup(
    resources: readonly Resource[],
  ): Promise<{ readonly left: readonly Resource[]; readonly firstError: string }> {
    let firstError = "";
    for (const resource of resources) {
      if (!resource.present) continue;
      let failure: string | undefined;
      if (resource.kind === "tmp") {
        try {
          await io.removeDir(resource.id);
        } catch (error) {
          failure = messageOf(error);
        }
      } else {
        const verb = resource.kind === "container" ? ["rm", "-f"] : [resource.kind, "rm"];
        const outcome = await docker([...verb, resource.id], {});
        if (!outcome.ok && !ALREADY_GONE[resource.kind].test(outcome.reason)) {
          failure = outcome.reason;
        }
      }
      if (failure === undefined) resource.present = false;
      else if (firstError === "") firstError = failure;
    }
    return { left: resources.filter((resource) => resource.present), firstError };
  }

  async function ensureImage(): Promise<string> {
    const image = `${IMAGE_REPOSITORY}:${sandboxImageTag(await io.readSandboxSources())}`;
    if ((await docker(["image", "inspect", image], {})).ok) return image;
    io.progress(
      `격리 이미지를 처음 만듭니다(${image}). 몇 분 걸릴 수 있습니다. 이때의 다운로드는 점검 대상 서버의 접속이 아닙니다.`,
    );
    const built = await docker(["build", "-t", image, io.sandboxDir], {
      timeoutMs: BUILD_TIMEOUT_MS,
    });
    if (!built.ok) throw unavailableError("image-build-failed", built.reason);
    return image;
  }

  async function start(spec: SandboxSpec): Promise<SandboxHandle> {
    const mode: SandboxNetworkMode = spec.session?.mode ?? "live";
    const sessionPath = spec.session?.path ?? "";

    // 재생 파일은 자원을 만들기 전에 읽는다. 못 읽는 실행이 컨테이너를 남기지 않게 한다.
    let replaySession: string | undefined;
    if (mode === "replay") {
      try {
        replaySession = await io.readFile(sessionPath);
      } catch (error) {
        throw sessionUnreadable(sessionPath, messageOf(error));
      }
      if (parseJson(replaySession) === undefined) {
        throw sessionUnreadable(sessionPath, "JSON 으로 읽을 수 없습니다.");
      }
    }

    const image = await ensureImage();

    const runId = io.random();
    // 32바이트 hex. argv 에 싣지 않고 게이트웨이 컨테이너의 env 로만 준다.
    const token = [io.random(), io.random(), io.random(), io.random()].join("");
    const prefix = `mcpeak-audit-${runId}`;
    const names = {
      target: `${prefix}-target`,
      gateway: `${prefix}-gateway`,
      network: `${prefix}-net`,
      volume: `${prefix}-trace`,
    };
    // 치우는 순서다. 컨테이너가 남아 있으면 네트워크와 볼륨이 지워지지 않는다.
    const target: Resource = { kind: "container", id: names.target, present: false };
    const gateway: Resource = { kind: "container", id: names.gateway, present: false };
    const network: Resource = { kind: "network", id: names.network, present: false };
    const volume: Resource = { kind: "volume", id: names.volume, present: false };
    const tmp: Resource = { kind: "tmp", id: "", present: false };
    const resources = [target, gateway, network, volume, tmp];

    /** 실행마다 달라지는 값. 알게 되는 대로 채우고, 밖으로 나가는 문장에서 자리표로 바꾼다. */
    const perRun = { tmpDir: "", gatewayIp: "", controlOrigin: "" };
    const scrub = (text: string): string => {
      let out = text;
      const replace = (value: string, label: string) => {
        if (value !== "") out = out.split(value).join(label);
      };
      replace(token, "<token>");
      replace(perRun.tmpDir, "<tmp>");
      replace(names.target, "<container>");
      replace(names.gateway, "<container>");
      replace(names.volume, "<volume>");
      replace(names.network, "<network>");
      replace(perRun.controlOrigin, "<control>");
      if (perRun.gatewayIp !== "") {
        // 172.24.0.2 가 172.24.0.25 의 앞부분으로 걸리지 않게 한다.
        const address = new RegExp(`(?<![0-9.])${escapeRegExp(perRun.gatewayIp)}(?![0-9])`, "g");
        out = out.replace(address, "<gateway>");
      }
      replace(prefix, "<run>");
      replace(runId, "<run>");
      return out;
    };

    async function control(
      method: "GET" | "POST",
      path: string,
      body?: string,
      timeoutMs: number = CONTROL_TIMEOUT_MS,
    ): Promise<{ readonly status: number; readonly text: string }> {
      const response = await io.fetch(`http://${perRun.controlOrigin}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, text: await response.text() };
    }

    const must = async (
      args: readonly string[],
      extraEnv?: Readonly<Record<string, string>>,
    ): Promise<string> => {
      const outcome = await docker(args, extraEnv === undefined ? {} : { extraEnv });
      if (!outcome.ok) throw unavailableError("start-failed", outcome.reason);
      return outcome.stdout;
    };

    async function prepare(): Promise<void> {
      perRun.tmpDir = await io.makeTempDir();
      tmp.present = true;
      (tmp as { id: string }).id = perRun.tmpDir;
      for (const file of spec.home.files) {
        await io.writeFile(`${perRun.tmpDir}/home/${file.path}`, file.content, file.mode);
      }

      await must(["network", "create", "--internal", "--label", LABEL, names.network]);
      network.present = true;
      // 인터페이스 순서는 실행마다 다르다. 게이트웨이가 internal 쪽 주소를 서브넷으로 고르게 한다.
      const ipam = parseJson(
        await must(["network", "inspect", "--format", "{{json .IPAM.Config}}", names.network]),
      );
      const subnet = (Array.isArray(ipam) ? ipam : [])
        .map((entry) => (isRecord(entry) ? entry.Subnet : undefined))
        .find((value): value is string => typeof value === "string" && value.includes("."));
      if (subnet === undefined) {
        throw unavailableError("start-failed", "격리 네트워크의 서브넷을 읽지 못했습니다");
      }

      await must(["volume", "create", "--label", LABEL, names.volume]);
      volume.present = true;

      // create 가 실패해도 반쯤 만들어진 컨테이너가 남을 수 있어 먼저 표시한다.
      gateway.present = true;
      await must(
        [
          "create",
          "--name",
          names.gateway,
          "--label",
          LABEL,
          "--read-only",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "NET_BIND_SERVICE",
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp",
          "--network",
          names.network,
          "-p",
          `127.0.0.1::${CONTROL_PORT}`,
          "-e",
          "MCPEAK_GATEWAY_TOKEN",
          "-e",
          "MCPEAK_GATEWAY_INTERNAL_SUBNET",
          "-e",
          "MCPEAK_GATEWAY_MODE",
          image,
          "node",
          "/opt/mcpeak/gateway/server.mjs",
        ],
        {
          MCPEAK_GATEWAY_TOKEN: token,
          MCPEAK_GATEWAY_INTERNAL_SUBNET: subnet,
          MCPEAK_GATEWAY_MODE: mode,
        },
      );
      // 제어 포트의 publish 는 --internal 네트워크만으로는 되지 않는다. 그래서 재생에서도 bridge 에
      // 붙인다. 재생에서 상류에 접속하지 않는 것은 게이트웨이가 MCPEAK_GATEWAY_MODE 를 보고 지킨다.
      // target 은 어느 모드에서도 --internal 하나에만 붙는다. 프로세스가 뜨기 전에 붙여야
      // 게이트웨이가 시작할 때 두 인터페이스를 다 본다.
      await must(["network", "connect", "bridge", names.gateway]);
      await must(["start", names.gateway]);

      const settings = parseJson(
        await must(["inspect", "--format", "{{json .NetworkSettings}}", names.gateway]),
      );
      const ports = isRecord(settings) && isRecord(settings.Ports) ? settings.Ports : {};
      const bindings = ports[`${CONTROL_PORT}/tcp`];
      const binding = Array.isArray(bindings) ? bindings[0] : undefined;
      const hostPort = isRecord(binding) ? binding.HostPort : undefined;
      const networks = isRecord(settings) && isRecord(settings.Networks) ? settings.Networks : {};
      const attached = networks[names.network];
      const address = isRecord(attached) ? attached.IPAddress : undefined;
      if (
        typeof hostPort !== "string" ||
        !/^[0-9]+$/.test(hostPort) ||
        typeof address !== "string" ||
        !/^[0-9]{1,3}(\.[0-9]{1,3}){3}$/.test(address)
      ) {
        throw unavailableError("start-failed", "게이트웨이의 주소나 제어 포트를 읽지 못했습니다");
      }
      perRun.gatewayIp = address;
      perRun.controlOrigin = `127.0.0.1:${hostPort}`;

      let ready = false;
      for (let attempt = 0; attempt < HEALTH_ATTEMPTS && !ready; attempt += 1) {
        if (attempt > 0) await sleep(HEALTH_INTERVAL_MS);
        try {
          ready = (await control("GET", "/health", undefined, 1_000)).status === 200;
        } catch {
          // 아직 듣지 않는다. 다시 묻는다.
        }
      }
      if (!ready) {
        throw unavailableError("start-failed", "게이트웨이가 10초 안에 준비되지 않았습니다");
      }

      const ca = parseJson((await control("GET", "/ca")).text);
      const pem = isRecord(ca) ? ca.pem : undefined;
      if (typeof pem !== "string" || pem === "") {
        throw unavailableError("start-failed", "게이트웨이가 CA 인증서를 주지 않았습니다");
      }
      await io.writeFile(`${perRun.tmpDir}/ca.pem`, pem, 0o644);
      await io.writeFile(
        `${perRun.tmpDir}/target.env`,
        `${TARGET_FIXED_ENV.map(([name, value]) => `${name}=${value}`).join("\n")}\n`,
        0o644,
      );

      // 세션 파일과 재생 매칭에서 가릴 값. 빈 값은 모든 자리에 맞으므로 보내지 않는다.
      const forwarded = new Set(spec.target.forwardedEnvNames);
      const envNames = Object.keys(spec.env).sort();
      const secrets = [
        ...envNames
          .filter((name) => !forwarded.has(name))
          .map((name) => ({ label: `<canary:${name}>`, value: spec.env[name] ?? "" })),
        ...spec.home.files.flatMap((file) =>
          file.canary === undefined
            ? []
            : [{ label: `<canary:~/${file.path}>`, value: file.canary }],
        ),
        ...envNames
          .filter((name) => forwarded.has(name))
          .map((name) => ({ label: `<env:${name}>`, value: spec.env[name] ?? "" })),
      ].filter((secret) => secret.value !== "");
      const accepted = await control("POST", "/secrets", JSON.stringify({ secrets }));
      if (accepted.status !== 200) {
        throw unavailableError(
          "start-failed",
          `게이트웨이가 가릴 값 목록을 받지 않았습니다(POST /secrets 가 HTTP ${accepted.status})`,
        );
      }

      if (replaySession !== undefined) {
        const loaded = await control("POST", "/session", replaySession, CONTROL_BULK_TIMEOUT_MS);
        if (loaded.status !== 200) {
          const body = parseJson(loaded.text);
          const cause = isRecord(body) && typeof body.error === "string" ? body.error : "";
          throw sessionUnreadable(
            sessionPath,
            firstLine(cause) || `게이트웨이가 세션을 받지 않았습니다(HTTP ${loaded.status})`,
          );
        }
      }
    }

    try {
      await prepare();
    } catch (error) {
      const { left } = await cleanup(resources);
      if (error instanceof AuditError) throw error;
      const known = unavailableIn(error);
      const detail = scrub(known?.detail ?? messageOf(error));
      throw unavailableError(
        known?.code ?? "start-failed",
        left.length === 0
          ? detail
          : `${detail} (격리 자원도 다 치우지 못했습니다: ${describeLeft(left)})`,
      );
    }

    // 여기서부터는 호출자가 launchTarget 으로 target 컨테이너를 띄운다. 띄우지 않고 끝나도
    // destroy 가 없는 컨테이너를 치운 것으로 본다.
    target.present = true;

    // 호스트의 절대 경로(/opt/homebrew/bin/node)는 컨테이너에 없다. 경로로 온 명령은 이름만 남겨
    // 이미지의 PATH 에서 찾게 한다. Windows 구분자도 자른다. args 는 건드리지 않는다.
    const given = spec.target.command ?? "";
    const command = given.split(/[\\/]/).pop() || given;
    const launchArgs = [
      "run",
      "--name",
      names.target,
      "--label",
      LABEL,
      "-i",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--pids-limit",
      "256",
      "--memory",
      "1g",
      "--tmpfs",
      "/tmp:rw,size=256m,uid=1000",
      "--user",
      SANDBOX_USER,
      "--hostname",
      spec.home.hostname,
      "--network",
      names.network,
      "--dns",
      perRun.gatewayIp,
      "-v",
      `${names.volume}:${TRACE_DIR}`,
      "-v",
      `${perRun.tmpDir}/home:/home/node:ro`,
      "-v",
      `${spec.mountRoot}:${spec.mountRoot}:ro`,
      "-v",
      `${perRun.tmpDir}/ca.pem:${CA_PATH}:ro`,
      "-w",
      spec.cwd,
      "--env-file",
      `${perRun.tmpDir}/target.env`,
      // 값은 argv 에 싣지 않는다. 이름만 넘기면 docker CLI 가 자기 env(launchEnv)에서 값을 읽는다.
      ...Object.keys(spec.env)
        .sort()
        .flatMap((name) => ["-e", name]),
      image,
      ...STRACE,
      command,
      ...(spec.target.args ?? []),
    ];

    // 단계 귀속의 상태. 시각을 쓰지 않고 trace 의 누적 줄 수로 자른다.
    let phase: SandboxPhase = { kind: "start" };
    /** 지금까지 본 누적 줄 수. 줄었는지(traceShrank)는 이 수로만 판정한다. */
    let seenLines = 0;
    /** 읽었지만 아직 어느 단계에도 붙이지 않은 줄. 짝을 기다리는 반쪽 줄과 그 뒤의 줄이다. */
    let carried: readonly string[] = [];
    let traceShrank = false;
    const segments: { readonly phase: SandboxPhase; readonly lines: readonly string[] }[] = [];
    const traceGaps: string[] = [];
    const gatewayGaps: string[] = [];
    const note = (gaps: string[], reason: string) => {
      const scrubbed = scrub(reason);
      if (!gaps.includes(scrubbed)) gaps.push(scrubbed);
    };

    /**
     * 볼륨을 읽기 전용으로 붙인 일회용 컨테이너로 trace 를 읽는다. target 이 살아 있든 죽었든 같은
     * 방법이다. 서버가 건드릴 수 있는 파일이라 읽는 쪽도 권한을 다 떨군다. 개행으로 끝나지 않은
     * 마지막 줄은 쓰는 중이므로 세지 않는다.
     */
    async function readTrace(): Promise<readonly string[] | { readonly reason: string }> {
      const outcome = await docker(
        [
          "run",
          "--rm",
          "--label",
          LABEL,
          "--network",
          "none",
          "--read-only",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--user",
          SANDBOX_USER,
          "-v",
          `${names.volume}:/v:ro`,
          image,
          "cat",
          "/v/trace",
        ],
        {},
      );
      if (!outcome.ok) return { reason: outcome.reason };
      const end = outcome.stdout.lastIndexOf("\n");
      return end < 0 ? [] : outcome.stdout.slice(0, end).split("\n");
    }

    /**
     * strace -f 는 다른 프로세스가 끼어들면 한 호출을 `<unfinished ...>` 와 `<... resumed>` 두 줄로
     * 가른다. 그 사이에 mark 가 오면 반쪽씩 다른 단계로 가서 해석기가 둘 다 못 읽는다. 그러면
     * unparsedLines 와 사건의 단계가 mark 시점의 우연에 따라 실행마다 달라진다. 그래서 짝이 아직 없는
     * 가장 앞의 반쪽 줄부터는 이번 단계에 붙이지 않고 다음으로 미룬다. 돌려주는 값은 붙일 줄의 수다.
     * 판정은 줄 내용과 순서로만 한다. 짝은 해석기와 같이 줄 머리의 PID 로 맞춘다.
     *
     * 앞쪽 `released` 줄은 이미 한 번 미룬 것이라 다시 미루지 않는다. 끝나지 않는 호출(막힌 connect
     * 등) 하나가 뒤의 관측 전부를 마지막 단계로 끌고 가지 않게 한다.
     */
    function attachable(pool: readonly string[], released: number): number {
      const waiting = new Map<string, number>();
      /** 짝을 찾은 호출의 [반쪽, 짝] 자리. */
      const pairs: (readonly [number, number])[] = [];
      pool.forEach((line, index) => {
        const head = /^(?:(\d+)\s+)?(.*)$/.exec(line);
        const pid = head?.[1] ?? "";
        const body = head?.[2] ?? "";
        if (body.endsWith("<unfinished ...>")) {
          if (!waiting.has(pid)) waiting.set(pid, index);
        } else if (/^<\.\.\. [a-z_0-9]+ resumed>/.test(body)) {
          const front = waiting.get(pid);
          if (front !== undefined) pairs.push([front, index]);
          waiting.delete(pid);
        }
      });
      let cut = Math.min(pool.length, ...[...waiting.values()].filter((at) => at >= released));
      // 자른 자리 뒤에 짝이 있는 호출은 반쪽도 함께 미룬다. 앞으로 당긴 자리가 또 다른 호출을
      // 가를 수 있어 뒤에서부터 본다.
      for (const [front, back] of [...pairs].sort((a, b) => b[0] - a[0])) {
        if (front < cut && back >= cut) cut = front;
      }
      return cut;
    }

    async function mark(next: SandboxPhase): Promise<void> {
      // 게이트웨이가 진행 중 요청을 비운 뒤에 답하므로, 먼저 알리고 그다음 trace 를 읽는다.
      try {
        const told = await control("POST", "/phase", JSON.stringify({ phase: next }));
        if (told.status !== 200) {
          note(gatewayGaps, `단계를 알리지 못했습니다(POST /phase 가 HTTP ${told.status})`);
        }
      } catch (error) {
        note(gatewayGaps, messageOf(error));
      }
      const lines = await readTrace();
      if (!Array.isArray(lines)) {
        note(traceGaps, (lines as { readonly reason: string }).reason);
      } else {
        // 기록이 줄었으면 서버가 건드린 것이다. 이미 읽은 관측과 미뤄 둔 줄은 그대로 둔다.
        if (lines.length < seenLines) traceShrank = true;
        const pool = [...carried, ...lines.slice(seenLines)];
        const cut = attachable(pool, carried.length);
        if (cut > 0) segments.push({ phase, lines: pool.slice(0, cut) });
        carried = pool.slice(cut);
        seenLines = lines.length;
      }
      phase = next;
    }

    async function snapshot(): Promise<Observation> {
      const trace = [...traceGaps];
      const gate = [...gatewayGaps];

      // 마지막 mark 뒤의 줄과 미뤄 둔 줄은 지금 단계의 것이다. 여기서는 더 미루지 않는다. 짝을 끝내
      // 못 찾은 반쪽도 해석기에 넘겨 unparsed 로 세게 한다. 줄 목록은 바꾸지 않아 다시 불러도 같다.
      const all = [...segments];
      const lines = await readTrace();
      let tail = carried;
      if (!Array.isArray(lines)) note(trace, (lines as { readonly reason: string }).reason);
      else if (lines.length < seenLines) traceShrank = true;
      else tail = [...carried, ...lines.slice(seenLines)];
      if (tail.length > 0) all.push({ phase, lines: tail });

      let events: SyscallEvent[] = [];
      let unparsedLines = 0;
      try {
        for (const segment of all) {
          const parsed = parse(segment.lines, segment.phase, spec.cwd);
          unparsedLines += parsed.unparsed;
          for (const event of parsed.events) {
            events.push(
              event.kind === "connect" && event.address === perRun.gatewayIp
                ? { ...event, address: "<gateway>" }
                : event,
            );
          }
        }
      } catch (error) {
        events = [];
        unparsedLines = 0;
        note(trace, `시스템 콜 기록을 해석하지 못했습니다: ${messageOf(error)}`);
      }

      let seen: Pick<Observation, "requests" | "tlsRejections" | "dnsNames"> = {
        requests: [],
        tlsRejections: [],
        dnsNames: [],
      };
      try {
        const got = await control("GET", "/observation", undefined, CONTROL_BULK_TIMEOUT_MS);
        const body = got.status === 200 ? parseJson(got.text) : undefined;
        if (got.status !== 200) {
          note(gate, `관측을 받지 못했습니다(GET /observation 이 HTTP ${got.status})`);
        } else if (
          !isRecord(body) ||
          !Array.isArray(body.requests) ||
          !Array.isArray(body.tlsRejections) ||
          !Array.isArray(body.dnsNames)
        ) {
          note(gate, "게이트웨이의 관측 응답이 형식에 맞지 않습니다");
        } else {
          seen = scrubObservation(body as unknown as typeof seen);
        }
      } catch (error) {
        note(gate, messageOf(error));
      }

      if (mode === "record") {
        try {
          const got = await control("GET", "/session", undefined, CONTROL_BULK_TIMEOUT_MS);
          const session = got.status === 200 ? parseJson(got.text) : undefined;
          if (session === undefined) {
            note(gate, `녹화를 받지 못했습니다(GET /session 이 HTTP ${got.status})`);
          } else {
            // 받은 값을 세션 파일 형식으로 다시 쓴다. 키 순서는 게이트웨이가 준 그대로다.
            await io.writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, 0o600);
          }
        } catch (error) {
          note(gate, `세션 파일을 쓰지 못했습니다: ${messageOf(error)}`);
        }
      }

      return {
        events,
        ...seen,
        traceShrank,
        gaps: [
          ...trace.map((reason) => ({ source: "trace" as const, reason })),
          ...gate.map((reason) => ({ source: "gateway" as const, reason })),
        ],
        unparsedLines,
      };
    }

    /** 요청 기록에 실린 실행별 값(게이트웨이 주소 등)을 자리표로 바꾼다. 본문은 건드리지 않는다. */
    function scrubObservation(
      body: Pick<Observation, "requests" | "tlsRejections" | "dnsNames">,
    ): Pick<Observation, "requests" | "tlsRejections" | "dnsNames"> {
      const text = (value: unknown) => (typeof value === "string" ? scrub(value) : value);
      return {
        requests: body.requests.map((request) =>
          isRecord(request)
            ? ({
                ...request,
                host: text(request.host),
                path: text(request.path),
                headers: Array.isArray(request.headers)
                  ? request.headers.map((header: unknown) =>
                      Array.isArray(header) ? [header[0], text(header[1])] : header,
                    )
                  : request.headers,
              } as typeof request)
            : request,
        ),
        tlsRejections: body.tlsRejections.map((entry) =>
          isRecord(entry) ? ({ ...entry, host: text(entry.host) } as typeof entry) : entry,
        ),
        dnsNames: body.dnsNames.map((entry) =>
          isRecord(entry) ? ({ ...entry, name: text(entry.name) } as typeof entry) : entry,
        ),
      };
    }

    async function destroy(): Promise<void> {
      const { left, firstError } = await cleanup(resources);
      if (left.length === 0) return;
      // 이 문장은 stderr 로만 간다. 사용자가 직접 치울 때 필요한 이름과 경로를 가리지 않는다.
      throw new AuditError(
        "SANDBOX_CLEANUP_FAILED",
        `→ 격리 자원을 다 치우지 못했습니다: ${describeLeft(left)}\n→ ${firstError}\n${CLEANUP_HINT}`,
      );
    }

    return {
      launchTarget: {
        kind: "stdio",
        command: "docker",
        args: launchArgs,
        forwardedEnvNames: [],
        headerNames: [],
      },
      launchEnv: { ...spec.env, ...io.dockerClientEnv() },
      image,
      mark,
      snapshot,
      destroy,
    };
  }

  return {
    name: "docker",
    commands: ["node", "npx", "npm"],
    async detect() {
      try {
        const result = await io.run(["version"], { timeoutMs: DOCKER_TIMEOUT_MS });
        if (result.code === 0) return { ok: true };
      } catch (error) {
        if (isRecord(error) || error instanceof Error) {
          if ((error as { code?: unknown }).code === "ENOENT") {
            return { ok: false, reason: { code: "docker-missing", detail: "" } };
          }
        }
      }
      return { ok: false, reason: { code: "daemon-down", detail: "" } };
    },
    start,
  };
}
