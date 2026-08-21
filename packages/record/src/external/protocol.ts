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

export interface StoredHttpThrow {
  readonly kind: "throw";
  readonly name: string;
  readonly message: string;
  readonly code?: string;
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
