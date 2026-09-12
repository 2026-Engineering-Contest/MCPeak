import type { JSX } from "react";
import { Card } from "../components/Card.js";
import { EmptyState } from "../components/EmptyState.js";
import { PageHeader } from "../components/PageHeader.js";

/**
 * 설정 (#459). **아직 설정할 항목이 없다.** 사이드바 자리만 먼저 잡고, 누른 사람에게는 비었다는
 * 사실과 지금 바꿀 수 있는 것(테마)이 어디 있는지를 말한다. 아무 말 없는 빈 화면이면 고장으로 읽힌다.
 */
export function SettingsView(): JSX.Element {
  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <PageHeader title="설정" />
      <Card>
        <EmptyState
          message="설정 화면은 준비 중입니다."
          hint="지금은 테마만 바꿀 수 있습니다. 화면 오른쪽 위의 Light · Dark 로 고르세요."
          action={{ href: "#/home", label: "Test 로 돌아가기" }}
        />
      </Card>
    </section>
  );
}
