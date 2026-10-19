import type { JSX } from "react";
import { useEffect, useRef } from "react";
import type { RunEvent } from "../../../src/api-types.js";
import { LogPanel } from "../components/LogPanel.js";
import { useRunEvents } from "../run-stream.js";
import { ErrorAlert } from "./ErrorAlert.js";

const PROGRESS_DESCRIPTION =
  "격리 실행은 이미지를 처음 만들 때 몇 분이 걸립니다. 도는 동안 대시보드를 끄면 격리 자원이 남습니다(치우는 법: packages/audit/README.md).";

/** 진행 패널의 그리기. events 와 스트림 오류만 받는다. 구독은 부르는 쪽이 가진다. */
export function SecurityProgressView({
  events,
  error,
}: {
  readonly events: readonly RunEvent[];
  readonly error: string | null;
}): JSX.Element {
  return (
    <>
      {/* LogPanel 은 부모의 남는 높이를 채우는 모양이다. 높이를 묶어 주지 않으면 본문이 안에서
          스크롤하지 않고 화면이 로그만큼 길어진다. */}
      <div className="flex h-[440px] flex-col">
        <LogPanel title="진행" description={PROGRESS_DESCRIPTION} events={events} />
      </div>
      {error !== null && <ErrorAlert message={error} />}
    </>
  );
}

/**
 * 점검 단계의 진행 패널(구독형). 도는 점검 하나의 진행이다. run 마다 새로 마운트된다(부모가 `key` 를 run 으로
 * 준다). 그래서 앞 run 의 완료 상태가 새 run 의 첫 렌더에 남지 않고, 완료 보고는 run 마다 정확히 한 번이다.
 *
 * 타이머·폴링이 없다. 완료는 `useRunEvents` 의 status 로만 안다. `failed` 는 "발견이 있다"(종료 코드 2)일
 * 수도 있으므로 여기서는 끝났다는 것만 알리고 실패로 그리지 않는다.
 *
 * Analyze 는 구독을 `useSecurityAnalysis` 가 갖고 `SecurityProgressView` 만 쓴다. 이 컴포넌트는 `PreCheck` 용이다.
 */
export function SecurityProgress({
  runId,
  onFinished,
  onMissing,
}: {
  readonly runId: string;
  readonly onFinished: (runId: string) => void;
  /** 서버가 없다고 확인한 run 이다. 기다려도 이벤트가 오지 않으므로 부모가 폼을 다시 연다. */
  readonly onMissing: (message: string) => void;
}): JSX.Element {
  const run = useRunEvents(runId);
  const finished = run.status === "done" || run.status === "failed";
  /** 부모에 알리는 것은 run 당 한 번이다. 재연결로 지난 이벤트가 다시 흘러도 결과를 다시 읽지 않는다. */
  const reported = useRef(false);

  useEffect(() => {
    if (!finished || reported.current) {
      return;
    }
    reported.current = true;
    onFinished(runId);
  }, [finished, runId, onFinished]);

  // 조회만 실패한 경우(missing 이 아닌 error)는 run 이 살아 있을 수 있으므로 진행을 유지한다.
  const missingMessage = run.missing ? run.error : null;

  useEffect(() => {
    if (missingMessage === null || reported.current) {
      return;
    }
    reported.current = true;
    onMissing(missingMessage);
  }, [missingMessage, onMissing]);

  return <SecurityProgressView events={run.events} error={run.error} />;
}
