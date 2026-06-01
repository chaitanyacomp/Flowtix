import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./style.css";
import { ToastProvider } from "./contexts/ToastContext";
import { DemoModeProvider } from "./contexts/DemoModeContext";
import { DemoSafeToastBridge } from "./components/demo/DemoSafeToastBridge";
import { applyBrandIdentity } from "./components/branding/Branding";
import { installErpModalEscapeListener } from "./lib/erpModalEscape";

applyBrandIdentity();
installErpModalEscapeListener();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <DemoModeProvider>
          <DemoSafeToastBridge />
          <App />
        </DemoModeProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

/**
 * Fade out the pre-mount FT ERP splash (declared in `index.html`) once React
 * has painted its first frame. Two `requestAnimationFrame`s wait until the
 * app body is visible so the handoff stays seamless.
 */
function hideInitialSplash(): void {
  const splash = document.getElementById("ft-erp-splash");
  if (!splash) return;
  splash.style.transition = "opacity 240ms cubic-bezier(0.4, 0, 0.2, 1)";
  splash.style.opacity = "0";
  splash.style.pointerEvents = "none";
  window.setTimeout(() => splash.remove(), 260);
}
if (typeof requestAnimationFrame === "function") {
  requestAnimationFrame(() => requestAnimationFrame(hideInitialSplash));
} else {
  hideInitialSplash();
}

