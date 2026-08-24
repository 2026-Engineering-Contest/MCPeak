/**
 * 연결 상실 판정 (이슈 #279 · ADR-0071).
 *
 * 서버가 죽으면 남은 케이스는 부를 대상이 없다. 그래도 계속 부르면 원인 1건이 실패 N건으로
 * 부풀고, 뒤따르는 실패는 전부 `Not connected` 복사본이 된다. 타임아웃은 이미 멈추는데
 * 프로세스 사망은 중단 사유에 없어서 안 멈췄다.
 *
 * 판정 재료는 `core` 가 이미 붙여 놓았다. 프로세스 종료를 관측한 뒤의 호출은 전부
 * `PROCESS_EXITED` 로 온다(`packages/core/src/index.ts` 의 operationFailureKind). SDK 가
 * 만드는 문장(`Connection closed` · `Not connected`)을 읽지 않는 이유가 이것이다. 그 문장은
 * SDK 판본을 따라 바뀌지만 코드는 우리 것이다.
 *
 * 서버를 부르지 않는 순수 함수다. 같은 오류에는 항상 같은 판정이 나온다.
 */

/** 연결이 끝나 남은 케이스를 부를 수 없는 사유. core 의 오류 코드를 러너 어휘로 좁힌 것이다. */
export type ConnectionLostCause = "processExited" | "transportFailed" | "httpSessionLost";

/** `stopReason` 에 그대로 펼쳐 넣는 모양. 키는 값이 있을 때만 만든다. */
export type ConnectionLoss = {
  cause: ConnectionLostCause;
  exitCode?: number;
  signal?: string;
};

/**
 * 멈춰야 하는 코드만 담는다. 셋 다 core 가 재연결하지 않는 종착 상태다 — `TRANSPORT_FAILED`
 * 는 transport 가 `failed` 로 넘어갔을 때만 나오고, `HTTP_SESSION_LOST` 는 core 자신이
 * "재연결은 지원하지 않으므로 다시 connect 하세요" 라고 안내한다.
 *
 * `OPERATION_FAILED` 는 여기 없다. 서버가 살아서 오류를 돌려준 것이므로 다음 케이스는
 * 여전히 유효하다. 여기서 멈추면 툴 하나가 오류를 낼 때마다 스위트가 통째로 안 돈다.
 *
 * 객체가 아니라 `Map` 이다. 코드 문자열은 우리가 만든 값이 아니라 오류에서 읽은 값이라,
 * 프로토타입 있는 객체로 두면 `toString` 같은 이름이 함수를 사유로 물고 들어온다.
 */
const CAUSE_BY_CODE: ReadonlyMap<string, ConnectionLostCause> = new Map([
  ["PROCESS_EXITED", "processExited"],
  ["TRANSPORT_FAILED", "transportFailed"],
  ["HTTP_SESSION_LOST", "httpSessionLost"],
] as const);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * 진단에서 종료 코드와 시그널만 꺼낸다. stderr 은 꺼내지 않는다 — 보고서에 서버 출력을 통째로
 * 싣게 되고, 그것은 `cli` 의 프로세스 진단 블록이 이미 하는 일이다.
 *
 * `transport` 태그가 없으면 stdio 로 본다. core 의 `tagDiagnostics` 와 같은 판단이다.
 * 타입이 어긋난 필드는 그 필드만 버린다. 사유까지 버리면 멈춰야 할 실행이 계속된다.
 */
const exitFields = (diagnostics: unknown): { exitCode?: number; signal?: string } => {
  if (!isObject(diagnostics)) return {};
  if ("transport" in diagnostics && diagnostics.transport !== "stdio") return {};
  const { exitCode, signal } = diagnostics;
  return {
    ...(typeof exitCode === "number" && Number.isInteger(exitCode) ? { exitCode } : {}),
    ...(typeof signal === "string" && signal !== "" ? { signal } : {}),
  };
};

/**
 * 오류가 "연결이 끝났다" 인지 판정한다. 아니면 `undefined`.
 *
 * `instanceof McpClientError` 를 쓰지 않는다. 러너가 받는 client 는 core 가 만든 것일 수도,
 * record 의 재생 client 나 목일 수도 있어 클래스 정체가 다르다. core 자신도 같은 이유로
 * 구조 검사를 쓴다(`packages/core/src/client.ts` 의 isCoreError).
 */
export function classifyConnectionLoss(error: unknown): ConnectionLoss | undefined {
  if (!isObject(error)) return undefined;
  const { code } = error;
  if (typeof code !== "string") return undefined;
  const cause = CAUSE_BY_CODE.get(code);
  if (cause === undefined) return undefined;
  return { cause, ...exitFields(error.diagnostics) };
}
