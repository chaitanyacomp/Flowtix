import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { apiFetch } from "../services/api";
import {
  actionLabel,
  buildPayloadSections,
  entityTypeLabel,
  type ActivitySection,
} from "../lib/activityFormat";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

type Actor = { id: number; name: string; email: string };

type AuditRow = {
  id: number;
  createdAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  reason: string | null;
  payload: unknown;
  actorUserId: number | null;
  actor: Actor | null;
};

type ActivityListResponse = {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

const ACTION_OPTIONS = [
  "",
  "CREATE",
  "UPDATE",
  "APPROVE",
  "REVERSE",
  "LOGIN",
  "LOGOUT",
  "LOGIN_FAILED",
  "DELETE",
  "REJECT",
  "CANCEL",
  "BLOCKED_DELETE",
] as const;

const AREA_OPTIONS = [
  { value: "ALL", label: "All areas" },
  { value: "SALES", label: "Sales" },
  { value: "PRODUCTION_QC", label: "Production & QC" },
  { value: "DISPATCH", label: "Dispatch" },
  { value: "STOCK", label: "Stock" },
  { value: "SESSION", label: "Sign-in" },
] as const;

function normalizeDateForApi(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Backend expects YYYY-MM-DD.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Accept DD-MM-YYYY (common manual entry) and normalize.
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (!Number.isFinite(dd) || !Number.isFinite(mm) || !Number.isFinite(yyyy)) return null;
  if (yyyy < 1900 || yyyy > 2100) return null;
  if (mm < 1 || mm > 12) return null;
  if (dd < 1 || dd > 31) return null;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 7);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function whoLabel(row: AuditRow): string {
  if (row.actor?.name?.trim()) return row.actor.name.trim();
  if (row.actor?.email?.trim()) return row.actor.email.trim();
  if (row.actorUserId != null) return `User #${row.actorUserId}`;
  return "—";
}

function SectionBlock({ section }: { section: ActivitySection }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{section.title}</div>
      <dl className="grid gap-1.5 sm:grid-cols-[minmax(0,12rem)_1fr] sm:gap-x-4">
        {section.rows.map((r, i) => (
          <React.Fragment key={`${section.title}-${i}`}>
            <dt className="text-sm text-slate-600">{r.label}</dt>
            <dd className="text-sm text-slate-900">{r.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </div>
  );
}

type AppliedFilters = {
  from: string;
  to: string;
  actorUserId: string;
  action: string;
  area: string;
};

export function ActivityPage() {
  const initialRange = React.useMemo(() => defaultDateRange(), []);
  const initialFilters = React.useMemo(
    (): AppliedFilters => ({
      ...initialRange,
      actorUserId: "",
      action: "",
      area: "ALL",
    }),
    [initialRange],
  );

  const [draft, setDraft] = React.useState<AppliedFilters>(initialFilters);
  const [applied, setApplied] = React.useState<AppliedFilters>(initialFilters);

  const [actors, setActors] = React.useState<Actor[]>([]);
  const [rows, setRows] = React.useState<AuditRow[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const pageSize = 50;

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState<number | null>(null);

  React.useEffect(() => {
    apiFetch<Actor[]>("/api/activity/actors")
      .then(setActors)
      .catch(() => setActors([]));
  }, []);

  const fetchActivity = React.useCallback(
    async (pageNum: number, filters: AppliedFilters) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("from", filters.from);
      params.set("to", filters.to);
      params.set("area", filters.area);
      params.set("page", String(pageNum));
      params.set("pageSize", String(pageSize));
      if (filters.actorUserId) params.set("actorUserId", filters.actorUserId);
      if (filters.action) params.set("action", filters.action);
      try {
        const data = await apiFetch<ActivityListResponse>(`/api/activity?${params.toString()}`);
        setRows(data.rows);
        setTotal(data.total);
      } catch (e) {
        setRows([]);
        setTotal(0);
        setError(e instanceof Error ? e.message : "Failed to load activity");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  React.useEffect(() => {
    setExpanded(null);
    void fetchActivity(page, applied);
  }, [fetchActivity, page, applied]);

  function onApplyFilters(e: React.FormEvent) {
    e.preventDefault();
    const from = normalizeDateForApi(draft.from);
    const to = normalizeDateForApi(draft.to);
    if (!from || !to) {
      setError("Please enter dates in a valid format (YYYY-MM-DD).");
      return;
    }
    setError(null);
    setApplied({ ...draft, from, to });
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Activity</CardTitle>
          <p className="text-sm text-slate-600">Who did what and when across the system.</p>
        </CardHeader>
        <CardContent>
          <form className="mb-4 flex flex-wrap items-end gap-3" onSubmit={onApplyFilters}>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-slate-600" htmlFor="act-from">
                From
              </label>
              <input
                id="act-from"
                type="date"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
              />
            </div>
            <div className="grid gap-1">
              <label className="text-xs font-medium text-slate-600" htmlFor="act-to">
                To
              </label>
              <input
                id="act-to"
                type="date"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
              />
            </div>
            <div className="grid min-w-[10rem] gap-1">
              <label className="text-xs font-medium text-slate-600" htmlFor="act-user">
                User
              </label>
              <select
                id="act-user"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={draft.actorUserId}
                onChange={(e) => setDraft((d) => ({ ...d, actorUserId: e.target.value }))}
              >
                <option value="">Anyone</option>
                {actors.map((a) => (
                  <option key={a.id} value={String(a.id)}>
                    {a.name || a.email}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-[9rem] gap-1">
              <label className="text-xs font-medium text-slate-600" htmlFor="act-action">
                Action
              </label>
              <select
                id="act-action"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={draft.action}
                onChange={(e) => setDraft((d) => ({ ...d, action: e.target.value }))}
              >
                <option value="">All actions</option>
                {ACTION_OPTIONS.filter(Boolean).map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(a)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid min-w-[11rem] gap-1">
              <label className="text-xs font-medium text-slate-600" htmlFor="act-area">
                Area
              </label>
              <select
                id="act-area"
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                value={draft.area}
                onChange={(e) => setDraft((d) => ({ ...d, area: e.target.value }))}
              >
                {AREA_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="secondary">
              Apply
            </Button>
          </form>

          {error ? (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          <div className="erp-table-wrap">
            <table className="erp-table">
              <thead>
                <tr>
                  <th className="w-8" aria-hidden />
                  <th>When</th>
                  <th>What happened</th>
                  <th>Who</th>
                  <th>Where</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                      Loading…
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-slate-500">
                      No activity in this range.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const open = expanded === row.id;
                    const sections = open ? buildPayloadSections(row.payload) : [];
                    const stockSection = sections.find((s) => s.title === "Stock change");
                    const otherSections = sections.filter((s) => s.title !== "Stock change");
                    return (
                      <React.Fragment key={row.id}>
                        <tr className={cn(open ? "bg-white" : undefined)}>
                          <td className="w-8">
                            <button
                              type="button"
                              className="rounded p-1 text-slate-600 hover:bg-slate-100"
                              aria-expanded={open}
                              aria-label={open ? "Collapse details" : "Expand details"}
                              onClick={() => setExpanded(open ? null : row.id)}
                            >
                              {open ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          </td>
                          <td className="whitespace-nowrap text-sm">{formatWhen(row.createdAt)}</td>
                          <td className="max-w-md text-sm">{row.summary}</td>
                          <td className="text-sm">{whoLabel(row)}</td>
                          <td className="whitespace-nowrap text-sm">{entityTypeLabel(row.entityType)}</td>
                        </tr>
                        {open ? (
                          <tr>
                            <td colSpan={5} className="!bg-slate-50 border-b border-slate-200">
                              <div className="space-y-4 px-3 py-4">
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                    Summary
                                  </div>
                                  <p className="text-sm text-slate-900">{row.summary}</p>
                                </div>
                                {row.reason?.trim() ? (
                                  <div>
                                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                                      Reason
                                    </div>
                                    <p className="text-sm text-slate-900">{row.reason.trim()}</p>
                                  </div>
                                ) : null}
                                {otherSections.map((s) => (
                                  <SectionBlock key={s.title} section={s} />
                                ))}
                                {stockSection ? <SectionBlock section={stockSection} /> : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {!loading && total > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
              <span>
                Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="text-xs">
                  Page {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
