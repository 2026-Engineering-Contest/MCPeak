import { useEffect, useState } from "react";
import { CassetteBrowser } from "./screens/CassetteBrowser.js";
import { GenerateWizard } from "./screens/GenerateWizard.js";
import { Home } from "./screens/Home.js";
import { RepairReview } from "./screens/RepairReview.js";
import { RunView } from "./screens/RunView.js";

/**
 * 화면 5개의 해시 라우팅. 라우터 의존성 없이 `location.hash`만 본다.
 * `run`·`repair`·`cassettes`는 해시에서 식별자(run id, 카세트 경로)를 추가로 뽑는다.
 */
type ScreenId = "home" | "run" | "generate" | "cassettes" | "repair";

interface ScreenDefinition {
  readonly id: ScreenId;
  readonly label: string;
  readonly hash: string;
}

const NAV_SCREENS: readonly ScreenDefinition[] = [
  { id: "home", label: "홈", hash: "#/" },
  { id: "run", label: "실행", hash: "#/run" },
  { id: "generate", label: "생성", hash: "#/generate" },
  { id: "cassettes", label: "카세트", hash: "#/cassettes" },
  { id: "repair", label: "수리", hash: "#/repair" },
];

type Route =
  | { readonly screen: "home" }
  | { readonly screen: "run"; readonly runId: string | null }
  | { readonly screen: "generate" }
  | { readonly screen: "cassettes"; readonly path: string | null }
  | { readonly screen: "repair"; readonly runId: string | null };

/**
 * `#/run/<runId>`, `#/cassettes/<인코딩된 경로>` 처럼 첫 세그먼트가 화면을, 그
 * 뒤가 식별자를 가리키는 해시를 해석한다. 식별자가 없으면 null이다(예: `#/run`만
 * 있으면 실행 화면이지만 아직 특정 run을 보는 중은 아니다).
 */
function parseRoute(hash: string): Route {
  const withoutHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const segments = withoutHash.split("/").filter((segment) => segment.length > 0);
  const [first, ...rest] = segments;

  if (first === "run") {
    return { screen: "run", runId: rest[0] !== undefined ? decodeURIComponent(rest[0]) : null };
  }
  if (first === "generate") {
    return { screen: "generate" };
  }
  if (first === "cassettes") {
    return {
      screen: "cassettes",
      path: rest.length > 0 ? decodeURIComponent(rest.join("/")) : null,
    };
  }
  if (first === "repair") {
    return {
      screen: "repair",
      runId: rest[0] !== undefined ? decodeURIComponent(rest[0]) : null,
    };
  }
  return { screen: "home" };
}

export function App() {
  const [hash, setHash] = useState<string>(() => window.location.hash || "#/");

  useEffect(() => {
    const onHashChange = (): void => {
      setHash(window.location.hash || "#/");
    };
    window.addEventListener("hashchange", onHashChange);
    return (): void => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const route = parseRoute(hash);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      <nav className="w-56 shrink-0 border-r border-slate-200 bg-white p-4">
        <p className="mb-4 px-2 text-sm font-semibold text-slate-400">OhMyMCP 대시보드</p>
        <ul className="space-y-1">
          {NAV_SCREENS.map((screen) => (
            <li key={screen.id}>
              <a
                className={`block rounded px-3 py-2 text-sm font-medium ${
                  screen.id === route.screen
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-100"
                }`}
                href={screen.hash}
                aria-current={screen.id === route.screen ? "page" : undefined}
              >
                {screen.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-8">
        <Screen route={route} />
      </main>
    </div>
  );
}

function Screen({ route }: { readonly route: Route }) {
  switch (route.screen) {
    case "home":
      return <Home />;
    case "run":
      return <RunView runId={route.runId} />;
    case "generate":
      return <GenerateWizard />;
    case "cassettes":
      return <CassetteBrowser path={route.path} />;
    case "repair":
      return <RepairReview runId={route.runId} />;
    default:
      return <Home />;
  }
}
