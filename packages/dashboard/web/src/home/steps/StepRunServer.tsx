import type { JSX } from "react";
import type { ServerCandidate } from "../../../../src/api-types.js";
import type { Transport } from "../../build-test-argv.js";
import { ServerPicker } from "../../components/ServerPicker.js";
import { TransportFields } from "../../components/TransportFields.js";
import type { CommandMethod } from "../../generate/steps/StepServer.js";
import { StepServer } from "../../generate/steps/StepServer.js";

/**
 * 홈 1단계에서 고를 수 있는 갈래. `ServerPicker` 의 `ServerChoice` 부분집합이다.
 * `last-run` 은 스위트 경로를 키로 저장되는데 스위트는 2단계에서 고르므로 여기 오지 않는다.
 * 지난 실행값은 3단계에서 「지난 실행값 쓰기」로 되돌린다.
 */
export type RunServerChoice =
  | { readonly kind: "candidate"; readonly id: string }
  | { readonly kind: "manual" };

/** 목록이 비활성인 이유는 HTTP 대상을 고른 경우가 유일하다(Generate §5-1 과 같은 문구). */
const HTTP_PICKER_HINT = "원격 서버에 붙습니다. 위 서버 명령은 쓰이지 않습니다.";

export interface RunServerPatch {
  readonly choice: RunServerChoice;
  readonly command: string;
  readonly args: readonly string[];
  readonly method: CommandMethod;
  readonly target: string;
  readonly transport: Transport;
  readonly url: string;
  readonly headerEnvs: readonly string[];
}

/**
 * 1단계 — 테스트할 서버. 접속 방식, 서버 목록, 직접 입력을 위에서 아래로 쌓는다.
 * Generate 1단계(`StepTarget`)와 같은 순서·같은 컴포넌트다. 같은 프로젝트의 같은 서버를
 * 두 화면에서 다른 모양으로 고르게 두면 사용자는 그 차이를 기능으로 읽는다.
 *
 * **접속 방식이 여기 있는 것이 홈에서 바뀐 점이다.** 예전에는 테스트 옵션 안에 접혀 있었는데,
 * 마법사에서는 명령이 비면 1단계를 통과할 수 없어 HTTP 사용자가 갇힌다.
 */
export function StepRunServer(props: {
  choice: RunServerChoice;
  /** 후보 갈래의 유효 명령. manual 이면 `method`·`target` 에서 구한다. */
  command: string;
  args: readonly string[];
  method: CommandMethod;
  target: string;
  transport: Transport;
  url: string;
  headerEnvs: readonly string[];
  candidates: readonly ServerCandidate[];
  /** 탐색 루트(`GET /api/meta`). 못 받았으면 null 이고 안내에서 경로만 빠진다. */
  root: string | null;
  recentCommands: readonly string[];
  onChange: (patch: Partial<RunServerPatch>) => void;
}): JSX.Element {
  const http = props.transport === "http";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">접속</p>
        <TransportFields
          idPrefix="home-run"
          transport={props.transport}
          url={props.url}
          headerEnvs={props.headerEnvs}
          onChange={props.onChange}
        />
      </div>

      <ServerPicker
        candidates={props.candidates}
        lastRun={null}
        choice={props.choice}
        onChoose={(choice) => {
          // `last-run` 은 `lastRun: null` 이라 그려지지 않으므로 여기 닿지 않는다.
          if (choice.kind === "last-run") {
            return;
          }
          const picked =
            choice.kind === "candidate"
              ? props.candidates.find((candidate) => candidate.id === choice.id)
              : undefined;
          // 직접 입력으로 옮길 때 앞 후보의 인자를 남기면 새로 적은 스크립트에 남의 인자가 붙는다.
          props.onChange({
            choice,
            command: picked?.command ?? "",
            args: picked === undefined ? [] : [...picked.args],
          });
        }}
        disabled={http}
        disabledHint={HTTP_PICKER_HINT}
        root={props.root}
      />

      {props.choice.kind === "manual" && (
        <StepServer
          idPrefix="home-run"
          method={props.method}
          target={props.target}
          args={props.args}
          disabled={http}
          recentCommands={props.recentCommands}
          onMethodChange={(method) => props.onChange({ method })}
          onTargetChange={(target) => props.onChange({ target })}
          onArgsChange={(args) => props.onChange({ args })}
        />
      )}
    </div>
  );
}
