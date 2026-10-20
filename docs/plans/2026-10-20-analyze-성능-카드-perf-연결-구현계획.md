# Analyze 성능 카드 perf 연결 구현계획 (2026-10-20)

Analyze 화면의 성능 효율성 카드(지금 "준비 중")에 `mcpeak perf`(PR #535)를 연결한다. 결정은 ADR-0119
(`docs/adr/0119-analyze-성능-축은-명세를-골라-따로-시작하고-카드는-perf-가-낸-값만-읽는다.md`)에 있고, 이 계획은
그것을 태스크로 나눈 것이다. ADR 과 이 계획이 다르면 ADR 이 우선하고 그 사실을 `BLOCKED` 로 보고한다.

바뀌는 패키지는 `cli`(T1, 공개 면 재export 만)와 `dashboard`(T2~T5)다. 팀 규칙상 한 PR 은 한 오너 영역만
건드리므로(`CONTRIBUTING.md` 91~92행) **PR 이 둘**이다. T1 PR 이 main 에 먼저 머지되고, 그 뒤에 dashboard 작업을
시작한다. `perf`·`core`·`runner` 패키지는 건드리지 않는다. 커밋·푸시·PR 은 사람이 한다.

| PR | 브랜치 | 대상 | 내용 |
|---|---|---|---|
| PR-A | `feat/perf-cli-exports` | main | 이 계획서·ADR 문서 커밋 + T1 |
| PR-B | `feat/analyze-perf` | main | T2~T5 |

## 0. 목표, 비범위, 완료 조건

**목표 (검증 가능한 문장)**

- G1. `@mcpeak/cli/commands` 가 `runPerfCommand`, `nodePerfDependencies`, 타입 `PerfCommandDependencies` 를
  내보내고, `nodePerfDependencies` 는 `@mcpeak/cli` 의 index 가 내보내는 것과 같은 함수다.
- G2. `POST /api/analyze/perf` 가 요청을 가둔 뒤 run(flow `perf`)을 시작해 `{ runId }` 를 돌려주고,
  `GET /api/analyze/perf/<runId>` 가 끝난 run 의 `AnalyzePerfResponse` 를 돌려준다. 같은 run 을 두 번 읽으면 본문
  바이트가 같다. flow `perf` 인 run 은 `GET /api/runs` 목록에 없다.
- G3. 대시보드가 perf 를 돌릴 때 `nodePerfDependencies` 를 펼친 뒤 `readEnv`·`readFile`·`writeFile`·`writeStdout`·
  `writeStderr` 다섯 자리만 바꾼다. `readFile` 은 대시보드 루트 기준으로 풀고 `Uint8Array` 를 돌려준다.
  `onSignal` 은 실제로 `SIGINT` 처리기를 단다(no-op 가 아니다).
- G4. `performanceSummary` 는 §4.3 의 코드이고 §4.6 의 테스트를 통과한다. 같은 응답을 두 번 넣으면
  `JSON.stringify` 가 같다.
- G5. 성능 카드가 활성이고 `#/analyze/performance` 로 상세가 열린다. "분석하기" 는 성능 요청을 보내지 않는다.
  상세에서 명세를 고르고 시작해야 `POST /api/analyze/perf` 가 나간다.
- G6. 원격(HTTP) 대상이면 성능 상세의 시작 버튼이 비활성이고 §4.4 의 사유 문장이 보인다. 요청은 나가지 않는다.
- G7. 시작 버튼 위에 §4.4 의 고지 문장이 보이고, 고른 명세 JSON 에 `approval` 키가 없으면 미승인 줄이 더 보인다.

**비범위.** 기준선 입력과 갱신(배지의 회귀 분기는 리포트에 `baseline` 이 있을 때를 위해 두기만 한다), 측정 중
취소, 같은 요청 반복의 단축 시간, 퍼센트 헤드라인, `interval-ms`·`threshold-*` 입력, 격리 실행, `perf` 패키지 변경.

**완료 조건 (전체)**

- C1. T1~T5 가 `docs/task-integration-ledger.tsv` 에 `analyze-perf-T<n>` 행으로 기록된다.
- C2. `feat/analyze-perf` 의 프로젝트 루트에서 `pnpm build --force`, `pnpm typecheck --force`, `pnpm lint`,
  `pnpm test` 가 전부 초록이고 앞의 둘은 출력에 `Cached: 0 cached` 가 있다.
- C3. 사람이 `pnpm --filter @mcpeak/dashboard build` 뒤 `node packages/dashboard/dist/dashboard-cli.mjs` 를 띄워
  `#/analyze` 에서 `examples/weather-server` 를 고르고 **분석하기**를 누른 뒤(카드는 결과 단계에서만 보인다), 비용·보안
  카드가 끝나면 성능 카드를 눌러 `examples/weather-server/server.suite.json` 을 골라 측정한다. 카드가 `done` 이 되고
  배지·헤드라인·막대·칩이 보인다.

## 1. 실행 모델

`finish-plan` 위임 모델로 돈다. 오케스트레이터는 프로젝트 루트의 별도 세션이고, 웨이브마다 실행 세션 하나가 직접
구현한다(서브에이전트를 스폰하지 않는다). 웨이브가 모두 직렬이라 병렬로 스폰할 일이 없기 때문이다.

| 역할 | 모델 | 추론 수준 | 사유 |
|---|---|---|---|
| 오케스트레이터 | 상위 `claude-opus-5-5` | high | CLAUDE.local.md 표 "오케스트레이터 세션" |
| T1 cli 재export | 표준 `claude-opus-5-5` | medium | 세 줄 재export 와 테스트 셋. 코드가 §2 에 전량 있다 |
| T2 서버 계약 | 표준 `claude-opus-5-5` | high | 요청 가드·의존성 덮어쓰기·라우트가 §3 에 코드로 있다. 보안 실행기를 옮기는 판단이 조금 남아 high 로 올린다 |
| T3 web 계약 | 표준 `claude-opus-5-5` | high | 요약 함수·요청 조립·문장이 §4 에 코드로 있다. 훅은 보안 훅의 복제다 |
| T4 화면 초안 | 상위 `claude-opus-5-5` | high | 사용자에게 보이는 고지·사유·결과 문장을 배치하는 일이다. CLAUDE.local.md 의 예외 "실패 메시지 문안 설계" |
| T5 확정 기록 | 표준 `claude-opus-5-5` | medium | ADR 상태·색인·설계 §9 문장·changeset·화면 단언 테스트 |

## 2. T1 cli 공개 면 재export (PR-A)

### 2.1 Files

- 수정: `packages/cli/src/commands.ts`
- 수정: `packages/cli/tests/commands.test.ts`
- 생성: `.changeset/cli-perf-commands-export.md`
- 생성(보고서): `docs/reports/2026-10-20-analyze-perf-T1.md`

### 2.2 `commands.ts` 에 더할 줄

알파벳 순서 자리(기존 `optimize-command.js` 블록 뒤, `repair-command.js` 블록 앞)에 넣고,
`export { nodeAuditDependencies } from "./index.js";` 줄을 아래로 바꾼다.

```ts
export { nodeAuditDependencies, nodePerfDependencies } from "./index.js";
```

```ts
export {
  type PerfCommandDependencies,
  runPerfCommand,
} from "./perf-command.js";
```

`parsePerfCommand`·`PerfCommandInput` 은 내보내지 않는다. 대시보드는 요청 가드를 스스로 둔다(§3.4).

### 2.3 테스트 (`commands.test.ts` 의 describe 안 끝에 추가)

```ts
  it("perf 커맨드 함수와 의존성 조립 함수를 내보낸다", () => {
    expect(typeof commands.runPerfCommand).toBe("function");
    expect(typeof commands.nodePerfDependencies).toBe("function");
  });
  it("nodePerfDependencies 는 index 의 것과 같은 함수다", async () => {
    const index = await import("../src/index.js");
    expect(index.nodePerfDependencies).toBe(commands.nodePerfDependencies);
  });
  it("parsePerfCommand 는 공개 면에 없다", () => {
    expect("parsePerfCommand" in commands).toBe(false);
  });
```

### 2.4 changeset

```md
---
"@mcpeak/cli": minor
---

`@mcpeak/cli/commands` 가 `runPerfCommand`, `nodePerfDependencies`, `PerfCommandDependencies` 를 내보냅니다. 대시보드가 perf 를 같은 커맨드 함수로 돌리기 위한 공개 면입니다.
```

### 2.5 검증·보고 경계

- 표적: `pnpm vitest run packages/cli/tests/commands.test.ts`
- 회귀: `pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test`
- `packages/cli/src/commands.ts` 밖의 소스를 바꿔야 하면 멈추고 보고한다.

## 3. T2 dashboard 서버 계약

### 3.1 Files

- 수정: `packages/dashboard/package.json` (`dependencies` 에 `"@mcpeak/perf": "workspace:*"`, `@mcpeak/audit` 줄 다음)
- 수정: `pnpm-lock.yaml` (`pnpm install` 이 바꾼 것만)
- 수정: `packages/dashboard/src/api-types.ts`
- 생성: `packages/dashboard/src/server/analyze-perf.ts`
- 수정: `packages/dashboard/src/server/routes.ts`
- 생성: `packages/dashboard/tests/analyze-perf.test.ts`
- 수정: `packages/dashboard/tests/routes.test.ts`
- 수정: `packages/dashboard/web/src/screens/RunView.tsx` (`FLOW_TITLES` 에 `perf: "성능 측정",` 한 줄만. `RunFlow` 에
  `"perf"` 가 더해지면 `Record<RunSummary["flow"], string>` 이 TS2741 로 깨지고 dashboard 의 typecheck 는 web 도 본다)
- 생성(보고서): `docs/reports/2026-10-20-analyze-perf-T2.md`

`package.json`·`pnpm-lock.yaml`·`analyze-perf.ts` 의 import 는 한 커밋에 같이 간다. 경계 테스트
(`packages/dashboard/tests/dependency-boundary.test.ts` 112~116행)가 선언과 실제 import 의 일치를 단언한다.

### 3.2 `api-types.ts` (공유 계약, 그대로 옮긴다)

파일 머리 import 에 `import type { PerfReport } from "@mcpeak/perf";` 를 더한다. `RunFlow` 줄과 주석을 아래로 바꾼다.

```ts
/**
 * run 의 종류. `audit` 는 보안 탭이 `POST /api/analyze/security` 로, `perf` 는 성능 상세가
 * `POST /api/analyze/perf` 로 시작한다. 둘 다 `POST /api/runs` 로는 시작할 수 없고 `GET /api/runs` 목록에도
 * 실리지 않는다(ADR-0110, ADR-0119).
 */
export type RunFlow = StartRunRequest["flow"] | "audit" | "perf";
```

`AnalyzeSecurityResponse` 뒤에 더한다.

```ts
/**
 * POST /api/analyze/perf. 성능 측정을 run 으로 시작한다. 판정은 `mcpeak perf --json` 과 같은 함수
 * (`runPerfCommand`)가 한다(ADR-0046, ADR-0119).
 *
 * `argv` 는 대상 옵션(`--command`, `--arg`, `--env`)과 그 값만 싣는다. 원격 대상은 perf 가 받지 않는다.
 */
export interface AnalyzePerfRequest {
  readonly argv: readonly string[];
  readonly serverId?: string;
  /** 프로젝트 루트 기준 상대경로(`.json`). 측정할 명세다. */
  readonly suitePath: string;
  /** 1 이상 100 이하 정수. 없으면 CLI 기본값(5)이다. */
  readonly repeat?: number;
  /** `--tool` 값. 준 순서 그대로다. 비었거나 없으면 거르지 않는다. */
  readonly tools?: readonly string[];
}

/** GET /api/analyze/perf/<runId>. 시각·난수·runId 를 싣지 않는다. */
export interface AnalyzePerfResponse {
  /** `mcpeak perf --json` 의 stdout 을 `JSON.parse` 한 값. */
  readonly report: PerfReport;
  /** `renderReport(report)`. CLI 의 사람용 리포트와 같은 함수가 만든다. */
  readonly rendered: string;
  /** CLI 종료 코드. 0 은 정상, 2 는 기준선 회귀다. */
  readonly exitCode: number;
}
```

### 3.3 `analyze-perf.ts` 의 공개 시그니처

```ts
export interface PerfModuleLoaders {
  readonly loadCore: () => Promise<typeof import("@mcpeak/core")>;
  readonly loadRunner: () => Promise<typeof import("@mcpeak/runner")>;
  readonly loadPerf: () => Promise<typeof import("@mcpeak/perf")>;
}

export interface AnalyzePerfOverrides {
  /** 기본값은 `@mcpeak/cli/commands` 의 `runPerfCommand`. 테스트가 fake 로 바꾼다. */
  readonly runner?: typeof runPerfCommand;
  readonly loaders?: Partial<PerfModuleLoaders>;
  /** `routes.ts` 가 `resolveCandidateEnv` 로 만든 후보 env. */
  readonly candidateEnv?: Readonly<Record<string, string>>;
}

export type PreparePerfOutcome =
  | { readonly ok: true; readonly argv: readonly string[] }
  | { readonly ok: false; readonly error: string };

export type AnalyzePerfOutcome =
  | { readonly ok: true; readonly body: AnalyzePerfResponse }
  | { readonly ok: false; readonly error: string };

export function preparePerfRun(root: string, request: AnalyzePerfRequest): PreparePerfOutcome;

export async function analyzePerf(
  argv: readonly string[],
  io: { readonly writeStderr: (text: string) => void },
  context: { readonly root: string },
  overrides?: AnalyzePerfOverrides,
): Promise<{ readonly exitCode: number; readonly outcome: AnalyzePerfOutcome }>;
```

### 3.4 `preparePerfRun` (전량)

```ts
/** CLI `perf-command.ts` 의 TARGET_VALUE_OPTIONS 와 같다. 원격 옵션은 perf 가 받지 않으므로 없다. */
const TARGET_VALUE_OPTIONS = new Set(["--command", "--arg", "--env"]);

function usage(token: string): string {
  return `오류 [ANALYZE_USAGE]: argv 에는 대상 옵션(--command, --arg, --env)과 그 값만 실을 수 있습니다: '${token}'\n해결: 측정 옵션은 요청의 suitePath·repeat·tools 필드로 보내세요.`;
}

const REPEAT_RANGE = "반복 횟수는 1 이상 100 이하의 정수여야 합니다.";

export function preparePerfRun(root: string, request: AnalyzePerfRequest): PreparePerfOutcome {
  for (let index = 0; index < request.argv.length; index += 2) {
    const token = request.argv[index] as string;
    if (!TARGET_VALUE_OPTIONS.has(token) || index + 1 >= request.argv.length)
      return { ok: false, error: usage(token) };
  }
  if (resolveProjectPath(root, request.suitePath) === null)
    return { ok: false, error: "허용되지 않는 경로입니다." };
  if (!request.suitePath.endsWith(".json"))
    return { ok: false, error: "명세는 .json 확장자 파일만 쓸 수 있습니다." };
  // 범위는 CLI NUMBER_OPTIONS["--repeat"] 와 같다(perf-command.ts).
  if (
    request.repeat !== undefined &&
    (!Number.isInteger(request.repeat) || request.repeat < 1 || request.repeat > 100)
  )
    return { ok: false, error: REPEAT_RANGE };
  const tools = request.tools ?? [];
  if (tools.some((tool) => tool.trim() === "" || tool.startsWith("--")))
    return { ok: false, error: "도구 이름이 비었거나 옵션처럼 생겼습니다." };
  // 순서를 고정한다. 같은 요청이면 항상 같은 배열이다. 명세 경로는 상대경로 그대로다.
  const argv: string[] = [request.suitePath, "--json"];
  if (request.repeat !== undefined) argv.push("--repeat", String(request.repeat));
  for (const tool of tools) argv.push("--tool", tool);
  argv.push(...request.argv);
  return { ok: true, argv };
}
```

### 3.5 `analyzePerf` (전량)

```ts
const RUNTIME_UNAVAILABLE =
  "오류 [ANALYZE_RUNTIME_UNAVAILABLE]: 측정에 필요한 @mcpeak/core·@mcpeak/runner·@mcpeak/perf 를 로드하지 못했습니다.\n해결: 의존성을 설치한 뒤 다시 실행하세요.";

const defaultLoaders: PerfModuleLoaders = {
  loadCore: () => import("@mcpeak/core"),
  loadRunner: () => import("@mcpeak/runner"),
  loadPerf: () => import("@mcpeak/perf"),
};

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? "";
}

export async function analyzePerf(
  argv: readonly string[],
  io: { readonly writeStderr: (text: string) => void },
  context: { readonly root: string },
  overrides: AnalyzePerfOverrides = {},
): Promise<{ readonly exitCode: number; readonly outcome: AnalyzePerfOutcome }> {
  const runner = overrides.runner ?? runPerfCommand;
  const loaders: PerfModuleLoaders = { ...defaultLoaders, ...overrides.loaders };
  const fail = (error: string) => {
    io.writeStderr(`${error}\n`);
    return { exitCode: 1, outcome: { ok: false as const, error } };
  };

  let core: typeof import("@mcpeak/core");
  let runnerModule: typeof import("@mcpeak/runner");
  let perf: typeof import("@mcpeak/perf");
  try {
    [core, runnerModule, perf] = await Promise.all([
      loaders.loadCore(),
      loaders.loadRunner(),
      loaders.loadPerf(),
    ]);
  } catch {
    return fail(RUNTIME_UNAVAILABLE);
  }

  // CLI 의 조립을 그대로 쓰고 다섯 자리만 바꾼다(ADR-0119). onSignal·killSelf 는 그대로다. 대시보드가
  // 신호로 끝날 때 perf 가 추적 디렉터리(요청 본문 기록)와 자식 서버를 먼저 정리해야 한다.
  const base = nodePerfDependencies(core, runnerModule, perf);
  let stdout = "";
  let stderr = "";
  const deps: PerfCommandDependencies = {
    ...base,
    readEnv: (name) => overrides.candidateEnv?.[name] ?? process.env[name],
    // 명세는 상대경로로 온다. 대시보드 루트 기준으로 푼다. perf 는 바이트를 받는다("utf8" 을 붙이지 않는다).
    readFile: (path) => readFile(resolve(context.root, path)),
    writeFile: (path, text) => writeFile(resolve(context.root, path), text, "utf8"),
    writeStdout: (text) => {
      stdout += text;
    },
    writeStderr: (text) => {
      stderr += text;
      io.writeStderr(text);
    },
  };

  let exitCode: number;
  try {
    exitCode = await runner(argv, deps);
  } catch (error) {
    return fail(
      `오류 [ANALYZE_FAILED]: 측정이 예기치 않게 끝났습니다: ${firstLine(error)}\n해결: 같은 서버에 mcpeak perf 를 터미널에서 직접 돌려 같은 오류가 나는지 확인하세요.`,
    );
  }
  // 리포트 없이 끝났다(사용법 오류, 명세 오류, 연결 실패). CLI 가 stderr 에 쓴 문장이 곧 결과다.
  if (stdout === "") return { exitCode, outcome: { ok: false, error: stderr.replace(/\n+$/, "") } };

  let report: PerfReport;
  try {
    report = JSON.parse(stdout) as PerfReport;
  } catch (error) {
    return fail(
      `오류 [ANALYZE_FAILED]: 측정 결과를 읽지 못했습니다: ${firstLine(error)}\n해결: 같은 서버에 mcpeak perf --json 을 터미널에서 직접 돌려 출력이 JSON 인지 확인하세요.`,
    );
  }
  return {
    exitCode,
    outcome: { ok: true, body: { report, rendered: perf.renderReport(report), exitCode } },
  };
}
```

### 3.6 `routes.ts`

보안 라우트 세 부분을 같은 모양으로 복제한다. 사양 문장은 아래이고, 각 문장이 테스트(§3.7 의 routes)로 잠긴다.

- `RouterOptions` 에 `preparePerf?: typeof preparePerfRun`, `analyzePerf?: typeof analyzePerf` 를 더한다(보안의
  `prepareSecurity`·`analyzeSecurity` 옆, 같은 주석 모양).
- `PERF_PATH = "/api/analyze/perf"`, `perfSlots = new WeakMap<RunHandle, { outcome?: AnalyzePerfOutcome }>()`.
- `POST /api/analyze/perf`: 본문이 JSON 이 아니면 400 `"본문이 올바른 JSON이 아닙니다."`. 형식 가드
  `isAnalyzePerfRequest` 가 거절하면 400 `"요청 형식이 올바르지 않습니다."`. 가드는 `argv` 문자열 배열,
  `serverId` 문자열 또는 없음, `suitePath` 문자열, `repeat` number 또는 없음, `tools` 문자열 배열 또는 없음을 본다.
  `serverId` 후보 env 처리는 보안과 같은 코드다(없는 후보면 400 `서버 후보를 찾을 수 없습니다: <id>`).
  `preparePerfRun` 이 거절하면 400 `{ error }` 이고 run 이 생기지 않는다. 통과하면
  `registry.start("perf", prepared.argv, …)` 로 run 을 열고 200 `{ runId }`.
- `GET /api/analyze/perf/<runId>`: 보안의 `handleGetSecurity` 와 같은 네 갈래. 없는 run 404 본문
  `"그런 측정이 없습니다.\n→ 대시보드는 측정 결과를 메모리에만 둡니다. 서버를 다시 시작했다면 다시 측정하세요."`,
  안 끝난 run 409 `"측정이 아직 끝나지 않았습니다."`, 성공 200 `body`, 실패 400 `{ error }`.
- `GET /api/runs` 의 필터를 `run.flow !== "audit" && run.flow !== "perf"` 로 바꾼다.

### 3.7 테스트

`packages/dashboard/tests/analyze-perf.test.ts` (새 파일). 서버 프로세스를 띄우지 않는다. 로더는 fake 이고 runner 는
`vi.fn` 이다. `nodePerfDependencies` 가 fake 모듈에서 읽는 필드는 `core.connectStdio`, `runner.validateMcpSuite`,
`perf` 의 여덟 함수뿐이라 fake 는 그 필드만 `vi.fn()` 으로 채운다(`renderReport` 는 `() => "R\n"`).

| 테스트 이름 | 단언 |
|---|---|
| `preparePerfRun 은 대상 옵션 쌍만 argv 로 받는다` | `argv: ["--json"]` → `{ ok: false, error: usage("--json") 의 문장 }`. `argv: ["--url", "http://x"]` → 같은 꼴로 `'--url'`. `argv: ["--command"]`(값 없음) → `'--command'` |
| `preparePerfRun 은 명세 경로를 가둔다` | `suitePath: "../x.json"` → `"허용되지 않는 경로입니다."`. `"/abs/x.json"` → 같은 문장. `"a.txt"` → `"명세는 .json 확장자 파일만 쓸 수 있습니다."` |
| `preparePerfRun 은 반복 횟수 범위를 CLI 와 같게 본다` | `repeat` 0, 101, 1.5 각각 → `"반복 횟수는 1 이상 100 이하의 정수여야 합니다."`. 1 과 100 은 통과 |
| `preparePerfRun 은 옵션처럼 생긴 도구 이름을 거절한다` | `tools: ["--json"]` 과 `tools: [" "]` → `"도구 이름이 비었거나 옵션처럼 생겼습니다."` |
| `preparePerfRun 은 순서를 고정해 조립한다` | `{ argv: ["--command","node","--arg","s.mjs"], suitePath: "examples/x/server.suite.json", repeat: 3, tools: ["b","a"] }` → `["examples/x/server.suite.json","--json","--repeat","3","--tool","b","--tool","a","--command","node","--arg","s.mjs"]` |
| `preparePerfRun 은 빠진 선택 필드를 싣지 않는다` | `{ argv: ["--command","node"], suitePath: "s.json" }` → `["s.json","--json","--command","node"]` |
| `analyzePerf 는 stdout 의 리포트와 renderReport 결과를 돌려준다` | runner 가 `deps.writeStdout(JSON.stringify(REPORT, null, 2) + "\n")` 뒤 0 반환 → `outcome` 이 `{ ok: true, body: { report: REPORT, rendered: "R\n", exitCode: 0 } }`(`toEqual`). `REPORT` 는 §4.6 의 `perfResponse().report` 와 같은 꼴(같은 필드·값)로 이 파일에 직접 적는다 |
| `analyzePerf 는 리포트 없이 끝나면 stderr 원문을 오류로 낸다` | runner 가 `deps.writeStderr("오류 [PERF_X]: 문장\n→ 해결\n\n")` 뒤 1 반환 → `{ exitCode: 1, outcome: { ok: false, error: "오류 [PERF_X]: 문장\n→ 해결" } }`, 그리고 `io.writeStderr` 가 같은 글자를 받았다 |
| `analyzePerf 는 runner 가 던지면 ANALYZE_FAILED 첫 줄만 싣는다` | runner 가 `new Error("터짐\n스택")` 를 던짐 → `error` 가 `"오류 [ANALYZE_FAILED]: 측정이 예기치 않게 끝났습니다: 터짐\n해결: …"` 로 시작하고 `"스택"` 을 포함하지 않는다 |
| `analyzePerf 는 모듈을 못 읽으면 RUNTIME_UNAVAILABLE` | `loadPerf` 가 reject → `exitCode` 1, `error` 가 `"오류 [ANALYZE_RUNTIME_UNAVAILABLE]: "` 로 시작 |
| `analyzePerf 는 후보 env 를 process.env 보다 먼저 읽는다` | `candidateEnv: { A: "1" }`, `process.env.A = "2"`, `process.env.B = "3"` 로 runner 안에서 `deps.readEnv("A")` 는 `"1"`, `deps.readEnv("B")` 는 `"3"` |
| `analyzePerf 의 readFile 은 루트 기준이고 바이트를 돌려준다` | 임시 디렉터리 루트에 `s.json`(`{"a":1}`)을 쓰고 runner 안에서 `await deps.readFile("s.json")` 이 `Uint8Array` 이고 `TextDecoder` 로 풀면 `{"a":1}` |
| `analyzePerf 의 writeFile 은 루트 기준이다` | runner 안에서 `deps.writeFile("out/b.json", "x")` 뒤 `<root>/out/b.json` 이 `"x"`(디렉터리는 테스트가 미리 만든다) |
| `analyzePerf 는 신호 처리기를 그대로 둔다` | runner 안에서 `const before = process.listenerCount("SIGINT"); const off = deps.onSignal(async () => {}); ` 뒤 `listenerCount` 가 `before + 1`, `off()` 뒤 `before` |

`packages/dashboard/tests/routes.test.ts` 에 더한다. 지금 helper `startTestServer(execute, analyze, security?)` 에 네 번째
인자 `perf?: { readonly prepare?: typeof preparePerfRun; readonly analyze?: typeof analyzePerf }` 를 더하고,
`handleRequest` 옵션에 `preparePerf: perf?.prepare, analyzePerf: perf?.analyze` 를 넘긴다(보안의 `security?.prepare`·
`security?.analyze` 와 같은 꼴). 기존 호출부는 바꾸지 않는다.

| 테스트 이름 | 단언 |
|---|---|
| `POST /api/analyze/perf 는 형식이 틀린 본문을 run 없이 거절한다` | `{ argv: "x", suitePath: "s.json" }` → 400 `"요청 형식이 올바르지 않습니다."`, `GET /api/runs` 길이 변화 없음 |
| `POST /api/analyze/perf 는 가드 거절을 그대로 400 으로 낸다` | fake prepare 가 `{ ok: false, error: "E" }` → 400 `{ error: "E" }`, run 없음 |
| `POST /api/analyze/perf 는 perf run 을 열고 GET 이 결과를 돌려준다` | fake analyze 가 `{ exitCode: 0, outcome: { ok: true, body: B } }` → POST 200 `{ runId }`, run 이 끝난 뒤 `GET /api/analyze/perf/<runId>` 가 200 이고 본문이 `B`. 두 번 읽은 본문 문자열이 같다 |
| `GET /api/analyze/perf 는 모르는 run 에 404` | 본문 `error` 가 `"그런 측정이 없습니다.\n→ 대시보드는 측정 결과를 메모리에만 둡니다. 서버를 다시 시작했다면 다시 측정하세요."` |
| `perf run 은 GET /api/runs 목록에 없다` | perf run 하나를 연 뒤 `GET /api/runs` 의 `flow` 에 `"perf"` 가 없다 |

### 3.8 검증·보고 경계

- 표적: `pnpm vitest run packages/dashboard/tests/analyze-perf.test.ts packages/dashboard/tests/routes.test.ts packages/dashboard/tests/dependency-boundary.test.ts`
- 회귀: `pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test`
- `packages/dashboard/web/` 는 `RunView.tsx` 의 `FLOW_TITLES` 한 줄 말고는 바뀌지 않는다. `api-types.ts` 는 이 태스크만
  바꾼다.

## 4. T3 web 계약

### 4.1 Files

- 수정: `packages/dashboard/web/src/analyze/pillars.ts`
- 수정: `packages/dashboard/web/src/analyze/format.ts`
- 생성: `packages/dashboard/web/src/analyze/build-perf-request.ts`
- 생성: `packages/dashboard/web/src/analyze/use-performance-analysis.ts`
- 수정: `packages/dashboard/web/tests/analyze-fixtures.tsx` (§4.6 의 `stubFetch` 옵션 넷과 helper 하나만)
- 수정: `packages/dashboard/web/tests/analyze-pillars.test.ts`
- 생성: `packages/dashboard/web/tests/build-perf-request.test.ts`
- 생성: `packages/dashboard/web/tests/use-performance-analysis.test.tsx`
- 생성(보고서): `docs/reports/2026-10-20-analyze-perf-T3.md`

이 태스크가 끝나도 화면은 지금과 같다. `PILLARS` 의 성능 항목은 `available: false` 를 유지하고, `types.ts`·`App.tsx`·
`AnalyzeView.tsx` 는 T4 가 바꾼다. `AnalyzePillar` 에 `"performance"` 를 넣는 순간 `AnalyzeView.tsx` 의 `PILLAR_NAME`
이 TS2741 로 깨지기 때문이다.

### 4.2 타입

`pillars.ts` 의 `PillarSummary` 에 선택 필드 하나를 더한다(비용 카드 출력은 바뀌지 않는다).

```ts
  /** 막대 첫 줄(100% 기준 줄)의 라벨. 없으면 "원본" 이다. 둘째 줄 라벨은 `bar[0].label` 이다. */
  readonly baseLabel?: string;
```

`PILLARS` 의 성능 항목은 `description` 만 바꾼다. `available` 은 T3 에서 `false` 그대로이고 T4 가 `true` 로 바꾼다(§5.1).

```ts
    description:
      "도구 호출의 응답 시간을 외부 대기와 서버 안 시간으로 나누고, 병렬화·재사용으로 줄일 지점을 찾습니다.",
```

### 4.3 `performanceSummary` (전량, `pillars.ts`)

`format.ts` 끝에 더한다.

```ts
/** `packages/perf/src/report.ts` 의 `ms` 와 같은 반올림. 카드 숫자와 CLI 리포트 숫자가 같아야 한다. */
export function millis(value: number): number {
  return Math.round(value);
}
```

`pillars.ts` 끝에 더한다(import 에 `AnalyzePerfResponse`, `millis` 추가).

```ts
/**
 * 성능 카드 요약(ADR-0119). 숫자는 perf 리포트를 그대로 읽고 CLI 와 같은 반올림만 한다. 배지는 리포트가 가진
 * 값으로만 가르고, 위에서 처음 맞는 하나다. 관측하지 못한 상태가 다른 판정을 가리지 않도록 "관측 안 함" 이 맨 앞이다.
 */
export function performanceSummary(response: AnalyzePerfResponse): PillarSummary {
  const { report } = response;
  // 측정한 케이스의 응답 시간 중앙값 합계. 케이스마다 CLI 처럼 반올림한 뒤 더한다.
  const current = report.cases.reduce(
    (sum, entry) => sum + (entry.total === undefined ? 0 : millis(entry.total.p50)),
    0,
  );
  // 단축 시간을 숫자로 내는 진단은 병렬화(sequential-independent) 하나다. 리포트 순서 그대로다.
  const savings = report.findings.flatMap((finding) =>
    finding.ruleId === "perf/sequential-independent" &&
    finding.evidence.savingUpperBoundMs !== undefined
      ? [{ tool: finding.tools[0] ?? "", ms: millis(finding.evidence.savingUpperBoundMs) }]
      : [],
  );
  const saving = savings.reduce((sum, item) => sum + item.ms, 0);
  const after = Math.max(0, current - saving);
  const failedCalls = report.cases.reduce(
    (sum, entry) => sum + entry.outcomes.threw + entry.outcomes.isError,
    0,
  );
  const findings = report.findings.length;

  const verdict: PillarVerdict =
    report.settings.observation === "none"
      ? { label: "관측 안 함", tone: "info" }
      : report.aborted !== null
        ? { label: "측정 중단", tone: "failed" }
        : failedCalls > 0
          ? { label: `호출 실패 ${failedCalls}건`, tone: "failed" }
          : report.baseline !== undefined && report.exitCode === 2
            ? { label: "회귀", tone: "failed" }
            : findings > 0
              ? { label: `진단 ${findings}건`, tone: "waiting" }
              : report.baseline === undefined
                ? { label: "진단 0건(기준선 없음)", tone: "done" }
                : { label: "진단 0건", tone: "done" };

  // 단축 1위. 같으면 리포트 순서가 앞인 것(정렬이 안정적이고 리포트 순서가 §6.3 으로 고정돼 있다).
  const top = [...savings].sort((x, y) => y.ms - x.ms)[0];

  return {
    verdict,
    headline: saving > 0 ? `−${saving} ms` : "0 ms",
    headlineNote: `~${current} → ~${after} ms`,
    baseLabel: "현재",
    bar: current === 0 ? [] : [{ ratio: after / current, tone: "accent", label: "개선 후" }],
    chips: [
      { label: "도구", count: report.server.toolCount, tone: "info" },
      { label: "진단", count: findings, tone: "info" },
    ],
    foot:
      top !== undefined && top.ms > 0
        ? `가장 큰 단축: ${top.tool} −${top.ms}ms`
        : "병렬화로 줄일 곳 없음",
  };
}
```

### 4.4 `build-perf-request.ts` (전량)

```ts
/**
 * 성능 상세 → `POST /api/analyze/perf` 의 본문 계약과 화면 문장(ADR-0119). 이 파일이 사양이고 테스트가 전량
 * 단언한다. 버튼 비활성 판정과 제출이 같은 함수를 부른다.
 */

import type { AnalyzePerfRequest } from "../../../src/api-types.js";
import type { Transport } from "../build-test-argv.js";

export interface PerfForm {
  readonly suitePath: string;
  /** 입력창 글자 그대로. 숫자 검사는 buildPerfRequest 가 한다. */
  readonly repeat: string;
  readonly tools: readonly string[];
}

export const INITIAL_PERF_FORM: PerfForm = { suitePath: "", repeat: "5", tools: [] };

/** 원격 대상이면 시작할 수 없는 사유. 아니면 null. perf-command.ts 의 원격 거절 문장과 뜻이 같다. */
export function performanceUnavailable(transport: Transport): string | null {
  return transport === "http"
    ? "원격(HTTP) 서버는 측정할 수 없습니다. 성능 측정은 서버 프로세스 안에 관측 코드를 실어야 해서, 대시보드가 직접 띄우는 stdio 서버만 됩니다."
    : null;
}

/** 시작 버튼 위의 고지. `approved` 는 고른 명세 JSON 에 `approval` 키가 있는지다(runner reporter 와 같은 기준). */
export function perfStartNotice(repeat: number, approved: boolean): readonly string[] {
  return [
    `명세의 성공 케이스를 케이스마다 ${repeat}번 실제로 호출합니다. 쓰기 도구도 포함됩니다.`,
    "격리 없이 이 컴퓨터에서 서버를 띄웁니다.",
    ...(approved
      ? []
      : ["이 명세는 아직 승인되지 않았습니다(approval 없음). 케이스 내용을 확인한 뒤 측정하세요."]),
  ];
}

/** 위반 시 한국어 메시지로 throw. */
export function buildPerfRequest(
  argv: readonly string[],
  serverId: string | undefined,
  transport: Transport,
  form: PerfForm,
): AnalyzePerfRequest {
  const unavailable = performanceUnavailable(transport);
  if (unavailable !== null) throw new Error(unavailable);
  const suitePath = form.suitePath.trim();
  if (suitePath === "") throw new Error("측정할 명세를 고르세요.");
  if (!suitePath.endsWith(".json")) throw new Error("명세 경로는 .json 으로 끝나야 합니다.");
  const repeatText = form.repeat.trim();
  const repeat = Number(repeatText);
  if (!/^\d+$/.test(repeatText) || repeat < 1 || repeat > 100)
    throw new Error("반복 횟수는 1 이상 100 이하의 정수여야 합니다.");
  const tools = form.tools.map((tool) => tool.trim()).filter((tool) => tool !== "");
  return {
    argv,
    ...(serverId === undefined ? {} : { serverId }),
    suitePath,
    repeat,
    ...(tools.length === 0 ? {} : { tools }),
  };
}
```

### 4.5 `use-performance-analysis.ts`

훅은 `use-security-analysis.ts` 를 복제한다. 바꾸는 것은 타입(`AnalyzePerfRequest`·`AnalyzePerfResponse`)과
경로(`/api/analyze/perf`, `/api/analyze/perf/<runId>`), 이름(`PerformanceAnalysis`, `usePerformanceAnalysis`)뿐이다.
`awaitedRun`·`reportedRun`·`latestState` 가드와 상태 전이는 한 줄도 바꾸지 않는다. 반환 형태도 같다.

### 4.6 테스트

`analyze-pillars.test.ts` 에 더한다. 픽스처 helper 는 이 파일 안에 둔다.

```ts
function perfCase(
  id: string,
  tool: string,
  p50: number | undefined,
  outcomes: Partial<Record<CallOutcome, number>> = {},
): CaseResult {
  return {
    id,
    tool,
    n: p50 === undefined ? 0 : 5,
    outcomes: { ok: 5, isError: 0, empty: 0, threw: 0, skipped: 0, missingTool: 0, ...outcomes },
    ...(p50 === undefined ? {} : { total: { p50, p95: p50, min: p50, max: p50 } }),
    dependency: { dependent: 0, independent: 0, unknown: 0 },
    requestSummaries: [],
  };
}

function sequential(tool: string, saving: number): PerfFinding {
  return {
    ruleId: "perf/sequential-independent",
    caseIds: [tool],
    tools: [tool],
    lines: [],
    evidence: { observed: 5, of: 5, requests: [], savingUpperBoundMs: saving },
  };
}

const REPEATED: PerfFinding = {
  ruleId: "perf/repeated-request",
  caseIds: ["a"],
  tools: ["get_forecast"],
  lines: [],
  evidence: { observed: 5, of: 5, requests: [] },
};

function perfResponse(overrides: Partial<PerfReport> = {}): AnalyzePerfResponse {
  const report: PerfReport = {
    schemaVersion: 1,
    generator: { name: "@mcpeak/perf", version: "0.0.0" },
    server: { command: "node s.mjs", toolCount: 6 },
    settings: { repeat: 5, intervalMs: 0, caseCount: 3, observation: "preload" },
    coldStart: { connectMs: 80, listToolsMs: 3 },
    cases: [
      perfCase("a", "get_forecast", 412.4),
      perfCase("b", "compare_cities", 600.6),
      perfCase("c", "lookup_country", undefined),
    ],
    findings: [sequential("compare_cities", 299.5), sequential("get_forecast", 120.4), REPEATED],
    undecidedCases: 0,
    aborted: null,
    exitCode: 0,
    ...overrides,
  };
  return { report, rendered: "", exitCode: report.exitCode };
}
```

기대값 손계산: current = round(412.4) + round(600.6) = 412 + 601 = 1013. saving = round(299.5) + round(120.4) =
300 + 120 = 420. after = 593. `Math.round(299.5)` 는 300 이다.

| 테스트 이름 | 단언 |
|---|---|
| `performanceSummary 는 병렬화 단축 합계를 헤드라인에 둔다` | `perfResponse()` → `headline` `"−420 ms"`, `headlineNote` `"~1013 → ~593 ms"`, `baseLabel` `"현재"`, `bar` 가 `[{ ratio: 593 / 1013, tone: "accent", label: "개선 후" }]`, `chips` 가 `[{ label: "도구", count: 6, tone: "info" }, { label: "진단", count: 3, tone: "info" }]`, `foot` `"가장 큰 단축: compare_cities −300ms"`, `verdict` `{ label: "진단 3건", tone: "waiting" }` |
| `performanceSummary 는 단축이 없으면 0 ms 와 줄일 곳 없음` | `findings: []` → `headline` `"0 ms"`, `headlineNote` `"~1013 → ~1013 ms"`, `bar` 가 `[{ ratio: 1, tone: "accent", label: "개선 후" }]`(`toEqual`. `bar[0].ratio` 처럼 쓰면 `noUncheckedIndexedAccess` 로 TS2532 다), `foot` `"병렬화로 줄일 곳 없음"`, `verdict` `{ label: "진단 0건(기준선 없음)", tone: "done" }` |
| `performanceSummary 는 반복 진단만 있으면 진단 수만 센다` | `findings: [REPEATED]` → `headline` `"0 ms"`, `verdict.label` `"진단 1건"` |
| `performanceSummary 는 관측 안 함을 가장 먼저 본다` | `settings: { repeat: 5, intervalMs: 0, caseCount: 3, observation: "none" }`(얕은 `Partial` 이라 객체째 준다), `findings: []`, `aborted: { caseId: "a", timeoutMs: 10000 }` → `verdict` `{ label: "관측 안 함", tone: "info" }` |
| `performanceSummary 는 측정 중단을 호출 실패보다 먼저 본다` | `aborted: { caseId: "a", timeoutMs: 10000 }`, 케이스 a 의 `threw: 1` → `verdict` `{ label: "측정 중단", tone: "failed" }` |
| `performanceSummary 는 threw 와 isError 를 호출 실패로 센다` | 케이스 a `threw: 1`, 케이스 b `isError: 2` → `verdict.label` `"호출 실패 3건"` |
| `performanceSummary 는 기준선이 있을 때만 회귀를 낸다` | `baseline: { path: "b.json", settingsMismatch: false, lines: [], regressedCaseIds: ["a"] }`, `exitCode: 2` → `"회귀"`. `baseline` 같은 값, `exitCode: 0`, `findings: []` → `"진단 0건"`. `baseline` 없이 `exitCode: 2`(있을 수 없는 조합)와 `findings: []` → `"진단 0건(기준선 없음)"` |
| `performanceSummary 는 단축이 같으면 리포트 순서가 앞인 도구를 고른다` | `findings: [sequential("b_tool", 300), sequential("a_tool", 300)]` → `foot` `"가장 큰 단축: b_tool −300ms"` |
| `performanceSummary 는 측정한 케이스가 없으면 막대를 비운다` | `cases: [perfCase("c", "lookup_country", undefined)]`, `findings: []` → `bar` `[]`, `headlineNote` `"~0 → ~0 ms"` |
| `performanceSummary 는 같은 응답이면 같은 요약이다` | `JSON.stringify(performanceSummary(perfResponse()))` 를 두 번 비교해 같다 |
| `PILLARS 의 성능 축은 처리량을 말하지 않는다` | `PILLARS.find((pillar) => pillar.id === "performance")?.description` 이 §4.2 문장과 같고 `"처리량"` 을 포함하지 않는다 |

기존 `tokensSummary` 테스트는 바뀌지 않는다(`baseLabel` 이 없으므로 `toEqual` 결과가 같다).

`build-perf-request.test.ts` (새 파일):

| 테스트 이름 | 단언 |
|---|---|
| `원격 대상은 사유 문장으로 거절한다` | `performanceUnavailable("http")` 가 §4.4 문장, `"stdio"` 는 null. `buildPerfRequest([], undefined, "http", 정상 폼)` 이 같은 문장으로 throw |
| `명세가 없거나 json 이 아니면 거절한다` | `suitePath: "  "` → `"측정할 명세를 고르세요."`, `"a.txt"` → `"명세 경로는 .json 으로 끝나야 합니다."` |
| `반복 횟수는 1 이상 100 이하 정수다` | `"0"`, `"101"`, `"1.5"`, `"abc"`, `""` 각각 throw `"반복 횟수는 1 이상 100 이하의 정수여야 합니다."`. `"1"`, `"100"` 통과 |
| `본문은 빈 도구를 빼고 선택 필드를 생략한다` | `buildPerfRequest(["--command","node"], "srv", "stdio", { suitePath: " s.json ", repeat: "3", tools: [" a ", ""] })` → `{ argv: ["--command","node"], serverId: "srv", suitePath: "s.json", repeat: 3, tools: ["a"] }`. `serverId` undefined·`tools: []` 이면 두 키가 없다(`Object.keys` 로 확인) |
| `고지는 승인 여부에 따라 줄 수가 다르다` | `perfStartNotice(5, true)` 가 두 줄이고 첫 줄 `"명세의 성공 케이스를 케이스마다 5번 실제로 호출합니다. 쓰기 도구도 포함됩니다."`. `perfStartNotice(3, false)` 가 세 줄이고 셋째 줄이 §4.4 의 미승인 문장 |

`analyze-fixtures.tsx` 의 `stubFetch` 는 지금 perf 경로를 모른다(모르는 경로는 `"[]"` 200 으로 떨어진다). 아래
옵션 넷과 helper 하나를 더한다. 기존 옵션·분기·호출부는 바꾸지 않는다. 분기 위치는 보안 분기(`/api/analyze/security`)
바로 뒤이고 큐 처리(`take`, 배열이면 순서대로 쓰고 마지막을 되풀이)는 보안 것과 같다.

```ts
    /** POST /api/analyze/perf. 없으면 `{ status: 200, body: { runId: "p1" } }` */
    readonly perfStart?: StubResponse | readonly StubResponse[];
    /** GET /api/analyze/perf/<id>. 없으면 `{ status: 500, body: { error: "perfResult 를 주지 않았습니다" } }`(빈 리포트를 done 으로 그리면 요약 함수가 깨진다. 결과까지 가는 테스트는 유효한 응답을 직접 준다) */
    readonly perfResult?: StubResponse | readonly StubResponse[];
    /** GET /api/suites. 없으면 `[]` */
    readonly suites?: readonly { readonly path: string }[];
    /** GET /api/suites/<path>. 값은 명세 JSON 이고 응답은 실제 API 처럼 FileContent { path, content: JSON 문자열, mtimeMs: 0 } 로 감싼다. 없는 경로는 404 `{ error: "없음" }` */
    readonly suiteContent?: Readonly<Record<string, unknown>>;
```

```ts
/** perf 결과를 읽은 요청의 주소를 보낸 순서대로. `resultRequests` 의 perf 판이다. */
export function perfResultRequests(fetchMock: ReturnType<typeof vi.fn>): readonly string[] {
  return fetchMock.mock.calls
    .map(([input]) => String(input))
    .filter((url) => url.startsWith("/api/analyze/perf/"));
}
```

`/api/suites/<path>` 의 `<path>` 는 `decodeURIComponent` 로 푼 뒤 `suiteContent` 에서 찾는다. `GET /api/suites`(정확히
그 경로)는 `/api/suites/` 분기보다 먼저 본다.

`use-performance-analysis.test.tsx` (새 파일). 위 `stubFetch` 옵션과 `FakeEventSource`·`installFakeEventSource`·
`lastSource` 를 쓴다. 훅을 그리는 방법은 `web/tests/security-detail.test.tsx` 를 먼저 읽고 맞춘다.

| 테스트 이름 | 단언 |
|---|---|
| `start 는 /api/analyze/perf 로 본문을 보내고 running 이 된다` | 보낸 본문이 `JSON.stringify` 로 요청과 같고 `state.kind` `"running"`, `sent` 가 그 요청 |
| `run 이 끝나면 결과를 한 번 읽고 done 이 된다` | done 이벤트 뒤 `perfResultRequests(fetchMock)` 가 `["/api/analyze/perf/p1"]`(정확히 1회), `state` 가 `{ kind: "done", result: 본문, serial: 1 }` |
| `첫 시작 실패는 failed 이고 서버 문장을 그대로 싣는다` | POST 400 `{ error: "E" }` → `state` `{ kind: "failed", error: "E" }`, `start` 가 false |
| `결과 읽기 400 은 failed 다` | GET 400 `{ error: "오류 [PERF_X]: 문장" }` → `state.error` 가 그 문장 |

### 4.7 검증·보고 경계

- 표적: `pnpm vitest run --project web packages/dashboard/web/tests/analyze-pillars.test.ts packages/dashboard/web/tests/build-perf-request.test.ts packages/dashboard/web/tests/use-performance-analysis.test.tsx packages/dashboard/web/tests/analyze-view.test.tsx`
  (마지막 파일은 `analyze-fixtures.tsx` 변경의 회귀 확인용이다. 바꾸지 않는다)
- 회귀: `pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test`
- `packages/dashboard/src/` 는 바뀌지 않는다. 계약(§4.2~4.4)을 고쳐야 하면 멈추고 보고한다.

## 5. T4 화면 초안

화면 세부는 재량이고 사용자 확인으로 바뀐다. 행동 테스트를 깨지 않는 범위에서 단순하게 만든다. 공유 계약(T2·T3 의
타입·함수·문장)을 화면 사정으로 고쳐야 하면 멈추고 보고한다.

### 5.1 Files

- 수정: `packages/dashboard/web/src/analyze/types.ts` (아래 타입 그대로)
- 수정: `packages/dashboard/web/src/analyze/pillars.ts` (성능 항목의 `available: false` → `true` 한 줄만)
- 수정: `packages/dashboard/web/src/App.tsx` (`parseRoute` 가 `performance` 세그먼트를 `pillar: "performance"` 로 읽는다.
  지금 모르는 축으로 버리는 처리에서 `performance` 를 뺀다)
- 수정: `packages/dashboard/web/src/screens/AnalyzeView.tsx`
- 수정: `packages/dashboard/web/src/analyze/PillarCard.tsx`
- 생성: `packages/dashboard/web/src/analyze/PerformanceResult.tsx` (상세. 이름은 재량이나 한 파일)
- 생성: `packages/dashboard/web/tests/performance-detail.test.tsx`
- 수정: `packages/dashboard/web/tests/app.test.ts` (72~75행 "결과 단계에서 `#/analyze/performance` 면 tabpanel 이 없다" 를
  "결과 단계에서 `#/analyze/performance` 면 성능 상세 tabpanel 이 열린다" 로 뒤집는다. `parseRoute` 는 export 되지 않으므로
  렌더링으로 단언한다. 42~54행 "서버 선택 단계에서는 상세가 없다" 는 그대로 둔다)
- 수정: `packages/dashboard/web/tests/analyze-pillars.test.ts` 316~320행 (`available` 기대 `[true, true, false]` →
  `[true, true, true]`, 테스트 이름 "성능만 비활성이다" → "세 축 모두 활성이다")
- 수정: `packages/dashboard/web/tests/analyze-view.test.tsx` 729행(`getByText("아직 연결되지 않았습니다")`)과 732~744행
  테스트 "성능 카드는 비활성이고 눌러도 해시가 바뀌지 않는다" (활성 카드의 행동으로 바꾼다: 누르면 해시가
  `#/analyze/performance` 가 된다. 바꾼 줄을 보고서에 적는다)
- 생성(보고서): `docs/reports/2026-10-20-analyze-perf-T4.md`

`types.ts`:

```ts
/** 상세가 있는 축. `#/analyze/<pillar>` 의 두 번째 세그먼트다(App.tsx `parseRoute`). */
export type AnalyzePillar = "tokens" | "security" | "performance";

/** 화면에 카드가 있는 축. 지금은 셋 다 상세가 있다. */
export type AnalyzePillarId = AnalyzePillar;
```

`AnalyzeView.tsx` 의 `PILLAR_NAME` 에 `performance` 키를 더하고, 상세를 고르는 분기(지금은 security 가 아니면
`TokensDetail`)를 세 갈래로 바꾼다.

### 5.2 요구사항

- R1. 성능 카드는 다른 두 카드와 같은 모양으로 `usePerformanceAnalysis().state` 를 따른다. `done` 이면
  `performanceSummary` 를 그린다. 막대 첫 줄 라벨은 `summary.baseLabel ?? "원본"`, 둘째 줄 라벨은 `bar[0].label` 이다.
  `idle` 문장은 "명세를 골라 측정합니다" 뜻이어야 한다(다른 축처럼 "분석하기" 를 기다린다고 읽히면 안 된다).
- R2. "분석하기" 는 지금처럼 토큰·보안 두 요청만 보낸다. 성능 요청은 보내지 않는다.
- R3. 성능 상세(`#/analyze/performance`)에 명세 선택(목록은 `GET /api/suites`), 반복 횟수 입력(기본 5), 시작 버튼이 있다.
  도구 거르기 입력은 두지 않아도 된다(`tools` 는 빈 배열로 보낸다).
- R4. 명세를 고르면 `GET /api/suites/<path>` 로 내용을 읽어(응답은 `FileContent` 이고 명세는 `JSON.parse(content)` 다) `approval` 키 여부를 구하고, 시작 버튼 위에
  `perfStartNotice(repeat, approved)` 의 줄을 그대로 보인다.
- R5. 원격 대상이면 시작 버튼이 비활성이고 `performanceUnavailable` 문장을 보인다. 성능 카드도 그 문장의 뜻을 보인다.
- R6. `buildPerfRequest` 가 throw 하면 버튼이 비활성이고 그 문장이 보인다(보안 상세와 같은 방식).
- R7. 측정 중에는 진행 이벤트를 보안 상세처럼 로그로 보인다. 취소 버튼은 없다.
- R8. `done` 이면 `rendered` 를 그대로(등폭) 보인다. 표를 새로 만들지 않아도 된다.
- R9. `failed` 면 오류 문장 전문을 보인다.
- R10. 카드와 상세는 지금처럼 결과 단계(분석하기 뒤)에서만 보인다. 서버 선택 단계에서 `#/analyze/performance` 로 들어와도
  상세는 없다(app.test.ts 42~54행 유지).
- R11. 측정이 다른 축의 부하를 함께 재지 않게 한다(ADR-0119). 토큰 또는 보안이 `running` 이면 성능 시작 버튼이 비활성이고
  "다른 분석이 끝난 뒤 측정할 수 있습니다." 를 보인다. 성능이 `running` 이면 "대상 바꾸기" 로 펼친 폼의 분석 버튼이 비활성이다(분석하기 뒤에는 바가 접혀 버튼이 없다). 그때 버튼 글자와 비활성 사유 문장은 재량이다.

### 5.3 행동 테스트 (`performance-detail.test.tsx`)

DOM 구조·문구를 고정하지 않는다. 아래 행동만 단언한다.

| 테스트 이름 | 단언 |
|---|---|
| `분석하기는 성능 요청을 보내지 않는다` | 분석하기 뒤 보낸 요청 경로에 `/api/analyze/perf` 가 없다 |
| `명세를 고르고 시작하면 성능 요청이 한 번 나간다` | 명세 선택·시작 뒤 `POST /api/analyze/perf` 1회, 본문이 `buildPerfRequest` 결과와 `JSON.stringify` 로 같다 |
| `원격 대상이면 성능 요청이 나가지 않는다` | http 대상으로 상세를 열면 시작 버튼이 `disabled` 이고 `performanceUnavailable("http")` 문장이 화면 글자에 있다 |
| `미승인 명세면 미승인 고지가 보인다` | `approval` 없는 명세 내용 응답 → `perfStartNotice(5, false)[2]` 가 화면 글자에 있다. 있는 명세면 없다 |
| `성능이 실패해도 다른 카드는 제 상태다` | 보안·토큰을 done 으로 만든 뒤 성능 시작이 400 → 두 카드 배지가 그대로다 |
| `다른 축이 도는 동안 성능을 시작할 수 없다` | 보안 run 의 SSE done 을 보내지 않아 running 인 채로 성능 상세를 열면 시작 버튼이 `disabled` 이고 `POST /api/analyze/perf` 가 0회다 |
| `성능이 도는 동안 분석하기를 누를 수 없다` | 성능 시작 뒤(SSE done 전) "대상 바꾸기" 로 폼을 펼치면 이름이 `/^분석/` 인 버튼이 `disabled` 다 |

fetch fake 는 T3 이 `analyze-fixtures.tsx` 에 더한 `stubFetch` 옵션(`perfStart`, `perfResult`, `suites`, `suiteContent`)과
`perfResultRequests` 를 쓴다. 명세 목록 픽스처는 `suites: [{ path: "examples/weather-server/server.suite.json" }]`, 내용은
승인 있는 경우 `{ ...최소 명세, approval: {} }`, 없는 경우 `approval` 키 없이 준다.

### 5.4 검증·보고 경계

- 표적: `pnpm vitest run --project web packages/dashboard/web/tests/performance-detail.test.tsx packages/dashboard/web/tests/app.test.ts packages/dashboard/web/tests/analyze-pillars.test.ts packages/dashboard/web/tests/analyze-view.test.tsx`
- 회귀: `pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test`

## 6. 자체 점검과 사용자 확인 루프 (T4 와 T5 사이)

- 오케스트레이터 자체 점검: T4 worktree 에서 먼저 `pnpm --filter @mcpeak/dashboard build` 를 돌린다(`--serve` 는 그
  worktree 의 dist 를 쓴다). 그 뒤
  `node .claude/tools/dashboard-snapshot.mjs --serve <T4 worktree> --out <scratchpad 디렉터리> --hash '#/analyze/performance' --server 'node examples/weather-server/server.mjs' --click 분석하기 --wait '분석한 대상'`
  로 결과 단계의 화면을 찍고, 사용자에게 보이는 문장을 하나씩 읽는다. 거를 것은 결함이다: 돌지 않은 측정을 0 ms 로 보임,
  "관측 안 함" 인데 진단 0건처럼 보임, 고지 누락, 가로 넘침, 빈 상태 문구 누락.
- 사용자 확인 루프: 화면을 띄워 주소를 넘기고 피드백마다 작게 고쳐 다시 띄운다. 횟수 제한 없음. 고칠 때마다 자체 점검을
  다시 돈다. 행동 테스트만 맞춘다. 사용자가 "확정" 이라고 말하면 T5 를 연다.

## 7. T5 확정 기록

### 7.1 Files

- 수정: `docs/adr/0119-analyze-성능-축은-명세를-골라-따로-시작하고-카드는-perf-가-낸-값만-읽는다.md` (확인 루프에서 바뀐 결정 반영)
- 수정: `docs/adr/README.md` (0119 행 추가, 0118 행 다음, 담당 `dashboard`, 상태 `제안`)
- 수정: `docs/adr/0116-analyze-는-탭이-아니라-축-카드와-상세이고-축은-한-번에-시작하되-상태는-독립이다.md` (머리 상태 줄에 "ADR-0119 가 성능 축을 예외로 둔다." 를 더한다)
- 수정: `docs/2026-10-18-analyze-통합-대시보드-설계.md` §9 (일곱 파일 문장을 실제 연결 파일 목록과 ADR-0119 참조로 바꾼다)
- 생성: `.changeset/analyze-perf-card.md` (`"@mcpeak/dashboard": minor`)
- 수정: `packages/dashboard/web/tests/performance-detail.test.tsx` (확정된 화면의 구조·문구 단언 추가)
- 생성(보고서): `docs/reports/2026-10-20-analyze-perf-T5.md`

### 7.2 검증

- `grep -n "0119" docs/adr/README.md` 가 한 줄
- `pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test`

## 8. 터미널 분할

직렬 터미널 5개(동시에 열지 않는다). 웨이브 하나에 터미널 하나, worktree 하나, 브랜치 하나다.

| 웨이브 | 태스크 | 브랜치 | worktree | 기점 |
|---|---|---|---|---|
| W1 | T1 | `feat/perf-cli-exports` | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T1` | `feat/analyze-perf` |
| W2 | T2 | `feat/analyze-perf-T2` | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T2` | `feat/analyze-perf` (main 의 PR-A 병합 반영 뒤) |
| W3 | T3 | `feat/analyze-perf-T3` | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T3` | `feat/analyze-perf` |
| W4 | T4 | `feat/analyze-perf-T4` | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T4` | `feat/analyze-perf` |
| W5 | T5 | `feat/analyze-perf-T5` | `/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T5` | `feat/analyze-perf` |

W1 은 PR-A 로 main 에 들어간다. 사람이 PR-A 를 머지한 뒤 `git switch feat/analyze-perf && git fetch origin && git merge --no-ff origin/main` 으로
통합 브랜치에 반영하고, 그 병합 커밋을 대장 `analyze-perf-T1` 행으로 기록한 뒤에 W2 를 연다.

## 9. 사람 몫 사전 조건

1. 프로젝트 루트에서 `git switch -c feat/analyze-perf 245ba74b` 뒤 이 계획서와 ADR-0119 **두 파일만** `git add` 해
   `docs(adr): analyze 성능 카드 perf 연결 ADR·구현계획` 으로 커밋한다.
2. `git log --oneline -1` 이 방금 그 커밋인지, `git status --short | grep -v '^??'` 가 비었는지 본다.

## 10. 터미널별 실행 지시

각 프롬프트는 단독 실행 단위다. 사람은 프로젝트 루트에서 권장 실행 명령으로 새 세션을 열고 블록을 그대로 붙여넣는다.

### 10.1 실행 프롬프트: 터미널 1, 웨이브 1 (T1)

권장 실행 설정: 표준 모델 `claude-opus-5-5`, 추론 수준 medium, 에이전트 종류 없음(세션이 직접 실행). 실행 명령
`claude --model claude-opus-5-5`.

```
실행 설정 확인: 먼저 너의 모델 ID 가 claude-opus-5-5 인지 확인해라. 다르면 아무것도 하지 말고 status: BLOCKED (모델 불일치: <실제 ID>) 로 보고해라. 추론 수준은 medium 이다. 서브에이전트를 스폰하지 않는다. 이 세션이 Wave W1, Task T1 의 실행자다.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서 아래를 차례로 실행하고 출력을 그대로 적어 둬라.
  1. git rev-parse feat/analyze-perf
     → 출력된 40자 SHA 를 "BASE" 로 적어 둔다.
  2. git log -1 --format=%s feat/analyze-perf
     → 출력이 정확히 "docs(adr): analyze 성능 카드 perf 연결 ADR·구현계획" 이 아니면 중단하고 status: BLOCKED 로 보고해라.
  3. git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T1 -b feat/perf-cli-exports feat/analyze-perf
  4. EnterWorktree 로 path=/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T1 에 진입해라.
진입 후 아래를 확인하고 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T1 인지
  - git rev-parse HEAD 가 BASE 와 글자 단위로 같은지
  - docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 와 docs/adr/0119-analyze-성능-축은-명세를-골라-따로-시작하고-카드는-perf-가-낸-값만-읽는다.md 가 존재하는지
  - git status --short 가 비었는지
  - pnpm install 이 성공하고 pnpm build 가 성공하는지
  - pnpm vitest run packages/cli/tests/commands.test.ts 가 실행돼 초록인지

[2단계: 실행]
역할: Wave W1, Task T1 구현자. 계획서 docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 의 §2 를 그대로 구현한다. 코드와 테스트는 §2.2~§2.4 에 전량 있다. 계획이 틀렸다고 판단되면 고치지 말고 status: BLOCKED 로 보고한다.

허용 Files (이 밖의 파일은 소유자가 달라도 수정하지 말고 보고한다):
  - packages/cli/src/commands.ts
  - packages/cli/tests/commands.test.ts
  - .changeset/cli-perf-commands-export.md (생성)
  - docs/reports/2026-10-20-analyze-perf-T1.md (생성, 보고서)

수정 금지 공유 계약: core/src/types.ts, packages/cli/src/perf-command.ts, packages/cli/src/index.ts.

절대 하지 말 것 (팀 CLAUDE.md 원문):
  - 다른 오너의 패키지를 수정하지 마라. 패키지마다 담당자가 다르고, 커밋이 섞이면 기여 이력을 증명할 수 없다. 다른 패키지 수정이 필요하면 멈추고 사용자에게 알려라.
  - core/src/types.ts 의 McpClient / ToolResult 인터페이스를 바꾸지 마라. 5명의 병렬 작업 기준점이라 여기가 바뀌면 전원이 깨진다. 변경이 필요해 보이면 제안만 하고 진행하지 마라.
  - @modelcontextprotocol/sdk 버전을 올리지 마라. 1.x로 고정돼 있다. 분리 패키지 구조의 2.0이 개발 중이라 자동 업그레이드되면 core가 통째로 깨진다. ^ 붙이지 마라.
  - 목록에 없는 의존성을 임의로 추가하지 마라. 추가가 필요하면 용도와 라이선스를 먼저 물어봐라. GPL·AGPL 계열은 런타임 의존성으로 금지(MIT 프로젝트라 충돌).
  - 커밋·푸시는 사람이 한다. 요청받지 않은 git 명령을 실행하지 마라(1단계의 worktree 생성은 예외).
그 밖에: 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰 금지. 유닛테스트는 인메모리만 쓴다. 문서·주석은 한국어로 쓰고 산문에 대시(—)를 쓰지 마라.

순서:
  1. 테스트 먼저. §2.3 의 세 테스트를 더하고 실패를 확인한다.
  2. §2.2 대로 commands.ts 를 고친다. §2.4 의 changeset 을 만든다.
  3. 표적 검증: pnpm vitest run packages/cli/tests/commands.test.ts
  4. 회귀 검증: worktree 루트에서 pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test
     build·typecheck 출력에 Cached: 0 cached 가 있는지 확인한다.
  5. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T1/docs/reports/2026-10-20-analyze-perf-T1.md 에 쓴다. 적을 것: pwd, git rev-parse HEAD, BASE, 실행한 검증 명령과 결과(통과·실패 수), 임의로 판단한 부분.

완료 형식: 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일 목록, 검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함한다.
```

### 10.2 실행 프롬프트: 터미널 2, 웨이브 2 (T2)

권장 실행 설정: 표준 모델 `claude-opus-5-5`, 추론 수준 high, 에이전트 종류 없음(세션이 직접 실행). 실행 명령
`claude --model claude-opus-5-5`. PR-A 가 main 에 머지되고 `feat/analyze-perf` 에 반영돼 대장 `analyze-perf-T1` 행이
생긴 뒤에 연다.

```
실행 설정 확인: 먼저 너의 모델 ID 가 claude-opus-5-5 인지 확인해라. 다르면 아무것도 하지 말고 status: BLOCKED (모델 불일치: <실제 ID>) 로 보고해라. 추론 수준은 high 다. 서브에이전트를 스폰하지 않는다. 이 세션이 Wave W2, Task T2 의 실행자다.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서 아래를 차례로 실행하고 출력을 그대로 적어 둬라.
  1. git rev-parse feat/analyze-perf
     → 출력된 40자 SHA 를 "BASE" 로 적어 둔다.
  2. git show feat/analyze-perf:docs/task-integration-ledger.tsv | awk -F'\t' '$1=="analyze-perf-T1"{print $2}' | tail -1
     → 출력이 비었으면 중단하고 status: BLOCKED (T1 대장 없음) 로 보고해라. 출력을 "T1SHA" 로 적어 둔다.
  3. git merge-base --is-ancestor <T1SHA 값> feat/analyze-perf && echo ancestor-ok
     → ancestor-ok 가 안 찍히면 중단하고 status: BLOCKED 로 보고해라.
  4. git show feat/analyze-perf:packages/cli/src/commands.ts | grep -c "nodePerfDependencies"
     → 1 이상이 아니면 중단하고 status: BLOCKED (cli 재export 미반영) 로 보고해라.
  5. git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T2 -b feat/analyze-perf-T2 feat/analyze-perf
  6. EnterWorktree 로 path=/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T2 에 진입해라.
진입 후 아래를 확인하고 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T2 인지
  - git rev-parse HEAD 가 BASE 와 같은지
  - docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 와 docs/adr/0119-analyze-성능-축은-명세를-골라-따로-시작하고-카드는-perf-가-낸-값만-읽는다.md 가 존재하는지
  - git status --short 가 비었는지
  - pnpm install 이 성공하고 pnpm build 가 성공하는지
  - pnpm vitest run packages/dashboard/tests/analyze-security.test.ts 가 실행돼 초록인지

[2단계: 실행]
역할: Wave W2, Task T2 구현자. 계획서 docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 의 §3 을 그대로 구현한다. api-types.ts 의 타입(§3.2), preparePerfRun·analyzePerf 본문(§3.4·§3.5)은 한 글자도 바꾸지 않는다. routes.ts 는 §3.6 의 사양 문장대로 보안 라우트(handleAnalyzeSecurity, handleGetSecurity, securitySlots)를 복제한다. 계획이 틀렸다고 판단되면 고치지 말고 status: BLOCKED 로 보고한다.

허용 Files (이 밖의 파일은 소유자가 달라도 수정하지 말고 보고한다):
  - packages/dashboard/package.json (dependencies 에 "@mcpeak/perf": "workspace:*" 한 줄)
  - pnpm-lock.yaml (pnpm install 이 바꾼 것만)
  - packages/dashboard/src/api-types.ts
  - packages/dashboard/src/server/analyze-perf.ts (생성)
  - packages/dashboard/src/server/routes.ts
  - packages/dashboard/tests/analyze-perf.test.ts (생성)
  - packages/dashboard/tests/routes.test.ts
  - packages/dashboard/web/src/screens/RunView.tsx (FLOW_TITLES 에 perf: "성능 측정", 한 줄만)
  - docs/reports/2026-10-20-analyze-perf-T2.md (생성, 보고서)

수정 금지 공유 계약: core/src/types.ts, packages/cli/ 전체, packages/perf/ 전체, packages/dashboard/web/ 전체(RunView.tsx 의 FLOW_TITLES 한 줄만 예외).

절대 하지 말 것 (팀 CLAUDE.md 원문):
  - 다른 오너의 패키지를 수정하지 마라. 패키지마다 담당자가 다르고, 커밋이 섞이면 기여 이력을 증명할 수 없다. 다른 패키지 수정이 필요하면 멈추고 사용자에게 알려라.
  - core/src/types.ts 의 McpClient / ToolResult 인터페이스를 바꾸지 마라. 5명의 병렬 작업 기준점이라 여기가 바뀌면 전원이 깨진다. 변경이 필요해 보이면 제안만 하고 진행하지 마라.
  - @modelcontextprotocol/sdk 버전을 올리지 마라. 1.x로 고정돼 있다. 분리 패키지 구조의 2.0이 개발 중이라 자동 업그레이드되면 core가 통째로 깨진다. ^ 붙이지 마라.
  - 목록에 없는 의존성을 임의로 추가하지 마라. 추가가 필요하면 용도와 라이선스를 먼저 물어봐라. GPL·AGPL 계열은 런타임 의존성으로 금지(MIT 프로젝트라 충돌).
  - 커밋·푸시는 사람이 한다. 요청받지 않은 git 명령을 실행하지 마라(1단계의 worktree 생성은 예외).
@mcpeak/perf 는 같은 저장소의 workspace 패키지이고 ADR-0119 가 승인한 의존이라 위 "목록에 없는 의존성" 에 해당하지 않는다. 그 밖의 의존성은 더하지 않는다.
그 밖에: 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰 금지. 유닛테스트는 인메모리와 임시 디렉터리만 쓴다. examples/ 서버를 띄우는 테스트를 만들지 마라. 문서·주석은 한국어로 쓰고 산문에 대시(—)를 쓰지 마라.

순서:
  1. package.json 에 의존을 더하고 pnpm install 로 lockfile 을 갱신한다.
  2. 테스트 먼저. §3.7 의 analyze-perf.test.ts 전체와 routes.test.ts 추가분을 적고 실패를 확인한다. routes.test.ts 는 기존 보안 라우트 테스트의 setup 을 먼저 읽고 그 방식에 맞춘다.
  3. api-types.ts(§3.2), analyze-perf.ts(§3.3~§3.5), routes.ts(§3.6) 를 만든다.
  4. 표적 검증: pnpm vitest run packages/dashboard/tests/analyze-perf.test.ts packages/dashboard/tests/routes.test.ts packages/dashboard/tests/dependency-boundary.test.ts
  5. 회귀 검증: worktree 루트에서 pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test
     build·typecheck 출력에 Cached: 0 cached 가 있는지 확인한다.
  6. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T2/docs/reports/2026-10-20-analyze-perf-T2.md 에 쓴다. 적을 것: pwd, git rev-parse HEAD, BASE, T1SHA, 실행한 검증 명령과 결과(통과·실패 수), git diff --stat pnpm-lock.yaml 출력, 임의로 판단한 부분.

완료 형식: 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일 목록, 검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함한다.
```

### 10.3 실행 프롬프트: 터미널 3, 웨이브 3 (T3)

권장 실행 설정: 표준 모델 `claude-opus-5-5`, 추론 수준 high, 에이전트 종류 없음(세션이 직접 실행). 실행 명령
`claude --model claude-opus-5-5`. T2 가 `feat/analyze-perf` 에 병합되고 대장 `analyze-perf-T2` 행이 생긴 뒤에 연다.

```
실행 설정 확인: 먼저 너의 모델 ID 가 claude-opus-5-5 인지 확인해라. 다르면 아무것도 하지 말고 status: BLOCKED (모델 불일치: <실제 ID>) 로 보고해라. 추론 수준은 high 다. 서브에이전트를 스폰하지 않는다. 이 세션이 Wave W3, Task T3 의 실행자다.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서 아래를 차례로 실행하고 출력을 그대로 적어 둬라.
  1. git rev-parse feat/analyze-perf
     → 출력된 40자 SHA 를 "BASE" 로 적어 둔다.
  2. git show feat/analyze-perf:docs/task-integration-ledger.tsv | awk -F'\t' '$1=="analyze-perf-T2"{print $2}' | tail -1
     → 출력이 비었으면 중단하고 status: BLOCKED (T2 대장 없음) 로 보고해라. 출력을 "T2SHA" 로 적어 둔다.
  3. git merge-base --is-ancestor <T2SHA 값> feat/analyze-perf && echo ancestor-ok
     → ancestor-ok 가 안 찍히면 중단하고 status: BLOCKED 로 보고해라.
  4. git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T3 -b feat/analyze-perf-T3 feat/analyze-perf
  5. EnterWorktree 로 path=/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T3 에 진입해라.
진입 후 아래를 확인하고 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T3 인지
  - git rev-parse HEAD 가 BASE 와 같은지
  - docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 가 존재하고 packages/dashboard/src/api-types.ts 에 AnalyzePerfResponse 가 있는지(grep -c AnalyzePerfResponse 가 1 이상)
  - git status --short 가 비었는지
  - pnpm install 이 성공하고 pnpm build 가 성공하는지
  - pnpm vitest run --project web packages/dashboard/web/tests/analyze-pillars.test.ts 가 실행돼 초록인지

[2단계: 실행]
역할: Wave W3, Task T3 구현자. 계획서 docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 의 §4 를 그대로 구현한다. 타입(§4.2), performanceSummary·millis(§4.3), build-perf-request.ts(§4.4)는 한 글자도 바꾸지 않는다. 훅은 §4.5 대로 use-security-analysis.ts 를 복제하고 타입·경로·이름만 바꾼다. 계획이 틀렸다고 판단되면 고치지 말고 status: BLOCKED 로 보고한다.

허용 Files (이 밖의 파일은 소유자가 달라도 수정하지 말고 보고한다):
  - packages/dashboard/web/src/analyze/pillars.ts (baseLabel 필드, 성능 description, performanceSummary. available 은 false 유지)
  - packages/dashboard/web/src/analyze/format.ts
  - packages/dashboard/web/src/analyze/build-perf-request.ts (생성)
  - packages/dashboard/web/src/analyze/use-performance-analysis.ts (생성)
  - packages/dashboard/web/tests/analyze-fixtures.tsx (§4.6 의 stubFetch 옵션 넷과 perfResultRequests 만)
  - packages/dashboard/web/tests/analyze-pillars.test.ts
  - packages/dashboard/web/tests/build-perf-request.test.ts (생성)
  - packages/dashboard/web/tests/use-performance-analysis.test.tsx (생성)
  - docs/reports/2026-10-20-analyze-perf-T3.md (생성, 보고서)

수정 금지 공유 계약: core/src/types.ts, packages/dashboard/src/ 전체(api-types.ts 포함), packages/dashboard/web/src/analyze/types.ts, packages/dashboard/web/src/App.tsx, packages/dashboard/web/src/screens/ 전체, packages/cli/ 전체, packages/perf/ 전체. 이 태스크가 끝나도 화면은 지금과 같아야 한다.

절대 하지 말 것 (팀 CLAUDE.md 원문):
  - 다른 오너의 패키지를 수정하지 마라. 패키지마다 담당자가 다르고, 커밋이 섞이면 기여 이력을 증명할 수 없다. 다른 패키지 수정이 필요하면 멈추고 사용자에게 알려라.
  - core/src/types.ts 의 McpClient / ToolResult 인터페이스를 바꾸지 마라. 5명의 병렬 작업 기준점이라 여기가 바뀌면 전원이 깨진다. 변경이 필요해 보이면 제안만 하고 진행하지 마라.
  - @modelcontextprotocol/sdk 버전을 올리지 마라. 1.x로 고정돼 있다. 분리 패키지 구조의 2.0이 개발 중이라 자동 업그레이드되면 core가 통째로 깨진다. ^ 붙이지 마라.
  - 목록에 없는 의존성을 임의로 추가하지 마라. 추가가 필요하면 용도와 라이선스를 먼저 물어봐라. GPL·AGPL 계열은 런타임 의존성으로 금지(MIT 프로젝트라 충돌).
  - 커밋·푸시는 사람이 한다. 요청받지 않은 git 명령을 실행하지 마라(1단계의 worktree 생성은 예외).
그 밖에: 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰 금지. web 코드는 @mcpeak/perf 를 값으로 import 하지 않는다(타입 import 만, 번들에 서버 코드가 섞인다). 유닛테스트는 인메모리 fake 만 쓴다. 문서·주석은 한국어로 쓰고 산문에 대시(—)를 쓰지 마라.

순서:
  1. 테스트 먼저. §4.6 의 테스트를 적고 실패를 확인한다. 기대값은 §4.6 의 손계산(1013, 420, 593, 300)을 다시 계산해 맞는지 보고서에 적는다. analyze-fixtures.tsx 에 §4.6 의 stubFetch 옵션 넷과 perfResultRequests 를 먼저 더한다(기존 옵션·분기는 바꾸지 않는다). use-performance-analysis.test.tsx 는 web/tests/security-detail.test.tsx 를 먼저 읽고 그 fake 사용법에 맞춘다.
  2. §4.2~§4.5 대로 구현한다.
  3. 표적 검증: pnpm vitest run --project web packages/dashboard/web/tests/analyze-pillars.test.ts packages/dashboard/web/tests/build-perf-request.test.ts packages/dashboard/web/tests/use-performance-analysis.test.tsx packages/dashboard/web/tests/analyze-view.test.tsx
  4. 회귀 검증: worktree 루트에서 pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test
     build·typecheck 출력에 Cached: 0 cached 가 있는지, pnpm test 출력에 web 갈래 파일 수가 0 이 아닌지 확인한다.
  5. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T3/docs/reports/2026-10-20-analyze-perf-T3.md 에 쓴다. 적을 것: pwd, git rev-parse HEAD, BASE, T2SHA, 실행한 검증 명령과 결과(통과·실패 수), 손계산 과정, 임의로 판단한 부분. 기존 테스트는 고치지 않는다(고쳤다면 BLOCKED 사유다).

완료 형식: 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일 목록, 검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함한다.
```

### 10.4 실행 프롬프트: 터미널 4, 웨이브 4 (T4)

권장 실행 설정: 상위 모델 `claude-opus-5-5`, 추론 수준 high, 에이전트 종류 없음(세션이 직접 실행). 실행 명령
`claude --model claude-opus-5-5`. T3 가 `feat/analyze-perf` 에 병합되고 대장 `analyze-perf-T3` 행이 생긴 뒤에 연다.

```
실행 설정 확인: 먼저 너의 모델 ID 가 claude-opus-5-5 인지 확인해라. 다르면 아무것도 하지 말고 status: BLOCKED (모델 불일치: <실제 ID>) 로 보고해라. 추론 수준은 high 다. 서브에이전트를 스폰하지 않는다. 이 세션이 Wave W4, Task T4 의 실행자다.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서 아래를 차례로 실행하고 출력을 그대로 적어 둬라.
  1. git rev-parse feat/analyze-perf
     → 출력된 40자 SHA 를 "BASE" 로 적어 둔다.
  2. git show feat/analyze-perf:docs/task-integration-ledger.tsv | awk -F'\t' '$1=="analyze-perf-T3"{print $2}' | tail -1
     → 출력이 비었으면 중단하고 status: BLOCKED (T3 대장 없음) 로 보고해라. 출력을 "T3SHA" 로 적어 둔다.
  3. git merge-base --is-ancestor <T3SHA 값> feat/analyze-perf && echo ancestor-ok
     → ancestor-ok 가 안 찍히면 중단하고 status: BLOCKED 로 보고해라.
  4. git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T4 -b feat/analyze-perf-T4 feat/analyze-perf
  5. EnterWorktree 로 path=/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T4 에 진입해라.
진입 후 아래를 확인하고 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T4 인지
  - git rev-parse HEAD 가 BASE 와 같은지
  - docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 와 packages/dashboard/web/src/analyze/build-perf-request.ts, packages/dashboard/web/src/analyze/use-performance-analysis.ts 가 존재하는지
  - git status --short 가 비었는지
  - pnpm install 이 성공하고 pnpm build 가 성공하는지
  - pnpm vitest run --project web packages/dashboard/web/tests/analyze-pillars.test.ts packages/dashboard/web/tests/build-perf-request.test.ts 가 실행돼 초록인지

[2단계: 실행]
역할: Wave W4, Task T4 구현자. 계획서 docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 의 §5 를 구현한다. 화면 세부는 재량이고 사용자 확인으로 바뀐다. 행동 테스트를 깨지 않는 범위에서 단순하게 만든다. §5.2 의 요구사항 R1~R11 을 모두 만족해야 한다. 화면에 보이는 문장은 build-perf-request.ts 의 performanceUnavailable·perfStartNotice 와 performanceSummary 의 글자를 그대로 쓰고 새로 짓지 않는다. 공유 계약(packages/dashboard/src/ 전체, web/src/analyze/ 의 format.ts·build-perf-request.ts·use-performance-analysis.ts, pillars.ts 의 available 한 줄 밖, §5.1 에 적힌 types.ts 변경 밖)을 화면 사정으로 고쳐야 하면 멈추고 status: BLOCKED 로 보고한다.

허용 Files (이 밖의 파일은 소유자가 달라도 수정하지 말고 보고한다):
  - packages/dashboard/web/src/analyze/types.ts (§5.1 의 타입 그대로)
  - packages/dashboard/web/src/analyze/pillars.ts (성능 항목 available: false → true 한 줄만)
  - packages/dashboard/web/src/App.tsx (parseRoute 만)
  - packages/dashboard/web/src/screens/AnalyzeView.tsx
  - packages/dashboard/web/src/analyze/PillarCard.tsx
  - packages/dashboard/web/src/analyze/PerformanceResult.tsx (생성)
  - packages/dashboard/web/tests/performance-detail.test.tsx (생성)
  - packages/dashboard/web/tests/app.test.ts (72~75행 단언을 §5.1 대로 뒤집기만)
  - packages/dashboard/web/tests/analyze-pillars.test.ts (316~320행의 available 기대와 테스트 이름만)
  - packages/dashboard/web/tests/analyze-view.test.tsx (729행과 732~744행 테스트만, §5.1 대로)
  - docs/reports/2026-10-20-analyze-perf-T4.md (생성, 보고서)

수정 금지 공유 계약: core/src/types.ts, packages/dashboard/src/ 전체, packages/dashboard/web/src/analyze/ 의 format.ts·build-perf-request.ts·use-performance-analysis.ts, pillars.ts 의 available 한 줄 밖, packages/dashboard/web/tests/analyze-fixtures.tsx, packages/cli/ 전체, packages/perf/ 전체.

절대 하지 말 것 (팀 CLAUDE.md 원문):
  - 다른 오너의 패키지를 수정하지 마라. 패키지마다 담당자가 다르고, 커밋이 섞이면 기여 이력을 증명할 수 없다. 다른 패키지 수정이 필요하면 멈추고 사용자에게 알려라.
  - core/src/types.ts 의 McpClient / ToolResult 인터페이스를 바꾸지 마라. 5명의 병렬 작업 기준점이라 여기가 바뀌면 전원이 깨진다. 변경이 필요해 보이면 제안만 하고 진행하지 마라.
  - @modelcontextprotocol/sdk 버전을 올리지 마라. 1.x로 고정돼 있다. 분리 패키지 구조의 2.0이 개발 중이라 자동 업그레이드되면 core가 통째로 깨진다. ^ 붙이지 마라.
  - 목록에 없는 의존성을 임의로 추가하지 마라. 추가가 필요하면 용도와 라이선스를 먼저 물어봐라. GPL·AGPL 계열은 런타임 의존성으로 금지(MIT 프로젝트라 충돌).
  - 커밋·푸시는 사람이 한다. 요청받지 않은 git 명령을 실행하지 마라(1단계의 worktree 생성은 예외).
그 밖에: 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰 금지. 테스트는 DOM 구조·문구를 고정하지 않고 §5.3 의 행동만 단언한다. 유닛테스트는 인메모리 fake 만 쓴다. 문서·주석은 한국어로 쓰고 산문에 대시(—)를 쓰지 마라.

순서:
  1. 테스트 먼저. §5.3 의 일곱 테스트를 적고 실패를 확인한다. 기존 analyze 화면 테스트의 fake 사용법(web/tests/analyze-fixtures.tsx, web/tests/security-detail.test.tsx)을 먼저 읽고 맞춘다.
  2. §5.1 의 types.ts·pillars.ts·App.tsx 변경과 §5.2 의 R1~R11 을 구현하고, §5.1 이 짚은 기존 테스트 줄을 고친다.
  3. 표적 검증: pnpm vitest run --project web packages/dashboard/web/tests/performance-detail.test.tsx packages/dashboard/web/tests/app.test.ts packages/dashboard/web/tests/analyze-pillars.test.ts packages/dashboard/web/tests/analyze-view.test.tsx
  4. 회귀 검증: worktree 루트에서 pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test
     build·typecheck 출력에 Cached: 0 cached 가 있는지, pnpm test 출력에 web 갈래 파일 수가 0 이 아닌지 확인한다.
  5. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T4/docs/reports/2026-10-20-analyze-perf-T4.md 에 쓴다. 적을 것: pwd, git rev-parse HEAD, BASE, T3SHA, 실행한 검증 명령과 결과(통과·실패 수), R1~R11 각각을 어디서 만족했는지, 정리한 기존 테스트 줄 목록, 임의로 판단한 부분.

완료 형식: 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일 목록, 검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함한다.
```

### 10.5 실행 프롬프트: 터미널 5, 웨이브 5 (T5)

권장 실행 설정: 표준 모델 `claude-opus-5-5`, 추론 수준 medium, 에이전트 종류 없음(세션이 직접 실행). 실행 명령
`claude --model claude-opus-5-5`. 사용자가 화면을 "확정" 하고 T4(와 확인 루프 수정)가 `feat/analyze-perf` 에 병합돼
대장 `analyze-perf-T4` 행이 생긴 뒤에 연다.

```
실행 설정 확인: 먼저 너의 모델 ID 가 claude-opus-5-5 인지 확인해라. 다르면 아무것도 하지 말고 status: BLOCKED (모델 불일치: <실제 ID>) 로 보고해라. 추론 수준은 medium 이다. 서브에이전트를 스폰하지 않는다. 이 세션이 Wave W5, Task T5 의 실행자다.

[1단계: 작업 공간 만들기] 다른 무엇보다 먼저 이것부터 해라.
프로젝트 루트 /Users/doo._.hyun/Study/Project/OhMyMCP 에서 아래를 차례로 실행하고 출력을 그대로 적어 둬라.
  1. git rev-parse feat/analyze-perf
     → 출력된 40자 SHA 를 "BASE" 로 적어 둔다.
  2. git show feat/analyze-perf:docs/task-integration-ledger.tsv | awk -F'\t' '$1=="analyze-perf-T4"{print $2}' | tail -1
     → 출력이 비었으면 중단하고 status: BLOCKED (T4 대장 없음) 로 보고해라. 출력을 "T4SHA" 로 적어 둔다.
  3. git merge-base --is-ancestor <T4SHA 값> feat/analyze-perf && echo ancestor-ok
     → ancestor-ok 가 안 찍히면 중단하고 status: BLOCKED 로 보고해라.
  4. git worktree add /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T5 -b feat/analyze-perf-T5 feat/analyze-perf
  5. EnterWorktree 로 path=/Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T5 에 진입해라.
진입 후 아래를 확인하고 하나라도 어긋나면 중단하고 status: BLOCKED 로 보고해라.
  - pwd 가 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T5 인지
  - git rev-parse HEAD 가 BASE 와 같은지
  - docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 와 packages/dashboard/web/tests/performance-detail.test.tsx 가 존재하는지
  - git status --short 가 비었는지
  - pnpm install 이 성공하고 pnpm build 가 성공하는지

[2단계: 실행]
역할: Wave W5, Task T5 구현자. 계획서 docs/plans/2026-10-20-analyze-성능-카드-perf-연결-구현계획.md 의 §7 을 구현한다. 사용자가 확정한 화면이 지금 브랜치의 화면이다. ADR-0119 본문은 지금 화면과 다른 문장만 고치고, 고친 문장 목록을 보고서에 적는다. performance-detail.test.tsx 에는 지금 화면의 구조·문구 단언을 더한다(배지 글자, 헤드라인, 고지 줄, 원격 사유).

허용 Files (이 밖의 파일은 소유자가 달라도 수정하지 말고 보고한다):
  - docs/adr/0119-analyze-성능-축은-명세를-골라-따로-시작하고-카드는-perf-가-낸-값만-읽는다.md
  - docs/adr/README.md (0118 행 다음에 0119 행, 담당 dashboard, 상태 제안)
  - docs/adr/0116-analyze-는-탭이-아니라-축-카드와-상세이고-축은-한-번에-시작하되-상태는-독립이다.md (머리 상태 줄에 "ADR-0119 가 성능 축을 예외로 둔다." 추가만)
  - docs/2026-10-18-analyze-통합-대시보드-설계.md (§9 만)
  - .changeset/analyze-perf-card.md (생성, "@mcpeak/dashboard": minor)
  - packages/dashboard/web/tests/performance-detail.test.tsx
  - docs/reports/2026-10-20-analyze-perf-T5.md (생성, 보고서)

수정 금지 공유 계약: core/src/types.ts, packages/dashboard/src/ 전체, packages/dashboard/web/src/ 전체, packages/cli/ 전체, packages/perf/ 전체.

절대 하지 말 것 (팀 CLAUDE.md 원문):
  - 다른 오너의 패키지를 수정하지 마라. 패키지마다 담당자가 다르고, 커밋이 섞이면 기여 이력을 증명할 수 없다. 다른 패키지 수정이 필요하면 멈추고 사용자에게 알려라.
  - core/src/types.ts 의 McpClient / ToolResult 인터페이스를 바꾸지 마라. 5명의 병렬 작업 기준점이라 여기가 바뀌면 전원이 깨진다. 변경이 필요해 보이면 제안만 하고 진행하지 마라.
  - @modelcontextprotocol/sdk 버전을 올리지 마라. 1.x로 고정돼 있다. 분리 패키지 구조의 2.0이 개발 중이라 자동 업그레이드되면 core가 통째로 깨진다. ^ 붙이지 마라.
  - 목록에 없는 의존성을 임의로 추가하지 마라. 추가가 필요하면 용도와 라이선스를 먼저 물어봐라. GPL·AGPL 계열은 런타임 의존성으로 금지(MIT 프로젝트라 충돌).
  - 커밋·푸시는 사람이 한다. 요청받지 않은 git 명령을 실행하지 마라(1단계의 worktree 생성은 예외).
그 밖에: 백그라운드 실행, 커밋, 머지, 푸시, 하위 에이전트 스폰 금지. 문서·주석은 한국어로 쓰고 산문에 대시(—)를 쓰지 마라.

순서:
  1. 화면 단언 테스트를 더하고 통과를 확인한다: pnpm vitest run --project web packages/dashboard/web/tests/performance-detail.test.tsx
  2. ADR-0119, README 색인, ADR-0116 상태 줄, 설계 §9, changeset 을 고친다.
  3. 검증: grep -n "0119" docs/adr/README.md 가 한 줄인지 보고, worktree 루트에서 pnpm build --force && pnpm typecheck --force && pnpm lint && pnpm test
  4. 보고서를 /Users/doo._.hyun/Study/Project/OhMyMCP/.claude/worktrees/ohmymcp-analyze-perf-T5/docs/reports/2026-10-20-analyze-perf-T5.md 에 쓴다. 적을 것: pwd, git rev-parse HEAD, BASE, T4SHA, 검증 결과, ADR 에서 고친 문장 목록, 임의로 판단한 부분.

완료 형식: 최종 응답은 status: READY_FOR_REVIEW 또는 status: BLOCKED 로 시작하고, 변경 파일 목록, 검증 명령과 결과, 보고서 절대 경로, 남은 위험을 포함한다.
```

## 11. 통합 게이트 (오케스트레이터, 웨이브마다)

git 쓰기(커밋, 병합, 대장 커밋, 브랜치 삭제, PR)는 **사람이** 한다. 오케스트레이터는 실행할 명령을 그대로 제시하고,
사람이 실행한 뒤 결과를 확인한다.

0. **선언.** 웨이브를 시작하기 전에 웨이브 번호, 태스크, 선행 대장 SHA, 이 게이트의 통과 조건을 사용자에게 한 번 알린다.
1. **재검증.** 실행 세션의 보고를 받으면 그 worktree 에서 `git status --short`, `git diff --check` 를 보고, 해당 태스크의
   표적·회귀 검증 명령(§2.5·§3.8·§4.7·§5.4·§7.2)을 오케스트레이터가 다시 실행한다.
2. **검토.** 보고서와 허용 Files 의 diff 를 직접 본다. 허용 밖 파일이 바뀌었으면 되돌리게 한다.
3. **태스크별 확인.**
   - T1: `packages/cli/src/` 의 diff 가 `commands.ts` 하나인지.
   - T2: `analyze-perf.ts` 의 `preparePerfRun`·`analyzePerf` 가 §3.4·§3.5 와 같은지 눈으로 대조한다. deps 덮어쓰기가
     다섯 자리뿐이고 `onSignal`·`killSelf` 가 없는지. `packages/dashboard/web/` diff 가 `RunView.tsx` 의 `FLOW_TITLES`
     한 줄뿐인지.
   - T3: `performanceSummary` 가 §4.3 과 분기 수까지 같은지, 테스트 기대값이 손계산(1013, 420, 593)인지.
     `packages/dashboard/src/` diff 가 0 인지.
   - T4: §6 의 자체 점검을 돌린다. `web/src/analyze/` 의 계약 파일(`format.ts`·`build-perf-request.ts`·
     `use-performance-analysis.ts`) diff 가 0 이고 `pillars.ts` diff 가 `available` 한 줄뿐인지.
   - T5: `grep -n "0119" docs/adr/README.md`, 설계 §9 의 문장을 읽는다.
4. **수정 루프.** 결함이 나오면 같은 실행 세션에 `SendMessage` 로 결함 목록, 고칠 파일, 다시 돌릴 검증 명령을 보내고
   1 로 돌아간다. 세 번 돌아도 남으면 사용자에게 보고하고 멈춘다.
5. **커밋.** 사람이 태스크 worktree 에서 허용 Files 만 `git add` 하고 아래 메시지로 커밋한다.
   - T1: `feat(cli): perf 커맨드를 commands 공개 면에 내보낸다`
   - T2: `feat(dashboard): perf 측정 API 와 실행기 추가`
   - T3: `feat(dashboard): 성능 축 계약·요약 함수·훅 추가`
   - T4: `feat(dashboard): 성능 카드와 상세 화면 연결`
   - T5: `docs(adr): ADR-0119 확정과 analyze 설계 §9 갱신`
6. **병합.**
   - T1: 사람이 `feat/perf-cli-exports` 를 푸시해 main 대상 PR-A 를 연다. 리뷰어는 `cli` 공동 오너 중 한 명 이상이다.
     머지된 뒤 `git switch feat/analyze-perf && git fetch origin && git merge --no-ff origin/main` 을 실행한다.
   - T2~T5: `git switch feat/analyze-perf && git merge --no-ff feat/analyze-perf-T<n>`.
   병합 뒤 루트에서 C2 를 돌리고 `Cached: 0 cached` 를 확인한다.
7. **대장.** 병합 직후 `git rev-parse HEAD` 를 `docs/task-integration-ledger.tsv` 에 `analyze-perf-T<n>`, SHA, 날짜를
   탭으로 이은 한 행으로 더하고 사람이 `docs(dashboard): analyze-perf-T<n> 통합 기록` 으로 커밋한다. 수정 뒤 다시
   병합했으면 앞 행을 지우고 새 행을 넣는다.
8. **정리.** 6·7 뒤에만 한다. 그 worktree 안의 세션(실행 세션, 오케스트레이터 자신 포함)을 프로젝트 루트로 먼저
   내보내고, `git status --short` 가 빈 것을 본 뒤 사람이 `git worktree remove <그 worktree>`, `git worktree prune`,
   `git branch -d <그 브랜치>` 를 실행한다.
9. **최종 리뷰.** T5 까지 끝나면 `git diff 245ba74b...feat/analyze-perf -- packages/dashboard` 전체를
   `verifying-implementation` 절차로 본다. G1~G7 을 항목별로 대조한다.
10. **실환경.** C3 을 사람이 확인하고 PR-B 를 연다. 리뷰어는 `dashboard` 공동 오너 중 한 명 이상이다.

## 12. 자체 검토 (plan.md §6)

- 요구사항 대응: G1 → T1 §2.3. G2·G3 → T2 §3.7. G4 → T3 §4.6. G5·G6·G7 → T4 §5.3 과 C3. ADR 결정의 배지 순서 →
  §4.3·§4.6, 헤드라인 → §4.3, 고지 → §4.4, 원격 사유 → §4.4·§5.2 R5, 취소 없음 → §5.2 R7.
- 공유 계약 분리: `api-types.ts` 는 T2, 웹 계약은 T3 이 먼저 만들고 T4 는 쓰기만 한다. 병렬 태스크 없음.
- 모델: §1 표와 각 블록 첫 줄. 상위 모델은 오케스트레이터와 T4 이고 사유는 §1 에 있다. Fable 은 쓰지 않는다.
- 격리: 유닛테스트는 fake 로더·임시 디렉터리·fetch fake 만. 실제 서버 측정은 §6 의 자체 점검과 C3 에서만 한다.
- 리뷰 게이트: §11 의 1~4, 9.
- 판단 로직 계약: 배지·헤드라인 계산(§4.3), 요청 가드(§3.4), 의존성 덮어쓰기(§3.5)가 전량 코드이고 테스트 단언이
  전량 표로 있다.
- 공유 파일 경계: T3 은 화면을 바꾸지 않는다(`available` false 유지, `types.ts`·`App.tsx`·`AnalyzeView.tsx` 는 T4). T2 의 web 변경은 `RunView.tsx` 한 줄이다.
- 화면 작업 7절: T4 는 요구사항과 행동 테스트만, 화면 구조·문구 단언과 ADR 확정은 T5 로 미뤘다.
