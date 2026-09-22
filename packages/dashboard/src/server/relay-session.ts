import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { CLAUDE_ENV_ALLOWLIST, runProviderProcess } from "@mcpeak/generate";
import { relayBinPath } from "@mcpeak/mock";
import type { RelayCase, RelayEvent, RelayEventInput, StartRelayRequest } from "../api-types.js";
import { buildRelayAiArgs } from "./relay-argv.js";
import { RelayLineReader, type SkippedLines } from "./relay-lines.js";
import { planRelayCases } from "./relay-questions.js";
import { runWithLimit } from "./run-with-limit.js";

/** AI 한 대에 주는 시간. 툴 한 번 부르고 끝나는 일이라 authoring 보다 짧다. */
const AI_TIMEOUT_MS = 120_000;
/** AI stdout 상한. `--output-format json` 봉투 하나라 크지 않다. */
const AI_MAX_OUTPUT_BYTES = 1_000_000;
/** 기동 줄을 기다리는 시간. 넘으면 중계기가 못 떴다고 본다. */
const RELAY_START_TIMEOUT_MS = 15_000;
/** SIGTERM 뒤 자식이 닫히기를 기다리는 시간. 넘으면 SIGKILL 로 올린다. */
const RELAY_TERM_GRACE_MS = 5_000;
/** SIGKILL 뒤에도 `close` 가 안 오면 기다리기를 멈추고 **닫기 실패로 답한다.** */
const RELAY_KILL_GRACE_MS = 2_000;
/**
 * 구독자가 하나도 없이 이만큼 지난 세션은 수거한다(브라우저 새로고침·탭 닫기로 아무도
 * DELETE 하지 못하게 된 세션이 여기 걸린다). EventSource 재연결은 초 단위라 정상적인
 * 새로고침 공백은 여기 못 미치고, 반대로 고아 세션이 대시보드가 사는 내내 사용자 서버를
 * 붙들고 있지도 않는다.
 */
const RELAY_IDLE_REAP_MS = 10 * 60_000;

/**
 * 동시에 띄우는 AI 수의 상한.
 *
 * 케이스마다 `claude` 를 한 대씩 띄우는데, 82 케이스 스위트를 켜자 82 대가 한꺼번에 떠
 * 12 코어 머신의 부하 평균이 73 까지 올라갔다(개당 약 0.9). 6 을 골라 개발 머신에서 체감
 * 대기를 줄이되 부하는 코어 수 안쪽에 둔다.
 *
 * **코어 수에서 유도하지 않는다.** 머신마다 값이 달라지면 같은 조작의 부하·타이밍 진단이
 * 재현되지 않는다(결정론성, ADR-0106). 고정 상수로 두고, 바꿀 때는 이 주석도 같이 고친다.
 */
const RELAY_AI_CONCURRENCY = 6;

/**
 * 닫기 실패 안내. **판정 실행을 시작하지 않은 이유**가 요점이다 — 여기서 그냥 시작하면
 * 같은 사용자 서버가 두 벌 뜬다(설계 §1). 환경변수 값은 한 글자도 싣지 않는다(§4.3).
 */
const RELAY_CLOSE_FAILED_ERROR = [
  "→ 중계기를 닫지 못했습니다. SIGTERM 뒤 SIGKILL 까지 보냈지만 종료를 확인하지 못했습니다.",
  "→ 같은 서버가 두 벌 뜨는 것을 막기 위해 판정 실행을 시작하지 않았습니다.",
  "→ 터미널에서 남은 중계기 프로세스를 직접 끝낸 뒤(`ps` 로 찾아 `kill -9`) 다시 시도하세요.",
].join("\n");

/**
 * 타이머 주입 자리. 실행하면 취소 함수를 준다.
 *
 * 이 저장소는 벽시계에 매달린 코드를 꺼린다(결정론성, ADR-0072). 승격·수거에 시간이
 * 필요한 것은 사실이지만 **테스트가 실제로 기다리게 두지는 않는다** — 테스트는 여기에
 * 즉시 실행하거나 손으로 굴리는 가짜를 끼운다.
 */
export type Schedule = (ms: number, run: () => void) => () => void;

const systemSchedule: Schedule = (ms, run) => {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

/**
 * SIGTERM → (안 죽으면) SIGKILL → 그래도 안 죽으면 **실패로 답한다**.
 *
 * 타이머만으로 푸는 것이 이 함수가 고치는 결함이다. 타이머가 이겨도 호출자가 「닫혔다」로
 * 읽으면 살아 있는 중계기 위에서 판정 실행이 시작되고, 그것이 바로 이 기능이 막으려던
 * 상태다. 자식이 죽었는지 모르는 채로 성공을 말하지 않는다.
 */
function terminateChild(child: RelayChild, schedule: Schedule): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let cancelEscalation: () => void = () => undefined;
    let cancelGiveUp: () => void = () => undefined;
    const finish = (closed: boolean): void => {
      if (settled) return;
      settled = true;
      cancelEscalation();
      cancelGiveUp();
      resolve(closed);
    };
    child.on("close", () => finish(true));
    signalChild(child, "SIGTERM");
    cancelEscalation = schedule(RELAY_TERM_GRACE_MS, () => {
      signalChild(child, "SIGKILL");
      cancelGiveUp = schedule(RELAY_KILL_GRACE_MS, () => finish(false));
    });
  });
}

function signalChild(child: RelayChild, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // 이미 죽었으면 `close` 가 안 올 수 있다. 위 타이머가 판정한다.
  }
}
/**
 * 진단 꼬리에서 마스킹할 값의 최소 길이. 이보다 짧은 값(포트 번호, 지역 코드, `1`·`true`
 * 같은 플래그)은 마스킹 대상에서 뺀다 — 과잉 마스킹은 `line.split(secret).join("***")` 이
 * 그 짧은 문자열과 우연히 겹치는 무관한 글자까지 지워, 「실패 메시지가 곧 제품이다」의 존재
 * 이유(무엇이 왜 다른지 보여주는 것)를 스스로 깬다. 이런 짧은 값은 비밀일 가능성도 낮다.
 * 저장소 선례를 따른다 — `packages/record/src/external/origin-redaction.ts` 의
 * `MIN_SECRET_LENGTH`(R4, ADR-0097)도 20 이다. 그쪽은 "이 값이 비밀처럼 생겼나"를 접두사
 * 모양으로 재는 것이고 여기는 "이미 아는 값을 가릴지"를 재는 것이라 근거는 다르지만, 같은
 * 저장소 안에서 "짧은 값은 비밀 취급하지 않는다"는 문턱을 두 자리에 따로 정하지 않으려고
 * 값을 맞췄다.
 */
const MIN_MASK_VALUE_LENGTH = 20;

/** 중계기 자식. 테스트가 가짜로 바꿔 끼울 수 있게 최소면만 요구한다. */
export interface RelayChild {
  readonly stderr: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  kill(signal: NodeJS.Signals): boolean;
  on(event: "close", listener: () => void): unknown;
}

export interface RelayAiSpec {
  readonly tag: string;
  readonly args: readonly string[];
  readonly stdin: string;
  /** 세션이 닫히면 서는 중단 신호. 진행 중인 `claude` 를 정리한다. */
  readonly signal?: AbortSignal;
}

export interface RelaySessionDeps {
  readonly readSuite: (suitePath: string) => Promise<string>;
  readonly spawnRelay: (args: readonly string[], env: NodeJS.ProcessEnv) => RelayChild;
  readonly runAi: (
    spec: RelayAiSpec,
  ) => Promise<{ readonly ok: boolean; readonly failure?: string }>;
  /** 종료 승격 타이머. 테스트가 손으로 굴린다. */
  readonly schedule: Schedule;
  /** 유휴 수거가 읽는 시계. 테스트가 주입해 실제로 기다리지 않는다. */
  readonly now: () => number;
}

/**
 * `generate` 의 비공개 `environment()` 와 같은 일을 한다. 그쪽은 export 되지 않아 여기서
 * 다시 적되, **목록은 공개된 것을 쓴다**(`CLAUDE_ENV_ALLOWLIST`). 합집합
 * `PROVIDER_ENV_ALLOWLIST` 를 쓰면 `claude` 자식이 `OPENAI_API_KEY` 를 받는데,
 * `providers.ts:26-29` 의 주석이 금하는 것이 정확히 그것이다(ADR-0104).
 */
function aiEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    CLAUDE_ENV_ALLOWLIST.flatMap((key) => (source[key] === undefined ? [] : [[key, source[key]]])),
  );
}

/**
 * 기동 실패 오류 문구 뒤에 파싱 못 한 stderr 줄을 붙인다. 「실패 메시지가 곧
 * 제품이다」(`CLAUDE.md`) — 중계기가 이미 말해 준 것을 버리고 사용자에게 다시 해보라고만
 * 하면 안 된다. 기존 세 줄은 지우지 않고 **뒤에** 덧붙이는 모양이다.
 *
 * **머리와 꼬리를 같이 싣고, 가운데를 잘랐으면 잘랐다고 적는다**(`relay-lines.ts` 의
 * `SkippedLines`). 조용한 생략은 남은 줄이 이어진 것처럼 읽혀 진단을 틀리게 만든다.
 * 마스킹은 **머리 줄에도 똑같이** 건다 — 자식이 자기 환경을 처음에 되찍는 경우가 흔하다.
 *
 * 자식에게 실제로 간 환경(`relayEnv` — `{ ...process.env, ...candidateEnv }`)의 값이 자식
 * stderr 에 그대로 찍혔을 수 있어(자식이 자기 환경을 되찍는 경우) 그 값을 아는 자리마다
 * 문자열 치환으로 가린다 — 중계기 자신의 진단이든 사용자 서버가 흘린 것이든(관례상 같은
 * 채널을 탄다, relay-lines.ts) 구분 없이 적용한다. **`candidateEnv` 만 보면 안 된다** — 자식은
 * 대시보드 프로세스에서 물려받은 나머지 환경(`process.env` 의 다른 비밀 포함)도 그대로
 * 갖고 있고, 그걸 되찍으면 그 값은 마스킹 없이 그대로 나간다.
 */
function diagnosticTail(
  skipped: SkippedLines,
  relayEnv: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (skipped.head.length === 0 && skipped.tail.length === 0) return [];
  const secrets = Object.values(relayEnv).filter(
    (value): value is string => value !== undefined && value.length >= MIN_MASK_VALUE_LENGTH,
  );
  const redact = (line: string): string =>
    secrets.reduce((acc, secret) => acc.split(secret).join("***"), line);
  return [
    "→ 중계기가 남긴 줄:",
    ...skipped.head.map((line) => `→ ${redact(line)}`),
    ...(skipped.omitted > 0 ? [`→ (중간 ${skipped.omitted} 줄 생략)`] : []),
    ...skipped.tail.map((line) => `→ ${redact(line)}`),
  ];
}

export class RelaySession {
  readonly relayId = crypto.randomUUID(); // UI 식별 전용. 산출물에 안 들어간다(RunRegistry 와 같다).
  readonly cases: readonly RelayCase[];
  /** 모든 AI 가 끝나면 풀린다. 테스트가 기다릴 자리다. */
  readonly settled: Promise<void>;

  private readonly accumulated: RelayEvent[] = [];
  private readonly listeners = new Set<(event: RelayEvent) => void>();
  private closing: Promise<boolean> | undefined;
  /** 자식이 스스로 죽었는가. 죽은 자식에게 신호를 보내고 `close` 를 기다리면 영영 못 푼다. */
  private childClosed = false;
  private subscribers = 0;
  /**
   * AI 쪽 중단 신호. `close()` 가 세운다 — 대기열이 새 `claude` 를 뱉는 것을 막고, 이미
   * 떠 있는 것은 `runProviderProcess` 가 SIGTERM → SIGKILL 로 정리한다.
   */
  private readonly aiAbort = new AbortController();
  /** 구독자가 0 이 된 시각. 구독자가 있으면 의미가 없다. */
  private idleSince: number;

  constructor(
    private readonly child: RelayChild,
    cases: readonly RelayCase[],
    settled: Promise<void>,
    private readonly schedule: Schedule = systemSchedule,
    private readonly now: () => number = Date.now,
  ) {
    this.cases = cases;
    this.settled = settled;
    this.idleSince = this.now();
    this.child.on("close", () => {
      this.childClosed = true;
    });
  }

  get events(): readonly RelayEvent[] {
    return this.accumulated;
  }

  get aiSignal(): AbortSignal {
    return this.aiAbort.signal;
  }

  /**
   * 늦은 구독자에게 과거 이벤트를 다시 보내는 것은 호출부 몫이다 — `RunRecord.subscribe` 와
   * 같은 이유이고 같은 모양이다(재전송과 라이브 사이에 틈이 생기면 중복·누락이 난다).
   */
  subscribe(listener: (event: RelayEvent) => void): () => void {
    this.listeners.add(listener);
    this.subscribers += 1;
    let released = false;
    return () => {
      // 같은 해제 함수를 두 번 불러도 수를 두 번 깎지 않는다 — 음수가 되면 유휴 판정이 깨진다.
      if (released) return;
      released = true;
      this.listeners.delete(listener);
      this.subscribers -= 1;
      if (this.subscribers === 0) this.idleSince = this.now();
    };
  }

  /**
   * 구독자 없이 흘러간 시간(ms). 구독자가 있으면 0 이다.
   *
   * 「보고 있는 사람이 없다」가 유휴의 정의다. 브라우저가 새로고침되거나 탭이 닫히면
   * SSE 가 끊겨 여기가 올라가고, 그 세션은 아무도 DELETE 할 수 없는 상태다.
   */
  idleFor(at: number): number {
    return this.subscribers > 0 ? 0 : at - this.idleSince;
  }

  emit(event: RelayEventInput): void {
    const identified = { ...event, id: this.accumulated.length + 1 } as RelayEvent;
    this.accumulated.push(identified);
    for (const listener of this.listeners) listener(identified);
  }

  /**
   * 중계기와 그 자식 서버를 닫고 **닫힌 것을 확인한 뒤** 반환한다. 멱등이다.
   *
   * `true` 는 자식의 `close` 를 실제로 본 것이고, `false` 는 SIGTERM · SIGKILL 을 다 보내고도
   * 못 봤다는 뜻이다. **타이머가 이긴 것을 성공으로 말하지 않는다** — 그러면 살아 있는
   * 중계기 위에서 판정 실행이 시작돼 같은 사용자 서버가 두 벌 뜬다(설계 §1).
   *
   * AI 프로세스는 따로 죽이지 않는다 — 중계기가 닫히면 MCP 접속이 끊겨 스스로 끝나고,
   * 그래도 남으면 `runProviderProcess` 의 타임아웃이 SIGTERM · SIGKILL 로 올라간다.
   */
  close(): Promise<boolean> {
    // 중계기에 신호를 보내기 **전에** 대기열을 세운다. 순서가 반대면 중계기가 닫히는
    // 사이에 대기열이 새 `claude` 를 뱉는다.
    this.aiAbort.abort();
    this.closing ??= (
      this.childClosed ? Promise.resolve(true) : terminateChild(this.child, this.schedule)
    ).then((closed) => {
      // 못 닫았으면 기억을 푼다. 다음 DELETE 가 신호를 다시 보낼 수 있어야 한다 —
      // 실패한 약속을 캐시해 두면 재시도가 아무것도 하지 않고 같은 실패를 되풀이한다.
      if (!closed) this.closing = undefined;
      return closed;
    });
    return this.closing;
  }
}

const systemDeps: RelaySessionDeps = {
  readSuite: () => {
    throw new Error("readSuite 는 호출부가 주입한다");
  },
  // `relayBinPath()` 는 실행 권한이 아니라 파일 경로를 준다. shebang 에 기대지 않고
  // 지금 도는 node 로 직접 띄운다 — 사용자의 PATH 에 다른 node 가 있어도 같은 런타임이다.
  spawnRelay: (args, env) =>
    spawn(process.execPath, [relayBinPath(), ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      env,
    }) as unknown as RelayChild,
  runAi: async (spec) => {
    const result = await runProviderProcess({
      command: "claude",
      args: spec.args,
      stdin: spec.stdin,
      timeoutMs: AI_TIMEOUT_MS,
      env: aiEnvironment(process.env),
      cwdPrefix: tmpdir(),
      maxOutputBytes: AI_MAX_OUTPUT_BYTES,
      ...(spec.signal === undefined ? {} : { signal: spec.signal }),
    });
    return result.ok ? { ok: true } : { ok: false, failure: result.code };
  },
  schedule: systemSchedule,
  now: Date.now,
};

/**
 * 닫기의 세 가지 결말. 「없다」와 「못 닫았다」를 **가르는 것이 요점이다** — 둘을 한 값으로
 * 묶으면 라우트가 둘 다 404 로 답하고, 브라우저는 못 닫은 중계기를 "이미 없다" 로 읽는다.
 */
export type CloseRelayResult =
  | { readonly kind: "closed" }
  | { readonly kind: "notFound" }
  | { readonly kind: "failed"; readonly error: string };

export class RelaySessionRegistry {
  private readonly sessions = new Map<string, RelaySession>();

  constructor(private readonly deps: Partial<RelaySessionDeps> = {}) {}

  private get now(): () => number {
    return this.deps.now ?? systemDeps.now;
  }

  get(relayId: string): RelaySession | undefined {
    return this.sessions.get(relayId);
  }

  /**
   * 닫고 **닫힌 것을 확인한 뒤** 맵에서 지운다. 등록이 안 풀리면 `accumulated`(응답 본문
   * 포함)가 대시보드 프로세스가 사는 동안 메모리에 남고, 이미 닫힌 세션에 또 닫아도 204 가
   * 나가 브라우저가 "내가 닫았다"와 "이미 없다"를 가를 수 없다.
   *
   * **못 닫은 세션은 지우지 않는다.** 지우면 그 중계기의 유일한 핸들을 잃어 아무도 다시
   * 신호를 보낼 수 없고, 사용자 서버는 대시보드가 사는 내내 떠 있다. 남겨 두면 같은
   * relayId 로 DELETE 를 다시 칠 수 있고(그때 `RelaySession.close` 가 신호를 다시 보낸다),
   * 유휴 수거도 다음 기회에 한 번 더 시도한다. 메모리에 이벤트 배열이 남는 것은 그 대가이고,
   * 고아 프로세스보다 가벼운 쪽을 고른 것이다.
   */
  async close(relayId: string): Promise<CloseRelayResult> {
    const session = this.sessions.get(relayId);
    if (session === undefined) return { kind: "notFound" };
    if (!(await session.close())) return { kind: "failed", error: RELAY_CLOSE_FAILED_ERROR };
    this.sessions.delete(relayId);
    return { kind: "closed" };
  }

  /**
   * 구독자 없이 오래 남은 세션을 닫는다. 닫은 relayId 목록을 준다.
   *
   * **배경 인터벌을 걸지 않는다.** 이 저장소는 벽시계 타이머를 꺼리고(결정론성, ADR-0072),
   * 주기 타이머는 테스트가 실제로 기다리게 만들거나 가짜 시계를 전역에 심게 만든다. 대신
   * 이 쓸기를 `start()` 앞에 둔다 — 고아 세션이 **해를 끼치는 순간이 바로 그때**이기
   * 때문이다(사용자가 새로고침 뒤 4 단계를 다시 열어 두 번째 중계기가 뜨려는 순간).
   * 시각은 `deps.now` 로 주입받으므로 테스트는 시계를 밀기만 하면 된다.
   */
  async reapIdle(): Promise<readonly string[]> {
    const at = this.now();
    const stale = [...this.sessions.values()].filter(
      (session) => session.idleFor(at) >= RELAY_IDLE_REAP_MS,
    );
    const reaped: string[] = [];
    for (const session of stale) {
      // 실패하면 그대로 둔다 — 위 `close` 주석대로 핸들을 잃지 않는 쪽이다.
      if ((await this.close(session.relayId)).kind === "closed") reaped.push(session.relayId);
    }
    return reaped;
  }

  async start(
    request: StartRelayRequest,
    readSuite?: (suitePath: string) => Promise<string>,
    candidateEnv?: Readonly<Record<string, string>>,
    // 테스트가 실제 `process.env` 를 건드리지 않고 마스킹 대상(자식 환경 전체)을 주입할 수
    // 있게 여는 자리다. 운영 경로는 넘기지 않으므로 항상 `process.env` 를 쓴다.
    baseEnv: NodeJS.ProcessEnv = process.env,
  ): Promise<RelaySession | { readonly error: string }> {
    const deps: RelaySessionDeps = {
      readSuite: this.deps.readSuite ?? readSuite ?? systemDeps.readSuite,
      spawnRelay: this.deps.spawnRelay ?? systemDeps.spawnRelay,
      runAi: this.deps.runAi ?? systemDeps.runAi,
      schedule: this.deps.schedule ?? systemDeps.schedule,
      now: this.deps.now ?? systemDeps.now,
    };
    // 새 중계기를 띄우기 **전에** 고아를 쓸어 낸다. 위 `reapIdle` 주석 참고.
    await this.reapIdle();
    let content: string;
    try {
      content = await deps.readSuite(request.suitePath);
    } catch {
      return {
        error: `→ 스위트 파일을 읽지 못했습니다: ${request.suitePath}\n→ 2 단계로 돌아가 파일이 그 자리에 있는지 확인하세요.`,
      };
    }
    const plan = planRelayCases(content);
    // **중계기를 띄우기 전에** 계획이 서는지 본다. 못 서면 아무 프로세스도 띄우지 않는다 —
    // 띄운 뒤 실패하면 사용자에게 닫으라고 말할 대상만 남는다.
    if ("error" in plan) return plan;

    const relayArgs = [
      "--json",
      "--port",
      "0",
      ...request.envNames.flatMap((name) => ["--env", name]),
      "--",
      request.command,
      ...request.args,
    ];
    // 후보 env 를 중계기 자식 환경에 물린다. 중계기는 사용자 서버 명령을 다시 spawn 해야
    // 하므로 `PATH` 등 기본 환경이 필요하다 — 그래서 덮어쓰기가 아니라 병합이고, 후보 값이
    // 그 위를 덮는다(`/api/runs` 경로의 `readEnv` 와 같은 우선순위, wiring.ts:111).
    const relayEnv: NodeJS.ProcessEnv = { ...baseEnv, ...candidateEnv };
    const child = deps.spawnRelay(relayArgs, relayEnv);
    const reader = new RelayLineReader();
    // **청크마다 따로 디코드하면 안 된다.** 멀티바이트 문자가 청크 경계에 걸리면 그 자리에서
    // U+FFFD 가 되고, `RelayLineReader` 는 이미 디코드된 **문자열**을 이어 붙이므로 되살릴
    // 길이 없다. JSON 파싱은 성공해서 조용히 깨진 본문이 화면까지 간다.
    // `provider-process.ts` 와 같은 모양이다(스트리밍 디코더).
    const stderrDecoder = new TextDecoder("utf-8");

    let session: RelaySession | undefined;
    let settleAll: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settleAll = resolve;
    });

    // 기동 경주: `up` 줄, 자식이 먼저 죽는 것(`close`), 타임아웃 셋 중 가장 먼저 온 것이 이긴다.
    // 타임아웃은 셋 중 가장 느린 마지막 수단이어야 한다 — `-- nosuchbinary` 처럼 자식이 즉시
    // 죽는 가장 흔한 실패에서 15초를 붙들면 안 된다.
    let startupSettled = false;
    // 자식이 스스로 죽었으면 기동 실패 경로에서 신호를 보내고 기다릴 이유가 없다.
    let startupChildClosed = false;
    const url = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => finish(null), RELAY_START_TIMEOUT_MS);
      timer.unref?.();
      function finish(result: string | null): void {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(timer);
        resolve(result);
      }
      child.on("close", () => {
        startupChildClosed = true;
        finish(null);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of reader.push(stderrDecoder.decode(chunk, { stream: true }))) {
          if (line.kind === "up") {
            // 여기서 `emit` 하지 않는다. 첫 `up` 에서는 세션이 아직 없어 늘 no-op 이고,
            // 둘째 `up` 이 오면 세션 생성 뒤의 `emit` 과 겹쳐 중복 이벤트가 된다.
            // 진짜 발행자는 아래 `session.emit({ kind: "up", url })` 하나뿐이다.
            finish(line.url);
            continue;
          }
          if (session === undefined) continue;
          if (line.kind === "request") {
            session.emit({
              kind: "call",
              method: line.method,
              ...(line.case === undefined ? {} : { case: line.case }),
              ...(line.tool === undefined ? {} : { tool: line.tool }),
              ...(line.args === undefined ? {} : { args: line.args }),
            });
          } else if (line.kind === "response") {
            const { kind: _kind, id: _id, ...rest } = line;
            session.emit({ kind: "result", ...rest });
          }
          // `drop` 은 화면에 칸이 없다. 버린 것은 자식이 먼저 건 것이라 케이스를 말할 근거가 없다.
        }
      });
    });

    if (url === null) {
      // 기동 실패 경로도 SIGTERM 한 번으로 끝내지 않는다. 기동 줄을 못 낸 중계기가
      // SIGTERM 을 무시하면 그 자식(사용자 서버)까지 그대로 남고, 아무도 그 핸들을 갖지
      // 못한다 — 세션이 만들어지기 전이라 DELETE 할 relayId 조차 없다.
      const closed = startupChildClosed ? true : await terminateChild(child, deps.schedule);
      return {
        error: [
          "→ 중계기가 기동 줄을 내지 않았습니다. 서버 명령이 stdio MCP 서버가 맞는지 확인하세요.",
          `→ 실행한 명령: ${request.command} ${request.args.join(" ")}`,
          "→ 터미널에서 같은 명령을 직접 띄워 서버가 뜨는지 먼저 보세요.",
          ...(closed
            ? []
            : [
                "→ 그 중계기 프로세스는 SIGKILL 뒤에도 종료를 확인하지 못했습니다. 남은 프로세스를 터미널에서 직접 끝내세요.",
              ]),
          ...diagnosticTail(reader.skippedLines, relayEnv),
        ].join("\n"),
      };
    }

    session = new RelaySession(child, plan.cases, settled, deps.schedule, deps.now);
    session.emit({ kind: "up", url });
    if (plan.skipped.length > 0) {
      session.emit({
        kind: "notice",
        message: `→ 툴을 부르지 않는 케이스 ${plan.skipped.length} 건은 띄우지 않았습니다: ${plan.skipped.join(", ")}`,
      });
    }
    this.sessions.set(session.relayId, session);

    const current = session;
    // 동시에 뜨는 수를 `RELAY_AI_CONCURRENCY` 로 막는다. 상한이 없을 때 82 케이스가 82 대를
    // 한꺼번에 띄운 것이 이 자리의 결함이었다.
    void runWithLimit(
      plan.cases,
      RELAY_AI_CONCURRENCY,
      async (relayCase) => {
        let result: { readonly ok: boolean; readonly failure?: string };
        try {
          result = await deps.runAi({
            tag: relayCase.tag,
            args: buildRelayAiArgs({ model: request.model, url, tag: relayCase.tag }),
            stdin: plan.prompts[relayCase.tag] ?? "",
            signal: current.aiSignal,
          });
        } catch {
          // `runAi` 가 reject 해도 이 케이스만 실패로 답한다. 여기서 새면 `done` 이 영영
          // 안 나가고 화면이 끝나지 않는다.
          result = { ok: false, failure: "internal" };
        }
        current.emit({
          kind: "aiDone",
          case: relayCase.id,
          ok: result.ok,
          ...(result.failure === undefined ? {} : { failure: result.failure }),
        });
      },
      current.aiSignal,
    ).then(() => {
      current.emit({ kind: "done" });
      settleAll();
    });

    return session;
  }
}
