import type {
  CollectedString,
  Finding,
  HomePlan,
  Location,
  Observation,
  RawTool,
  RuleId,
  RuleInfo,
  SandboxPhase,
  Severity,
  SyscallEvent,
} from "../types.js";
import { escapeInvisible } from "./description.js";
import { findForm, type Needle, needlesFor } from "./secret.js";

export const BEHAVIOR_RULES: readonly RuleInfo[] = [
  {
    id: "behavior/file-canary-read",
    family: "behavior",
    defaultSeverity: "medium",
    summary: "격리 홈에 심은 자격 증명 파일을 서버가 여는지 본다.",
  },
  {
    id: "behavior/internal-address",
    family: "behavior",
    defaultSeverity: "medium",
    summary: "서버가 클라우드 메타데이터·사내망·루프백 주소로 접속을 시도하는지 본다.",
  },
  {
    id: "behavior/child-process",
    family: "behavior",
    defaultSeverity: "low",
    summary: "서버가 자식 프로세스를 띄우는지 본다.",
  },
  {
    id: "behavior/annotation-violation",
    family: "behavior",
    defaultSeverity: "high",
    summary: "readOnlyHint·destructiveHint 주석과 어긋나는 쓰기·삭제·실행이 호출 중에 있는지 본다.",
  },
  {
    id: "behavior/write-outside",
    family: "behavior",
    defaultSeverity: "medium",
    summary: "서버가 임시 디렉터리 밖에 쓰거나 지우거나 옮기려 하는지 본다.",
  },
  {
    id: "behavior/observation-tampered",
    family: "behavior",
    defaultSeverity: "high",
    summary: "서버가 점검용 시스템 콜 기록을 건드리는지 본다.",
  },
];

export interface BehaviorContext {
  /** `filterNoise` 를 거친 것. */
  readonly observation: Observation;
  /** annotations 를 읽는다(readOnlyHint). */
  readonly tools: readonly RawTool[];
  readonly calls: ReadonlyArray<{
    readonly toolIndex: number;
    readonly toolName: string;
    readonly callId: string;
    readonly outcome: "ok" | "timeout" | "error";
  }>;
  /** 호출 응답에서 모은 문자열(collectResultStrings). 파일 카나리가 응답에 나왔는지 본다. */
  readonly resultStrings: readonly CollectedString[];
  /** 같은 도구에서 나가는 요청에 실린 파일 카나리. 그 파일의 읽기 발견은 내지 않는다. */
  readonly exfiltrated: ReadonlyArray<{ readonly toolIndex: number; readonly name: string }>;
  readonly home: HomePlan;
  readonly mountRoot: string;
}

type RuleName =
  | "file-canary-read"
  | "internal-address"
  | "child-process"
  | "annotation-violation"
  | "write-outside"
  | "observation-tampered";

type Stage = Exclude<SandboxPhase["kind"], "call">;

/** 접기 전의 관측 하나. 같은 (규칙, 도구) 의 것들이 발견 한 건으로 접힌다. */
interface Hit {
  readonly rule: RuleName;
  readonly phase: SandboxPhase;
  /** 경로, `주소:포트`, argv 를 이은 앞 80자. 보이지 않는 문자는 이미 표기로 바뀌어 있다. */
  readonly target: string;
  readonly severity: Severity;
  readonly message: string;
  readonly fix: string;
  /** 단계를 알 수 없는 관측(줄 수 감소)이 evidence 둘째 칸에 대신 적는 말. */
  readonly note?: string;
}

const HOME_DIR = "/home/node";
const TMP_DIR = "/tmp";
const TRACE_DIR = "/var/mcpeak";
const TRACE_FILE = `${TRACE_DIR}/trace`;

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { high: 3, medium: 2, low: 1, info: 0 };

const STAGE_ORDER: readonly Stage[] = ["start", "list", "shutdown"];
const STAGE_LABEL: Readonly<Record<Stage, string>> = {
  start: "시작",
  list: "목록",
  shutdown: "종료",
};

/** §3.4 의 셸·다운로드·패키지 실행기 표(basename). */
const LAUNCHERS: ReadonlySet<string> = new Set([
  "sh",
  "bash",
  "dash",
  "zsh",
  "curl",
  "wget",
  "nc",
  "ncat",
  "python",
  "python3",
  "perl",
  "ruby",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "pip",
  "pip3",
  "apt",
  "apt-get",
  "ssh",
  "scp",
  "git",
]);

const FIX = {
  canaryRead:
    "이 도구의 기능에 그 파일이 필요한지 확인하세요. 필요 없다면 등록하지 마세요. 실제 머신에서는 진짜 자격 증명이 읽힙니다.",
  canaryReturned:
    "서버가 자격 증명을 읽어 모델에게 돌려줍니다. 받는 경로를 허용 디렉터리 안으로 좁히지 않았다면 등록하지 마세요.",
  internalAddress:
    "클라우드 메타데이터나 사내망에 닿으려는 모양입니다. 도구가 받는 주소를 서버가 검증하는지 확인하세요.",
  childProcess:
    "셸이나 다운로드 도구를 띄우는 서버는 명령 주입의 입구입니다. 이 실행이 도구의 기능인지 확인하세요.",
  annotation:
    "클라이언트는 이 주석을 믿고 확인 없이 실행합니다. 주석을 false 로 고치거나 등록하지 마세요.",
  writeOutside:
    "격리 안이라 막혔습니다. 실제 머신에서는 써집니다. 이 경로에 쓰는 것이 도구의 기능인지 확인하세요.",
  tampered:
    "점검을 알아채고 흔적을 지우려는 행동입니다. 이 실행의 다른 관측은 믿을 수 없습니다. 등록하지 마세요.",
} as const;

const TAMPERED_MESSAGE = "서버가 점검 기록(/var/mcpeak)을 건드렸습니다";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const compare = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1);

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

const isUnder = (path: string, directory: string): boolean =>
  path === directory || path.startsWith(`${directory}/`);

/** §6.2 의 `<경로>`. 홈 아래면 `~/…`, 그 밖은 컨테이너 안 절대 경로. 서버가 고른 글자라 표기로 바꿔 싣는다. */
function displayPath(path: string): string {
  const shown = isUnder(path, HOME_DIR) ? `~${path.slice(HOME_DIR.length)}` : path;
  return escapeInvisible(shown);
}

/** argv 를 공백으로 이은 앞 80자. */
function argvHead(event: Extract<SyscallEvent, { kind: "exec" }>): string {
  const joined = event.argv.length > 0 ? event.argv.join(" ") : event.path;
  return escapeInvisible(joined.slice(0, 80));
}

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return bytes.every((byte) => byte >= 0 && byte <= 255) ? bytes : undefined;
}

/** IPv6 문자열을 16비트 조각 여덟으로 편다. `::` 와 끝의 IPv4 표기를 받는다. */
function parseIpv6(address: string): number[] | undefined {
  let text = address;
  const lastColon = text.lastIndexOf(":");
  if (text.includes(".")) {
    const embedded = parseIpv4(text.slice(lastColon + 1));
    if (embedded === undefined) return undefined;
    const [a, b, c, d] = embedded as [number, number, number, number];
    text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const groups = (half: string | undefined): number[] | undefined => {
    if (half === undefined || half === "") return [];
    const values = half
      .split(":")
      .map((part) => (/^[0-9a-fA-F]{1,4}$/.test(part) ? Number.parseInt(part, 16) : Number.NaN));
    return values.every((value) => !Number.isNaN(value)) ? values : undefined;
  };
  const head = groups(halves[0]);
  const tail = groups(halves[1]);
  if (head === undefined || tail === undefined) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  return missing < 1 ? undefined : [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/** §3.4 의 내부 주소 표 가운데 IPv4 쪽. 링크 로컬(클라우드 메타데이터)이면 "link-local". */
function classifyIpv4(bytes: readonly number[]): "link-local" | "internal" | undefined {
  const [a, b] = bytes as [number, number];
  if (a === 169 && b === 254) return "link-local";
  if (a === 10 || a === 127) return "internal";
  if (a === 172 && b >= 16 && b <= 31) return "internal";
  if (a === 192 && b === 168) return "internal";
  return undefined;
}

/**
 * 내부 주소 표: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`,
 * `fc00::/7`, `fe80::/10`. `<gateway>` 는 자리표라 주소로 읽히지 않아 표에 들지 않는다. IPv4 를 담은
 * IPv6(`::ffff:a.b.c.d`)는 그 IPv4 로 본다. 같은 목적지를 다른 표기로 적어 표를 비켜 가지 못하게 한다.
 */
function classifyAddress(
  family: "inet" | "inet6",
  address: string,
): "link-local" | "internal" | undefined {
  if (family === "inet") {
    const bytes = parseIpv4(address);
    return bytes === undefined ? undefined : classifyIpv4(bytes);
  }
  const groups = parseIpv6(address);
  if (groups === undefined) return undefined;
  const [first] = groups as [number];
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return "internal";
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return "internal";
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high, low] = groups.slice(6) as [number, number];
    return classifyIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
  }
  return undefined;
}

function annotationsOf(tool: RawTool | undefined): Record<string, unknown> {
  return tool !== undefined && isObject(tool.annotations) ? tool.annotations : {};
}

/** 호출 단계면 그 도구 번호, 아니면 undefined(서버 전체). */
const toolIndexOf = (phase: SandboxPhase): number | undefined =>
  phase.kind === "call" ? phase.toolIndex : undefined;

/**
 * 관측 하나하나를 규칙에 대 본다. 접기와 서로 덮는 규칙(유출이 읽기를, 주석 위반이 임시 디렉터리 밖 쓰기를
 * 덮는다)은 뒤에서 한다.
 */
function collectHits(context: BehaviorContext): Hit[] {
  const hits: Hit[] = [];

  // 파일 카나리: 컨테이너 안 절대 경로 → (홈 기준 이름, 값의 바늘).
  const canaryFiles = new Map<string, { readonly name: string; readonly needles: Needle[] }>();
  for (const file of context.home.files) {
    if (file.canary === undefined) continue;
    canaryFiles.set(`${HOME_DIR}/${file.path}`, {
      name: `~/${file.path}`,
      needles: needlesFor(file.canary),
    });
  }
  const exfiltrated = new Set(
    context.exfiltrated.map((entry) => `${entry.toolIndex}\0${entry.name}`),
  );
  /** 그 카나리 값이 같은 도구의 호출 응답 문자열에 나오는가. */
  const returnedBy = (toolIndex: number, needles: readonly Needle[]): boolean =>
    context.resultStrings.some(
      (entry) =>
        "toolIndex" in entry.location &&
        entry.location.toolIndex === toolIndex &&
        findForm(entry.raw, needles) !== undefined,
    );

  for (const event of context.observation.events) {
    const { phase } = event;
    const toolIndex = toolIndexOf(phase);
    const annotations = toolIndex === undefined ? {} : annotationsOf(context.tools[toolIndex]);
    const readOnly = annotations.readOnlyHint === true;
    const nonDestructive = annotations.destructiveHint === false;

    if (event.kind === "open") {
      const canary = event.result === "ok" ? canaryFiles.get(event.path) : undefined;
      if (
        canary !== undefined &&
        !(toolIndex !== undefined && exfiltrated.has(`${toolIndex}\0${canary.name}`))
      ) {
        const returned = toolIndex !== undefined && returnedBy(toolIndex, canary.needles);
        const shown = displayPath(event.path);
        hits.push({
          rule: "file-canary-read",
          phase,
          target: shown,
          severity: returned ? "high" : "medium",
          message: returned
            ? `자격 증명 파일 ${shown} 를 열었고 그 내용이 호출 응답에 나왔습니다`
            : `자격 증명 파일 ${shown} 를 열었습니다`,
          fix: returned ? FIX.canaryReturned : FIX.canaryRead,
        });
      }
    }

    if (event.kind === "connect" && event.family !== "unix") {
      const range = classifyAddress(event.family, event.address);
      if (range !== undefined) {
        const host = event.family === "inet6" ? `[${event.address}]` : event.address;
        const target = escapeInvisible(`${host}:${event.port}`);
        hits.push({
          rule: "internal-address",
          phase,
          target,
          severity: range === "link-local" ? "high" : "medium",
          message: `내부 주소 ${target} 에 접속을 시도했습니다`,
          fix: FIX.internalAddress,
        });
      }
    }

    if (event.kind === "exec" && event.result === "ok") {
      const name = basename(event.path);
      const head = argvHead(event);
      // 우리가 넣은 둘째 명령(`mcpeak; id`)이 실행됐다는 뜻이다.
      const injected =
        phase.kind === "call" && phase.callId.endsWith(":separator") && name === "id";
      hits.push({
        rule: "child-process",
        phase,
        target: head,
        severity: injected ? "high" : LAUNCHERS.has(name) ? "medium" : "low",
        message: `자식 프로세스를 띄웠습니다: ${head}`,
        fix: FIX.childProcess,
      });
      if (readOnly)
        hits.push({
          rule: "annotation-violation",
          phase,
          target: head,
          severity: "high",
          message: `readOnlyHint 가 true 인데 호출 중 프로세스를 띄웠습니다: ${head}`,
          fix: FIX.annotation,
        });
    }

    // 쓰기 열기와 지우기·옮기기. 시도만으로 본다(격리 안이라 대부분 denied 로 끝난다).
    const attempted =
      (event.kind === "open" && event.write) || event.kind === "alter"
        ? event.result === "ok" || event.result === "denied"
        : false;
    if (attempted && (event.kind === "open" || event.kind === "alter")) {
      const shown = displayPath(event.path);
      const verb =
        event.kind === "open"
          ? "에 쓰려"
          : event.via === "unlink" || event.via === "rmdir"
            ? "를 지우려"
            : "를 옮기려";
      if (isUnder(event.path, TRACE_DIR)) {
        hits.push({
          rule: "observation-tampered",
          phase,
          target: shown,
          severity: "high",
          message: TAMPERED_MESSAGE,
          fix: FIX.tampered,
        });
      }
      if (!isUnder(event.path, TMP_DIR)) {
        // destructiveHint 가 false 라는 선언은 지우기·옮기기만 말한다. 쓰기 열기는 readOnlyHint 의 몫이다.
        const hint = readOnly
          ? "readOnlyHint 가 true"
          : nonDestructive && event.kind === "alter"
            ? "destructiveHint 가 false"
            : undefined;
        if (hint !== undefined)
          hits.push({
            rule: "annotation-violation",
            phase,
            target: shown,
            severity: "high",
            message: `${hint} 인데 호출 중 ${shown} ${verb} 했습니다`,
            fix: FIX.annotation,
          });
        // 기록 디렉터리를 건드린 것은 observation-tampered 가 더 무겁게 말한다.
        if (!isUnder(event.path, TRACE_DIR))
          hits.push({
            rule: "write-outside",
            phase,
            target: shown,
            severity: "medium",
            message: `임시 디렉터리 밖 ${shown} ${verb} 했습니다`,
            fix: FIX.writeOutside,
          });
      }
    }
  }

  // 줄 수가 준 것은 누가 언제 했는지 알 수 없다. 쓰기·삭제 사건이 이미 그 사실을 말하면 더 내지 않는다.
  if (context.observation.traceShrank && !hits.some((hit) => hit.rule === "observation-tampered"))
    hits.push({
      rule: "observation-tampered",
      phase: { kind: "start" },
      target: TRACE_FILE,
      severity: "high",
      message: TAMPERED_MESSAGE,
      fix: FIX.tampered,
      note: "시스템 콜 기록의 줄 수가 줄었습니다",
    });

  return hits;
}

/**
 * 같은 (규칙, 도구) 의 관측을 발견 한 건으로 접는다(§3.4). 심각도는 그 안의 최댓값, 위치는 계획 순서로 첫
 * 호출이다. 호출이 아닌 단계의 관측은 도구 자리가 서버 전체다. 문장은 가장 심각한 관측의 것을 쓴다.
 * `evidence` 는 정렬한 대상의 첫째, `호출: …`(계획 순서) 또는 `단계: …`, 나머지 대상 둘까지, 그리고 더
 * 있으면 `외 <n>개` 다. 사건의 순서에는 기대지 않는다.
 */
function fold(hits: readonly Hit[], context: BehaviorContext): Finding {
  const first = hits[0] as Hit;
  const headline = [...hits].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      compare(a.target, b.target) ||
      compare(a.message, b.message),
  )[0] as Hit;
  const targets = [...new Set(hits.map((hit) => hit.target))].sort(compare);

  let location: Location = { kind: "server", path: "" };
  let where: string;
  if (first.phase.kind === "call") {
    const { toolIndex, toolName } = first.phase;
    const planned = context.calls
      .filter((call) => call.toolIndex === toolIndex)
      .map((call) => call.callId);
    const order = (callId: string): number => {
      const index = planned.indexOf(callId);
      return index < 0 ? planned.length : index;
    };
    const callIds = [
      ...new Set(hits.flatMap((hit) => (hit.phase.kind === "call" ? [hit.phase.callId] : []))),
    ].sort((a, b) => order(a) - order(b) || compare(a, b));
    location = { kind: "call", toolIndex, toolName, callId: callIds[0] as string, path: "" };
    where = `호출: ${callIds.map(escapeInvisible).join(", ")}`;
  } else {
    const stages = new Set(hits.map((hit) => hit.phase.kind));
    where =
      headline.note ??
      `단계: ${STAGE_ORDER.filter((stage) => stages.has(stage))
        .map((stage) => STAGE_LABEL[stage])
        .join(", ")}`;
  }

  return {
    ruleId: `behavior/${first.rule}` satisfies RuleId,
    severity: headline.severity,
    location,
    message: headline.message,
    fix: headline.fix,
    evidence: [
      targets[0] as string,
      where,
      ...targets.slice(1, 3),
      ...(targets.length > 3 ? [`외 ${targets.length - 3}개`] : []),
    ],
  };
}

/**
 * `behavior` 가족. 입력은 `filterNoise` 를 거친 관측과 호출 목록이고, 시각과 사건의 순서에 기대지 않는다.
 * 결과는 서버 전체, 도구 번호, 규칙 id 순이다.
 */
export function runBehaviorRules(context: BehaviorContext): Finding[] {
  const groups = new Map<string, { readonly tool: number; readonly rule: RuleName; hits: Hit[] }>();
  for (const hit of collectHits(context)) {
    const tool = toolIndexOf(hit.phase) ?? -1;
    const key = `${tool}\0${hit.rule}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { tool, rule: hit.rule, hits: [hit] });
    else group.hits.push(hit);
  }
  // 주석 위반이 난 도구의 임시 디렉터리 밖 쓰기는 따로 내지 않는다. 위반 발견이 그 쓰기를 이미 말한다.
  const violators = new Set(
    [...groups.values()]
      .filter((group) => group.rule === "annotation-violation")
      .map((group) => group.tool),
  );
  return [...groups.values()]
    .filter((group) => !(group.rule === "write-outside" && violators.has(group.tool)))
    .sort((a, b) => a.tool - b.tool || compare(a.rule, b.rule))
    .map((group) => fold(group.hits, context));
}
