/**
 * Maps operational status labels to the global ERP status chip tone families.
 * UI-only — does not change business status values from the API.
 */
export type ErpStatusTone = "success" | "warning" | "info" | "danger" | "neutral";

export type ErpStatusToneInput = ErpStatusTone | string | null | undefined;

function norm(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, "_");
}

const SUCCESS = new Set([
  "APPROVED",
  "QC_DONE",
  "QC_PASSED",
  "PASSED",
  "COMPLETED",
  "COMPLETE",
  "FINALIZED",
  "FINALISED",
  "LOCKED",
  "EXPORTED",
  "EXPORTED_TO_TALLY",
  "DELIVERED",
  "DONE",
  "ACTIVE_CYCLE",
  "ACTIVE",
]);

const WARNING = new Set([
  "PENDING",
  "PENDING_QC",
  "DRAFT",
  "HOLD",
  "ON_HOLD",
  "OPEN",
  "IN_PROGRESS",
  "IN_PROCESS",
  "PARTLY_DELIVERED",
  "PARTIAL",
  "SALES_BILL_PENDING",
  "UNLOCKED",
  "NOT_EXPORTED",
]);

const DANGER = new Set([
  "REJECTED",
  "FAILED",
  "CANCELLED",
  "CANCELED",
  "REVERSED",
  "REVERSE",
  "ERROR",
  "BLOCKED",
]);

const INFO = new Set([
  "REGULAR",
  "NO_QTY",
  "NOQTY",
  "INFO",
  "OPERATIONAL",
  "CLOSED",
  "CLOSED_CYCLE",
]);

/** Resolve a status label (or explicit tone) to a chip tone. */
export function resolveErpStatusTone(input: ErpStatusToneInput): ErpStatusTone {
  if (input == null || input === "") return "neutral";
  const raw = String(input).trim();
  if (raw === "success" || raw === "warning" || raw === "info" || raw === "danger" || raw === "neutral") {
    return raw;
  }
  const n = norm(raw);
  if (SUCCESS.has(n)) return "success";
  if (DANGER.has(n)) return "danger";
  if (WARNING.has(n)) return "warning";
  if (INFO.has(n)) return "info";
  if (n.includes("PENDING") || n.includes("DRAFT") || n.includes("HOLD")) return "warning";
  if (n.includes("REJECT") || n.includes("FAIL") || n.includes("CANCEL")) return "danger";
  if (n.includes("APPROV") || n.includes("COMPLET") || n.includes("FINAL") || n.includes("DONE")) return "success";
  if (n.includes("NO_QTY") || n.includes("REGULAR")) return "info";
  return "neutral";
}

/** Badge variant key aligned with `components/ui/badge`. */
export function erpStatusToneToBadgeVariant(
  tone: ErpStatusTone,
): "default" | "success" | "warning" | "info" | "rejected" {
  if (tone === "danger") return "rejected";
  if (tone === "neutral") return "default";
  return tone;
}

/** Human-readable chip label (sentence case for display). */
export function formatErpStatusLabel(label: string): string {
  const t = label.trim();
  if (!t) return "—";
  if (t === t.toUpperCase() && t.includes("_")) {
    return t
      .split("_")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" ");
  }
  return t;
}
