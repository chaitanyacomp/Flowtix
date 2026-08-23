/**
 * Display labels for machine-run purge detection in planning workspace.
 * Physical mould/setup confirmation is separate and must not appear under Purge Detection.
 */

export type PurgingDetectionDisplayInput = {
  purgingDetectionStatus?: string | null;
  purgingDetectionLabel?: string | null;
  purgingDetectionReason?: string | null;
  purgingRequired?: boolean | null;
  conservativePurgePlan?: boolean | null;
  purgingOverrideReason?: string | null;
};

export function formatPurgingDetectionDisplay(input: PurgingDetectionDisplayInput): {
  label: string;
  reason: string | null;
} {
  const status = String(input.purgingDetectionStatus ?? "").trim().toUpperCase();
  const explicit = String(input.purgingDetectionLabel ?? "").trim();
  if (explicit) {
    return {
      label: explicit,
      reason: input.purgingDetectionReason ?? null,
    };
  }

  if (status === "OVERRIDDEN") {
    const reason = String(input.purgingOverrideReason ?? input.purgingDetectionReason ?? "").trim();
    const required = input.purgingRequired === true;
    return {
      label: required
        ? `Override — purge required${reason ? ` (${reason})` : ""}`
        : `Override — no purge${reason ? ` (${reason})` : ""}`,
      reason: reason || null,
    };
  }

  if (status === "CONFIRMATION_REQUIRED" || input.conservativePurgePlan === true) {
    return {
      label: "Conservative purge planned",
      reason:
        input.purgingDetectionReason?.trim() ||
        "Machine material state is unknown; operator confirms at production start.",
    };
  }

  if (status === "AUTO_NOT_REQUIRED") {
    return {
      label: "No purge — same material retained",
      reason: input.purgingDetectionReason ?? null,
    };
  }

  if (status === "AUTO_REQUIRED") {
    const reason = String(input.purgingDetectionReason ?? "");
    if (/cleared/i.test(reason)) {
      return { label: "Purge required — machine cleared", reason: reason || null };
    }
    return { label: "Purge required — material changed", reason: reason || null };
  }

  if (input.purgingRequired === true) {
    return { label: "Purge required — material changed", reason: input.purgingDetectionReason ?? null };
  }
  if (input.purgingRequired === false) {
    return { label: "No purge — same material retained", reason: input.purgingDetectionReason ?? null };
  }

  return { label: "Detection pending", reason: null };
}
