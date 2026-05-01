/** Prefer API docNo (PREFIX-YY-####); fall back to legacy id-based labels. */

function displaySalesOrderNo(id, docNo) {
  const s = docNo?.trim?.() ? String(docNo).trim() : "";
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "SO-—";
  return `SO-${String(n).padStart(3, "0")}`;
}

function displayDispatchNo(id, docNo) {
  const s = docNo?.trim?.() ? String(docNo).trim() : "";
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "D-—";
  return `D-${String(n).padStart(3, "0")}`;
}

function displayWorkOrderNo(id, docNo) {
  const s = docNo?.trim?.() ? String(docNo).trim() : "";
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "WO-—";
  return `WO-${String(n).padStart(3, "0")}`;
}

function displayProductionEntryNo(id, docNo) {
  const s = docNo?.trim?.() ? String(docNo).trim() : "";
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "PE-—";
  return `PE-${String(n).padStart(3, "0")}`;
}

function displayQcEntryNo(id, docNo) {
  const s = docNo?.trim?.() ? String(docNo).trim() : "";
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "QC-—";
  return `QC-${String(n).padStart(3, "0")}`;
}

function displayRequirementSheetNo(id, docNo) {
  const s = docNo?.trim?.() ? String(docNo).trim() : "";
  if (s) return s;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "RS-—";
  return `RS-${String(n).padStart(3, "0")}`;
}

function displaySalesBillNo(id, billNo, docNo) {
  const d = docNo?.trim?.() ? String(docNo).trim() : "";
  if (d) return d;
  const b = billNo?.trim?.() ? String(billNo).trim() : "";
  if (b) return b;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "SB-—";
  return `SB-${String(n).padStart(4, "0")}`;
}

function displayPurchaseBillNo(id, billNo) {
  const b = billNo?.trim?.() ? String(billNo).trim() : "";
  if (b) return b;
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return "PB-—";
  return `PB-${String(n).padStart(4, "0")}`;
}

module.exports = {
  displaySalesOrderNo,
  displayDispatchNo,
  displayWorkOrderNo,
  displayProductionEntryNo,
  displayQcEntryNo,
  displayRequirementSheetNo,
  displaySalesBillNo,
  displayPurchaseBillNo,
};
