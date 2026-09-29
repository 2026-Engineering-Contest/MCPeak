import type { ReviewIO } from "./generate-command.js";

/**
 * `generate` 의 승인 질문에 정해진 정책으로 답하는 ReviewIO.
 *
 * 사람용 승인 화면(전송·시험 실행·재검증·저장 확인, 실패 분류, 교정 값 입력)을 에이전트나
 * 대시보드의 "한 번에 검증" 이 사람 개입 없이 지나가게 한다. 판정 로직은 없다. 질문마다 어떤
 * 답을 고르는지만 여기 있고, 고른 답은 `sink` 에 한 줄씩 남겨 무엇이 자동으로 결정됐는지
 * 화면에서 읽을 수 있게 한다.
 *
 * 정책:
 * - 검토 메뉴: 처음은 `save`, 그 뒤는 `cancel`. 저장이 되돌아오면(재검증 실패 등) 같은 답을
 *   되풀이하지 않고 끝낸다.
 * - 확인: 전부 예. 단 "그래도 적용합니까" 처럼 선언 위반이 남은 후보의 적용은 아니오.
 * - 실패 분류(`선택: `): `s`(서버 결함). 교정 뒤에도 남은 실패는 명세가 옳고 서버가 틀린 것으로
 *   기록한다. 보류(`?`)는 저장을 막으므로 쓰지 않는다.
 * - 교정 값 입력(`엔터 = …`): 빈 문자열. 제안이 있으면 제안 값, 없으면 현재 값을 그대로 둔다.
 * - 그 밖의 입력: 빈 문자열. 저장 경로에서는 나오지 않는다.
 */
export function autoReviewIO(sink: { write(text: string): void }): ReviewIO {
  let menuSeen = false;
  const note = (question: string, answer: string): void => {
    sink.write(`▸ 자동 승인: ${summarize(question)} → ${answer}\n`);
  };
  return {
    interactive: true,
    write: (text) => sink.write(text),
    async choose(message, choices) {
      if (message === "검토 메뉴") {
        const answer = menuSeen ? "cancel" : "save";
        menuSeen = true;
        note(message, answer);
        return answer;
      }
      const answer = choices[0] ?? "";
      note(message, answer);
      return answer;
    },
    async confirm(message) {
      const answer = !/그래도 적용합니까/.test(message);
      note(message, answer ? "예" : "아니오");
      return answer;
    },
    async input(message) {
      const answer = /^\s*선택:\s*$/.test(message) ? "s" : "";
      note(message, answer === "" ? "(엔터)" : answer);
      return answer;
    },
  };
}

/** 로그 한 줄에 들어갈 만큼만 남긴다. 질문 본문은 이미 화면에 찍혀 있다. */
function summarize(question: string): string {
  const oneLine = question.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine;
}
