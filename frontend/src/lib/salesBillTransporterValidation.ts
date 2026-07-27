/**
 * Sales Bill transporter + transport field validation (mirrors backend rules).
 * Does not change GST / billing allocation math.
 */

export const TRANSPORT_REFERENCE_MAX_LEN = 64;
export const TRANSPORT_REFERENCE_ALLOWED = /^[A-Za-z0-9][A-Za-z0-9 .\-\/_]*$/;
export const TRANSPORT_AMOUNT_MAX_DECIMALS = 2;

export function trimText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/** Intermediate draft for transportation charges — digits and at most 2 decimal places; rejects commas. */
export function sanitizeTransportationChargeDraft(raw: string): string | null {
  const value = String(raw ?? "");
  if (value === "") return "";
  if (/[,\s]/.test(value)) return null;
  if (!/^\d*\.?\d{0,2}$/.test(value)) return null;
  return value;
}

/**
 * Strict transportation amount: 0 or positive, max 2 decimals.
 * Rejects text, commas, negatives, and excess fraction digits.
 */
export function normalizeTransportationAmount(
  value: unknown,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value == null || value === "") return { ok: true, value: 0 };
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return { ok: false, message: "Transportation charges must be zero or a positive amount." };
    }
    const scaled = value * 100;
    if (Math.abs(scaled - Math.round(scaled)) > 1e-8) {
      return { ok: false, message: "Transportation charges may have at most 2 decimal places." };
    }
    return { ok: true, value: Math.round(scaled) / 100 };
  }
  const raw = String(value).trim();
  if (!raw) return { ok: true, value: 0 };
  if (/,/.test(raw) || /[^\d.]/.test(raw) || (raw.match(/\./g) || []).length > 1) {
    return {
      ok: false,
      message: "Transportation charges must be a valid number with at most 2 decimal places.",
    };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return {
      ok: false,
      message: "Transportation charges must be a valid number with at most 2 decimal places.",
    };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: "Transportation charges must be zero or a positive amount." };
  }
  return { ok: true, value: n };
}

export function isSalesBillTransporterRequired(input: {
  amount?: unknown;
  chargedBy?: string | null;
}): boolean {
  const amountGate = normalizeTransportationAmount(input?.amount);
  const amount = amountGate.ok ? amountGate.value : 0;
  const chargedBy = String(input?.chargedBy || "OUR_COMPANY");
  if (amount > 1e-9) return true;
  if (chargedBy === "TRANSPORTER_DIRECTLY") return true;
  return false;
}

/** Transport details (vehicle etc.) apply under the same conditions as transporter. */
export function isSalesBillTransportDetailsApplicable(input: {
  amount?: unknown;
  chargedBy?: string | null;
}): boolean {
  return isSalesBillTransporterRequired(input);
}

export function normalizeTransportReferenceNo(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value == null) return { ok: true, value: null };
  const trimmed = trimText(value);
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > TRANSPORT_REFERENCE_MAX_LEN) {
    return {
      ok: false,
      message: `LR / Transport Reference must be at most ${TRANSPORT_REFERENCE_MAX_LEN} characters.`,
    };
  }
  if (!TRANSPORT_REFERENCE_ALLOWED.test(trimmed)) {
    return {
      ok: false,
      message:
        "LR / Transport Reference may only contain letters, numbers, spaces, and . - / _ characters.",
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Indian vehicle registration: standard state series, BH-series, and common temporary formats.
 * Accepts mixed case / spaces / hyphens while typing; stores trimmed uppercase with normalized spaces.
 */
export function normalizeVehicleNumber(
  value: unknown,
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (value == null) return { ok: true, value: null };
  const trimmed = trimText(value);
  if (!trimmed) return { ok: true, value: null };

  const compact = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!compact) {
    return { ok: false, message: "Enter a valid vehicle number." };
  }

  let m = compact.match(/^([0-9]{2})BH([0-9]{4})([A-Z]{1,2})$/);
  if (m) return { ok: true, value: `${m[1]} BH ${m[2]} ${m[3]}` };

  m = compact.match(/^TEMP([A-Z]{2})([0-9]{1,6})$/);
  if (m) return { ok: true, value: `TEMP ${m[1]} ${m[2]}` };

  m = compact.match(/^TEMP([0-9]{1,6})$/);
  if (m) return { ok: true, value: `TEMP ${m[1]}` };

  m = compact.match(/^([A-Z]{2})([0-9]{1,2})TEMP([0-9]{1,5})$/);
  if (m) return { ok: true, value: `${m[1]} ${m[2]} TEMP ${m[3]}` };

  m = compact.match(/^([A-Z]{2})([0-9]{1,2})T([0-9]{1,5})$/);
  if (m) return { ok: true, value: `${m[1]} ${m[2]} T ${m[3]}` };

  m = compact.match(/^([A-Z]{2})([0-9]{1,2})([A-Z]{1,3})([0-9]{1,4})$/);
  if (m) return { ok: true, value: `${m[1]} ${m[2]} ${m[3]} ${m[4]}` };

  return { ok: false, message: "Enter a valid vehicle number." };
}

/** Display helper — keeps legacy combined reference readable when vehicleNumber was never set. */
export function formatSalesBillTransportRefs(bill: {
  transportationReferenceNo?: string | null;
  vehicleNumber?: string | null;
}): {
  lrLabel: string;
  lrValue: string | null;
  vehicleValue: string | null;
  isLegacyCombined: boolean;
} {
  const vehicle = trimText(bill.vehicleNumber) || null;
  const ref = trimText(bill.transportationReferenceNo) || null;
  if (vehicle) {
    return {
      lrLabel: "LR / Transport Reference",
      lrValue: ref,
      vehicleValue: vehicle,
      isLegacyCombined: false,
    };
  }
  if (ref) {
    return {
      lrLabel: "LR / vehicle / ref (legacy)",
      lrValue: ref,
      vehicleValue: null,
      isLegacyCombined: true,
    };
  }
  return {
    lrLabel: "LR / Transport Reference",
    lrValue: null,
    vehicleValue: null,
    isLegacyCombined: false,
  };
}

export function validateSalesBillTransportationInput(input: {
  amount?: unknown;
  chargedBy?: string | null;
  transporterId?: unknown;
  transporterName?: unknown;
  referenceNo?: unknown;
  vehicleNumber?: unknown;
  allowLegacyNameOnly?: boolean;
  /** Historical bills without a split vehicle field. */
  allowLegacyVehicleOmit?: boolean;
}):
  | { ok: true }
  | {
      ok: false;
      message: string;
      field?: "transporter" | "referenceNo" | "vehicleNumber" | "amount";
    } {
  const amountGate = normalizeTransportationAmount(input.amount);
  if (!amountGate.ok) return { ok: false, message: amountGate.message, field: "amount" };
  const amount = amountGate.value;

  const chargedBy = String(input.chargedBy || "OUR_COMPANY");
  const ref = normalizeTransportReferenceNo(input.referenceNo);
  if (!ref.ok) return { ok: false, message: ref.message, field: "referenceNo" };

  const vehicle = normalizeVehicleNumber(input.vehicleNumber);
  if (!vehicle.ok) return { ok: false, message: vehicle.message, field: "vehicleNumber" };

  const required = isSalesBillTransporterRequired({ amount, chargedBy });
  const transporterId = Number(input.transporterId);
  const hasId = Number.isFinite(transporterId) && transporterId > 0;
  const legacyName = trimText(input.transporterName);

  if (required && !hasId) {
    if (!(input.allowLegacyNameOnly && legacyName)) {
      return {
        ok: false,
        message: "Transporter Name is required when transportation applies.",
        field: "transporter",
      };
    }
  }

  if (required && !vehicle.value && !input.allowLegacyVehicleOmit) {
    return {
      ok: false,
      message: "Enter a valid vehicle number.",
      field: "vehicleNumber",
    };
  }

  return { ok: true };
}
