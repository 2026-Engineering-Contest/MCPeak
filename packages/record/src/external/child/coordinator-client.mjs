import { request as httpRequest } from "node:http";
import { MAX_COORDINATOR_PAYLOAD_BYTES } from "../../shared/limits.mjs";

const clientError = (code, message) => {
  const error = new Error(message);
  error.name = "ExternalRecordReplayError";
  error.code = code;
  return error;
};

export function createCoordinatorClient(options) {
  const endpoint = new URL(options.url);

  const call = (path, value) =>
    new Promise((resolve, reject) => {
      const body = Buffer.from(JSON.stringify(value));
      if (body.byteLength > MAX_COORDINATOR_PAYLOAD_BYTES) {
        reject(clientError("PAYLOAD_TOO_LARGE", "Coordinator 요청이 payload 상한을 초과했습니다."));
        return;
      }
      const request = httpRequest(
        new URL(path, endpoint),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.token}`,
            "content-type": "application/json",
            "content-length": body.byteLength,
          },
        },
        (response) => {
          const chunks = [];
          let size = 0;
          let tooLarge = false;
          response.on("data", (chunk) => {
            size += chunk.byteLength;
            if (size > MAX_COORDINATOR_PAYLOAD_BYTES) {
              tooLarge = true;
              return;
            }
            chunks.push(chunk);
          });
          // 응답이 `end` 전에 끊기면 `error` 없이 `close` 만 오는 경우가 있다. 그때
          // `end` 핸들러가 영영 안 돌아 promise 가 pending 으로 남는다. timeout 이 결국
          // 걷어 가지만, 그 사이 사용자는 원인 없이 기다리고 진단도 timeout 으로 잘못
          // 뜬다. `complete` 가 false 면 응답을 끝까지 못 받았다는 뜻이다.
          response.on("close", () => {
            if (response.complete) return;
            reject(clientError("COORDINATOR_UNAVAILABLE", "Coordinator 응답이 도중에 끊겼습니다."));
          });
          response.on("end", () => {
            if (tooLarge) {
              reject(
                clientError("PAYLOAD_TOO_LARGE", "Coordinator 응답이 payload 상한을 초과했습니다."),
              );
              return;
            }
            let parsed;
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              reject(clientError("COORDINATOR_UNAVAILABLE", "Coordinator 응답이 JSON이 아닙니다."));
              return;
            }
            if ((response.statusCode ?? 500) >= 400) {
              reject(
                clientError(
                  typeof parsed?.error?.code === "string"
                    ? parsed.error.code
                    : "COORDINATOR_UNAVAILABLE",
                  typeof parsed?.error?.message === "string"
                    ? parsed.error.message
                    : "Coordinator 요청이 실패했습니다.",
                ),
              );
              return;
            }
            resolve(parsed);
          });
        },
      );
      request.setTimeout(options.timeoutMs, () => {
        request.destroy(
          clientError("COORDINATOR_TIMEOUT", "Coordinator 응답 시간이 초과됐습니다."),
        );
      });
      request.on("error", (error) =>
        reject(
          error?.code === "COORDINATOR_TIMEOUT"
            ? error
            : clientError("COORDINATOR_UNAVAILABLE", "Coordinator에 연결하지 못했습니다."),
        ),
      );
      request.end(body);
    });

  return Object.freeze({
    async begin(externalRequest) {
      const response = await call("/begin", {
        schemaVersion: options.schemaVersion,
        request: externalRequest,
      });
      return response.reservation;
    },
    async complete(interactionId, outcome) {
      await call("/complete", {
        schemaVersion: options.schemaVersion,
        interactionId,
        outcome,
      });
    },
    async lookup(externalRequest) {
      return call("/lookup", {
        schemaVersion: options.schemaVersion,
        request: externalRequest,
      });
    },
  });
}
