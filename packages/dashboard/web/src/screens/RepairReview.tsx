import type { JSX } from "react";
import { Card } from "../components/Card.js";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";
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
      <section className="mx-auto max-w-[800px] space-y-6">
        <PageHeader title="수리 검토" />
        <Card>
          <EmptyState
            message="검토할 수리가 없습니다."
            hint="실행 화면에서 실패한 스위트의 수리를 시작하면 이 화면으로 이동합니다."
            action={{ href: "#/runs", label: "실패한 실행 고르기" }}
          />
        </Card>
      </section>
    );
  }

  return (
    <RunStreamPanel
      runId={runId}
      title="수리 검토"
      description="아래 로그는 CLI가 출력하는 것과 동일한 문장입니다. 승인·거부는 질문이 뜨면 답합니다."
      showRepairAction={false}
    />
  );
}
