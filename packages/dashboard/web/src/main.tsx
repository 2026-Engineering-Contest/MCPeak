import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyThemeChoice, getThemeChoice, themeStorage } from "./theme.js";
import "./theme.css";

// 첫 페인트 전에 저장된 테마를 1회 적용한다(깜빡임 방지).
//
// 저장소를 themeStorage()로 받는 것이 요점이다. 여기는 React가 마운트되기 전이라
// 던지면 화면이 통째로 빈 페이지가 된다 — 저장소가 차단된 브라우저에서 실제로 그렇다.
const storage = themeStorage();
applyThemeChoice(getThemeChoice(storage), document.documentElement, storage);

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root 엘리먼트를 찾을 수 없습니다.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
