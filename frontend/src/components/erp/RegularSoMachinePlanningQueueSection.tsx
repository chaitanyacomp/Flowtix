/**
 * REGULAR_SO machine planning queue for Production Flow → Requirement & Cycle Planning.
 * Operational fields only — no commercial prices/margins.
 * Distinguishes: needs planning vs completed and handed to Store (RM may still be short).
 * NO_QTY cycle planning remains separate on the same hub page.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../../services/api";
import { Button, buttonVariants } from "../ui/button";
import { Badge } from "../ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { cn } from "../../lib/utils";
import { woMachinePlanningHref, woPreparePrepareHref } from "../../lib/woPrepareOperationalStage";
import { regularSoMachinePlanningRmLabel } from "../../lib/regularSoMachinePlanningRmLabel";
import { useAuth } from "../../hooks/useAuth";
import { WO_MACHINE_RUN_WRITE_ROLES, hasErpRole } from "../../config/erpRoles";

type QueueItem = {
  salesOrderId: number;
  salesOrderDocNo: string | null;
  fgItemName: string | null;
  plannedQty: number;
  requiredDeliveryDate: string | null;
  approvedBomRevision: string | null;
  machinePlanningStatus: string;
  machinePlanningLabel: string;
  machinePlanningIssues?: string[];
  machinePlanningComplete?: boolean;
  productionRunCount: number;
  plannedPurgeCount: number;
  storeOperationalKey?: string | null;
  storeOperationalLabel?: string | null;
  rmReadinessSummary?: {
    canCreateWorkOrder?: boolean;
    shortageRmCount?: number;
    woBlockReason?: string | null;
    storeOperationalKey?: string;
    storeOperationalLabel?: string;
    requiredQtyTotal?: number;
    availableQtyTotal?: number;
    shortageQtyTotal?: number;
  } | null;
};

function statusBadge(status: string) {
  if (status === "MACHINE_PLANNING_IN_PROGRESS") {
    return { label: "In progress", variant: "warning" as const };
  }
  if (status === "MACHINE_PLANNING_AWAITING_COMPLETION") {
    return { label: "Awaiting completion", variant: "warning" as const };
  }
  if (status === "MACHINE_PLANNING_COMPLETE") {
    return { label: "Handed to Store", variant: "success" as const };
  }
  return { label: "Pending", variant: "default" as const };
}

function QueueTable({
  rows,
  action,
}: {
  rows: QueueItem[];
  action: "plan" | "view";
}) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2 font-medium">SO</th>
            <th className="px-3 py-2 font-medium">FG</th>
            <th className="px-3 py-2 font-medium">Planned qty</th>
            <th className="px-3 py-2 font-medium">Delivery</th>
            <th className="px-3 py-2 font-medium">BOM</th>
            <th className="px-3 py-2 font-medium">Machine planning</th>
            <th className="px-3 py-2 font-medium">Store / RM</th>
            <th className="px-3 py-2 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const badge = statusBadge(row.machinePlanningStatus);
            return (
              <tr key={row.salesOrderId} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-900">
                  {row.salesOrderDocNo || `#${row.salesOrderId}`}
                </td>
                <td className="px-3 py-2 text-slate-800">{row.fgItemName || "—"}</td>
                <td className="px-3 py-2 tabular-nums text-slate-800">
                  {Number.isFinite(row.plannedQty) ? row.plannedQty : "—"}
                </td>
                <td className="px-3 py-2 text-slate-700">{row.requiredDeliveryDate || "—"}</td>
                <td className="px-3 py-2 text-slate-700">{row.approvedBomRevision || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </td>
                <td className="px-3 py-2 text-slate-700">{regularSoMachinePlanningRmLabel(row)}</td>
                <td className="px-3 py-2">
                  {action === "plan" ? (
                    <Link
                      to={woMachinePlanningHref(row.salesOrderId)}
                      className={cn(buttonVariants({ size: "sm" }), "no-underline")}
                      data-testid={`plan-machine-runs-${row.salesOrderId}`}
                    >
                      Plan Machine Runs
                    </Link>
                  ) : (
                    <Link
                      to={woPreparePrepareHref(row.salesOrderId, { intent: "machine-planning" })}
                      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "no-underline")}
                      data-testid={`view-handed-so-${row.salesOrderId}`}
                    >
                      View Plan
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function RegularSoMachinePlanningQueueSection() {
  const { user } = useAuth();
  const canPlan = hasErpRole(user?.role, WO_MACHINE_RUN_WRITE_ROLES);
  const [needsPlanning, setNeedsPlanning] = React.useState<QueueItem[]>([]);
  const [handedToStore, setHandedToStore] = React.useState<QueueItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!canPlan) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{
        needsPlanning?: QueueItem[];
        handedToStore?: QueueItem[];
        items?: QueueItem[];
      }>("/api/production/regular-so-machine-planning-queue?limit=80");
      setNeedsPlanning(
        Array.isArray(data?.needsPlanning)
          ? data.needsPlanning
          : Array.isArray(data?.items)
            ? data.items
            : [],
      );
      setHandedToStore(Array.isArray(data?.handedToStore) ? data.handedToStore : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load machine planning queue.");
      setNeedsPlanning([]);
      setHandedToStore([]);
    } finally {
      setLoading(false);
    }
  }, [canPlan]);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (!canPlan) return null;

  const empty = !loading && !needsPlanning.length && !handedToStore.length && !error;

  return (
    <Card className="border-slate-200 shadow-sm" data-testid="regular-so-machine-planning-queue">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Regular SO — Machine planning</CardTitle>
            <p className="mt-1 text-sm text-slate-600">
              Plan machine runs first. Completed planning is handed to Store even when RM is short —
              shortage does not return the SO to Production.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
        {loading && !needsPlanning.length && !handedToStore.length ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : null}
        {empty ? (
          <p className="text-sm text-slate-600">No Regular sales orders in machine planning right now.</p>
        ) : null}

        {needsPlanning.length > 0 ? (
          <div className="space-y-2" data-testid="machine-planning-needs-section">
            <h3 className="text-sm font-semibold text-slate-900">Needs machine planning</h3>
            <p className="text-[11px] text-slate-600">Pending or in-progress allocations — Production action.</p>
            <QueueTable rows={needsPlanning} action="plan" />
          </div>
        ) : null}

        {handedToStore.length > 0 ? (
          <div className="space-y-2" data-testid="machine-planning-handed-section">
            <h3 className="text-sm font-semibold text-slate-900">Completed — Handed to Store</h3>
            <p className="text-[11px] text-slate-600">
              Machine planning is valid. Store owns RM shortage / Ready for WO. Use View Plan for read-only
              allocations.
            </p>
            <QueueTable rows={handedToStore} action="view" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
