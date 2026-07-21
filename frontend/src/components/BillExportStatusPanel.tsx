import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { cn } from "../lib/utils";

export type BillExportLifecycle = "DRAFT" | "FINALIZED" | "CANCELLED";

export type TallyMasterReferenceRow = {
  type?: string;
  erpValue?: string | null;
  expectedTallyMaster?: string | null;
  mappingStatus?: string;
  exactError?: string | null;
  action?: string | null;
  xmlContext?: string | null;
};

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
  /** Structured Tally readiness from API (Sales Bill). */
  tallyExportReadiness?: {
    ready?: boolean;
    status?: string;
    label?: string;
    masterReferences?: TallyMasterReferenceRow[] | null;
    blockingMasterCount?: number;
  } | null;
  /** Deep-link to map transportation ledger when that mapping is missing. */
  mapTransportationHref?: string | null;
  onMapTransportation?: (() => void) | null;
  onMapExistingMaster?: (() => void) | null;
  onCreateMissingMaster?: (() => void) | null;
  onRefreshAndValidate?: (() => void) | null;
  onConfirmTallyImport?: (() => void) | null;
  confirmingTallyImport?: boolean;
  creatingMasters?: boolean;
  refreshingReadiness?: boolean;
  /** Shown when bill was reset after a prior export (both bill types expose this when set). */
  exportResetAt?: string | null;
  isAdmin: boolean;
  exporting: boolean;
  resetting: boolean;
  onExport: () => void;
  onResetExport: () => void;
  allowReExport?: boolean;
  className?: string;
  /** Sidebar / de-emphasized: tighter chrome; export uses outline styling. */
  density?: "default" | "compact";
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
  tallyExportReadiness,
  mapTransportationHref,
  onMapTransportation,
  onMapExistingMaster,
  onCreateMissingMaster,
  onRefreshAndValidate,
  onConfirmTallyImport,
  confirmingTallyImport = false,
  creatingMasters = false,
  refreshingReadiness = false,
  exportResetAt,
  isAdmin,
  exporting,
  resetting,
  onExport,
  onResetExport,
  allowReExport = false,
  className,
  density = "default",
}: BillExportStatusPanelProps) {
  const compact = density === "compact";
  const canExport = lifecycle === "FINALIZED" && (!isExported || allowReExport) && !exportBlockedReason;
  const showReset = lifecycle === "FINALIZED" && isExported && isAdmin;
  const readinessLabel =
    lifecycle === "FINALIZED" && !isExported && tallyExportReadiness?.label
      ? tallyExportReadiness.label
      : null;
  const showMapTransportation =
    Boolean(mapTransportationHref || onMapTransportation) &&
    (tallyExportReadiness?.status === "MISSING_TRANSPORTATION_LEDGER_MAPPING" ||
      (exportAttemptError != null && /Transportation Charges is not mapped/i.test(exportAttemptError)));
  const masterRefs = Array.isArray(tallyExportReadiness?.masterReferences)
    ? tallyExportReadiness.masterReferences
    : [];
  const showMasterTable = lifecycle === "FINALIZED" && !isExported && masterRefs.length > 0 && !compact;

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
    statusLabel = "Confirmed in Tally";
    exportBadge = { text: "Exported", variant: "success" };
    help = "Tally import was confirmed for this bill. Re-download requires admin authorization.";
  } else if (lifecycle === "FINALIZED" && exportBlockedReason) {
    statusLabel = "Not Exported";
    exportBadge = { text: "Not Exported", variant: "warning" };
    help = exportBlockedReason;
  } else if (lifecycle === "FINALIZED") {
    statusLabel = "Tally XML pending confirmation";
    exportBadge = { text: "Not exported", variant: "warning" };
    help =
      "Download voucher XML, import it in Tally, then confirm only after Tally accepts the voucher. Download alone does not mark this bill exported.";
  }

  const billStatusPhrase = lifecycle === "FINALIZED" ? "Finalized" : lifecycle === "CANCELLED" ? "Cancelled" : "Draft";

  return (
    <Card className={cn("border-slate-200", compact ? "shadow-none ring-1 ring-slate-100" : "", className)}>
      <CardHeader className={cn(compact ? "space-y-0 pb-1 pt-2" : "space-y-0 pb-1.5 pt-3")}>
        <CardTitle className={cn(compact ? "text-[11px] font-semibold uppercase tracking-wide text-slate-500" : "text-sm font-semibold text-slate-900")}>
          Tally export
        </CardTitle>
        {!compact ? (
          <p className="text-[11px] text-slate-500">
            Bill: <span className="font-medium text-slate-700">{billStatusPhrase}</span>
          </p>
        ) : (
          <p className="text-[11px] text-slate-600">
            <span className="font-medium text-slate-700">{billStatusPhrase}</span>
            {lifecycle === "FINALIZED" ? (
              <>
                {" "}
                ·{" "}
                <span className="tabular-nums">{isExported ? "Confirmed in Tally" : "Not exported"}</span>
              </>
            ) : null}
          </p>
        )}
      </CardHeader>
      <CardContent className={cn("pt-0", compact ? "pb-2" : "")}>
        <div className={cn("flex flex-col sm:flex-row sm:items-start sm:justify-between", compact ? "gap-2" : "gap-3")}>
          <div className={cn("min-w-0 text-sm", compact ? "space-y-0.5" : "space-y-1")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={compact ? "text-xs font-medium text-slate-800" : "font-medium text-slate-900"}>{statusLabel}</span>
              {exportBadge ? (
                <Badge variant={exportBadge.variant} className={cn("shrink-0", compact ? "text-[10px] leading-none" : "")}>
                  {exportBadge.text}
                </Badge>
              ) : null}
              {readinessLabel ? (
                <Badge
                  variant={tallyExportReadiness?.ready ? "success" : "warning"}
                  className={cn("shrink-0", compact ? "text-[10px] leading-none" : "")}
                  data-testid="tally-export-readiness-badge"
                >
                  {readinessLabel}
                </Badge>
              ) : null}
            </div>
            {help && !compact ? <p className="text-xs leading-relaxed text-slate-600">{help}</p> : null}
            {help && compact ? <p className="text-[10px] leading-snug text-slate-600">{help}</p> : null}
            {lifecycle === "FINALIZED" && isExported ? (
              <dl className={cn("grid gap-1 text-xs text-slate-600", compact ? "mt-1" : "mt-2")}>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-slate-500">Confirmed on</dt>
                  <dd className="tabular-nums text-slate-800">{formatDateTime(exportedAt)}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="font-medium text-slate-500">Confirmed by</dt>
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
                <span className="mt-0.5 block whitespace-pre-wrap break-words">{exportAttemptError}</span>
              </div>
            ) : null}
            {lifecycle === "FINALIZED" && !isExported && tallyExportReadiness && !tallyExportReadiness.ready && !exportAttemptError ? (
              <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                <span className="font-semibold">Tally export warning</span>
                <span className="mt-0.5 block">
                  Finalization is allowed, but Tally XML will stay blocked until mapping is completed ({readinessLabel}).
                </span>
              </div>
            ) : null}
          </div>
          <div className={cn("flex shrink-0 flex-col items-stretch gap-2", compact ? "sm:items-stretch" : "sm:min-w-[11rem] sm:items-end")}>
            {showMapTransportation ? (
              mapTransportationHref ? (
                <a
                  href={mapTransportationHref}
                  data-testid="map-transportation-ledger-btn"
                  className={cn(
                    "inline-flex h-9 items-center justify-center rounded-md border border-amber-400 bg-white px-3 text-sm font-medium text-amber-950 hover:bg-amber-50",
                    compact && "h-8 text-xs",
                  )}
                >
                  Map Transportation Ledger
                </a>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size={compact ? "sm" : "default"}
                  data-testid="map-transportation-ledger-btn"
                  onClick={() => onMapTransportation?.()}
                >
                  Map Transportation Ledger
                </Button>
              )
            ) : null}
            {canExport ? (
              <Button
                type="button"
                data-testid="export-tally-btn"
                size={compact ? "sm" : "default"}
                variant={compact ? "outline" : "default"}
                disabled={exporting || tallyExportReadiness?.ready === false}
                onClick={() => void onExport()}
              >
                {exporting ? "Downloading…" : isExported ? "Re-download Tally XML" : "Download Tally XML"}
              </Button>
            ) : null}
            {lifecycle === "FINALIZED" && !isExported && onConfirmTallyImport ? (
              <Button
                type="button"
                data-testid="confirm-tally-import-btn"
                size={compact ? "sm" : "default"}
                variant="outline"
                disabled={confirmingTallyImport || exporting}
                onClick={() => void onConfirmTallyImport()}
              >
                {confirmingTallyImport ? "Confirming…" : "Confirm imported in Tally"}
              </Button>
            ) : null}
            {showReset ? (
              <Button
                type="button"
                data-testid="reset-export-btn"
                variant="outline"
                size={compact ? "sm" : "default"}
                disabled={resetting}
                onClick={() => void onResetExport()}
              >
                {resetting ? "Resetting…" : "Reset Export"}
              </Button>
            ) : null}
          </div>
        </div>

        {showMasterTable ? (
          <div className="mt-3 space-y-2" data-testid="tally-master-references">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-800">Required Tally masters</p>
              <div className="flex flex-wrap gap-1.5">
                {onMapExistingMaster ? (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => void onMapExistingMaster()}>
                    Map Existing Master
                  </Button>
                ) : null}
                {onCreateMissingMaster ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={creatingMasters}
                    data-testid="create-missing-master-btn"
                    onClick={() => void onCreateMissingMaster()}
                  >
                    {creatingMasters ? "Building…" : "Create Missing Master in Tally"}
                  </Button>
                ) : null}
                {onRefreshAndValidate ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={refreshingReadiness}
                    data-testid="refresh-validate-tally-btn"
                    onClick={() => void onRefreshAndValidate()}
                  >
                    {refreshingReadiness ? "Refreshing…" : "Refresh and Validate"}
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="min-w-full text-left text-[11px] text-slate-700">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5 font-medium">ERP value</th>
                    <th className="px-2 py-1.5 font-medium">Expected Tally master</th>
                    <th className="px-2 py-1.5 font-medium">Type</th>
                    <th className="px-2 py-1.5 font-medium">Mapping status</th>
                    <th className="px-2 py-1.5 font-medium">Exact error</th>
                  </tr>
                </thead>
                <tbody>
                  {masterRefs.map((row, idx) => (
                    <tr key={`${row.type}-${idx}`} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5">{row.erpValue || "—"}</td>
                      <td className="px-2 py-1.5 font-medium text-slate-900">{row.expectedTallyMaster || "—"}</td>
                      <td className="px-2 py-1.5">{row.type || "—"}</td>
                      <td className="px-2 py-1.5">
                        <Badge
                          variant={
                            row.mappingStatus === "MISSING" || row.mappingStatus === "AMBIGUOUS"
                              ? "warning"
                              : row.mappingStatus === "MAPPED"
                                ? "success"
                                : "info"
                          }
                          className="text-[10px] leading-none"
                        >
                          {row.mappingStatus || "—"}
                        </Badge>
                      </td>
                      <td className="max-w-[18rem] whitespace-pre-wrap px-2 py-1.5 text-slate-600">{row.exactError || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
