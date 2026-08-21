import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { createRecordEngine, createReplayEngine, type ExternalEngine } from "./engine.js";
import { ExternalRecordReplayError, externalError } from "./errors.js";
import {
  type CompleteRecordRequest,
  DEFAULT_COORDINATOR_TIMEOUT_MS,
  MAX_COORDINATOR_PAYLOAD_BYTES,
  type NormalizedExternalRequest,
  PROTOCOL_SCHEMA_VERSION,
  type StoredExternalOutcome,
} from "./protocol.js";
import type { SessionStore, SessionSummary } from "./session-store.js";

const ENV_MODE = "MCPEAK_EXTERNAL_MODE";
const ENV_URL = "MCPEAK_EXTERNAL_COORDINATOR_URL";
const ENV_TOKEN = "MCPEAK_EXTERNAL_COORDINATOR_TOKEN";
const ENV_ADAPTERS = "MCPEAK_EXTERNAL_ADAPTERS";
const ENV_SCHEMA = "MCPEAK_EXTERNAL_SCHEMA_VERSION";
const ENV_TIMEOUT = "MCPEAK_EXTERNAL_TIMEOUT_MS";

export type StartExternalCoordinatorOptions =
  | {
      readonly mode: "record";
      readonly sessionId: string;
      readonly store: SessionStore;
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

const normalizedRequest = (value: unknown): NormalizedExternalRequest => {
  if (
    !plainObject(value) ||
    value.protocol !== "http" ||
    value.schemaVersion !== 1 ||
    typeof value.matchKey !== "string" ||
    !plainObject(value.match) ||
    !plainObject(value.display)
  )
    externalError("REQUEST_INVALID", "정규화된 외부 요청 형식이 잘못됐습니다.");
  return value as unknown as NormalizedExternalRequest;
};

const storedOutcome = (value: unknown): StoredExternalOutcome => {
  if (!plainObject(value) || (value.kind !== "response" && value.kind !== "throw"))
    externalError("REQUEST_INVALID", "저장할 외부 호출 결과 형식이 잘못됐습니다.");
  return value as unknown as StoredExternalOutcome;
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
      ? createRecordEngine({ sessionId: options.sessionId, store: options.store })
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
  const childEnvironment = Object.freeze({
    [ENV_MODE]: options.mode,
    [ENV_URL]: url,
    [ENV_TOKEN]: token,
    [ENV_ADAPTERS]: "node.fetch.v1",
    [ENV_SCHEMA]: String(PROTOCOL_SCHEMA_VERSION),
    [ENV_TIMEOUT]: String(timeout),
    NODE_OPTIONS: childNodeOptions(options.existingNodeOptions),
  });
  let finishPromise: Promise<SessionSummary> | undefined;

  return Object.freeze({
    url,
    childEnvironment,
    finish(status: "completed" | "failed") {
      finishPromise ??= (async () => {
        await closeServer(server);
        return engine.finish(status);
      })();
      return finishPromise;
    },
  });
}
