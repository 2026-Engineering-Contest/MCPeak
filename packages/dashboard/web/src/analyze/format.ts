/**
 * 토큰 탭의 숫자 표기. `packages/optimize/src/report.ts` 와 같은 식이다. 화면 숫자와 CLI 리포트
 * 숫자가 한 글자라도 다르면 사용자는 둘 중 하나를 틀렸다고 읽는다. web 은 `@mcpeak/optimize` 를
 * 값으로 import 하지 않으므로(번들에 서버 코드가 섞인다) 여기 다시 적는다.
 */

/** `packages/optimize/src/report.ts` 와 같다. 소수 첫째 자리, 분모 0 이면 "0.0". */
export function percent(reduced: number, base: number): string {
  if (base === 0) return "0.0";
  return (Math.round((reduced / base) * 100 * 10) / 10).toFixed(1);
}

/** 토큰은 바이트÷4 근사(report.ts 와 같다). */
export function tokens(bytes: number): number {
  return Math.round(bytes / 4);
}
