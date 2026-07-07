import * as React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { useToast } from "../contexts/ToastContext";
import { apiFetch } from "../services/api";
import { bumpErpRefresh } from "../lib/erpRefresh";

type PmrLine = {
  id: number;
  itemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  issuedQty: number;
  pendingQty: number;
};

type Pmr = {
  id: number;
  docNo: string | null;
  status: string;
  workOrderId: number;
  workOrderNo: string | null;
  salesOrderId?: number | null;
  salesOrderNo?: string | null;
  totalRequired: number;
  totalIssued: number;
  totalPending: number;
  lines: PmrLine[];
};

type ReleaseHandoffQueueRow = {
  workOrderId: number;
  workOrderNo: string | null;
  workOrderLineId: number | null;
  pmrId: number;
  pmrDocNo: string | null;
  pmrStatus: string;
  rmStatusLabel: string;
  sourceType: string | null;
  orderType: string | null;
  sourceLabel: string;
  itemName: string | null;
  plannedQty: number;
  salesOrderId: number | null;
  salesOrderDocNo: string | null;
  cycleId: number | null;
  requirementSheetId: number | null;
};

function fmtQty(qty: number, unit?: string | null): string {
  const n = Number(qty);
  const text = Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "0";
  return unit?.trim() ? `${text} ${unit.trim()}` : text;
}

function isIssuedPmr(status?: string | null): boolean {
  const token = String(status ?? "").trim().toUpperCase();
  return token === "FULLY_ISSUED" || token === "SHORT_ISSUE_ACCEPTED";
}

const RELEASE_QUEUE_EMPTY_MESSAGE = "No work orders awaiting release.";

function ProductionReleaseHandoffList({
  onOpenDetail,
}: {
  onOpenDetail: (workOrderId: number) => void;
}) {
  const { showSuccess, showError } = useToast();
  const [rows, setRows] = React.useState<ReleaseHandoffQueueRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [releasingWoId, setReleasingWoId] = React.useState<number | null>(null);

  const loadQueue = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiFetch<{ count: number; rows: ReleaseHandoffQueueRow[] }>(
        "/api/production-material-requests/release-handoff-queue",
      );
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e) {
      if (!opts?.silent) {
        setError(e instanceof Error ? e.message : "Could not load release queue.");
        setRows([]);
      }
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function releaseRow(row: ReleaseHandoffQueueRow) {
    setReleasingWoId(row.workOrderId);
    try {
      await apiFetch(`/api/production-material-requests/${row.pmrId}/release-to-production`, {
        method: "POST",
        body: JSON.stringify({
          remarks: `Release ${row.workOrderNo || `WO-${row.workOrderId}`} to production`,
        }),
      });
      showSuccess(`${row.workOrderNo || `WO-${row.workOrderId}`} released to production.`);
      bumpErpRefresh(["pending-actions", "dashboard", "production"]);
      setRows((prev) => prev.filter((r) => r.workOrderId !== row.workOrderId));
      void loadQueue({ silent: true });
    } catch (e) {
      showError(e instanceof Error ? e.message : "Release failed.");
    } finally {
      setReleasingWoId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Release to Production</h1>
          <p className="mt-1 text-sm text-slate-600">
            Work orders with RM issued in Store — release each WO when Production may start.
          </p>
        </div>
        <Link to="/pending-actions" className="text-sm font-medium text-slate-600 underline underline-offset-4">
          Pending Actions
        </Link>
      </div>

      {loading ? (
        <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">Loading release queue…</div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div
          className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600"
          data-testid="production-release-empty"
        >
          {RELEASE_QUEUE_EMPTY_MESSAGE}
        </div>
      ) : null}

      {!loading && rows.length > 0 ? (
        <section className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-3 py-2">WO</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Planned</th>
                  <th className="px-3 py-2">RM Status</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.workOrderId} className="align-middle">
                    <td className="px-3 py-2 font-mono text-[13px] font-semibold text-slate-900">
                      {row.workOrderNo || `WO-${row.workOrderId}`}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{row.sourceLabel}</td>
                    <td className="px-3 py-2 text-slate-800">{row.itemName || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                      {fmtQty(row.plannedQty)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{row.rmStatusLabel}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => onOpenDetail(row.workOrderId)}
                        >
                          Review
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={releasingWoId === row.workOrderId}
                          onClick={() => void releaseRow(row)}
                        >
                          {releasingWoId === row.workOrderId ? "Releasing…" : "Release"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ProductionReleaseHandoffDetail({
  workOrderId,
  pmrId,
  onBackToList,
}: {
  workOrderId: number;
  pmrId: number;
  onBackToList: () => void;
}) {
  const { showSuccess, showError } = useToast();
  const [pmr, setPmr] = React.useState<Pmr | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        let data: Pmr;
        if (Number.isFinite(workOrderId) && workOrderId > 0) {
          data = await apiFetch<Pmr>(
            `/api/production-material-requests/for-work-order/${workOrderId}/release-handoff`,
          );
        } else if (Number.isFinite(pmrId) && pmrId > 0) {
          data = await apiFetch<Pmr>(`/api/production-material-requests/${pmrId}`);
          if (!isIssuedPmr(data.status)) throw new Error("Release requires an issued PMR.");
        } else {
          throw new Error("PMR or Work Order context is required.");
        }
        if (alive) setPmr(data);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load release handoff.");
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [pmrId, workOrderId]);

  async function releaseToProduction() {
    if (!pmr?.id) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/production-material-requests/${pmr.id}/release-to-production`, {
        method: "POST",
        body: JSON.stringify({ remarks: `Release ${pmr.workOrderNo || `WO-${pmr.workOrderId}`} to production` }),
      });
      showSuccess("Work order released to production.");
      bumpErpRefresh(["pending-actions", "dashboard", "production"]);
      onBackToList();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Release failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const pmrStatus = String(pmr?.status ?? "").trim().toUpperCase();
  const releaseBlocked =
    !pmr ||
    !isIssuedPmr(pmr.status) ||
    Number(pmr.totalIssued ?? 0) <= 0 ||
    (pmrStatus === "FULLY_ISSUED" && Number(pmr.totalPending ?? 0) > 1e-6);
  const alreadyReleased = String(pmr?.status ?? "").toUpperCase() === "RELEASED";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Release to Production</h1>
          <p className="mt-1 text-sm text-slate-600">
            {pmr?.workOrderNo || (workOrderId > 0 ? `WO-${workOrderId}` : "Work Order")} - {pmr?.docNo || "PMR"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" className="font-medium text-slate-600 underline underline-offset-4" onClick={onBackToList}>
            Back to list
          </button>
          <Link to="/pending-actions" className="font-medium text-slate-600 underline underline-offset-4">
            Pending Actions
          </Link>
        </div>
      </div>

      {loading ? <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">Loading release handoff...</div> : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</div>
      ) : null}

      {pmr ? (
        <>
          <section className="rounded-md border border-slate-200 bg-white p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-xs font-medium uppercase text-slate-500">PMR Status</div>
                <div className="mt-1 text-sm font-semibold">{pmr.status.replaceAll("_", " ")}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-slate-500">Issued</div>
                <div className="mt-1 text-sm font-semibold">{fmtQty(pmr.totalIssued)}</div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase text-slate-500">Pending</div>
                <div className="mt-1 text-sm font-semibold">{fmtQty(pmr.totalPending)}</div>
              </div>
            </div>
          </section>

          <section className="rounded-md border border-slate-200 bg-white">
            <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold">Issued RM Lines</div>
            <div className="divide-y divide-slate-100">
              {pmr.lines.map((line) => (
                <div key={line.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div className="font-medium">{line.itemName || `Item #${line.itemId}`}</div>
                  <div className="text-slate-600">Issued {fmtQty(line.issuedQty, line.unit)}</div>
                  <div className="text-slate-600">Required {fmtQty(line.requiredQty, line.unit)}</div>
                </div>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={onBackToList}>
              Back
            </Button>
            <Button type="button" disabled={submitting || releaseBlocked || alreadyReleased} onClick={releaseToProduction}>
              {submitting ? "Releasing..." : "Release to Production"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function ProductionReleaseHandoffPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pmrId = Number(searchParams.get("pmrId") ?? 0);
  const workOrderId = Number(searchParams.get("workOrderId") ?? 0);
  const isDetailMode = (Number.isFinite(workOrderId) && workOrderId > 0) || (Number.isFinite(pmrId) && pmrId > 0);

  function openDetail(woId: number) {
    const next = new URLSearchParams(searchParams);
    next.set("workOrderId", String(woId));
    next.delete("pmrId");
    if (!next.get("from")) next.set("from", "pending-actions");
    setSearchParams(next);
  }

  function backToList() {
    const next = new URLSearchParams();
    const from = searchParams.get("from");
    if (from) next.set("from", from);
    setSearchParams(next);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 px-3 py-3 text-slate-900">
      {isDetailMode ? (
        <ProductionReleaseHandoffDetail
          workOrderId={workOrderId}
          pmrId={pmrId}
          onBackToList={backToList}
        />
      ) : (
        <ProductionReleaseHandoffList onOpenDetail={openDetail} />
      )}
    </div>
  );
}
