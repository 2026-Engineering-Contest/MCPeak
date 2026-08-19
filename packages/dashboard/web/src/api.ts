import type { ApiError } from "../../src/api-types.js";

/**
 * fetch 래퍼. 상태 라이브러리 없음, 전부 `/api` 아래 JSON.
 *
 * 실패(4xx/5xx)는 응답 본문을 `ApiError`로 파싱해 그 `error` 메시지로 throw한다.
 * 본문 파싱 자체가 실패하면(JSON이 아니면) 상태 텍스트로 대신한다.
 */
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
    throw new Error(await parseErrorMessage(response));
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
    throw new Error(await parseErrorMessage(response));
  }
  // 204 No Content 등 빈 본문 응답을 대비해 텍스트로 먼저 읽고 비어 있으면 undefined를 준다.
  const text = await response.text();
  return (text.length === 0 ? undefined : (JSON.parse(text) as T)) as T;
}
