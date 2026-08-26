/** 실행 도중 발생하는 이벤트 본문. RunRecord 경계에서 run별 id를 붙인다. */
export type RunEventInput =
  | { readonly kind: "stdout"; readonly html: string }
  | { readonly kind: "stderr"; readonly html: string }
  | { readonly kind: "question"; readonly question: PendingQuestion }
  | { readonly kind: "done"; readonly exitCode: number };

/** SSE `data:` 페이로드. id는 run 안에서 1부터 단조 증가하는 재연결 cursor다. */
export type RunEvent = RunEventInput & { readonly id: number };

/** 대화형 승인 질문. CLI 플로우가 순차적이므로 동시에 최대 1개만 pending이다. */
export type PendingQuestion =
  | { readonly id: string; readonly kind: "input"; readonly message: string }
  | {
      readonly id: string;
      readonly kind: "choose";
      readonly message: string;
      readonly choices: readonly string[];
    }
  | { readonly id: string; readonly kind: "confirm"; readonly message: string };

/** POST /api/runs — 어떤 플로우든 실행 시작은 이 하나로 받는다. */
export type StartRunRequest =
  | { readonly flow: "test"; readonly argv: readonly string[] }
  | { readonly flow: "generate"; readonly argv: readonly string[] }
  | { readonly flow: "repair"; readonly argv: readonly string[] };

export interface StartRunResponse {
  readonly runId: string;
}

export type RunStatus = "running" | "waiting-input" | "done" | "failed";

export interface RunSummary {
  readonly runId: string;
  readonly flow: StartRunRequest["flow"];
  readonly status: RunStatus;
  readonly exitCode: number | null;
  /** 시작 요청의 argv 그대로. 실행 뷰가 --repair-bundle 값을 여기서 읽는다(ADR-0080). */
  readonly argv: readonly string[];
}

/** POST /api/runs/:id/answer */
export type AnswerRequest =
  | {
      readonly questionId: string;
      /** input → 문자열, choose → 선택지 문자열 그대로, confirm → "y" | "n" */
      readonly value: string;
    }
  | {
      readonly questionId: string;
      /** 검토 메뉴에서 연 하위 입력을 취소하고 상위 메뉴로 돌아간다. */
      readonly action: "back";
    };

/**
 * GET /api/meta — 서버가 스위트를 찾는 기준 디렉터리(절대경로, 서버를 띄운 cwd).
 * `FileEntry.path` 가 이 경로 기준의 상대경로다. 첫 화면이 비는 이유는 거의 언제나
 * 이 값이라, 화면이 그것을 말하려면 클라이언트가 이 값을 알아야 한다(#296).
 */
export interface ServerMeta {
  readonly root: string;
}

/** GET /api/servers — 서버 후보 한 건. 파일을 읽어 만들며 서버를 실행하지 않는다(ADR-0079). */
export interface ServerCandidate {
  /** 같은 스캔이면 같은 값. `${source}:${path}:${name}`. */
  readonly id: string;
  /** `.mcp.json` 의 mcpServers 키 또는 package.json 의 bin 키. */
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly source: "mcp-config" | "package-bin";
  /** 후보를 읽은 파일의 루트 기준 상대경로(`/` 구분). */
  readonly path: string;
  /** `.mcp.json` 항목에 env 가 있었는지. 대시보드는 넘기지 못하므로 화면이 알린다. */
  readonly hasEnv: boolean;
}

/**
 * GET /api/sessions — 녹화본 한 건. 세션 파일 하나가 세션 하나다(CLI 가 `SESSION_ID` 를
 * 고정한다). 파일을 열어 읽으며 서버를 실행하지 않는다.
 *
 * `status` 는 record 의 `SessionStatus` 와 같은 값이지만 여기서 다시 적는다. web 이
 * `@mcpeak/record` 를 import 하지 않기 때문이며, `REPAIR_BUNDLE_DIR` 이 두 곳에 있는 것과
 * 같은 이유다.
 */
export interface SessionEntry {
  /** 루트 기준 상대경로(`/` 구분). 목록의 식별자이자 `--session` 에 실릴 값이다. */
  readonly path: string;
  /**
   * 녹화 상태. `completed` 가 아니면 재생이 거절되므로(`REPLAY_SOURCE_INVALID`), 실행해
   * 보고 알게 하지 않으려고 목록에 싣는다.
   */
  readonly status: "running" | "completed" | "failed";
  /** 녹화된 외부 호출 수. */
  readonly interactionCount: number;
  /**
   * **가장 먼저** 녹화된 시각(ISO 8601, UTC). 상호작용이 없으면 없다.
   *
   * 나이("12일 전")나 임계값 경고를 내지 않는다(ADR-0069) — 그러려면 지금 시각을 읽어야 하고,
   * 그러면 같은 목록이 날마다 달라진다. 낡았는지 판정하는 것은 사람의 몫으로 남긴다.
   */
  readonly recordedAt?: string;
  /**
   * 녹화를 시작한 실행의 서버 명령·스위트(ADR-0085). 원클릭 재생의 재료다.
   * **없을 수 있다** — store version 1 에 녹화된 세션에는 저장된 적이 없다.
   */
  readonly origin?: {
    readonly command: string;
    readonly args: readonly string[];
    readonly suitePath: string;
  };
}

/** 파일 리소스 공통. path는 프로젝트 루트 기준 상대경로다. */
export interface FileEntry {
  readonly path: string;
}

export interface FileContent {
  readonly path: string;
  readonly content: string;
  /** 저장 충돌 감지용. GET이 준 값을 PUT이 그대로 돌려보낸다. */
  readonly mtimeMs: number;
}

export interface PutFileRequest {
  readonly content: string;
  readonly baseMtimeMs: number;
}

export type PutFileResponse =
  | { readonly saved: true; readonly mtimeMs: number }
  | { readonly saved: false; readonly reason: "conflict"; readonly mtimeMs: number };

export interface ApiError {
  readonly error: string;
}
