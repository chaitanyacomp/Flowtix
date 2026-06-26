import * as React from "react";
import {
  blockProductionExecutionApi,
  blockReasonDisplayLabel,
  fetchProductionExecution,
  finishProductionExecutionApi,
  resumeProductionExecutionApi,
  type ProductionBlockReason,
  type ProductionExecutionSummary,
  type ProductionResolutionReason,
  type ShortfallFinishOutcome,
} from "../../../lib/productionExecutionApi";

const BLOCK_REASONS: ProductionBlockReason[] = [
  "MACHINE_BREAKDOWN",
  "WAITING_FOR_RM",
  "TOOL_MOULD_MAINTENANCE",
  "QUALITY_CONCERN",
  "EMERGENCY_PRIORITY_PRODUCTION",
  "POWER_UTILITY_FAILURE",
  "MANAGEMENT_HOLD",
  "OTHER",
];

const RESOLUTION_REASONS: ProductionResolutionReason[] = [
  "MACHINE_BREAKDOWN",
  "CAPACITY_CONSTRAINT",
  "WAITING_FOR_RM",
  "TOOL_MAINTENANCE",
  "CUSTOMER_PRIORITY_CHANGE",
  "MANAGEMENT_DECISION",
  "QUALITY_CONCERN",
  "OTHER",
];

type Props = {
  workOrderId: number;
  orderType?: string | null;
  /** Production / Admin shop-floor operators only. */
  canOperate?: boolean;
  onChanged?: () => void;
};

export function ProductionExecutionPanel({ workOrderId, orderType, canOperate = false, onChanged }: Props) {
  const [summary, setSummary] = React.useState<ProductionExecutionSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shortfallOpen, setShortfallOpen] = React.useState(false);
  const [blockOpen, setBlockOpen] = React.useState(false);
  const [blockReason, setBlockReason] = React.useState<ProductionBlockReason>("MACHINE_BREAKDOWN");
  const [resolutionReason, setResolutionReason] = React.useState<ProductionResolutionReason>("CAPACITY_CONSTRAINT");
  const [remarks, setRemarks] = React.useState("");

  const isNoQty = String(orderType ?? "").toUpperCase() === "NO_QTY";

  const reload = React.useCallback(async () => {
    if (!isNoQty || !canOperate || !workOrderId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProductionExecution(workOrderId);
      setSummary(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load production execution.");
    } finally {
      setLoading(false);
    }
  }, [isNoQty, canOperate, workOrderId]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  if (!isNoQty || !canOperate || !workOrderId) return null;

  const execStatus = summary?.executionStatus ?? "RUNNING";
  const isBlocked = execStatus === "BLOCKED";
  const isCompleted = execStatus === "COMPLETED";
  const pendingQty = Number(summary?.productionPendingQty ?? summary?.remainderQty ?? 0);
  const showExecutionPanel =
    !isCompleted && (isBlocked || execStatus === "RUNNING" || pendingQty > 0);

  if (loading && !summary) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-600">
        Loading production execution…
      </div>
    );
  }

  if (!showExecutionPanel) return null;

  async function runAction(fn: () => Promise<unknown>): Promise<boolean> {
    setLoading(true);
    setError(null);
    try {
      await fn();
      await reload();
      onChanged?.();
      return true;
    } catch (e: unknown) {
      const err = e as Error & { shortfall?: ProductionExecutionSummary };
      if (err.message?.includes("shortfall") || (e as { code?: string }).code === "WO_EXEC_SHORTFALL_REQUIRED") {
        setShortfallOpen(true);
        if (err.shortfall) setSummary(err.shortfall);
      } else {
        setError(err.message || "Action failed.");
      }
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    if (summary?.hasShortfall) {
      setShortfallOpen(true);
      return;
    }
    await runAction(() => finishProductionExecutionApi(workOrderId, {}));
  }

  async function handleBlock() {
    const ok = await runAction(() =>
      blockProductionExecutionApi(workOrderId, {
        blockReason,
        remarks: remarks.trim() || null,
      }),
    );
    if (ok) {
      setBlockOpen(false);
      setRemarks("");
    }
  }

  async function handleResume() {
    await runAction(() => resumeProductionExecutionApi(workOrderId));
  }

  async function handleShortfallFinish(outcome: ShortfallFinishOutcome) {
    if (outcome === "BLOCK") {
      setShortfallOpen(false);
      setBlockOpen(true);
      return;
    }
    const ok = await runAction(() =>
      finishProductionExecutionApi(workOrderId, {
        shortfallOutcome: outcome,
        resolutionReason,
        remarks: remarks.trim() || null,
      }),
    );
    if (ok) {
      setShortfallOpen(false);
      setRemarks("");
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">Production execution</div>
          {summary ? (
            <div className="text-slate-600 tabular-nums">
              Produced {summary.producedQty} / Planned {summary.plannedQty}
              {summary.remainderQty > 0 ? ` · Remaining ${summary.remainderQty}` : null}
            </div>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isCompleted
              ? "bg-emerald-100 text-emerald-800"
              : isBlocked
                ? "bg-amber-100 text-amber-900"
                : "bg-sky-100 text-sky-800"
          }`}
        >
          {isCompleted ? "Completed" : isBlocked ? "Blocked" : "Running"}
        </span>
      </div>

      {isBlocked && summary?.blockReason ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">
          <span className="font-medium">{summary.blockReasonLabel ?? blockReasonDisplayLabel(summary.blockReason)}</span>
          {summary.blockRemarks ? <span className="text-amber-900"> — {summary.blockRemarks}</span> : null}
        </div>
      ) : null}

      {error ? <div className="text-red-700">{error}</div> : null}

      {!isCompleted ? (
        <div className="flex flex-wrap gap-2">
          {!isBlocked ? (
            <>
              <button
                type="button"
                className="rounded bg-slate-800 px-3 py-1.5 text-white disabled:opacity-50"
                disabled={loading || !summary || summary.producedQty <= 0}
                onClick={() => void handleFinish()}
              >
                Finish Production Execution
              </button>
              <button
                type="button"
                className="rounded border border-amber-300 bg-white px-3 py-1.5 text-amber-950 disabled:opacity-50"
                disabled={loading}
                onClick={() => setBlockOpen(true)}
              >
                Cannot Continue Production
              </button>
            </>
          ) : (
            <button
              type="button"
              className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-50"
              disabled={loading}
              onClick={() => void handleResume()}
            >
              Resume Production
            </button>
          )}
        </div>
      ) : null}

      {blockOpen ? (
        <div className="space-y-2 rounded border border-slate-300 bg-white p-3">
          <div className="font-medium">Cannot Continue Production</div>
          <label className="block">
            <span className="text-slate-600">Blocker reason</span>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={blockReason}
              onChange={(e) => setBlockReason(e.target.value as ProductionBlockReason)}
            >
              {BLOCK_REASONS.map((r) => (
                <option key={r} value={r}>
                  {blockReasonDisplayLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Remarks{blockReason === "OTHER" ? " (required)" : ""}</span>
            <textarea className="mt-1 w-full rounded border px-2 py-1" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="rounded bg-amber-700 px-3 py-1 text-white" disabled={loading} onClick={() => void handleBlock()}>
              Confirm block
            </button>
            <button type="button" className="rounded border px-3 py-1" onClick={() => setBlockOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {shortfallOpen && summary ? (
        <div className="space-y-3 rounded border border-violet-300 bg-white p-3">
          <div>
            <div className="font-semibold">Production shortfall detected</div>
            <p className="text-slate-700">
              Produced Qty is {summary.producedQty} against Planned Qty {summary.plannedQty}. Remaining Qty ={" "}
              {summary.remainderQty}. How should the remaining quantity be resolved?
            </p>
          </div>
          <label className="block">
            <span className="text-slate-600">Resolution reason (carry forward / waive)</span>
            <select
              className="mt-1 w-full rounded border px-2 py-1"
              value={resolutionReason}
              onChange={(e) => setResolutionReason(e.target.value as ProductionResolutionReason)}
            >
              {RESOLUTION_REASONS.map((r) => (
                <option key={r} value={r}>
                  {blockReasonDisplayLabel(r)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-slate-600">Remarks{resolutionReason === "OTHER" ? " (required)" : ""}</span>
            <textarea className="mt-1 w-full rounded border px-2 py-1" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button type="button" className="rounded border border-amber-300 px-3 py-1.5" onClick={() => void handleShortfallFinish("BLOCK")}>
              Cannot Continue Production
            </button>
            <button
              type="button"
              className="rounded bg-violet-700 px-3 py-1.5 text-white"
              disabled={loading}
              onClick={() => void handleShortfallFinish("CARRY_FORWARD")}
            >
              Finish Execution &amp; Carry Forward Balance
            </button>
            <button
              type="button"
              className="rounded bg-slate-700 px-3 py-1.5 text-white"
              disabled={loading}
              onClick={() => void handleShortfallFinish("WAIVE_BALANCE")}
            >
              Finish Execution &amp; Waive Balance
            </button>
            <button type="button" className="rounded border px-3 py-1.5" onClick={() => setShortfallOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
