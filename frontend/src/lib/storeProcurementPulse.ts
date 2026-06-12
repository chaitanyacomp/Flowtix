import { procurementStageLabelForKey } from "./woProcurementContinuity";

const QTY_EPS = 1e-6;

export type StoreProcurementMrLineLike = {
  itemName: string;
  remainingQty: number;
  unit: string;
  rmItemId: number;
  lineId?: number;
  requiredQty?: number;
  shortageQty?: number;
};

export type StoreProcurementMrLike = {
  materialRequirementId: number;
  docNo: string | null;
  sourceType?: string | null;
  sourceRef?: string;
  source?: { label?: string; type?: string | null; planDocumentLabel?: string | null } | null;
  operationalKey: string;
  operationalLabel?: string;
  nextActionKey: string;
  totalRemainingQty: number;
  primaryPoId?: number | null;
  lines?: StoreProcurementMrLineLike[];
  canCreatePurchaseRequest?: boolean;
};

export type StoreProcurementWorkspaceLike = {
  summary: {
    pendingMrCount: number;
    purchaseRequestCount: number;
    grnPendingLineCount: number;
    queueCounts?: { byDemandPool?: Partial<Record<"REGULAR_SO" | "MPRS" | "STOCK_REPLENISHMENT", number>> };
  };
  sections: {
    pendingMaterialRequirements: StoreProcurementMrLike[];
  };
  pools?: Partial<
    Record<
      "REGULAR_SO" | "MPRS" | "STOCK_REPLENISHMENT",
      { items?: Array<{ origins?: Array<{ materialRequirementId?: number }> }> }
    >
  >;
};

export type StoreProcurementPulseMetrics = {
  awaitingPr: number;
  awaitingPo: number;
  grnPending: number;
  uncoveredDemand: number;
  storeActionNeeded: number;
};

export type StoreProcurementPreviewRow = {
  key: string;
  materialRequirementId: number;
  sourceLabel: string;
  mrDocNo: string;
  rmItemName: string;
  remainingQty: number;
  unit: string;
  stageLabel: string;
  nextActionKey: string;
  primaryPoId: number | null;
  canCreatePurchaseRequest: boolean;
  mr: StoreProcurementMrLike;
};

export function computeStoreProcurementPulseMetrics(
  ws: StoreProcurementWorkspaceLike | null | undefined,
): StoreProcurementPulseMetrics {
  const mrs = ws?.sections?.pendingMaterialRequirements ?? [];
  const summary = ws?.summary;

  const awaitingPr =
    summary?.pendingMrCount ?? mrs.filter((m) => m.operationalKey === "PROCUREMENT_PENDING").length;
  const awaitingPo =
    summary?.purchaseRequestCount ?? mrs.filter((m) => m.operationalKey === "PR_PENDING_PO").length;
  const grnPending = summary?.grnPendingLineCount ?? 0;

  const uncoveredDemand = mrs.filter(
    (m) =>
      Number(m.totalRemainingQty ?? 0) > QTY_EPS &&
      !["RM_READY", "PROCUREMENT_COMPLETE"].includes(String(m.operationalKey ?? "")),
  ).length;

  const storeActionNeeded = mrs.filter(
    (m) => m.nextActionKey === "CREATE_PR" || m.nextActionKey === "OPEN_GRN",
  ).length;

  return { awaitingPr, awaitingPo, grnPending, uncoveredDemand, storeActionNeeded };
}

function previewPriority(mr: StoreProcurementMrLike): number {
  if (mr.nextActionKey === "CREATE_PR") return 0;
  if (mr.nextActionKey === "OPEN_GRN") return 1;
  if (mr.operationalKey === "PR_PENDING_PO") return 2;
  if (Number(mr.totalRemainingQty ?? 0) > QTY_EPS) return 3;
  return 4;
}

function sourceLabelForMr(mr: StoreProcurementMrLike): string {
  const plan = mr.source?.planDocumentLabel?.trim();
  if (plan) return plan;
  const label = mr.source?.label?.trim();
  if (label && label !== "Monthly Plan") return label;
  if (mr.sourceRef?.trim()) return mr.sourceRef.trim();
  return mr.docNo?.trim() || `MR-${mr.materialRequirementId}`;
}

function primaryRmLine(mr: StoreProcurementMrLike): StoreProcurementMrLineLike | null {
  const lines = mr.lines ?? [];
  if (!lines.length) return null;
  return lines.reduce<StoreProcurementMrLineLike | null>(
    (best, ln) => (!best || Number(ln.remainingQty ?? 0) > Number(best.remainingQty ?? 0) ? ln : best),
    null,
  );
}

export function buildStoreProcurementPreviewRows(
  ws: StoreProcurementWorkspaceLike | null | undefined,
  limit = 8,
): StoreProcurementPreviewRow[] {
  const mrs = [...(ws?.sections?.pendingMaterialRequirements ?? [])].filter(
    (m) => !["RM_READY", "PROCUREMENT_COMPLETE"].includes(String(m.operationalKey ?? "")),
  );

  mrs.sort((a, b) => {
    const p = previewPriority(a) - previewPriority(b);
    if (p !== 0) return p;
    return Number(b.totalRemainingQty ?? 0) - Number(a.totalRemainingQty ?? 0);
  });

  return mrs.slice(0, limit).map((mr) => {
    const line = primaryRmLine(mr);
    const remainingQty =
      Number(mr.totalRemainingQty ?? 0) > QTY_EPS
        ? Number(mr.totalRemainingQty ?? 0)
        : Number(line?.remainingQty ?? 0);

    return {
      key: String(mr.materialRequirementId),
      materialRequirementId: mr.materialRequirementId,
      sourceLabel: sourceLabelForMr(mr),
      mrDocNo: mr.docNo?.trim() || `MR-${mr.materialRequirementId}`,
      rmItemName: line?.itemName?.trim() || "—",
      remainingQty,
      unit: line?.unit?.trim() || "",
      stageLabel:
        mr.operationalLabel?.trim() ||
        procurementStageLabelForKey(mr.operationalKey) ||
        mr.operationalKey,
      nextActionKey: mr.nextActionKey,
      primaryPoId: mr.primaryPoId ?? null,
      canCreatePurchaseRequest: mr.canCreatePurchaseRequest !== false && mr.nextActionKey === "CREATE_PR",
      mr,
    };
  });
}
