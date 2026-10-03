import type { SandboxBackend, SandboxHandle, SandboxSpec } from "../../src/sandbox/backend.js";
import type {
  AuditTarget,
  Observation,
  SandboxPhase,
  SandboxUnavailable,
} from "../../src/types.js";

/**
 * 격리 백엔드의 테스트 대역. 실제 docker 를 부르지 않는다. 부른 메서드를 순서대로 `log` 에 적고
 * 정해 둔 `Observation` 을 돌려준다. `log` 는 밖에서 넘길 수 있어서, 연결 대역이 같은 배열에 적으면
 * 백엔드 호출과 연결 호출의 앞뒤를 한 줄로 단언할 수 있다.
 */
export interface FakeSandboxSetup {
  readonly name?: string;
  readonly commands?: readonly string[];
  readonly image?: string;
  /** 주면 detect 가 `{ ok: false, reason }` 을 돌려준다. */
  readonly detectFails?: SandboxUnavailable;
  /** 주면 start 가 이 오류를 던진다. */
  readonly startError?: unknown;
  /** snapshot 이 돌려줄 관측. spec 을 받아서 카나리 값이 실린 관측을 만들 수 있다. */
  readonly observe?: (spec: SandboxSpec, marks: readonly SandboxPhase[]) => Observation;
  /** 주면 destroy 가 이 오류를 던진다. */
  readonly destroyError?: unknown;
  readonly log?: string[];
}

export interface FakeSandbox {
  readonly backend: SandboxBackend;
  /** `detect`, `start`, `mark:<단계>:start`, `mark:<단계>:end`, `snapshot`, `destroy` 가 부른 순서대로. */
  readonly log: string[];
  readonly specs: SandboxSpec[];
  readonly marks: SandboxPhase[];
  readonly count: (entry: string) => number;
}

/** 실행마다 달라지는 값의 표본. 리포트에 새면 안 되는 것들이다. */
export const FAKE_RUN_ID = "5f3a9c1e7b2d4a68";
export const FAKE_TMP_DIR = `/tmp/mcpeak-audit-sandbox-${FAKE_RUN_ID}`;
export const FAKE_CONTAINER = `mcpeak-audit-${FAKE_RUN_ID}-target`;
export const FAKE_IMAGE = "mcpeak-audit-sandbox:0123456789ab";

export const FAKE_LAUNCH_TARGET: AuditTarget = {
  kind: "stdio",
  command: "docker",
  args: [
    "run",
    "-i",
    "--name",
    FAKE_CONTAINER,
    "--network",
    `mcpeak-audit-${FAKE_RUN_ID}-net`,
    "--env-file",
    `${FAKE_TMP_DIR}/target.env`,
    FAKE_IMAGE,
    "strace",
    "node",
    "server.js",
  ],
  forwardedEnvNames: [],
  headerNames: [],
};

export function emptyObservation(overrides: Partial<Observation> = {}): Observation {
  return {
    events: [],
    requests: [],
    tlsRejections: [],
    dnsNames: [],
    traceShrank: false,
    gaps: [],
    unparsedLines: 0,
    ...overrides,
  };
}

export const phaseLabel = (phase: SandboxPhase): string =>
  phase.kind === "call" ? `call:${phase.toolIndex}:${phase.toolName}:${phase.callId}` : phase.kind;

/** 마이크로태스크 몇 번을 양보한다. 직렬이 아니면 이 틈에 다음 호출이 끼어든다. */
async function yieldTicks(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
}

export function fakeSandbox(setup: FakeSandboxSetup = {}): FakeSandbox {
  const log = setup.log ?? [];
  const specs: SandboxSpec[] = [];
  const marks: SandboxPhase[] = [];

  const backend: SandboxBackend = {
    name: setup.name ?? "docker",
    commands: setup.commands ?? ["node", "npx", "npm"],
    async detect() {
      log.push("detect");
      return setup.detectFails === undefined
        ? { ok: true }
        : { ok: false, reason: setup.detectFails };
    },
    async start(spec): Promise<SandboxHandle> {
      log.push("start");
      specs.push(spec);
      if (setup.startError !== undefined) throw setup.startError;
      return {
        launchTarget: FAKE_LAUNCH_TARGET,
        launchEnv: { ...spec.env, PATH: "/usr/bin", DOCKER_HOST: "unix:///var/run/docker.sock" },
        image: setup.image ?? FAKE_IMAGE,
        async mark(phase) {
          log.push(`mark:${phaseLabel(phase)}:start`);
          await yieldTicks();
          marks.push(phase);
          log.push(`mark:${phaseLabel(phase)}:end`);
        },
        async snapshot() {
          log.push("snapshot");
          return setup.observe?.(spec, marks) ?? emptyObservation();
        },
        async destroy() {
          log.push("destroy");
          if (setup.destroyError !== undefined) throw setup.destroyError;
        },
      };
    },
  };

  return {
    backend,
    log,
    specs,
    marks,
    count: (entry) => log.filter((line) => line === entry).length,
  };
}
