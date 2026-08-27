import * as React from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS,
  buildActiveShiftRunWorkspaceHref,
  isActiveShiftRunPrimaryAction,
  resolveActiveShiftRunPrimaryAction,
} from "../lib/activeShiftRunGuidance";
import { evaluateOpenShiftOverdue, SHIFT_OVERDUE_MESSAGE } from "../lib/shiftOverdueGuidance";
import { PageContainer, StickyWorkspaceHead, ERPBackNavigation } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { ErpModal } from "../components/erp/ErpModal";
import { fetchOperators, type OperatorRow } from "../lib/operatorApi";
import {
  changeShiftPrimaryOperator,
  closeShiftRunSegment,
  continueShiftDowntime,
  DOWNTIME_REASON_OPTIONS,
  fetchEligibleRuns,
  fetchOpenDowntime,
  fetchBusyShiftOperators,
  fetchShiftCapabilities,
  fetchShiftSession,
  joinShiftOperator,
  leaveShiftOperator,
  pauseShiftDowntime,
  resumeShiftDowntime,
  startShiftRunSegment,
  type BusyShiftOperator,
  type EligibleRunOption,
  type OpenDowntimeIncident,
  type ShiftCapabilities,
  type ShiftSessionDetail,
} from "../lib/machineShiftSessionApi";
import {
  busyOperatorIdSet,
  canCancelShiftSession,
  canShowManagerControls,
  canPauseShiftProduction,
  deriveMachineShiftUiStatus,
  deriveShiftLifecycleStage,
  downtimeReasonLabel,
  findActiveRun,
  findOpenDowntimeIncident,
  formatElapsed,
  formatIndiaDateTime,
  formatIndiaTime,
  handoverStateLabel,
  machineDisplayName,
  machineShiftStatusLabel,
  machineShiftStatusTone,
  mapShiftApiError,
  operatorDisplayName,
  shiftDisplayLabel,
  shiftLifecycleNextAction,
  shiftLifecycleStageLabel,
  shiftProductionQtyLockDisplayMessage,
  resolveShiftProductionListBackTarget,
  SHIFT_PRODUCTION_LIST_PATH,
  SHIFT_SESSION_BACK_LABEL,
} from "../lib/machineShiftSessionUi";
import { cn } from "../lib/utils";
import { ShiftReportPanel } from "../components/erp/shiftProduction/ShiftReportPanel";
import { ShiftOverModal } from "../components/erp/shiftProduction/ShiftOverModal";
import { CancelShiftModal } from "../components/erp/shiftProduction/CancelShiftModal";
import { ShiftReopenPanel } from "../components/erp/shiftProduction/ShiftReopenPanel";
import { ShiftReportAdjustmentPanel } from "../components/erp/shiftProduction/ShiftReportAdjustmentPanel";

function toneToBadge(tone: ReturnType<typeof machineShiftStatusTone>) {
  if (tone === "success") return "success" as const;
  if (tone === "danger") return "rejected" as const;
  if (tone === "warning") return "warning" as const;
  return "default" as const;
}

function ShiftSessionListBackNav({ listHref }: { listHref: string }) {
  return (
    <StickyWorkspaceHead
      className="mb-3"
      lead={
        <ERPBackNavigation
          to={listHref}
          label={SHIFT_SESSION_BACK_LABEL}
          defaultTo={SHIFT_PRODUCTION_LIST_PATH}
          defaultLabel={SHIFT_SESSION_BACK_LABEL}
          className="max-w-full"
          data-testid="shift-session-back-nav"
        />
      }
    />
  );
}

type ActionModal =
  | { kind: "join" }
  | { kind: "leave"; operatorId: number; name: string }
  | { kind: "primary"; operatorId: number; name: string }
  | { kind: "start-run" }
  | { kind: "close-run" }
  | { kind: "pause" }
  | null;

export function ShiftSessionWorkspacePage() {
  const { sessionId: sessionIdParam } = useParams();
  const sessionId = Number(sessionIdParam);
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const userRole = String(auth.user?.role ?? "").trim().toUpperCase();

  const listBackHref = React.useMemo(() => {
    const sp = new URLSearchParams(location.search);
    const state = (location.state ?? {}) as { backTo?: unknown };
    const fromState = typeof state.backTo === "string" ? state.backTo : null;
    return resolveShiftProductionListBackTarget(sp.get("returnTo") ?? fromState);
  }, [location.search, location.state]);

  const [session, setSession] = React.useState<ShiftSessionDetail | null>(null);
  const [caps, setCaps] = React.useState<ShiftCapabilities | null>(null);
  const [operators, setOperators] = React.useState<OperatorRow[]>([]);
  const [busyOperators, setBusyOperators] = React.useState<BusyShiftOperator[]>([]);
  const [eligibleRuns, setEligibleRuns] = React.useState<EligibleRunOption[]>([]);
  const [openDowntime, setOpenDowntime] = React.useState<OpenDowntimeIncident | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [nowMs, setNowMs] = React.useState(Date.now());
  const [modal, setModal] = React.useState<ActionModal>(null);
  const [reason, setReason] = React.useState("");
  const [joinOperatorId, setJoinOperatorId] = React.useState("");
  const [joinQuery, setJoinQuery] = React.useState("");
  const [selectedRunId, setSelectedRunId] = React.useState("");
  const [pauseReason, setPauseReason] = React.useState<string>(DOWNTIME_REASON_OPTIONS[0].value);
  const [pauseRemarks, setPauseRemarks] = React.useState("");
  const [showOpHistory, setShowOpHistory] = React.useState(false);
  const [showRunHistory, setShowRunHistory] = React.useState(false);
  const [showDtHistory, setShowDtHistory] = React.useState(false);
  const [shiftOverOpen, setShiftOverOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const reportSectionRef = React.useRef<HTMLDivElement | null>(null);

  const showManager = canShowManagerControls(caps);

  React.useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const refresh = React.useCallback(async () => {
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      setNotice("Invalid shift session.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setNotice(null);
    try {
      const [sessRes, capRes, ops, busyRes] = await Promise.all([
        fetchShiftSession(sessionId),
        fetchShiftCapabilities(),
        fetchOperators(false),
        fetchBusyShiftOperators().catch(() => ({ operators: [] as BusyShiftOperator[] })),
      ]);
      setSession(sessRes.session);
      setCaps(capRes);
      setOperators(ops.filter((o) => o.isActive));
      setBusyOperators(busyRes.operators || []);

      const machineId = sessRes.session.machine?.id;
      if (machineId) {
        const [runsRes, dtRes] = await Promise.all([
          fetchEligibleRuns(machineId).catch(() => ({ runs: [] as EligibleRunOption[] })),
          fetchOpenDowntime(machineId).catch(() => ({ incident: null })),
        ]);
        setEligibleRuns(runsRes.runs ?? []);
        setOpenDowntime(dtRes.incident);
      }
    } catch (e) {
      setNotice(mapShiftApiError(e, "Unable to load shift session."));
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(fn: () => Promise<unknown>, successMsg?: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setModal(null);
      setReason("");
      setJoinOperatorId("");
      setJoinQuery("");
      setSelectedRunId("");
      setPauseRemarks("");
      if (successMsg) setNotice(successMsg);
      await refresh();
    } catch (e) {
      setNotice(mapShiftApiError(e));
    } finally {
      setBusy(false);
    }
  }

  const status = deriveMachineShiftUiStatus(session);
  const lifecycleStage = deriveShiftLifecycleStage(session);
  const activeRun = findActiveRun(session);
  const nextAction = shiftLifecycleNextAction(lifecycleStage, {
    canManage: showManager,
    activeRunSegment: Boolean(activeRun),
  });
  const openDt = findOpenDowntimeIncident(session);
  const activeOps = (session?.operators ?? []).filter((o) => !o.leftAt);
  const historyOps = (session?.operators ?? []).filter((o) => o.leftAt);
  const closedRuns = (session?.runSegments ?? []).filter((r) => String(r.status).toUpperCase() !== "ACTIVE");
  const isShiftOver = String(session?.status ?? "").toUpperCase() === "SHIFT_OVER";
  const isCancelled = String(session?.status ?? "").toUpperCase() === "CANCELLED";
  const isOpenSession = String(session?.status ?? "").toUpperCase() === "OPEN";
  const showLiveManager = showManager && isOpenSession;
  const showPauseProduction = canPauseShiftProduction(caps) && isOpenSession;
  const showCancel = canCancelShiftSession(session, caps);
  const canCompleteShiftOver =
    lifecycleStage === "VERIFIED" && showManager && !isShiftOver && !isCancelled;
  const canCloseRun =
    showLiveManager && !openDt && (userRole === "ADMIN" || userRole === "PRODUCTION_MANAGER");

  const liveOverdue = evaluateOpenShiftOverdue(
    {
      status: session?.status,
      sessionDate: session?.sessionDate,
      startTime: session?.shift?.startTime,
      endTime: session?.shift?.endTime,
    },
    nowMs,
  );
  const shiftOverdue = Boolean(session?.shiftOverdue) || liveOverdue.overdue;
  const shiftOverdueMessage = liveOverdue.message || session?.shiftOverdueMessage || SHIFT_OVERDUE_MESSAGE;

  const activeRunPrimaryLabel = activeRun
    ? isActiveShiftRunPrimaryAction(activeRun.primaryActionLabel)
      ? String(activeRun.primaryActionLabel)
      : resolveActiveShiftRunPrimaryAction({
          runAllocationId: activeRun.runAllocationId,
          startConfirmationStatus: activeRun.startConfirmationStatus,
          confirmationPending: activeRun.confirmationPending,
        })
    : null;
  const activeRunWorkspaceHref =
    activeRun && session
      ? buildActiveShiftRunWorkspaceHref(
          {
            workOrderId: activeRun.workOrderId,
            workOrderLineId: activeRun.workOrderLineId,
            runAllocationId: activeRun.runAllocationId,
            shiftSessionId: session.id,
            runSegmentId: activeRun.id,
            machineId: session.machine?.id ?? null,
            startConfirmationStatus: activeRun.startConfirmationStatus,
            confirmationPending: activeRun.confirmationPending,
            primaryActionLabel: activeRunPrimaryLabel,
          },
          "shift-production",
        )
      : null;

  function scrollToReport() {
    reportSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onLifecycleAction() {
    if (nextAction.action === "none") return;
    if (nextAction.action === "shift-over") {
      if (canCompleteShiftOver) setShiftOverOpen(true);
      return;
    }
    scrollToReport();
  }

  const joinCandidates = React.useMemo(() => {
    const activeIds = new Set(activeOps.map((o) => o.operator?.id).filter(Boolean));
    const busyElsewhere = busyOperatorIdSet(busyOperators, session?.id ?? sessionId);
    const q = joinQuery.trim().toLowerCase();
    return operators.filter((o) => {
      if (activeIds.has(o.id)) return false;
      if (busyElsewhere.has(o.id)) return false;
      if (!q) return true;
      return o.operatorName.toLowerCase().includes(q) || o.operatorCode.toLowerCase().includes(q);
    });
  }, [operators, activeOps, joinQuery, busyOperators, session?.id, sessionId]);

  if (loading && !session) {
    return (
      <PageContainer>
        <ShiftSessionListBackNav listHref={listBackHref} />
        <p className="text-sm text-slate-500">Loading shift…</p>
      </PageContainer>
    );
  }

  if (!session) {
    return (
      <PageContainer>
        <ShiftSessionListBackNav listHref={listBackHref} />
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{notice || "Shift not found."}</div>
      </PageContainer>
    );
  }

  const continuedBanner =
    openDowntime?.continuedFromPriorShift ||
    (openDowntime?.canContinueIntoCurrentSession && openDt == null);

  return (
    <PageContainer>
      <ShiftSessionListBackNav listHref={listBackHref} />

      {caps?.isFallbackControl ? (
        <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950" role="status">
          Production Manager is not assigned. You have temporary shift control.
        </div>
      ) : null}

      {shiftOverdue && isOpenSession ? (
        <div
          className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950"
          role="status"
          data-testid="shift-overdue-banner"
        >
          {shiftOverdueMessage}
        </div>
      ) : null}

      {notice ? (
        <div
          className={cn(
            "mb-3 rounded-md border px-4 py-2 text-sm",
            notice.toLowerCase().includes("unable") || notice.toLowerCase().includes("must")
              ? "border-amber-200 bg-amber-50 text-amber-950"
              : "border-slate-200 bg-slate-50 text-slate-800",
          )}
          role="status"
        >
          {notice}
        </div>
      ) : null}

      {/* Header */}
      <header className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{machineDisplayName(session.machine)}</h1>
              <Badge variant={toneToBadge(machineShiftStatusTone(status))}>{machineShiftStatusLabel(status)}</Badge>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {session.shiftSessionNo} · {shiftDisplayLabel(session.shift)} · {session.sessionDate || "—"}
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Primary: <span className="font-medium">{operatorDisplayName(session.primaryOperator)}</span>
              <span className="mx-2 text-slate-300">|</span>
              Elapsed: <span className="font-medium tabular-nums">{formatElapsed(session.startedAt, nowMs)}</span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="shift-lifecycle-stage">
              <Badge variant="default">{shiftLifecycleStageLabel(lifecycleStage)}</Badge>
              <span className="text-sm text-slate-600">Next:</span>
              <Button
                type="button"
                size="sm"
                variant={nextAction.action === "shift-over" && !canCompleteShiftOver ? "outline" : "secondary"}
                disabled={
                  busy ||
                  nextAction.action === "none" ||
                  (nextAction.action === "shift-over" && !canCompleteShiftOver)
                }
                onClick={onLifecycleAction}
                data-testid="shift-lifecycle-next-action"
              >
                {nextAction.label}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={() => void refresh()} disabled={busy || loading}>
              Refresh
            </Button>
            {showCancel ? (
              <Button
                type="button"
                variant="destructive"
                disabled={busy || loading}
                onClick={() => setCancelOpen(true)}
                data-testid="cancel-shift-button"
              >
                Cancel Shift
              </Button>
            ) : null}
          </div>
        </div>
        {isCancelled ? (
          <div
            className="mt-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800"
            role="status"
            data-testid="cancelled-shift-banner"
          >
            This shift was cancelled
            {session.cancellationReason ? (
              <>
                : <span className="font-medium">{session.cancellationReason}</span>
              </>
            ) : null}
            . It is kept for audit and is not an active shift.
          </div>
        ) : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Operators */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-1">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Operators</h2>
            {showLiveManager ? (
              <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => setModal({ kind: "join" })}>
                Join
              </Button>
            ) : null}
          </div>
          <ul className="space-y-2">
            {activeOps.map((row) => (
              <li key={row.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{operatorDisplayName(row.operator)}</div>
                    {row.isPrimary ? <span className="text-xs font-semibold text-teal-700">Primary</span> : null}
                    <div className="text-xs text-slate-500">Joined {formatIndiaTime(row.joinedAt)}</div>
                  </div>
                  {showLiveManager ? (
                    <div className="flex flex-col gap-1">
                      {!row.isPrimary ? (
                        <button
                          type="button"
                          className="text-xs text-teal-700 underline disabled:opacity-50"
                          disabled={busy}
                          onClick={() =>
                            setModal({
                              kind: "primary",
                              operatorId: row.operator!.id,
                              name: operatorDisplayName(row.operator),
                            })
                          }
                        >
                          Make primary
                        </button>
                      ) : null}
                      {!row.isPrimary ? (
                        <button
                          type="button"
                          className="text-xs text-slate-600 underline disabled:opacity-50"
                          disabled={busy}
                          onClick={() =>
                            setModal({
                              kind: "leave",
                              operatorId: row.operator!.id,
                              name: operatorDisplayName(row.operator),
                            })
                          }
                        >
                          Leave
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-400">Change primary first</span>
                      )}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
            {!activeOps.length ? <li className="text-sm text-slate-500">No active operators.</li> : null}
          </ul>
          {historyOps.length ? (
            <div className="mt-3">
              <button
                type="button"
                className="text-xs font-medium text-slate-600 underline"
                onClick={() => setShowOpHistory((v) => !v)}
              >
                {showOpHistory ? "Hide" : "Show"} operator history ({historyOps.length})
              </button>
              {showOpHistory ? (
                <ul className="mt-2 space-y-1 text-xs text-slate-500">
                  {historyOps.map((row) => (
                    <li key={row.id}>
                      {operatorDisplayName(row.operator)} — joined {formatIndiaDateTime(row.joinedAt)}, left{" "}
                      {formatIndiaDateTime(row.leftAt)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* Run + Downtime */}
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Current production run</h2>
            {activeRun ? (
              <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-4">
                <div className="text-lg font-semibold text-teal-900">
                  {activeRun.workOrderDocNo || `Work order ${activeRun.workOrderId}`}
                </div>
                <p className="mt-1 text-sm text-teal-800">
                  Segment {activeRun.segmentNo} · Started {formatIndiaDateTime(activeRun.startedAt)} · Running{" "}
                  {formatElapsed(activeRun.startedAt, nowMs)}
                </p>
                {session?.productionQtyLocked ? (
                  <p
                    className="mt-2 text-sm font-medium text-amber-900"
                    role="status"
                    data-testid="shift-qty-locked-banner"
                  >
                    {shiftProductionQtyLockDisplayMessage(session) ||
                      "Shift Report submitted — production quantities are locked pending manager review."}
                  </p>
                ) : null}
                {!openDt ? (
                  <div className="mt-3 flex flex-wrap gap-2" data-testid="active-run-actions">
                    {activeRunWorkspaceHref ? (
                      <Link
                        to={activeRunWorkspaceHref}
                        className={buttonVariants()}
                        data-testid="active-run-primary-action"
                      >
                        {activeRunPrimaryLabel ?? ACTIVE_SHIFT_RUN_PRIMARY_ACTIONS.RECORD_PRODUCTION}
                      </Link>
                    ) : null}
                    {showPauseProduction ? (
                      <Button type="button" variant="destructive" disabled={busy} onClick={() => setModal({ kind: "pause" })}>
                        Pause Production
                      </Button>
                    ) : null}
                    {canCloseRun ? (
                      <Button type="button" variant="outline" disabled={busy} onClick={() => setModal({ kind: "close-run" })}>
                        Close Run
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                No active production run.
                {session?.productionQtyLocked ? (
                  <p
                    className="mt-2 text-sm font-medium text-amber-900"
                    role="status"
                    data-testid="shift-qty-locked-banner"
                  >
                    {shiftProductionQtyLockDisplayMessage(session) ||
                      "Shift Report submitted — production quantities are locked pending manager review."}
                  </p>
                ) : null}
                {showLiveManager && !openDt && !session?.productionQtyLocked ? (
                  <div className="mt-3">
                    <Button type="button" disabled={busy} onClick={() => setModal({ kind: "start-run" })}>
                      Start Run
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            {closedRuns.length ? (
              <div className="mt-3">
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline"
                  onClick={() => setShowRunHistory((v) => !v)}
                >
                  {showRunHistory ? "Hide" : "Show"} run history ({closedRuns.length})
                </button>
                {showRunHistory ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {closedRuns.map((r) => (
                      <li key={r.id}>
                        {r.workOrderDocNo || `WO ${r.workOrderId}`} — {formatIndiaDateTime(r.startedAt)} →{" "}
                        {formatIndiaDateTime(r.closedAt)}
                        {r.closeReason ? ` · ${r.closeReason}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>

          <div
            className={cn(
              "rounded-xl border bg-white p-4 shadow-sm",
              openDt ? "border-red-200" : "border-slate-200",
            )}
          >
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Downtime</h2>
            {continuedBanner && openDowntime?.canContinueIntoCurrentSession && showLiveManager ? (
              <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <p className="font-medium">Downtime continued from previous shift</p>
                <p className="mt-1 text-xs">
                  {downtimeReasonLabel(openDowntime.reason)} since {formatIndiaDateTime(openDowntime.startedAt)}
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="mt-2"
                  disabled={busy}
                  onClick={() =>
                    void runAction(
                      () => continueShiftDowntime(session.id, { incidentId: openDowntime.incidentId }),
                      "Downtime continued into this shift.",
                    )
                  }
                >
                  Continue into this shift
                </Button>
              </div>
            ) : null}

            {openDt ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                {(openDowntime?.continuedFromPriorShift ||
                  (openDt.segments?.length ?? 0) > 1 ||
                  (openDowntime && openDowntime.latestSegment?.sessionId !== session.id)) && (
                  <p className="mb-2 text-xs font-medium text-red-800">Downtime continued from previous shift</p>
                )}
                <div className="text-base font-semibold text-red-900">{downtimeReasonLabel(openDt.reason)}</div>
                <p className="mt-1 text-sm text-red-800">
                  Since {formatIndiaDateTime(openDt.startedAt)} · {formatElapsed(openDt.startedAt, nowMs)}
                </p>
                {showPauseProduction ? (
                  <Button
                    type="button"
                    className="mt-3 bg-teal-700 hover:bg-teal-800"
                    disabled={busy}
                    onClick={() =>
                      void runAction(
                        () => resumeShiftDowntime(session.id, { incidentId: openDt.id }),
                        "Production resumed.",
                      )
                    }
                  >
                    Resume Production
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No open downtime on this shift.</p>
            )}

            {(session.downtimeIncidents?.length ?? 0) > 0 ? (
              <div className="mt-3">
                <button
                  type="button"
                  className="text-xs font-medium text-slate-600 underline"
                  onClick={() => setShowDtHistory((v) => !v)}
                >
                  {showDtHistory ? "Hide" : "Show"} downtime history
                </button>
                {showDtHistory ? (
                  <ul className="mt-2 space-y-1 text-xs text-slate-500">
                    {session.downtimeIncidents.map((inc) => (
                      <li key={inc.id}>
                        {downtimeReasonLabel(inc.reason)} — {formatIndiaDateTime(inc.startedAt)}
                        {inc.endedAt ? ` → ${formatIndiaDateTime(inc.endedAt)}` : " (open)"}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>

      {isShiftOver || isCancelled ? (
        <section className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="shift-summary">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {isCancelled ? "Cancelled Shift" : "Shift Summary"}
          </h2>
          <p className="mt-2 text-sm text-slate-800">
            {session.shiftSessionNo} · {machineDisplayName(session.machine)} · {shiftDisplayLabel(session.shift)}
          </p>
          {isCancelled ? (
            <p className="mt-1 text-sm text-slate-700">
              Reason: <span className="font-medium">{session.cancellationReason || "—"}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-slate-700">
              Handover: <span className="font-medium">{handoverStateLabel(session.handoverState)}</span>
              {session.handoverRemarks ? ` — ${session.handoverRemarks}` : ""}
            </p>
          )}
          <p className="mt-1 text-sm text-slate-600">
            Started {formatIndiaDateTime(session.startedAt)} · Ended {formatIndiaDateTime(session.endedAt)}
          </p>
        </section>
      ) : null}

      {!isCancelled ? (
        <>
      <div className="mt-4" ref={reportSectionRef}>
        <ShiftReportPanel
          session={session}
          caps={caps}
          busy={busy}
          onBusy={setBusy}
          onNotice={setNotice}
          onRefresh={refresh}
          hideZeroProduction={Boolean(activeRun)}
          hidePrepareReportHint={Boolean(activeRun)}
        />
      </div>

      {isShiftOver ? (
        <div className="mt-4 space-y-4">
          <ShiftReportAdjustmentPanel
            session={session}
            caps={caps}
            busy={busy}
            onBusy={setBusy}
            onNotice={setNotice}
            onRefresh={refresh}
          />
          <ShiftReopenPanel
            session={session}
            caps={caps}
            busy={busy}
            onBusy={setBusy}
            onNotice={setNotice}
            onRefresh={refresh}
            onReopened={() => {
              void refresh();
              window.setTimeout(() => scrollToReport(), 100);
            }}
          />
        </div>
      ) : null}

      <ShiftOverModal
        open={shiftOverOpen}
        sessionId={session.id}
        hasOpenDowntime={Boolean(openDt)}
        onClose={() => setShiftOverOpen(false)}
        onCompleted={() => {
          setNotice("Shift Over completed.");
          void refresh();
        }}
      />
        </>
      ) : null}

      <CancelShiftModal
        open={cancelOpen}
        sessionId={session.id}
        shiftSessionNo={session.shiftSessionNo}
        onClose={() => setCancelOpen(false)}
        onCancelled={() => {
          navigate(listBackHref);
        }}
      />

      {/* Action modals */}
      {modal?.kind === "join" ? (
        <ErpModal open onClose={() => !busy && setModal(null)} aria-label="Join operator" className="items-start justify-center pt-8">
          <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Join operator</h3>
            <Input
              className="mt-3"
              type="search"
              placeholder="Search…"
              value={joinQuery}
              onChange={(e) => setJoinQuery(e.target.value)}
              disabled={busy}
            />
            <NativeSelect
              className="mt-2"
              value={joinOperatorId}
              onChange={(e) => setJoinOperatorId(e.target.value)}
              disabled={busy}
            >
              <option value="">Select operator</option>
              {joinCandidates.map((o) => (
                <option key={o.id} value={o.id}>
                  {operatorDisplayName(o)}
                </option>
              ))}
            </NativeSelect>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Reason (optional)</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !joinOperatorId}
                onClick={() =>
                  void runAction(
                    () =>
                      joinShiftOperator(session.id, {
                        operatorId: Number(joinOperatorId),
                        changeReason: reason || null,
                      }),
                    "Operator joined.",
                  )
                }
              >
                {busy ? "Saving…" : "Join"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}

      {modal?.kind === "leave" || modal?.kind === "primary" || modal?.kind === "close-run" ? (
        <ErpModal open onClose={() => !busy && setModal(null)} aria-label="Confirm action" className="items-start justify-center pt-8">
          <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">
              {modal.kind === "leave" && `Leave — ${modal.name}`}
              {modal.kind === "primary" && `Change primary — ${modal.name}`}
              {modal.kind === "close-run" && "Close production run"}
            </h3>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Reason (required)</span>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !reason.trim()}
                onClick={() => {
                  if (modal.kind === "leave") {
                    void runAction(
                      () =>
                        leaveShiftOperator(session.id, {
                          operatorId: modal.operatorId,
                          changeReason: reason.trim(),
                        }),
                      "Operator left the shift.",
                    );
                  } else if (modal.kind === "primary") {
                    void runAction(
                      () =>
                        changeShiftPrimaryOperator(session.id, {
                          newPrimaryOperatorId: modal.operatorId,
                          changeReason: reason.trim(),
                          keepPreviousPrimary: true,
                        }),
                      "Primary operator updated.",
                    );
                  } else {
                    void runAction(
                      () =>
                        closeShiftRunSegment(session.id, {
                          segmentId: activeRun?.id,
                          closeReason: reason.trim(),
                        }),
                      "Run closed.",
                    );
                  }
                }}
              >
                {busy ? "Saving…" : "Confirm"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}

      {modal?.kind === "start-run" ? (
        <ErpModal open onClose={() => !busy && setModal(null)} aria-label="Start run" className="items-start justify-center pt-8">
          <div className="mx-auto w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold">Start production run</h3>
            <p className="mt-1 text-sm text-slate-600">Choose an eligible planned run for this machine.</p>
            <NativeSelect
              className="mt-3"
              value={selectedRunId}
              onChange={(e) => setSelectedRunId(e.target.value)}
              disabled={busy}
            >
              <option value="">Select work order / run</option>
              {eligibleRuns.map((r) => (
                <option key={r.runAllocationId} value={r.runAllocationId}>
                  {(r.workOrderNo || `WO ${r.workOrderId}`) +
                    " · " +
                    (r.itemName || "Item") +
                    (r.productionFlow ? ` · ${r.productionFlow}` : "")}
                </option>
              ))}
            </NativeSelect>
            {!eligibleRuns.length ? (
              <p className="mt-2 text-xs text-amber-800">No eligible planned runs for this machine right now.</p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={busy || !selectedRunId}
                onClick={() =>
                  void runAction(
                    () =>
                      startShiftRunSegment(session.id, {
                        runAllocationId: Number(selectedRunId),
                      }),
                    "Production run started.",
                  )
                }
              >
                {busy ? "Starting…" : "Start Run"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}

      {modal?.kind === "pause" ? (
        <ErpModal open onClose={() => !busy && setModal(null)} aria-label="Pause production" className="items-start justify-center pt-8">
          <div className="mx-auto w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <h3 className="text-lg font-semibold text-red-900">Pause production</h3>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Reason</span>
              <NativeSelect value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} disabled={busy}>
                {DOWNTIME_REASON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block font-medium">Remarks (optional)</span>
              <Input value={pauseRemarks} onChange={(e) => setPauseRemarks(e.target.value)} disabled={busy} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || !!openDt}
                onClick={() =>
                  void runAction(
                    () =>
                      pauseShiftDowntime(session.id, {
                        reason: pauseReason,
                        remarks: pauseRemarks || null,
                      }),
                    "Production paused.",
                  )
                }
              >
                {busy ? "Pausing…" : "Pause Production"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </PageContainer>
  );
}
