import { useEffect, useState } from "react";
import type { ServerCandidate, ServerMeta } from "../../../src/api-types.js";
import { apiGet } from "../api.js";
import type { Transport } from "../build-test-argv.js";
import type { CommandMethod } from "../generate/steps/StepServer.js";
import { splitCommand } from "../generate/steps/StepServer.js";
import type { RunServerChoice, RunServerPatch } from "../home/steps/StepRunServer.js";
import { readRecentCommands, saveRecentCommand } from "../recent-commands.js";
import { buildAnalyzeArgv } from "./build-analyze-argv.js";

/**
 * Analyze 의 접속 상태. Home 의 `HomeState` 중 서버를 고르는 데 쓰는 칸과 접속 방식만 가져왔다.
 * 같은 서버를 두 화면에서 다른 모양으로 고르게 두면 사용자는 그 차이를 기능으로 읽는다.
 */
export interface AnalyzeTargetState {
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

const INITIAL_STATE: AnalyzeTargetState = {
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
function effectiveTarget(state: AnalyzeTargetState): { command: string; args: readonly string[] } {
  if (state.choice.kind !== "manual") {
    return { command: state.command, args: state.args };
  }
  const split = splitCommand(state.method, state.target);
  return { command: split.command, args: [...split.leadingArgs, ...state.args] };
}

export interface AnalyzeTarget {
  readonly state: AnalyzeTargetState;
  readonly candidates: readonly ServerCandidate[];
  /** 후보 탐색 루트. 목록이 비었을 때 이유를 말하는 데만 쓴다. */
  readonly root: string | null;
  readonly recentCommands: readonly string[];
  readonly patchServer: (partial: Partial<RunServerPatch>) => void;
  /** `buildAnalyzeArgv` 의 결과. 버튼 비활성 판정·사유·제출이 같은 값을 쓴다. */
  readonly argv: { readonly argv: readonly string[] } | { readonly error: string };
  /** 후보 갈래면 그 id, 아니면 undefined. */
  readonly serverId: string | undefined;
  /** 직접 입력 stdio 갈래에 명령이 있으면 최근 명령으로 저장한다. 요청이 성공한 뒤 부른다. */
  readonly rememberCommand: () => void;
}

/**
 * Analyze 의 두 탭이 함께 쓰는 접속 상태(보안 탭 계획서 §5.7). `AnalyzeView` 가 한 번 부르고 두 패널에
 * 넘긴다. 두 탭은 같은 `AnalyzeView` 인스턴스라 탭을 오가도 고른 서버가 남는다.
 */
export function useAnalyzeTarget(): AnalyzeTarget {
  const [state, setState] = useState<AnalyzeTargetState>(INITIAL_STATE);
  const [candidates, setCandidates] = useState<readonly ServerCandidate[]>([]);
  /** 실패는 삼킨다. 못 받았으면 안내에서 경로만 빠진다. */
  const [root, setRoot] = useState<string | null>(null);
  const [recentCommands] = useState<readonly string[]>(() => readRecentCommands());

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
      let next: AnalyzeTargetState = { ...previous, ...partial };
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
  function argvResult(): AnalyzeTarget["argv"] {
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

  function rememberCommand(): void {
    if (
      state.transport === "stdio" &&
      state.choice.kind === "manual" &&
      state.target.trim() !== ""
    ) {
      saveRecentCommand(state.target);
    }
  }

  return {
    state,
    candidates,
    root,
    recentCommands,
    patchServer,
    argv: argvResult(),
    // 후보 갈래면 id 를 함께 보낸다. 서버가 그 후보의 env 값을 채운다(Home 과 같다).
    serverId: state.choice.kind === "candidate" ? state.choice.id : undefined,
    rememberCommand,
  };
}
