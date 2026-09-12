import type { JSX, ReactNode } from "react";

/**
 * 화면 머리 하나 (#459).
 *
 * 예전에는 화면 제목이 **두 번** 나왔다. 앱 헤더 스트립이 `Test`(영), 본문 h1 이 `테스트`(한)
 * 였고, h1 은 `text-xl` 이라 본문 `text-sm` 과 한 단 차이였다. 스트립은 64px 를 쓰면서 단어
 * 하나만 담았다. 스트립을 걷고 제목을 여기 한 곳에 둔다 — 크기는 `text-display` 다.
 *
 * `aside` 는 제목 줄 오른쪽이다. 실행 화면이 상태를 여기 둔다.
 */
export interface PageHeaderProps {
  readonly title: ReactNode;
  /** 제목 위의 되돌아가기 링크. 해시 라우팅이라 `href` 하나면 된다. */
  readonly back?: { readonly href: string; readonly label: string };
  /** 제목 아래 한 줄 설명. */
  readonly description?: ReactNode;
  /** 설명 아래 부가 정보(경로·식별자 등). 모양은 부르는 쪽이 정한다. */
  readonly meta?: ReactNode;
  readonly aside?: ReactNode;
}

export function PageHeader({
  title,
  back,
  description,
  meta,
  aside,
}: PageHeaderProps): JSX.Element {
  return (
    <header className="shrink-0 space-y-1">
      {/* 되돌아가기는 제목 줄 **위에** 따로 둔다. 같은 줄에 두면 `aside` 가 제목이 아니라 이
          링크 높이에 맞춰 떠서, 오른쪽 위 테마 토글과 붙어 보였다. */}
      {back !== undefined && (
        <a
          className="inline-flex items-center gap-1 rounded-sm text-caption font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          href={back.href}
        >
          <span aria-hidden="true">←</span>
          {back.label}
        </a>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        {/*
          기준 폭이 360px 이다(`flex-1` 의 기준 0 이 아니다). 기준이 0 이면 `aside` 가 넓을 때 이
          칸이 한 글자 폭까지 눌려 경로가 줄마다 끊겼다. 기준이 있으면 모자랄 때 `aside` 가 아래
          줄로 내려간다.
        */}
        <div className="min-w-0 flex-[1_1_360px] space-y-1">
          <h1 className="text-display font-semibold tracking-tight text-ink">{title}</h1>
          {description !== undefined && <p className="text-body text-ink-muted">{description}</p>}
          {meta}
        </div>
        {aside !== undefined && <div className="flex shrink-0 items-start gap-3">{aside}</div>}
      </div>
    </header>
  );
}
