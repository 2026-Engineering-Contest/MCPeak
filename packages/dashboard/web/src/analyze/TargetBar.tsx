import type { JSX } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { describeRun } from "../run-target.js";
import { AnalyzeTargetForm } from "./AnalyzeTargetForm.js";
import type { SecurityForm } from "./build-security-request.js";
import { SecurityOptions } from "./SecurityOptions.js";
import type { AnalyzeTarget } from "./use-analyze-target.js";

/** 접힌 바의 칸 하나. 라벨 위, 값 아래. 값은 한 요소의 한 문자열이다. */
function BarCell({
  label,
  value,
  grow = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly grow?: boolean;
}): JSX.Element {
  return (
    <div className={`grid min-w-0 gap-0.5 ${grow ? "flex-[1_1_200px]" : ""}`}>
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <span className="truncate font-mono text-xs text-ink">{value}</span>
    </div>
  );
}

/**
 * 대상 영역(설계 §3.2). 펼침이면 접속 폼·보안 옵션·한 번에 분석, 접힘이면 한 줄 바다. 어느 모양이든
 * 버튼과 비활성 사유는 같은 자리에 있다. 결과는 여기서 지우지 않는다. 다음 한 번에 분석이 교체한다.
 */
export function TargetBar({
  target,
  form,
  onFormChange,
  open,
  onOpen,
  onRunAll,
  disabledReason,
  running,
}: {
  readonly target: AnalyzeTarget;
  readonly form: SecurityForm;
  readonly onFormChange: (partial: Partial<SecurityForm>) => void;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onRunAll: () => void;
  /** null 이면 활성. 문장이면 비활성이고 버튼 아래에 보인다. */
  readonly disabledReason: string | null;
  readonly running: boolean;
}): JSX.Element {
  const runButton = (
    <Button variant="primary" disabled={disabledReason !== null} onClick={onRunAll}>
      {running ? "분석 중…" : "한 번에 분석"}
    </Button>
  );
  const reason = disabledReason !== null && (
    <p className="text-xs text-ink-muted">{disabledReason}</p>
  );

  if (open) {
    return (
      <Card className="space-y-5 p-6">
        <AnalyzeTargetForm target={target} />
        <SecurityOptions form={form} transport={target.state.transport} onChange={onFormChange} />
        <div className="space-y-2 border-t border-line pt-5">
          {runButton}
          {reason}
        </div>
      </Card>
    );
  }

  // 접힘은 시작 성공 뒤에만 되므로 argv 의 오류 갈래는 빈 문자열이면 된다.
  const serverName =
    target.serverId === undefined
      ? "직접 입력"
      : (target.candidates.find((candidate) => candidate.id === target.serverId)?.name ??
        target.serverId);
  const command =
    "argv" in target.argv ? (describeRun("audit", target.argv.argv).server ?? "") : "";
  const baseline = form.baselinePath.trim();
  const options =
    `probe ${form.probe}` +
    (baseline === "" ? " · 기준 파일 없음" : ` · 기준 파일 ${baseline}`) +
    (form.sandbox && target.state.transport !== "http" ? " · 격리" : "");

  return (
    <Card className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <BarCell label="서버" value={serverName} />
        <BarCell label="명령" value={command} grow />
        <BarCell label="보안 옵션" value={options} />
        <div className="ml-auto flex shrink-0 gap-2">
          <Button onClick={onOpen}>대상 바꾸기</Button>
          {runButton}
        </div>
      </div>
      {reason}
    </Card>
  );
}
