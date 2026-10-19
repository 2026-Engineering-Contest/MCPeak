import type { McpClient, ToolResult } from "@mcpeak/core";
import type { CallOutcome, PerfCall, PerfMeasurement, PerfPlan } from "./types.js";
import { displayUrl } from "./url.js";

/** 설계 §4.5: 오류 첫 줄의 상한. 표 한 줄에 들어가는 길이. */
const MAX_DETAIL_CHARS = 200;

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

/** 경쟁의 결과. 호출 결과, 호출 거부, 타임아웃 셋 중 하나다. */
type RaceResult =
  | { readonly kind: "result"; readonly result: ToolResult }
  | { readonly kind: "rejected"; readonly error: unknown }
  | { readonly kind: "timeout" };

/** §5.4: 오류 메시지의 첫 줄, 그 안의 URL 을 displayUrl 로, 200자를 넘으면 잘라 … 를 붙인다. */
function errorDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = (message.split(/\r?\n/)[0] ?? "").replace(URL_PATTERN, (url) =>
    displayUrl(url),
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
