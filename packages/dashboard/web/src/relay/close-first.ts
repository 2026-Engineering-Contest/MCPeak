/**
 * 닫기가 **끝난 것을 확인한 뒤** 다음 동작을 시작한다.
 *
 * 이 한 줄이 따로 파일로 있는 이유는 순서가 이 화면의 계약이기 때문이다(설계 §1).
 * `[실행 시작]` 이 중계기를 안 닫고 판정 실행을 시작하면 같은 서버가 두 벌 뜬다 —
 * 컴포넌트 안에 묻어 두면 그 순서에 테스트를 걸 자리가 없다.
 *
 * 닫기가 실패하면 **시작하지 않는다.** 그때 시작하는 것이 바로 막으려던 상태다.
 */
export async function runAfterClose(
  close: () => Promise<void>,
  start: () => Promise<void>,
): Promise<void> {
  await close();
  await start();
}
