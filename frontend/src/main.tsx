import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./style.css";
import { ToastProvider } from "./contexts/ToastContext";
import { DemoModeProvider } from "./contexts/DemoModeContext";
import { DemoSafeToastBridge } from "./components/demo/DemoSafeToastBridge";

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

