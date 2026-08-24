import type { ApiError } from "../../src/api-types.js";

/**
 * fetch 래퍼. 상태 라이브러리 없음, 전부 `/api` 아래 JSON.
 *
 * 실패(4xx/5xx)는 응답 본문을 `ApiError`로 파싱해 그 `error` 메시지로 throw한다.
 * 본문 파싱 자체가 실패하면(JSON이 아니면) 상태 텍스트로 대신한다.
 */
/**
 * 실패 응답의 HTTP 상태를 들고 다니는 오류. 호출자가 404(대상이 없다)와 5xx·네트워크
 * 오류(확인에 실패했다)를 갈라야 하는 자리가 있는데, 메시지 문자열만으로는 못 가른다 —
 * 둘을 같은 안내로 묶으면 살아 있는 run 에 "그런 run이 없습니다" 라고 말하게 된다(#295).
 *
 * `Error` 를 상속하므로 `err.message` 만 쓰는 기존 호출자는 그대로 동작한다.
 */
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiError;
    if (typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // 본문이 JSON이 아니면 아래 기본 메시지로 대체한다.
  }
  return `${response.status} ${response.statusText}`;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new ApiRequestError(await parseErrorMessage(response), response.status);
  }
  return (await response.json()) as T;
}

export async function apiSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new ApiRequestError(await parseErrorMessage(response), response.status);
  }
  // 204 No Content 등 빈 본문 응답을 대비해 텍스트로 먼저 읽고 비어 있으면 undefined를 준다.
  const text = await response.text();
  return (text.length === 0 ? undefined : (JSON.parse(text) as T)) as T;
}
