/** Mirrors GET /api/settings/stock-adjustment-control payload (normalized). */
export type StockAdjustmentPolicyDto = {
  stockAdjustmentReverseRoles: "ADMIN_ONLY" | "ADMIN_AND_STORE";
  stockAdjustmentReverseWindowType: "SAME_DAY" | "HOURS" | "DAYS" | "NO_LIMIT";
  stockAdjustmentReverseWindowValue: number;
  stockAdjustmentCreateRoles: "ADMIN_ONLY" | "ADMIN_AND_STORE";
};

/** Safe defaults when API/DB is unavailable or response is partial. */
export const DEFAULT_STOCK_ADJUSTMENT_POLICY: StockAdjustmentPolicyDto = {
  stockAdjustmentReverseRoles: "ADMIN_ONLY",
  stockAdjustmentReverseWindowType: "HOURS",
  stockAdjustmentReverseWindowValue: 24,
  stockAdjustmentCreateRoles: "ADMIN_AND_STORE",
};

const WINDOW_TYPES: StockAdjustmentPolicyDto["stockAdjustmentReverseWindowType"][] = [
  "SAME_DAY",
  "HOURS",
  "DAYS",
  "NO_LIMIT",
];

/** Coerce any API payload to a valid DTO (never throws). */
export function parseStockAdjustmentPolicyDto(raw: unknown): StockAdjustmentPolicyDto {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STOCK_ADJUSTMENT_POLICY };
  const o = raw as Record<string, unknown>;
  const wt = o.stockAdjustmentReverseWindowType;
  const windowType = WINDOW_TYPES.includes(wt as StockAdjustmentPolicyDto["stockAdjustmentReverseWindowType"])
    ? (wt as StockAdjustmentPolicyDto["stockAdjustmentReverseWindowType"])
    : DEFAULT_STOCK_ADJUSTMENT_POLICY.stockAdjustmentReverseWindowType;
  const n = Number(o.stockAdjustmentReverseWindowValue);
  const windowValue =
    Number.isFinite(n) && n >= 1 ? Math.min(36500, Math.floor(n)) : DEFAULT_STOCK_ADJUSTMENT_POLICY.stockAdjustmentReverseWindowValue;
  return {
    stockAdjustmentReverseRoles:
      o.stockAdjustmentReverseRoles === "ADMIN_AND_STORE" ? "ADMIN_AND_STORE" : "ADMIN_ONLY",
    stockAdjustmentReverseWindowType: windowType,
    stockAdjustmentReverseWindowValue: windowValue,
    stockAdjustmentCreateRoles: o.stockAdjustmentCreateRoles === "ADMIN_ONLY" ? "ADMIN_ONLY" : "ADMIN_AND_STORE",
  };
}

function windowSentence(p: StockAdjustmentPolicyDto): string {
  switch (p.stockAdjustmentReverseWindowType) {
    case "NO_LIMIT":
      return "Reversal time limit: no limit.";
    case "SAME_DAY":
      return "Reversals must be on the same calendar day as the adjustment.";
    case "HOURS":
      return `Reversals allowed within ${p.stockAdjustmentReverseWindowValue} hour(s) of the adjustment.`;
    case "DAYS":
      return `Reversals allowed within ${p.stockAdjustmentReverseWindowValue} day(s) of the adjustment.`;
    default:
      return "";
  }
}

/** Single helper line for Stock Adjustment page (from live settings, not hardcoded rules). */
export function stockAdjustmentRuleHelperText(p: StockAdjustmentPolicyDto): string {
  const create =
    p.stockAdjustmentCreateRoles === "ADMIN_AND_STORE"
      ? "Administrators and Store can post adjustments."
      : "Only administrators can post adjustments.";
  const rev =
    p.stockAdjustmentReverseRoles === "ADMIN_AND_STORE"
      ? "Administrators and Store can reverse entries."
      : "Only administrators can reverse entries.";
  const win = windowSentence(p);
  return `Adjustments cannot be deleted. ${create} ${rev} ${win}`.replace(/\s+/g, " ").trim();
}

export function userCanReversePerPolicy(role: string | undefined, p: StockAdjustmentPolicyDto): boolean {
  if (role === "ADMIN") return true;
  if (p.stockAdjustmentReverseRoles === "ADMIN_AND_STORE" && role === "STORE") return true;
  return false;
}

export function userCanCreatePerPolicy(role: string | undefined, p: StockAdjustmentPolicyDto): boolean {
  if (role === "ADMIN") return true;
  if (p.stockAdjustmentCreateRoles === "ADMIN_AND_STORE" && role === "STORE") return true;
  return false;
}

/** Matches backend `sameLocalCalendarDay` — browser local timezone; keep labels in sync with server `TZ`. */
function sameLocalCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/** Whether to show Reverse for a row — client-side mirror of server window rules; backend enforces. */
export function canShowReverseAdjustmentButton(
  a: {
    transactionType: string;
    reversalOfId?: number | null;
    reversedAt?: string | null;
    date: string;
  },
  strict: boolean,
  policy: StockAdjustmentPolicyDto,
  role: string | undefined,
): boolean {
  if (strict) return false;
  if (!(a.transactionType === "ADJUSTMENT" && a.reversalOfId == null && !a.reversedAt)) return false;
  if (!userCanReversePerPolicy(role, policy)) return false;
  return reverseWithinWindowClient(a.date, policy);
}

export function reverseWithinWindowClient(isoDate: string, p: StockAdjustmentPolicyDto, now: Date = new Date()): boolean {
  const orig = new Date(isoDate);
  if (Number.isNaN(orig.getTime())) return false;
  if (p.stockAdjustmentReverseWindowType === "NO_LIMIT") return true;
  if (p.stockAdjustmentReverseWindowType === "SAME_DAY") {
    return sameLocalCalendarDay(orig, now);
  }
  const v = Math.max(1, p.stockAdjustmentReverseWindowValue);
  if (p.stockAdjustmentReverseWindowType === "HOURS") {
    return now.getTime() - orig.getTime() <= v * 3600 * 1000;
  }
  if (p.stockAdjustmentReverseWindowType === "DAYS") {
    return now.getTime() - orig.getTime() <= v * 24 * 3600 * 1000;
  }
  return true;
}
