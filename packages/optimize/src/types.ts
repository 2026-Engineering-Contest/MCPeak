import type { ToolDef } from "@mcpeak/core";

/** 오버레이 파일 형식 버전. 필드를 더하거나 뜻을 바꾸면 올린다. */
export const OVERLAY_SCHEMA_VERSION = 1 as const;

/** 한 도구에서 일어난 변경 하나. 리포트와 되돌리기 검토의 단위다. */
export type ToolChange =
  | { kind: "schema-key-removed"; path: string; key: string }
  | { kind: "description-cleaned"; path: string; before: string; after: string }
  | {
      kind: "description-removed";
      path: string;
      before: string;
      reason: "restates-name" | "empty" | "duplicate-of-tool-description" | "promoted";
    };

export interface OptimizedTool {
  /** 원본과 같다. 프록시는 이 이름으로 상류에 전달한다. */
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
  /** 원본과 깊은 비교로 같아야 한다(게이트 A). */
  readonly outputSchema?: unknown;
  readonly changes: readonly ToolChange[];
  /** UTF-8 바이트. `{name, description, input_schema}` 를 compact JSON 으로 직렬화한 길이. */
  readonly bytes: { readonly before: number; readonly after: number };
}

export interface OptimizeOverlay {
  readonly schemaVersion: typeof OVERLAY_SCHEMA_VERSION;
  /** 만든 도구. 결정론성을 위해 시각은 넣지 않는다. */
  readonly generator: { readonly name: "@mcpeak/optimize"; readonly version: string };
  /** 원본 서버 식별. 프록시가 시작할 때 상류의 `tools/list` 와 대조하는 근거다. */
  readonly source: {
    readonly toolCount: number;
    /** 원본 도구 이름의 정렬된 목록. 상류가 바뀌었는지 프록시가 판단하는 키다. */
    readonly toolNames: readonly string[];
    readonly instructions: string;
    readonly bytes: number;
    /** 원본 서버가 광고한 tools 외 능력. 프록시가 중계하지 않으므로 리포트가 경고한다. */
    readonly otherCapabilities: readonly ("resources" | "prompts" | "logging" | "completions")[];
  };
  readonly instructions: string;
  readonly tools: readonly OptimizedTool[];
  readonly totals: {
    readonly bytesBefore: number;
    readonly bytesAfter: number;
    /** 위 bytes 에 instructions 증가분을 더한 값. 옮긴 것을 절감으로 세지 않기 위해서다. */
    readonly bytesAfterWithInstructions: number;
    readonly promotedParameters: number;
  };
}

export interface OptimizeInput {
  readonly tools: readonly ToolDef[];
  readonly instructions: string;
  readonly otherCapabilities: OptimizeOverlay["source"]["otherCapabilities"];
}

export type OptimizeErrorCode =
  | "LOSSLESS_VIOLATION"
  | "OVERLAY_INVALID"
  | "OVERLAY_UPSTREAM_MISMATCH"
  | "UPSTREAM_UNAVAILABLE";

export class OptimizeError extends Error {
  constructor(
    readonly code: OptimizeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OptimizeError";
  }
}
