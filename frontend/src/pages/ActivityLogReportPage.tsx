import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { PageContainer, ReportPageHeader } from "../components/PageHeader";
import { apiFetch } from "../services/api";
import { useUrlQueryState } from "../hooks/useUrlQueryState";

type Actor = { id: number; name: string; email: string };

type Row = {
  id: number;
  createdAt: string;
  userName: string;
  role: string | null;
  module: string | null;
  action: string;
  referenceType: string | null;
  referenceId: string | null;
  referenceNo: string | null;
  summary: string;
  oldStatus: string | null;
  newStatus: string | null;
  reason: string | null;
};

type ApiResp = {
  meta: {
    fromDate: string;
    toDate: string;
    actorUserId: number | null;
    module: string | null;
    action: string | null;
    refType: string | null;
    page: number;
    pageSize: number;
    totalRaw: number;
  };
  total: number;
  rows: Row[];
};

function todayYmd(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toCsv(rows: Row[]): string {
  const header = [
    "Date & Time",
    "User",
    "Role",
    "Module",
    "Action",
    "Reference Type",
    "Reference No",
    "Reference ID",
    "Summary",
    "Old Status",
    "New Status",
    "Reason/Remarks",
  ];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      fmtWhen(r.createdAt),
      r.userName,
      r.role ?? "",
      r.module ?? "",
      r.action,
      r.referenceType ?? "",
      r.referenceNo ?? "",
      r.referenceId ?? "",
      r.summary,
      r.oldStatus ?? "",
      r.newStatus ?? "",
      r.reason ?? "",
    ].map(esc).join(","),
  );
  return [header.map(esc).join(","), ...lines].join("\n");
}

const MODULES = ["", "SALES", "PURCHASE", "STOCK", "PRODUCTION", "QC", "DISPATCH", "REPORTS", "SETTINGS", "SESSION", "ADMIN"] as const;
const ACTIONS = ["", "CREATE", "UPDATE", "DELETE", "APPROVE", "REVERSE", "CANCEL", "REJECT", "EXPORT", "OVERRIDE", "LOGIN", "LOGOUT", "LOGIN_FAILED"] as const;
const REF_TYPES = ["", "SO", "WO", "RM_PO", "GRN", "PURCHASE_BILL", "SALES_BILL", "DISPATCH", "PRODUCTION", "QC", "STOCK_ADJUSTMENT", "TALLY_EXPORT", "EXPORT_HISTORY"] as const;

export function ActivityLogReportPage() {
  const { patch, read } = useUrlQueryState({
    fromDate: ymdDaysAgo(7),
    toDate: todayYmd(),
    actorUserId: "",
    module: "",
    action: "",
    refType: "",
  });

  const fromDate = read.string("fromDate");
  const toDate = read.string("toDate");
  const actorUserId = read.int("actorUserId");
  const module = read.string("module", "");
  const action = read.string("action", "");
  const refType = read.string("refType", "");

  const [actors, setActors] = React.useState<Actor[]>([]);
  const [data, setData] = React.useState<ApiResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const missingDates = !fromDate.trim() || !toDate.trim();

  React.useEffect(() => {
    apiFetch<Actor[]>("/api/activity/actors").then(setActors).catch(() => setActors([]));
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("fromDate", fromDate);
      qs.set("toDate", toDate);
      if (actorUserId && actorUserId > 0) qs.set("actorUserId", String(actorUserId));
      if (module) qs.set("module", module);
      if (action) qs.set("action", action);
      if (refType) qs.set("refType", refType);
      const resp = await apiFetch<ApiResp>(`/api/reports/activity-log?${qs.toString()}`);
      setData(resp);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : "Could not load activity log.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (missingDates) {
      setLoading(false);
      setData(null);
      setLoadError(null);
      return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, actorUserId, module, action, refType]);

  const rows = data?.rows ?? [];

  function downloadCsv() {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `activity-log_${fromDate}_to_${toDate}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <PageContainer className="pb-8">
      <ReportPageHeader
        title="User Activity Log"
        purpose="Audit-friendly view of who changed what, when, and on which document."
        actions={
          <Button type="button" variant="outline" size="sm" disabled={!rows.length || missingDates} onClick={downloadCsv}>
            Download CSV
          </Button>
        }
      />

      {missingDates ? (
        <div className="rounded-md border border-sky-200/90 bg-sky-50/90 px-3 py-2 text-sm text-slate-700">
          Select both <span className="font-medium text-slate-900">From date</span> and{" "}
          <span className="font-medium text-slate-900">To date</span> to view this report.
        </div>
      ) : null}

      {loadError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div> : null}

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            From date
            <Input type="date" value={fromDate} onChange={(e) => patch({ fromDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            To date
            <Input type="date" value={toDate} onChange={(e) => patch({ toDate: e.target.value || null })} />
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            User
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
              value={actorUserId || ""}
              onChange={(e) => patch({ actorUserId: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">All users</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email || `User #${a.id}`}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Module
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={module} onChange={(e) => patch({ module: e.target.value || null })}>
              {MODULES.map((m) => (
                <option key={m} value={m}>
                  {m ? m : "All modules"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Action
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={action} onChange={(e) => patch({ action: e.target.value || null })}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a ? a : "All actions"}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-slate-600">
            Reference type
            <select className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm" value={refType} onChange={(e) => patch({ refType: e.target.value || null })}>
              {REF_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t ? t : "All reference types"}
                </option>
              ))}
            </select>
          </label>
        </CardContent>
      </Card>

      <Card className="mt-3 border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-800">Results</CardTitle>
        </CardHeader>
        <CardContent className="overflow-auto">
          {missingDates ? (
            <div className="py-6 text-sm text-slate-600">
              Choose <span className="font-medium text-slate-800">From date</span> and <span className="font-medium text-slate-800">To date</span> in Filters to load the activity log.
            </div>
          ) : loading ? (
            <div className="py-6 text-sm text-slate-600">Loading…</div>
          ) : !rows.length ? (
            <div className="py-6 text-sm text-slate-600">No activity found for the selected filters.</div>
          ) : (
            <table className="min-w-[1200px] border-collapse text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-600">
                  <th className="border-b border-slate-200 px-2 py-2">Date &amp; time</th>
                  <th className="border-b border-slate-200 px-2 py-2">User</th>
                  <th className="border-b border-slate-200 px-2 py-2">Role</th>
                  <th className="border-b border-slate-200 px-2 py-2">Module</th>
                  <th className="border-b border-slate-200 px-2 py-2">Action</th>
                  <th className="border-b border-slate-200 px-2 py-2">Ref type</th>
                  <th className="border-b border-slate-200 px-2 py-2">Ref no</th>
                  <th className="border-b border-slate-200 px-2 py-2">Summary</th>
                  <th className="border-b border-slate-200 px-2 py-2">Old → New</th>
                  <th className="border-b border-slate-200 px-2 py-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="border-b border-slate-100 px-2 py-2 align-top whitespace-nowrap">{fmtWhen(r.createdAt)}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.userName}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.role ?? "—"}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.module ?? "—"}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.action}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.referenceType ?? "—"}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">
                      <div className="font-mono text-xs text-slate-800">{r.referenceNo ?? r.referenceId ?? "—"}</div>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.summary}</td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top whitespace-nowrap">
                      {r.oldStatus || r.newStatus ? `${r.oldStatus ?? "—"} → ${r.newStatus ?? "—"}` : "—"}
                    </td>
                    <td className="border-b border-slate-100 px-2 py-2 align-top">{r.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}

