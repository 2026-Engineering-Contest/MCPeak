import type { JSX } from "react";
import { RunStreamPanel } from "./RunView.js";

/**
 * repair run의 스트림 화면(UI 설계 §5-5). diff·제안 본문은 stdout 텍스트 그대로
 * 보여준다(별도 diff 파서를 두지 않는다. 실패 메시지와 제안 문면이 곧 제품이라
 * 재구성하면 CLI와 다른 화면이 된다. ± 행 색은 CLI의 ANSI 출력을 서버 ansiToHtml이
 * 변환한 span 클래스가 담당한다). 승인/거부는 스트림 중 뜨는 QuestionPanel의
 * confirm/choose가 담당한다.
 */
interface RepairReviewProps {
  readonly runId: string | null;
}

export function RepairReview({ runId }: RepairReviewProps): JSX.Element {
  if (runId === null) {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold text-ink">수리 검토</h1>
        <p className="text-ink-muted">
          실행 화면에서 실패한 스위트의 수리를 시작하면 이 화면으로 이동합니다.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">
        수리 검토 · <span className="font-mono">{runId}</span>
      </h1>
      <p className="text-sm text-ink-muted">
        아래 로그는 CLI가 출력하는 것과 동일한 문장입니다. 승인·거부는 질문이 뜨면 답합니다.
      </p>
      <RunStreamPanel runId={runId} showRepairAction={false} />
    </section>
  );
}
