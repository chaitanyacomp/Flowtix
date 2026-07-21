/** Sales Bill Tally export readiness helpers (presentation + deep-links). */

export type TallyExportReadinessStatus =
  | "READY"
  | "MISSING_CUSTOMER_LEDGER_MAPPING"
  | "MISSING_SALES_LEDGER_MAPPING"
  | "MISSING_TAX_LEDGER_MAPPING"
  | "MISSING_TRANSPORTATION_LEDGER_MAPPING"
  | "MISSING_STOCK_ITEM_MAPPING"
  | "MISSING_UNIT_MAPPING"
  | "MISSING_ROUND_OFF_LEDGER_MAPPING"
  | "AMBIGUOUS_MASTER_MAPPING";

export type TallyMasterReference = {
  type?: string;
  erpValue?: string | null;
  expectedTallyMaster?: string | null;
  mappingStatus?: string;
  exactError?: string | null;
  action?: string | null;
  xmlContext?: string | null;
  tallyGuid?: string | null;
};

export type TallyExportReadiness = {
  ready: boolean;
  status: TallyExportReadinessStatus | string;
  label: string;
  issues?: Array<{ code?: string; label?: string; message?: string; action?: string }>;
  primaryIssue?: { code?: string; label?: string; message?: string; action?: string } | null;
  masterReferences?: TallyMasterReference[];
  blockingMasterCount?: number;
};

export function tallyTransportationMappingHref(opts: {
  salesBillId: number;
  returnPath?: string;
}): string {
  const returnTo = opts.returnPath ?? `/sales-bills/${opts.salesBillId}`;
  const q = new URLSearchParams({
    section: "tally-ledgers",
    focus: "transportation",
    returnTo,
  });
  return `/admin/settings?${q.toString()}`;
}

export function parseSalesBillTallyExportError(payload: unknown): {
  message: string;
  code: string | null;
  action: string | null;
  readiness: TallyExportReadiness | null;
} {
  const err =
    payload && typeof payload === "object" && "error" in payload
      ? (payload as { error?: Record<string, unknown> }).error
      : null;
  const message =
    err && typeof err.message === "string" && err.message.trim()
      ? err.message
      : "Could not export to Tally";
  const code = err && typeof err.code === "string" ? err.code : null;
  const action = err && typeof err.action === "string" ? err.action : null;
  const readiness =
    err && err.tallyExportReadiness && typeof err.tallyExportReadiness === "object"
      ? (err.tallyExportReadiness as TallyExportReadiness)
      : null;
  return { message, code, action, readiness };
}

export function isMissingTransportationLedgerError(message: string, code?: string | null): boolean {
  if (code === "MISSING_TRANSPORTATION_LEDGER_MAPPING") return true;
  return /Transportation Charges is not mapped to a Tally ledger/i.test(message);
}
