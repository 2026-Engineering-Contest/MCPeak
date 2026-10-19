/** 축 하나의 분석 상태. 카드와 상세가 같은 값을 읽는다. */
export type PillarState<Result> =
  | { readonly kind: "idle" }
  | { readonly kind: "running" }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "done"; readonly result: Result; readonly serial: number };

/** 오류 문장의 첫 줄. 빈 문자열이면 빈 문자열. 첫 `\n` 앞까지이고 `\r` 은 지운다. 카드가 쓴다. 전문은 상세가 보인다. */
export function firstLine(message: string): string {
  const end = message.indexOf("\n");
  return (end === -1 ? message : message.slice(0, end)).replaceAll("\r", "");
}
