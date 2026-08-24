import * as React from "react";
import { useNavigate } from "react-router-dom";
import { PageContainer } from "../components/PageHeader";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { useAuth } from "../hooks/useAuth";
import { fetchMachines, type MachineRow } from "../lib/machineApi";
import { fetchOperators, type OperatorRow } from "../lib/operatorApi";
import { fetchShifts, type ShiftRow } from "../lib/shiftApi";
import {
  fetchOpenShiftSession,
  fetchShiftCapabilities,
  type ShiftCapabilities,
  type ShiftSessionDetail,
} from "../lib/machineShiftSessionApi";
import {
  canShowManagerControls,
  deriveMachineShiftUiStatus,
  findActiveRun,
  machineDisplayName,
  machineShiftStatusLabel,
  machineShiftStatusTone,
  mapShiftApiError,
  operatorDisplayName,
  shiftDisplayLabel,
} from "../lib/machineShiftSessionUi";
import { StartShiftModal } from "../components/erp/shiftProduction/StartShiftModal";
import { cn } from "../lib/utils";

type MachineCardState = {
  machine: MachineRow;
  session: ShiftSessionDetail | null;
  loading: boolean;
  error: string | null;
};

function toneToBadge(tone: ReturnType<typeof machineShiftStatusTone>) {
  if (tone === "success") return "success" as const;
  if (tone === "danger") return "rejected" as const;
  if (tone === "warning") return "warning" as const;
  return "default" as const;
}

export function ShiftProductionPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [caps, setCaps] = React.useState<ShiftCapabilities | null>(null);
  const [machines, setMachines] = React.useState<MachineRow[]>([]);
  const [operators, setOperators] = React.useState<OperatorRow[]>([]);
  const [shifts, setShifts] = React.useState<ShiftRow[]>([]);
  const [cards, setCards] = React.useState<MachineCardState[]>([]);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [startMachine, setStartMachine] = React.useState<MachineRow | null>(null);

  const showManager = canShowManagerControls(caps);

  const load = React.useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [capRes, machRows, opRows, shiftRows] = await Promise.all([
        fetchShiftCapabilities(),
        fetchMachines(false),
        fetchOperators(false),
        fetchShifts(false),
      ]);
      setCaps(capRes);
      const activeMachines = machRows.filter((m) => m.isActive);
      setMachines(activeMachines);
      setOperators(opRows);
      setShifts(shiftRows);
      setCards(activeMachines.map((m) => ({ machine: m, session: null, loading: true, error: null })));

      const settled = await Promise.all(
        activeMachines.map(async (m) => {
          try {
            const { session } = await fetchOpenShiftSession(m.id);
            return { machine: m, session, loading: false, error: null as string | null };
          } catch (e) {
            return { machine: m, session: null, loading: false, error: mapShiftApiError(e) };
          }
        }),
      );
      setCards(settled);
    } catch (e) {
      setPageError(mapShiftApiError(e, "Unable to load Shift Production."));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <PageContainer>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Shift Production</h1>
          <p className="mt-1 text-sm text-slate-600">Start and operate machine shift sessions on the floor.</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {caps?.isFallbackControl ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          Production Manager is not assigned. You have temporary shift control.
        </div>
      ) : null}

      {pageError ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{pageError}</div>
      ) : null}

      {loading && !cards.length ? <p className="text-sm text-slate-500">Loading machines…</p> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const status = deriveMachineShiftUiStatus(card.session);
          const tone = machineShiftStatusTone(status);
          const activeRun = findActiveRun(card.session);
          const open = Boolean(card.session && String(card.session.status).toUpperCase() === "OPEN");

          return (
            <article
              key={card.machine.id}
              className={cn(
                "flex flex-col rounded-xl border bg-white p-4 shadow-sm",
                status === "DOWNTIME" && "border-red-200",
                status === "PRODUCTION_RUNNING" && "border-teal-200",
                status === "SHIFT_ACTIVE" && "border-emerald-200",
                status === "NO_ACTIVE" && "border-slate-200",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-900">{machineDisplayName(card.machine)}</h2>
                  <p className="text-xs text-slate-500">{card.machine.machineTypeLabel || card.machine.machineType}</p>
                </div>
                <Badge variant={toneToBadge(tone)}>{machineShiftStatusLabel(status)}</Badge>
              </div>

              <dl className="mt-3 grid gap-1.5 text-sm text-slate-700">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Session</dt>
                  <dd className="font-medium">{open ? card.session?.shiftSessionNo : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Shift</dt>
                  <dd className="text-right">{open ? shiftDisplayLabel(card.session?.shift) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Primary</dt>
                  <dd className="truncate text-right">{open ? operatorDisplayName(card.session?.primaryOperator) : "—"}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Current WO</dt>
                  <dd className="truncate text-right">
                    {activeRun ? activeRun.workOrderDocNo || `WO ${activeRun.workOrderId}` : "—"}
                  </dd>
                </div>
              </dl>

              {card.error ? <p className="mt-2 text-xs text-red-700">{card.error}</p> : null}

              <div className="mt-4 flex flex-1 items-end">
                {open && card.session ? (
                  <Button
                    type="button"
                    className="w-full bg-teal-700 hover:bg-teal-800"
                    onClick={() => navigate(`/shift-production/sessions/${card.session!.id}`)}
                  >
                    Open Active Shift
                  </Button>
                ) : showManager ? (
                  <Button
                    type="button"
                    className="w-full"
                    variant="secondary"
                    disabled={card.loading}
                    onClick={() => setStartMachine(card.machine)}
                  >
                    Start Shift
                  </Button>
                ) : (
                  <p className="w-full rounded-md bg-slate-50 px-3 py-2 text-center text-xs text-slate-600">
                    Waiting for Production Manager to start the shift.
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {!loading && !machines.length ? (
        <p className="mt-6 text-sm text-slate-600">No active machines found. Add machines in Masters first.</p>
      ) : null}

      {startMachine ? (
        <StartShiftModal
          open
          machine={startMachine}
          shifts={shifts}
          operators={operators}
          onClose={() => setStartMachine(null)}
          onStarted={(sessionId) => {
            setStartMachine(null);
            navigate(`/shift-production/sessions/${sessionId}`);
          }}
        />
      ) : null}

      <span className="sr-only">{auth.user?.role}</span>
    </PageContainer>
  );
}
