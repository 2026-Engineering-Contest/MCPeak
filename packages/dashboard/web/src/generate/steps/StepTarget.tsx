import type { JSX } from "react";
import type { ServerCandidate } from "../../../../src/api-types.js";
import { ServerPicker } from "../../components/ServerPicker.js";
import { TransportFields } from "../../components/TransportFields.js";
import type { CommandMethod } from "./StepServer.js";
import { StepServer } from "./StepServer.js";

/**
 * 어느 갈래의 서버를 쓸지(설계 §6-1). `ServerPicker` 의 `ServerChoice` 부분집합이다.
 * `last-run` 은 홈 전용이라 Generate 는 `lastRun: null` 을 넘겨 그 카드를 그리지 않는다.
 */
export type ServerChoice =
  | { readonly kind: "candidate"; readonly id: string }
  | { readonly kind: "manual" };

/** 목록이 비활성인 이유는 HTTP 대상을 고른 경우가 유일하다(홈 §5-4 와 같은 문구). */
const HTTP_PICKER_HINT = "원격 서버에 붙습니다. 위 서버 명령은 쓰이지 않습니다.";

interface TargetPatch {
  readonly choice: ServerChoice;
  readonly candidateCommand: string;
  readonly candidateArgs: readonly string[];
  readonly method: CommandMethod;
  readonly target: string;
  readonly args: readonly string[];
  readonly transport: "stdio" | "http";
  readonly url: string;
  readonly headerEnvs: readonly string[];
}

/**
 * 1단계 — 테스트할 서버(설계 §5-1). 접속 방식, 서버 목록, 직접 입력을 위에서 아래로 쌓는다.
 *
 * **고르기만 하면 되는 것이 이 단계의 요점이다.** 같은 프로젝트의 같은 서버를 홈에서는
 * 카드로 고르는데 Generate 에서만 경로를 손으로 붙여넣게 두면, 사용자는 그 차이를 기능으로
 * 읽는다. 목록은 홈과 같은 `ServerPicker` 이고 직접 입력은 마지막 갈래로 남는다.
 */
export function StepTarget(props: {
  choice: ServerChoice;
  method: CommandMethod;
  target: string;
  args: readonly string[];
  transport: "stdio" | "http";
  url: string;
  headerEnvs: readonly string[];
  candidates: readonly ServerCandidate[];
  /** 탐색 루트(`GET /api/meta`). 못 받았으면 null 이고 안내에서 경로만 빠진다. */
  root: string | null;
  recentCommands: readonly string[];
  onChange: (patch: Partial<TargetPatch>) => void;
}): JSX.Element {
  const http = props.transport === "http";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">접속</p>
        <TransportFields
          idPrefix="generate"
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
          props.onChange({
            choice,
            candidateCommand: picked?.command ?? "",
            candidateArgs: picked === undefined ? [] : [...picked.args],
          });
        }}
        disabled={http}
        disabledHint={HTTP_PICKER_HINT}
        root={props.root}
        radioName="generate-server"
      />

      {props.choice.kind === "manual" && (
        <StepServer
          idPrefix="generate"
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
