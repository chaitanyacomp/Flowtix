import * as React from "react";

type ToastKind = "success" | "error" | "info";

type ToastState = { kind: ToastKind; message: string } | null;

type ToastContextValue = {
  showSuccess: (message: string) => void;
  showError: (message: string) => void;
  /** Neutral notice (e.g. action blocked) — not aggressive red error styling */
  showInfo: (message: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = React.useState<ToastState>(null);

  const showSuccess = React.useCallback((message: string) => {
    setToast({ kind: "success", message });
  }, []);

  const showError = React.useCallback((message: string) => {
    setToast({ kind: "error", message });
  }, []);

  const showInfo = React.useCallback((message: string) => {
    setToast({ kind: "info", message });
  }, []);

  React.useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const value = React.useMemo(() => ({ showSuccess, showError, showInfo }), [showSuccess, showError, showInfo]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        Global toast viewport — fixed at the **top-center** of the
        page, offset just below the AppLayout topbar so it never
        overlaps the user name / role label / Logout button on the
        right or the page title on the left. Positioning, vertical
        offset (via `--app-header-height`) and width clamping all live
        in `.erp-toast-viewport` (see style.css). Routes without an
        authenticated shell (e.g. /login) inherit `--app-header-height:
        0px` and the toast sits flush near the top edge — there is no
        header to clear there.
      */}
      {toast ? (
        <div
          className="erp-toast-viewport"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="erp-toast" role="status" data-kind={toast.kind}>
            {toast.kind === "success" ? (
              <span className="text-green-800">{toast.message}</span>
            ) : toast.kind === "info" ? (
              <span className="text-slate-700">{toast.message}</span>
            ) : (
              <span className="text-red-800">{toast.message}</span>
            )}
          </div>
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
