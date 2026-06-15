import {
  demandPoolLabelForSourceType,
  formatProcurementDemandSourceLabel,
  incomingPoQtyInformationalMessage,
  LEGACY_HISTORICAL_DEMAND_LABEL,
} from "./procurementTraceTerminology";
import { formatOperationalWarningMessage } from "./operationalWarningPresentation";

const EPS = 1e-6;

export type ProcurementChipKey =
  | "NOT_REQUIRED"
  | "AWAITING_PR"
  | "AWAITING_PO"
  | "PO_RELEASED"
  | "GRN_PENDING"
  | "PARTIALLY_RECEIVED"
  | "FULLY_RECEIVED";

export type ProcurementChip = {
  key: ProcurementChipKey;
  label: string;
  variant: "default" | "warning" | "info" | "success" | "muted";
};

export type ProcurementVisibilityInput = {
  anyShortage: boolean;
  hasMr: boolean;
  mrStatus: string | null;
  prLineCount: number;
  poLineCount: number;
  pendingGrnQty: number;
  receivedGrnQty: number;
  procurementCompleted?: boolean;
  notEscalated?: boolean;
};

export function deriveProcurementChip(input: ProcurementVisibilityInput): ProcurementChip {
  const pendingGrn = n(input.pendingGrnQty);
  const receivedGrn = n(input.receivedGrnQty);
  const prCount = n(input.prLineCount);
  const poCount = n(input.poLineCount);
  const hasMr = input.hasMr;
  const mrStatus = String(input.mrStatus ?? "").trim();

  if (
    input.procurementCompleted ||
    mrStatus === "FULLY_PROCURED" ||
    (poCount > 0 && pendingGrn <= EPS && receivedGrn > EPS)
  ) {
    return { key: "FULLY_RECEIVED", label: "Fully Received", variant: "success" };
  }
  if (poCount > 0 && pendingGrn > EPS && receivedGrn > EPS) {
    return { key: "PARTIALLY_RECEIVED", label: "Partially Received", variant: "info" };
  }
  if (poCount > 0 && pendingGrn > EPS) {
    return { key: "GRN_PENDING", label: "GRN Pending", variant: "warning" };
  }
  if (poCount > 0) {
    return { key: "PO_RELEASED", label: "PO Released", variant: "info" };
  }
  if (prCount > 0) {
    return { key: "AWAITING_PO", label: "Awaiting PO", variant: "warning" };
  }
  if (hasMr && ["APPROVED", "SENT_TO_PURCHASE", "PROCUREMENT_IN_PROGRESS", "PARTIALLY_PROCURED"].includes(mrStatus)) {
    return { key: "AWAITING_PR", label: "Awaiting PR", variant: "warning" };
  }
  if (!input.anyShortage && !hasMr) {
    return { key: "NOT_REQUIRED", label: "Not Required", variant: "muted" };
  }
  if (input.notEscalated && input.anyShortage && !input.procurementCompleted && mrStatus !== "FULLY_PROCURED" && receivedGrn <= EPS) {
    return { key: "AWAITING_PR", label: "Awaiting PR", variant: "warning" };
  }
  return { key: "NOT_REQUIRED", label: "Not Required", variant: "muted" };
}

export function procurementSourceLabel(sourceType: string | null | undefined, fallback?: string | null): string | null {
  const st = String(sourceType ?? "").trim();
  if (st === "QUOTATION") return fallback?.trim() || "Quotation";
  const anchor = formatProcurementDemandSourceLabel({
    sourceType: st,
    salesOrderDocNo: st === "SALES_ORDER" ? fallback : null,
    monthlyPlanLabel: st === "MONTHLY_PLAN" ? fallback : null,
    materialRequirementDocNo: fallback,
  });
  if (anchor) return anchor;
  if (st === "WORK_ORDER_PLANNING") return LEGACY_HISTORICAL_DEMAND_LABEL;
  const pool = demandPoolLabelForSourceType(st);
  if (pool) return pool;
  return fallback?.trim() || null;
}

export { formatProcurementDemandSourceLabel, formatProcurementExecutionWoLabel } from "./procurementTraceTerminology";

export function procurementTimelineStepIndex(input: {
  prLineCount: number;
  poLineCount: number;
  pendingGrnQty: number;
  receivedGrnQty: number;
  procurementCompleted?: boolean;
  hasMr: boolean;
}): number {
  if (input.procurementCompleted || (n(input.receivedGrnQty) > EPS && n(input.pendingGrnQty) <= EPS && n(input.poLineCount) > 0)) {
    return 4;
  }
  if (n(input.poLineCount) > 0 && n(input.pendingGrnQty) > EPS) return 3;
  if (n(input.poLineCount) > 0) return 2;
  if (n(input.prLineCount) > 0) return 1;
  if (input.hasMr) return 0;
  return 0;
}

export type ProcurementWarning = {
  code: string;
  message: string;
  tone: "info" | "warning";
};

export function deriveProcurementWarnings(input: {
  chip: ProcurementChip;
  sourceType?: string | null;
  pendingGrnQty: number;
  incomingLineCount: number;
  lineWarnings?: Array<{ code: string; message: string }>;
}): ProcurementWarning[] {
  const out: ProcurementWarning[] = [];
  const seen = new Set<string>();

  const push = (code: string, message: string, tone: ProcurementWarning["tone"] = "warning") => {
    if (seen.has(code)) return;
    seen.add(code);
    out.push({ code, message, tone });
  };

  for (const w of input.lineWarnings ?? []) {
    if (w?.code || w?.message) push(w.code ?? "LINE_WARNING", formatOperationalWarningMessage(w), "info");
  }

  if (input.chip.key === "AWAITING_PO") {
    push("AWAITING_PO", "Purchase Request exists — waiting for Purchase to create RM PO.");
  }
  if (input.chip.key === "GRN_PENDING" || n(input.pendingGrnQty) > EPS) {
    push("GRN_PENDING", "Goods receipt pending — material is ordered but not yet available in Store.");
  }
  if (input.incomingLineCount > 0) {
    push("INCOMING_PO_INFORMATIONAL", incomingPoQtyInformationalMessage(), "info");
  }
  if (input.sourceType === "MONTHLY_PLAN" && input.incomingLineCount > 0) {
    push("MONTHLY_PLAN_INCOMING", "Monthly Plan demand — incoming purchase quantity is already on order.");
  }

  return out;
}

export function lineCoveragePercent(line: {
  requiredQty: number;
  shortageAfterReservationQty?: number;
  coveredByIncomingQty?: number;
  grnReceivedPercent?: number | null;
}): number | null {
  if (line.grnReceivedPercent != null && Number.isFinite(Number(line.grnReceivedPercent))) {
    return Math.min(100, Math.max(0, Number(line.grnReceivedPercent)));
  }
  const required = n(line.requiredQty);
  if (required <= EPS) return 100;
  const shortage = n(line.shortageAfterReservationQty);
  const stockCovered = Math.max(0, required - shortage);
  const incoming = n(line.coveredByIncomingQty);
  const total = Math.min(required, stockCovered + incoming);
  return Math.min(100, Math.round((total / required) * 1000) / 10);
}

export function storeMayCreatePurchaseRequest(chip: ProcurementChip, canCreatePurchaseRequest: boolean, opts?: {
  procurementCompleted?: boolean;
  mrStatus?: string | null;
  receivedGrnQty?: number;
}): boolean {
  if (opts?.procurementCompleted || String(opts?.mrStatus ?? "").trim() === "FULLY_PROCURED") return false;
  if (n(opts?.receivedGrnQty) > EPS) return false;
  return canCreatePurchaseRequest && chip.key === "AWAITING_PR";
}

export function storeMayOpenGrn(chip: ProcurementChip): boolean {
  return chip.key === "GRN_PENDING" || chip.key === "PARTIALLY_RECEIVED";
}

function n(v: unknown): number {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}
