import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { GenerateWizard } from "./screens/GenerateWizard.js";
import { Home } from "./screens/Home.js";
import { RepairReview } from "./screens/RepairReview.js";
import { ReplayView } from "./screens/ReplayView.js";
import { RunView } from "./screens/RunView.js";
import { SettingsView } from "./screens/SettingsView.js";

/**
 * 해시 라우팅(구현계획 §4-3). 라우터 의존성 없이 `location.hash`만 본다.
 *
 * | 라우트 | 화면 |
 * |---|---|
 * | `#/home` (기본 리다이렉트 대상) | Home |
 * | `#/runs`, `#/runs/:id` | RunView (`#/runs`는 목록 상태) |
 * | `#/generate` | GenerateWizard |
 * | `#/repair/:id` | RepairReview |
 * | `#/settings` | SettingsView (준비 중) |
 *
 */
type Route =
  | { readonly screen: "home" }
  | { readonly screen: "runs"; readonly runId: string | null }
  | { readonly screen: "generate" }
  | { readonly screen: "replay" }
  | { readonly screen: "repair"; readonly runId: string | null }
  | { readonly screen: "settings" }
  | { readonly screen: "redirect" };

/** 잘못된 인코딩(%zz 등)이 화면을 깨뜨리지 않게 한다. origin f9198e0 계승. */
function decodeRouteValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * `#/runs/<runId>`, `#/repair/<runId>` 처럼 첫 세그먼트가 화면을, 그
 * 뒤가 식별자를 가리키는 해시를 해석한다. 식별자가 없으면 null이다(예: `#/runs`만
 * 있으면 실행 화면이지만 아직 특정 run을 보는 중은 아니다).
 */
function parseRoute(hash: string): Route {
  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const segments = withoutHash.split("/").filter((segment) => segment.length > 0);
  const [first, ...rest] = segments;

  if (first === "home") {
    return { screen: "home" };
  }
  if (first === "runs") {
    return { screen: "runs", runId: rest[0] !== undefined ? decodeRouteValue(rest[0]) : null };
  }
  if (first === "generate") {
    return { screen: "generate" };
  }
  if (first === "replay") {
    return { screen: "replay" };
  }
  if (first === "repair") {
    return {
      screen: "repair",
      runId: rest[0] !== undefined ? decodeRouteValue(rest[0]) : null,
    };
  }
  if (first === "settings") {
    return { screen: "settings" };
  }
  // 빈 해시·알 수 없는 해시는 #/home으로 보낸다(§4-3 기본 리다이렉트).
  return { screen: "redirect" };
}

export function App(): JSX.Element {
  const [hash, setHash] = useState<string>(() => window.location.hash);

  useEffect(() => {
    const onHashChange = (): void => {
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return (): void => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const route = parseRoute(hash);

  useEffect(() => {
    if (route.screen === "redirect") {
      window.location.hash = "#/home";
      setHash("#/home");
    }
  }, [route.screen]);

  if (route.screen === "redirect") {
    return <div className="min-h-screen bg-canvas" />;
  }

  return (
    /*
      **문서가 아니라 `main` 이 스크롤한다.** 높이를 뷰포트에 묶어 두면 화면이 자기 높이를
      알 수 있고, 실행 화면처럼 "로그는 안에서 넘치되 질문 패널은 늘 보여야 하는" 배치가
      가능해진다. 그러지 않으면 로그가 길어질수록 아래 컨트롤이 화면 밖으로 밀려, 사용자가
      상호작용할 때마다 페이지를 다시 내려야 한다.

      내용이 긴 다른 화면들은 그대로다 — 스크롤 주체가 문서에서 `main` 으로 바뀔 뿐이라
      사용자에게는 같아 보인다.
    */
    <div className="flex h-screen bg-canvas text-ink">
      <Sidebar active={route.screen} />
      {/*
        **헤더 스트립이 없다**(#459). 예전에는 64px 스트립이 `Test` 한 단어를 담고 본문 h1 이
        `테스트` 를 또 말했다. 제목은 화면의 `PageHeader` 한 곳에만 둔다. 테마 토글만 남아
        본문 오른쪽 위 한 줄을 쓴다.

        `min-h-0` 이 없으면 flex 자식이 내용 높이 아래로 줄지 못해 `flex-1` 이 무력해진다.
      */}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto px-8 pt-4 pb-8">
        <div className="flex h-8 shrink-0 items-center justify-end">
          <ThemeToggle />
        </div>
        {/* 실행 화면이 `h-full` 로 남은 높이를 채운다. 그 기준이 되는 상자다. */}
        <div className="min-h-0 flex-1">
          <Screen route={route} />
        </div>
      </main>
    </div>
  );
}

function Screen({
  route,
}: {
  readonly route: Exclude<Route, { screen: "redirect" }>;
}): JSX.Element {
  switch (route.screen) {
    case "home":
      return <Home />;
    case "runs":
      return <RunView runId={route.runId} />;
    case "generate":
      return <GenerateWizard />;
    case "replay":
      return <ReplayView />;
    case "repair":
      return <RepairReview runId={route.runId} />;
    case "settings":
      return <SettingsView />;
  }
}
