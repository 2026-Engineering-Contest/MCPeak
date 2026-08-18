import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./index.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("#root 엘리먼트를 찾을 수 없습니다.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
