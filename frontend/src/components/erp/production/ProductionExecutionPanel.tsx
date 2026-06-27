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
} from "../../../lib/productionExecutionApi";
import { useToast } from "../../../contexts/ToastContext";
import { cn } from "../../../lib/utils";
import {
  CARRY_FORWARD_REASON_OPTIONS,
  completionEvaluationSignature,
  formatExecutionStatusSummary,
  formatProductionCompletionSuccessMessage,
  formatProductionExecutionFinishSuccessMessage,
  PAUSE_REASON_OPTIONS,
  resolveProductionCompletionScenario,
  SHORTFALL_DECISION_CHOICES,
  PAUSED_SHORTFALL_DECISION_CHOICES,
  shouldShowProductionExecutionPanel,
  hasPendingShortfallDecision,
  hasPausedShortfallDecision,
  shouldShowShortfallResolutionPanel,
  type ProductionExecutionClosedOutcome,
  type ShortfallDecisionChoice,
  type PausedShortfallDecisionChoice,
  WAIVE_REASON_OPTIONS,
} from "../../../lib/productionCompletionUx";

const EPS = 1e-6;

type Props = {
  workOrderId: number;
  orderType?: string | null;
  canOperate?: boolean;
  /** Bumps when parent WO/entry metrics refresh (e.g. after approve). */
  refreshKey?: number;
  /** When incremented, re-evaluate completion scenario (typically after batch approve). */
  evaluateTick?: number;
  /** Approved batch qty that triggered the latest evaluate tick. */
  evaluateBatchQty?: number;
  onChanged?: () => void;
  /** Latest execution read model for parent (hide production entry when shortfall pending). */
  onSummaryChange?: (summary: ProductionExecutionSummary | null) => void;
  /** WO execution closed (auto complete/surplus or waive/carry) — parent refocuses queue. */
  onExecutionClosed?: (payload: {
    workOrderId: number;
    outcome: ProductionExecutionClosedOutcome;
  }) => void | Promise<void>;
};

export function ProductionExecutionPanel({
  workOrderId,
  orderType,
  canOperate = false,
  refreshKey = 0,
  evaluateTick = 0,
  evaluateBatchQty = 0,
  onChanged,
  onSummaryChange,
  onExecutionClosed,
}: Props) {
  const toast = useToast();
  const [summary, setSummary] = React.useState<ProductionExecutionSummary | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shortfallChoice, setShortfallChoice] = React.useState<ShortfallDecisionChoice>("waive");
  const [pausedShortfallChoice, setPausedShortfallChoice] = React.useState<PausedShortfallDecisionChoice>("resume");
  const [waiveReason, setWaiveReason] = React.useState<ProductionResolutionReason>("MANAGEMENT_DECISION");
  const [carryReason, setCarryReason] = React.useState<ProductionResolutionReason>("CAPACITY_CONSTRAINT");
  const [pauseReason, setPauseReason] = React.useState<ProductionBlockReason>("MACHINE_BREAKDOWN");
  const [waiveRemarks, setWaiveRemarks] = React.useState("");
  const [carryRemarks, setCarryRemarks] = React.useState("");
  const [pauseRemarks, setPauseRemarks] = React.useState("");
  const autoEvaluatedRef = React.useRef<string | null>(null);

  const isNoQty = String(orderType ?? "").toUpperCase() === "NO_QTY";

  const reload = React.useCallback(async () => {
    if (!isNoQty || !canOperate || !workOrderId) return null;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchProductionExecution(workOrderId);
      setSummary(data);
      onSummaryChange?.(data);
      return data;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load production status.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [isNoQty, canOperate, workOrderId, onSummaryChange]);

  React.useEffect(() => {
    if (!workOrderId) onSummaryChange?.(null);
  }, [workOrderId, onSummaryChange]);

  React.useEffect(() => {
    void reload();
  }, [reload, refreshKey]);

  const notifyExecutionClosed = React.useCallback(
    async (outcome: ProductionExecutionClosedOutcome) => {
      if (onExecutionClosed) {
        await onExecutionClosed({ workOrderId, outcome });
      } else {
        onChanged?.();
      }
    },
    [onExecutionClosed, onChanged, workOrderId],
  );

  async function runAction<T extends { successMessage?: string | null; outcome?: string }>(
    fn: () => Promise<T>,
    opts?: { skipParentRefresh?: boolean },
  ): Promise<{ ok: boolean; result?: T }> {
    setLoading(true);
    setError(null);
    try {
      const result = await fn();
      await reload();
      if (!opts?.skipParentRefresh) onChanged?.();
      return { ok: true, result };
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed.");
      return { ok: false };
    } finally {
      setLoading(false);
    }
  }

  const evaluateCompletion = React.useCallback(
    async (data: ProductionExecutionSummary, batchQty: number, force = false) => {
      const scenario = resolveProductionCompletionScenario(data);
      const remainder = Number(data.remainderQty ?? 0);

      const shouldEvaluateShortfall =
        scenario === "SHORTFALL" && batchQty > EPS && remainder > EPS && batchQty + EPS >= remainder;
      const shouldEvaluateComplete = scenario === "COMPLETE" || scenario === "SURPLUS";

      if (!shouldEvaluateShortfall && !shouldEvaluateComplete) return;

      const sig = `${completionEvaluationSignature(data)}:${batchQty}:${shouldEvaluateShortfall ? "sf" : "done"}`;
      if (!force && autoEvaluatedRef.current === sig) return;
      autoEvaluatedRef.current = sig;

      if (shouldEvaluateShortfall) {
        setShortfallChoice("waive");
        return;
      }
      if (shouldEvaluateComplete) {
        const outcome: ProductionExecutionClosedOutcome = scenario === "SURPLUS" ? "SURPLUS" : "COMPLETE";
        const { ok, result } = await runAction(() => finishProductionExecutionApi(workOrderId, {}), {
          skipParentRefresh: Boolean(onExecutionClosed),
        });
        if (ok) {
          const message =
            result?.successMessage ?? formatProductionCompletionSuccessMessage(data, result?.successMessage);
          toast.showSuccess(message);
          await notifyExecutionClosed(outcome);
        }
      }
    },
    [toast, workOrderId, onExecutionClosed, notifyExecutionClosed],
  );

  React.useEffect(() => {
    if (!summary || evaluateTick <= 0) return;
    void evaluateCompletion(summary, evaluateBatchQty, true);
  }, [evaluateTick, evaluateBatchQty, summary, evaluateCompletion]);

  if (!isNoQty || !canOperate || !workOrderId) return null;

  const scenario = resolveProductionCompletionScenario(summary);
  const isPaused = scenario === "PAUSED";
  const isDone = scenario === "DONE";
  const showPendingShortfallDecision = hasPendingShortfallDecision(summary);
  const showPausedShortfallDecision = hasPausedShortfallDecision(summary);
  const showResolutionPanel = shouldShowShortfallResolutionPanel(summary);
  const showPanel = shouldShowProductionExecutionPanel(summary);

  if (loading && !summary) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm text-slate-600">
        Loading production status…
      </div>
    );
  }

  if (!showPanel) return null;

  async function handleResume() {
    autoEvaluatedRef.current = null;
    await runAction(() => resumeProductionExecutionApi(workOrderId));
  }

  async function handleWaive() {
    const remainderQty = Number(summary?.remainderQty ?? 0);
    const { ok, result } = await runAction(
      () =>
        finishProductionExecutionApi(workOrderId, {
          shortfallOutcome: "WAIVE_BALANCE",
          resolutionReason: waiveReason,
          remarks: waiveRemarks.trim() || null,
        }),
      { skipParentRefresh: Boolean(onExecutionClosed) },
    );
    if (ok) {
      const message =
        result?.successMessage ??
        formatProductionExecutionFinishSuccessMessage(
          summary?.workOrderDocNo,
          workOrderId,
          "WAIVE_BALANCE",
          remainderQty,
        );
      if (message) toast.showSuccess(message);
      await notifyExecutionClosed("WAIVE_BALANCE");
    }
  }

  async function handleCarryForward() {
    const remainderQty = Number(summary?.remainderQty ?? 0);
    const { ok, result } = await runAction(
      () =>
        finishProductionExecutionApi(workOrderId, {
          shortfallOutcome: "CARRY_FORWARD",
          resolutionReason: carryReason,
          remarks: carryRemarks.trim() || null,
        }),
      { skipParentRefresh: Boolean(onExecutionClosed) },
    );
    if (ok) {
      const message =
        result?.successMessage ??
        formatProductionExecutionFinishSuccessMessage(
          summary?.workOrderDocNo,
          workOrderId,
          "CARRY_FORWARD",
          remainderQty,
        );
      if (message) toast.showSuccess(message);
      await notifyExecutionClosed("CARRY_FORWARD");
    }
  }

  async function handlePause() {
    const { ok } = await runAction(() =>
      blockProductionExecutionApi(workOrderId, {
        blockReason: pauseReason,
        remarks: pauseRemarks.trim() || null,
      }),
    );
    if (ok) {
      autoEvaluatedRef.current = null;
    }
  }

  const activeShortfall = SHORTFALL_DECISION_CHOICES.find((c) => c.id === shortfallChoice)!;
  const activePausedShortfall = PAUSED_SHORTFALL_DECISION_CHOICES.find((c) => c.id === pausedShortfallChoice)!;

  async function confirmShortfallChoice() {
    if (shortfallChoice === "waive") await handleWaive();
    else if (shortfallChoice === "carry") await handleCarryForward();
    else await handlePause();
  }

  async function confirmPausedShortfallChoice() {
    if (pausedShortfallChoice === "resume") await handleResume();
    else if (pausedShortfallChoice === "waive") await handleWaive();
    else await handleCarryForward();
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-sm space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">Production status</div>
          {summary ? (
            <div className="text-slate-600 tabular-nums">{formatExecutionStatusSummary(summary)}</div>
          ) : null}
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            isDone
              ? "bg-emerald-100 text-emerald-800"
              : isPaused
                ? "bg-amber-100 text-amber-900"
                : showPendingShortfallDecision
                  ? "bg-violet-100 text-violet-900"
                  : "bg-sky-100 text-sky-800"
          }`}
        >
          {isDone
            ? "Completed"
            : showPausedShortfallDecision
              ? "Paused — decision required"
              : isPaused
                ? "Paused"
                : showPendingShortfallDecision
                  ? "Action required"
                  : "In progress"}
        </span>
      </div>

      {isPaused && summary?.blockReason ? (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-950">
          <span className="font-medium">{summary.blockReasonLabel ?? blockReasonDisplayLabel(summary.blockReason)}</span>
          {summary.blockRemarks ? <span className="text-amber-900"> — {summary.blockRemarks}</span> : null}
        </div>
      ) : null}

      {error ? <div className="text-red-700">{error}</div> : null}

      {isPaused && !showPausedShortfallDecision && !isDone ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-sky-700 px-3 py-1.5 text-white disabled:opacity-50"
            disabled={loading}
            onClick={() => void handleResume()}
          >
            Resume Production
          </button>
        </div>
      ) : null}

      {showResolutionPanel && summary && !isDone ? (
        <div
          className="space-y-2 rounded border border-violet-300 bg-white p-2.5"
          data-testid="production-completion-dialog"
        >
          <div>
            <div className="text-[13px] font-semibold text-slate-900">
              {showPausedShortfallDecision ? "Production paused with remaining qty" : "Produced less than WO quantity"}
            </div>
            <p className="text-[11px] text-slate-600">
              {showPausedShortfallDecision
                ? "Resume to keep producing, or close the WO by waiving or carrying forward the remainder."
                : "Choose how to handle the remaining qty."}
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-1.5 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px]">
            <div>
              <dt className="text-slate-500">Planned</dt>
              <dd className="font-bold tabular-nums text-slate-900">{summary.plannedQty}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Produced</dt>
              <dd className="font-bold tabular-nums text-slate-900">{summary.producedQty}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Remaining</dt>
              <dd className="font-bold tabular-nums text-amber-950">{summary.remainderQty}</dd>
            </div>
          </dl>

          {showPausedShortfallDecision ? (
            <>
              <div
                className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5"
                role="tablist"
                aria-label="Paused shortfall resolution"
              >
                {PAUSED_SHORTFALL_DECISION_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    role="tab"
                    aria-selected={pausedShortfallChoice === choice.id}
                    data-testid={`paused-shortfall-tab-${choice.id}`}
                    className={cn(
                      "flex-1 min-w-[5.5rem] rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                      pausedShortfallChoice === choice.id
                        ? choice.id === "resume"
                          ? "bg-sky-700 text-white shadow-sm"
                          : choice.id === "waive"
                            ? "bg-slate-800 text-white shadow-sm"
                            : "bg-violet-700 text-white shadow-sm"
                        : "text-slate-700 hover:bg-white",
                    )}
                    onClick={() => setPausedShortfallChoice(choice.id)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <div className="space-y-2 rounded border border-slate-200 p-2" role="tabpanel">
                <p className="text-[11px] leading-snug text-slate-600">{activePausedShortfall.description}</p>
                {pausedShortfallChoice === "waive" ? (
                  <>
                    <label className="block text-[11px]">
                      <span className="text-slate-600">Reason</span>
                      <select
                        className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                        value={waiveReason}
                        onChange={(e) => setWaiveReason(e.target.value as ProductionResolutionReason)}
                      >
                        {WAIVE_REASON_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {blockReasonDisplayLabel(r)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[11px]">
                      <span className="text-slate-600">Remarks{waiveReason === "OTHER" ? " (required)" : ""}</span>
                      <textarea
                        className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                        rows={1}
                        value={waiveRemarks}
                        onChange={(e) => setWaiveRemarks(e.target.value)}
                      />
                    </label>
                  </>
                ) : null}
                {pausedShortfallChoice === "carry" ? (
                  <>
                    <label className="block text-[11px]">
                      <span className="text-slate-600">Reason</span>
                      <select
                        className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                        value={carryReason}
                        onChange={(e) => setCarryReason(e.target.value as ProductionResolutionReason)}
                      >
                        {CARRY_FORWARD_REASON_OPTIONS.map((r) => (
                          <option key={r} value={r}>
                            {blockReasonDisplayLabel(r)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block text-[11px]">
                      <span className="text-slate-600">Remarks{carryReason === "OTHER" ? " (required)" : ""}</span>
                      <textarea
                        className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                        rows={1}
                        value={carryRemarks}
                        onChange={(e) => setCarryRemarks(e.target.value)}
                      />
                    </label>
                  </>
                ) : null}
                <button
                  type="button"
                  className={cn(
                    "w-full rounded px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50",
                    pausedShortfallChoice === "resume"
                      ? "bg-sky-700"
                      : pausedShortfallChoice === "waive"
                        ? "bg-slate-800"
                        : "bg-violet-700",
                  )}
                  disabled={loading}
                  data-testid="paused-shortfall-confirm"
                  onClick={() => void confirmPausedShortfallChoice()}
                >
                  {activePausedShortfall.confirmLabel}
                </button>
              </div>
            </>
          ) : (
            <>
          <div
            className="flex flex-wrap gap-1 rounded-md border border-slate-200 bg-slate-50 p-0.5"
            role="tablist"
            aria-label="Shortfall resolution"
          >
            {SHORTFALL_DECISION_CHOICES.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="tab"
                aria-selected={shortfallChoice === choice.id}
                data-testid={`shortfall-tab-${choice.id}`}
                className={cn(
                  "flex-1 min-w-[5.5rem] rounded px-2 py-1 text-[11px] font-semibold transition-colors",
                  shortfallChoice === choice.id
                    ? choice.id === "waive"
                      ? "bg-slate-800 text-white shadow-sm"
                      : choice.id === "carry"
                        ? "bg-violet-700 text-white shadow-sm"
                        : "bg-amber-700 text-white shadow-sm"
                    : "text-slate-700 hover:bg-white",
                )}
                onClick={() => setShortfallChoice(choice.id)}
              >
                {choice.label}
              </button>
            ))}
          </div>

          <div className="space-y-2 rounded border border-slate-200 p-2" role="tabpanel">
            <p className="text-[11px] leading-snug text-slate-600">{activeShortfall.description}</p>
            {shortfallChoice === "waive" ? (
              <>
                <label className="block text-[11px]">
                  <span className="text-slate-600">Reason</span>
                  <select
                    className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                    value={waiveReason}
                    onChange={(e) => setWaiveReason(e.target.value as ProductionResolutionReason)}
                  >
                    {WAIVE_REASON_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {blockReasonDisplayLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px]">
                  <span className="text-slate-600">Remarks{waiveReason === "OTHER" ? " (required)" : ""}</span>
                  <textarea
                    className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                    rows={1}
                    value={waiveRemarks}
                    onChange={(e) => setWaiveRemarks(e.target.value)}
                  />
                </label>
              </>
            ) : null}
            {shortfallChoice === "carry" ? (
              <>
                <label className="block text-[11px]">
                  <span className="text-slate-600">Reason</span>
                  <select
                    className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                    value={carryReason}
                    onChange={(e) => setCarryReason(e.target.value as ProductionResolutionReason)}
                  >
                    {CARRY_FORWARD_REASON_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {blockReasonDisplayLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px]">
                  <span className="text-slate-600">Remarks{carryReason === "OTHER" ? " (required)" : ""}</span>
                  <textarea
                    className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                    rows={1}
                    value={carryRemarks}
                    onChange={(e) => setCarryRemarks(e.target.value)}
                  />
                </label>
              </>
            ) : null}
            {shortfallChoice === "pause" ? (
              <>
                <label className="block text-[11px]">
                  <span className="text-slate-600">Reason</span>
                  <select
                    className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                    value={pauseReason}
                    onChange={(e) => setPauseReason(e.target.value as ProductionBlockReason)}
                  >
                    {PAUSE_REASON_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {blockReasonDisplayLabel(r)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-[11px]">
                  <span className="text-slate-600">Remarks{pauseReason === "OTHER" ? " (required)" : ""}</span>
                  <textarea
                    className="mt-0.5 w-full rounded border px-2 py-1 text-[12px]"
                    rows={1}
                    value={pauseRemarks}
                    onChange={(e) => setPauseRemarks(e.target.value)}
                  />
                </label>
              </>
            ) : null}
            <button
              type="button"
              className={cn(
                "w-full rounded px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50",
                shortfallChoice === "waive"
                  ? "bg-slate-800"
                  : shortfallChoice === "carry"
                    ? "bg-violet-700"
                    : "bg-amber-700",
              )}
              disabled={loading}
              data-testid="shortfall-confirm"
              onClick={() => void confirmShortfallChoice()}
            >
              {activeShortfall.confirmLabel}
            </button>
          </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
