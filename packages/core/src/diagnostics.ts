export interface McpProcessDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface McpHttpDiagnostics {
  /** 자격증명이 제거된 정규화 URL. 헤더는 절대 싣지 않는다. */
  readonly url: string;
  /** 관측된 HTTP 상태 코드. 네트워크 단계에서 실패하면 null. */
  readonly status: number | null;
  readonly statusText: string | null;
  /** 서버가 발급한 Mcp-Session-Id. stateless 서버면 null. */
  readonly sessionId: string | null;
}

export type McpDiagnostics =
  | ({ readonly transport: "stdio" } & McpProcessDiagnostics)
  | ({ readonly transport: "http" } & McpHttpDiagnostics);

/**
 * 진단을 받는 자리의 입력 타입. `lifecycle.ts` · `controlled-stdio.ts` · `index.ts` 와
 * 다른 패키지의 test double 이 진단을 `McpProcessDiagnostics` 로 선언해 transport 태그를
 * 지우므로, 태그가 없는 stdio 진단도 받아 `tagDiagnostics` 로 붙여 준다.
 */
export type McpDiagnosticsInput = McpDiagnostics | McpProcessDiagnostics;

/** 태그가 없으면 stdio 로 간주한다. HTTP 진단은 항상 createHttpDiagnosticsSnapshot 이 만든다. */
export function tagDiagnostics(input: McpDiagnosticsInput): McpDiagnostics {
  return "transport" in input ? input : { transport: "stdio", ...input };
}

export function createDiagnosticsSnapshot(
  stderr: string,
  stderrTruncated: boolean,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): { readonly transport: "stdio" } & McpProcessDiagnostics {
  return Object.freeze({ transport: "stdio" as const, stderr, stderrTruncated, exitCode, signal });
}

export function createHttpDiagnosticsSnapshot(
  url: string,
  status: number | null,
  statusText: string | null,
  sessionId: string | null,
): { readonly transport: "http" } & McpHttpDiagnostics {
  return Object.freeze({ transport: "http" as const, url, status, statusText, sessionId });
}

/** 신뢰할 수 없는 stderr의 최근 byte만 유지한다. */
export class BoundedStderr {
  readonly #maximumBytes: number;
  #bytes = Buffer.alloc(0);
  #truncated = false;

  constructor(maximumBytes: number) {
    this.#maximumBytes = maximumBytes;
  }

  append(chunk: Uint8Array): void {
    const combined = Buffer.concat([this.#bytes, Buffer.from(chunk)]);
    if (combined.length > this.#maximumBytes) {
      this.#bytes = combined.subarray(combined.length - this.#maximumBytes);
      this.#truncated = true;
      return;
    }
    this.#bytes = combined;
  }

  snapshot(
    exitCode: number | null,
    signal: NodeJS.Signals | null,
  ): { readonly transport: "stdio" } & McpProcessDiagnostics {
    return createDiagnosticsSnapshot(
      this.#bytes.toString("utf8"),
      this.#truncated,
      exitCode,
      signal,
    );
  }
}
