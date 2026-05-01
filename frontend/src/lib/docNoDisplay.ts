/** Prefer API `docNo` (PREFIX-YY-####); fall back to legacy id-based labels for older rows. */

export function displaySalesOrderNo(id: number, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "SO-—";
  return `SO-${String(n).padStart(3, "0")}`;
}

export function displayDispatchNo(id: number, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "D-—";
  return `D-${String(n).padStart(3, "0")}`;
}

export function displayWorkOrderNo(id: number, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "WO-—";
  return `WO-${String(n).padStart(3, "0")}`;
}

export function displayProductionEntryNo(id: number, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "PE-—";
  return `PE-${String(n).padStart(3, "0")}`;
}

export function displayQcEntryNo(id: number, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "QC-—";
  return `QC-${String(n).padStart(3, "0")}`;
}

export function displaySalesBillNo(id: number, billNo?: string | null, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const b = billNo?.trim();
  if (b) return b;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "SB-—";
  return `SB-${String(n).padStart(4, "0")}`;
}

export function displayRequirementSheetNo(id: number, docNo?: string | null): string {
  const s = docNo?.trim();
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "RS-—";
  return `RS-${String(n).padStart(3, "0")}`;
}
