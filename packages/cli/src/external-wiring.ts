import type { ExternalCoordinatorHandle, SessionSummary } from "@mcpeak/record/external";

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
 * **`cassette-wiring.ts` 를 재사용하지 않는다**(ADR-0051). 그쪽은 `McpClient` 를 감싸 Tool
 * 호출을 가로채고, 이쪽은 감쌀 것이 없다 — 자식 프로세스에 넘길 **환경 변수만** 만든다.
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

export async function startExternalWiring(options: ExternalWiringOptions): Promise<ExternalWiring> {
  const { createSqliteSessionStore, startExternalCoordinator } = await loadExternal();
  const store = createSqliteSessionStore({ path: options.sessionPath });

  let handle: ExternalCoordinatorHandle;
  try {
    handle =
      options.mode === "record"
        ? await startExternalCoordinator({
            mode: "record",
            sessionId: SESSION_ID,
            store,
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
