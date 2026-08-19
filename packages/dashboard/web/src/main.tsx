import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { applyThemeChoice, getThemeChoice } from "./theme.js";
import "./theme.css";

// 첫 페인트 전에 저장된 테마를 1회 적용한다(깜빡임 방지).
applyThemeChoice(getThemeChoice(localStorage), document.documentElement, localStorage);

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root 엘리먼트를 찾을 수 없습니다.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
