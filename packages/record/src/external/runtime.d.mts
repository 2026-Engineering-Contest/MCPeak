import type {
  HttpMatchV1,
  JsonValue,
  NormalizedExternalRequest,
  StoredExternalOutcome,
  StoredHttpResponse,
  StoredHttpThrow,
} from "./protocol.js";

export function stableStringify(value: unknown): string;
export function sensitiveKey(key: string): boolean;
export function redactJson(value: JsonValue): JsonValue;
export function normalizeHttpRequest(request: Request): Promise<NormalizedExternalRequest>;
export function encodeHttpResponse(response: Response): Promise<StoredHttpResponse>;
export function encodeHttpThrow(error: unknown): StoredHttpThrow;
export function restoreHttpOutcome(outcome: StoredExternalOutcome): Response;
export function cloneHttpMatch(value: HttpMatchV1): HttpMatchV1;
