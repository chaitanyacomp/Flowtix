import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { apiFetch } from "../services/api";

export type ActivityLogRow = {
  id: number;
  createdAt: string;
  userNameSnapshot: string | null;
  message: string;
  reason: string | null;
  action: string;
  module: string;
};

type Props = {
  title?: string;
  /** e.g. `entityType=SALES_ORDER&entityId=12&limit=50` or `salesOrderId=5&limit=50` */
  query: string;
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function ActivityHistoryCard({ title = "History", query }: Props) {
  const [rows, setRows] = React.useState<ActivityLogRow[] | "loading" | "error">("loading");
  const [errMsg, setErrMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setRows("loading");
    setErrMsg(null);
    apiFetch<{ rows: ActivityLogRow[] }>(`/api/activity-logs?${query}`)
      .then((r) => {
        if (!cancelled) setRows(Array.isArray(r.rows) ? r.rows : []);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e && typeof e === "object" && "message" in e ? String((e as any).message) : "Could not load history.";
        setErrMsg(msg);
        setRows("error");
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-900">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {rows === "loading" ? <p className="text-sm text-slate-600">Loading…</p> : null}
        {rows === "error" ? <p className="text-sm text-amber-800">{errMsg || "Could not load history."}</p> : null}
        {Array.isArray(rows) && rows.length === 0 ? <p className="text-sm text-slate-600">No activity yet.</p> : null}
        {Array.isArray(rows) && rows.length > 0 ? (
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="py-2.5 first:pt-0">
                <div className="text-xs text-slate-500">
                  {formatTime(r.createdAt)}
                  {r.userNameSnapshot ? <span className="text-slate-600"> — {r.userNameSnapshot}</span> : null}
                </div>
                <div className="mt-0.5 text-sm text-slate-900">{r.message}</div>
                {r.reason ? <div className="mt-1 text-xs text-slate-600">Reason: {r.reason}</div> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
