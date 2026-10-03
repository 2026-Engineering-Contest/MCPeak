import { afterEach, describe, expect, it, vi } from "vitest";
import type { SandboxHandle, SandboxSpec } from "../src/sandbox/backend.js";
import { createDockerBackend, type DockerIo } from "../src/sandbox/docker.js";
import { sandboxImageTag } from "../src/sandbox/image.js";
import { parseTrace, type TraceParser } from "../src/sandbox/trace.js";
import { AuditError, type SandboxUnavailable, type SyscallEvent } from "../src/types.js";

/**
 * 가짜 `DockerIo`. 실제 docker 는 부르지 않는다. 받은 argv 와 extraEnv 를 순서대로 기록하고,
 * 바깥 세계에 닿는 호출(run, fetch, 파일 쓰기·지우기)을 한 줄씩 `log` 에 남긴다.
 */

type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

interface RunCall {
  readonly args: readonly string[];
  readonly extraEnv: Readonly<Record<string, string>> | undefined;
}

interface FetchCall {
  readonly method: string;
  readonly path: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string | undefined;
}

interface FakeOptions {
  /** undefined 를 돌려주면 기본 응답이 답한다. 던지면 io.run 이 거절한다. */
  readonly onRun?: (args: readonly string[]) => RunResult | undefined;
  /** undefined 를 돌려주면 기본 응답이 답한다. 던지면 fetch 가 거절한다. */
  readonly onFetch?: (call: FetchCall) => Response | undefined;
  readonly seed?: string;
  readonly files?: Readonly<Record<string, string>>;
  readonly removeDirFails?: string;
}

const OK: RunResult = { code: 0, stdout: "", stderr: "" };
const CLIENT_ENV = {
  PATH: "/usr/local/bin:/usr/bin",
  HOME: "/Users/tester",
  DOCKER_HOST: "unix:///var/run/docker.sock",
};
const TMP = "/tmp/mcpeak-audit-sandbox-x1";
const GATEWAY_IP = "172.24.0.2";
const CONTROL_PORT = "49231";
const SOURCES = [
  { path: "Dockerfile", content: "FROM node:22-bookworm-slim\n" },
  { path: "gateway/server.mjs", content: "console.log('gateway');\n" },
];
const IMAGE = `mcpeak-audit-sandbox:${sandboxImageTag(SOURCES)}`;
const SESSION = {
  schemaVersion: 1,
  entries: [
    {
      key: {
        method: "GET",
        scheme: "https",
        host: "api.example.com",
        port: 443,
        path: "/v1/x?q=1",
        bodySha256: "e3b0",
      },
      responses: [{ status: 200, headers: [["content-type", "text/plain"]], bodyBase64: "b2s=" }],
    },
  ],
};
const EMPTY_OBSERVATION = { requests: [], tlsRejections: [], dnsNames: [] };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeIo(options: FakeOptions = {}) {
  const runs: RunCall[] = [];
  const fetches: FetchCall[] = [];
  const writes: { path: string; content: string; mode: number }[] = [];
  const progress: string[] = [];
  const log: string[] = [];
  /** 볼륨의 trace 파일 내용. 테스트가 바꿔 가며 mark·snapshot 을 부른다. */
  const state = { trace: "", observation: EMPTY_OBSERVATION as unknown, session: SESSION };
  let counter = 0;

  const defaultRun = (args: readonly string[]): RunResult => {
    if (args[0] === "network" && args[1] === "inspect") {
      return { ...OK, stdout: '[{"Subnet":"172.24.0.0/16","Gateway":"172.24.0.1"}]\n' };
    }
    if (args[0] === "inspect") {
      const gateway = args[args.length - 1] ?? "";
      const network = gateway.replace(/-gateway$/, "-net");
      return {
        ...OK,
        stdout: `${JSON.stringify({
          Ports: { "7000/tcp": [{ HostIp: "127.0.0.1", HostPort: CONTROL_PORT }] },
          Networks: { bridge: { IPAddress: "172.17.0.3" }, [network]: { IPAddress: GATEWAY_IP } },
        })}\n`,
      };
    }
    if (args[0] === "run" && args.includes("cat")) return { ...OK, stdout: state.trace };
    return OK;
  };

  const defaultFetch = (call: FetchCall): Response => {
    const route = `${call.method} ${call.path}`;
    if (route === "GET /ca") return json({ pem: "-----BEGIN CERTIFICATE-----\nFAKE\n" });
    if (route === "GET /observation") return json(state.observation);
    if (route === "GET /session") return json(state.session);
    return json({ ok: true });
  };

  const io: DockerIo = {
    async run(args, runOptions) {
      runs.push({ args: [...args], extraEnv: runOptions?.extraEnv });
      log.push(`docker ${args.join(" ")}`);
      return options.onRun?.(args) ?? defaultRun(args);
    },
    dockerClientEnv: () => CLIENT_ENV,
    async makeTempDir() {
      log.push("makeTempDir");
      return TMP;
    },
    async writeFile(path, content, mode) {
      writes.push({ path, content, mode });
      log.push(`writeFile ${path}`);
    },
    async readFile(path) {
      const content = options.files?.[path];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    async removeDir(path) {
      log.push(`removeDir ${path}`);
      if (options.removeDirFails !== undefined) throw new Error(options.removeDirFails);
    },
    readSandboxSources: async () => SOURCES,
    sandboxDir: "/pkg/audit/sandbox",
    fetch: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const call: FetchCall = {
        method: init?.method ?? "GET",
        path: new URL(url).pathname,
        url,
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? init.body : undefined,
      };
      fetches.push(call);
      log.push(`fetch ${call.method} ${call.path}`);
      return options.onFetch?.(call) ?? defaultFetch(call);
    }) as typeof globalThis.fetch,
    random() {
      counter += 1;
      return `${options.seed ?? "a1b2c3d4e5f6"}${counter.toString(16).padStart(4, "0")}`;
    },
    progress: (line) => {
      progress.push(line);
    },
  };
  return { io, runs, fetches, writes, progress, log, state };
}

/** 가짜 해석기. `connect <주소> <포트>` 줄은 접속, `??` 로 시작하면 해석 실패, 그 밖은 열기다. */
const fakeParse: TraceParser = (lines, phase) => {
  const events: SyscallEvent[] = [];
  let unparsed = 0;
  for (const line of lines) {
    const [verb, address, port] = line.split(" ");
    if (line.startsWith("??")) unparsed += 1;
    else if (verb === "connect") {
      events.push({
        kind: "connect",
        phase,
        family: "inet",
        address: address ?? "",
        port: Number(port),
      });
    } else events.push({ kind: "open", phase, path: line, write: false, result: "ok" });
  }
  return { events, unparsed };
};

const FILE_CANARY = "0123456789abcdef0123456789abcdef";
const ENV_CANARY = "mcpeak-canary-77aa88bb99cc";
const REAL_VALUE = "real-api-key-value-9f8e7d";

const SPEC: SandboxSpec = {
  target: {
    kind: "stdio",
    command: "node",
    args: ["server.mjs", "--verbose", "--name=weather"],
    forwardedEnvNames: ["API_KEY"],
    headerNames: [],
  },
  env: { MCPEAK_CANARY_AWS_SECRET_ACCESS_KEY: ENV_CANARY, API_KEY: REAL_VALUE },
  mountRoot: "/work/repo",
  cwd: "/work/repo/examples/weather-server",
  home: {
    hostname: "jiwoo-laptop",
    files: [
      {
        path: ".aws/credentials",
        content: `[default]\naws_secret_access_key = ${FILE_CANARY}\n`,
        mode: 0o644,
        canary: FILE_CANARY,
      },
      { path: ".gitconfig", content: "[user]\n  name = Jiwoo Kim\n", mode: 0o644 },
    ],
  },
};

const RECORD: SandboxSpec = { ...SPEC, session: { mode: "record", path: "/user/session.json" } };
const REPLAY: SandboxSpec = { ...SPEC, session: { mode: "replay", path: "/user/session.json" } };
const SESSION_FILES = { "/user/session.json": `${JSON.stringify(SESSION, null, 2)}\n` };

async function started(spec: SandboxSpec = SPEC, options: FakeOptions = {}) {
  const fake = fakeIo(options);
  const handle = await createDockerBackend(fake.io, fakeParse).start(spec);
  return { ...fake, handle };
}

/** 실패한 start 가 던진 값을 돌려준다. 던지지 않으면 테스트가 실패한다. */
async function startFailure(spec: SandboxSpec, options: FakeOptions) {
  const fake = fakeIo(options);
  let thrown: unknown;
  try {
    await createDockerBackend(fake.io, fakeParse).start(spec);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  return { ...fake, thrown };
}

function unavailableOf(thrown: unknown): SandboxUnavailable {
  return (thrown as { unavailable: SandboxUnavailable }).unavailable;
}

function targetArgs(handle: SandboxHandle): readonly string[] {
  return handle.launchTarget.args ?? [];
}

/** `flag` 바로 뒤에 온 값 전부. */
function valuesOf(args: readonly string[], flag: string): string[] {
  return args.flatMap((arg, index) => (arg === flag ? [args[index + 1] ?? ""] : []));
}

function count(args: readonly string[], value: string): number {
  return args.filter((arg) => arg === value).length;
}

/** `flag value` 가 붙어서 나온 횟수. */
function countPair(args: readonly string[], flag: string, value: string): number {
  return valuesOf(args, flag).filter((found) => found === value).length;
}

/** runId 는 이름에서 읽는다. 테스트가 난수 열의 순서를 가정하지 않게 한다. */
function runIdOf(handle: SandboxHandle): string {
  const name = valuesOf(targetArgs(handle), "--name")[0] ?? "";
  const match = /^mcpeak-audit-([0-9a-f]{16})-target$/.exec(name);
  expect(match).not.toBeNull();
  return match?.[1] ?? "";
}

function findRun(runs: readonly RunCall[], ...head: string[]): RunCall {
  const found = runs.find((run) => head.every((part, index) => run.args[index] === part));
  expect(found, `docker ${head.join(" ")} 를 부르지 않았습니다`).toBeDefined();
  return found as RunCall;
}

function tokenOf(runs: readonly RunCall[]): string {
  return findRun(runs, "create").extraEnv?.MCPEAK_GATEWAY_TOKEN ?? "";
}

const STRACE = [
  "strace",
  "-f",
  "-qq",
  "-s",
  "256",
  "-e",
  "trace=openat,execve,connect,?unlink,unlinkat,?rmdir,?rename,?renameat,renameat2",
  "-o",
  "/var/mcpeak/trace",
];

afterEach(() => {
  vi.useRealTimers();
});

describe("detect", () => {
  it("docker 실행 파일이 없으면(ENOENT) code 가 docker-missing 이고 detail 은 빈 문자열", async () => {
    const { io } = fakeIo({
      onRun: () => {
        throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
      },
    });
    expect(await createDockerBackend(io, fakeParse).detect()).toEqual({
      ok: false,
      reason: { code: "docker-missing", detail: "" },
    });
  });

  it("docker version 이 0 이 아닌 코드로 끝나면 daemon-down", async () => {
    const { io, runs } = fakeIo({
      onRun: () => ({ code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" }),
    });
    expect(await createDockerBackend(io, fakeParse).detect()).toEqual({
      ok: false,
      reason: { code: "daemon-down", detail: "" },
    });
    expect(runs[0]?.args).toEqual(["version"]);
  });

  it("docker version 이 0 으로 끝나면 ok", async () => {
    const { io } = fakeIo();
    expect(await createDockerBackend(io, fakeParse).detect()).toEqual({ ok: true });
  });

  it("격리 이미지가 실행하는 명령은 node, npx, npm 이다", () => {
    const backend = createDockerBackend(fakeIo().io, fakeParse);
    expect(backend.name).toBe("docker");
    expect(backend.commands).toEqual(["node", "npx", "npm"]);
  });
});

describe("start: target 컨테이너의 argv", () => {
  it("--read-only, --cap-drop ALL, --security-opt no-new-privileges, --pids-limit 256, --memory 1g, -i 가 각각 한 번 있다", async () => {
    const { handle } = await started();
    const args = targetArgs(handle);
    expect(handle.launchTarget).toMatchObject({
      kind: "stdio",
      command: "docker",
      forwardedEnvNames: [],
      headerNames: [],
    });
    expect(args[0]).toBe("run");
    expect(count(args, "--read-only")).toBe(1);
    expect(valuesOf(args, "--cap-drop")).toEqual(["ALL"]);
    expect(valuesOf(args, "--security-opt")).toEqual(["no-new-privileges"]);
    expect(valuesOf(args, "--pids-limit")).toEqual(["256"]);
    expect(valuesOf(args, "--memory")).toEqual(["1g"]);
    expect(count(args, "-i")).toBe(1);
  });

  it("--rm, --privileged, --cap-add, --network host, --pid host 가 없다", async () => {
    const { handle } = await started();
    const args = targetArgs(handle);
    expect(args).not.toContain("--rm");
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--cap-add");
    expect(args).not.toContain("--pid");
    expect(args).not.toContain("host");
    expect(args.some((arg) => /^--(privileged|cap-add|pid|network=host)(=|$)/.test(arg))).toBe(
      false,
    );
    expect(valuesOf(args, "--network")).toEqual([`mcpeak-audit-${runIdOf(handle)}-net`]);
  });

  it("호스트 경로의 -v 는 정확히 셋이고 전부 :ro 로 끝난다(홈, 마운트 루트, CA)", async () => {
    const { handle } = await started();
    const hostMounts = valuesOf(targetArgs(handle), "-v").filter((value) => value.startsWith("/"));
    expect(hostMounts).toEqual([
      `${TMP}/home:/home/node:ro`,
      "/work/repo:/work/repo:ro",
      `${TMP}/ca.pem:/etc/mcpeak/ca.pem:ro`,
    ]);
    expect(targetArgs(handle)).not.toContain("--mount");
    expect(targetArgs(handle)).not.toContain("--volume");
  });

  it("이름 있는 볼륨의 -v 는 /var/mcpeak 하나이고 이름이 mcpeak-audit-<runId>-trace 다", async () => {
    const { handle } = await started();
    const named = valuesOf(targetArgs(handle), "-v").filter((value) => !value.startsWith("/"));
    expect(named).toEqual([`mcpeak-audit-${runIdOf(handle)}-trace:/var/mcpeak`]);
  });

  it("strace 의 -o 가 /var/mcpeak/trace 다", async () => {
    const { handle } = await started();
    const args = targetArgs(handle);
    const command = args.slice(args.indexOf(IMAGE) + 1);
    expect(command[0]).toBe("strace");
    expect(valuesOf(command, "-o")).toEqual(["/var/mcpeak/trace"]);
  });

  it("마운트 루트는 호스트와 컨테이너에서 같은 경로다", async () => {
    const { handle } = await started({ ...SPEC, mountRoot: "/srv/code", cwd: "/srv/code/app" });
    expect(valuesOf(targetArgs(handle), "-v")).toContain("/srv/code:/srv/code:ro");
  });

  it("--tmpfs 는 /tmp 하나이고 uid=1000 을 담는다", async () => {
    const { handle } = await started();
    expect(valuesOf(targetArgs(handle), "--tmpfs")).toEqual(["/tmp:rw,size=256m,uid=1000"]);
  });

  it("--user 는 1000:1000 이다", async () => {
    const { handle } = await started();
    expect(valuesOf(targetArgs(handle), "--user")).toEqual(["1000:1000"]);
  });

  it("--hostname 이 HomePlan.hostname 이다", async () => {
    const { handle } = await started();
    expect(valuesOf(targetArgs(handle), "--hostname")).toEqual(["jiwoo-laptop"]);
  });

  it("--dns 가 gateway 의 주소다", async () => {
    const { handle } = await started();
    expect(valuesOf(targetArgs(handle), "--dns")).toEqual([GATEWAY_IP]);
  });

  it("-e 는 이름만 싣는다. argv 어디에도 '=' 로 이어진 env 값이 없다", async () => {
    const { handle } = await started();
    const args = targetArgs(handle);
    // 이미지 뒤는 컨테이너 안에서 도는 명령이다(strace 의 -e 가 거기 있다).
    const beforeImage = args.slice(0, args.indexOf(IMAGE));
    expect(valuesOf(beforeImage, "-e")).toEqual(["API_KEY", "MCPEAK_CANARY_AWS_SECRET_ACCESS_KEY"]);
    expect(beforeImage).not.toContain("--env");
    expect(beforeImage.filter((arg) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg))).toEqual([]);
  });

  it("SandboxSpec.env 의 어떤 값도 run 에 넘긴 argv 전체에 부분 문자열로 나오지 않는다", async () => {
    const { handle, runs } = await started();
    const everything = [...runs.flatMap((run) => run.args), ...targetArgs(handle)].join("\n");
    for (const value of Object.values(SPEC.env)) expect(everything).not.toContain(value);
    expect(everything).not.toContain(FILE_CANARY);
  });

  it("launchEnv 는 SandboxSpec.env 와 dockerClientEnv() 의 합이고 그 밖의 호스트 env 는 없다", async () => {
    const { handle } = await started();
    expect(handle.launchEnv).toEqual({ ...SPEC.env, ...CLIENT_ENV });
  });

  it("dockerClientEnv 의 이름(PATH·HOME·DOCKER_HOST…)은 -e 목록에 없다", async () => {
    const { handle } = await started();
    const args = targetArgs(handle);
    const names = valuesOf(args.slice(0, args.indexOf(IMAGE)), "-e");
    expect(names.length).toBeGreaterThan(0);
    for (const name of Object.keys(CLIENT_ENV)) expect(names).not.toContain(name);
  });

  it("HOME 과 CA 변수 다섯은 값이 비밀이 아니라 env 파일로 넘긴다(launchEnv 에 섞지 않는다)", async () => {
    const { handle, writes } = await started();
    expect(valuesOf(targetArgs(handle), "--env-file")).toEqual([`${TMP}/target.env`]);
    expect(writes.find((write) => write.path === `${TMP}/target.env`)).toEqual({
      path: `${TMP}/target.env`,
      content: [
        "HOME=/home/node",
        "NODE_EXTRA_CA_CERTS=/etc/mcpeak/ca.pem",
        "SSL_CERT_FILE=/etc/mcpeak/ca.pem",
        "REQUESTS_CA_BUNDLE=/etc/mcpeak/ca.pem",
        "CURL_CA_BUNDLE=/etc/mcpeak/ca.pem",
        "GIT_SSL_CAINFO=/etc/mcpeak/ca.pem",
        "",
      ].join("\n"),
      mode: 0o644,
    });
  });

  it("명령은 strace -f -qq -s 256 -e trace=openat,execve,connect,?unlink,unlinkat,?rmdir,?rename,?renameat,renameat2 로 감싸이고 그 뒤가 command 는 basename, args 는 원래 순서 그대로다", async () => {
    const { handle } = await started();
    const args = targetArgs(handle);
    expect(args.slice(args.indexOf(IMAGE) + 1)).toEqual([
      ...STRACE,
      "node",
      "server.mjs",
      "--verbose",
      "--name=weather",
    ]);
    expect(handle.image).toBe(IMAGE);
  });

  it.each([
    ["/opt/homebrew/bin/node", "node"],
    ["./node_modules/.bin/npx", "npx"],
    ["C:\\Program Files\\nodejs\\npm", "npm"],
    ["C:\\tools/bin\\node", "node"],
    ["node", "node"],
    ["npx", "npx"],
  ])(
    "command 가 경로(%s)면 컨테이너 안에서는 basename(%s)으로 실행하고 args 는 건드리지 않는다",
    async (command, expected) => {
      const args = ["/opt/homebrew/lib/server.mjs", "--path=C:\\x\\y", "a/b"];
      const { handle } = await started({ ...SPEC, target: { ...SPEC.target, command, args } });
      const launch = targetArgs(handle);
      expect(launch.slice(launch.indexOf(IMAGE) + 1)).toEqual([...STRACE, expected, ...args]);
    },
  );

  it("-w 가 SandboxSpec.cwd 다", async () => {
    const { handle } = await started();
    expect(valuesOf(targetArgs(handle), "-w")).toEqual(["/work/repo/examples/weather-server"]);
  });
});

describe("start: 네트워크와 gateway", () => {
  it("네트워크는 --internal 과 라벨 mcpeak.audit=1 로 만든다", async () => {
    const { handle, runs } = await started();
    expect(findRun(runs, "network", "create").args).toEqual([
      "network",
      "create",
      "--internal",
      "--label",
      "mcpeak.audit=1",
      `mcpeak-audit-${runIdOf(handle)}-net`,
    ]);
  });

  it("gateway 는 live·record·replay 모두 internal 과 bridge 에 붙는다(제어 포트 publish 는 internal 전용에서 되지 않는다)", async () => {
    const cases = [
      { mode: "live", fake: await started() },
      { mode: "record", fake: await started(RECORD) },
      { mode: "replay", fake: await started(REPLAY, { files: SESSION_FILES }) },
    ];
    for (const { mode, fake } of cases) {
      const prefix = `mcpeak-audit-${runIdOf(fake.handle)}-`;
      const create = findRun(fake.runs, "create");
      expect(valuesOf(create.args, "--network")).toEqual([`${prefix}net`]);
      expect(findRun(fake.runs, "network", "connect").args).toEqual([
        "network",
        "connect",
        "bridge",
        `${prefix}gateway`,
      ]);
      // 두 네트워크가 프로세스 시작 전에 붙어 있어야 게이트웨이가 자기 주소를 안다.
      const order = fake.runs.map((run) => run.args.slice(0, 2).join(" "));
      expect(order.indexOf("network connect")).toBeGreaterThan(order.indexOf("create --name"));
      expect(order.indexOf(`start ${prefix}gateway`)).toBeGreaterThan(
        order.indexOf("network connect"),
      );
      // 재생에서 상류에 접속하지 않는 것은 게이트웨이가 이 값을 보고 지킨다.
      expect(create.extraEnv?.MCPEAK_GATEWAY_MODE).toBe(mode);
    }
  });

  it("target 은 어느 모드에서도 internal 네트워크 하나에만 붙는다", async () => {
    const cases = [
      await started(),
      await started(RECORD),
      await started(REPLAY, { files: SESSION_FILES }),
    ];
    for (const fake of cases) {
      const target = `mcpeak-audit-${runIdOf(fake.handle)}-target`;
      expect(valuesOf(targetArgs(fake.handle), "--network")).toEqual([
        `mcpeak-audit-${runIdOf(fake.handle)}-net`,
      ]);
      expect(targetArgs(fake.handle)).not.toContain("bridge");
      expect(targetArgs(fake.handle)).not.toContain("-p");
      // 백엔드가 target 을 다른 네트워크에 붙이는 명령을 내지 않는다.
      for (const run of fake.runs.filter((found) => found.args[1] === "connect")) {
        expect(run.args).not.toContain(target);
      }
      const network = findRun(fake.runs, "network", "create").args;
      expect(count(network, "--internal")).toBe(1);
    }
  });

  it("gateway 의 cap 은 ALL 을 떨군 뒤 NET_BIND_SERVICE 하나만 더한다", async () => {
    const { handle, runs } = await started();
    const args = findRun(runs, "create").args;
    expect(valuesOf(args, "--cap-drop")).toEqual(["ALL"]);
    expect(valuesOf(args, "--cap-add")).toEqual(["NET_BIND_SERVICE"]);
    expect(args.indexOf("--cap-drop")).toBeLessThan(args.indexOf("--cap-add"));
    expect(count(args, "--read-only")).toBe(1);
    expect(valuesOf(args, "--tmpfs")).toEqual(["/tmp"]);
    expect(valuesOf(args, "--security-opt")).toEqual(["no-new-privileges"]);
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--rm");
    expect(valuesOf(args, "-v")).toEqual([]);
    expect(args.slice(args.indexOf(IMAGE))).toEqual([
      IMAGE,
      "node",
      "/opt/mcpeak/gateway/server.mjs",
    ]);
    expect(valuesOf(args, "--name")).toEqual([`mcpeak-audit-${runIdOf(handle)}-gateway`]);
  });

  it("제어 포트는 127.0.0.1 에만 publish 한다(0.0.0.0 이 argv 에 없다)", async () => {
    const { runs, fetches } = await started();
    const args = findRun(runs, "create").args;
    expect(valuesOf(args, "-p")).toEqual(["127.0.0.1::7000"]);
    expect(args).not.toContain("-P");
    expect(runs.flatMap((run) => run.args).join(" ")).not.toContain("0.0.0.0");
    for (const call of fetches) {
      expect(call.url.startsWith(`http://127.0.0.1:${CONTROL_PORT}/`)).toBe(true);
    }
  });

  it("베어러 토큰은 argv 에 없고 extraEnv 로만 간다", async () => {
    const { handle, runs, fetches } = await started();
    const create = findRun(runs, "create");
    const token = tokenOf(runs);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(valuesOf(create.args, "-e")).toEqual([
      "MCPEAK_GATEWAY_TOKEN",
      "MCPEAK_GATEWAY_INTERNAL_SUBNET",
      "MCPEAK_GATEWAY_MODE",
    ]);
    expect(create.extraEnv).toEqual({
      MCPEAK_GATEWAY_TOKEN: token,
      MCPEAK_GATEWAY_INTERNAL_SUBNET: "172.24.0.0/16",
      MCPEAK_GATEWAY_MODE: "live",
    });
    const everything = [...runs.flatMap((run) => run.args), ...targetArgs(handle)].join("\n");
    expect(everything).not.toContain(token);
    expect(Object.values(handle.launchEnv)).not.toContain(token);
    for (const call of fetches) expect(call.authorization).toBe(`Bearer ${token}`);
  });

  it("replay 인데 세션 파일을 못 읽으면 자원을 만들기 전에 SANDBOX_SESSION_UNREADABLE", async () => {
    const { thrown, log } = await startFailure(REPLAY, {});
    expect(thrown).toBeInstanceOf(AuditError);
    expect((thrown as AuditError).code).toBe("SANDBOX_SESSION_UNREADABLE");
    expect((thrown as AuditError).message).toBe(
      [
        "→ 세션 파일을 읽을 수 없습니다: /user/session.json",
        "→ ENOENT: no such file or directory, open '/user/session.json'",
        "해결: mcpeak audit --sandbox --sandbox-session /user/session.json 로 먼저 녹화하세요.",
      ].join("\n"),
    );
    expect(log).toEqual([]);
  });

  it("replay 의 세션 파일이 JSON 이 아니면 자원을 만들기 전에 SANDBOX_SESSION_UNREADABLE", async () => {
    const { thrown, log } = await startFailure(REPLAY, {
      files: { "/user/session.json": "{ 깨진 파일" },
    });
    expect((thrown as AuditError).code).toBe("SANDBOX_SESSION_UNREADABLE");
    expect((thrown as AuditError).message).toBe(
      [
        "→ 세션 파일을 읽을 수 없습니다: /user/session.json",
        "→ JSON 으로 읽을 수 없습니다.",
        "해결: mcpeak audit --sandbox --sandbox-session /user/session.json 로 먼저 녹화하세요.",
      ].join("\n"),
    );
    expect(log).toEqual([]);
  });

  it("gateway 가 세션을 거절하면(400) 만든 것을 치우고 그 원인 한 줄로 SANDBOX_SESSION_UNREADABLE", async () => {
    const { thrown, log } = await startFailure(REPLAY, {
      files: SESSION_FILES,
      onFetch: (call) =>
        call.method === "POST" && call.path === "/session"
          ? json({ error: "entries[0].key.port 가 숫자가 아닙니다" }, 400)
          : undefined,
    });
    expect((thrown as AuditError).code).toBe("SANDBOX_SESSION_UNREADABLE");
    expect((thrown as AuditError).message).toBe(
      [
        "→ 세션 파일을 읽을 수 없습니다: /user/session.json",
        "→ entries[0].key.port 가 숫자가 아닙니다",
        "해결: mcpeak audit --sandbox --sandbox-session /user/session.json 로 먼저 녹화하세요.",
      ].join("\n"),
    );
    expect(log.slice(-4).map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
      "docker rm -f",
      "docker network rm",
      "docker volume rm",
      `removeDir ${TMP}`,
    ]);
  });

  it("준비 순서가 §3.7 그대로다: health 대기, GET /ca, POST /secrets, (재생이면) POST /session", async () => {
    let healthCalls = 0;
    const notReadyOnce = (call: FetchCall) => {
      if (call.path !== "/health") return undefined;
      healthCalls += 1;
      return healthCalls === 1 ? json({ ok: false }, 503) : undefined;
    };
    const live = await started(SPEC, { onFetch: notReadyOnce });
    expect(live.fetches.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /health",
      "GET /health",
      "GET /ca",
      "POST /secrets",
    ]);
    // 네트워크와 볼륨이 gateway 보다 먼저고, 첫 요청은 gateway 를 띄운 뒤다.
    const steps = live.log.map((line) => line.split(" ").slice(0, 3).join(" "));
    expect(steps.indexOf("docker network create")).toBeLessThan(
      steps.indexOf("docker create --name"),
    );
    expect(steps.indexOf("docker volume create")).toBeLessThan(
      steps.indexOf("docker create --name"),
    );
    expect(steps.indexOf("docker create --name")).toBeLessThan(steps.indexOf("fetch GET /health"));
    expect(live.writes.find((write) => write.path === `${TMP}/ca.pem`)?.content).toBe(
      "-----BEGIN CERTIFICATE-----\nFAKE\n",
    );

    const replay = await started(REPLAY, { files: SESSION_FILES });
    expect(replay.fetches.map((call) => `${call.method} ${call.path}`)).toEqual([
      "GET /health",
      "GET /ca",
      "POST /secrets",
      "POST /session",
    ]);
    expect(replay.fetches[3]?.body).toBe(SESSION_FILES["/user/session.json"]);
  });

  it("gateway 가 끝내 준비되지 않으면(100ms 간격 100번) 만든 것을 치우고 start-failed", async () => {
    vi.useFakeTimers();
    const fake = fakeIo({
      onFetch: (call) => (call.path === "/health" ? json({ ok: false }, 503) : undefined),
    });
    const outcome = createDockerBackend(fake.io, fakeParse)
      .start(SPEC)
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    await vi.runAllTimersAsync();
    expect(unavailableOf(await outcome)).toEqual({
      code: "start-failed",
      detail: "게이트웨이가 10초 안에 준비되지 않았습니다",
    });
    expect(fake.fetches).toHaveLength(100);
    expect(fake.log.at(-1)).toBe(`removeDir ${TMP}`);
  });

  it("POST /secrets 에 env 카나리·파일 카나리·전달 env 값이 전부 자리표와 함께 간다", async () => {
    const { fetches } = await started();
    const call = fetches.find((found) => found.path === "/secrets");
    expect(JSON.parse(call?.body ?? "")).toEqual({
      secrets: [
        { label: "<canary:MCPEAK_CANARY_AWS_SECRET_ACCESS_KEY>", value: ENV_CANARY },
        { label: "<canary:~/.aws/credentials>", value: FILE_CANARY },
        { label: "<env:API_KEY>", value: REAL_VALUE },
      ],
    });
  });

  it("임시 디렉터리의 홈 파일은 0644, 디렉터리는 0755 로 쓴다", async () => {
    // 디렉터리는 DockerIo 가 만든다(makeTempDir 과 writeFile 의 상위 디렉터리, 0755). 백엔드는
    // 홈 파일을 임시 디렉터리의 home/ 아래에만, HomePlan 의 모드 그대로 쓴다.
    const { writes, log } = await started();
    expect(log.filter((line) => line === "makeTempDir")).toHaveLength(1);
    expect(writes.filter((write) => write.path.startsWith(`${TMP}/home/`))).toEqual([
      {
        path: `${TMP}/home/.aws/credentials`,
        content: `[default]\naws_secret_access_key = ${FILE_CANARY}\n`,
        mode: 0o644,
      },
      { path: `${TMP}/home/.gitconfig`, content: "[user]\n  name = Jiwoo Kim\n", mode: 0o644 },
    ]);
    expect(writes.every((write) => write.path.startsWith(`${TMP}/`))).toBe(true);
    expect(writes.every((write) => write.mode === 0o644)).toBe(true);
  });

  it("record 면 snapshot 이 GET /session 의 내용을 사용자 경로에 0600 으로 쓴다", async () => {
    const { handle, writes, fetches } = await started(RECORD);
    expect(fetches.some((call) => call.method === "POST" && call.path === "/session")).toBe(false);
    const observation = await handle.snapshot();
    expect(observation.gaps).toEqual([]);
    expect(writes.at(-1)).toEqual({
      path: "/user/session.json",
      content: `${JSON.stringify(SESSION, null, 2)}\n`,
      mode: 0o600,
    });
  });

  it("live 와 replay 는 snapshot 에서 세션을 쓰지 않는다", async () => {
    for (const fake of [await started(), await started(REPLAY, { files: SESSION_FILES })]) {
      await fake.handle.snapshot();
      expect(fake.writes.some((write) => write.path === "/user/session.json")).toBe(false);
      expect(fake.fetches.some((call) => `${call.method} ${call.path}` === "GET /session")).toBe(
        false,
      );
    }
  });
});

describe("이름과 라벨", () => {
  it("컨테이너 둘, 네트워크, 볼륨의 이름이 mcpeak-audit-<runId>- 로 시작하고 전부 라벨이 붙는다", async () => {
    const { handle, runs } = await started();
    const prefix = `mcpeak-audit-${runIdOf(handle)}-`;
    const target = targetArgs(handle);
    const gateway = findRun(runs, "create").args;
    const network = findRun(runs, "network", "create").args;
    const volume = findRun(runs, "volume", "create").args;
    expect(valuesOf(target, "--name")).toEqual([`${prefix}target`]);
    expect(valuesOf(gateway, "--name")).toEqual([`${prefix}gateway`]);
    expect(network.at(-1)).toBe(`${prefix}net`);
    expect(volume.at(-1)).toBe(`${prefix}trace`);
    for (const args of [target, gateway, network, volume]) {
      expect(countPair(args, "--label", "mcpeak.audit=1")).toBe(1);
    }
  });

  it("random 이 다른 두 실행의 이름이 서로 다르다(동시 실행 충돌 방지)", async () => {
    const first = await started(SPEC, { seed: "aaaaaaaaaaaa" });
    const second = await started(SPEC, { seed: "bbbbbbbbbbbb" });
    expect(runIdOf(first.handle)).not.toBe(runIdOf(second.handle));
    expect(tokenOf(first.runs)).not.toBe(tokenOf(second.runs));
  });
});

describe("이미지", () => {
  it("docker image inspect 가 0 이면 build 를 부르지 않고 progress 도 없다", async () => {
    const { runs, progress } = await started();
    expect(findRun(runs, "image", "inspect").args).toEqual(["image", "inspect", IMAGE]);
    expect(runs.some((run) => run.args[0] === "build")).toBe(false);
    expect(progress).toEqual([]);
  });

  it("없으면 build 를 한 번 부르고 §6.4 문장을 progress 로 낸다", async () => {
    const { runs, progress } = await started(SPEC, {
      onRun: (args) =>
        args[0] === "image" ? { code: 1, stdout: "", stderr: "No such image" } : undefined,
    });
    expect(runs.filter((run) => run.args[0] === "build").map((run) => run.args)).toEqual([
      ["build", "-t", IMAGE, "/pkg/audit/sandbox"],
    ]);
    expect(progress).toEqual([
      `격리 이미지를 처음 만듭니다(${IMAGE}). 몇 분 걸릴 수 있습니다. 이때의 다운로드는 점검 대상 서버의 접속이 아닙니다.`,
    ]);
  });

  it("build 가 실패하면 image-build-failed 이고 detail 은 stderr 의 첫 줄", async () => {
    const { thrown, log } = await startFailure(SPEC, {
      onRun: (args) => {
        if (args[0] === "image") return { code: 1, stdout: "", stderr: "No such image" };
        if (args[0] === "build") {
          return {
            code: 1,
            stdout: "",
            stderr: "\nERROR: failed to solve: node:22-bookworm-slim: not found\n둘째 줄\n",
          };
        }
        return undefined;
      },
    });
    expect(unavailableOf(thrown)).toEqual({
      code: "image-build-failed",
      detail: "ERROR: failed to solve: node:22-bookworm-slim: not found",
    });
    // 이미지 단계에서는 아직 만든 자원이 없다.
    expect(log.some((line) => line.startsWith("docker network"))).toBe(false);
    expect(log).not.toContain("makeTempDir");
  });

  it("sandboxImageTag: 같은 내용이면 같은 태그, 파일 순서를 바꿔도 같다, 한 바이트 바꾸면 다르다", () => {
    const tag = sandboxImageTag(SOURCES);
    expect(tag).toMatch(/^[0-9a-f]{12}$/);
    expect(sandboxImageTag(SOURCES.map((file) => ({ ...file })))).toBe(tag);
    expect(sandboxImageTag([...SOURCES].reverse())).toBe(tag);
    expect(
      sandboxImageTag([
        SOURCES[0],
        { path: "gateway/server.mjs", content: "console.log('gatewaY');\n" },
      ] as typeof SOURCES),
    ).not.toBe(tag);
    // 경로와 내용의 경계가 달라지면 다른 태그다(이어 붙인 문자열이 같아도).
    expect(sandboxImageTag([{ path: "ab", content: "c" }])).not.toBe(
      sandboxImageTag([{ path: "a", content: "bc" }]),
    );
  });
});

describe("mark 와 snapshot", () => {
  it("mark 사이에 새로 생긴 trace 줄이 직전 단계에 붙는다(누적 줄 수로 자른다)", async () => {
    const { handle, state } = await started();
    const call = { kind: "call", toolIndex: 0, toolName: "ping", callId: "placeholder" } as const;
    state.trace = "/a\n/b\n";
    await handle.mark({ kind: "list" });
    state.trace = "/a\n/b\n/c\n";
    await handle.mark(call);
    state.trace = "/a\n/b\n/c\n/d\n/e\n";
    await handle.mark({ kind: "shutdown" });
    // 마지막 mark 뒤에 생긴 줄은 지금 단계에 붙는다. 개행으로 끝나지 않은 줄은 아직 세지 않는다.
    state.trace = "/a\n/b\n/c\n/d\n/e\n/f\n/쓰는 중";
    const observation = await handle.snapshot();
    expect(observation.events).toEqual([
      { kind: "open", phase: { kind: "start" }, path: "/a", write: false, result: "ok" },
      { kind: "open", phase: { kind: "start" }, path: "/b", write: false, result: "ok" },
      { kind: "open", phase: { kind: "list" }, path: "/c", write: false, result: "ok" },
      { kind: "open", phase: call, path: "/d", write: false, result: "ok" },
      { kind: "open", phase: call, path: "/e", write: false, result: "ok" },
      { kind: "open", phase: { kind: "shutdown" }, path: "/f", write: false, result: "ok" },
    ]);
    expect(observation.traceShrank).toBe(false);
    expect(observation.gaps).toEqual([]);
    // snapshot 은 상태를 바꾸지 않는다. 다시 불러도 같다.
    expect(await handle.snapshot()).toEqual(observation);
  });

  it("첫 mark 이전의 줄은 start 단계다", async () => {
    const { handle, state } = await started();
    state.trace = "/usr/local/bin/node\n";
    await handle.mark({ kind: "list" });
    const { events } = await handle.snapshot();
    expect(events.map((event) => event.phase)).toEqual([{ kind: "start" }]);
  });

  it("해석기는 단계마다 그 단계의 줄과 SandboxSpec.cwd 를 받는다", async () => {
    const fake = fakeIo();
    const seen: unknown[] = [];
    const parse: TraceParser = (lines, phase, cwd) => {
      seen.push({ lines, phase, cwd });
      return { events: [], unparsed: 0 };
    };
    const handle = await createDockerBackend(fake.io, parse).start(SPEC);
    fake.state.trace = "/a\n";
    await handle.mark({ kind: "list" });
    fake.state.trace = "/a\n/b\n";
    await handle.snapshot();
    expect(seen).toEqual([
      { lines: ["/a"], phase: { kind: "start" }, cwd: SPEC.cwd },
      { lines: ["/b"], phase: { kind: "list" }, cwd: SPEC.cwd },
    ]);
  });

  describe("mark 경계에 걸친 갈라진 줄", () => {
    const OPEN_HEAD = '17    openat(AT_FDCWD, "/a", O_RDONLY <unfinished ...>';
    const OPEN_TAIL = "17    <... openat resumed>)             = 3";
    const CONNECT_HEAD = "18    connect(5, {…}, 16 <unfinished ...>";
    const CONNECT_TAIL = "18    <... connect resumed>)            = 0";
    const CALL = { kind: "call", toolIndex: 0, toolName: "ping", callId: "placeholder" } as const;

    /** 해석기가 단계마다 받은 줄을 그대로 기록한다. */
    async function recording() {
      const fake = fakeIo();
      const seen: { phase: string; lines: readonly string[] }[] = [];
      const parse: TraceParser = (lines, phase) => {
        seen.push({ phase: phase.kind, lines });
        return { events: [], unparsed: 0 };
      };
      const handle = await createDockerBackend(fake.io, parse).start(SPEC);
      const feed = (lines: readonly string[]) => {
        fake.state.trace = `${lines.join("\n")}\n`;
      };
      return { handle, seen, feed };
    }

    it("짝이 아직 없는 <unfinished ...> 줄부터는 이번 단계에 붙이지 않고 다음 mark 로 미룬다", async () => {
      const { handle, seen, feed } = await recording();
      feed(["10    /x", OPEN_HEAD, "10    /y"]);
      await handle.mark({ kind: "list" });
      feed(["10    /x", OPEN_HEAD, "10    /y", OPEN_TAIL, "10    /z"]);
      await handle.mark(CALL);
      await handle.snapshot();
      expect(seen).toEqual([
        { phase: "start", lines: ["10    /x"] },
        // 반쪽과 그 뒤의 줄이 짝과 함께 한 단계에 온다. 순서는 trace 그대로다.
        { phase: "list", lines: [OPEN_HEAD, "10    /y", OPEN_TAIL, "10    /z"] },
      ]);
    });

    it("mark 가 반쪽 사이에 오든 뒤에 오든 해석기가 받는 줄 묶음에 반쪽만 남는 일이 없다", async () => {
      const all = ["10    /x", OPEN_HEAD, CONNECT_HEAD, OPEN_TAIL, CONNECT_TAIL, "10    /y"];
      for (let cut = 1; cut <= all.length; cut += 1) {
        const { handle, seen, feed } = await recording();
        feed(all.slice(0, cut));
        await handle.mark({ kind: "list" });
        feed(all);
        await handle.snapshot();
        expect(seen.flatMap((segment) => segment.lines)).toEqual(all);
        for (const { lines } of seen) {
          const heads = lines.filter((line) => line.endsWith("<unfinished ...>")).length;
          const tails = lines.filter((line) => line.includes("resumed>")).length;
          expect(heads).toBe(tails);
        }
      }
    });

    it("같은 PID 의 resumed 만 짝으로 본다", async () => {
      const { handle, seen, feed } = await recording();
      feed([OPEN_HEAD, CONNECT_HEAD, CONNECT_TAIL]);
      await handle.mark({ kind: "list" });
      feed([OPEN_HEAD, CONNECT_HEAD, CONNECT_TAIL, OPEN_TAIL]);
      await handle.snapshot();
      // 17 의 짝이 없으므로 그 줄부터 전부 미뤄졌다. 18 의 짝이 있어도 앞의 줄을 넘어가지 않는다.
      expect(seen).toEqual([
        { phase: "list", lines: [OPEN_HEAD, CONNECT_HEAD, CONNECT_TAIL, OPEN_TAIL] },
      ]);
    });

    it("짝이 다 있으면 미루지 않는다", async () => {
      const { handle, seen, feed } = await recording();
      feed([OPEN_HEAD, OPEN_TAIL, "10    /y"]);
      await handle.mark({ kind: "list" });
      await handle.snapshot();
      expect(seen).toEqual([{ phase: "start", lines: [OPEN_HEAD, OPEN_TAIL, "10    /y"] }]);
    });

    it("한 번 미룬 줄은 다음 mark 에서도 짝이 없으면 더 미루지 않는다(끝나지 않는 호출이 뒤의 관측을 붙잡지 않게)", async () => {
      const { handle, seen, feed } = await recording();
      feed(["10    /x", OPEN_HEAD, "10    /y"]);
      await handle.mark({ kind: "list" });
      feed(["10    /x", OPEN_HEAD, "10    /y", "10    /z", CONNECT_HEAD]);
      await handle.mark(CALL);
      feed(["10    /x", OPEN_HEAD, "10    /y", "10    /z", CONNECT_HEAD, CONNECT_TAIL]);
      await handle.mark({ kind: "shutdown" });
      await handle.snapshot();
      expect(seen).toEqual([
        { phase: "start", lines: ["10    /x"] },
        // 17 은 한 번 미뤘으니 놓는다. 새로 온 18 의 반쪽은 처음이라 미룬다.
        { phase: "list", lines: [OPEN_HEAD, "10    /y", "10    /z"] },
        { phase: "call", lines: [CONNECT_HEAD, CONNECT_TAIL] },
      ]);
    });

    it("snapshot 에서도 짝을 못 찾은 줄은 버리지 않고 지금 단계로 해석기에 넘긴다", async () => {
      const { handle, seen, feed } = await recording();
      feed(["10    /x", OPEN_HEAD, "10    /y"]);
      await handle.mark({ kind: "shutdown" });
      const first = await handle.snapshot();
      expect(seen).toEqual([
        { phase: "start", lines: ["10    /x"] },
        { phase: "shutdown", lines: [OPEN_HEAD, "10    /y"] },
      ]);
      // snapshot 은 상태를 바꾸지 않는다.
      seen.length = 0;
      expect(await handle.snapshot()).toEqual(first);
      expect(seen).toHaveLength(2);
    });

    it("미룬 줄이 있어도 traceShrank 는 누적 줄 수로 판정하고, 미룬 줄은 기록이 줄어도 남는다", async () => {
      const { handle, seen, feed } = await recording();
      feed(["10    /x", OPEN_HEAD, "10    /y"]);
      await handle.mark({ kind: "list" });
      // 같은 줄 수면 줄지 않은 것이다(미룬 줄 때문에 줄었다고 보지 않는다).
      await handle.mark(CALL);
      expect((await handle.snapshot()).traceShrank).toBe(false);
      feed(["10    /x"]);
      const observation = await handle.snapshot();
      expect(observation.traceShrank).toBe(true);
      expect(seen.at(-1)?.lines).toEqual([OPEN_HEAD, "10    /y"]);
    });

    it("실제 해석기와 함께: 경계에 걸려도 unparsedLines 가 0 이고 사건이 한 단계에 온다", async () => {
      const fake = fakeIo();
      const handle = await createDockerBackend(fake.io, parseTrace).start(SPEC);
      const head =
        '17    openat(AT_FDCWD, "/workspace/package.json", O_RDONLY|O_CLOEXEC <unfinished ...>';
      const tail = "17    <... openat resumed>)             = 19";
      fake.state.trace = `${head}\n`;
      await handle.mark({ kind: "list" });
      fake.state.trace = `${head}\n${tail}\n`;
      const observation = await handle.snapshot();
      expect(observation.unparsedLines).toBe(0);
      expect(observation.events).toEqual([
        {
          kind: "open",
          phase: { kind: "list" },
          path: "/workspace/package.json",
          write: false,
          result: "ok",
        },
      ]);
    });
  });

  it("mark 는 gateway 의 POST /phase 를 Authorization 과 함께 부른다", async () => {
    const { handle, fetches, runs, log } = await started();
    const phase = { kind: "call", toolIndex: 2, toolName: "read_note", callId: "path:traversal" };
    await handle.mark(phase as never);
    const call = fetches.at(-1);
    expect(call).toMatchObject({
      method: "POST",
      path: "/phase",
      authorization: `Bearer ${tokenOf(runs)}`,
    });
    expect(JSON.parse(call?.body ?? "")).toEqual({ phase });
    // 게이트웨이가 진행 중 요청을 비운 뒤에 trace 를 읽는다.
    expect(log.at(-2)).toBe("fetch POST /phase");
    expect(log.at(-1)?.startsWith("docker run --rm")).toBe(true);
  });

  it("trace 는 볼륨을 :ro 로 붙인 --rm --network none 컨테이너의 cat 으로 읽는다(docker exec·docker cp 를 쓰지 않는다)", async () => {
    const { handle, runs } = await started();
    await handle.mark({ kind: "list" });
    await handle.snapshot();
    await handle.destroy();
    const readers = runs.filter((run) => run.args[0] === "run");
    expect(readers).toHaveLength(2);
    for (const reader of readers) {
      const args = reader.args;
      expect(count(args, "--rm")).toBe(1);
      expect(valuesOf(args, "--network")).toEqual(["none"]);
      expect(valuesOf(args, "-v")).toEqual([`mcpeak-audit-${runIdOf(handle)}-trace:/v:ro`]);
      expect(args.slice(args.indexOf(IMAGE))).toEqual([IMAGE, "cat", "/v/trace"]);
      // 서버가 건드릴 수 있는 파일을 읽으므로 읽는 쪽도 권한을 다 떨군다.
      expect(count(args, "--read-only")).toBe(1);
      expect(valuesOf(args, "--cap-drop")).toEqual(["ALL"]);
      expect(valuesOf(args, "--user")).toEqual(["1000:1000"]);
      expect(countPair(args, "--label", "mcpeak.audit=1")).toBe(1);
    }
    const verbs = runs.map((run) => run.args[0]);
    expect(verbs).not.toContain("exec");
    expect(verbs).not.toContain("cp");
  });

  it("누적 줄 수가 직전 mark 보다 줄면 traceShrank 가 true 다", async () => {
    const { handle, state } = await started();
    state.trace = "/a\n/b\n/c\n";
    await handle.mark({ kind: "list" });
    state.trace = "/a\n";
    await handle.mark({ kind: "shutdown" });
    state.trace = "/a\n/z\n";
    const observation = await handle.snapshot();
    expect(observation.traceShrank).toBe(true);
    // 줄기 전에 읽은 관측은 남고, 준 뒤에 새로 붙은 줄만 더해진다.
    expect(observation.events.map((event) => (event.kind === "open" ? event.path : ""))).toEqual([
      "/a",
      "/b",
      "/c",
      "/z",
    ]);
  });

  it("마지막 mark 뒤에 줄어도 snapshot 이 traceShrank 를 세운다", async () => {
    const { handle, state } = await started();
    state.trace = "/a\n/b\n";
    await handle.mark({ kind: "shutdown" });
    state.trace = "";
    expect((await handle.snapshot()).traceShrank).toBe(true);
  });

  it("trace 를 못 읽으면 던지지 않고 gaps 에 source trace 로 적는다", async () => {
    const { handle } = await started(SPEC, {
      onRun: (args) =>
        args.includes("cat")
          ? { code: 1, stdout: "", stderr: "cat: /v/trace: No such file or directory\n" }
          : undefined,
    });
    const observation = await handle.snapshot();
    expect(observation.events).toEqual([]);
    expect(observation.gaps).toEqual([
      { source: "trace", reason: "cat: /v/trace: No such file or directory" },
    ]);
  });

  it("mark 에서 trace 를 못 읽은 것도 던지지 않고 snapshot 의 gaps 에 남는다", async () => {
    let fail = true;
    const { handle, state } = await started(SPEC, {
      onRun: (args) => {
        if (!args.includes("cat") || !fail) return undefined;
        throw new Error("docker run 이 30000ms 안에 끝나지 않았습니다");
      },
    });
    await handle.mark({ kind: "list" });
    fail = false;
    state.trace = "/a\n";
    const observation = await handle.snapshot();
    expect(observation.events).toHaveLength(1);
    expect(observation.gaps).toEqual([
      { source: "trace", reason: "docker run 이 30000ms 안에 끝나지 않았습니다" },
    ]);
  });

  it("해석기가 던지면 gaps 에 source trace 로 적는다", async () => {
    const fake = fakeIo();
    const handle = await createDockerBackend(fake.io, () => {
      throw new Error("not implemented");
    }).start(SPEC);
    fake.state.trace = "/a\n";
    const observation = await handle.snapshot();
    expect(observation.events).toEqual([]);
    expect(observation.gaps).toEqual([
      { source: "trace", reason: "시스템 콜 기록을 해석하지 못했습니다: not implemented" },
    ]);
  });

  it("해석하지 못한 줄 수의 합을 unparsedLines 에 싣는다(gaps 에는 싣지 않는다). 없으면 0 이다", async () => {
    const { handle, state } = await started();
    expect((await handle.snapshot()).unparsedLines).toBe(0);
    state.trace = "/a\n?? 모르는 줄\n";
    await handle.mark({ kind: "list" });
    state.trace = "/a\n?? 모르는 줄\n?? 또 모르는 줄\n";
    const observation = await handle.snapshot();
    expect(observation.events).toHaveLength(1);
    expect(observation.unparsedLines).toBe(2);
    expect(observation.gaps).toEqual([]);
  });

  it("gateway 가 답하지 않으면 gaps 에 source gateway 로 적는다", async () => {
    const { handle, state } = await started(SPEC, {
      onFetch: (call) => {
        if (call.path !== "/observation") return undefined;
        throw new TypeError("fetch failed");
      },
    });
    state.trace = "/a\n";
    const observation = await handle.snapshot();
    expect(observation.requests).toEqual([]);
    expect(observation.tlsRejections).toEqual([]);
    expect(observation.dnsNames).toEqual([]);
    expect(observation.gaps).toEqual([{ source: "gateway", reason: "fetch failed" }]);
    // 한쪽을 못 읽어도 다른 쪽 관측은 남는다.
    expect(observation.events).toHaveLength(1);
  });

  it("gateway 의 관측이 형식에 맞지 않으면 gaps 에 source gateway 로 적는다", async () => {
    const { handle, state } = await started();
    state.observation = { requests: "아님" };
    expect((await handle.snapshot()).gaps).toEqual([
      { source: "gateway", reason: "게이트웨이의 관측 응답이 형식에 맞지 않습니다" },
    ]);
  });

  it("mark 의 POST /phase 가 실패해도 던지지 않고 gaps 에 source gateway 로 남는다", async () => {
    const { handle } = await started(SPEC, {
      onFetch: (call) => (call.path === "/phase" ? json({ error: "bad" }, 500) : undefined),
    });
    await handle.mark({ kind: "list" });
    expect((await handle.snapshot()).gaps).toEqual([
      { source: "gateway", reason: "단계를 알리지 못했습니다(POST /phase 가 HTTP 500)" },
    ]);
  });

  it("gateway 의 요청·이름·TLS 거부 기록을 받은 순서 그대로 싣는다", async () => {
    const { handle, state } = await started();
    const phase = { kind: "list" };
    const request = {
      phase,
      scheme: "https",
      host: "api.example.com",
      port: 443,
      method: "POST",
      path: "/v1/x",
      headers: [["content-type", "application/json"]],
      bodyBase64: "e30=",
      bodyTruncated: false,
      served: "live",
    };
    state.observation = {
      requests: [request, { ...request, host: "b.example.com" }],
      tlsRejections: [{ phase, host: "pinned.example.com" }],
      dnsNames: [{ phase, name: "api.example.com" }],
    };
    const observation = await handle.snapshot();
    expect(observation.requests).toEqual([request, { ...request, host: "b.example.com" }]);
    expect(observation.tlsRejections).toEqual([{ phase, host: "pinned.example.com" }]);
    expect(observation.dnsNames).toEqual([{ phase, name: "api.example.com" }]);
  });

  it("connect 사건의 gateway 주소가 '<gateway>' 로 바뀌어 있다", async () => {
    const { handle, state } = await started();
    state.trace = `connect ${GATEWAY_IP} 443\nconnect 172.24.0.25 80\nconnect 10.0.0.5 8080\n`;
    const { events } = await handle.snapshot();
    expect(events.map((event) => (event.kind === "connect" ? event.address : ""))).toEqual([
      "<gateway>",
      "172.24.0.25",
      "10.0.0.5",
    ]);
  });

  it("snapshot 결과에 runId, 컨테이너 이름, 임시 경로, 토큰이 어디에도 없다", async () => {
    let runId = "";
    let token = "";
    const fake = fakeIo({
      onRun: (args) =>
        args.includes("cat")
          ? {
              code: 125,
              stdout: "",
              stderr: `docker: Error response from daemon: mcpeak-audit-${runId}-trace 를 mcpeak-audit-${runId}-target 이 쓰는 중 (${TMP}/home, mcpeak-audit-${runId}-net, mcpeak-audit-${runId})\n`,
            }
          : undefined,
      onFetch: (call) => {
        if (call.path !== "/observation") return undefined;
        throw new Error(
          `connect ECONNREFUSED 127.0.0.1:${CONTROL_PORT} (Bearer ${token}, ${GATEWAY_IP}, mcpeak-audit-${runId}-gateway)`,
        );
      },
    });
    const handle = await createDockerBackend(fake.io, fakeParse).start(SPEC);
    runId = runIdOf(handle);
    token = tokenOf(fake.runs);
    const observation = await handle.snapshot();
    expect(observation.gaps).toEqual([
      {
        source: "trace",
        reason:
          "docker: Error response from daemon: <volume> 를 <container> 이 쓰는 중 (<tmp>/home, <network>, <run>)",
      },
      {
        source: "gateway",
        reason: "connect ECONNREFUSED <control> (Bearer <token>, <gateway>, <container>)",
      },
    ]);
    const text = JSON.stringify(observation);
    for (const secret of [runId, token, TMP, CONTROL_PORT, GATEWAY_IP, "mcpeak-audit-"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("요청 기록의 host·path·헤더 값에 실린 gateway 주소도 '<gateway>' 로 바뀐다", async () => {
    const { handle, state } = await started();
    const phase = { kind: "list" };
    state.observation = {
      requests: [
        {
          phase,
          scheme: "http",
          host: GATEWAY_IP,
          port: 80,
          method: "GET",
          path: `/?from=${GATEWAY_IP}`,
          headers: [["host", GATEWAY_IP]],
          bodyBase64: "",
          bodyTruncated: false,
          served: "blocked",
        },
      ],
      tlsRejections: [{ phase, host: GATEWAY_IP }],
      dnsNames: [{ phase, name: "api.example.com" }],
    };
    const observation = await handle.snapshot();
    expect(JSON.stringify(observation)).not.toContain(GATEWAY_IP);
    expect(observation.requests[0]).toMatchObject({
      host: "<gateway>",
      path: "/?from=<gateway>",
      headers: [["host", "<gateway>"]],
    });
    expect(observation.tlsRejections[0]?.host).toBe("<gateway>");
  });
});

describe("destroy", () => {
  it("컨테이너 둘, 네트워크, 볼륨, 임시 디렉터리를 이 순서로 지운다", async () => {
    const { handle, log } = await started();
    const before = log.length;
    await handle.destroy();
    const prefix = `mcpeak-audit-${runIdOf(handle)}-`;
    expect(log.slice(before)).toEqual([
      `docker rm -f ${prefix}target`,
      `docker rm -f ${prefix}gateway`,
      `docker network rm ${prefix}net`,
      `docker volume rm ${prefix}trace`,
      `removeDir ${TMP}`,
    ]);
  });

  it("두 번 불러도 두 번째는 아무 명령도 실행하지 않는다", async () => {
    const { handle, log } = await started();
    await handle.destroy();
    const after = log.length;
    await handle.destroy();
    expect(log).toHaveLength(after);
  });

  it("이미 없는 컨테이너·네트워크·볼륨은 치운 것으로 본다(target 을 띄우기 전에 끝난 실행)", async () => {
    const { handle } = await started(SPEC, {
      onRun: (args) => {
        if (args[0] === "rm") {
          return { code: 1, stdout: "", stderr: `Error: No such container: ${args[2]}` };
        }
        if (args[0] === "network" && args[1] === "rm") {
          return {
            code: 1,
            stdout: "",
            stderr: `Error response from daemon: network ${args[2]} not found`,
          };
        }
        if (args[0] === "volume" && args[1] === "rm") {
          return {
            code: 1,
            stdout: "",
            stderr: `Error response from daemon: get ${args[2]}: no such volume`,
          };
        }
        return undefined;
      },
    });
    await expect(handle.destroy()).resolves.toBeUndefined();
  });

  it("컨테이너 삭제가 실패해도 네트워크·볼륨·임시 디렉터리 삭제를 시도한 뒤 SANDBOX_CLEANUP_FAILED", async () => {
    const { handle, log } = await started(SPEC, {
      onRun: (args) =>
        args[0] === "rm"
          ? { code: 1, stdout: "", stderr: "Error response from daemon: removal in progress\n" }
          : undefined,
    });
    const before = log.length;
    const error = await handle.destroy().then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(AuditError);
    expect((error as AuditError).code).toBe("SANDBOX_CLEANUP_FAILED");
    expect(log.slice(before).map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
      "docker rm -f",
      "docker rm -f",
      "docker network rm",
      "docker volume rm",
      `removeDir ${TMP}`,
    ]);
    // 다시 부르면 남은 것(컨테이너 둘)만 다시 시도한다.
    const retried = log.length;
    await handle.destroy().catch(() => undefined);
    expect(log.slice(retried).map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
      "docker rm -f",
      "docker rm -f",
    ]);
  });

  it("오류 문장이 §6.3 과 글자 단위로 같고 남은 것만 센다", async () => {
    const HINT =
      "해결: docker rm -f $(docker ps -aq --filter label=mcpeak.audit=1) , docker network prune -f --filter label=mcpeak.audit=1, docker volume rm $(docker volume ls -q --filter label=mcpeak.audit=1) 로 직접 치우세요.";
    const messageOf = async (options: FakeOptions) => {
      const { handle } = await started(SPEC, options);
      const error = await handle.destroy().then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      return (error as AuditError).message;
    };

    const gatewayAndNetwork = await messageOf({
      onRun: (args) => {
        if (args[0] === "rm" && args[2]?.endsWith("-gateway")) {
          return {
            code: 1,
            stdout: "",
            stderr: "\nError response from daemon: removal in progress\n둘째 줄",
          };
        }
        if (args[0] === "network" && args[1] === "rm") {
          return {
            code: 1,
            stdout: "",
            stderr: "Error response from daemon: has active endpoints",
          };
        }
        return undefined;
      },
    });
    expect(gatewayAndNetwork).toBe(
      [
        "→ 격리 자원을 다 치우지 못했습니다: 컨테이너 1개, 네트워크 1개",
        "→ Error response from daemon: removal in progress",
        HINT,
      ].join("\n"),
    );

    const everything = await messageOf({
      onRun: (args) =>
        args.includes("rm") ? { code: 1, stdout: "", stderr: "daemon is busy" } : undefined,
      removeDirFails: "EACCES: permission denied",
    });
    expect(everything).toBe(
      [
        "→ 격리 자원을 다 치우지 못했습니다: 컨테이너 2개, 네트워크 1개, 볼륨 1개, 임시 디렉터리 1개",
        "→ daemon is busy",
        HINT,
      ].join("\n"),
    );

    const tmpOnly = await messageOf({
      removeDirFails: `EACCES: permission denied, rmdir '${TMP}'`,
    });
    expect(tmpOnly).toBe(
      [
        "→ 격리 자원을 다 치우지 못했습니다: 임시 디렉터리 1개",
        `→ EACCES: permission denied, rmdir '${TMP}'`,
        HINT,
      ].join("\n"),
    );
  });

  it("start 가 gateway 실행에서 실패하면 그때까지 만든 네트워크와 임시 디렉터리를 치우고 start-failed 를 던진다", async () => {
    const { thrown, log } = await startFailure(SPEC, {
      onRun: (args) =>
        args[0] === "create"
          ? { code: 125, stdout: "", stderr: "docker: Error response from daemon: no space left\n" }
          : undefined,
    });
    expect(thrown).toBeInstanceOf(Error);
    expect(unavailableOf(thrown)).toEqual({
      code: "start-failed",
      detail: "docker: Error response from daemon: no space left",
    });
    const tail = log.slice(log.findIndex((line) => line.startsWith("docker create")) + 1);
    expect(tail.map((line) => line.split(" ").slice(0, 3).join(" "))).toEqual([
      "docker rm -f",
      "docker network rm",
      "docker volume rm",
      `removeDir ${TMP}`,
    ]);
    // target 은 아직 누구도 띄우지 않았다. gateway 는 반쯤 만들어졌을 수 있어 지운다.
    expect(tail[0]?.endsWith("-gateway")).toBe(true);
  });

  it("start 가 네트워크 생성에서 실패하면 임시 디렉터리만 치운다", async () => {
    const { thrown, log } = await startFailure(SPEC, {
      onRun: (args) =>
        args[0] === "network" && args[1] === "create"
          ? {
              code: 1,
              stdout: "",
              stderr: "Error response from daemon: could not find an available subnet",
            }
          : undefined,
    });
    expect(unavailableOf(thrown).code).toBe("start-failed");
    const tail = log.slice(log.findIndex((line) => line.startsWith("docker network create")) + 1);
    expect(tail).toEqual([`removeDir ${TMP}`]);
  });

  it("start 가 실패했는데 정리도 실패하면 detail 이 그것을 말한다", async () => {
    const { thrown } = await startFailure(SPEC, {
      onRun: (args) => {
        if (args[0] === "create") return { code: 125, stdout: "", stderr: "no space left" };
        if (args[0] === "volume" && args[1] === "rm") {
          return { code: 1, stdout: "", stderr: "volume is in use" };
        }
        return undefined;
      },
    });
    expect(unavailableOf(thrown)).toEqual({
      code: "start-failed",
      detail: "no space left (격리 자원도 다 치우지 못했습니다: 볼륨 1개)",
    });
  });

  it("start-failed 의 detail 에서 컨테이너·네트워크 이름과 임시 경로가 자리표로 바뀌어 있다", async () => {
    const { thrown } = await startFailure(SPEC, {
      onRun: (args) => {
        if (args[0] !== "create") return undefined;
        const name = args[args.indexOf("--name") + 1] ?? "";
        const network = args[args.indexOf("--network") + 1] ?? "";
        return {
          code: 125,
          stdout: "",
          stderr: `docker: Error response from daemon: Conflict. The container name "/${name}" is already in use on ${network} (${TMP}/home).\nSee 'docker run --help'.\n`,
        };
      },
    });
    const { detail } = unavailableOf(thrown);
    expect(detail).toBe(
      'docker: Error response from daemon: Conflict. The container name "/<container>" is already in use on <network> (<tmp>/home).',
    );
    expect(detail).not.toContain("mcpeak-audit-");
    expect((thrown as Error).message).not.toContain("mcpeak-audit-");
  });

  it("제어 포트가 publish 되지 않으면(포트 없음) 만든 것을 치우고 start-failed", async () => {
    const { thrown, log } = await startFailure(SPEC, {
      onRun: (args) =>
        args[0] === "inspect"
          ? {
              code: 0,
              stdout: JSON.stringify({
                Ports: { "7000/tcp": [] },
                Networks: { x: { IPAddress: GATEWAY_IP } },
              }),
              stderr: "",
            }
          : undefined,
    });
    expect(unavailableOf(thrown)).toEqual({
      code: "start-failed",
      detail: "게이트웨이의 주소나 제어 포트를 읽지 못했습니다",
    });
    expect(log.at(-1)).toBe(`removeDir ${TMP}`);
  });
});
