/** Normalized item form snapshot for unsaved-change comparison (excludes UI-only flags). */

export function normItemText(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Normalize qty/percent strings so "10" / "10.0" / " 10 " compare equal when numeric. */
export function normQtyStr(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  if (t === "") return "";
  const n = Number(t);
  if (!Number.isFinite(n)) return t;
  return String(n);
}

export function normUnitId(v: number | "" | null | undefined): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type ItemFormDirtyFields = {
  creatingType: "RM" | "FG" | "SFG";
  name: string;
  unitId: number | "";
  legacyUnitText: string;
  minimumStock: string;
  lowStockAlert: string;
  bufferPct: string;
  targetStock: string;
  criticalCoveragePct: string;
  warningCoveragePct: string;
  hsnCode: string;
  gstRateStr: string;
  fgManualGreenLevel: string;
};

export function snapshotItemForm(f: ItemFormDirtyFields): string {
  return JSON.stringify({
    creatingType: f.creatingType,
    name: normItemText(f.name),
    unitId: normUnitId(f.unitId),
    legacyUnitText: normItemText(f.legacyUnitText),
    minimumStock: normQtyStr(f.minimumStock),
    lowStockAlert: normQtyStr(f.lowStockAlert),
    bufferPct: normQtyStr(f.bufferPct),
    targetStock: normQtyStr(f.targetStock),
    criticalCoveragePct: normQtyStr(f.criticalCoveragePct),
    warningCoveragePct: normQtyStr(f.warningCoveragePct),
    hsnCode: normItemText(f.hsnCode).toUpperCase(),
    gstRateStr: normQtyStr(f.gstRateStr),
    fgManualGreenLevel: normQtyStr(f.fgManualGreenLevel),
  });
}
