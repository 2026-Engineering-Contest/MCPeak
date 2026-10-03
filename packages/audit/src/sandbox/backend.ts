import {
  AuditError,
  type AuditReport,
  type AuditTarget,
  type HomePlan,
  type Observation,
  type SandboxPhase,
  type SandboxUnavailable,
} from "../types.js";

/**
 * 격리 백엔드 인터페이스. Docker 가 첫 구현이고(`sandbox/docker.ts`), gVisor·Firecracker 는 같은
 * 인터페이스의 다른 구현으로 끼운다.
 */
export interface SandboxSpec {
  /** 사용자가 준 원래 대상. kind 는 "stdio" 다. */
  readonly target: AuditTarget;
  /** 컨테이너에 넘길 env 의 이름과 값. 카나리 env 와 --env 로 명시한 실제 값의 합이다. */
  readonly env: Readonly<Record<string, string>>;
  readonly mountRoot: string;
  readonly cwd: string;
  readonly home: HomePlan;
  readonly session?: { readonly mode: "record" | "replay"; readonly path: string };
}

export interface SandboxHandle {
  /** core.connectStdio 에 넘길 실행 대상. 규칙은 이것이 아니라 원래 target 을 본다. */
  readonly launchTarget: AuditTarget;
  /**
   * launchTarget 프로세스(docker CLI)의 env. 컨테이너에 넘길 값(SandboxSpec.env)과 docker CLI 가
   * 데몬을 찾는 데 필요한 호스트 변수(PATH, HOME, DOCKER_HOST, DOCKER_CONTEXT, DOCKER_CONFIG 중
   * 설정된 것)만 담는다. 뒤의 다섯은 `-e` 로 넘기지 않으므로 컨테이너에 들어가지 않는다.
   */
  readonly launchEnv: Readonly<Record<string, string>>;
  /** 이미지 태그. */
  readonly image: string;
  /** 지금부터의 관측을 이 단계에 붙인다. 직전 mark 이후의 시스템 콜 기록은 직전 단계에 붙는다. */
  mark(phase: SandboxPhase): Promise<void>;
  /** 지금까지의 관측 전부. 읽지 못한 관측원은 gaps 에 적는다. 던지지 않는다. */
  snapshot(): Promise<Observation>;
  /**
   * 컨테이너·네트워크·볼륨·임시 디렉터리를 전부 치운다. 여러 번 불러도 된다. 하나가 실패해도 나머지를
   * 끝까지 치운 뒤 AuditError("SANDBOX_CLEANUP_FAILED") 를 던진다.
   */
  destroy(): Promise<void>;
}

export interface SandboxBackend {
  readonly name: string;
  /** 격리 이미지가 실행할 수 있는 명령의 basename 목록. */
  readonly commands: readonly string[];
  detect(): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: SandboxUnavailable }
  >;
  /**
   * 이미지·네트워크·게이트웨이를 준비하고 target 컨테이너를 띄울 준비를 마친다. 실패하면 그때까지
   * 만든 자원을 스스로 치우고 `{ unavailable: SandboxUnavailable }` 를 가진 오류를 던진다.
   */
  start(spec: SandboxSpec): Promise<SandboxHandle>;
}

/**
 * 정리 실패. 리포트를 버리지 않으려고 오류에 리포트를 실어 던진다. CLI 는 리포트를 먼저 stdout 에
 * 내고 이 오류의 문장을 stderr 에 낸 뒤 1 로 끝난다. 발견을 본 사용자가 정리 실패 때문에 그 발견을
 * 잃으면 안 된다.
 */
export class SandboxCleanupError extends AuditError {
  constructor(
    message: string,
    readonly report: AuditReport,
  ) {
    super("SANDBOX_CLEANUP_FAILED", message);
    this.name = "SandboxCleanupError";
  }
}
