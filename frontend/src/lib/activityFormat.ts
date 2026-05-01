/** Human labels for audit entity types (Phase 1). */
export function entityTypeLabel(entityType: string): string {
  const map: Record<string, string> = {
    SALES_ORDER: "Sales order",
    PRODUCTION_ENTRY: "Production",
    QC_ENTRY: "QC",
    DISPATCH: "Dispatch",
    STOCK_ADJUSTMENT: "Stock adjustment",
    USER_SESSION: "Sign-in",
    WORK_ORDER: "Work order",
    ITEM: "Item",
    CUSTOMER: "Customer",
    SUPPLIER: "Supplier",
    BOM: "BOM",
    USER: "User",
    SETTINGS: "Settings",
  };
  return map[entityType] ?? entityType.replace(/_/g, " ");
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    CREATE: "Created",
    UPDATE: "Updated",
    DELETE: "Deleted",
    APPROVE: "Approved",
    REJECT: "Rejected",
    CANCEL: "Cancelled",
    REVERSE: "Reversed",
    LOGIN: "Signed in",
    LOGOUT: "Signed out",
    LOGIN_FAILED: "Sign-in failed",
    BLOCKED_DELETE: "Delete blocked",
  };
  return map[action] ?? action;
}

const SNAPSHOT_LABELS: Record<string, string> = {
  productionId: "Production batch",
  workOrderId: "Work order",
  workOrderLineId: "Work order line",
  salesOrderId: "Sales order",
  fgItemId: "Finished good item",
  fgItemName: "Item name",
  producedQty: "Produced qty",
  checkedQty: "Checked qty",
  acceptedQty: "Accepted qty",
  rejectedQty: "Rejected qty",
  scrapReusable: "Scrap reusable",
  scrapRecorded: "Scrap recorded",
  note: "Note",
  bomIssued: "BOM issued",
  itemId: "Item",
  itemName: "Item name",
  qtyIn: "Qty in",
  qtyOut: "Qty out",
  dispatchedQty: "Dispatched qty",
  workflowStatus: "Workflow status",
  reverseQty: "Reverse qty",
  qcReversalId: "QC reversal",
  qcReversalStockQty: "QC reversal stock qty",
  qcReversalUsableQty: "QC reversal usable qty",
  qcReversalRejectedBucketQty: "QC reversal rejected bucket",
  rejectedStockBucket: "Rejected stock action",
  reversalDispatchId: "Reversal dispatch",
  forwardDispatchWorkflowStatus: "Dispatch status (forward)",
  userId: "User",
  identifierMasked: "Identifier",
  code: "Code",
};

function formatScalar(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") return v;
  return "—";
}

function labelForKey(key: string): string {
  return SNAPSHOT_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()).trim();
}

function formatRmStockRow(line: Record<string, unknown>): { label: string; value: string } {
  const id = line.itemId;
  const before = line.stockBefore;
  const after = line.stockAfter;
  return {
    label: typeof id === "number" ? `RM item #${id}` : "RM line",
    value: `${formatScalar(before)} → ${formatScalar(after)}`,
  };
}

function flattenSnapshot(snap: Record<string, unknown>): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const [key, val] of Object.entries(snap)) {
    if (key === "rmStock" && Array.isArray(val)) {
      for (const line of val) {
        if (line && typeof line === "object") {
          rows.push(formatRmStockRow(line as Record<string, unknown>));
        }
      }
      continue;
    }
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      if ("from" in nested && "to" in nested) {
        rows.push({
          label: labelForKey(key),
          value: `${formatScalar(nested.from)} → ${formatScalar(nested.to)}`,
        });
        continue;
      }
      rows.push({ label: labelForKey(key), value: formatNestedObject(nested) });
      continue;
    }
    if (Array.isArray(val)) {
      rows.push({ label: labelForKey(key), value: val.map((x) => formatScalar(x)).join(", ") });
      continue;
    }
    rows.push({ label: labelForKey(key), value: formatScalar(val) });
  }
  return rows;
}

function formatNestedObject(obj: Record<string, unknown>): string {
  return Object.entries(obj)
    .map(([k, v]) => `${labelForKey(k)}: ${formatScalar(v)}`)
    .join("; ");
}

function formatChangesTree(ch: Record<string, unknown>, prefix = ""): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(ch)) {
    const path = prefix ? `${prefix} / ${labelForKey(k)}` : labelForKey(k);
    if (v !== null && typeof v === "object" && !Array.isArray(v) && "from" in v && "to" in v) {
      const o = v as { from: unknown; to: unknown };
      rows.push({ label: path, value: `${formatScalar(o.from)} → ${formatScalar(o.to)}` });
    } else if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      rows.push(...formatChangesTree(v as Record<string, unknown>, path));
    } else {
      rows.push({ label: path, value: formatScalar(v) });
    }
  }
  return rows;
}

export type ActivitySection = { title: string; rows: { label: string; value: string }[] };

/**
 * Turns stored audit payload into labeled sections for the UI (no raw JSON).
 */
export function buildPayloadSections(payload: unknown): ActivitySection[] {
  if (payload == null || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  const sections: ActivitySection[] = [];

  if (p.reversedOf && typeof p.reversedOf === "object") {
    const r = p.reversedOf as Record<string, unknown>;
    const et = typeof r.entityType === "string" ? entityTypeLabel(r.entityType) : "Record";
    const id = r.entityId != null ? String(r.entityId) : "—";
    sections.push({
      title: "Related",
      rows: [{ label: "Reverses", value: `${et} #${id}` }],
    });
  }

  const detailRows: { label: string; value: string }[] = [];
  const snap = p.snapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    detailRows.push(...flattenSnapshot(snap as Record<string, unknown>));
  }
  const rest = Object.fromEntries(
    Object.entries(p).filter(
      ([k]) =>
        !["reversedOf", "snapshot", "changes", "stockBefore", "stockAfter", "reason"].includes(k),
    ),
  );
  if (Object.keys(rest).length) {
    detailRows.push(...flattenSnapshot(rest));
  }
  if (detailRows.length) sections.push({ title: "Details", rows: detailRows });

  const ch = p.changes;
  if (ch && typeof ch === "object" && !Array.isArray(ch)) {
    const rows = formatChangesTree(ch as Record<string, unknown>);
    if (rows.length) sections.push({ title: "Changes", rows });
  }

  const hasRootStock =
    typeof p.stockBefore === "number" &&
    typeof p.stockAfter === "number" &&
    !Number.isNaN(p.stockBefore) &&
    !Number.isNaN(p.stockAfter);

  if (hasRootStock) {
    sections.push({
      title: "Stock change",
      rows: [
        { label: "Before", value: String(p.stockBefore) },
        { label: "After", value: String(p.stockAfter) },
      ],
    });
  }

  return sections;
}
