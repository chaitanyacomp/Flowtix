import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { apiFetch, ApiRequestError } from "../services/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { effectiveQty } from "../lib/bomMath";
import { X } from "lucide-react";
import { type NumberDraft, toNumberDraft } from "../lib/numberDraft";
import { useFastEntryForm } from "../hooks/useFastEntryForm";
import { useToast } from "../contexts/ToastContext";

type Item = { id: number; itemName: string; itemType: string; unit: string };
type BomLine = {
  id: number;
  rmItemId: number;
  baseQty: string;
  wastagePercent: string;
  rmItem: Item;
};
type BomRow = {
  id: number;
  fgItemId: number;
  fgItem: Item;
  lines: BomLine[];
};

type LineDraft = { rmItemId: number; baseQty: number | ""; wastagePercent: NumberDraft };

function weightOfFgLabel(unit: string) {
  const u = String(unit || "").toLowerCase();
  if (u === "kg") return "Weight of 1 FG (Kg)";
  return "Weight of 1 FG";
}

function weightPerFgError(l: LineDraft, rmUnit: string): string | null {
  if (l.baseQty === "") return "Enter weight of 1 FG for each line.";
  const n = typeof l.baseQty === "number" ? l.baseQty : Number(l.baseQty);
  if (!Number.isFinite(n)) return "Weight of 1 FG must be a valid number.";
  if (n <= 0) return "Weight of 1 FG must be greater than 0.";
  const u = String(rmUnit || "").toLowerCase();
  if (u === "nos" && !Number.isInteger(n)) return "Weight of 1 FG must be a whole number for Nos items.";
  return null;
}

function fmtBaseQty(n: number, unit: string) {
  if (!Number.isFinite(n)) return "—";
  const u = String(unit || "").toLowerCase();
  if (u === "nos") return String(Math.round(n));
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, "");
}

function fmt3(n: number) {
  const s = n.toFixed(3);
  return s.replace(/\.?0+$/, "");
}

function fmtYield(n: number) {
  const s = n.toFixed(2);
  return s.replace(/\.?0+$/, "");
}

function BomCalculationSummary({
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
    const wp = Number(l.wastagePercent === "" ? 0 : l.wastagePercent);
    const eff = Number.isFinite(bq) ? effectiveQty(bq, wp) : NaN;
    return u === "kg" && eff > 0 && Number.isFinite(eff);
  });

  return (
    <aside className="min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50/90 p-3 shadow-sm lg:sticky lg:top-4">
      <h3 className="border-b border-slate-200 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        Calculation summary
      </h3>
      <div className="mt-3 space-y-4">
        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Finished good</div>
          <p className="mt-1 break-words text-sm font-medium text-slate-900">FG: {fgName || "—"}</p>
        </section>

        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">RM per unit</div>
          <ul className="mt-2 space-y-2.5">
            {lines.map((l, i) => {
              const uStr = rmUnitStr(l.rmItemId);
              const ul = unitLabel(uStr);
              const bq = l.baseQty === "" ? NaN : Number(l.baseQty);
              const wp = Number(l.wastagePercent === "" ? 0 : l.wastagePercent);
              const eff = Number.isFinite(bq) ? effectiveQty(bq, wp) : NaN;
              return (
                <li key={`sum-${i}`} className="break-words text-sm leading-snug text-slate-700">
                  <span className="font-medium text-slate-900">{rmName(l.rmItemId)}</span>
                  {": "}
                  <span className="tabular-nums">{Number.isFinite(bq) ? fmtBaseQty(bq, uStr) : "—"}</span> {ul} + {wp}% ={" "}
                  <span className="tabular-nums font-medium text-slate-900">{Number.isFinite(eff) ? fmt3(eff) : "—"}</span> {ul}
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Yield summary</div>
          {kgYieldLines.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">Use a KG RM with qty &gt; 0 to see FG per 1 KG of that RM.</p>
          ) : (
            <ul className="mt-2 space-y-2" aria-live="polite">
              {kgYieldLines.map((l, i) => {
                const bq = l.baseQty === "" ? NaN : Number(l.baseQty);
                const wp = Number(l.wastagePercent === "" ? 0 : l.wastagePercent);
                const eff = Number.isFinite(bq) ? effectiveQty(bq, wp) : NaN;
                const y = 1 / eff;
                return (
                  <li key={`yield-${l.rmItemId}-${i}`} className="text-sm text-slate-700">
                    <span className="font-medium text-slate-900">{rmName(l.rmItemId)}</span>
                    {": "}
                    <span className="tabular-nums">≈ {fmtYield(y)} FG / KG</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}

export function BomsPage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const [items, setItems] = React.useState<Item[]>([]);
  const [rows, setRows] = React.useState<BomRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const [fgId, setFgId] = React.useState(0);
  const [lines, setLines] = React.useState<LineDraft[]>([{ rmItemId: 0, baseQty: "", wastagePercent: "" }]);

  const [editing, setEditing] = React.useState<BomRow | null>(null);
  const [editLines, setEditLines] = React.useState<LineDraft[]>([]);

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
    if (rms.length && lines[0].rmItemId === 0) setLines([{ rmItemId: rms[0].id, baseQty: "", wastagePercent: "" }]);
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
      const wp = l.wastagePercent === "" ? 0 : Number(l.wastagePercent);
      if (!Number.isFinite(wp) || wp < 0) return "Wastage % must be ≥ 0";
    }
    return null;
  }

  function bomApiError(err: unknown): string {
    if (err instanceof ApiRequestError && err.status === 409) {
      return "BOM already exists for this finished good.";
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
            wastagePercent: l.wastagePercent === "" ? 0 : Number(l.wastagePercent),
          })),
        }),
      });
      await load();
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  async function onDelete(id: number) {
    if (!window.confirm("Delete this BOM? This cannot be undone.")) return;
    try {
      await apiFetch(`/api/boms/${id}`, { method: "DELETE" });
      await load();
      toast.showSuccess("BOM deleted");
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  function openEdit(b: BomRow) {
    setEditing(b);
    setEditLines(
      b.lines.map((l) => {
        const w = Number(l.wastagePercent);
        return {
          rmItemId: l.rmItemId,
          baseQty: Number(l.baseQty),
          wastagePercent: Number.isFinite(w) && w !== 0 ? w : "",
        };
      }),
    );
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
      await apiFetch(`/api/boms/${editing.id}`, {
        method: "PUT",
        body: JSON.stringify({
          lines: editLines.map((l) => ({
            rmItemId: l.rmItemId,
            baseQty: Number(l.baseQty),
            wastagePercent: l.wastagePercent === "" ? 0 : Number(l.wastagePercent),
          })),
        }),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(bomApiError(err));
    }
  }

  return (
    <div className="grid gap-3">
      {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {isAdmin ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_min(280px,100%)] lg:items-start">
        <Card className="min-w-0 border-slate-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Create BOM</CardTitle>
          </CardHeader>
          <CardContent>
            <form ref={createFormRef} onSubmit={onCreate} className="erp-form min-w-0">
              <div className="erp-form-field">
                <span className="erp-form-label">Finished good</span>
                <select
                  ref={fgSelectRef}
                  className="erp-select"
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
              <p className="text-xs text-slate-500">RM per unit of FG — base qty, wastage %, then effective.</p>
              {lines.map((l, i) => (
                <div key={`create-line-${i}`} className="erp-form-line-card">
                  <div className="erp-form-field">
                    <span className="erp-form-label">RM</span>
                    <select
                      className="erp-select"
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
                  </div>
                  <div className="erp-form-row-2">
                    <div className="erp-form-field">
                      <span className="erp-form-label">{weightOfFgLabel(rmUnit(l.rmItemId))}</span>
                      <Input
                        type="number"
                        {...qtyInputProps(rmUnit(l.rmItemId))}
                        value={l.baseQty === "" ? "" : l.baseQty}
                        onChange={(e) => {
                          const unit = rmUnit(l.rmItemId);
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
                      <span className="text-xs text-slate-500">{rmUnit(l.rmItemId)}</span>
                    </div>
                    <div className="erp-form-field">
                      <span className="erp-form-label">Wastage %</span>
                      <Input
                        type="number"
                        step="any"
                        value={l.wastagePercent}
                        onChange={(e) => {
                          setLines((p) =>
                            p.map((x, j) =>
                              j === i ? { ...x, wastagePercent: toNumberDraft(e.target.value) } : x,
                            ),
                          );
                        }}
                      />
                    </div>
                  </div>
                  {lines.length > 1 ? (
                    <div className="flex justify-end">
                      <Button type="button" size="sm" variant="outline" onClick={() => setLines((p) => p.filter((_, j) => j !== i))}>
                        <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                        Remove
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((p) => [...p, { rmItemId: rms[0]?.id ?? 0, baseQty: "", wastagePercent: "" }])}
                >
                  Add line
                </Button>
                <Button type="submit">Save BOM</Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <BomCalculationSummary
          fgName={fgs.find((x) => x.id === fgId)?.itemName ?? "—"}
          lines={lines}
          rmById={rmById}
        />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Existing BOMs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {rows.map((b) => (
              <div key={b.id} className="rounded border p-3">
                <div className="flex justify-between gap-2">
                  <div className="font-medium">{b.fgItem.itemName}</div>
                  {isAdmin ? (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => openEdit(b)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => onDelete(b.id)}>
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </div>
                <ul className="mt-2 list-inside list-disc text-sm text-slate-700">
                  {b.lines.map((l) => (
                    <li key={l.id}>
                      {l.rmItem.itemName}: base {l.baseQty} + {l.wastagePercent}% wastage → effective{" "}
                      {effectiveQty(Number(l.baseQty), Number(l.wastagePercent)).toFixed(4)} / unit
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {editing ? (
        <div className="erp-modal-backdrop" role="dialog">
          <Card className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            <CardHeader className="shrink-0 pb-2">
              <CardTitle className="text-base">Edit BOM — {editing.fgItem.itemName}</CardTitle>
            </CardHeader>
            <CardContent className="min-h-0 overflow-y-auto overflow-x-hidden">
              <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_min(260px,100%)] lg:items-start">
              <form onSubmit={saveEdit} className="erp-form min-w-0">
                {editLines.map((l, i) => (
                  <div key={`edit-line-${i}`} className="erp-form-line-card">
                    <div className="erp-form-field">
                      <span className="erp-form-label">RM</span>
                      <select
                        className="erp-select"
                        value={l.rmItemId}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setEditLines((p) => p.map((x, j) => (j === i ? { ...x, rmItemId: v } : x)));
                        }}
                      >
                        {rms.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.itemName}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="erp-form-row-2">
                      <div className="erp-form-field">
                        <span className="erp-form-label">{weightOfFgLabel(rmUnit(l.rmItemId))}</span>
                        <Input
                          type="number"
                          {...qtyInputProps(rmUnit(l.rmItemId))}
                          value={l.baseQty === "" ? "" : l.baseQty}
                          onChange={(e) => {
                            const unit = rmUnit(l.rmItemId);
                            const raw = e.target.value;
                            if (raw === "") {
                              setEditLines((p) => p.map((x, j) => (j === i ? { ...x, baseQty: "" } : x)));
                              return;
                            }
                            const v =
                              String(unit).toLowerCase() === "nos" ? Number.parseInt(raw, 10) : Number(raw);
                            setEditLines((p) => p.map((x, j) => (j === i ? { ...x, baseQty: Number.isFinite(v) ? v : "" } : x)));
                          }}
                        />
                        <span className="text-xs text-slate-500">{rmUnit(l.rmItemId)}</span>
                      </div>
                      <div className="erp-form-field">
                        <span className="erp-form-label">Wastage %</span>
                        <Input
                          type="number"
                          step="any"
                          value={l.wastagePercent}
                          onChange={(e) =>
                            setEditLines((p) =>
                              p.map((x, j) =>
                                j === i ? { ...x, wastagePercent: toNumberDraft(e.target.value) } : x,
                              ),
                            )
                          }
                        />
                      </div>
                    </div>
                    {editLines.length > 1 ? (
                      <div className="flex justify-end">
                        <Button type="button" size="sm" variant="outline" onClick={() => setEditLines((p) => p.filter((_, j) => j !== i))}>
                          <X className="mr-1 h-3.5 w-3.5" aria-hidden />
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setEditLines((p) => [...p, { rmItemId: rms[0]?.id ?? 0, baseQty: "", wastagePercent: "" }])}>
                  Add line
                </Button>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                    Cancel
                  </Button>
                  <Button type="submit">Save</Button>
                </div>
              </form>
              <BomCalculationSummary fgName={editing.fgItem.itemName} lines={editLines} rmById={rmById} />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
