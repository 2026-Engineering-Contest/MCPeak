/**
 * 정렬 비교자. 보고서와 finding 목록의 순서를 실행 환경과 무관하게 고정한다.
 *
 * 이 파일은 패키지 내부 전용이다. `index.ts` 로 내보내지 않는다.
 */

/**
 * UTF-16 코드 단위 안정 비교.
 *
 * `localeCompare` 를 쓰지 않는 이유는 결과가 로캘과 ICU 데이터에 따라 달라지기 때문이다.
 * 같은 입력에 항상 같은 순서가 나와야 보고서 바이트가 재현된다.
 */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
