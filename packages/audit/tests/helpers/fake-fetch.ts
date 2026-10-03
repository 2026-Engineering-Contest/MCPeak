/**
 * protocol 픽스처의 `protocolContext.fetch` 응답표를 가짜 fetch 로 바꾼다.
 * protocol-rules.test.ts 와 T6 의 rules-fixtures.test.ts 가 같이 쓴다. 실제 네트워크는 쓰지 않는다.
 */

/** 가짜 fetch 의 경로 하나. 앞에서부터 처음 맞는 것이 답한다. 맞는 것이 없으면 404. */
export interface Route {
  readonly method: string;
  readonly url: string;
  /** 요청 헤더가 이 값들을 모두 가져야 맞는다. null 이면 그 헤더가 없어야 맞는다. */
  readonly headers?: Readonly<Record<string, string | null>>;
  readonly response?: {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  };
  /** 응답 대신 던질 오류 이름. "TimeoutError" 면 AbortSignal.timeout 이 낸 것처럼. */
  readonly throws?: string;
}

export interface FetchCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Headers;
  readonly body: string | undefined;
  readonly signal: AbortSignal | undefined;
}

export function fakeFetch(routes: readonly Route[]): {
  fetch: typeof globalThis.fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      method,
      url,
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal ?? undefined,
    });
    const route = routes.find(
      (r) =>
        r.method === method &&
        r.url === url &&
        Object.entries(r.headers ?? {}).every(([name, value]) =>
          value === null ? !headers.has(name) : headers.get(name) === value,
        ),
    );
    if (route?.throws !== undefined) {
      throw new DOMException("probe failed", route.throws);
    }
    if (route?.response === undefined) return new Response("", { status: 404 });
    return new Response(route.response.body ?? "", {
      status: route.response.status,
      headers: route.response.headers,
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
