import type { JSX } from "react";
import { useEffect, useState } from "react";
import type {
  AnalyzeTokensRequest,
  AnalyzeTokensResponse,
  ServerCandidate,
  ServerMeta,
} from "../../../src/api-types.js";
import { apiGet, apiSend } from "../api.js";
import type { Transport } from "../build-test-argv.js";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { splitCommand } from "../generate/steps/StepServer.js";
import type { RunServerChoice, RunServerPatch } from "../home/steps/StepRunServer.js";
import { StepRunServer } from "../home/steps/StepRunServer.js";
import { readRecentCommands, saveRecentCommand } from "../recent-commands.js";
import { buildAnalyzeArgv } from "./build-analyze-argv.js";
import { TokensResult } from "./TokensResult.js";

/**
 * 토큰 탭의 접속 상태. Home 의 `HomeState` 중 서버를 고르는 데 쓰는 칸과 접속 방식만 가져왔다.
 * 같은 서버를 두 화면에서 다른 모양으로 고르게 두면 사용자는 그 차이를 기능으로 읽는다.
 */
interface TokensState {
  readonly choice: RunServerChoice;
  /** 후보 갈래의 유효 명령. manual 이면 `method`·`target` 에서 구한다. */
  readonly command: string;
  readonly args: readonly string[];
  /** 후보 갈래의 env 이름. 직접 입력 갈래는 항상 빈 배열이다. 값은 브라우저에 오지 않는다. */
  readonly envNames: readonly string[];
  readonly method: CommandMethod;
  readonly target: string;
  readonly transport: Transport;
  readonly url: string;
  readonly headerEnvs: readonly string[];
}

const INITIAL_STATE: TokensState = {
  choice: { kind: "manual" },
  command: "",
  args: [],
  envNames: [],
  // Home 과 같은 기본값("node").
  method: "node",
  target: "",
  transport: "stdio",
  url: "",
  headerEnvs: [],
};

/** 갈래별 유효 명령·인자. Home 의 `effectiveTarget` 과 같은 식이다. */
function effectiveTarget(state: TokensState): { command: string; args: readonly string[] } {
  if (state.choice.kind !== "manual") {
    return { command: state.command, args: state.args };
  }
  const split = splitCommand(state.method, state.target);
  return { command: split.command, args: [...split.leadingArgs, ...state.args] };
}

/**
 * 토큰 탭(계획서 §5.6). 서버를 고르고 `분석 시작` 을 누르면 `POST /api/analyze/tokens` 한 번으로
 * 결과를 받는다. 요청은 동기라 "분석 중" 은 그 Promise 의 수명과 같고, 타이머·폴링이 없다.
 */
export function TokensPanel(): JSX.Element {
  const [state, setState] = useState<TokensState>(INITIAL_STATE);
  const [candidates, setCandidates] = useState<readonly ServerCandidate[]>([]);
  /** 후보 탐색 루트. 목록이 비었을 때 이유를 말하는 데만 쓴다. 실패는 삼킨다. */
  const [root, setRoot] = useState<string | null>(null);
  const [recentCommands] = useState<readonly string[]>(() => readRecentCommands());
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalyzeTokensResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<ServerMeta>("/api/meta")
      .then((meta) => setRoot(meta.root))
      .catch(() => setRoot(null));
    // 후보를 못 읽어도 직접 입력 갈래가 살아 있으므로 화면 전체를 실패로 만들지 않는다.
    apiGet<ServerCandidate[]>("/api/servers")
      .then((list) => {
        setCandidates(list);
        const first = list[0];
        if (first === undefined) {
          return;
        }
        // 초기 선택은 첫 후보다. 사용자가 이미 손댔으면 그대로 둔다(Home 과 같은 조건).
        setState((previous) =>
          previous.choice.kind === "manual" && previous.target === "" && previous.command === ""
            ? {
                ...previous,
                choice: { kind: "candidate", id: first.id },
                command: first.command,
                args: [...first.args],
                envNames: [...first.envNames],
              }
            : previous,
        );
      })
      .catch(() => setCandidates([]));
  }, []);

  function patchServer(partial: Partial<RunServerPatch>): void {
    setState((previous) => {
      let next: TokensState = { ...previous, ...partial };
      // 갈래가 바뀌면 env 이름도 그 갈래의 것으로 갈아 끼운다. 남기면 새로 고른 서버에 앞
      // 후보의 이름이 붙어, CLI 가 그 이름의 환경변수를 찾다 멈춘다(Home 과 같은 규칙).
      const chosen = partial.choice;
      if (chosen !== undefined) {
        const picked =
          chosen.kind === "candidate"
            ? candidates.find((candidate) => candidate.id === chosen.id)
            : undefined;
        next = { ...next, envNames: picked === undefined ? [] : [...picked.envNames] };
      }
      return next;
    });
  }

  const target = effectiveTarget(state);

  /** 버튼 비활성 판정·사유·제출이 같은 함수를 쓴다. */
  function argvResult(): { readonly argv: readonly string[] } | { readonly error: string } {
    try {
      return {
        argv: buildAnalyzeArgv({
          command: target.command,
          args: target.args,
          envNames: state.envNames,
          transport: state.transport,
          url: state.url,
          headerEnvs: state.headerEnvs,
        }),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const argv = argvResult();

  async function startAnalysis(): Promise<void> {
    if (!("argv" in argv)) {
      return;
    }
    setAnalyzing(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiSend<AnalyzeTokensResponse>("POST", "/api/analyze/tokens", {
        argv: argv.argv,
        // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 env 값을 채운다(Home 과 같다).
        ...(state.choice.kind === "candidate" ? { serverId: state.choice.id } : {}),
      } satisfies AnalyzeTokensRequest);
      setResult(response);
      if (
        state.transport === "stdio" &&
        state.choice.kind === "manual" &&
        state.target.trim() !== ""
      ) {
        saveRecentCommand(state.target);
      }
    } catch (err) {
      // CLI 의 stderr 문장 원문이다. 새 문장을 만들지 않는다(계획서 §1.3-5).
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-5 p-6">
        <StepRunServer
          choice={state.choice}
          command={state.command}
          args={state.args}
          method={state.method}
          target={state.target}
          transport={state.transport}
          url={state.url}
          headerEnvs={state.headerEnvs}
          candidates={candidates}
          root={root}
          recentCommands={recentCommands}
          onChange={patchServer}
        />
        <div className="space-y-2">
          <Button
            variant="primary"
            disabled={analyzing || !("argv" in argv)}
            onClick={() => void startAnalysis()}
          >
            {analyzing ? "분석 중…" : "분석 시작"}
          </Button>
          {"error" in argv && <p className="text-xs text-ink-muted">{argv.error}</p>}
        </div>
      </Card>

      {error !== null && (
        <pre
          role="alert"
          className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs"
          style={{ color: "var(--status-failed-fg)" }}
        >
          {error}
        </pre>
      )}

      {result !== null && <TokensResult result={result} />}
    </div>
  );
}
