import { existsSync } from "node:fs";
import type {
  ExternalCoordinatorHandle,
  SessionOrigin,
  SessionSummary,
} from "@mcpeak/record/external";

/**
 * `@mcpeak/record/external` 은 **세션 옵션을 실제로 쓸 때만** 불러온다.
 *
 * 정적 import 로 두면 `node:sqlite` 가 CLI 를 띄우는 것만으로 로드되고, Node 22.x 는 그때
 * `ExperimentalWarning: SQLite is an experimental feature` 를 stderr 에 찍는다. 세션을 쓰지도
 * 않은 `mcpeak test` 실행마다 그 줄이 붙는다 — 터미널 출력이 곧 UI 인 도구에서 그냥 손해다.
 * (실제로 `dist-cli-e2e` 의 "stderr 가 비어 있다" 단언이 이걸 잡았다.)
 *
 * 지연 로딩이면 경고를 보는 사람은 External 을 직접 켠 사용자뿐이다. 그 경고를 아예 지울지는
 * ADR-0054 가 남겨 둔 별도 결정이며, 라이브러리가 아니라 CLI 가 정할 몫이다.
 */
const loadExternal = () => import("@mcpeak/record/external");

/**
 * 시험 실행에 External Record/Replay 를 배선한다.
 *
 * 제거된 Tool 카세트 배선과 달리(ADR-0051), 이쪽은 감쌀 것이 없다 — 자식 프로세스에 넘길
 * **환경 변수만** 만든다.
 * 가로채는 지점이 부모의 클라이언트가 아니라 자식 안의 `fetch` 이기 때문이다.
 *
 * 그래서 이 배선의 산출물은 `env` 하나다. `connect` 가 그것을 자식에게 넘기면, Bootstrap 이
 * 사용자 코드보다 먼저 실려 `globalThis.fetch` 를 교체한다.
 */

export type ExternalMode = "record" | "replay";

export interface ExternalWiringOptions {
  readonly mode: ExternalMode;
  /** 세션 파일 경로. 파일 하나가 세션 하나다. */
  readonly sessionPath: string;
  /**
   * 녹화를 시작한 실행의 서버 명령·스위트(ADR-0085). 녹화에서만 의미가 있고, 세션 파일에
   * 함께 저장돼 재생이 세션 파일 하나로 시작할 수 있게 한다. 재생에서는 무시된다.
   */
  readonly origin?: SessionOrigin;
  /**
   * 호출자가 이미 쓰고 있는 `NODE_OPTIONS`. Coordinator 가 Bootstrap 주입을 여기에
   * **덧붙인다.** 덮어쓰면 사용자가 걸어 둔 다른 `--import` 나 힙 설정이 조용히 사라진다.
   */
  readonly existingNodeOptions?: string | undefined;
}

export interface ExternalWiring {
  /** `connect` 에 그대로 넘길 환경 변수. */
  readonly env: Readonly<Record<string, string>>;
  /**
   * 세션을 끝내고 저장 자원을 놓는다. **성공·실패 어느 경로에서도 반드시 부른다** — 안 부르면
   * SQLite 파일 핸들이 남고, Record 세션은 `running` 인 채로 남아 다음 실행이 이어 쓸 수 없다.
   *
   * 여러 번 불러도 안전하다.
   */
  finish(status: "completed" | "failed"): Promise<SessionSummary>;
}

/** 세션 파일 하나가 세션 하나이므로 식별자를 사용자에게 묻지 않는다. */
const SESSION_ID = "default";

/**
 * 재생할 세션 파일이 없을 때. **Store 를 열기 전에 던진다** — `node:sqlite` 의 `DatabaseSync`
 * 는 없는 경로를 만들어 버리므로, 열고 나서 판정하면 오타 한 번에 빈 DB 가 디스크에 남는다.
 * 그러면 두 번째 실행부터는 "파일이 없다" 가 거짓이 되어 진단이 또 어긋난다(#260).
 */
export class SessionFileMissingError extends Error {
  override readonly name = "SessionFileMissingError";

  constructor(readonly path: string) {
    super(`세션 파일이 없습니다: ${path}`);
  }
}

export async function startExternalWiring(options: ExternalWiringOptions): Promise<ExternalWiring> {
  // 재생은 읽기다. 없는 파일을 만들어 두고 "완료된 원본이 아니다" 라고 말하지 않는다.
  if (options.mode === "replay" && !existsSync(options.sessionPath))
    throw new SessionFileMissingError(options.sessionPath);

  const { createSqliteSessionStore, startExternalCoordinator } = await loadExternal();
  // 재생은 읽기다(#291). readOnly 를 안 넘기면 저장소가 스키마 DDL 을 무조건 심어, 읽기
  // 전용(chmod 444) 세션은 재생이 안 되고 0바이트 파일을 넘긴 실패한 실행이 그 파일을 빈
  // 세션 DB 로 덮어썼다 — 실패한 실행이 사용자 파일을 바꾸는 것이 결함의 핵심이었다.
  const store = createSqliteSessionStore({
    path: options.sessionPath,
    readOnly: options.mode === "replay",
  });

  let handle: ExternalCoordinatorHandle;
  try {
    handle =
      options.mode === "record"
        ? await startExternalCoordinator({
            mode: "record",
            sessionId: SESSION_ID,
            store,
            ...(options.origin === undefined ? {} : { origin: options.origin }),
            ...(options.existingNodeOptions === undefined
              ? {}
              : { existingNodeOptions: options.existingNodeOptions }),
          })
        : await startExternalCoordinator({
            mode: "replay",
            sourceSessionId: SESSION_ID,
            store,
            ...(options.existingNodeOptions === undefined
              ? {}
              : { existingNodeOptions: options.existingNodeOptions }),
          });
  } catch (error) {
    // Coordinator 가 못 뜨면 Store 만 열린 채 남는다. 파일 핸들을 붙든 채 죽지 않는다.
    store.close();
    throw error;
  }

  // 두 번째 호출은 첫 결과를 그대로 준다. Store 가 이미 닫혔으므로 `handle.finish` 를 다시
  // 부르면 닫힌 DB 를 건드린다. 호출자가 정상 경로와 실패 경로 양쪽에서 닫으려 하는 것은
  // 흔한 모양이라, 그쪽에 "이미 닫았나" 를 추적시키지 않는다.
  // **성공·실패와 무관하게** 한 번 시도했다는 사실을 먼저 기록한다. 성공했을 때만 기록하면
  // `handle.finish` 가 던진 뒤 `finally` 가 store 를 이미 닫은 상태에서 두 번째 호출이 가드를
  // 통과해, 닫힌 DB 위에서 다시 부른다 — 이 가드가 막으려던 바로 그 상황이다.
  let settled: Promise<SessionSummary> | undefined;
  return {
    env: handle.childEnvironment,
    finish(status) {
      settled ??= handle.finish(status).finally(() => store.close());
      return settled;
    },
  };
}
