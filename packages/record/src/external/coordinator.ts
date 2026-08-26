import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRecordEngine, createReplayEngine, type ExternalEngine } from "./engine.js";
import { ExternalRecordReplayError, externalError } from "./errors.js";
import {
  type BodyUrlFingerprints,
  type CompleteRecordRequest,
  DEFAULT_COORDINATOR_TIMEOUT_MS,
  HTTP_INTERACTION_SCHEMA_VERSION,
  type HttpFailureCode,
  type HttpFailureKind,
  type HttpFailureName,
  MAX_BODY_URL_FINGERPRINTS,
  MAX_COORDINATOR_PAYLOAD_BYTES,
  type NormalizedExternalRequest,
  PROTOCOL_SCHEMA_VERSION,
  type StoredExternalOutcome,
  type StoredHttpResponse,
  type StoredHttpThrow,
} from "./protocol.js";
import {
  redactNormalizedRequest,
  redactStoredOutcome,
  SUPPORTED_HTTP_METHODS,
  stableStringify,
} from "./runtime.mjs";
import type { SessionOrigin, SessionStore, SessionSummary } from "./session-store.js";

const ENV_MODE = "MCPEAK_EXTERNAL_MODE";
const ENV_URL = "MCPEAK_EXTERNAL_COORDINATOR_URL";
const ENV_TOKEN = "MCPEAK_EXTERNAL_COORDINATOR_TOKEN";
const ENV_ADAPTERS = "MCPEAK_EXTERNAL_ADAPTERS";
const ENV_SCHEMA = "MCPEAK_EXTERNAL_SCHEMA_VERSION";
const ENV_TIMEOUT = "MCPEAK_EXTERNAL_TIMEOUT_MS";
/** 재생에서만 넘긴다. 자식이 종료 시 범위 밖 호출 개수를 여기에 동기로 쓴다(ADR-0068). */
const ENV_OBSERVER_PATH = "MCPEAK_EXTERNAL_OBSERVER_PATH";

export type StartExternalCoordinatorOptions =
  | {
      readonly mode: "record";
      readonly sessionId: string;
      readonly store: SessionStore;
      /** 녹화를 시작한 실행의 서버 명령·스위트(ADR-0085). 세션과 함께 저장된다. */
      readonly origin?: SessionOrigin;
      readonly requestTimeoutMs?: number;
      readonly existingNodeOptions?: string;
    }
  | {
      readonly mode: "replay";
      readonly sourceSessionId: string;
      readonly store: SessionStore;
      readonly requestTimeoutMs?: number;
      readonly existingNodeOptions?: string;
    };

export interface ExternalCoordinatorHandle {
  readonly url: string;
  readonly childEnvironment: Readonly<Record<string, string>>;
  finish(status: "completed" | "failed"): Promise<SessionSummary>;
}

const json = (response: ServerResponse, status: number, value: unknown): void => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
};

const errorResponse = (response: ServerResponse, status: number, code: string, message: string) =>
  json(response, status, { error: { code, message } });

const bearerToken = (request: IncomingMessage): string | undefined => {
  const header = request.headers.authorization;
  if (header === undefined || !header.startsWith("Bearer ")) return undefined;
  return header.slice("Bearer ".length);
};

const tokenMatches = (expected: string, actual: string): boolean => {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
};

const readJsonBody = (request: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_COORDINATOR_PAYLOAD_BYTES) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLarge) {
        reject(
          new ExternalRecordReplayError(
            "PAYLOAD_TOO_LARGE",
            "Coordinator 요청이 payload 상한을 초과했습니다.",
          ),
        );
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          new ExternalRecordReplayError("REQUEST_INVALID", "Coordinator JSON이 유효하지 않습니다."),
        );
      }
    });
  });

const plainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const protocolRequest = (value: unknown): Record<string, unknown> => {
  if (!plainObject(value))
    externalError("REQUEST_INVALID", "Coordinator 요청 형식이 잘못됐습니다.");
  if (value.schemaVersion !== PROTOCOL_SCHEMA_VERSION)
    externalError(
      "SCHEMA_VERSION_UNSUPPORTED",
      "지원하지 않는 Coordinator protocol schema version입니다.",
    );
  return value;
};

/**
 * 자식이 보낸 값에 **마스킹을 한 번 더 적용해 바이트를 비교한다**(ADR-0052 Store 직전 재검사).
 *
 * 자식이 규칙대로 마스킹했다면 재적용은 멱등이라 바이트가 같다. 달라졌다는 것은 자식이
 * 무언가를 놓쳤다는 뜻이고, 그 "무언가" 는 곧 토큰이나 자격증명이다.
 *
 * 형태 검사만으로는 이걸 잡을 수 없다 — `match` 가 객체인지 보는 것과 그 안에 `Authorization`
 * 이 원문으로 들어 있는지 보는 것은 다른 질문이다. 저장이 인메모리였을 때는 프로세스와 함께
 * 사라졌지만, 이제 파일에 남고 커밋될 수 있다.
 *
 * **변환된 값을 조용히 저장하지 않는다.** 마스킹된 쪽으로 갈아치우면 자식의 결함이 가려지고
 * 다음 요청도 같은 값을 보낸다. 실패시켜서 드러낸다.
 */
const assertRedacted = (sent: unknown, rechecked: unknown, what: string): void => {
  if (stableStringify(sent) === stableStringify(rechecked)) return;
  externalError(
    "EXTERNAL_REDACTION_INVARIANT_VIOLATION",
    `자식이 보낸 ${what}에 부모의 재검사가 추가 마스킹을 적용했습니다.\n` +
      "→ 자식 Adapter가 민감 값을 놓쳤다는 뜻이라 저장하지 않고 세션을 실패로 둡니다.\n" +
      "→ Bootstrap과 부모의 민감 키 목록 version이 어긋났는지 확인하세요.",
  );
};

/**
 * 재검사를 돌리고 바이트를 비교한다. **재검사가 던지는 것도 위반으로 다룬다.**
 *
 * 마스킹을 다시 적용하려면 값을 해석할 수 있어야 한다. 해석 자체가 실패했다는 것은 자식이
 * 부모가 다룰 수 없는 값을 보냈다는 뜻이고, 그것도 "같은 package/build 인데 형식이 다르다" 는
 * 같은 신호다. 그런데 그 오류는 `UNSUPPORTED_HTTP_URL` 같은 자기 code 를 달고 나가서, 아래
 * 서버 핸들러의 **세션을 닫는 분기를 비껴갔다** — 400 은 받지만 세션은 `running` 으로 남아,
 * 자식이 값을 고쳐 다시 보내면 통과할 수 있었다(ADR-0052 가 막으려던 바로 그 경로다).
 *
 * code 목록을 넓히는 대신 **재검사 자리에서 분류를 바꾼다.** 넓히면 이 함수 밖에서 같은 code 가
 * 날 때도 세션이 닫히고, 목록은 다음 code 가 생길 때마다 또 어긋난다.
 *
 * 원래 오류의 문구는 싣지 않는다. 지금은 전부 고정 문구지만, 재검사가 해석하지 못한 값이
 * 문구에 섞여 들어갈 여지를 남기지 않는다.
 *
 * **다만 우리가 의도적으로 거절한 것만 위반으로 다룬다.** 모든 예외를 삼키면 우리 쪽 실패까지
 * "자식과 부모의 build 가 다르다" 로 단정하게 된다. 예를 들어 `normalizeJson` 은 깊이 상한이
 * 없어 충분히 깊게 중첩된 **정상** JSON 본문에서 `RangeError` 를 낸다. 그것까지 이 분류에
 * 실으면 사용자는 아무 문제 없는 build 를 뒤지게 된다 — 원인이 본문 모양인데 진단은 배포
 * 형상을 가리킨다. 이 PR 이 고친 오진과 같은 종류다.
 *
 * 그래서 `ExternalRecordReplayError` 가 아닌 것은 **그대로 올린다.** 위에서 말한 `fail()` 경로는
 * 전부 `externalError` 라 이 클래스이므로, 원래 잡으려던 것은 그대로 잡힌다. 남은 것(우리
 * 버그·런타임 한계)은 상위에서 내부 오류로 다뤄지는 편이 정직하다.
 *
 * 깊이 상한 자체는 여기서 정하지 않는다. "몇 을 상한으로 할 것인가" 는 순환 참조·sparse array
 * 처럼 정규화 규칙 목록에 들어갈 판단이라 별도로 다룬다.
 */
const recheck = <T>(value: T, apply: (value: T) => T, what: string): void => {
  let rechecked: T;
  try {
    rechecked = apply(value);
  } catch (error) {
    if (!(error instanceof ExternalRecordReplayError)) throw error;
    invariantViolation(what, "unnormalizable-value");
  }
  assertRedacted(value, rechecked, what);
};

/**
 * 알려진 필드 목록을 **타입에서 뽑는다.**
 *
 * 손으로 적은 문자열 배열로 두면 `NormalizedExternalRequest` 와 조용히 어긋난다. `satisfies
 * Record<keyof T, true>` 는 양쪽을 다 막는다 — 타입에 필드가 늘면 여기 빠진 키를 컴파일러가
 * 요구하고, 여기에만 있는 키는 초과 프로퍼티로 걸린다. 필드 이름이 바뀌어도 마찬가지다.
 * 실제로 이 개정이 `schemaVersion` 을 `interactionSchemaVersion` 으로 바꾸고 `match` 를 뺐는데,
 * 그때 두 곳을 손으로 나란히 고쳐야 했다.
 */
const fieldNames = <T>(shape: Record<keyof T, true>): ReadonlySet<string> =>
  new Set(Object.keys(shape));

/** `WireHttpRequestV1` 의 알려진 필드 넷(ADR-0053). 이 밖의 필드는 형태가 맞아도 거부한다. */
const KNOWN_REQUEST_FIELDS = fieldNames<NormalizedExternalRequest>({
  protocol: true,
  interactionSchemaVersion: true,
  matchKey: true,
  display: true,
});

/**
 * `WireHttpDisplayV1` 의 알려진 필드 넷. **중첩 필드도 같은 규칙을 받는다** — 바깥만 검사하면
 * `display` 안에 실린 낯선 필드가 이 관문을 그냥 통과한다. 그러면 `redactHttpDisplay` 가
 * 재구성하면서 그 필드를 조용히 버리고, 바이트 비교만 어긋나 **"부모의 재검사가 추가 마스킹을
 * 적용했습니다"** 라는 엉뚱한 진단이 나간다 — 원인은 스키마에 없는 필드인데 사용자는 민감 키
 * 목록 version 을 의심하게 된다.
 */
const KNOWN_DISPLAY_FIELDS = fieldNames<NormalizedExternalRequest["display"]>({
  method: true,
  url: true,
  headers: true,
  body: true,
});

/**
 * 저장 outcome 의 알려진 필드. `kind` 별로 다르므로 둘로 나눈다.
 *
 * 낯선 필드는 재구성(`redactStoredOutcome`)이 버려서 결국 바이트 비교에 걸리기는 한다. 그런데
 * 그때 나가는 문장은 **"부모의 재검사가 추가 마스킹을 적용했습니다"** 다 — 민감 값을 놓쳤다는
 * 뜻이라 사용자는 민감 키 목록 version 을 뒤진다. 원인은 스키마에 없는 필드인데. `display` 쪽
 * 에서 고친 것과 **같은 오진이 outcome 쪽에만 남아 있었다.** 여기서 먼저 걸러 분류를 맞춘다.
 */
const KNOWN_RESPONSE_FIELDS = fieldNames<StoredHttpResponse>({
  kind: true,
  status: true,
  statusText: true,
  headers: true,
  url: true,
  body: true,
});

/** `code` 는 선택 필드지만 **허용 목록**에는 있어야 한다 — 실려 올 수 있는 값이기 때문이다. */
const KNOWN_THROW_FIELDS = fieldNames<StoredHttpThrow>({
  kind: true,
  failureKind: true,
  name: true,
  code: true,
});

/**
 * `throw` 결과의 세 필드는 **닫힌 열거형**이다(`protocol.ts`). 저장하는 것이 열거형뿐인 이유가
 * "값의 집합이 유한하므로 새는 경로가 없다" 인데, 이 관문이 문자열이기만 하면 받아 주면 그
 * 전제가 여기서 무너진다 — `name` 자리에 URL 을 실어 보내면 `redactStoredOutcome` 이 그대로
 * 복사해 재검사의 바이트 비교가 통과한다. 집합은 `fieldNames` 와 같은 방식으로 타입에 묶는다.
 */
const FAILURE_KINDS = fieldNames<Record<HttpFailureKind, true>>({
  abort: true,
  timeout: true,
  dns: true,
  connection: true,
  tls: true,
  network: true,
  unknown: true,
});
const FAILURE_NAMES = fieldNames<Record<HttpFailureName, true>>({
  Error: true,
  TypeError: true,
  AbortError: true,
});
const FAILURE_CODES = fieldNames<Record<HttpFailureCode, true>>({
  ABORT_ERR: true,
  CERT_HAS_EXPIRED: true,
  DEPTH_ZERO_SELF_SIGNED_CERT: true,
  EAI_AGAIN: true,
  ECONNREFUSED: true,
  ECONNRESET: true,
  ENOTFOUND: true,
  ERR_TLS_CERT_ALTNAME_INVALID: true,
  ETIMEDOUT: true,
  SELF_SIGNED_CERT_IN_CHAIN: true,
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: true,
  UND_ERR_CONNECT_TIMEOUT: true,
});

/**
 * 헤더 이름은 RFC 7230 token 이다 — `/` 나 `:` 가 들어갈 수 없다. 자식의 `normalizedHeaders`
 * 는 Fetch `Headers` 에서 이름을 받으므로 정상 경로에서는 항상 token 이고, 아닌 값이 왔다는
 * 것은 자식이 그 경로를 거치지 않았다는 뜻이다. 이름은 재구성에서 소문자로만 바뀌고 값은
 * 그대로 실리므로, 검사하지 않으면 이름 자리로 경로가 들어온다.
 */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** RFC 7230 reason-phrase: HTAB / SP / VCHAR / obs-text. CR·LF 같은 제어문자는 올 수 없다. */
const REASON_PHRASE = /^[\t \x21-\x7E\x80-\xFF]*$/;

/**
 * 알려진 **필드의 값**까지 검사한다.
 *
 * 필드 이름만 막으면 절반이다. `redactHttpDisplay` 는 `method` 를 **그대로 복사**하므로 값이
 * 무엇이든 재검사의 바이트 비교가 통과한다 — `method` 자리에 URL 을 실어 보내면 지우려던
 * 경로가 그대로 저장됐다(실측 확인). `url` 은 재검사가 경로를 지워 바이트가 달라지므로 이미
 * 걸리지만, 걸리는 이유가 우연이면 다음 개정에서 조용히 풀린다. 넷 다 여기서 본다.
 */
const validDisplay = (display: Record<string, unknown>): boolean => {
  // method 는 열거형으로 좁힌다. 문자열이기만 하면 URL 도 문자열이다.
  if (typeof display.method !== "string" || !SUPPORTED_HTTP_METHODS.includes(display.method))
    return false;
  if (typeof display.url !== "string") return false;
  if (!plainObject(display.headers)) return false;
  for (const [name, value] of Object.entries(display.headers)) {
    if (!HEADER_NAME.test(name)) return false;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return false;
  }
  if (!plainObject(display.body)) return false;
  // tagged union 은 kind 별로 필드가 정확히 정해져 있다. 남는 필드는 또 하나의 실을 자리다.
  const bodyKeys = Object.keys(display.body).sort().join(",");
  if (display.body.kind === "none") return bodyKeys === "kind";
  if (display.body.kind === "json") return bodyKeys === "kind,value";
  return false;
};

/**
 * `response` 결과의 알려진 **필드의 값**을 검사한다. `validDisplay` 와 같은 이유다 —
 * `redactStoredOutcome` 은 `status`·`statusText` 를 그대로 복사하고 헤더는 이름만 소문자로
 * 바꾸므로, 값을 보지 않으면 그 자리로 무엇이든 재검사를 통과해 세션에 남는다. `body` 는 wire
 * 가 JSON 이라 파싱된 시점에 이미 `JsonValue` 다 — `undefined`·함수·순환은 올 수 없다.
 */
const validResponse = (outcome: Record<string, unknown>): boolean => {
  if (!Number.isInteger(outcome.status) || (outcome.status as number) < 100) return false;
  if ((outcome.status as number) > 599) return false;
  if (typeof outcome.statusText !== "string" || !REASON_PHRASE.test(outcome.statusText))
    return false;
  if (typeof outcome.url !== "string") return false;
  if (!Array.isArray(outcome.headers)) return false;
  for (const entry of outcome.headers) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [name, value] = entry as unknown[];
    if (typeof name !== "string" || !HEADER_NAME.test(name)) return false;
    if (typeof value !== "string") return false;
  }
  return "body" in outcome;
};

/** `throw` 결과는 세 필드 모두 닫힌 열거형이어야 한다. `code` 는 없거나 목록 안이어야 한다. */
const validThrow = (outcome: Record<string, unknown>): boolean =>
  typeof outcome.failureKind === "string" &&
  FAILURE_KINDS.has(outcome.failureKind) &&
  typeof outcome.name === "string" &&
  FAILURE_NAMES.has(outcome.name) &&
  (outcome.code === undefined ||
    (typeof outcome.code === "string" && FAILURE_CODES.has(outcome.code)));

type InvariantClassification =
  | "match-field"
  | "unknown-field"
  | "invalid-value"
  | "unnormalizable-value";

/**
 * 변수에 함수 타입을 명시한다. `const f = (): never => …` 형태만으로는 TS 의 제어 흐름 분석이
 * "이 호출 뒤는 도달하지 않는다" 를 좁혀 주지 않아, 호출한 쪽에서 확정 할당이 깨진다.
 *
 * `what` 은 요청·결과 중 어느 쪽이 어긋났는지만 말한다. 위반한 필드의 이름도 값도 싣지 않는
 * 것은 그대로다 — 둘 다 자식이 만든 값이라 지우려던 경로가 그대로 올 수 있다.
 */
const invariantViolation: (what: string, classification: InvariantClassification) => never = (
  what,
  classification,
) =>
  externalError(
    "EXTERNAL_REDACTION_INVARIANT_VIOLATION",
    `자식이 보낸 ${what}이 wire 형식을 벗어났습니다(${classification}).\n` +
      "→ 저장하지 않고 세션을 실패로 둡니다. 같은 package/build의 자식과 부모가 다른 " +
      "형식을 쓴 것으로 보입니다.",
  );

/**
 * 자식이 보낸 요청을 그대로 신뢰하지 않는다(ADR-0053). **알려진 필드만 뽑아 새 값으로
 * 재구성**한다 — wire 형식에는 매칭 재료(`match`, 정확한 pathname 을 담는 값)를 실을 자리가
 * 아예 없다. `match` 필드나 알려지지 않은 필드가 실려 있으면 형태가 맞아도 거부하고, 같은
 * package/build 의 자식과 부모가 다른 형식을 쓴 것으로 보고 기존 재검사 실패 경로
 * (`EXTERNAL_REDACTION_INVARIANT_VIOLATION`)를 그대로 태워 세션을 즉시 실패로 닫는다.
 *
 * 위반 진단에는 **고정된 분류만** 싣는다. 위반한 필드의 이름도 값도 싣지 않는다 — 값이
 * 지우려던 경로인 것은 물론이고, 이름 역시 자식이 만든 값이라 그 경로가 그대로 올 수 있다.
 */
const normalizedRequest = (value: unknown): NormalizedExternalRequest => {
  if (!plainObject(value))
    externalError("REQUEST_INVALID", "정규화된 외부 요청 형식이 잘못됐습니다.");
  if ("match" in value) invariantViolation("외부 요청", "match-field");
  if (Object.keys(value).some((key) => !KNOWN_REQUEST_FIELDS.has(key)))
    invariantViolation("외부 요청", "unknown-field");
  if (
    value.protocol !== "http" ||
    value.interactionSchemaVersion !== HTTP_INTERACTION_SCHEMA_VERSION ||
    typeof value.matchKey !== "string" ||
    !plainObject(value.display)
  )
    externalError("REQUEST_INVALID", "정규화된 외부 요청 형식이 잘못됐습니다.");
  const display = value.display;
  if (Object.keys(display).some((key) => !KNOWN_DISPLAY_FIELDS.has(key)))
    invariantViolation("외부 요청", "unknown-field");
  if (!validDisplay(display)) invariantViolation("외부 요청", "invalid-value");
  // 재구성은 알려진 필드만 옮겨 담는다. 위의 거부가 이미 걸렀더라도, 실을 자리를 만들지 않는
  // 것이 "매칭 재료는 저장되지 않는다" 를 형식으로 보장하는 마지막 겹이다.
  const request: NormalizedExternalRequest = {
    protocol: "http",
    interactionSchemaVersion: HTTP_INTERACTION_SCHEMA_VERSION,
    matchKey: value.matchKey,
    display: {
      method: display.method,
      url: display.url,
      headers: display.headers,
      body: display.body,
    } as unknown as NormalizedExternalRequest["display"],
  };
  recheck(request, redactNormalizedRequest, "외부 요청");
  return request;
};

/**
 * 요청과 같은 규칙을 결과에도 적용한다(ADR-0053). 낯선 필드는 재구성이 버려서 결국 바이트
 * 비교에 걸리지만, 그때 나가는 문장이 "민감 값을 놓쳤다" 라 원인을 잘못 가리킨다. 분류를 여기서
 * 맞춘다 — `display` 쪽에서 이미 고친 오진이 결과 쪽에만 남아 있던 것을 메운다.
 */
const storedOutcome = (value: unknown): StoredExternalOutcome => {
  if (!plainObject(value) || (value.kind !== "response" && value.kind !== "throw"))
    externalError("REQUEST_INVALID", "저장할 외부 호출 결과 형식이 잘못됐습니다.");
  const known = value.kind === "response" ? KNOWN_RESPONSE_FIELDS : KNOWN_THROW_FIELDS;
  if (Object.keys(value).some((key) => !known.has(key)))
    invariantViolation("호출 결과", "unknown-field");
  const valid = value.kind === "response" ? validResponse(value) : validThrow(value);
  if (!valid) invariantViolation("호출 결과", "invalid-value");
  // 요청과 마찬가지로 알려진 필드만 옮겨 담아 재구성한다. 위의 검사가 이미 걸렀더라도 캐스팅한
  // 원본을 그대로 넘기지 않는 것이 "검증된 값만 저장된다" 를 형식으로 보장하는 마지막 겹이다.
  const outcome: StoredExternalOutcome =
    value.kind === "response"
      ? ({
          kind: "response",
          status: value.status,
          statusText: value.statusText,
          headers: value.headers,
          url: value.url,
          body: value.body,
        } as unknown as StoredHttpResponse)
      : ({
          kind: "throw",
          failureKind: value.failureKind,
          name: value.name,
          ...(value.code === undefined ? {} : { code: value.code }),
        } as unknown as StoredHttpThrow);
  recheck(outcome, redactStoredOutcome, "호출 결과");
  return outcome;
};

/** SHA-256 hex. 자식이 보낸 지문이 이 형태를 벗어나면 우리 자식이 만든 값이 아니다. */
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * 자식이 보낸 body URL 지문을 검증하고 재구성한다(ADR-0062).
 *
 * **여기 오는 값은 지문이어야만 한다.** 자식이 실수로 URL 원문을 실어 보내면 그것은
 * 부모 프로세스와 종료 요약을 거쳐 사용자 화면까지 갈 수 있는 값이고, 이 기능이 막으려던
 * 유출을 이 기능이 만드는 꼴이 된다. 형태를 못 박아 그 경로를 닫는다 — 64자 hex 가 아닌
 * 값은 재구성이 버리는 것이 아니라 세션을 실패로 닫는다.
 *
 * 요청 쪽 재구성과 같은 이유로 **알려진 필드만 새 배열로 옮겨 담는다.**
 */
const KNOWN_FINGERPRINT_FIELDS = fieldNames<BodyUrlFingerprints>({
  echoed: true,
  other: true,
  truncated: true,
});

const bodyUrlFingerprints = (value: unknown): BodyUrlFingerprints => {
  if (!plainObject(value)) invariantViolation("body URL 지문", "invalid-value");
  if (Object.keys(value).some((key) => !KNOWN_FINGERPRINT_FIELDS.has(key)))
    invariantViolation("body URL 지문", "unknown-field");
  if (value.truncated !== undefined && typeof value.truncated !== "boolean")
    invariantViolation("body URL 지문", "invalid-value");
  const digests = (raw: unknown): string[] => {
    if (!Array.isArray(raw)) invariantViolation("body URL 지문", "invalid-value");
    for (const item of raw)
      if (typeof item !== "string" || !SHA256_HEX.test(item))
        invariantViolation("body URL 지문", "invalid-value");
    return raw as string[];
  };
  const echoed = digests(value.echoed);
  const other = digests(value.other);
  // 자식이 상한을 지키지 않으면 payload 가 Coordinator 상한을 넘겨 녹화가 통째로 실패한다.
  // 여기서 먼저 거절해 원인을 "상한 위반" 으로 지목한다 — 413 만 받으면 무엇이 컸는지 모른다.
  if (echoed.length + other.length > MAX_BODY_URL_FINGERPRINTS)
    invariantViolation("body URL 지문", "invalid-value");
  return Object.freeze({
    echoed: Object.freeze(echoed),
    other: Object.freeze(other),
    ...(value.truncated === true ? { truncated: true } : {}),
  });
};

const errorStatus = (error: ExternalRecordReplayError): number => {
  if (error.code === "PAYLOAD_TOO_LARGE") return 413;
  if (error.code === "REPLAY_MISS") return 404;
  if (error.code === "CONCURRENT_MATCH" || error.code === "INCOMPLETE_SESSION") return 409;
  if (error.code === "REPLAY_SOURCE_INVALID" || error.code === "SESSION_NOT_FOUND") return 422;
  return 400;
};

const closeServer = (server: ReturnType<typeof createServer>): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });

const childNodeOptions = (existing: string | undefined): string => {
  const bootstrapUrl = new URL("./child/bootstrap.mjs", import.meta.url).href;
  const injection = `--import=${bootstrapUrl}`;
  return existing === undefined || existing.trim() === ""
    ? injection
    : `${existing.trim()} ${injection}`;
};

export async function startExternalCoordinator(
  options: StartExternalCoordinatorOptions,
): Promise<ExternalCoordinatorHandle> {
  const timeout = options.requestTimeoutMs ?? DEFAULT_COORDINATOR_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
    externalError("REQUEST_INVALID", "Coordinator timeout은 1~60000ms 정수여야 합니다.");
  const engine: ExternalEngine =
    options.mode === "record"
      ? createRecordEngine({
          sessionId: options.sessionId,
          store: options.store,
          ...(options.origin === undefined ? {} : { origin: options.origin }),
        })
      : createReplayEngine({ sourceSessionId: options.sourceSessionId, store: options.store });
  const token = randomBytes(32).toString("base64url");

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "POST") {
        errorResponse(response, 405, "METHOD_NOT_ALLOWED", "POST 요청만 허용합니다.");
        return;
      }
      const actualToken = bearerToken(request);
      if (actualToken === undefined) {
        errorResponse(response, 401, "AUTH_REQUIRED", "Coordinator 인증이 필요합니다.");
        return;
      }
      if (!tokenMatches(token, actualToken)) {
        errorResponse(response, 403, "AUTH_FORBIDDEN", "Coordinator 인증에 실패했습니다.");
        return;
      }
      const body = protocolRequest(await readJsonBody(request));
      if (request.url === "/begin") {
        if (engine.mode !== "record")
          externalError("REQUEST_INVALID", "Replay Coordinator에서는 begin을 사용할 수 없습니다.");
        const reservation = engine.begin(normalizedRequest(body.request));
        json(response, 200, { reservation });
        return;
      }
      if (request.url === "/complete") {
        if (engine.mode !== "record")
          externalError(
            "REQUEST_INVALID",
            "Replay Coordinator에서는 complete를 사용할 수 없습니다.",
          );
        const complete = body as unknown as CompleteRecordRequest;
        if (typeof complete.interactionId !== "string")
          externalError("REQUEST_INVALID", "interactionId가 필요합니다.");
        engine.complete({
          interactionId: complete.interactionId,
          outcome: storedOutcome(complete.outcome),
          ...(complete.bodyUrls === undefined
            ? {}
            : { bodyUrls: bodyUrlFingerprints(complete.bodyUrls) }),
        });
        json(response, 200, { completed: true });
        return;
      }
      if (request.url === "/lookup") {
        if (engine.mode !== "replay")
          externalError("REQUEST_INVALID", "Record Coordinator에서는 lookup을 사용할 수 없습니다.");
        const hit = engine.lookup(normalizedRequest(body.request));
        json(response, 200, {
          interactionId: hit.interactionId,
          ordinal: hit.ordinal,
          occurrence: hit.occurrence,
          outcome: hit.outcome,
        });
        return;
      }
      errorResponse(response, 404, "ENDPOINT_NOT_FOUND", "Coordinator endpoint를 찾지 못했습니다.");
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (error instanceof ExternalRecordReplayError) {
        // 마스킹 불변식이 깨진 세션은 400 을 돌려주는 것으로 끝내지 않고 **즉시 실패로 닫는다**
        // (ADR-0052). 400 만 주고 running 으로 두면, 누출을 들킨 자식이 같은 interaction 을
        // 제대로 마스킹해 다시 보내는 것으로 통과할 수 있다. 그러면 남는 녹화는 깨끗해 보이지만
        // 새는 Adapter 가 만든 것이고, 그 사실은 아무 데도 남지 않는다.
        if (error.code === "EXTERNAL_REDACTION_INVARIANT_VIOLATION" && engine.mode === "record") {
          try {
            engine.finish("failed");
          } catch {
            // 이미 끝난 세션이면 그대로 둔다. 원래 오류를 이 실패로 덮지 않는다.
          }
        }
        errorResponse(response, errorStatus(error), error.code, error.message);
        return;
      }
      errorResponse(response, 500, "COORDINATOR_INTERNAL", "Coordinator 내부 오류가 발생했습니다.");
    }
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    externalError("COORDINATOR_UNAVAILABLE", "Coordinator 주소를 확인하지 못했습니다.");
  }
  const url = `http://127.0.0.1:${(address as AddressInfo).port}`;
  // 재생에서만 관측한다. 디렉터리째 만들어 두면 정리가 파일 하나 지우는 것으로 끝나지 않고
  // 자식이 엉뚱한 이름을 써도 남는 것이 없다.
  //
  // **실패해도 재생을 막지 않는다.** `mkdtempSync` 는 tmpdir 이 없거나 쓸 수 없으면 던진다
  // (EACCES·ENOENT). 그걸 그대로 올리면 **진단 기능이 멀쩡한 재생을 죽인다** — 그리고 여기는
  // 서버가 이미 listen 중이라, 던지고 나가면 그 소켓이 닫히지 않은 채 남는다.
  //
  // 대신 관측만 포기한다. 요약의 `outOfScope` 가 `undefined` 로 남고, 그것은 이 설계가 이미
  // 1급으로 다루는 상태다 — "0 건" 이 아니라 "못 셌음" 이고, CLI 는 그 갈래에서 조건절 단서를
  // 그대로 유지한다. 사용자는 덜 알게 되지만 잘못 알게 되지는 않는다.
  const observer = options.mode === "replay" ? tryCreateObserverSidecar() : undefined;
  const childEnvironment = Object.freeze({
    [ENV_MODE]: options.mode,
    [ENV_URL]: url,
    [ENV_TOKEN]: token,
    [ENV_ADAPTERS]: "node.fetch.v1",
    [ENV_SCHEMA]: String(PROTOCOL_SCHEMA_VERSION),
    [ENV_TIMEOUT]: String(timeout),
    ...(observer === undefined ? {} : { [ENV_OBSERVER_PATH]: observer.path }),
    NODE_OPTIONS: childNodeOptions(options.existingNodeOptions),
  });
  let finishPromise: Promise<SessionSummary> | undefined;

  return Object.freeze({
    url,
    childEnvironment,
    finish(status: "completed" | "failed") {
      finishPromise ??= (async () => {
        await closeServer(server);
        const summary = engine.finish(status);
        if (observer === undefined) return summary;
        // 자식은 이미 끝났다(호출자가 실행을 마친 뒤 부른다). 그러므로 파일이 있으면 그 수가
        // 전부이고, 없으면 훅이 못 뛴 것이다 — **없음을 0 으로 바꾸지 않는다.**
        const observed = observer.read();
        return observed === undefined ? summary : { ...summary, outOfScope: observed };
      })();
      return finishPromise;
    },
  });
}

/**
 * 사이드카를 만들되 **실패를 삼킨다.** 관측은 진단이지 실행 조건이 아니다 — tmpdir 을 못 써서
 * 재생 전체가 실패하면 얻는 것보다 잃는 것이 크다. 못 만들면 `undefined` 를 돌려 "관측 없음"
 * 으로 굴러가고, 요약의 `outOfScope` 는 "못 셌음" 으로 남는다.
 */
function tryCreateObserverSidecar(): ObserverSidecar | undefined {
  try {
    return createObserverSidecar();
  } catch {
    return undefined;
  }
}

interface ObserverSidecar {
  readonly path: string;
  read(): number | undefined;
}

/**
 * 자식이 종료 시 개수를 쓸 자리. 비동기 비콘 대신 파일을 쓰는 이유는
 * `out-of-scope-observer.mjs` 에 적었다 — 마지막 호출이 종료와 경합하면, 잃는 것이 하필 이
 * 기능이 잡으려는 모양이다.
 */
function createObserverSidecar(): ObserverSidecar {
  const directory = mkdtempSync(join(tmpdir(), "mcpeak-external-observer-"));
  const path = join(directory, "out-of-scope.json");
  return {
    path,
    read() {
      let raw: string;
      try {
        raw = readFileSync(path, "utf8");
      } catch {
        // 강제 종료돼 훅이 안 뛰었거나 쓰기에 실패했다. "못 셌음" 이다.
        return undefined;
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        const value = (parsed as { outOfScope?: unknown })?.outOfScope;
        // 자식이 쓴 값이라 형식을 믿지 않는다. 이상하면 0 이 아니라 "못 셌음" 이다.
        return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
          ? value
          : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
