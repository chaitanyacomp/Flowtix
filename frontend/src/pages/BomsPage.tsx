import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageContainer } from "../components/PageHeader";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { effectiveQty } from "../lib/bomMath";
import { cn } from "../lib/utils";
import { Lock, MoreHorizontal, Plus, X } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useToast } from "../contexts/ToastContext";

type Item = { id: number; itemName: string; itemType: string; unit: string };
type BomLine = {
  id: number;
  rmItemId: number;
  baseQty: string;
  wastagePercent: string;
  processLossPercent?: string | null;
  qcAllowancePercent?: string | null;
  notes?: string | null;
  rmItem: Item;
};
type BomRow = {
  id: number;
  fgItemId: number;
  fgItem: Item;
  lines: BomLine[];
  /** Sealed after save; absent from API ⇒ treat as locked (older responses). */
  isLocked?: boolean;
  lockedAt?: string | null;
};

function bomAppearsLocked(b: Pick<BomRow, "isLocked">) {
  return b.isLocked !== false;
}

/** Scoped compact controls — BOM page only (do not change shared Input defaults globally). */
const compactInputClass = "h-8 py-1 text-xs";
const compactSelectClass =
  "erp-select !h-8 min-h-8 py-1 text-xs leading-tight ring-offset-white focus-visible:ring-offset-1";

type LineDraft = {
  rmItemId: number;
  baseQty: number | "";
  processLossPercent: NumberDraft;
  qcAllowancePercent: NumberDraft;
  notes: string;
};

function weightPerFgError(l: LineDraft, rmUnit: string): string | null {
  if (l.baseQty === "") return "Enter base RM qty for each line.";
  const n = typeof l.baseQty === "number" ? l.baseQty : Number(l.baseQty);
  if (!Number.isFinite(n)) return "Base RM qty must be a valid number.";
  if (n <= 0) return "Base RM qty must be greater than 0.";
  const u = String(rmUnit || "").toLowerCase();
  if (u === "nos" && !Number.isInteger(n)) return "Base RM qty must be a whole number for Nos items.";
  return null;
}

function fmt3(n: number) {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, "");
}

function fmtYield(n: number) {
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, "");
}

function lineProcessLoss(l: Pick<LineDraft, "processLossPercent">) {
  return Number(l.processLossPercent === "" ? 0 : l.processLossPercent);
}

function lineQcAllowance(l: Pick<LineDraft, "qcAllowancePercent">) {
  return Number(l.qcAllowancePercent === "" ? 0 : l.qcAllowancePercent);
}

function bomLineProcessLoss(l: BomLine) {
  return Number(l.processLossPercent ?? l.wastagePercent ?? 0);
}

function bomLineQcAllowance(l: BomLine) {
  return Number(l.qcAllowancePercent ?? 0);
}

function newBlankLine(rmItemId: number): LineDraft {
  return { rmItemId, baseQty: "", processLossPercent: "", qcAllowancePercent: "", notes: "" };
}

/** Compact sticky KPI — live preview only (same math as before). */
function BomCompactSummary({
  fgName,
  lines,
  rmById,
}: {
  fgName: string;
  lines: LineDraft[];
  rmById: Map<number, Item>;
}) {
  function rmName(rmId: number) {
    return rmById.get(rmId)?.itemName ?? "—";
  }
  function rmUnitStr(rmId: number) {
    return rmById.get(rmId)?.unit ?? "—";
  }
  function unitLabel(u: string) {
    const x = String(u || "").toLowerCase();
    if (x === "kg") return "KG";
    return u || "—";
  }

  const kgYieldLines = lines.filter((l) => {
    const u = String(rmUnitStr(l.rmItemId)).toLowerCase();
    const bq = l.baseQty === "" ? NaN : Number(l.baseQty);
    const eff = Number.isFinite(bq) ? effectiveQty(bq, lineProcessLoss(l), lineQcAllowance(l)) : NaN;
    return u === "kg" && eff > 0 && Number.isFinite(eff);
  });

  const qcVals = lines.map((l) => lineQcAllowance(l));
  const qcUniform = qcVals.length > 0 && qcVals.every((v) => v === qcVals[0]);
  const qcSummary =
    qcVals.length === 0 ? "—" : qcUniform ? `${qcVals[0]}%` : "Mixed · see grid";

  return (
    <aside className="min-w-0 rounded-lg border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/70 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <div className="border-b border-slate-100 bg-gradient-to-b from-slate-50/90 to-white px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">BOM Summary</div>
      </div>
      <div className="space-y-2 px-3 py-2.5 text-xs">
        <dl className="space-y-1">
          <div className="flex justify-between gap-2">
            <dt className="shrink-0 text-slate-500">FG</dt>
            <dd className="max-w-[72%] truncate text-right text-[13px] font-semibold leading-tight text-slate-900">{fgName || "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">RM lines</dt>
            <dd className="tabular-nums text-[13px] font-semibold text-slate-900">{lines.length}</dd>
          </div>
        </dl>

        <div className="border-t border-slate-100 pt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Effective RM / FG</div>
          <ul className="mt-1 space-y-0.5">
            {lines.map((l, i) => {
              const uStr = rmUnitStr(l.rmItemId);
              const ul = unitLabel(uStr);
              const bq = l.baseQty === "" ? NaN : Number(l.baseQty);
              const eff = Number.isFinite(bq) ? effectiveQty(bq, lineProcessLoss(l), lineQcAllowance(l)) : NaN;
              return (
                <li key={`eff-${i}`} className="flex justify-between gap-2 text-[11px] leading-tight">
                  <span className="min-w-0 truncate text-slate-600">{rmName(l.rmItemId)}</span>
                  <span className="shrink-0 tabular-nums font-semibold text-slate-900">
                    {Number.isFinite(eff) ? fmt3(eff) : "—"} {ul}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex justify-between gap-2 border-t border-slate-100 pt-2">
          <span className="text-slate-500">QC allowance</span>
          <span className="max-w-[55%] text-right tabular-nums text-[12px] font-medium leading-snug text-slate-800">{qcSummary}</span>
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50/90 px-2 py-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Yield hint</div>
          {kgYieldLines.length === 0 ? (
            <p className="mt-0.5 text-[11px] leading-snug text-slate-600">
              Use an RM in <span className="font-medium text-slate-700">KG</span> with qty &gt; 0 to preview FG per 1 KG.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5 text-[11px] text-slate-700" aria-live="polite">
              {kgYieldLines.map((l, i) => {
                const bq = l.baseQty === "" ? NaN : Number(l.baseQty);
                const eff = Number.isFinite(bq) ? effectiveQty(bq, lineProcessLoss(l), lineQcAllowance(l)) : NaN;
                const y = 1 / eff;
                return (
                  <li key={`yield-${l.rmItemId}-${i}`}>
                    <span className="font-medium text-slate-800">{rmName(l.rmItemId)}</span>
                    <span className="text-slate-500"> · </span>
                    <span className="tabular-nums font-medium text-slate-900">≈ {fmtYield(y)} FG / KG</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

function BomLinesEditableTable({
  lines,
  setLines,
  rms,
  rmUnit,
  qtyInputProps,
}: {
  lines: LineDraft[];
  setLines: React.Dispatch<React.SetStateAction<LineDraft[]>>;
  rms: Item[];
  rmUnit: (rmItemId: number) => string;
  qtyInputProps: (unit: string) => { step: number | string; inputMode: "numeric" | "decimal" };
}) {
  return (
    <div className="erp-table-wrap border-t-0 [&_tbody_td]:py-1.5 [&_thead_th]:py-1.5">
      <table className="erp-table erp-table-dense min-w-[720px]">
        <thead className="sticky top-0 z-[1] shadow-[0_1px_0_0_rgb(226_232_240)]">
          <tr>
            <th className="min-w-[10rem] text-left">RM</th>
            <th className="w-[7rem] text-right">Base qty</th>
            <th className="w-[5.5rem] text-right">Process %</th>
            <th className="w-[5rem] text-right">QC %</th>
            <th className="w-[7.5rem] text-right">Effective qty</th>
            <th className="min-w-[7rem] text-left">Notes</th>
            <th className="w-[3rem] text-center"> </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const unit = rmUnit(l.rmItemId);
            const bq = l.baseQty === "" ? NaN : Number(l.baseQty);
            const eff = Number.isFinite(bq) ? effectiveQty(bq, lineProcessLoss(l), lineQcAllowance(l)) : NaN;
            const unitDisp = String(unit || "").toLowerCase() === "kg" ? "KG" : unit || "—";
            return (
              <tr key={`bom-line-${i}`} className="group">
                <td>
                  <select
                    className={cn(compactSelectClass, "max-w-[14rem]")}
                    value={l.rmItemId}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setLines((p) => p.map((x, j) => (j === i ? { ...x, rmItemId: v } : x)));
                    }}
                  >
                    {rms.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.itemName}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="text-right">
                  <Input
                    type="number"
                    className={cn(compactInputClass, "ml-auto block w-[6.25rem] text-right tabular-nums")}
                    {...qtyInputProps(unit)}
                    value={l.baseQty === "" ? "" : l.baseQty}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        setLines((p) => p.map((x, j) => (j === i ? { ...x, baseQty: "" } : x)));
                        return;
                      }
                      const v =
                        String(unit).toLowerCase() === "nos" ? Number.parseInt(raw, 10) : Number(raw);
                      setLines((p) => p.map((x, j) => (j === i ? { ...x, baseQty: Number.isFinite(v) ? v : "" } : x)));
                    }}
                  />
                  <span className="sr-only">{unit}</span>
                </td>
                <td className="text-right">
                  <Input
                    type="number"
                    step="any"
                    className={cn(compactInputClass, "ml-auto block w-[4.5rem] text-right tabular-nums")}
                    value={l.processLossPercent}
                    onChange={(e) => {
                      setLines((p) =>
                        p.map((x, j) => (j === i ? { ...x, processLossPercent: toNumberDraft(e.target.value) } : x)),
                      );
                    }}
                  />
                </td>
                <td className="text-right">
                  <Input
                    type="number"
                    step="any"
                    className={cn(compactInputClass, "ml-auto block w-[4rem] text-right tabular-nums")}
                    value={l.qcAllowancePercent}
                    onChange={(e) => {
                      setLines((p) =>
                        p.map((x, j) => (j === i ? { ...x, qcAllowancePercent: toNumberDraft(e.target.value) } : x)),
                      );
                    }}
                  />
                </td>
                <td className="text-right tabular-nums text-[13px] font-semibold text-slate-800">
                  {Number.isFinite(eff) ? `${fmt3(eff)} ${unitDisp}` : "—"}
                </td>
                <td>
                  <Input
                    className={cn(compactInputClass, "min-w-[6rem]")}
                    value={l.notes}
                    onChange={(e) => setLines((p) => p.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))}
                    placeholder="—"
                  />
                </td>
                <td className="text-center">
                  {lines.length > 1 ? (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-slate-500 hover:text-red-700"
                      aria-label="Remove line"
                      onClick={() => setLines((p) => p.filter((_, j) => j !== i))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  ) : (
                    <span className="inline-block w-7" aria-hidden />
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

export function BomsPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<BomRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [fgId, setFgId] = React.useState(0);
  const [lines, setLines] = React.useState<LineDraft[]>([newBlankLine(0)]);

  const [editing, setEditing] = React.useState<BomRow | null>(null);
  const [editLines, setEditLines] = React.useState<LineDraft[]>([]);
  const [pendingEditAdminPassword, setPendingEditAdminPassword] = React.useState<string | null>(null);
  const [adminGate, setAdminGate] = React.useState<{ mode: "edit" | "delete"; bom: BomRow } | null>(null);
  const [adminGatePassword, setAdminGatePassword] = React.useState("");

  const createFormRef = React.useRef<HTMLFormElement | null>(null);
  const fgSelectRef = React.useRef<HTMLSelectElement | null>(null);
  useFastEntryForm({ containerRef: createFormRef, initialFocusRef: fgSelectRef });

  async function load() {
    const [i, b] = await Promise.all([apiFetch<Item[]>("/api/items"), apiFetch<BomRow[]>("/api/boms")]);
    setItems(i);
    setRows(b);
    const fgs = i.filter((x) => x.itemType === "FG");
    const rms = i.filter((x) => x.itemType === "RM");
    if (fgs.length && !fgId) setFgId(fgs[0].id);
    if (rms.length && lines[0].rmItemId === 0) setLines([newBlankLine(rms[0].id)]);
  }

  React.useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fgs = items.filter((x) => x.itemType === "FG");
  const rms = items.filter((x) => x.itemType === "RM");
  const rmById = React.useMemo(() => new Map(rms.map((r) => [r.id, r])), [rms]);

  function rmUnit(rmItemId: number) {
    return rmById.get(rmItemId)?.unit ?? "—";
  }

  function qtyInputProps(unit: string) {
    const u = String(unit || "").toLowerCase();
    if (u === "nos") {
      return { step: 1, inputMode: "numeric" as const };
    }
    return { step: "any", inputMode: "decimal" as const };
  }

  function validateDraft(draft: LineDraft[]) {
    if (!draft.length) return "Add at least one RM line";
    const seen = new Set<number>();
    for (const l of draft) {
      if (!l.rmItemId) return "Select RM item for all lines";
      if (seen.has(l.rmItemId)) return "Duplicate RM item in BOM lines";
      seen.add(l.rmItemId);
      const wErr = weightPerFgError(l, rmUnit(l.rmItemId));
      if (wErr) return wErr;
      const pp = lineProcessLoss(l);
      const qp = lineQcAllowance(l);
      if (!Number.isFinite(pp) || pp < 0) return "Process Loss % must be >= 0";
      if (!Number.isFinite(qp) || qp < 0) return "QC Allow % must be >= 0";
    }
    return null;
  }

  function bomApiError(err: unknown): string {
    if (err instanceof ApiRequestError && err.status === 409) {
      return "BOM already exists for this finished good.";
    }
    if (err instanceof ApiRequestError && err.code === "BOM_IN_USE") {
      return "This BOM is already used in production. It cannot be deleted. Create a new BOM version/change instead.";
    }
    if (err instanceof ApiRequestError && err.code === "ADMIN_PASSWORD_REQUIRED") {
      return err.message || "Admin password is required to edit or delete locked BOM.";
    }
    if (err instanceof ApiRequestError) return err.message;
    if (err instanceof Error) return err.message;
    return "Request failed";
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const v = validateDraft(lines);
    if (v) {
      setError(v);
      return;
    }
    try {
      await apiFetch("/api/boms", {
        method: "POST",
        body: JSON.stringify({
          fgItemId: fgId,
          lines: lines.map((l) => ({
            rmItemId: l.rmItemId,
            baseQty: Number(l.baseQty),
            processLossPercent: lineProcessLoss(l),
            qcAllowancePercent: lineQcAllowance(l),
            notes: l.notes.trim() || null,
          })),
        }),
      });
      await load();
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  async function deleteBomRequest(id: number, adminPassword?: string) {
    await apiFetch(`/api/boms/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(adminPassword ? { adminPassword } : {}),
    });
  }

  function requestDelete(b: BomRow) {
    if (bomAppearsLocked(b)) {
      setAdminGate({ mode: "delete", bom: b });
      setAdminGatePassword("");
      return;
    }
    if (!window.confirm("Delete this BOM? This cannot be undone.")) return;
    void (async () => {
      try {
        await deleteBomRequest(b.id);
        await load();
        toast.showSuccess("BOM deleted");
      } catch (err) {
        setError(bomApiError(err));
      }
    })();
  }

  function openEdit(b: BomRow, adminPassword?: string) {
    setEditing(b);
    setPendingEditAdminPassword(adminPassword ?? null);
    setEditLines(
      b.lines.map((l) => {
        const processLoss = Number(l.processLossPercent ?? l.wastagePercent ?? 0);
        const qcAllowance = Number(l.qcAllowancePercent ?? 0);
        return {
          rmItemId: l.rmItemId,
          baseQty: Number(l.baseQty),
          processLossPercent: Number.isFinite(processLoss) && processLoss !== 0 ? processLoss : "",
          qcAllowancePercent: Number.isFinite(qcAllowance) && qcAllowance !== 0 ? qcAllowance : "",
          notes: l.notes ?? "",
        };
      }),
    );
  }

  function startEdit(b: BomRow) {
    if (bomAppearsLocked(b)) {
      setAdminGate({ mode: "edit", bom: b });
      setAdminGatePassword("");
      return;
    }
    openEdit(b);
  }

  function closeAdminGate() {
    setAdminGate(null);
    setAdminGatePassword("");
  }

  function submitAdminGate() {
    if (!adminGate) return;
    const pwd = adminGatePassword.trim();
    if (!pwd) {
      setError("Enter your admin password to continue.");
      return;
    }
    setError(null);
    if (adminGate.mode === "edit") {
      const b = adminGate.bom;
      closeAdminGate();
      openEdit(b, pwd);
      return;
    }
    void (async () => {
      try {
        await deleteBomRequest(adminGate.bom.id, pwd);
        closeAdminGate();
        await load();
        toast.showSuccess("BOM deleted");
      } catch (err) {
        setError(bomApiError(err));
      }
    })();
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setError(null);
    const v = validateDraft(editLines);
    if (v) {
      setError(v);
      return;
    }
    try {
      const payload: {
        lines: { rmItemId: number; baseQty: number; processLossPercent: number; qcAllowancePercent: number; notes: string | null }[];
        adminPassword?: string;
      } = {
        lines: editLines.map((l) => ({
          rmItemId: l.rmItemId,
          baseQty: Number(l.baseQty),
          processLossPercent: lineProcessLoss(l),
          qcAllowancePercent: lineQcAllowance(l),
          notes: l.notes.trim() || null,
        })),
      };
      if (bomAppearsLocked(editing) && pendingEditAdminPassword) {
        payload.adminPassword = pendingEditAdminPassword;
      }
      await apiFetch(`/api/boms/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setEditing(null);
      setPendingEditAdminPassword(null);
      await load();
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  return (
    <>
      <PageContainer className="space-y-4 pb-8">
        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 shadow-sm"
          >
            {error}
          </div>
        ) : null}

        {isAdmin ? (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(13rem,248px)] lg:gap-4">
            <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/70">
              <form ref={createFormRef} onSubmit={onCreate} id="bom-create-form" className="min-w-0">
                <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-slate-200 bg-gradient-to-b from-slate-50/95 to-white px-3 py-2.5 md:px-4">
                  <div className="flex min-w-[10rem] flex-1 flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">FG</span>
                    <select
                      ref={fgSelectRef}
                      className={compactSelectClass}
                      value={fgId}
                      onChange={(e) => setFgId(Number(e.target.value))}
                    >
                      {fgs.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.itemName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex min-w-[4.5rem] flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unit</span>
                    <span className="inline-flex h-8 items-center text-[13px] font-semibold tabular-nums text-slate-900">
                      {fgs.find((x) => x.id === fgId)?.unit ?? "—"}
                    </span>
                  </div>
                  <div className="flex min-w-[4rem] flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Version</span>
                    <span className="inline-flex h-8 items-center text-[13px] font-medium text-slate-600">—</span>
                  </div>
                  <div className="flex min-w-[5.5rem] flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
                    <Badge variant="info" className="h-6 w-fit px-2 py-0 text-[10px] font-semibold uppercase tracking-wide">
                      Draft
                    </Badge>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    <Button type="submit" size="sm" className="h-8 px-3 text-xs font-semibold shadow-sm">
                      Save BOM
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 border-slate-300 bg-white px-2.5 text-xs font-medium shadow-sm"
                      onClick={() => setLines((p) => [...p, newBlankLine(rms[0]?.id ?? 0)])}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Add RM line
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2.5 text-xs text-slate-600"
                      disabled
                      title="BOM locks automatically after save"
                    >
                      <Lock className="mr-1 h-3.5 w-3.5" aria-hidden />
                      Lock
                    </Button>
                    <details className="relative">
                      <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                        <span className="sr-only">More</span>
                      </summary>
                      <div className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-md border border-slate-200 bg-white py-1.5 text-[11px] shadow-lg">
                        <p className="px-2.5 py-1 leading-snug text-slate-600">
                          Tip: use <kbd className="rounded border border-slate-200 bg-slate-50 px-1">Tab</kbd> to move across cells quickly.
                        </p>
                      </div>
                    </details>
                  </div>
                </div>

                <BomLinesEditableTable lines={lines} setLines={setLines} rms={rms} rmUnit={rmUnit} qtyInputProps={qtyInputProps} />
              </form>
            </section>

            <div className="min-w-0">
              <BomCompactSummary fgName={fgs.find((x) => x.id === fgId)?.itemName ?? "—"} lines={lines} rmById={rmById} />
            </div>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/70">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 bg-gradient-to-b from-slate-50/95 to-white px-3 py-2 md:px-4">
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-900">Existing BOMs</h2>
              <p className="text-[11px] leading-snug text-slate-500">Structured view · one row per RM line</p>
            </div>
          </div>
          <div className="erp-table-wrap rounded-none border-0 border-t border-slate-100 [&_tbody_td]:py-1.5 [&_thead_th]:py-1.5">
            <table className="erp-table erp-table-dense min-w-[920px]">
              <thead className="sticky top-0 z-[1] bg-slate-50 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="min-w-[8rem] text-left">FG</th>
                  <th className="min-w-[9rem] text-left">RM</th>
                  <th className="w-[6rem] text-right">Base qty</th>
                  <th className="w-[5rem] text-right">Process %</th>
                  <th className="w-[4.5rem] text-right">QC %</th>
                  <th className="w-[7.5rem] text-right">Effective qty</th>
                  <th className="w-[5.5rem] text-center">Status</th>
                  {isAdmin ? <th className="w-[7rem] text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={isAdmin ? 8 : 7} className="py-8 text-center text-sm text-slate-500">
                      No BOMs configured yet.
                    </td>
                  </tr>
                ) : (
                  rows.flatMap((b) =>
                    b.lines.map((l, lineIdx) => {
                      const rs = b.lines.length;
                      const eff = effectiveQty(Number(l.baseQty), bomLineProcessLoss(l), bomLineQcAllowance(l));
                      const u = l.rmItem.unit || "—";
                      const uDisp = String(u).toLowerCase() === "kg" ? "KG" : u;
                      return (
                        <tr key={`${b.id}-${l.id}`} className="hover:bg-slate-50/80">
                          {lineIdx === 0 ? (
                            <td
                              rowSpan={rs}
                              className="max-w-[11rem] align-top text-[13px] font-semibold leading-snug text-slate-900"
                            >
                              {b.fgItem.itemName}
                            </td>
                          ) : null}
                          <td className="max-w-[12rem] truncate text-[13px] text-slate-800">{l.rmItem.itemName}</td>
                          <td className="text-right tabular-nums text-[13px] text-slate-800">{l.baseQty}</td>
                          <td className="text-right tabular-nums text-[13px] text-slate-700">{bomLineProcessLoss(l)}</td>
                          <td className="text-right tabular-nums text-[13px] text-slate-700">{bomLineQcAllowance(l)}</td>
                          <td className="text-right tabular-nums text-[13px] font-semibold text-slate-900">
                            {fmt3(eff)} {uDisp}
                          </td>
                          {lineIdx === 0 ? (
                            <td rowSpan={rs} className="align-middle text-center">
                              {bomAppearsLocked(b) ? (
                                <Badge variant="default" className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                                  Locked
                                </Badge>
                              ) : (
                                <Badge variant="success" className="px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide">
                                  Editable
                                </Badge>
                              )}
                            </td>
                          ) : null}
                          {isAdmin && lineIdx === 0 ? (
                            <td rowSpan={rs} className="align-middle">
                              <div className="erp-table-actions">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-[11px] font-medium"
                                  onClick={() => startEdit(b)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  className="h-7 px-2 text-[11px] font-medium"
                                  onClick={() => requestDelete(b)}
                                >
                                  Delete
                                </Button>
                              </div>
                            </td>
                          ) : null}
                        </tr>
                      );
                    }),
                  )
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 bg-slate-50/50 px-3 py-2 text-[11px] text-slate-500 md:hidden">
            Scroll horizontally to view all columns.
          </div>
        </section>
      </PageContainer>

      {adminGate ? (
        <div className="erp-modal-backdrop" role="dialog" aria-labelledby="bom-admin-gate-title">
          <Card className="w-full max-w-md overflow-hidden rounded-xl border-slate-200/90 shadow-xl ring-1 ring-slate-200/60">
            <CardHeader className="space-y-1.5 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white px-5 pb-4 pt-5">
              <CardTitle id="bom-admin-gate-title" className="text-base font-semibold text-slate-900">
                Admin approval required
              </CardTitle>
              <p id="bom-admin-gate-desc" className="text-sm leading-relaxed text-slate-600">
                {adminGate.mode === "edit"
                  ? "Enter admin password to edit locked BOM."
                  : "Enter admin password to delete locked BOM."}
              </p>
            </CardHeader>
            <CardContent className="space-y-3 px-5 pb-5 pt-4">
              <Input
                type="password"
                className={cn(compactInputClass, "h-9")}
                autoComplete="current-password"
                aria-describedby="bom-admin-gate-desc"
                value={adminGatePassword}
                onChange={(e) => setAdminGatePassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAdminGate();
                }}
              />
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 min-w-[5rem] px-4 text-sm font-medium"
                  onClick={closeAdminGate}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-9 min-w-[5rem] px-4 text-sm font-semibold"
                  variant={adminGate.mode === "delete" ? "destructive" : "default"}
                  onClick={submitAdminGate}
                >
                  {adminGate.mode === "delete" ? "Delete" : "Continue"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {editing ? (
        <div className="erp-modal-backdrop z-50" role="dialog" aria-labelledby="bom-edit-title">
          <Card className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border-slate-200/90 shadow-xl ring-1 ring-slate-200/50">
            <div className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-slate-50/95 to-white px-3 py-2.5 md:px-4">
              <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p id="bom-edit-title" className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Edit BOM
                  </p>
                  <p className="truncate text-sm font-semibold text-slate-900">{editing.fgItem.itemName}</p>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Unit</span>
                  <span className="inline-flex h-8 items-center text-[13px] font-semibold tabular-nums text-slate-900">
                    {editing.fgItem.unit ?? "—"}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Version</span>
                  <span className="inline-flex h-8 items-center text-[13px] font-medium text-slate-600">—</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Status</span>
                  {bomAppearsLocked(editing) ? (
                    <Badge variant="default" className="h-6 w-fit px-2 py-0 text-[10px] font-semibold uppercase tracking-wide">
                      Locked
                    </Badge>
                  ) : (
                    <Badge variant="success" className="h-6 w-fit px-2 py-0 text-[10px] font-semibold uppercase tracking-wide">
                      Editable
                    </Badge>
                  )}
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                  <Button type="submit" form="bom-edit-form" size="sm" className="h-8 px-3 text-xs font-semibold shadow-sm">
                    Save BOM
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 border-slate-300 bg-white px-2.5 text-xs font-medium shadow-sm"
                    onClick={() => setEditLines((p) => [...p, newBlankLine(rms[0]?.id ?? 0)])}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Add RM line
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs font-medium"
                    onClick={() => {
                      setEditing(null);
                      setPendingEditAdminPassword(null);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-2.5 text-xs text-slate-600"
                    disabled
                    title="Locked BOMs require admin password (already verified if applicable)"
                  >
                    <Lock className="mr-1 h-3.5 w-3.5" aria-hidden />
                    Lock
                  </Button>
                  <details className="relative">
                    <summary className="flex h-8 cursor-pointer list-none items-center rounded-md border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                      <MoreHorizontal className="h-4 w-4" aria-hidden />
                      <span className="sr-only">More</span>
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-md border border-slate-200 bg-white py-1.5 text-[11px] shadow-lg">
                      <p className="px-2.5 py-1 leading-snug text-slate-600">
                        Tip: use <kbd className="rounded border border-slate-200 bg-slate-50 px-1">Tab</kbd> to move across cells quickly.
                      </p>
                    </div>
                  </details>
                </div>
              </div>
            </div>
            <CardContent className="min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-3 md:px-4">
              <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(13rem,248px)] lg:items-start lg:gap-4">
                <form id="bom-edit-form" onSubmit={saveEdit} className="min-w-0">
                  <BomLinesEditableTable
                    lines={editLines}
                    setLines={setEditLines}
                    rms={rms}
                    rmUnit={rmUnit}
                    qtyInputProps={qtyInputProps}
                  />
                </form>
                <div className="min-w-0">
                  <BomCompactSummary fgName={editing.fgItem.itemName} lines={editLines} rmById={rmById} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}
