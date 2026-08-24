/**
 * Step 4B — Shift Report panel (draft / submit / return / verify).
 * Not the WO Production Report.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { DecimalInput } from "../../ui/DecimalInput";
import { NativeSelect } from "../../ui/native-select";
import { ErpModal } from "../ErpModal";
import {
  returnShiftReport,
  saveShiftReportDraft,
  submitShiftReport,
  verifyShiftReport,
  type ShiftCapabilities,
  type ShiftReportLine,
  type ShiftSessionDetail,
} from "../../../lib/machineShiftSessionApi";
import {
  canShowManagerControls,
  downtimeReasonLabel,
  formatIndiaDateTime,
  formatShiftQty,
  mapShiftApiError,
  mergeShiftReportEditableLines,
  operatorDisplayName,
  reportVersionStatusLabel,
} from "../../../lib/machineShiftSessionUi";

type DraftLineState = {
  runSegmentId: number;
  itemId: number;
  scrap: string;
  remarks: string;
  meta: ShiftReportLine;
};

type Props = {
  session: ShiftSessionDetail;
  caps: ShiftCapabilities | null;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onNotice: (msg: string | null) => void;
  onRefresh: () => Promise<void>;
  expanded?: boolean;
};

function lineKey(runSegmentId: number, itemId: number) {
  return `${runSegmentId}:${itemId}`;
}

function parseScrap(raw: string): number | null {
  const t = String(raw ?? "").trim();
  if (t === "" || t === ".") return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

export function ShiftReportPanel({ session, caps, busy, onBusy, onNotice, onRefresh, expanded = true }: Props) {
  const showManager = canShowManagerControls(caps);
  const merged = React.useMemo(() => mergeShiftReportEditableLines(session), [session]);
  const latest = session.report?.latestVersion ?? null;
  const latestStatus = String(latest?.status ?? "").toUpperCase();
  const pendingCount = Number(session.pendingDraftCount ?? session.report?.pendingDraftCount ?? 0);
  const pendingQty = Number(session.pendingDraftQty ?? session.report?.pendingDraftQty ?? 0);
  const editable =
    String(session.status).toUpperCase() === "OPEN" &&
    (latestStatus === "" || latestStatus === "DRAFT" || latestStatus === "RETURNED");

  const [lines, setLines] = React.useState<DraftLineState[]>([]);
  const [draftSavedAt, setDraftSavedAt] = React.useState<string | null>(null);
  const [declaredOperatorId, setDeclaredOperatorId] = React.useState("");
  const [confirmChecked, setConfirmChecked] = React.useState(false);
  const [submitOpen, setSubmitOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [returnReason, setReturnReason] = React.useState("");
  const [verifyOpen, setVerifyOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setLines(
      merged.lines.map((l) => ({
        runSegmentId: l.runSegmentId,
        itemId: l.itemId,
        scrap: l.productionScrapQty != null ? String(l.productionScrapQty) : "0",
        remarks: l.remarks ?? "",
        meta: l,
      })),
    );
    setConfirmChecked(false);
    setDeclaredOperatorId("");
    setLocalError(null);
  }, [merged.lines, latest?.id, latestStatus]);

  const displayLines = React.useMemo(() => {
    return lines.map((row) => {
      const scrap = parseScrap(row.scrap) ?? 0;
      const qtySentToQc = Number(row.meta.qtySentToQc ?? 0);
      return {
        ...row,
        qtySentToQc,
        scrapNum: scrap,
        gross: Math.round((qtySentToQc + scrap) * 1000) / 1000,
      };
    });
  }, [lines]);

  const totals = React.useMemo(() => {
    return displayLines.reduce(
      (acc, l) => ({
        qtySentToQc: Math.round((acc.qtySentToQc + l.qtySentToQc) * 1000) / 1000,
        scrap: Math.round((acc.scrap + l.scrapNum) * 1000) / 1000,
        gross: Math.round((acc.gross + l.gross) * 1000) / 1000,
      }),
      { qtySentToQc: 0, scrap: 0, gross: 0 },
    );
  }, [displayLines]);

  const participants = (session.operators ?? []).filter((o) => !o.leftAt && o.operator?.id);

  const readOnlySnapshot = latestStatus === "SUBMITTED" || latestStatus === "VERIFIED";
  const showReturnReason = latestStatus === "RETURNED" && latest?.returnReason;

  async function saveDraft() {
    if (busy || !editable) return;
    setLocalError(null);
    for (const row of lines) {
      if (parseScrap(row.scrap) == null) {
        setLocalError("Production scrap cannot be negative.");
        return;
      }
    }
    if (!lines.length) {
      setLocalError("No approved production is linked to this shift yet. Record and approve production first.");
      return;
    }
    onBusy(true);
    onNotice(null);
    try {
      const res = await saveShiftReportDraft(session.id, {
        lines: lines.map((l) => ({
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          productionScrapQty: parseScrap(l.scrap) ?? 0,
          remarks: l.remarks.trim() ? l.remarks.trim() : null,
        })),
      });
      setDraftSavedAt(new Date().toISOString());
      onNotice("Draft saved");
      // Apply server quantities as authority
      setLines(
        (res.version.lines || []).map((l) => ({
          runSegmentId: l.runSegmentId,
          itemId: l.itemId,
          scrap: String(l.productionScrapQty ?? 0),
          remarks: l.remarks ?? "",
          meta: l,
        })),
      );
      await onRefresh();
    } catch (e) {
      const msg = mapShiftApiError(e);
      setLocalError(msg);
      onNotice(msg);
    } finally {
      onBusy(false);
    }
  }

  async function doSubmit() {
    if (busy || !confirmChecked || !declaredOperatorId) return;
    onBusy(true);
    onNotice(null);
    try {
      let versionId = session.report?.latestVersion?.id ?? null;
      if (editable && lines.length) {
        const draftRes = await saveShiftReportDraft(session.id, {
          lines: lines.map((l) => ({
            runSegmentId: l.runSegmentId,
            itemId: l.itemId,
            productionScrapQty: parseScrap(l.scrap) ?? 0,
            remarks: l.remarks.trim() ? l.remarks.trim() : null,
          })),
        });
        versionId = draftRes.version.id;
      }
      await submitShiftReport(session.id, {
        declaredOperatorId: Number(declaredOperatorId),
        versionId,
      });
      setSubmitOpen(false);
      setConfirmChecked(false);
      onNotice("Shift Report submitted — production quantities are locked pending manager review.");
      await onRefresh();
    } catch (e) {
      const msg = mapShiftApiError(e);
      setLocalError(msg);
      onNotice(msg);
    } finally {
      onBusy(false);
    }
  }

  async function doReturn() {
    if (busy || !latest?.id || !returnReason.trim()) return;
    onBusy(true);
    try {
      await returnShiftReport(latest.id, { returnReason: returnReason.trim() });
      setReturnOpen(false);
      setReturnReason("");
      onNotice("Shift Report returned for correction.");
      await onRefresh();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  async function doVerify() {
    if (busy || !latest?.id) return;
    onBusy(true);
    try {
      await verifyShiftReport(latest.id);
      setVerifyOpen(false);
      onNotice("Shift Report verified.");
      await onRefresh();
    } catch (e) {
      onNotice(mapShiftApiError(e));
    } finally {
      onBusy(false);
    }
  }

  if (!expanded) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="shift-report-panel">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Shift Report</h2>
          <p className="mt-1 text-[12px] text-slate-500">
            Shift Report records shift output. Work order material closure remains in Production Workspace.
          </p>
        </div>
        {latestStatus ? (
          <Badge variant={latestStatus === "RETURNED" ? "warning" : latestStatus === "VERIFIED" ? "success" : "default"}>
            {reportVersionStatusLabel(latestStatus)}
          </Badge>
        ) : null}
      </div>

      {showReturnReason ? (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
          <div className="font-semibold">Returned for correction</div>
          <p className="mt-0.5">{latest?.returnReason}</p>
        </div>
      ) : null}

      {session.productionQtyLocked ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="status">
          {session.productionQtyLockReason ||
            "Shift Report submitted — production quantities are locked pending manager review."}
        </div>
      ) : null}

      {pendingCount > 0 ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-950" role="alert">
          <div className="font-semibold">
            Pending production entries: {pendingCount} · Qty {formatShiftQty(pendingQty)}
          </div>
          <p className="mt-0.5">
            Approve or remove the pending production entries before submitting the Shift Report.
          </p>
          <Link to="/production" className="mt-1 inline-block text-sm font-medium text-teal-800 underline">
            Open Production Workspace
          </Link>
        </div>
      ) : null}

      {localError ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">{localError}</div>
      ) : null}

      {!displayLines.length ? (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-600">
          No approved production is linked to this shift yet. Produce and approve entries in Production Workspace, then
          refresh.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-slate-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-2 py-2 font-medium">WO</th>
                <th className="px-2 py-2 font-medium">Product</th>
                <th className="px-2 py-2 font-medium">Run</th>
                <th className="px-2 py-2 text-right font-medium">Qty Sent to QC</th>
                <th className="px-2 py-2 text-right font-medium">Production Scrap</th>
                <th className="px-2 py-2 text-right font-medium">Gross Output</th>
                <th className="px-2 py-2 font-medium">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {displayLines.map((row) => (
                <tr key={lineKey(row.runSegmentId, row.itemId)} className="border-t border-slate-100">
                  <td className="px-2 py-2 font-medium text-slate-800">{row.meta.workOrderNo || "—"}</td>
                  <td className="px-2 py-2 text-slate-800">{row.meta.itemLabel || row.meta.itemName || "—"}</td>
                  <td className="px-2 py-2 text-slate-600">
                    {row.meta.runSegmentLabel || (row.meta.runSegmentNo != null ? `Run ${row.meta.runSegmentNo}` : "—")}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-slate-800">
                    {formatShiftQty(row.qtySentToQc)}
                  </td>
                  <td className="px-2 py-2 text-right">
                    {editable && !readOnlySnapshot ? (
                      <DecimalInput
                        className="ml-auto h-9 w-28 text-right"
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
                        data-testid={`shift-scrap-${row.runSegmentId}-${row.itemId}`}
                      />
                    ) : (
                      <span className="tabular-nums">{formatShiftQty(row.scrapNum)}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums font-medium text-slate-900">
                    {formatShiftQty(row.gross)}
                  </td>
                  <td className="px-2 py-2">
                    {editable && !readOnlySnapshot ? (
                      <input
                        className="h-9 w-full min-w-[8rem] rounded-md border border-slate-200 px-2 text-sm"
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
                    ) : (
                      <span className="text-slate-600">{row.remarks || "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
              <tr>
                <td className="px-2 py-2" colSpan={3}>
                  Totals
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{formatShiftQty(totals.qtySentToQc)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatShiftQty(totals.scrap)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{formatShiftQty(totals.gross)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {draftSavedAt && editable ? (
        <p className="mt-2 text-[11px] text-slate-500" role="status">
          Draft saved {formatIndiaDateTime(draftSavedAt)}
        </p>
      ) : null}

      {editable && !readOnlySnapshot ? (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={busy || !lines.length} onClick={() => void saveDraft()}>
              Save Draft
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-sm">
              <span className="font-medium text-slate-700">Declaring operator</span>
              <NativeSelect
                value={declaredOperatorId}
                disabled={busy}
                onChange={(e) => setDeclaredOperatorId(e.target.value)}
                data-testid="shift-report-declared-operator"
              >
                <option value="">Select participant…</option>
                {participants.map((p) => (
                  <option key={p.id} value={p.operator!.id}>
                    {operatorDisplayName(p.operator)}
                    {p.isPrimary ? " (Primary)" : ""}
                  </option>
                ))}
              </NativeSelect>
            </label>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input
              type="checkbox"
              className="mt-1"
              checked={confirmChecked}
              disabled={busy}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              data-testid="shift-report-confirm-checkbox"
            />
            <span>I confirm that the production and scrap quantities entered above are correct.</span>
          </label>

          <Button
            type="button"
            disabled={
              busy ||
              !lines.length ||
              pendingCount > 0 ||
              !declaredOperatorId ||
              !confirmChecked
            }
            onClick={() => setSubmitOpen(true)}
            data-testid="shift-report-submit-btn"
          >
            Submit Shift Report
          </Button>
        </div>
      ) : null}

      {latestStatus === "SUBMITTED" || latestStatus === "VERIFIED" ? (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          {latest?.declaredOperator ? (
            <p className="text-sm text-slate-700">
              Declared by <span className="font-medium">{operatorDisplayName(latest.declaredOperator)}</span>
              {latest.declaredAt ? ` · ${formatIndiaDateTime(latest.declaredAt)}` : ""}
            </p>
          ) : null}
          <div className="text-sm text-slate-700">
            <div className="font-medium text-slate-800">Participating operators</div>
            <ul className="mt-1 list-inside list-disc text-slate-600">
              {(session.operators ?? []).map((p) => (
                <li key={p.id}>
                  {operatorDisplayName(p.operator)}
                  {p.isPrimary ? " (Primary)" : ""}
                  {p.leftAt ? " — left" : ""}
                </li>
              ))}
            </ul>
          </div>
          {(session.downtimeIncidents?.length ?? 0) > 0 ? (
            <div className="text-sm text-slate-700">
              <div className="font-medium text-slate-800">Downtime summary</div>
              <ul className="mt-1 space-y-0.5 text-slate-600">
                {session.downtimeIncidents.map((inc) => (
                  <li key={inc.id}>
                    {downtimeReasonLabel(inc.reason)} — {formatIndiaDateTime(inc.startedAt)}
                    {inc.endedAt ? ` → ${formatIndiaDateTime(inc.endedAt)}` : " (open)"}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-slate-600">No downtime recorded on this shift.</p>
          )}
          {latestStatus === "SUBMITTED" ? (
            showManager ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={busy} onClick={() => setReturnOpen(true)}>
                  Return for Correction
                </Button>
                <Button type="button" disabled={busy} onClick={() => setVerifyOpen(true)}>
                  Verify Report
                </Button>
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-700">Submitted for manager verification.</p>
            )
          ) : null}
        </div>
      ) : null}

      {(session.report?.versions?.length ?? 0) > 0 ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            className="text-xs font-medium text-slate-600 underline"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            {historyOpen ? "Hide" : "Show"} Shift Report History ({session.report?.versions?.length ?? 0})
          </button>
          {historyOpen ? (
            <ul className="mt-2 space-y-2 text-xs text-slate-600">
              {[...(session.report?.versions ?? [])].slice().reverse().map((v) => (
                <li key={v.id} className="rounded-md border border-slate-100 bg-slate-50 px-2 py-1.5">
                  <div className="flex flex-wrap gap-x-2 font-medium text-slate-800">
                    <span>{reportVersionStatusLabel(v.status)}</span>
                    <span>·</span>
                    <span>
                      {formatIndiaDateTime(v.verifiedAt || v.returnedAt || v.submittedAt || v.declaredAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 tabular-nums">
                    QC {formatShiftQty(v.qtySentToQc)} · Scrap {formatShiftQty(v.productionScrapQty)} · Gross{" "}
                    {formatShiftQty(v.grossOutputQty)}
                  </div>
                  {v.declaredOperator ? (
                    <div>Declared: {operatorDisplayName(v.declaredOperator)}</div>
                  ) : null}
                  {v.returnReason ? <div>Return: {v.returnReason}</div> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <ErpModal
        open={submitOpen}
        onClose={() => !busy && setSubmitOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="shift-report-submit-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="shift-report-submit-title" className="text-lg font-semibold text-slate-900">
            Submit Shift Report?
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            Submit this Shift Report for manager review? Production quantities for this shift will lock until the
            report is returned or the shift is reopened.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Totals — Qty Sent to QC {formatShiftQty(totals.qtySentToQc)}, Scrap {formatShiftQty(totals.scrap)}, Gross{" "}
            {formatShiftQty(totals.gross)}.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setSubmitOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void doSubmit()}>
              {busy ? "Submitting…" : "Confirm submit"}
            </Button>
          </div>
        </div>
      </ErpModal>

      <ErpModal
        open={returnOpen}
        onClose={() => !busy && setReturnOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="shift-report-return-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="shift-report-return-title" className="text-lg font-semibold text-slate-900">
            Return for Correction
          </h3>
          <label className="mt-3 grid gap-1 text-sm">
            <span className="font-medium">Return reason</span>
            <textarea
              className="min-h-[88px] rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              maxLength={2000}
              disabled={busy}
            />
          </label>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setReturnOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy || !returnReason.trim()} onClick={() => void doReturn()}>
              Return Report
            </Button>
          </div>
        </div>
      </ErpModal>

      <ErpModal
        open={verifyOpen}
        onClose={() => !busy && setVerifyOpen(false)}
        escapeDisabled={() => busy}
        aria-labelledby="shift-report-verify-title"
        className="items-start justify-center pt-8"
      >
        <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
          <h3 id="shift-report-verify-title" className="text-lg font-semibold text-slate-900">
            Verify Shift Report?
          </h3>
          <p className="mt-2 text-sm text-slate-700">
            Confirm this Shift Report is accurate. You can complete Shift Over after verification.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => setVerifyOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void doVerify()}>
              {busy ? "Verifying…" : "Verify Report"}
            </Button>
          </div>
        </div>
      </ErpModal>
    </section>
  );
}
