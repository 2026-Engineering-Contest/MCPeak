import type { JSX } from "react";
import { Button } from "../components/Button.js";
import { Card } from "../components/Card.js";
import { describeRun } from "../run-target.js";
import { AnalyzeTargetForm } from "./AnalyzeTargetForm.js";
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
 * 대상 영역(설계 §3.2, ADR-0117). 펼침이면 접속 폼·분석하기, 접힘이면 한 줄 바다. 점검 옵션은 없다.
 * 접힌 바에는 분석하기가 없다. 다시 분석하려면 대상 바꾸기로 폼을 펼친다(사용자 결정 2026-10-19).
 * 결과는 여기서 지우지 않는다. 다음 분석하기가 교체한다.
 */
export function TargetBar({
  target,
  open,
  onOpen,
  onRunAll,
  disabledReason,
  running,
  notice = null,
}: {
  readonly target: AnalyzeTarget;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onRunAll: () => void;
  /** null 이면 활성. 문장이면 비활성이고 버튼 아래에 보인다. */
  readonly disabledReason: string | null;
  readonly running: boolean;
  /** 펼친 폼의 분석하기 아래에 늘 보이는 안내. null 이면 없다. */
  readonly notice?: string | null;
}): JSX.Element {
  const runButton = (
    <Button variant="primary" disabled={disabledReason !== null} onClick={onRunAll}>
      {running ? "분석 중…" : "분석하기"}
    </Button>
  );
  const reason = disabledReason !== null && (
    <p className="text-xs text-ink-muted">{disabledReason}</p>
  );

  if (open) {
    return (
      <Card className="space-y-5 p-6">
        <AnalyzeTargetForm target={target} />
        <div className="space-y-2 border-t border-line pt-5">
          {runButton}
          {reason}
          {notice !== null && <p className="text-xs text-ink-muted">{notice}</p>}
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

  return (
    <Card className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <BarCell label="서버" value={serverName} />
        <BarCell label="명령" value={command} grow />
        <div className="ml-auto flex shrink-0 gap-2">
          <Button onClick={onOpen}>대상 바꾸기</Button>
        </div>
      </div>
    </Card>
  );
}
