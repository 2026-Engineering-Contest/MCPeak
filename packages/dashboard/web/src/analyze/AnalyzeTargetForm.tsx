import type { JSX } from "react";
import { StepRunServer } from "../home/steps/StepRunServer.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";

/**
 * Analyze 의 접속 폼. `StepRunServer` 를 `target` 의 값으로 그린다. 토큰 패널과 보안 패널이 같은
 * 열두 prop 을 두 번 적지 않게 한다.
 */
export function AnalyzeTargetForm({ target }: { readonly target: AnalyzeTarget }): JSX.Element {
  const { state } = target;
  return (
    <StepRunServer
      choice={state.choice}
      command={state.command}
      args={state.args}
      method={state.method}
      target={state.target}
      transport={state.transport}
      url={state.url}
      headerEnvs={state.headerEnvs}
      candidates={target.candidates}
      root={target.root}
      recentCommands={target.recentCommands}
      onChange={target.patchServer}
    />
  );
}
