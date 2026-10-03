import type {
  AdvertiseOptions,
  McpClient,
  McpServerInfo,
  McpServerSurface,
  ServerMessage,
} from "@mcpeak/core";
import { collectStrings } from "./collect.js";
import { probeArguments } from "./probe-args.js";
import { runBehaviorRules } from "./rules/behavior.js";
import { escapeInvisible, runDescRules } from "./rules/description.js";
import { runFlowRules } from "./rules/flow.js";
import { parseLaunchPackage, runLaunchRules } from "./rules/launch.js";
import { exfiltratedCanaries, type NetworkContext, runNetworkRules } from "./rules/network.js";
import { runProtocolRules } from "./rules/protocol.js";
import {
  CALL_TIMEOUT_MS,
  collectResultStrings,
  runResultRules,
  type ToolCallResult,
} from "./rules/result.js";
import { runSchemaRules } from "./rules/schema.js";
import {
  type CanaryPlan,
  findForm,
  type Needle,
  needlesFor,
  planCanaries,
  runSecretRules,
} from "./rules/secret.js";
import {
  type SandboxBackend,
  SandboxCleanupError,
  type SandboxHandle,
  type SandboxSpec,
} from "./sandbox/backend.js";
import { planCalls } from "./sandbox/call-plan.js";
import { extractDeclaredHosts } from "./sandbox/declared.js";
import { planHome } from "./sandbox/home.js";
import { filterNoise } from "./sandbox/noise.js";
import { compareEnvironmentSurface } from "./surface/environment.js";
import {
  buildBaseline,
  compareBaseline,
  computeSurface,
  parseBaseline,
  serializeBaseline,
} from "./surface/index.js";
import { normalizeText } from "./text/normalize.js";
import {
  AUDIT_SCHEMA_VERSION,
  AuditError,
  type AuditOptions,
  type AuditReport,
  type AuditTarget,
  type CanaryValue,
  type CollectedString,
  type Finding,
  type HomePlan,
  type Location,
  type Observation,
  type ObservedRequest,
  type ProbePolicy,
  type RawTool,
  type RequestSummary,
  type RuleFamily,
  type SandboxNetworkMode,
  type SandboxOptions,
  type SandboxReport,
  type SandboxUnavailable,
  type SandboxUnavailableCode,
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
  /**
   * 격리 백엔드. 없으면 `options.sandbox` 가 있어도 단계 1 경로로 돈다(대시보드 같은 다른 호출자가
   * 백엔드 없이 부를 수 있다).
   */
  readonly sandbox?: SandboxBackend;
  /** 격리 실행의 진행 문장(§6.4)을 받는다. 없으면 아무것도 내지 않는다. 시각과 걸린 시간은 싣지 않는다. */
  readonly progress?: (line: string) => void;
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
  notObserved: "격리가 켜지지 않아 행위를 관측하지 않았습니다.",
  noCompareHost: "--compare-host 를 주지 않아 격리 안팎의 도구 표면을 비교하지 않았습니다.",
} as const;

/** 게이트웨이가 요청 본문을 싣는 상한(바이트). 넘은 요청은 뒷부분을 카나리와 대조하지 못한다. */
const BODY_LIMIT_BYTES = 1_048_576;

/** 게이트웨이가 듣는 포트. 이 밖의 포트로 간 접속은 목적지 이름과 내용을 보지 못한다. */
const GATEWAY = "<gateway>";
const GATEWAY_PORTS: ReadonlySet<number> = new Set([53, 80, 443]);

/** skipped 의 가족 순서. 넣은 순서가 아니라 이 순서로 정렬해 결정론을 지킨다. */
const SKIPPED_ORDER: readonly RuleFamily[] = [
  "launch",
  "protocol",
  "result",
  "secret",
  "surface",
  "behavior",
  "network",
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
    case "call":
      return {
        kind: location.kind,
        toolIndex: location.toolIndex,
        toolName: location.toolName,
        callId: location.callId,
        path: location.path,
      };
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
  location.kind === "tool" || location.kind === "result" || location.kind === "call"
    ? location.toolIndex
    : -1;

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

/** 목록 단계에서 받은 표면. 연결을 닫은 뒤에도 쓰므로 한 번에 읽어 둔다. */
interface Listing {
  readonly tools: readonly RawTool[];
  readonly promptCount: number;
  readonly resourceCount: number;
  readonly instructions: string | undefined;
  readonly server: { readonly name: string; readonly version: string };
  readonly capabilityKeys: readonly string[];
  readonly listStrings: readonly CollectedString[];
}

async function listSurface(connection: AuditConnection): Promise<Listing> {
  const tools = await connection.listToolsRaw();
  const prompts = await connection.listPrompts();
  const resources = await connection.listResources();
  const instructions = connection.instructions;
  return {
    tools,
    promptCount: prompts.length,
    resourceCount: resources.length,
    instructions,
    server: connection.serverVersion,
    capabilityKeys: [...connection.capabilityKeys],
    // T1: collectStrings 결과를 복사하지 않고 그대로 넘긴다(위치 정보가 객체 동일성에 붙어 있다).
    listStrings: collectStrings({ tools, prompts, resources, instructions }),
  };
}

/** 목록만으로 판정하는 가족. launch 는 언제나 사용자가 준 원래 target 을 본다. */
function listFindings(listing: Listing, target: AuditTarget): Finding[] {
  return [
    ...runDescRules(listing.listStrings, { serverName: listing.server.name }),
    ...runSchemaRules(listing.tools),
    ...runFlowRules(listing.tools),
    ...runLaunchRules(target),
  ];
}

/** 감사 중 목록이 바뀌었는지 보려고 한 번 더 받는다. 다시 못 받으면 조용히 넘기지 않고 적는다. */
async function relistHash(
  connection: AuditConnection,
  listing: Listing,
  before: string,
  skipped: Skipped[],
): Promise<string> {
  try {
    return computeSurface(await connection.listToolsRaw(), listing.server).surfaceHash;
  } catch (error) {
    skipped.push({
      family: "protocol",
      reason: `도구 목록을 다시 받지 못해 감사 중 변경을 확인하지 못했습니다: ${firstLine(error)}`,
    });
    return before;
  }
}

/** protocol 가족과 surface 가족(기준 파일). 두 경로가 같은 순서로 쓴다. */
async function protocolAndBaseline(
  options: AuditOptions,
  deps: AuditDependencies,
  listing: Listing,
  messages: readonly ServerMessage[],
  before: ReturnType<typeof computeSurface>,
  surfaceHashAfter: string,
  skipped: Skipped[],
): Promise<Finding[]> {
  const { target } = options;
  if (target.kind === "stdio") skipped.push({ family: "protocol", reason: REASON.stdioProtocol });
  const findings = await runProtocolRules({
    target,
    fetch: deps.fetch,
    serverMessages: [...messages],
    listChanged: {
      notified: messages.some(
        (message) =>
          message.kind === "notification" && message.method === "notifications/tools/list_changed",
      ),
      surfaceHashBefore: before.surfaceHash,
      surfaceHashAfter,
    },
  });

  if (options.baselinePath === undefined)
    skipped.push({ family: "surface", reason: REASON.noBaseline });
  else
    findings.push(
      ...(await surfaceFindings(
        options.baselinePath,
        options.updateBaseline,
        before,
        listing.tools,
        target,
        deps,
      )),
    );
  return findings;
}

/** 리포트를 types.ts 선언 순서의 키로 세운다. `sandbox` 는 있을 때만 키가 생긴다. */
function assemble(input: {
  readonly deps: AuditDependencies;
  readonly listing: Listing;
  readonly probe: ProbePolicy;
  readonly probed: readonly string[];
  readonly sandbox: SandboxReport | undefined;
  readonly findings: readonly Finding[];
  readonly skipped: readonly Skipped[];
}): AuditReport {
  const { listing } = input;
  const finalFindings = finalize(input.findings);
  const counts = countOf(finalFindings);
  return {
    schemaVersion: AUDIT_SCHEMA_VERSION,
    generator: { name: "@mcpeak/audit", version: input.deps.generatorVersion },
    server: {
      name: listing.server.name,
      version: listing.server.version,
      toolCount: listing.tools.length,
      promptCount: listing.promptCount,
      resourceCount: listing.resourceCount,
      hasInstructions: listing.instructions !== undefined && listing.instructions !== "",
      capabilityKeys: [...listing.capabilityKeys],
    },
    probe: input.probe,
    probedTools: [...input.probed].sort(compareText),
    ...(input.sandbox === undefined ? {} : { sandbox: input.sandbox }),
    findings: finalFindings,
    skipped: orderSkipped(input.skipped),
    counts,
    exitCode: counts.high + counts.medium > 0 ? 2 : 0,
  };
}

/**
 * 연결이 선 뒤의 감사 전부(격리 없는 경로). 순서는 §12.7 그대로다. `unavailable` 은 격리를 요청했는데
 * 켜지지 않은 경우의 사유다. 그때는 리포트에 사유가 실리고 관측하지 않은 두 가족이 `skipped` 에 적힌다.
 */
async function inspect(
  options: AuditOptions,
  deps: AuditDependencies,
  connection: AuditConnection,
  plan: CanaryPlan,
  messages: readonly ServerMessage[],
  unavailable: SandboxUnavailable | undefined,
): Promise<AuditReport> {
  const { target } = options;
  const listing = await listSurface(connection);
  const findings = listFindings(listing, target);
  const skipped: Skipped[] = [];
  if (target.kind === "http") skipped.push({ family: "launch", reason: REASON.httpLaunch });

  const probe = await probeTools(connection.client, listing.tools, options.probe);
  skipped.push(...probe.skipped);
  findings.push(...runResultRules(probe.results, MAX_MESSAGE_BYTES));
  findings.push(
    ...runSecretRules(
      [...listing.listStrings, ...collectResultStrings(probe.results)],
      plan,
      deps.forwardedEnv,
    ),
  );

  const before = computeSurface(listing.tools, listing.server);
  const after = await relistHash(connection, listing, before.surfaceHash, skipped);
  findings.push(
    ...(await protocolAndBaseline(options, deps, listing, messages, before, after, skipped)),
  );

  if (unavailable !== undefined) {
    skipped.push({ family: "behavior", reason: REASON.notObserved });
    skipped.push({ family: "network", reason: REASON.notObserved });
  }

  return assemble({
    deps,
    listing,
    probe: options.probe,
    probed: probe.probed,
    sandbox: unavailable === undefined ? undefined : { status: "unavailable", reason: unavailable },
    findings,
    skipped,
  });
}

/**
 * 격리 없는 경로. 연결은 어떤 경로로 끝나도 닫는다. 감사 자체가 실패하면 그 오류가 이기고, 닫기
 * 실패는 그 뒤에 묻힌다(원인을 가리지 않게). 감사가 성공한 뒤의 닫기 실패는 그대로 올린다.
 */
async function auditDirect(
  options: AuditOptions,
  deps: AuditDependencies,
  plan: CanaryPlan,
  env: Readonly<Record<string, string>>,
  unavailable?: SandboxUnavailable,
): Promise<AuditReport> {
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
    report = await inspect(options, deps, connection, plan, messages, unavailable);
  } catch (error) {
    stop();
    await connection.close().catch(() => undefined);
    throw error;
  }
  stop();
  await connection.close();
  return report;
}

const UNAVAILABLE_CODES: Readonly<Record<SandboxUnavailableCode, true>> = {
  "docker-missing": true,
  "daemon-down": true,
  "unsupported-command": true,
  "image-build-failed": true,
  "start-failed": true,
};

/** `start` 가 던진 오류에 실린 사유. 없으면 격리 문제가 아니라 그대로 올릴 오류다. */
function unavailableIn(error: unknown): SandboxUnavailable | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const found = (error as { unavailable?: unknown }).unavailable;
  if (typeof found !== "object" || found === null) return undefined;
  const { code, detail } = found as { code?: unknown; detail?: unknown };
  if (typeof code !== "string" || !Object.hasOwn(UNAVAILABLE_CODES, code)) return undefined;
  return { code: code as SandboxUnavailableCode, detail: typeof detail === "string" ? detail : "" };
}

const commandName = (command: string) => command.slice(command.search(/[^/\\]*$/));

/**
 * 격리를 켠다. 켜지 못하면 사유를 돌려주고, 호출자는 격리 없는 경로로 돈다. 격리 이미지가 실행할 수
 * 없는 명령이면 docker 를 건드리지 않는다. 진행 문장은 격리를 실제로 띄우기 시작할 때부터 낸다.
 */
async function startSandbox(
  options: AuditOptions,
  requested: SandboxOptions,
  backend: SandboxBackend,
  env: Readonly<Record<string, string>>,
  deps: AuditDependencies,
): Promise<
  | { readonly unavailable: SandboxUnavailable }
  | { readonly handle: SandboxHandle; readonly home: HomePlan }
> {
  const { target } = options;
  const name = commandName(target.command ?? "");
  if (target.kind !== "stdio" || !backend.commands.includes(name))
    return { unavailable: { code: "unsupported-command", detail: name } };
  const detected = await backend.detect();
  if (!detected.ok) return { unavailable: detected.reason };

  const home = planHome(() => deps.random());
  const spec: SandboxSpec = {
    target,
    env,
    mountRoot: requested.mountRoot,
    cwd: requested.cwd,
    home,
    ...(requested.session === undefined ? {} : { session: requested.session }),
  };
  deps.progress?.("격리 컨테이너를 준비합니다.");
  try {
    return { handle: await backend.start(spec), home };
  } catch (error) {
    const unavailable = unavailableIn(error);
    if (unavailable === undefined) throw error;
    return { unavailable };
  }
}

/**
 * 격리 안에서 호출 계획대로 도구를 부른다(§3.3). 도구는 목록 순서, 도구 안에서는 계획 순서이고 전부
 * 직렬이다. `mark` 를 기다린 뒤에 호출을 보낸다. 그래야 관측이 그 호출에 붙는다. 전송이 실패한 호출
 * 뒤로는 그 도구의 남은 호출을 보내지 않는다.
 */
async function probeSandboxed(
  client: McpClient,
  tools: readonly RawTool[],
  policy: ProbePolicy,
  handle: SandboxHandle,
  progress: ((line: string) => void) | undefined,
): Promise<{ results: ToolCallResult[]; probed: string[]; skipped: Skipped[] }> {
  const results: ToolCallResult[] = [];
  const probed: string[] = [];
  const skipped: Skipped[] = [];
  if (policy === "none") {
    skipped.push({ family: "result", reason: REASON.probeNone });
    skipped.push({ family: "secret", reason: REASON.probeNone });
  } else if (!tools.some((tool) => shouldCall(policy, tool))) {
    skipped.push({ family: "result", reason: REASON.noReadOnly });
    skipped.push({ family: "secret", reason: REASON.noReadOnly });
  }
  for (const [toolIndex, tool] of tools.entries()) {
    // 이름은 서버가 보낸 글자다. 진행 문장으로 터미널을 조작하지 못하게 표기로 바꾼다.
    const subject = `[${toolIndex + 1}/${tools.length}] 도구 '${escapeInvisible(tool.name)}'`;
    if (!shouldCall(policy, tool)) {
      progress?.(`${subject} 은 호출하지 않습니다(호출 정책).`);
      continue;
    }
    const planned = planCalls(tool);
    if (planned.calls.length === 0) {
      skipped.push({
        family: "result",
        reason: `도구 '${tool.name}' 은 인자를 만들 수 없어 호출하지 않았습니다: ${planned.skipped ?? ""}`,
      });
      progress?.(`${subject} 은 호출하지 않습니다(인자를 만들 수 없음).`);
      continue;
    }
    if (planned.skipped !== undefined)
      skipped.push({ family: "behavior", reason: planned.skipped });
    progress?.(`${subject} 을 호출합니다(${planned.calls.length}회).`);
    probed.push(tool.name);
    for (const [index, call] of planned.calls.entries()) {
      const { callId } = call;
      await handle.mark({ kind: "call", toolIndex, toolName: tool.name, callId });
      const result = await callTool(client, tool, toolIndex, { ...call.args });
      results.push({ ...result, callId });
      if (result.outcome !== "error") continue;
      const rest = planned.calls.length - index - 1;
      if (rest > 0)
        skipped.push({
          family: "result",
          reason: `도구 '${tool.name}' 호출(${callId}) 뒤 서버 연결이 끊겨 남은 호출 ${rest}개를 보내지 않았습니다.`,
        });
      break;
    }
  }
  return { results, probed, skipped };
}

/** 관측에서 읽지 못했거나 보지 못한 것을 `skipped` 문장으로 옮긴다. 조용한 "발견 0" 을 막는다. */
function observationSkipped(observation: Observation): Skipped[] {
  const skipped: Skipped[] = [];
  const gapsOf = (source: "trace" | "gateway") => [
    ...new Set(observation.gaps.filter((gap) => gap.source === source).map((gap) => gap.reason)),
  ];
  for (const reason of gapsOf("trace"))
    skipped.push({
      family: "behavior",
      reason: `시스템 콜 기록을 읽지 못해 파일·프로세스·접속 관측이 비었습니다: ${reason}`,
    });
  const unparsed = observation.unparsedLines ?? 0;
  if (unparsed > 0)
    skipped.push({
      family: "behavior",
      reason: `시스템 콜 기록 ${unparsed}줄을 해석하지 못했습니다. 그 줄의 행위는 판정에서 빠졌습니다.`,
    });
  for (const reason of gapsOf("gateway"))
    skipped.push({
      family: "network",
      reason: `게이트웨이 기록을 읽지 못해 나가는 요청 관측이 비었습니다: ${reason}`,
    });
  // 잡음 표가 게이트웨이의 53·80·443 만 빼므로, 남은 게이트웨이 접속은 듣는 쪽이 없던 포트다.
  const ports = new Set<number>();
  for (const event of observation.events)
    if (event.kind === "connect" && event.address === GATEWAY && !GATEWAY_PORTS.has(event.port))
      ports.add(event.port);
  for (const port of [...ports].sort((left, right) => left - right))
    skipped.push({
      family: "network",
      reason: `게이트웨이가 듣지 않는 포트 ${port} 로 접속을 시도했습니다. 목적지 이름과 내용은 보지 못했습니다.`,
    });
  const truncated = observation.requests.filter((request) => request.bodyTruncated).length;
  if (truncated > 0)
    skipped.push({
      family: "network",
      reason: `요청 ${truncated}개의 본문이 ${BODY_LIMIT_BYTES} 바이트를 넘어 뒷부분은 카나리와 대조하지 못했습니다.`,
    });
  return skipped;
}

/** 대조용 호스트 이름. 소문자이고 끝의 점이 없다(`network` 규칙과 같다). */
const normalizeHost = (host: string) => host.toLowerCase().replace(/\.$/, "");

/** 선언 목록과의 맞춤(§3.6). 정확히 같거나, `*.` 항목이면 레이블 경계의 뒤 일치다(`network` 규칙과 같다). */
function isDeclaredHost(host: string, declaredHosts: readonly string[]): boolean {
  return declaredHosts.some((entry) => {
    const declared = entry.toLowerCase();
    return declared.startsWith("*.") ? host.endsWith(declared.slice(1)) : host === declared;
  });
}

interface CanaryMask {
  readonly value: string;
  readonly placeholder: string;
  readonly needles: readonly Needle[];
  /** `normalizeText` 가 만든 형들과 대조할, 같은 방식으로 접은 값. */
  readonly folded: string;
}

const foldedOf = (text: string) =>
  normalizeText(text).forms.find((entry) => entry.form === "folded")?.text ?? "";

function masksOf(canaries: readonly CanaryValue[]): CanaryMask[] {
  return canaries
    .filter((canary) => canary.value !== "")
    .map((canary) => ({
      value: canary.value,
      placeholder: `<canary:${canary.name}>`,
      needles: needlesFor(canary.value),
      folded: foldedOf(canary.value),
    }));
}

/** 퍼센트 인코딩을 푼 것. 풀리지 않는 조각은 그대로 둔다. */
function percentDecoded(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

/** 그 카나리가 문자열에 실려 있는가. `network` 규칙의 대조와 같은 범위다(네 형, 퍼센트 인코딩, 접은 형). */
function carries(text: string, mask: CanaryMask): boolean {
  if (text === "") return false;
  const decoded = percentDecoded(text);
  const variants = decoded === text ? [text] : [text, decoded];
  if (variants.some((variant) => findForm(variant, mask.needles) !== undefined)) return true;
  if (mask.folded === "") return false;
  return variants.some((variant) =>
    normalizeText(variant).forms.some(
      (entry) => entry.form !== "raw" && entry.text.includes(mask.folded),
    ),
  );
}

/** 값이 글자 그대로 나온 자리를 자리표로 바꾼다. 대소문자는 가리지 않는다(호스트는 소문자로 온다). */
function replaceLiteral(text: string, value: string, placeholder: string): string {
  const lower = text.toLowerCase();
  // 소문자로 바꿀 때 길이가 달라지는 글자가 있으면 자리가 어긋난다. 그때는 글자 그대로만 찾는다.
  if (lower.length !== text.length) return text.split(value).join(placeholder);
  const needle = value.toLowerCase();
  let shown = "";
  let cursor = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, cursor)) {
    shown += text.slice(cursor, at) + placeholder;
    cursor = at + needle.length;
  }
  return shown + text.slice(cursor);
}

/**
 * 리포트의 요청 요약에 싣는 호스트와 경로에서 카나리를 가린다. 서버가 값을 쿼리나 하위 도메인에 실어
 * 보내면 그 문자열이 그대로 리포트에 들어가기 때문이다. 글자 그대로 나온 값은 `<canary:NAME>` 으로
 * 바꾸고, 그래도 값이 찾아지면(인코딩해 실은 경우) 문자열을 통째로 자리표로 바꾼다. 인코딩한 값의
 * 가장자리를 남기는 것보다 문맥을 잃는 쪽이 낫다. 발견의 문장이 그 요청을 이미 말한다.
 */
function maskCanaries(
  text: string,
  masks: readonly CanaryMask[],
  compact: (shown: string) => string = (shown) => shown,
): string {
  let shown = text;
  for (const mask of masks) shown = replaceLiteral(shown, mask.value, mask.placeholder);
  const left = masks.filter((mask) => carries(compact(shown), mask));
  return left.length === 0 ? shown : left.map((mask) => mask.placeholder).join(" ");
}

/** 카나리는 호스트 이름의 레이블 여럿에 나뉘어 실릴 수 있어서 점을 빼고 찾는다. */
const withoutDots = (name: string) => name.replaceAll(".", "");

/**
 * 요청 요약(§4). `(host, port, method, path)` 순으로 정렬하고 같은 것은 횟수로 접는다. 도착 순서는
 * 네트워크 지연에 좌우되므로 쓰지 않는다.
 */
function summarizeRequests(
  requests: readonly ObservedRequest[],
  declaredHosts: readonly string[],
  canaries: readonly CanaryValue[],
): RequestSummary[] {
  const masks = masksOf(canaries);
  const folded = new Map<string, RequestSummary>();
  for (const request of requests) {
    const host = normalizeHost(request.host);
    const summary: RequestSummary = {
      host: maskCanaries(host, masks, withoutDots),
      port: request.port,
      method: request.method,
      path: maskCanaries(request.path, masks),
      count: 1,
      declared: isDeclaredHost(host, declaredHosts),
    };
    const key = JSON.stringify([
      summary.host,
      summary.port,
      summary.method,
      summary.path,
      summary.declared,
    ]);
    const seen = folded.get(key);
    folded.set(key, seen === undefined ? summary : { ...seen, count: seen.count + 1 });
  }
  return [...folded.values()].sort(
    (left, right) =>
      compareText(left.host, right.host) ||
      left.port - right.port ||
      compareText(left.method, right.method) ||
      compareText(left.path, right.path) ||
      Number(left.declared) - Number(right.declared),
  );
}

/**
 * 이 머신에서 서버를 한 번 더 띄워 목록만 받고 격리 안의 표면과 비교한다(§3.2 의 10). 호출은 하지
 * 않는다. 서버에는 카나리 env 가 간다. 띄우지 못하면 발견이 아니라 `skipped` 다.
 */
async function compareWithHost(
  options: AuditOptions,
  deps: AuditDependencies,
  env: Readonly<Record<string, string>>,
  inside: ReturnType<typeof computeSurface>,
  skipped: Skipped[],
): Promise<Finding[]> {
  try {
    const host = await deps.connect(options.target, env, ADVERTISE_ALL);
    let outside: ReturnType<typeof computeSurface>;
    try {
      outside = computeSurface(await host.listToolsRaw(), host.serverVersion);
    } catch (error) {
      await host.close().catch(() => undefined);
      throw error;
    }
    await host.close();
    return compareEnvironmentSurface(inside, outside);
  } catch (error) {
    skipped.push({
      family: "surface",
      reason: `이 머신에서 서버를 띄우지 못해 격리 안팎의 도구 표면을 비교하지 못했습니다: ${firstLine(error)}`,
    });
    return [];
  }
}

interface SandboxRun {
  readonly options: AuditOptions;
  readonly requested: SandboxOptions;
  readonly deps: AuditDependencies;
  readonly backend: SandboxBackend;
  readonly handle: SandboxHandle;
  readonly plan: CanaryPlan;
  readonly home: HomePlan;
  /** 카나리 env 와 전달한 env 의 합. 격리 안의 서버와, 비교용으로 이 머신에 띄우는 서버가 받는다. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * 격리 안의 감사 전부. 순서는 §3.2 의 4~12 다. `connection` 은 `handle.launchTarget` 으로 선 것이고,
 * 규칙은 그것이 아니라 사용자가 준 원래 target 을 본다. 연결은 관측을 모으기 전에 여기서 닫는다
 * (`close`). 종료 단계의 행위까지 봐야 하기 때문이다.
 */
async function inspectSandboxed(
  run: SandboxRun,
  connection: AuditConnection,
  messages: readonly ServerMessage[],
  close: () => Promise<void>,
): Promise<AuditReport> {
  const { options, requested, deps, handle, plan, home } = run;
  const { target } = options;
  const policy = requested.probe;
  const mode: SandboxNetworkMode = requested.session?.mode ?? "live";

  await handle.mark({ kind: "list" });
  const listing = await listSurface(connection);
  const findings = listFindings(listing, target);
  const skipped: Skipped[] = [];
  deps.progress?.(`도구 ${listing.tools.length}개를 받았습니다. 호출을 시작합니다.`);

  const probe = await probeSandboxed(
    connection.client,
    listing.tools,
    policy,
    handle,
    deps.progress,
  );
  skipped.push(...probe.skipped);
  const resultStrings = collectResultStrings(probe.results);
  findings.push(...runResultRules(probe.results, MAX_MESSAGE_BYTES));
  findings.push(
    ...runSecretRules([...listing.listStrings, ...resultStrings], plan, deps.forwardedEnv),
  );

  await handle.mark({ kind: "list" });
  const before = computeSurface(listing.tools, listing.server);
  const after = await relistHash(connection, listing, before.surfaceHash, skipped);

  await close();
  await handle.mark({ kind: "shutdown" });
  deps.progress?.("관측을 모으고 격리 자원을 정리합니다.");

  // 사건은 백엔드가 준 순서 그대로 넘긴다. 잡음 표의 첫 exec 행이 그 순서에 기댄다.
  const observation = filterNoise(await handle.snapshot(), {
    mountRoot: requested.mountRoot,
    command: target.command ?? "",
  });
  skipped.push(...observationSkipped(observation));

  const declaredHosts = extractDeclaredHosts({
    allowHosts: requested.allowHosts,
    surfaceStrings: listing.listStrings,
    declarationTexts: requested.declarationTexts,
  });
  const canaries: CanaryValue[] = [
    ...plan.names.map((name) => ({ origin: "env" as const, name, value: plan.env[name] ?? "" })),
    ...home.files.flatMap((file) =>
      file.canary === undefined
        ? []
        : [{ origin: "file" as const, name: `~/${file.path}`, value: file.canary }],
    ),
  ];
  const network: NetworkContext = { observation, declaredHosts, canaries, mode };
  findings.push(...runNetworkRules(network));
  findings.push(
    ...runBehaviorRules({
      observation,
      tools: listing.tools,
      calls: probe.results.map(({ toolIndex, toolName, callId, outcome }) => ({
        toolIndex,
        toolName,
        callId: callId ?? "",
        outcome,
      })),
      resultStrings,
      // 유출 발견이 읽은 파일을 이미 말한다. 파일 카나리만 넘긴다. 이름은 `~/<HomeFile.path>` 꼴이다.
      exfiltrated: exfiltratedCanaries(network)
        .filter((entry) => entry.origin === "file")
        .map(({ toolIndex, name }) => ({ toolIndex, name })),
      home,
      mountRoot: requested.mountRoot,
    }),
  );

  if (requested.compareHost)
    findings.push(...(await compareWithHost(options, deps, run.env, before, skipped)));
  else skipped.push({ family: "surface", reason: REASON.noCompareHost });

  findings.push(
    ...(await protocolAndBaseline(options, deps, listing, messages, before, after, skipped)),
  );

  return assemble({
    deps,
    listing,
    probe: policy,
    probed: probe.probed,
    sandbox: {
      status: "ran",
      backend: run.backend.name,
      image: handle.image,
      network: mode,
      compareHost: requested.compareHost,
      callCount: probe.results.length,
      declaredHosts,
      requests: summarizeRequests(observation.requests, declaredHosts, canaries),
    },
    findings,
    skipped,
  });
}

/** 격리 안의 서버에 붙어 감사한다. 연결은 어떤 경로로 끝나도 한 번 닫는다. */
async function connectAndInspect(run: SandboxRun): Promise<AuditReport> {
  const { handle } = run;
  let connection: AuditConnection;
  try {
    connection = await run.deps.connect(handle.launchTarget, handle.launchEnv, ADVERTISE_ALL);
  } catch (cause) {
    // 문장은 사용자가 준 명령을 말한다. docker run 의 인자에는 실행별 이름과 임시 경로가 있다.
    throw connectFailed(run.options.target, cause);
  }
  const messages: ServerMessage[] = [];
  const stop = connection.observeServerMessages((message) => messages.push(message));
  let open = true;
  const close = async () => {
    if (!open) return;
    open = false;
    stop();
    await connection.close();
  };
  try {
    return await inspectSandboxed(run, connection, messages, close);
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

/**
 * 격리 경로. `handle.destroy()` 는 어떤 경로로 끝나도 부른다. 감사 오류가 있으면 그 오류가 이기고
 * 정리 실패는 그 뒤에 묻힌다. 감사가 성공했는데 정리가 실패하면 리포트를 실은 오류를 던진다. 발견을 본
 * 사용자가 정리 실패 때문에 그 발견을 잃으면 안 된다.
 */
async function auditSandboxed(run: SandboxRun): Promise<AuditReport> {
  let report: AuditReport;
  try {
    report = await connectAndInspect(run);
  } catch (error) {
    await run.handle.destroy().catch(() => undefined);
    throw error;
  }
  try {
    await run.handle.destroy();
  } catch (error) {
    throw new SandboxCleanupError(error instanceof Error ? error.message : String(error), report);
  }
  return report;
}

/**
 * 서버 하나를 점검한다. `options.sandbox` 와 `deps.sandbox` 가 둘 다 있고 격리가 실제로 켜지면 격리
 * 안에서 돈다. 그 밖의 모든 경우는 격리 없는 경로 그대로다. 격리를 요청했는데 켜지지 않았으면 리포트의
 * `sandbox` 에 사유가 실린다.
 */
export async function audit(options: AuditOptions, deps: AuditDependencies): Promise<AuditReport> {
  const plan = planCanaries(options.target.forwardedEnvNames, () => deps.random());
  const env = { ...plan.env, ...deps.forwardedEnv };
  const backend = deps.sandbox;
  const requested = options.sandbox;
  if (backend === undefined || requested === undefined)
    return auditDirect(options, deps, plan, env);

  const started = await startSandbox(options, requested, backend, env, deps);
  if ("unavailable" in started) return auditDirect(options, deps, plan, env, started.unavailable);
  return auditSandboxed({
    options,
    requested,
    deps,
    backend,
    handle: started.handle,
    plan,
    home: started.home,
    env,
  });
}
