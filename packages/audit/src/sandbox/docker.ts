import type { SandboxBackend } from "./backend.js";
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

/**
 * `parse` 를 주입으로 받는다. 이 백엔드의 테스트는 가짜 해석기를 쓰고, 실제 `parseTrace` 는 CLI
 * 배선이 넣는다. 본문은 T1 이 채운다.
 */
export function createDockerBackend(io: DockerIo, parse: TraceParser): SandboxBackend {
  throw new Error("not implemented");
}
