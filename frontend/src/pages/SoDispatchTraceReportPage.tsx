/**
 * Legacy route: SO to Dispatch Trace was merged into Customer Tracking
 * (Production Journey section). Keep URL for bookmarks; redirect only.
 * API `/api/reports/so-dispatch-trace` remains for the master report composition.
 */
import { Navigate, useSearchParams } from "react-router-dom";

export function SoDispatchTraceReportPage() {
  const [searchParams] = useSearchParams();
  const next = new URLSearchParams();
  next.set("from", "reports");
  const soSearch = searchParams.get("soSearch")?.trim();
  if (soSearch) next.set("soSearch", soSearch);
  return <Navigate to={`/customer-tracking-flow?${next.toString()}#production-journey`} replace />;
}
