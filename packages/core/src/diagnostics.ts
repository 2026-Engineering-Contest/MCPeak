export interface McpProcessDiagnostics {
  readonly stderr: string;
  readonly stderrTruncated: boolean;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

export function createDiagnosticsSnapshot(
  stderr: string,
  stderrTruncated: boolean,
  exitCode: number | null,
  signal: NodeJS.Signals | null,
): McpProcessDiagnostics {
  return Object.freeze({ stderr, stderrTruncated, exitCode, signal });
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

  snapshot(exitCode: number | null, signal: NodeJS.Signals | null): McpProcessDiagnostics {
    return createDiagnosticsSnapshot(
      this.#bytes.toString("utf8"),
      this.#truncated,
      exitCode,
      signal,
    );
  }
}
