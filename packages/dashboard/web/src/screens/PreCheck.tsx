import type { JSX } from "react";
import { PageHeader } from "../components/PageHeader.js";

const PRECHECK_DESCRIPTION = "등록하기 전에 MCP 서버를 한 번 띄워 도구 정의와 행동을 점검합니다.";

/**
 * 사전 점검(ADR-0111). 사용자 모드의 첫 화면이다. 지금은 제목만 있다. 본문은 다음 태스크가 채운다.
 */
export function PreCheck(): JSX.Element {
  return (
    <section className="mx-auto max-w-[800px] space-y-6">
      <PageHeader title="사전 점검" description={PRECHECK_DESCRIPTION} />
    </section>
  );
}
