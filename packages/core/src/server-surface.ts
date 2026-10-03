import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { collectPages, toolsCursorRepeated } from "./client.js";
import { createDiagnosticsSnapshot, type McpDiagnosticsInput } from "./diagnostics.js";
import type { AdvertiseOptions } from "./options.js";

export type RawTool = Record<string, unknown> & { readonly name: string };

export interface ServerMessage {
  readonly kind: "request" | "notification";
  readonly method: string;
  readonly params: unknown;
}

export interface McpServerSurface {
  /** tools/list 의 원시 객체. 페이지네이션은 McpClient.listTools 와 같은 규칙. annotations·title·_meta 가 남는다. */
  listToolsRaw(): Promise<readonly RawTool[]>;
  /** prompts 능력이 없으면 []. */
  listPrompts(): Promise<readonly Record<string, unknown>[]>;
  /** resources 능력이 없으면 []. */
  listResources(): Promise<readonly Record<string, unknown>[]>;
  readResource(uri: string): Promise<unknown>;
  /** 서버가 보낸 요청·알림을 관측한다. 해제 함수를 돌려준다. 요청에는 항상 MethodNotFound 로 답한다. */
  observeServerMessages(listener: (message: ServerMessage) => void): () => void;
  /** initialize 응답의 serverInfo. 없으면 둘 다 "". */
  readonly serverVersion: { readonly name: string; readonly version: string };
}

/**
 * 켠 능력만 `{}` 로 광고한다. 끈 능력을 광고하면 서버가 그 요청을 보내도 된다고 믿기 때문이다.
 * 키 순서는 sampling, elicitation, roots 로 고정한다.
 */
export function clientCapabilities(
  advertise: AdvertiseOptions | undefined,
): Record<string, object> {
  const capabilities: Record<string, object> = {};
  if (advertise?.sampling === true) capabilities.sampling = {};
  if (advertise?.elicitation === true) capabilities.elicitation = {};
  if (advertise?.roots === true) capabilities.roots = {};
  return capabilities;
}

/** 진단을 줄 수 없는 호출자(인메모리 테스트)를 위한 빈 stdio 진단. */
const emptyDiagnostics = () => createDiagnosticsSnapshot("", false, null, null);

/** prompts/list·resources/list 의 cursor 반복. core 오류 코드는 tools/list 전용이라 문장을 따로 둔다. */
function listCursorRepeated(method: string): Error {
  return new Error(
    `${method} 의 cursor 가 반복되었습니다. 서버 pagination 구현을 확인하세요(같은 cursor 를 두 번 돌려주면 목록이 끝나지 않습니다).`,
  );
}

/**
 * 순수 함수. SDK Client 에서 읽기만 한다. 인메모리 트랜스포트로 단언할 수 있게 분리했다.
 * `diagnostics` 는 cursor 반복 오류(`PAGINATION_CURSOR_REPEATED`)에 싣는 진단이다. connect 계열은
 * 실제 진단을 넘기고, 넘기지 않으면 빈 stdio 진단을 쓴다.
 */
export function createServerSurface(
  sdk: Client,
  diagnostics: () => McpDiagnosticsInput = emptyDiagnostics,
): McpServerSurface {
  const capabilities = () => sdk.getServerCapabilities() ?? {};
  const listeners = new Set<(message: ServerMessage) => void>();
  const emit = (message: ServerMessage) => {
    // 해제 중에 집합이 바뀌어도 이번 메시지의 전달 대상은 고정한다.
    for (const listener of [...listeners]) listener(message);
  };
  return {
    async listToolsRaw() {
      return collectPages<RawTool>(
        async (cursor) => {
          const page = await sdk.listTools(cursor === undefined ? {} : { cursor });
          return { items: page.tools as RawTool[], nextCursor: page.nextCursor };
        },
        () => toolsCursorRepeated(diagnostics),
      );
    },
    async listPrompts() {
      if (capabilities().prompts === undefined) return [];
      return collectPages<Record<string, unknown>>(
        async (cursor) => {
          const page = await sdk.listPrompts(cursor === undefined ? {} : { cursor });
          return { items: page.prompts, nextCursor: page.nextCursor };
        },
        () => listCursorRepeated("prompts/list"),
      );
    },
    async listResources() {
      if (capabilities().resources === undefined) return [];
      return collectPages<Record<string, unknown>>(
        async (cursor) => {
          const page = await sdk.listResources(cursor === undefined ? {} : { cursor });
          return { items: page.resources, nextCursor: page.nextCursor };
        },
        () => listCursorRepeated("resources/list"),
      );
    },
    readResource(uri: string) {
      return sdk.readResource({ uri });
    },
    observeServerMessages(listener) {
      listeners.add(listener);
      // SDK 가 등록된 처리기를 먼저 찾고 없을 때만 fallback 을 부르므로, ping 같은 기본 처리는 그대로다.
      sdk.fallbackRequestHandler = async (request) => {
        emit({ kind: "request", method: request.method, params: request.params });
        throw new McpError(ErrorCode.MethodNotFound, `mcpeak does not serve ${request.method}`);
      };
      sdk.fallbackNotificationHandler = async (notification) => {
        emit({ kind: "notification", method: notification.method, params: notification.params });
      };
      return () => {
        listeners.delete(listener);
      };
    },
    serverVersion: {
      name: sdk.getServerVersion()?.name ?? "",
      version: sdk.getServerVersion()?.version ?? "",
    },
  };
}
