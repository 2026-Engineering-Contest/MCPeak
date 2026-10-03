import type {
  AdvertiseOptions,
  McpClient,
  McpServerInfo,
  McpServerSurface,
  ServerMessage,
} from "@mcpeak/core";
import { collectStrings } from "./collect.js";
import { probeArguments } from "./probe-args.js";
import { runDescRules } from "./rules/description.js";
import { runFlowRules } from "./rules/flow.js";
import { parseLaunchPackage, runLaunchRules } from "./rules/launch.js";
import { runProtocolRules } from "./rules/protocol.js";
import {
  CALL_TIMEOUT_MS,
  collectResultStrings,
  runResultRules,
  type ToolCallResult,
} from "./rules/result.js";
import { runSchemaRules } from "./rules/schema.js";
import { type CanaryPlan, planCanaries, runSecretRules } from "./rules/secret.js";
import {
  buildBaseline,
  compareBaseline,
  computeSurface,
  parseBaseline,
  serializeBaseline,
} from "./surface/index.js";
import {
  AUDIT_SCHEMA_VERSION,
  AuditError,
  type AuditOptions,
  type AuditReport,
  type AuditTarget,
  type Finding,
  type Location,
  type ProbePolicy,
  type RawTool,
  type RuleFamily,
  type Skipped,
} from "./types.js";

/** `audit` 가 쓰는 연결. core 의 connectStdio·connectHttp 결과가 이 꼴을 만족한다. */
export type AuditConnection = McpServerInfo &
  McpServerSurface & {
    readonly client: McpClient;
    close(): Promise<void>;
  };

/** 바깥 세계와 닿는 모든 것. 테스트는 인메모리로 바꿔 끼운다. 시계(now)는 두지 않는다(결정론). */
export interface AuditDependencies {
  /**
   * 서버에 붙는다. `env` 는 카나리 env 와 `forwardedEnv` 의 합이고, `advertise` 는 언제나 세 능력을
   * 모두 켠 값이다(§3.6). 실패하면 아무 오류나 던져도 된다. `audit` 가 CONNECT_FAILED 로 바꾼다.
   */
  connect(
    target: AuditTarget,
    env: Readonly<Record<string, string>>,
    advertise: AdvertiseOptions,
  ): Promise<AuditConnection>;
  /** 기준 파일을 읽는다. 파일이 없으면 `code: "ENOENT"` 인 오류를 던져야 새 기준을 만든다. */
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  readonly fetch: typeof globalThis.fetch;
  /** 카나리 값 하나(16자 소문자 hex). 호출마다 달라야 한다. */
  random(): string;
  /** 리포트 `generator.version`. CLI 가 자기 패키지 버전을 넣는다. */
  readonly generatorVersion: string;
  /**
   * 사용자가 `--env NAME` 으로 넘긴 실제 값. 이름은 `target.forwardedEnvNames` 와 같다. 서버에 그대로
   * 전달되고 `secret/env-echo` 의 대조 대상이 된다. 값은 출력 어디에도 쓰지 않는다.
   */
  readonly forwardedEnv: Readonly<Record<string, string>>;
}

/** 서버 발신 요청을 관측하려고 셋 다 광고한다. 요청에는 core 가 언제나 MethodNotFound 로 답한다(§3.6). */
const ADVERTISE_ALL: AdvertiseOptions = { sampling: true, elicitation: true, roots: true };

/** core 의 기본 maxMessageBytes(10MiB). result/oversized 는 그 절반을 넘는 응답을 본다(§3.7). */
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;

/** §6.1 의 고정 문장. */
const REASON = {
  probeNone: "--probe none 이라 도구를 호출하지 않았습니다.",
  noReadOnly:
    "readOnlyHint 가 true 인 도구가 없어 호출할 도구가 없었습니다. --probe all 은 상태를 바꿀 수 있습니다.",
  noBaseline: "--baseline 을 주지 않아 도구 표면 변경을 비교하지 않았습니다.",
  stdioProtocol: "stdio 대상이라 HTTP 프로토콜 검사는 해당 없습니다.",
  httpLaunch: "--url 대상이라 실행 명령 검사는 해당 없습니다.",
} as const;

/** skipped 의 가족 순서. 넣은 순서가 아니라 이 순서로 정렬해 결정론을 지킨다. */
const SKIPPED_ORDER: readonly RuleFamily[] = [
  "launch",
  "protocol",
  "result",
  "secret",
  "surface",
  "desc",
  "schema",
  "flow",
];

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

function describeTarget(target: AuditTarget): string {
  if (target.kind === "http") return target.url ?? "";
  return [target.command ?? "", ...(target.args ?? [])].join(" ");
}

/** §6.3 의 연결 실패 문장. 줄마다 `→` 이고 마지막 줄이 해결이다. */
function connectFailed(target: AuditTarget, cause: unknown): AuditError {
  return new AuditError(
    "CONNECT_FAILED",
    `→ 서버에 붙지 못했습니다: ${describeTarget(target)}\n→ ${firstLine(cause)}\n해결: mcpeak test 없이 같은 명령으로 서버가 뜨는지 먼저 확인하세요.`,
  );
}

function baselineUnreadable(path: string, cause: string): AuditError {
  return new AuditError(
    "BASELINE_UNREADABLE",
    `→ 기준 파일을 읽을 수 없습니다: ${path}\n→ ${cause}\n해결: 파일을 지우고 다시 실행하면 새 기준을 만듭니다.`,
  );
}

function shouldCall(policy: ProbePolicy, tool: RawTool): boolean {
  if (policy === "none") return false;
  if (policy === "all") return true;
  const annotations = tool.annotations;
  return (
    typeof annotations === "object" &&
    annotations !== null &&
    (annotations as Record<string, unknown>).readOnlyHint === true
  );
}

/** JSON-RPC 오류 응답(서버가 `McpError` 를 던진 경우)이면 그 오류 객체. 전송 실패면 undefined. */
function protocolError(
  error: unknown,
): { code: number; message: string; data?: unknown } | undefined {
  const cause =
    typeof error === "object" && error !== null && "cause" in error ? error.cause : undefined;
  if (typeof cause !== "object" || cause === null) return undefined;
  const { code, message, data } = cause as { code?: unknown; message?: unknown; data?: unknown };
  if (typeof code !== "number" || typeof message !== "string") return undefined;
  return data === undefined ? { code, message } : { code, message, data };
}

/**
 * 도구 하나를 부른다. 제한 시간을 넘기면 `timeout`, 전송이 실패하면 `error` 다. 서버가 JSON-RPC 오류로
 * 답하면 그것도 응답이므로 `ok` 이고 `raw` 는 `{ isError: true, error }` 로 둔다. 오류 메시지는 모델에
 * 그대로 보이는 주입 통로라 result 규칙이 봐야 한다(ATPA).
 */
async function callTool(
  client: McpClient,
  tool: RawTool,
  toolIndex: number,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), CALL_TIMEOUT_MS);
  });
  const call = client.callTool(tool.name, args).then(
    (result) => ({ ok: true as const, raw: result.raw }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  try {
    const settled = await Promise.race([call, timeout]);
    const base = { toolIndex, toolName: tool.name };
    if (settled === "timeout") return { ...base, raw: null, outcome: "timeout" };
    if (settled.ok) return { ...base, raw: settled.raw, outcome: "ok" };
    const rpc = protocolError(settled.error);
    if (rpc !== undefined) return { ...base, raw: { isError: true, error: rpc }, outcome: "ok" };
    return { ...base, raw: null, outcome: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** 호출 정책대로 도구를 목록 순서로 하나씩 부른다(§3.7). */
async function probeTools(
  client: McpClient,
  tools: readonly RawTool[],
  policy: ProbePolicy,
): Promise<{ results: ToolCallResult[]; probed: string[]; skipped: Skipped[] }> {
  const results: ToolCallResult[] = [];
  const probed: string[] = [];
  const skipped: Skipped[] = [];
  if (policy === "none") {
    skipped.push({ family: "result", reason: REASON.probeNone });
    skipped.push({ family: "secret", reason: REASON.probeNone });
    return { results, probed, skipped };
  }
  const candidates = tools
    .map((tool, toolIndex) => ({ tool, toolIndex }))
    .filter(({ tool }) => shouldCall(policy, tool));
  if (candidates.length === 0) {
    skipped.push({ family: "result", reason: REASON.noReadOnly });
    skipped.push({ family: "secret", reason: REASON.noReadOnly });
  }
  for (const { tool, toolIndex } of candidates) {
    const probe = probeArguments(tool.inputSchema);
    if (!probe.ok) {
      skipped.push({
        family: "result",
        reason: `도구 '${tool.name}' 은 인자를 만들 수 없어 호출하지 않았습니다: ${probe.reason}`,
      });
      continue;
    }
    probed.push(tool.name);
    results.push(await callTool(client, tool, toolIndex, probe.args));
  }
  return { results, probed, skipped };
}

const isMissingFile = (error: unknown) =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT";

/**
 * surface 가족(§3.5). 기준 파일이 없거나 `--update-baseline` 이면 지금 표면으로 쓰고
 * `surface/baseline-created` 를 낸다. 있으면 비교만 하고 덮어쓰지 않는다.
 */
async function surfaceFindings(
  path: string,
  update: boolean,
  current: ReturnType<typeof computeSurface>,
  tools: readonly RawTool[],
  target: AuditTarget,
  deps: AuditDependencies,
): Promise<Finding[]> {
  let text: string | undefined;
  try {
    text = await deps.readFile(path);
  } catch (error) {
    if (!isMissingFile(error)) throw baselineUnreadable(path, firstLine(error));
  }
  if (text !== undefined && !update) {
    let baseline: ReturnType<typeof parseBaseline>;
    try {
      baseline = parseBaseline(text);
    } catch (error) {
      throw baselineUnreadable(path, firstLine(error));
    }
    try {
      return compareBaseline(baseline, current, tools);
    } catch (error) {
      if (error instanceof AuditError && error.code === "BASELINE_SERVER_MISMATCH")
        throw new AuditError(
          "BASELINE_SERVER_MISMATCH",
          `→ ${error.message}\n해결: 서버마다 다른 --baseline 경로를 쓰세요.`,
        );
      throw error;
    }
  }
  await deps.writeFile(path, serializeBaseline(buildBaseline(current, parseLaunchPackage(target))));
  return [
    {
      ruleId: "surface/baseline-created",
      severity: "info",
      location: { kind: "surface", path: "" },
      message: `기준 파일을 만들었습니다: ${path}`,
      fix: "다음 실행부터 도구 정의 변경을 이 파일과 비교합니다.",
      evidence: [path],
    },
  ];
}

/** 위치를 types.ts 선언 순서의 키로 다시 세운다(§4 JSON 키 순서). */
function orderedLocation(location: Location): Location {
  switch (location.kind) {
    case "tool":
    case "result":
      return {
        kind: location.kind,
        toolIndex: location.toolIndex,
        toolName: location.toolName,
        path: location.path,
      };
    case "prompt":
      return { kind: location.kind, name: location.name, path: location.path };
    case "resource":
      return { kind: location.kind, uri: location.uri, path: location.path };
    case "launch":
      return { kind: location.kind, path: location.path };
    default:
      return { kind: location.kind, path: "" } as Location;
  }
}

const orderedFinding = (finding: Finding): Finding => ({
  ruleId: finding.ruleId,
  severity: finding.severity,
  location: orderedLocation(finding.location),
  message: finding.message,
  fix: finding.fix,
  evidence: [...finding.evidence],
});

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

const toolIndexOf = (location: Location) =>
  location.kind === "tool" || location.kind === "result" ? location.toolIndex : -1;

/**
 * §3.0 의 정렬·중복 제거. 정렬 키는 (toolIndex ?? -1, ruleId, path, evidence[0]) 이고, 그 뒤는
 * 위치 전체·메시지로 끊어 입력 순서와 무관하게 한다. 중복 키는 (ruleId, 위치 전체, evidence[0]).
 * path 만으로는 서로 다른 프롬프트의 같은 path 가 합쳐지므로 위치 전체를 쓴다(T1·T3 과 같은 판단).
 */
function finalize(findings: readonly Finding[]): Finding[] {
  const sorted = findings
    .map(orderedFinding)
    .sort(
      (left, right) =>
        toolIndexOf(left.location) - toolIndexOf(right.location) ||
        compareText(left.ruleId, right.ruleId) ||
        compareText(left.location.path, right.location.path) ||
        compareText(left.evidence[0] ?? "", right.evidence[0] ?? "") ||
        compareText(JSON.stringify(left.location), JSON.stringify(right.location)) ||
        compareText(left.message, right.message),
    );
  const seen = new Set<string>();
  return sorted.filter((finding) => {
    const key = JSON.stringify([finding.ruleId, finding.location, finding.evidence[0] ?? ""]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function countOf(findings: readonly Finding[]): AuditReport["counts"] {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings)
    if (!finding.ruleId.startsWith("flow/")) counts[finding.severity] += 1;
  return counts;
}

function orderSkipped(skipped: readonly Skipped[]): Skipped[] {
  return skipped
    .map((entry, index) => ({ entry: { family: entry.family, reason: entry.reason }, index }))
    .sort(
      (left, right) =>
        SKIPPED_ORDER.indexOf(left.entry.family) - SKIPPED_ORDER.indexOf(right.entry.family) ||
        left.index - right.index,
    )
    .map(({ entry }) => entry);
}

/** 연결이 선 뒤의 감사 전부. 순서는 §12.7 그대로다. */
async function inspect(
  options: AuditOptions,
  deps: AuditDependencies,
  connection: AuditConnection,
  plan: CanaryPlan,
  messages: readonly ServerMessage[],
): Promise<AuditReport> {
  const { target } = options;
  const tools = await connection.listToolsRaw();
  const prompts = await connection.listPrompts();
  const resources = await connection.listResources();
  const instructions = connection.instructions;
  const server = connection.serverVersion;

  // T1: collectStrings 결과를 복사하지 않고 그대로 넘긴다(위치 정보가 객체 동일성에 붙어 있다).
  const listStrings = collectStrings({ tools, prompts, resources, instructions });
  const findings: Finding[] = [
    ...runDescRules(listStrings, { serverName: server.name }),
    ...runSchemaRules(tools),
    ...runFlowRules(tools),
    ...runLaunchRules(target),
  ];
  const skipped: Skipped[] = [];
  if (target.kind === "http") skipped.push({ family: "launch", reason: REASON.httpLaunch });

  const probe = await probeTools(connection.client, tools, options.probe);
  skipped.push(...probe.skipped);
  findings.push(...runResultRules(probe.results, MAX_MESSAGE_BYTES));
  findings.push(
    ...runSecretRules(
      [...listStrings, ...collectResultStrings(probe.results)],
      plan,
      deps.forwardedEnv,
    ),
  );

  // 감사 중 목록이 바뀌었는지(protocol/list-changed). 다시 못 받으면 조용히 넘기지 않고 적는다.
  const before = computeSurface(tools, server);
  let surfaceHashAfter = before.surfaceHash;
  try {
    surfaceHashAfter = computeSurface(await connection.listToolsRaw(), server).surfaceHash;
  } catch (error) {
    skipped.push({
      family: "protocol",
      reason: `도구 목록을 다시 받지 못해 감사 중 변경을 확인하지 못했습니다: ${firstLine(error)}`,
    });
  }
  if (target.kind === "stdio") skipped.push({ family: "protocol", reason: REASON.stdioProtocol });
  findings.push(
    ...(await runProtocolRules({
      target,
      fetch: deps.fetch,
      serverMessages: [...messages],
      listChanged: {
        notified: messages.some(
          (message) =>
            message.kind === "notification" &&
            message.method === "notifications/tools/list_changed",
        ),
        surfaceHashBefore: before.surfaceHash,
        surfaceHashAfter,
      },
    })),
  );

  if (options.baselinePath === undefined)
    skipped.push({ family: "surface", reason: REASON.noBaseline });
  else
    findings.push(
      ...(await surfaceFindings(
        options.baselinePath,
        options.updateBaseline,
        before,
        tools,
        target,
        deps,
      )),
    );

  const finalFindings = finalize(findings);
  const counts = countOf(finalFindings);
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    generator: { name: "@mcpeak/audit", version: deps.generatorVersion },
    server: {
      name: server.name,
      version: server.version,
      toolCount: tools.length,
      promptCount: prompts.length,
      resourceCount: resources.length,
      hasInstructions: instructions !== undefined && instructions !== "",
      capabilityKeys: [...connection.capabilityKeys],
    },
    probe: options.probe,
    probedTools: [...probe.probed].sort(compareText),
    findings: finalFindings,
    skipped: orderSkipped(skipped),
    counts,
    exitCode: counts.high + counts.medium > 0 ? 2 : 0,
  };
}

/**
 * 서버 하나를 점검한다. 연결은 어떤 경로로 끝나도 닫는다. 감사 자체가 실패하면 그 오류가 이기고,
 * 닫기 실패는 그 뒤에 묻힌다(원인을 가리지 않게). 감사가 성공한 뒤의 닫기 실패는 그대로 올린다.
 */
export async function audit(options: AuditOptions, deps: AuditDependencies): Promise<AuditReport> {
  const plan = planCanaries(options.target.forwardedEnvNames, () => deps.random());
  const env = { ...plan.env, ...deps.forwardedEnv };
  let connection: AuditConnection;
  try {
    connection = await deps.connect(options.target, env, ADVERTISE_ALL);
  } catch (cause) {
    throw connectFailed(options.target, cause);
  }
  const messages: ServerMessage[] = [];
  const stop = connection.observeServerMessages((message) => messages.push(message));
  let report: AuditReport;
  try {
    report = await inspect(options, deps, connection, plan, messages);
  } catch (error) {
    stop();
    await connection.close().catch(() => undefined);
    throw error;
  }
  stop();
  await connection.close();
  return report;
}
