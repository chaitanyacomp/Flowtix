import * as React from "react";
import { Check, Circle } from "lucide-react";
import { apiFetch } from "../../services/api";
import type { ActivityLogRow } from "../ActivityHistoryCard";
import { cn } from "../../lib/utils";

type Milestone = {
  key: string;
  label: string;
  at?: string | null;
  by?: string | null;
  done: boolean;
};

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function pickLatestLog(rows: ActivityLogRow[], patterns: RegExp[]): ActivityLogRow | null {
  for (const row of rows) {
    const hay = `${row.action} ${row.message}`.toLowerCase();
    if (patterns.some((p) => p.test(hay))) return row;
  }
  return null;
}

export function SalesBillActivityTimeline({
  billId,
  createdAt,
  updatedAt,
  finalizedAt,
  exportedAt,
  exportedByName,
  cancelledAt,
  className,
}: {
  billId: number;
  createdAt?: string | null;
  updatedAt?: string | null;
  finalizedAt?: string | null;
  exportedAt?: string | null;
  exportedByName?: string | null;
  cancelledAt?: string | null;
  className?: string;
}) {
  const [logs, setLogs] = React.useState<ActivityLogRow[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    apiFetch<{ rows: ActivityLogRow[] }>(`/api/activity-logs?entityType=SALES_BILL&entityId=${billId}&limit=50`)
      .then((r) => {
        if (!cancelled) setLogs(Array.isArray(r.rows) ? r.rows : []);
      })
      .catch(() => {
        if (!cancelled) setLogs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [billId]);

  const createdLog = pickLatestLog(logs, [/created/i]);
  const updatedLog = pickLatestLog(logs, [/updated/i]);
  const finalizedLog = pickLatestLog(logs, [/finaliz/i]);
  const exportedLog = pickLatestLog(logs, [/export/i]);
  const cancelledLog = pickLatestLog(logs, [/cancel/i]);

  const milestones: Milestone[] = [
    {
      key: "created",
      label: "Created",
      at: createdAt ?? createdLog?.createdAt,
      by: createdLog?.userNameSnapshot,
      done: Boolean(createdAt ?? createdLog),
    },
    {
      key: "updated",
      label: "Updated",
      at: updatedAt ?? updatedLog?.createdAt,
      by: updatedLog?.userNameSnapshot,
      done: Boolean(updatedAt ?? updatedLog),
    },
    {
      key: "finalized",
      label: "Finalized",
      at: finalizedAt ?? finalizedLog?.createdAt,
      by: finalizedLog?.userNameSnapshot,
      done: Boolean(finalizedAt ?? finalizedLog),
    },
    {
      key: "exported",
      label: "Exported",
      at: exportedAt ?? exportedLog?.createdAt,
      by: exportedByName ?? exportedLog?.userNameSnapshot,
      done: Boolean(exportedAt ?? exportedLog),
    },
    ...(cancelledAt || cancelledLog
      ? [
          {
            key: "cancelled",
            label: "Cancelled",
            at: cancelledAt ?? cancelledLog?.createdAt,
            by: cancelledLog?.userNameSnapshot,
            done: true,
          },
        ]
      : []),
  ];

  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", className)} data-testid="sales-bill-activity-timeline">
      <div className="border-b border-slate-100 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">History</h3>
      </div>
      <ol className="space-y-0 px-3 py-2">
        {milestones.map((m, idx) => (
          <li key={m.key} className="relative flex gap-3 pb-4 last:pb-1">
            {idx < milestones.length - 1 ? (
              <span className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-slate-200" aria-hidden />
            ) : null}
            <span
              className={cn(
                "relative z-[1] mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
                m.done ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-400",
              )}
            >
              {m.done ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <Circle className="h-2.5 w-2.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={cn("text-[13px] font-semibold", m.done ? "text-slate-900" : "text-slate-500")}>{m.label}</div>
              {m.done ? (
                <div className="mt-0.5 text-[11px] text-slate-600">
                  <span className="tabular-nums">{formatDateTime(m.at)}</span>
                  {m.by?.trim() ? <span> · {m.by.trim()}</span> : null}
                </div>
              ) : (
                <div className="mt-0.5 text-[11px] text-slate-400">Pending</div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
