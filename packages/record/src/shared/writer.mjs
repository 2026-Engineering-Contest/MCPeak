/**
 * 기록자 식별자를 나르는 헤더.
 *
 * body 가 아니라 헤더인 이유는 `/begin` · `/complete` · `/lookup` 세 payload 의 형식을 건드리지
 * 않기 위해서다. 그 셋은 ADR-0052 의 마스킹 재검사를 지나는데, 거기에 실행마다 달라지는 값을
 * 넣으면 검사 대상과 저장 대상이 뒤섞인다. 식별자는 저장되지 않는 값이라 payload 밖에 둔다.
 */
export const WRITER_HEADER = "x-mcpeak-external-writer";
