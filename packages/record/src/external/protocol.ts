export const PROTOCOL_SCHEMA_VERSION = 1 as const;
export const HTTP_ADAPTER_SCHEMA_VERSION = 1 as const;
export const MAX_HTTP_BODY_BYTES = 1024 * 1024;
export const MAX_COORDINATOR_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const DEFAULT_COORDINATOR_TIMEOUT_MS = 5_000;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type HttpBody =
  | { readonly kind: "none" }
  | { readonly kind: "json"; readonly value: JsonValue };

export interface HttpMatchV1 {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly body: HttpBody;
}

export interface NormalizedExternalRequest {
  readonly protocol: "http";
  readonly schemaVersion: typeof HTTP_ADAPTER_SCHEMA_VERSION;
  readonly matchKey: string;
  readonly match: HttpMatchV1;
  readonly display: HttpMatchV1;
}

export interface StoredHttpResponse {
  readonly kind: "response";
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly (readonly [string, string])[];
  readonly url: string;
  readonly body: JsonValue;
}

/**
 * `fetch` 자체가 던진 오류의 저장 형태다. 런타임이 만든 자유 텍스트(`message`·`stack`·
 * `cause`)는 **담지 않는다**(ADR-0053).
 *
 * 자유 텍스트에는 키 기반 마스킹이 작동하지 않는 것이 이유다. 네트워크 오류 문구에는
 * 실패한 URL 이 통째로 들어가는 경우가 흔하고, 그 URL 의 query 에 token 이 있으면
 * 그대로 세션에 남는다. 마스킹은 키를 보고 값을 지우는데 여기엔 키가 없다.
 *
 * 그래서 저장하는 것은 **닫힌 열거형뿐**이다. 값의 집합이 유한하므로 새는 경로가 없다.
 */
export type HttpFailureKind =
  | "abort"
  | "timeout"
  | "dns"
  | "connection"
  | "tls"
  | "network"
  | "unknown";

export type HttpFailureName = "Error" | "TypeError" | "AbortError";

export type HttpFailureCode =
  | "ABORT_ERR"
  | "CERT_HAS_EXPIRED"
  | "DEPTH_ZERO_SELF_SIGNED_CERT"
  | "EAI_AGAIN"
  | "ECONNREFUSED"
  | "ECONNRESET"
  | "ENOTFOUND"
  | "ERR_TLS_CERT_ALTNAME_INVALID"
  | "ETIMEDOUT"
  | "SELF_SIGNED_CERT_IN_CHAIN"
  | "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  | "UND_ERR_CONNECT_TIMEOUT";

export interface StoredHttpThrow {
  readonly kind: "throw";
  readonly failureKind: HttpFailureKind;
  readonly name: HttpFailureName;
  readonly code?: HttpFailureCode;
}

export type StoredExternalOutcome = StoredHttpResponse | StoredHttpThrow;

export interface BeginRecordRequest {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_VERSION;
  readonly request: NormalizedExternalRequest;
}

export interface CompleteRecordRequest {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_VERSION;
  readonly interactionId: string;
  readonly outcome: StoredExternalOutcome;
}

export interface ReplayLookupRequest {
  readonly schemaVersion: typeof PROTOCOL_SCHEMA_VERSION;
  readonly request: NormalizedExternalRequest;
}
