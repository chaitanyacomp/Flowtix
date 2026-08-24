/**
 * Step 4C — Historical Shift Report Adjustment (SHIFT_OVER + VERIFIED only).
 */
import * as React from "react";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { DecimalInput } from "../../ui/DecimalInput";
import { ErpModal } from "../ErpModal";
import {
  applyShiftReportAdjustment,
  approveShiftReportAdjustment,
  denyShiftReportAdjustment,
  fetchShiftReportAdjustments,
  requestShiftReportAdjustment,
  type ShiftAdjustmentRequest,
  type ShiftCapabilities,
  type ShiftReportLine,
  type ShiftSessionDetail,
} from "../../../lib/machineShiftSessionApi";
import {
  canShowManagerControls,
  formatIndiaDateTime,
  formatShiftQty,
  mapShiftApiError,
} from "../../../lib/machineShiftSessionUi";

type Props = {
  session: ShiftSessionDetail;
  caps: ShiftCapabilities | null;
  busy: boolean;
  onBusy: (v: boolean) => void;
  onNotice: (msg: string | null) => void;
  onRefresh: () => Promise<void>;
};

type EditLine = {
  runSegmentId: number;
  itemId: number;
  labelWo: string;
  labelItem: string;
  labelRun: string;
  oldQc: number;
  oldScrap: number;
  oldGross: number;
  oldRemarks: string;
  qc: string;
  scrap: string;
  remarks: string;
};

function parseQty(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (t === "" || t === ".") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

function statusLabel(s: string) {
  const u = String(s).toUpperCase();
  if (u === "REQUESTED") return "Requested";
  if (u === "APPROVED") return "Approved";
  if (u === "DENIED") return "Denied";
  if (u === "APPLIED") return "Applied";
  return u || "—";
}

function lineMeta(l: ShiftReportLine) {
  return {
    labelWo: l.workOrderNo || "—",
    labelItem: l.itemLabel || l.itemName || "—",
    labelRun: l.runSegmentLabel || (l.runSegmentNo != null ? `Run ${l.runSegmentNo}` : "—"),
  };
}

export function ShiftReportAdjustmentPanel({
  session,
  caps,
  busy,
  onBusy,
  onNotice,
  onRefresh,
}: Props) {
  const showManager = canShowManagerControls(caps);
  const isShiftOver = String(session.status).toUpperCase() === "SHIFT_OVER";
  const verifiedVersions = React.useMemo(() => {
    const versions = session.report?.versions ?? [];
    const verified = versions.filter((v) => String(v.status).toUpperCase() === "VERIFIED");
    if (verified.length) return verified;
    const latest = session.report?.latestVersion;
    return latest && String(latest.status).toUpperCase() === "VERIFIED" ? [latest] : [];
  }, [session.report?.versions, session.report?.latestVersion]);

  const targetVersion = React.useMemo(() => {
    if (!verifiedVersions.length) return null;
    return verifiedVersions.reduce((a, b) => (a.versionNo >= b.versionNo ? a : b));
  }, [verifiedVersions]);

  const [requests, setRequests] = React.useState<ShiftAdjustmentRequest[]>([]);
  const [loadingList, setLoadingList] = React.useState(false);
  const [lines, setLines] = React.useState<EditLine[]>([]);
  const [reason, setReason] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(true);

  const [denyOpen, setDenyOpen] = React.useState(false);
  const [approveOpen, setApproveOpen] = React.useState(false);
  const [applyOpen, setApplyOpen] = React.useState(false);
  const [decisionNote, setDecisionNote] = React.useState("");
  const [targetReq, setTargetReq] = React.useState<ShiftAdjustmentRequest | null>(null);

  const loadRequests = React.useCallback(async () => {
    if (!verifiedVersions.length) {
      setRequests([]);
      return;
    }
    setLoadingList(true);
    try {
      const lists = await Promise.all(
        verifiedVersions.map((v) => fetchShiftReportAdjustments(v.id).then((r) => r.requests ?? [])),
      );
      const merged = lists.flat();
      merged.sort((a, b) => Number(a.id) - Number(b.id));
      setRequests(merged);
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      setLoadingList(false);
    }
  }, [verifiedVersions, onNotice]);

  React.useEffect(() => {
    if (!isShiftOver || !targetVersion) return;
    void loadRequests();
  }, [isShiftOver, targetVersion?.id, loadRequests]);

  React.useEffect(() => {
    if (!targetVersion?.lines?.length) {
      setLines([]);
      return;
    }
    setLines(
      targetVersion.lines.map((l) => {
        const meta = lineMeta(l);
        return {
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          ...meta,
          oldQc: Number(l.qtySentToQc ?? 0),
          oldScrap: Number(l.productionScrapQty ?? 0),
          oldGross: Number(l.grossOutputQty ?? 0),
          oldRemarks: l.remarks ?? "",
          qc: String(l.qtySentToQc ?? 0),
          scrap: String(l.productionScrapQty ?? 0),
          remarks: l.remarks ?? "",
        };
      }),
    );
    setReason("");
    setRemarks("");
    setLocalError(null);
  }, [targetVersion?.id, targetVersion?.versionNo]);

  const openUnresolved = [...requests]
    .reverse()
    .find((r) => {
      const s = String(r.status).toUpperCase();
      return s === "REQUESTED" || s === "APPROVED";
    });

  const displayLines = React.useMemo(() => {
    return lines.map((row) => {
      const qc = parseQty(row.qc) ?? 0;
      const scrap = parseQty(row.scrap) ?? 0;
      return {
        ...row,
        qcNum: qc,
        scrapNum: scrap,
        gross: Math.round((qc + scrap) * 1000) / 1000,
      };
    });
  }, [lines]);

  const proposedTotals = React.useMemo(() => {
    return displayLines.reduce(
      (acc, l) => ({
        qc: Math.round((acc.qc + l.qcNum) * 1000) / 1000,
        scrap: Math.round((acc.scrap + l.scrapNum) * 1000) / 1000,
        gross: Math.round((acc.gross + l.gross) * 1000) / 1000,
      }),
      { qc: 0, scrap: 0, gross: 0 },
    );
  }, [displayLines]);

  if (!isShiftOver) return null;
  if (!targetVersion) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="shift-adjustment-panel">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Historical Adjustment
        </h2>
        <p className="mt-2 text-sm text-slate-600">No verified Shift Report is available to adjust.</p>
      </section>
    );
  }

  async function submitRequest() {
    if (busy || !targetVersion || openUnresolved) return;
    setLocalError(null);
    if (!reason.trim()) {
      setLocalError("An adjustment reason is required.");
      return;
    }
    for (const row of lines) {
      if (parseQty(row.qc) == null || parseQty(row.scrap) == null) {
        setLocalError("Quantities cannot be negative.");
        return;
      }
    }
    if (!lines.length) {
      setLocalError("Add at least one line to the proposal.");
      return;
    }
    onBusy(true);
    onNotice(null);
    try {
      await requestShiftReportAdjustment(targetVersion.id, {
        adjustReason: reason.trim(),
        remarks: remarks.trim() || null,
        lines: displayLines.map((l) => ({
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          qtySentToQc: l.qcNum,
          productionScrapQty: l.scrapNum,
          grossOutputQty: l.gross,
          remarks: l.remarks.trim() ? l.remarks.trim() : null,
        })),
      });
      setReason("");
      setRemarks("");
      onNotice("Adjustment requested. Report quantities are unchanged until Apply.");
      await loadRequests();
      await onRefresh();
    } catch (e) {
      const msg = mapShiftApiError(e);
      setLocalError(msg);
      onNotice(msg);
    } finally {
      onBusy(false);
    }
  }

  async function doApprove() {
    if (busy || !targetReq) return;
    onBusy(true);
    try {
      await approveShiftReportAdjustment(targetReq.id, {
        decisionNote: decisionNote.trim() || null,
      });
      setApproveOpen(false);
      setDecisionNote("");
      setTargetReq(null);
      onNotice("Adjustment approved. Apply the correction to create the new verified version.");
      await loadRequests();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  async function doDeny() {
    if (busy || !targetReq || !decisionNote.trim()) return;
    onBusy(true);
    try {
      await denyShiftReportAdjustment(targetReq.id, { decisionNote: decisionNote.trim() });
      setDenyOpen(false);
      setDecisionNote("");
      setTargetReq(null);
      onNotice("Adjustment denied.");
      await loadRequests();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  async function doApply() {
    if (busy || !targetReq) return;
    onBusy(true);
    try {
      await applyShiftReportAdjustment(targetReq.id);
      setApplyOpen(false);
      setTargetReq(null);
      onNotice("Correction applied. A new verified Shift Report version is now current.");
      await onRefresh();
      await loadRequests();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="shift-adjustment-panel">
      <div className="mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Historical Adjustment
        </h2>
        <p className="mt-1 text-[12px] text-slate-500">
          This correction updates shift reporting history only. It does not change stock, QC or work order records.
        </p>
      </div>

      {localError ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{localError}</div>
      ) : null}

      {openUnresolved ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
          <div className="font-semibold">
            Open adjustment — {statusLabel(openUnresolved.status)}
            {openUnresolved.requestedByName ? ` · ${openUnresolved.requestedByName}` : ""}
          </div>
          <p className="mt-0.5">{openUnresolved.adjustReason}</p>
          <div className="mt-2 overflow-x-auto rounded border border-amber-100 bg-white/70">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-amber-50/80 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-1">WO / Product</th>
                  <th className="px-2 py-1 text-right">Proposed QC</th>
                  <th className="px-2 py-1 text-right">Proposed Scrap</th>
                  <th className="px-2 py-1 text-right">Proposed Gross</th>
                </tr>
              </thead>
              <tbody>
                {openUnresolved.proposedLines.map((l) => (
                  <tr key={`${l.runSegmentId}-${l.itemId}`} className="border-t border-slate-100">
                    <td className="px-2 py-1">{l.itemName || "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatShiftQty(l.qtySentToQc)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatShiftQty(l.productionScrapQty)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{formatShiftQty(l.grossOutputQty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {String(openUnresolved.status).toUpperCase() === "REQUESTED" && showManager ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setTargetReq(openUnresolved);
                  setDecisionNote("");
                  setDenyOpen(true);
                }}
              >
                Deny
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setTargetReq(openUnresolved);
                  setDecisionNote("");
                  setApproveOpen(true);
                }}
              >
                Approve
              </Button>
            </div>
          ) : null}
          {String(openUnresolved.status).toUpperCase() === "REQUESTED" && !showManager ? (
            <p className="mt-2 text-[12px]">Waiting for manager decision. Approval does not change the report yet.</p>
          ) : null}
          {String(openUnresolved.status).toUpperCase() === "APPROVED" && showManager ? (
            <div className="mt-2">
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setTargetReq(openUnresolved);
                  setApplyOpen(true);
                }}
                data-testid="shift-adjustment-apply-btn"
              >
                Apply Correction
              </Button>
            </div>
          ) : null}
          {String(openUnresolved.status).toUpperCase() === "APPROVED" && !showManager ? (
            <p className="mt-2 text-[12px]">Approved — waiting for a manager to apply the correction.</p>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-700">
            Starting from verified report snapshot. Propose corrected quantities below.
          </p>
          {!displayLines.length ? (
            <p className="text-sm text-slate-500">This verified report has no lines to adjust.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[860px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2 font-medium">WO / Product / Run</th>
                    <th className="px-2 py-2 text-right font-medium">Current</th>
                    <th className="px-2 py-2 text-right font-medium">Proposed QC</th>
                    <th className="px-2 py-2 text-right font-medium">Proposed Scrap</th>
                    <th className="px-2 py-2 text-right font-medium">Proposed Gross</th>
                    <th className="px-2 py-2 font-medium">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLines.map((row) => (
                    <tr key={`${row.runSegmentId}:${row.itemId}`} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-2">
                        <div className="font-medium text-slate-800">{row.labelWo}</div>
                        <div className="text-slate-700">{row.labelItem}</div>
                        <div className="text-xs text-slate-500">{row.labelRun}</div>
                      </td>
                      <td className="px-2 py-2 text-right text-xs tabular-nums text-slate-600">
                        <div>QC {formatShiftQty(row.oldQc)}</div>
                        <div>Scrap {formatShiftQty(row.oldScrap)}</div>
                        <div>Gross {formatShiftQty(row.oldGross)}</div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        <DecimalInput
                          className="ml-auto h-9 w-24 text-right"
                          value={row.qc}
                          maxFractionDigits={3}
                          disabled={busy}
                          onValueChange={(next) => {
                            setLines((prev) =>
                              prev.map((p) =>
                                p.runSegmentId === row.runSegmentId && p.itemId === row.itemId
                                  ? { ...p, qc: next }
                                  : p,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <DecimalInput
                          className="ml-auto h-9 w-24 text-right"
                          value={row.scrap}
                          maxFractionDigits={3}
                          disabled={busy}
                          onValueChange={(next) => {
                            setLines((prev) =>
                              prev.map((p) =>
                                p.runSegmentId === row.runSegmentId && p.itemId === row.itemId
                                  ? { ...p, scrap: next }
                                  : p,
                              ),
                            );
                          }}
                        />
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums font-medium">{formatShiftQty(row.gross)}</td>
                      <td className="px-2 py-2">
                        <input
                          className="h-9 w-full min-w-[7rem] rounded-md border border-slate-200 px-2 text-sm"
                          value={row.remarks}
                          disabled={busy}
                          maxLength={2000}
                          onChange={(e) => {
                            const v = e.target.value;
                            setLines((prev) =>
                              prev.map((p) =>
                                p.runSegmentId === row.runSegmentId && p.itemId === row.itemId
                                  ? { ...p, remarks: v }
                                  : p,
                              ),
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
                  <tr>
                    <td className="px-2 py-2">Proposed totals</td>
                    <td />
                    <td className="px-2 py-2 text-right tabular-nums">{formatShiftQty(proposedTotals.qc)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatShiftQty(proposedTotals.scrap)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatShiftQty(proposedTotals.gross)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Adjustment reason (required)</span>
            <textarea
              className="min-h-[72px] rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={reason}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setReason(e.target.value)}
              data-testid="shift-adjustment-reason"
            />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium text-slate-700">Remarks (optional)</span>
            <textarea
              className="min-h-[56px] rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={remarks}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </label>
          <Button
            type="button"
            disabled={busy || !lines.length || !reason.trim()}
            onClick={() => void submitRequest()}
            data-testid="shift-adjustment-request-btn"
          >
            {busy ? "Submitting…" : "Request Adjustment"}
          </Button>
        </div>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <button
          type="button"
          className="text-xs font-medium text-slate-600 underline"
          onClick={() => setHistoryOpen((v) => !v)}
        >
          {historyOpen ? "Hide" : "Show"} Adjustment History
          {loadingList ? "…" : ` (${requests.length})`}
        </button>
        {historyOpen ? (
          <ul className="mt-2 space-y-2 text-xs text-slate-600">
            {!requests.length ? (
              <li className="text-slate-500">No adjustment requests yet.</li>
            ) : (
              [...requests].reverse().map((r) => (
                <li key={r.id} className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-slate-800">
                    <Badge variant={String(r.status).toUpperCase() === "DENIED" ? "warning" : "default"}>
                      {statusLabel(r.status)}
                    </Badge>
                    <span>{formatIndiaDateTime(r.requestedAt)}</span>
                    {r.requestedByName ? <span>· {r.requestedByName}</span> : null}
                  </div>
                  <div className="mt-0.5">{r.adjustReason}</div>
                  <div className="mt-0.5 tabular-nums">
                    Proposed QC {formatShiftQty(r.proposedQtySentToQc)} · Scrap{" "}
                    {formatShiftQty(r.proposedProductionScrapQty)} · Gross{" "}
                    {formatShiftQty(r.proposedGrossOutputQty)}
                  </div>
                  {r.decidedByName || r.decisionNote ? (
                    <div className="mt-0.5">
                      Decision{r.decidedByName ? ` · ${r.decidedByName}` : ""}
                      {r.decidedAt ? ` · ${formatIndiaDateTime(r.decidedAt)}` : ""}
                      {r.decisionNote ? ` — ${r.decisionNote}` : ""}
                    </div>
                  ) : null}
                  {r.appliedAt ? (
                    <div className="mt-0.5">
                      Applied{r.appliedByName ? ` · ${r.appliedByName}` : ""} ·{" "}
                      {formatIndiaDateTime(r.appliedAt)}
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <ErpModal
        open={approveOpen}
        onClose={() => !busy && setApproveOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="adj-approve-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="adj-approve-title" className="text-lg font-semibold">
            Approve adjustment?
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            Approval does not change the verified report yet. A manager must apply the correction afterward.
          </p>
          <label className="mt-3 grid gap-1 text-sm">
            <span className="font-medium">Note (optional)</span>
            <textarea
              className="min-h-[64px] rounded-md border border-slate-200 px-3 py-2"
              value={decisionNote}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setDecisionNote(e.target.value)}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setApproveOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void doApprove()}>
              {busy ? "Approving…" : "Approve"}
            </Button>
          </div>
        </div>
      </ErpModal>

      <ErpModal
        open={denyOpen}
        onClose={() => !busy && setDenyOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="adj-deny-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="adj-deny-title" className="text-lg font-semibold">
            Deny adjustment
          </h3>
          <label className="mt-3 grid gap-1 text-sm">
            <span className="font-medium">Decision note (required)</span>
            <textarea
              className="min-h-[80px] rounded-md border border-slate-200 px-3 py-2"
              value={decisionNote}
              disabled={busy}
              maxLength={2000}
              onChange={(e) => setDecisionNote(e.target.value)}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setDenyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !decisionNote.trim()} onClick={() => void doDeny()}>
              Deny
            </Button>
          </div>
        </div>
      </ErpModal>

      <ErpModal
        open={applyOpen}
        onClose={() => !busy && setApplyOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="adj-apply-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="adj-apply-title" className="text-lg font-semibold">
            Apply Correction?
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            Creates a new verified Shift Report version from the approved proposal. The original verified version
            stays in history. Session remains Shift Over. Stock, QC and work orders are not changed.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setApplyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void doApply()}>
              {busy ? "Applying…" : "Apply Correction"}
            </Button>
          </div>
        </div>
      </ErpModal>
    </section>
  );
}
