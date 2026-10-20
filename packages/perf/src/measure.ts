import { type McpClient, McpClientError, type ToolResult } from "@mcpeak/core";
import type { CallOutcome, PerfCall, PerfMeasurement, PerfPlan } from "./types.js";
import { displayUrl } from "./url.js";

/** 설계 §4.5: 오류 첫 줄의 상한. 표 한 줄에 들어가는 길이. */
const MAX_DETAIL_CHARS = 200;

/** 스킴이 있는 URL. http(s) 밖(postgres·redis 등)도 userinfo 와 쿼리 값을 가려야 한다(계획 E24). */
const URL_PATTERN = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g;

/*
 * 서버 문장에 흔히 섞이는 비밀 모양(설계 §5.4, 계획 E31·E35). Bearer 값, JWT, sk-·pk-·rk- 키. 이 밖의 서버 문장은
 * 서버가 쓴 그대로 싣는다(한계). Bearer 와 키는 모양이 맞아도 값이 비밀다울 때만 가린다. "Bearer token required"
 * 나 제약·인덱스 이름(pk-orders-customer-region-idx)까지 가리면 원인 문장을 읽을 수 없다(3차 검토 실측).
 */

/** 값은 RFC 6750 token68 문자만. 값 뒤에 붙은 닫는 괄호·쉼표 같은 문장 부호는 살린다. */
const BEARER_PATTERN = /Bearer\s+([A-Za-z0-9._~+/=-]+)/g;
/** 이보다 짧은 Bearer 값은 숫자가 섞여야 토큰으로 본다. 영어 낱말은 대개 이보다 짧고 숫자가 없다. */
const MIN_BEARER_WORD_CHARS = 16;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?/g;
const KEY_PATTERN = /\b(?:sk|pk|rk)-([A-Za-z0-9_-]+)/g;
/** 키 본문에 이만큼 이어진 영숫자 조각이 있어야 키로 본다. 이름은 짧은 낱말을 `-` 로 이어 이 조각이 없다. */
const KEY_RUN = /[A-Za-z0-9]{12,}/;
const DIGIT = /\d/;

function maskSecrets(text: string): string {
  return text
    .replace(BEARER_PATTERN, (match, value: string) =>
      value.length >= MIN_BEARER_WORD_CHARS || DIGIT.test(value) ? "Bearer …" : match,
    )
    .replace(JWT_PATTERN, "…")
    .replace(KEY_PATTERN, (match, body: string) =>
      DIGIT.test(body) && KEY_RUN.test(body) ? "…" : match,
    );
}

/** 경쟁의 결과. 호출 결과, 호출 거부, 타임아웃 셋 중 하나다. */
type RaceResult =
  | { readonly kind: "result"; readonly result: ToolResult }
  | { readonly kind: "rejected"; readonly error: unknown }
  | { readonly kind: "timeout" };

/**
 * cause 사슬에서 가장 안쪽 Error. core 의 McpClientError 는 고정 문장을 message 로 두고 SDK 사유를
 * cause 에 싣는다. 바깥 문장만 쓰면 모든 거부가 같은 문장이 된다(설계 §5.4). 이미 본 Error 를 다시
 * 만나면(순환) 거기서 멈춘다.
 */
function innermostError(error: Error): Error {
  const seen = new Set<Error>([error]);
  let current = error;
  while (current.cause instanceof Error && !seen.has(current.cause)) {
    current = current.cause;
    seen.add(current);
  }
  return current;
}

/**
 * 원인 문장. core 의 McpClientError 가 OPERATION_FAILED 가 아니면(서버 종료, 전송 실패 등) 그 분류가 원인보다
 * 중요하므로 `{바깥}: {가장 안쪽}` 으로 잇는다. 원인만 실으면 "Connection closed" 만 남아 서버가 죽은 줄 모른다
 * (계획 E31). OPERATION_FAILED 의 바깥 문장은 모든 거부에 같은 고정 문장이라 가장 안쪽만 쓴다(계획 E24).
 */
function causeMessage(error: unknown): string {
  if (!(error instanceof Error)) return collapsePrefix(String(error));
  const inner = innermostError(error);
  if (error instanceof McpClientError && error.code !== "OPERATION_FAILED" && inner !== error) {
    // 바깥 문장 끝의 마침표 하나를 떼고 잇는다. "….: " 처럼 마침표 뒤에 콜론이 오지 않게(계획 E35).
    return `${error.message.replace(/\.$/, "")}: ${collapsePrefix(inner.message)}`;
  }
  return collapsePrefix(inner.message);
}

/**
 * 맨 앞에서 연달아 반복된 같은 `MCP error <정수>: ` 머리말을 하나로 줄인다. 저수준 Server 가 McpError 를
 * 던지면 서버 문장에 이미 머리말이 있고 클라이언트 SDK 가 다시 붙인다. 번호가 다르면 다른 오류라 그대로 둔다.
 */
function collapsePrefix(message: string): string {
  return message.replace(/^(MCP error -?\d+: )\1+/, "$1");
}

/**
 * §5.4: 원인 문장의 첫 줄, 그 안의 URL 을 displayUrl 로, 흔한 비밀 모양을 … 로, 200자를 넘으면 잘라 … 를
 * 붙인다. 순서가 계약이다. 자른 뒤에 가리면 잘린 비밀 조각이 패턴에 안 맞아 남는다.
 */
function errorDetail(error: unknown): string {
  const message = causeMessage(error);
  const firstLine = maskSecrets(
    (message.split(/\r?\n/)[0] ?? "").replace(URL_PATTERN, (url) => displayUrl(url)),
  );
  return firstLine.length > MAX_DETAIL_CHARS
    ? `${firstLine.slice(0, MAX_DETAIL_CHARS)}…`
    : firstLine;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBlankText(item: unknown): boolean {
  return (
    isRecord(item) &&
    item.type === "text" &&
    typeof item.text === "string" &&
    item.text.trim() === ""
  );
}

/**
 * §5.4 의 empty: content 가 배열이 아니거나 빈 배열이거나 모든 항목이 공백뿐인 text 이고,
 * 동시에 raw 가 객체이며 raw.structuredContent 가 undefined 다.
 */
function isEmptyResult(result: ToolResult): boolean {
  const { content, raw } = result;
  const blankContent =
    !Array.isArray(content) || content.length === 0 || content.every(isBlankText);
  return blankContent && isRecord(raw) && raw.structuredContent === undefined;
}

function classify(result: ToolResult): CallOutcome {
  if (result.isError === true) return "isError";
  if (isEmptyResult(result)) return "empty";
  return "ok";
}

/**
 * callTool 과 sleep(timeoutMs, signal) 을 경쟁시키고, 승자가 정해지면 signal 을 abort 해 타이머를 해제한다.
 * 진 쪽이 나중에 거부돼도 처리되지 않은 거부로 새지 않게 둘 다 결과 값으로 바꿔 둔다.
 * sleep 이 거부하면 타임아웃으로 본다. 경쟁이 이미 끝났다면 그 값은 쓰이지 않는다.
 */
async function race(
  run: () => Promise<RaceResult>,
  timeoutMs: number,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  now: () => number,
): Promise<{ readonly outcome: RaceResult; readonly t1: number }> {
  const controller = new AbortController();
  const call = run();
  const timer = sleep(timeoutMs, controller.signal).then(
    (): RaceResult => ({ kind: "timeout" }),
    (): RaceResult => ({ kind: "timeout" }),
  );
  const outcome = await Promise.race([call, timer]);
  const t1 = now();
  controller.abort();
  return { outcome, t1 };
}

function measurementOf(
  call: PerfCall,
  iteration: number,
  t0: number,
  t1: number,
  outcome: CallOutcome,
  extra: { readonly detail?: string; readonly timedOut?: true } = {},
): PerfMeasurement {
  return {
    caseId: call.caseId,
    tool: call.tool,
    iteration,
    t0,
    t1,
    outcome,
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    ...(extra.timedOut === undefined ? {} : { timedOut: extra.timedOut }),
  };
}

/**
 * 호출을 실행하고 측정값을 만든다. client·now·sleep 은 주입받는다.
 * sleep 은 두 용도다. 호출 간격은 signal 없이 부르고, 타임아웃 경쟁은 signal 을 넘기고 승자가 정해지면 abort 한다.
 * abort 된 sleep 은 resolve 도 reject 도 하지 않고 타이머만 해제해도 된다.
 *
 * 순서는 plan.calls 순서 × iteration 0..repeat−1 이다(설계 §3.2 4항). 간격 sleep 은 실제로 callTool 을 부르는
 * 호출 앞에만, 첫 실제 호출 앞을 빼고 부른다. 타임아웃이 나면 남은 호출은 케이스와 무관하게 전부 skipped 다(§3.2 5항).
 */
export async function measure(options: {
  readonly client: Pick<McpClient, "callTool">;
  readonly availableTools: ReadonlySet<string>;
  readonly plan: PerfPlan;
  readonly now: () => number;
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly onProgress?: (done: number, total: number) => void;
}): Promise<readonly PerfMeasurement[]> {
  const { client, availableTools, plan, now, sleep, onProgress } = options;
  const total = plan.calls.length * plan.repeat;
  const measurements: PerfMeasurement[] = [];
  let aborted = false;
  let calledOnce = false;

  const record = (measurement: PerfMeasurement): void => {
    measurements.push(measurement);
    onProgress?.(measurements.length, total);
  };

  for (const call of plan.calls) {
    for (let iteration = 0; iteration < plan.repeat; iteration += 1) {
      if (aborted || !availableTools.has(call.tool)) {
        const t = now();
        record(measurementOf(call, iteration, t, t, aborted ? "skipped" : "missingTool"));
        continue;
      }

      if (calledOnce && plan.intervalMs > 0) await sleep(plan.intervalMs);
      calledOnce = true;

      const t0 = now();
      const { outcome, t1 } = await race(
        async (): Promise<RaceResult> => {
          try {
            return { kind: "result", result: await client.callTool(call.tool, call.input) };
          } catch (error) {
            return { kind: "rejected", error };
          }
        },
        call.timeoutMs,
        sleep,
        now,
      );

      if (outcome.kind === "timeout") {
        aborted = true;
        record(
          measurementOf(call, iteration, t0, t1, "threw", {
            detail: `호출이 ${call.timeoutMs}ms 안에 끝나지 않았습니다`,
            timedOut: true,
          }),
        );
      } else if (outcome.kind === "rejected") {
        record(
          measurementOf(call, iteration, t0, t1, "threw", { detail: errorDetail(outcome.error) }),
        );
      } else {
        record(measurementOf(call, iteration, t0, t1, classify(outcome.result)));
      }
    }
  }
  return measurements;
}
