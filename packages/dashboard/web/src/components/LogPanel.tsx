import type { JSX, ReactNode } from "react";
import type { RunEvent } from "../../../src/api-types.js";

/**
 * 로그 패널(UI 설계 §4). 터미널 재현 영역이라 테마와 무관하게 항상 다크다.
 * 다크 모드 구분 장치(UI 설계 §3): 본문 --terminal-bg(주변보다 어두운 단차),
 * 테두리 --terminal-border(다크에서 주변 --line보다 밝음), 헤더 스트립
 * --terminal-header-bg, 다크에서만 값이 생기는 inset 하이라이트 --terminal-inset.
 *
 * stdout/stderr만 수신 순서 그대로 렌더한다. html은 dangerouslySetInnerHTML로
 * 넣는다. 이스케이프는 서버 ansiToHtml이 보장한다(기반 계획 T1 테스트가 지키는
 * 전제, 기반 계획 T4와 동일).
 */
export function LogPanel(props: {
  title: string;
  meta?: ReactNode;
  events: readonly RunEvent[];
  footer?: ReactNode;
}): JSX.Element {
  return (
    <section
      className="overflow-hidden rounded-lg"
      style={{
        background: "var(--terminal-bg)",
        border: "1px solid var(--terminal-border)",
        boxShadow: "var(--terminal-inset)",
      }}
    >
      <header
        className="flex items-center justify-between px-4 py-2"
        style={{ background: "var(--terminal-header-bg)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--terminal-muted)" }}>
          {props.title}
        </span>
        {props.meta !== undefined && <span>{props.meta}</span>}
      </header>
      <div
        className="max-h-[60vh] overflow-auto whitespace-pre-wrap p-4 font-mono"
        style={{ color: "var(--terminal-fg)", fontSize: 13, lineHeight: 1.85 }}
      >
        {props.events.map((event, index) => {
          if (event.kind !== "stdout" && event.kind !== "stderr") {
            return null;
          }
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 스트림은 append-only라 수신 순서 index가 안정 키다(구현계획 §4-5)
            // biome-ignore lint/security/noDangerouslySetInnerHtml: html 이스케이프는 서버 ansiToHtml이 보장한다(구현계획 §4-5)
            <div key={index} dangerouslySetInnerHTML={{ __html: event.html }} />
          );
        })}
      </div>
      {props.footer !== undefined && (
        <div className="p-3" style={{ borderTop: "1px solid var(--terminal-border)" }}>
          {props.footer}
        </div>
      )}
    </section>
  );
}
