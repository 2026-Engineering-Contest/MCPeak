import { RunStreamPanel } from "./RunView.js";

/**
 * repair run의 스트림 화면. diff·제안 본문은 stdout 텍스트 그대로 보여준다(별도 diff
 * 파서를 두지 않는다. 실패 메시지와 제안 문면이 곧 제품이라 재구성하면 CLI와 다른
 * 화면이 된다). 승인/거부는 스트림 중 뜨는 `QuestionPanel`의 confirm/choose가 담당한다.
 */
interface RepairReviewProps {
  readonly runId: string | null;
}

export function RepairReview({ runId }: RepairReviewProps) {
  if (runId === null) {
    return (
      <section className="space-y-3">
        <h1 className="text-xl font-semibold text-slate-900">수리 검토</h1>
        <p className="text-slate-600">
          실행 화면에서 실패한 스위트의 수리를 시작하면 이 화면으로 이동합니다.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-900">수리 검토 · {runId}</h1>
      <p className="text-sm text-slate-500">
        아래 로그는 CLI가 출력하는 것과 동일한 문장입니다. 승인·거부는 질문이 뜨면 답합니다.
      </p>
      <RunStreamPanel runId={runId} showRepairAction={false} />
    </section>
  );
}
