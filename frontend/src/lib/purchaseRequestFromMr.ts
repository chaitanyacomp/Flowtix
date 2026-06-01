/** Build POST /api/procurement-planning/send-requirement body from one open MR (no navigation). */

const QTY_EPS = 1e-6;

export type MrLineForPr = {
  lineId: number;
  rmItemId: number;
  itemName: string;
  unit: string;
  requiredQty: number;
  shortageQty: number;
  remainingQty: number;
};

export type SendPurchaseRequestLine = {
  itemId: number;
  requiredQty: number;
  availableQty: number;
  netRequiredQty: number;
  unit: string | null;
  allocations: { materialRequirementLineId: number; qty: number }[];
};

export type SendPurchaseRequestBody = {
  remarks: string | null;
  lines: SendPurchaseRequestLine[];
};

export function buildPurchaseRequestPayloadFromMr(
  mr: {
    materialRequirementId: number;
    docNo: string | null;
    lines?: MrLineForPr[];
  },
): SendPurchaseRequestBody | null {
  const eligible = (mr.lines ?? []).filter((ln) => ln.remainingQty > QTY_EPS);
  if (!eligible.length) return null;

  const byItem = new Map<number, SendPurchaseRequestLine>();

  for (const ln of eligible) {
    let bucket = byItem.get(ln.rmItemId);
    if (!bucket) {
      bucket = {
        itemId: ln.rmItemId,
        requiredQty: 0,
        availableQty: 0,
        netRequiredQty: 0,
        unit: ln.unit?.trim() || null,
        allocations: [],
      };
      byItem.set(ln.rmItemId, bucket);
    }
    bucket.requiredQty += ln.requiredQty;
    bucket.netRequiredQty += ln.remainingQty;
    bucket.allocations.push({
      materialRequirementLineId: ln.lineId,
      qty: ln.remainingQty,
    });
  }

  const lines = [...byItem.values()];
  if (!lines.length) return null;

  return {
    remarks: mr.docNo
      ? `Purchase request for ${mr.docNo}`
      : `Purchase request for MR-${mr.materialRequirementId}`,
    lines,
  };
}
