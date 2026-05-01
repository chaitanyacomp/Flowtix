import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getDemoRouteForStep, getDemoStepCount, type DemoFlowKind } from "../lib/demoFlowConfig";
import { setDemoSafeActive } from "../lib/demoSafeMode";

export type { DemoFlowKind };

export type DemoModeCtx = {
  enabled: boolean;
  setDemoEnabled: (next: boolean) => void;
  flow: DemoFlowKind | null;
  step: number;
  startDemoFlow: (flow: DemoFlowKind) => void;
  nextDemoStep: () => void;
};

const DemoModeContext = createContext<DemoModeCtx | null>(null);

export function DemoModeProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(false);
  const [flow, setFlow] = useState<DemoFlowKind | null>(null);
  const [step, setStep] = useState(1);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const setDemoEnabled = useCallback((next: boolean) => {
    setEnabled(Boolean(next));
    if (!next) {
      setFlow(null);
      setStep(1);
    }
  }, []);

  const nextDemoStep = useCallback(() => {
    setStep((prev) => {
      const fk = flowRef.current;
      if (!fk) return prev;
      const count = getDemoStepCount(fk);
      const terminal = count + 1;
      if (prev >= terminal) return prev;
      const nextStep = prev + 1;
      if (nextStep <= count) {
        const path = getDemoRouteForStep(fk, nextStep);
        if (path) {
          window.setTimeout(() => navigate(path, { state: { from: "demo" } }), 0);
        }
      }
      return nextStep;
    });
  }, [navigate]);

  const nextDemoStepRef = useRef(nextDemoStep);
  nextDemoStepRef.current = nextDemoStep;

  const startDemoFlow = useCallback(
    (nextFlow: DemoFlowKind) => {
      setEnabled(true);
      setFlow(nextFlow);
      setStep(1);
      const path = getDemoRouteForStep(nextFlow, 1);
      if (path) navigate(path, { state: { from: "demo" } });
    },
    [navigate],
  );

  useEffect(() => {
    setDemoSafeActive(enabled);
  }, [enabled]);

  useEffect(() => {
    const onActionComplete = () => {
      if (!enabledRef.current) return;
      window.setTimeout(() => {
        nextDemoStepRef.current();
      }, 800);
    };
    window.addEventListener("demo:action-complete", onActionComplete);
    return () => window.removeEventListener("demo:action-complete", onActionComplete);
  }, []);

  useEffect(() => {
    const onDemoNext = () => {
      if (!enabledRef.current) return;
      nextDemoStepRef.current();
    };
    window.addEventListener("demo:next", onDemoNext);
    return () => window.removeEventListener("demo:next", onDemoNext);
  }, []);

  const value = useMemo<DemoModeCtx>(
    () => ({ enabled, setDemoEnabled, flow, step, startDemoFlow, nextDemoStep }),
    [enabled, setDemoEnabled, flow, step, startDemoFlow, nextDemoStep],
  );

  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
}

export function useDemoMode(): DemoModeCtx {
  const ctx = useContext(DemoModeContext);
  return (
    ctx ?? {
      enabled: false,
      setDemoEnabled: () => {},
      flow: null,
      step: 1,
      startDemoFlow: () => {},
      nextDemoStep: () => {},
    }
  );
}

