import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";

export type BillExportLifecycle = "DRAFT" | "FINALIZED" | "CANCELLED";

export type BillExportStatusPanelProps = {
  lifecycle: BillExportLifecycle;
  isExported: boolean;
  exportedAt?: string | null;
  /** Exporter display name when available (Sales Bill API). */
  exportedByName?: string | null;
  /** When export is blocked (e.g. temporary tax data). */
  exportBlockedReason?: string | null;
  /** Last failed export attempt message (optional). */
  exportAttemptError?: string | null;
  /** Shown when bill was reset after a prior export (both bill types expose this when set). */
  exportResetAt?: string | null;
  isAdmin: boolean;
  exporting: boolean;
  resetting: boolean;
  onExport: () => void;
  onResetExport: () => void;
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Shared Tally export summary + primary actions for Sales and Purchase bill pages.
 */
export function BillExportStatusPanel({
  lifecycle,
  isExported,
  exportedAt,
  exportedByName,
  exportBlockedReason,
  exportAttemptError,
  exportResetAt,
  isAdmin,
  exporting,
  resetting,
  onExport,
  onResetExport,
}: BillExportStatusPanelProps) {
  const canExport = lifecycle === "FINALIZED" && !isExported && !exportBlockedReason;
  const showReset = lifecycle === "FINALIZED" && isExported && isAdmin;

  let statusLabel = "Not Exported";
  let exportBadge: { text: string; variant: "default" | "success" | "warning" | "rejected" | "info" } | null = null;
  let help: string | null = null;

  if (lifecycle === "CANCELLED") {
    statusLabel = "Cancelled";
    help = "Cancelled bills cannot be exported.";
  } else if (lifecycle === "DRAFT") {
    statusLabel = "Not ready for export";
    help = "Finalize this bill before exporting.";
  } else if (lifecycle === "FINALIZED" && isExported) {
    statusLabel = "Exported to Tally";
    exportBadge = { text: "Exported to Tally", variant: "success" };
    help = null;
  } else if (lifecycle === "FINALIZED" && exportBlockedReason) {
    statusLabel = "Not Exported";
    exportBadge = { text: "Not Exported", variant: "warning" };
    help = exportBlockedReason;
  } else if (lifecycle === "FINALIZED") {
    statusLabel = "Not Exported";
    exportBadge = { text: "Not Exported", variant: "info" };
    help = "This bill is finalized but not yet exported to Tally.";
  }

  const billStatusPhrase = lifecycle === "FINALIZED" ? "Finalized" : lifecycle === "CANCELLED" ? "Cancelled" : "Draft";

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">Tally export</CardTitle>
        <p className="mt-0.5 text-xs text-slate-500">
          Bill status: <span className="font-medium text-slate-700">{billStatusPhrase}</span> · current export state (see History for past events).
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{statusLabel}</span>
              {exportBadge ? <Badge variant={exportBadge.variant} className="shrink-0">{exportBadge.text}</Badge> : null}
            </div>
            {help ? <p className="text-xs leading-relaxed text-slate-600">{help}</p> : null}
            {lifecycle === "FINALIZED" && isExported ? (
              <dl className="mt-2 grid gap-1 text-xs text-slate-600">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-slate-500">Exported on</dt>
                  <dd className="tabular-nums text-slate-800">{formatDateTime(exportedAt)}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-slate-500">Exported by</dt>
                  <dd className="text-slate-800">{exportedByName?.trim() ? exportedByName : "—"}</dd>
                </div>
              </dl>
            ) : null}
            {exportResetAt && !isExported ? (
              <p className="text-xs text-slate-500">Last export reset: {formatDateTime(exportResetAt)}</p>
            ) : null}
            {exportAttemptError ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-800">
                <span className="font-semibold">Export Failed</span>
                <span className="mt-0.5 block break-words">{exportAttemptError}</span>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-2 sm:min-w-[11rem] sm:items-end">
            {canExport ? (
              <Button type="button" data-testid="export-tally-btn" disabled={exporting} onClick={() => void onExport()}>
                {exporting ? "Exporting…" : "Export to Tally"}
              </Button>
            ) : null}
            {showReset ? (
              <Button type="button" data-testid="reset-export-btn" variant="outline" disabled={resetting} onClick={() => void onResetExport()}>
                {resetting ? "Resetting…" : "Reset Export"}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
