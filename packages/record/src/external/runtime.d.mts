import type {
  HttpBody,
  JsonValue,
  NormalizedExternalRequest,
  StoredExternalOutcome,
  StoredHttpResponse,
  StoredHttpThrow,
} from "./protocol.js";

export const HTTP_MATCH_KEY_DOMAIN: "mcpeak.external.http";
export const HTTP_INTERACTION_SCHEMA_VERSION: 1;

/**
 * matchKey 계산에만 쓰는 재료(ADR-0053 `HttpMatchMaterialV1`). 정확한 pathname 을 담으므로
 * **자식 프로세스 밖으로 나가지 않는다** — `normalizeHttpRequest` 가 내부에서 만들어 해싱한
 * 뒤 버리고, 반환값(`NormalizedExternalRequest`)에는 이 모양이 실리지 않는다. `protocol.ts`
 * 가 export 하는 `HttpDisplayV1` 과 필드가 같아 보여도 값의 출처가 다르다 — 여기서만 쓴다.
 */
export interface HttpMatchMaterialV1 {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, readonly string[]>>;
  readonly body: HttpBody;
}

export function stableStringify(value: unknown): string;
export function httpMatchKey(match: HttpMatchMaterialV1): string;
export function sensitiveKey(key: string): boolean;
export function redactJson(value: JsonValue): JsonValue;
export function normalizeHttpRequest(request: Request): Promise<NormalizedExternalRequest>;
export function encodeHttpResponse(response: Response): Promise<StoredHttpResponse>;
export function encodeHttpThrow(error: unknown): StoredHttpThrow;
export function restoreHttpOutcome(outcome: StoredExternalOutcome): Response;
export function cloneHttpMatch(value: HttpMatchMaterialV1): HttpMatchMaterialV1;
export function redactNormalizedRequest(
  request: NormalizedExternalRequest,
): NormalizedExternalRequest;
export function redactStoredOutcome(outcome: StoredExternalOutcome): StoredExternalOutcome;
