/**
 * REGULAR work order — hold, resume, close with shortfall (operational controls).
 */
import * as React from "react";
import { PauseCircle, PlayCircle, Ban } from "lucide-react";
import { apiFetch } from "../../services/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { useToast } from "../../contexts/ToastContext";
import {
  WO_HOLD_REASONS,
  workOrderStatusDisplayLabel,
  workOrderStatusBadgeVariant,
  canHoldWorkOrder,
  canResumeWorkOrder,
  canCloseWorkOrderShortfall,
  type WoHoldReason,
} from "../../lib/workOrderLifecycle";

export type WorkOrderLifecycleWo = {
  id: number;
  docNo?: string | null;
  status: string;
  holdReason?: string | null;
  holdRemarks?: string | null;
  shortfallQty?: number | string | null;
  closureReason?: string | null;
  lines?: Array<{ qty: string | number; approvedProducedQty?: number; remainingQty?: number }>;
};

type Props = {
  wo: WorkOrderLifecycleWo;
  onUpdated: () => void;
  className?: string;
};

export function WorkOrderLifecyclePanel({ wo, onUpdated, className }: Props) {
  const { showSuccess, showError } = useToast();
  const [holdReason, setHoldReason] = React.useState<WoHoldReason>("RM_SHORTAGE");
  const [holdRemarks, setHoldRemarks] = React.useState("");
  const [closureReason, setClosureReason] = React.useState("");
  const [busy, setBusy] = React.useState<"hold" | "resume" | "close" | null>(null);

  async function post(path: string, body?: object) {
    await apiFetch(`/api/production/work-orders/${wo.id}${path}`, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  return (
    <div className={className ?? "rounded-lg border border-slate-200 bg-slate-50/90 p-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Work order status</h3>
          <p className="text-[11px] text-slate-600">Pause, resume, or close remaining balance (REGULAR only).</p>
        </div>
        <Badge variant={workOrderStatusBadgeVariant(wo.status)} className="text-[11px]">
          {workOrderStatusDisplayLabel(wo)}
        </Badge>
      </div>

      {wo.shortfallQty != null && Number(wo.shortfallQty) > 0 ? (
        <p className="mt-2 text-[12px] text-slate-700">
          Recorded shortfall:{" "}
          <span className="font-semibold tabular-nums">{Number(wo.shortfallQty)}</span> (planned qty unchanged)
        </p>
      ) : null}

      {canHoldWorkOrder(wo.status) ? (
        <div className="mt-3 space-y-2 rounded border border-amber-200 bg-white p-2">
          <div className="text-[12px] font-medium text-slate-800">Place on hold</div>
          <select
            className="erp-select h-8 w-full text-[13px]"
            value={holdReason}
            onChange={(e) => setHoldReason(e.target.value as WoHoldReason)}
          >
            {WO_HOLD_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <Input
            className="h-8 text-[13px]"
            placeholder="Remarks (optional)"
            value={holdRemarks}
            onChange={(e) => setHoldRemarks(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 text-[12px]"
            disabled={busy != null}
            onClick={() => {
              setBusy("hold");
              void post("/hold", { holdReason, remarks: holdRemarks || null })
                .then(() => {
                  showSuccess("Work order placed on hold.");
                  onUpdated();
                })
                .catch((e) => showError(e instanceof Error ? e.message : "Hold failed"))
                .finally(() => setBusy(null));
            }}
          >
            <PauseCircle className="h-3.5 w-3.5" />
            {busy === "hold" ? "Saving…" : "Hold work order"}
          </Button>
        </div>
      ) : null}

      {canResumeWorkOrder(wo.status) ? (
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1 text-[12px]"
            disabled={busy != null}
            onClick={() => {
              setBusy("resume");
              void post("/resume")
                .then(() => {
                  showSuccess("Work order resumed.");
                  onUpdated();
                })
                .catch((e) => showError(e instanceof Error ? e.message : "Resume failed"))
                .finally(() => setBusy(null));
            }}
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {busy === "resume" ? "Resuming…" : wo.status === "PAUSED" ? "Resume Production" : "Resume production"}
          </Button>
        </div>
      ) : null}

      {canCloseWorkOrderShortfall(wo.status) ? (
        <div className="mt-3 space-y-2 rounded border border-sky-200 bg-white p-2">
          <div className="text-[12px] font-medium text-slate-800">Close with shortfall</div>
          <p className="text-[11px] text-slate-600">
            Stops remaining balance. Original planned qty and produced qty are kept for audit.
          </p>
          <Input
            className="h-8 text-[13px]"
            placeholder="Closure reason (required)"
            value={closureReason}
            onChange={(e) => setClosureReason(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1 border-sky-300 text-[12px] text-sky-900"
            disabled={busy != null || closureReason.trim().length < 3}
            onClick={() => {
              setBusy("close");
              void post("/close-shortfall", { closureReason: closureReason.trim() })
                .then(() => {
                  showSuccess("Work order closed with shortfall.");
                  onUpdated();
                })
                .catch((e) => showError(e instanceof Error ? e.message : "Close failed"))
                .finally(() => setBusy(null));
            }}
          >
            <Ban className="h-3.5 w-3.5" />
            {busy === "close" ? "Closing…" : "Close remaining balance"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
