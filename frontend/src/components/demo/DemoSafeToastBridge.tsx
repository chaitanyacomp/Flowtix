import * as React from "react";
import { useToast } from "../../contexts/ToastContext";
import { registerDemoSafeToast } from "../../lib/demoSafeMode";

/** Registers toast handler for demo-safe API interception (see `apiFetch`). */
export function DemoSafeToastBridge() {
  const toast = useToast();

  React.useEffect(() => {
    registerDemoSafeToast((msg) => toast.showSuccess(msg));
    return () => registerDemoSafeToast(null);
  }, [toast]);

  return null;
}
