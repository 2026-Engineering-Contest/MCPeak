import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { CLAUDE_ENV_ALLOWLIST, runProviderProcess } from "@mcpeak/generate";
import { relayBinPath } from "@mcpeak/mock";
import type { RelayCase, RelayEvent, RelayEventInput, StartRelayRequest } from "../api-types.js";
import { buildRelayAiArgs } from "./relay-argv.js";
import { RelayLineReader } from "./relay-lines.js";
import { planRelayCases } from "./relay-questions.js";

/** AI 한 대에 주는 시간. 툴 한 번 부르고 끝나는 일이라 authoring 보다 짧다. */
const AI_TIMEOUT_MS = 120_000;
/** AI stdout 상한. `--output-format json` 봉투 하나라 크지 않다. */
const AI_MAX_OUTPUT_BYTES = 1_000_000;
/** 기동 줄을 기다리는 시간. 넘으면 중계기가 못 떴다고 본다. */
const RELAY_START_TIMEOUT_MS = 15_000;
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
}

export interface RelaySessionDeps {
  readonly readSuite: (suitePath: string) => Promise<string>;
  readonly spawnRelay: (args: readonly string[], env: NodeJS.ProcessEnv) => RelayChild;
  readonly runAi: (
    spec: RelayAiSpec,
  ) => Promise<{ readonly ok: boolean; readonly failure?: string }>;
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
 * 기동 실패 오류 문구 뒤에 파싱 못 한 stderr 마지막 줄을 붙인다. 「실패 메시지가 곧
 * 제품이다」(`CLAUDE.md`) — 중계기가 이미 말해 준 것을 버리고 사용자에게 다시 해보라고만
 * 하면 안 된다. 기존 세 줄은 지우지 않고 **뒤에** 덧붙이는 모양이다.
 *
 * 자식에게 실제로 간 환경(`relayEnv` — `{ ...process.env, ...candidateEnv }`)의 값이 자식
 * stderr 에 그대로 찍혔을 수 있어(자식이 자기 환경을 되찍는 경우) 그 값을 아는 자리마다
 * 문자열 치환으로 가린다 — 중계기 자신의 진단이든 사용자 서버가 흘린 것이든(관례상 같은
 * 채널을 탄다, relay-lines.ts) 구분 없이 적용한다. **`candidateEnv` 만 보면 안 된다** — 자식은
 * 대시보드 프로세스에서 물려받은 나머지 환경(`process.env` 의 다른 비밀 포함)도 그대로
 * 갖고 있고, 그걸 되찍으면 그 값은 마스킹 없이 그대로 나간다.
 */
function diagnosticTail(
  lines: readonly string[],
  relayEnv: Readonly<Record<string, string | undefined>>,
): readonly string[] {
  if (lines.length === 0) return [];
  const secrets = Object.values(relayEnv).filter(
    (value): value is string => value !== undefined && value.length >= MIN_MASK_VALUE_LENGTH,
  );
  const redact = (line: string): string =>
    secrets.reduce((acc, secret) => acc.split(secret).join("***"), line);
  return ["→ 중계기가 남긴 마지막 줄:", ...lines.map((line) => `→ ${redact(line)}`)];
}

export class RelaySession {
  readonly relayId = crypto.randomUUID(); // UI 식별 전용. 산출물에 안 들어간다(RunRegistry 와 같다).
  readonly cases: readonly RelayCase[];
  /** 모든 AI 가 끝나면 풀린다. 테스트가 기다릴 자리다. */
  readonly settled: Promise<void>;

  private readonly accumulated: RelayEvent[] = [];
  private readonly listeners = new Set<(event: RelayEvent) => void>();
  private closing: Promise<void> | undefined;

  constructor(
    private readonly child: RelayChild,
    cases: readonly RelayCase[],
    settled: Promise<void>,
  ) {
    this.cases = cases;
    this.settled = settled;
  }

  get events(): readonly RelayEvent[] {
    return this.accumulated;
  }

  /**
   * 늦은 구독자에게 과거 이벤트를 다시 보내는 것은 호출부 몫이다 — `RunRecord.subscribe` 와
   * 같은 이유이고 같은 모양이다(재전송과 라이브 사이에 틈이 생기면 중복·누락이 난다).
   */
  subscribe(listener: (event: RelayEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: RelayEventInput): void {
    const identified = { ...event, id: this.accumulated.length + 1 } as RelayEvent;
    this.accumulated.push(identified);
    for (const listener of this.listeners) listener(identified);
  }

  /**
   * 중계기와 그 자식 서버를 닫고 **닫힌 것을 확인한 뒤** 반환한다. 멱등이다.
   *
   * AI 프로세스는 따로 죽이지 않는다 — 중계기가 닫히면 MCP 접속이 끊겨 스스로 끝나고,
   * 그래도 남으면 `runProviderProcess` 의 타임아웃이 SIGTERM · SIGKILL 로 올라간다.
   */
  close(): Promise<void> {
    this.closing ??= new Promise<void>((resolve) => {
      this.child.on("close", () => resolve());
      try {
        this.child.kill("SIGTERM");
      } catch {
        // 이미 죽었으면 close 가 오지 않을 수 있다. 아래 타이머가 푼다.
      }
      setTimeout(resolve, 5_000).unref?.();
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
    });
    return result.ok ? { ok: true } : { ok: false, failure: result.code };
  },
};

export class RelaySessionRegistry {
  private readonly sessions = new Map<string, RelaySession>();

  constructor(private readonly deps: Partial<RelaySessionDeps> = {}) {}

  get(relayId: string): RelaySession | undefined {
    return this.sessions.get(relayId);
  }

  /**
   * 닫고 **동시에** 맵에서 지운다. 등록이 안 풀리면 `accumulated`(응답 본문 포함)가
   * 대시보드 프로세스가 사는 동안 메모리에 남고, 이미 닫힌 세션에 또 닫아도 204 가 나가
   * 브라우저가 "내가 닫았다"와 "이미 없다"를 가를 수 없다. 없는 relayId 면 `false`.
   */
  async close(relayId: string): Promise<boolean> {
    const session = this.sessions.get(relayId);
    if (session === undefined) return false;
    await session.close();
    this.sessions.delete(relayId);
    return true;
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
    };
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

    let session: RelaySession | undefined;
    let settleAll: () => void = () => undefined;
    const settled = new Promise<void>((resolve) => {
      settleAll = resolve;
    });

    // 기동 경주: `up` 줄, 자식이 먼저 죽는 것(`close`), 타임아웃 셋 중 가장 먼저 온 것이 이긴다.
    // 타임아웃은 셋 중 가장 느린 마지막 수단이어야 한다 — `-- nosuchbinary` 처럼 자식이 즉시
    // 죽는 가장 흔한 실패에서 15초를 붙들면 안 된다.
    let startupSettled = false;
    const url = await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => finish(null), RELAY_START_TIMEOUT_MS);
      timer.unref?.();
      function finish(result: string | null): void {
        if (startupSettled) return;
        startupSettled = true;
        clearTimeout(timer);
        resolve(result);
      }
      child.on("close", () => finish(null));
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of reader.push(chunk.toString("utf8"))) {
          if (line.kind === "up") {
            finish(line.url);
            session?.emit({ kind: "up", url: line.url });
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
      try {
        child.kill("SIGTERM");
      } catch {
        /* 이미 죽었으면 할 일이 없다. */
      }
      return {
        error: [
          "→ 중계기가 기동 줄을 내지 않았습니다. 서버 명령이 stdio MCP 서버가 맞는지 확인하세요.",
          `→ 실행한 명령: ${request.command} ${request.args.join(" ")}`,
          "→ 터미널에서 같은 명령을 직접 띄워 서버가 뜨는지 먼저 보세요.",
          ...diagnosticTail(reader.skippedTail, relayEnv),
        ].join("\n"),
      };
    }

    session = new RelaySession(child, plan.cases, settled);
    session.emit({ kind: "up", url });
    if (plan.skipped.length > 0) {
      session.emit({
        kind: "notice",
        message: `→ 툴을 부르지 않는 케이스 ${plan.skipped.length} 건은 띄우지 않았습니다: ${plan.skipped.join(", ")}`,
      });
    }
    this.sessions.set(session.relayId, session);

    const current = session;
    // **동시에 띄운다**(설계 §2-3). 케이스들이 한 서버를 같이 치는 대가는 사용자가 알고 고른 것이다.
    void Promise.all(
      plan.cases.map(async (relayCase) => {
        const result = await deps.runAi({
          tag: relayCase.tag,
          args: buildRelayAiArgs({ model: request.model, url, tag: relayCase.tag }),
          stdin: plan.prompts[relayCase.tag] ?? "",
        });
        current.emit({
          kind: "aiDone",
          case: relayCase.id,
          ok: result.ok,
          ...(result.failure === undefined ? {} : { failure: result.failure }),
        });
      }),
    ).then(() => {
      current.emit({ kind: "done" });
      settleAll();
    });

    return session;
  }
}
