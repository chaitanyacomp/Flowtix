import { formatQtyNumber } from "./quantityDisplay";

export type WastageDetailDraft = {
  key: string;
  wastageTypeId: number;
  qty: string;
  remarks: string;
};

const EPS = 1e-6;

export function fmtWastageQty(n: number | null | undefined, unit?: string | null): string {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) <= 1e-9) {
    return unit?.trim() ? formatQtyNumber(0, unit, { emptyValue: "0" }) : "0";
  }
  return formatQtyNumber(v, unit, { emptyValue: "0" });
}

function round3(n: number): number {
  return Math.round(Number(n) * 1000) / 1000;
}

export function sumWastageDetailDraftQty(rows: WastageDetailDraft[]): number {
  return round3(
    rows.reduce((acc, row) => {
      const qty = Number(row.qty);
      return acc + (Number.isFinite(qty) ? qty : 0);
    }, 0),
  );
}

export type WastageClassificationBalanceStatus = "idle" | "complete" | "remaining" | "over";

export type WastageClassificationBalance = {
  totalWastageQty: number;
  classifiedQty: number;
  remainingQty: number;
  status: WastageClassificationBalanceStatus;
};

export function computeWastageClassificationBalance(
  totalWastageQty: number,
  rows: WastageDetailDraft[],
): WastageClassificationBalance {
  const total = round3(Number(totalWastageQty));
  const classified = sumWastageDetailDraftQty(rows);
  const remaining = round3(total - classified);

  if (!(total > EPS)) {
    if (classified > EPS) {
      return { totalWastageQty: total, classifiedQty: classified, remainingQty: remaining, status: "over" };
    }
    return { totalWastageQty: total, classifiedQty: classified, remainingQty: remaining, status: "idle" };
  }
  if (classified > total + EPS) {
    return { totalWastageQty: total, classifiedQty: classified, remainingQty: remaining, status: "over" };
  }
  if (Math.abs(remaining) <= EPS) {
    return { totalWastageQty: total, classifiedQty: classified, remainingQty: 0, status: "complete" };
  }
  return { totalWastageQty: total, classifiedQty: classified, remainingQty: remaining, status: "remaining" };
}

export function remainingWastageAfterRow(
  totalWastageQty: number,
  rows: WastageDetailDraft[],
  rowIndex: number,
): number {
  const classifiedUpTo = round3(
    rows.slice(0, rowIndex + 1).reduce((acc, row) => {
      const qty = Number(row.qty);
      return acc + (Number.isFinite(qty) ? qty : 0);
    }, 0),
  );
  return round3(Number(totalWastageQty) - classifiedUpTo);
}

export function buildWastageRemainingToClassifyMessage(remainingQty: number, unit = "Kg"): string {
  return `Classify remaining ${fmtWastageQty(Math.abs(remainingQty))} ${unit} wastage before confirming.`;
}

export function buildWastageOverClassifiedMessage(excessQty: number, unit = "Kg"): string {
  return `Classified wastage exceeds total by ${fmtWastageQty(Math.abs(excessQty))} ${unit}.`;
}

export function buildWastageClassificationMismatchMessage(
  totalWastageQty: number,
  detailedQty: number,
  unit = "Kg",
): string {
  const balance = computeWastageClassificationBalance(totalWastageQty, [
    { key: "tmp", wastageTypeId: 1, qty: String(detailedQty), remarks: "" },
  ]);
  if (balance.status === "over") {
    return buildWastageOverClassifiedMessage(balance.classifiedQty - balance.totalWastageQty, unit);
  }
  if (balance.status === "remaining") {
    return buildWastageRemainingToClassifyMessage(balance.remainingQty, unit);
  }
  return `Total Wastage : ${fmtWastageQty(totalWastageQty)} ${unit}\n\nDetailed Wastage : ${fmtWastageQty(detailedQty)} ${unit}\n\nPlease classify the complete wastage before confirming.`;
}

export function resolveLiveWastageValidationMessage(
  balance: WastageClassificationBalance,
  rows: WastageDetailDraft[],
  unit = "Kg",
): string | null {
  if (balance.status === "over") {
    return buildWastageOverClassifiedMessage(balance.classifiedQty - balance.totalWastageQty, unit);
  }
  if (balance.status === "remaining") {
    return buildWastageRemainingToClassifyMessage(balance.remainingQty, unit);
  }
  if (balance.status === "complete" && balance.totalWastageQty > EPS) {
    if (rows.some((row) => !(row.wastageTypeId > 0) || !(Number(row.qty) > 0))) {
      return "Each wastage row needs a type and quantity greater than zero.";
    }
    return null;
  }
  if (balance.totalWastageQty > EPS && rows.length === 0) {
    return buildWastageRemainingToClassifyMessage(balance.totalWastageQty, unit);
  }
  return null;
}

export function isWastageClassificationComplete(
  balance: WastageClassificationBalance,
  rows: WastageDetailDraft[],
): boolean {
  if (balance.totalWastageQty <= EPS) return true;
  if (balance.status !== "complete") return false;
  return !rows.some((row) => !(row.wastageTypeId > 0) || !(Number(row.qty) > 0));
}

export function validateWastageClassification(totalWastageQty: number, rows: WastageDetailDraft[], unit = "Kg") {
  const balance = computeWastageClassificationBalance(totalWastageQty, rows);
  return resolveLiveWastageValidationMessage(balance, rows, unit);
}

export function toWastageDetailPayload(rows: WastageDetailDraft[]) {
  return rows
    .filter((row) => row.wastageTypeId > 0 && Number(row.qty) > 0)
    .map((row, index) => ({
      wastageTypeId: row.wastageTypeId,
      qty: Number(row.qty),
      remarks: row.remarks.trim() || null,
      sortOrder: index,
    }));
}
