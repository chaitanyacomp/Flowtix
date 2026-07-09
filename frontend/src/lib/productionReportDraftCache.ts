import type { WastageDetailDraft } from "./productionWastageClassification";

export type ProductionReportLineInputDraft = {
  rmConsumedQty: string;
  rmReturnQty: string;
  scrapWasteQty: string;
  varianceQty: string;
  remarks: string;
};

export type ProductionReportDraftSnapshot = {
  lineInputs: Record<number, ProductionReportLineInputDraft>;
  wastageRows: WastageDetailDraft[];
  remarks: string;
};

type CachedDraft = ProductionReportDraftSnapshot & {
  dirty: boolean;
  reportConfirmed: boolean;
};

const MEMORY_KEY_PREFIX = "erp:production-report-draft:v1:";
const draftsByWorkOrderId = new Map<number, CachedDraft>();

function storageKey(workOrderId: number): string {
  return `${MEMORY_KEY_PREFIX}${workOrderId}`;
}

function canUseSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== "undefined";
  } catch {
    return false;
  }
}

function readSessionDraft(workOrderId: number): CachedDraft | null {
  if (!canUseSessionStorage()) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(workOrderId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDraft;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.reportConfirmed) return null;
    return {
      lineInputs: parsed.lineInputs ?? {},
      wastageRows: Array.isArray(parsed.wastageRows) ? parsed.wastageRows : [],
      remarks: typeof parsed.remarks === "string" ? parsed.remarks : "",
      dirty: Boolean(parsed.dirty),
      reportConfirmed: false,
    };
  } catch {
    return null;
  }
}

function writeSessionDraft(workOrderId: number, draft: CachedDraft): void {
  if (!canUseSessionStorage()) return;
  try {
    if (draft.reportConfirmed) {
      sessionStorage.removeItem(storageKey(workOrderId));
      return;
    }
    sessionStorage.setItem(storageKey(workOrderId), JSON.stringify(draft));
  } catch {
    // Quota / private mode — memory map still holds the draft for this session tab lifetime.
  }
}

function removeSessionDraft(workOrderId: number): void {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(storageKey(workOrderId));
  } catch {
    // ignore
  }
}

/**
 * Operator UX draft for unconfirmed Production Report (returns / remarks / wastage classification).
 * Persists to sessionStorage so a page refresh in the same tab keeps in-progress classification.
 * Not a workflow document — backend confirm validation remains authoritative.
 */
export function getProductionReportDraft(workOrderId: number): ProductionReportDraftSnapshot | null {
  if (!(workOrderId > 0)) return null;
  const memory = draftsByWorkOrderId.get(workOrderId);
  if (memory) {
    if (memory.reportConfirmed) return null;
    return {
      lineInputs: memory.lineInputs,
      wastageRows: memory.wastageRows,
      remarks: memory.remarks,
    };
  }
  const session = readSessionDraft(workOrderId);
  if (!session) return null;
  draftsByWorkOrderId.set(workOrderId, session);
  return {
    lineInputs: session.lineInputs,
    wastageRows: session.wastageRows,
    remarks: session.remarks,
  };
}

export function isProductionReportDraftDirty(workOrderId: number): boolean {
  if (!(workOrderId > 0)) return false;
  const memory = draftsByWorkOrderId.get(workOrderId);
  if (memory) return Boolean(memory.dirty && !memory.reportConfirmed);
  const session = readSessionDraft(workOrderId);
  return Boolean(session?.dirty && !session.reportConfirmed);
}

export function saveProductionReportDraft(
  workOrderId: number,
  snapshot: ProductionReportDraftSnapshot,
  options?: { dirty?: boolean; reportConfirmed?: boolean },
): void {
  if (!(workOrderId > 0)) return;
  const next: CachedDraft = {
    ...snapshot,
    dirty: options?.dirty ?? true,
    reportConfirmed: options?.reportConfirmed ?? false,
  };
  draftsByWorkOrderId.set(workOrderId, next);
  writeSessionDraft(workOrderId, next);
}

export function clearProductionReportDraft(workOrderId: number): void {
  if (!(workOrderId > 0)) return;
  draftsByWorkOrderId.delete(workOrderId);
  removeSessionDraft(workOrderId);
}
