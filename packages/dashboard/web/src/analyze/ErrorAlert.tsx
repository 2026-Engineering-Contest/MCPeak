import type { JSX } from "react";

const ALERT_CLASS =
  "overflow-x-auto whitespace-pre-wrap rounded-lg border border-line bg-surface px-4 py-3 font-mono text-xs";

/** CLI·서버가 준 오류 문장을 원문 그대로 보인다. 토큰·보안 양쪽과 PreCheck 가 같은 모양을 쓴다. */
export function ErrorAlert({ message }: { readonly message: string }): JSX.Element {
  return (
    <pre role="alert" className={ALERT_CLASS} style={{ color: "var(--status-failed-fg)" }}>
      {message}
    </pre>
  );
}
