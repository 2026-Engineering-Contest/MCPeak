import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import type { AnalyzeTab } from "./analyze/types.js";
import { Sidebar } from "./components/Sidebar.js";
import { ThemeToggle } from "./components/ThemeToggle.js";
import { leaveBlocker } from "./leave-guard.js";
import {
  type AppMode,
  getStoredAppMode,
  MODE_HOME,
  modeOfHash,
  saveAppMode,
  WELCOME_HASH,
} from "./mode.js";
import { AnalyzeView } from "./screens/AnalyzeView.js";
import { GenerateWizard } from "./screens/GenerateWizard.js";
import { Home } from "./screens/Home.js";
import { MockBuilder } from "./screens/MockBuilder.js";
import { PreCheck } from "./screens/PreCheck.js";
import { RepairReview } from "./screens/RepairReview.js";
import { ReplayView } from "./screens/ReplayView.js";
import { RunView } from "./screens/RunView.js";
import { SettingsView } from "./screens/SettingsView.js";
import { Welcome } from "./screens/Welcome.js";
import { themeStorage } from "./theme.js";

/**
 * 해시 라우팅(구현계획 §4-3). 라우터 의존성 없이 `location.hash`만 본다.
 *
 * | 라우트 | 화면 |
 * |---|---|
 * | `#/home` (개발자 모드의 기본 리다이렉트 대상) | Home |
 * | `#/runs`, `#/runs/:id` | RunView (`#/runs`는 목록 상태) |
 * | `#/generate` | GenerateWizard |
 * | `#/mock` | MockBuilder (목 만들기) |
 * | `#/repair/:id` | RepairReview |
 * | `#/analyze`, `#/analyze/:tab` | AnalyzeView (`tokens` 기본, `security` 는 보안 탭) |
 * | `#/settings` | SettingsView (준비 중) |
 * | `#/user/check` (사용자 모드의 기본 리다이렉트 대상) | PreCheck (사전 점검) |
 * | `#/welcome` | Welcome (모드 선택. 저장된 모드가 없을 때의 기본 리다이렉트 대상) |
 *
 * 모드(ADR-0111): 지금 화면의 모드는 해시가 먼저 정하고(`modeOfHash`), 해시가 말하지 않으면 저장값,
 * 그것도 없으면 개발자다. 저장값은 해시를 받아들일 때 쓴다. 링크를 누를 때가 아니다.
 *
 * 이탈 확인: 화면이 `useLeaveGuard` 로 막아 두면 해시를 되돌리고 그 화면이 묻는다(leave-guard.ts).
 */
type Route =
  | { readonly screen: "home" }
  | { readonly screen: "runs"; readonly runId: string | null }
  | { readonly screen: "generate" }
  | { readonly screen: "replay" }
  | { readonly screen: "mock" }
  | { readonly screen: "repair"; readonly runId: string | null }
  | { readonly screen: "analyze"; readonly tab: AnalyzeTab }
  | { readonly screen: "settings" }
  | { readonly screen: "check" }
  | { readonly screen: "welcome" }
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
  if (first === "mock") {
    return { screen: "mock" };
  }
  if (first === "repair") {
    return {
      screen: "repair",
      runId: rest[0] !== undefined ? decodeRouteValue(rest[0]) : null,
    };
  }
  if (first === "analyze") {
    // 모르는 탭 이름은 기본 탭으로 연다. 화면을 통째로 #/home 으로 보내면 Analyze 메뉴를 고른
    // 사용자가 엉뚱한 화면에 선다.
    return { screen: "analyze", tab: rest[0] === "security" ? "security" : "tokens" };
  }
  if (first === "settings") {
    return { screen: "settings" };
  }
  if (first === "welcome") {
    return { screen: "welcome" };
  }
  if (first === "user") {
    // 사용자 모드의 화면은 아직 사전 점검 하나다. 그 밖의 `#/user/...` 는 갈 곳이 없는 주소다.
    return rest[0] === "check" ? { screen: "check" } : { screen: "redirect" };
  }
  // 빈 해시·알 수 없는 해시는 모드의 첫 화면으로, 고른 모드가 없으면 선택 화면으로 보낸다.
  return { screen: "redirect" };
}

export function App(): JSX.Element {
  const [hash, setHash] = useState<string>(() => window.location.hash);
  /** 마지막으로 받아들인 해시. 이탈을 막을 때 여기로 되돌린다. */
  const accepted = useRef(window.location.hash);

  useEffect(() => {
    const onHashChange = (): void => {
      const onBlocked = leaveBlocker();
      if (onBlocked !== null) {
        const target = window.location.hash;
        // replaceState 는 hashchange 를 다시 쏘지 않는다.
        window.history.replaceState(null, "", accepted.current);
        onBlocked(target);
        return;
      }
      accepted.current = window.location.hash;
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);
    return (): void => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  /** 마지막으로 머문 모드. 없으면 아직 고르지 않았다. */
  const [storedMode, setStoredMode] = useState<AppMode | null>(() =>
    getStoredAppMode(themeStorage()),
  );

  const route = parseRoute(hash);
  const hashMode = modeOfHash(hash);

  /*
    **도착할 때 저장한다.** 링크를 누를 때 저장하면, 이탈 확인이 이동을 막았을 때 이동은 안 했는데
    저장만 바뀐다. `hash` 는 이탈 확인을 통과한 해시만 담는다. 리다이렉트될 해시(`#/user/unknown`)는
    화면에 도착하지 않았으므로 저장하지 않는다.
  */
  useEffect(() => {
    if (route.screen === "redirect" || hashMode === null || hashMode === storedMode) return;
    saveAppMode(hashMode, themeStorage());
    setStoredMode(hashMode);
  }, [route.screen, hashMode, storedMode]);

  const redirectTarget = storedMode === null ? WELCOME_HASH : MODE_HOME[storedMode];

  useEffect(() => {
    if (route.screen === "redirect") {
      window.location.hash = redirectTarget;
      accepted.current = redirectTarget;
      setHash(redirectTarget);
    }
  }, [route.screen, redirectTarget]);

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
      {/* 선택 화면에는 사이드바가 없다. 아직 모드를 고르지 않아 보일 메뉴가 없다. */}
      {route.screen !== "welcome" && (
        <Sidebar active={route.screen} mode={hashMode ?? storedMode ?? "developer"} />
      )}
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
    case "mock":
      return <MockBuilder />;
    case "repair":
      return <RepairReview runId={route.runId} />;
    case "analyze":
      return <AnalyzeView tab={route.tab} />;
    case "settings":
      return <SettingsView />;
    case "check":
      return <PreCheck />;
    case "welcome":
      return <Welcome />;
  }
}
