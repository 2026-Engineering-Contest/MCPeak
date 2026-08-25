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
