import type { CSSProperties, JSX } from "react";
import { Card } from "../components/Card.js";
import { FOCUS_RING } from "../components/focus-ring.js";
import { type AppMode, MODE_HOME } from "../mode.js";

/**
 * 카드의 순서가 곧 화면의 순서다. 문장은 계획서 §4.4 의 글자다.
 *
 * `color` 는 제목과 호버 테두리의 색이다. 두 모드가 색으로 먼저 갈리게 한다. 개발자는 대시보드의
 * 강조색, 사용자는 초록이다. 초록은 새 토큰을 만들지 않고 테마가 이미 가진 값을 쓴다. 밝은 테마와
 * 어두운 테마의 값이 함께 정의돼 있다.
 */
const CHOICES: readonly {
  readonly mode: AppMode;
  readonly title: string;
  readonly description: string;
  readonly color: string;
}[] = [
  {
    mode: "developer",
    title: "개발자",
    description: "MCP를 만들고 테스트합니다. 테스트 실행, 생성, 녹화·재생, 목, 분석을 씁니다.",
    color: "var(--accent)",
  },
  {
    mode: "user",
    title: "사용자",
    description: "쓰려는 MCP를 등록하기 전에 점검합니다.",
    color: "var(--status-done-fg)",
  },
];

/**
 * 모드 선택(ADR-0111). 저장된 모드가 없고 갈 곳이 없는 주소일 때만 온다.
 *
 * **상태가 없다.** 두 카드는 각 모드의 첫 화면을 가리키는 링크이고, 모드는 App 이 그 해시를 받아들일
 * 때 저장한다. 카드 전체가 링크 하나라 접근 이름은 제목과 설명을 이은 글자다.
 */
export function Welcome(): JSX.Element {
  return (
    <section className="mx-auto flex h-full max-w-[1040px] flex-col justify-center space-y-12 text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-ink">MCP를 어떻게 쓰시나요?</h1>
      <div className="grid gap-6 sm:grid-cols-2">
        {CHOICES.map((choice) => (
          <a
            key={choice.mode}
            href={MODE_HOME[choice.mode]}
            className={`group block rounded-lg text-left ${FOCUS_RING}`}
            style={{ "--choice-color": choice.color } as CSSProperties}
          >
            <Card className="h-full min-h-[220px] space-y-4 p-10 transition-colors group-hover:border-[var(--choice-color)]">
              <h2 className="text-3xl font-semibold" style={{ color: choice.color }}>
                {choice.title}
              </h2>
              <p className="text-lg text-ink-muted">{choice.description}</p>
            </Card>
          </a>
        ))}
      </div>
      <p className="text-body text-ink-muted">사이드바 아래에서 언제든 바꿀 수 있습니다.</p>
    </section>
  );
}
