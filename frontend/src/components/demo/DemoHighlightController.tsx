import * as React from "react";
import { useDemoMode } from "../../contexts/DemoModeContext";
import { getDemoStepCount } from "../../lib/demoFlowConfig";

/** Applies `.demo-highlight` + scroll to `[data-demo-highlight]` for the active demo step. */
export function DemoHighlightController() {
  const demo = useDemoMode();

  React.useLayoutEffect(() => {
    document.querySelectorAll("[data-demo-highlight]").forEach((node) => {
      if (node instanceof HTMLElement) node.classList.remove("demo-highlight");
    });

    if (!demo.enabled || !demo.flow || demo.step > getDemoStepCount(demo.flow)) return;

    const key = `${demo.flow}-${demo.step}`;
    const el = document.querySelector(`[data-demo-highlight="${key}"]`);
    if (!(el instanceof HTMLElement)) return;

    el.classList.add("demo-highlight");
    window.requestAnimationFrame(() => {
      try {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        el.scrollIntoView();
      }
    });

    return () => {
      el.classList.remove("demo-highlight");
    };
  }, [demo.enabled, demo.flow, demo.step]);

  return null;
}
