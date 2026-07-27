/**
 * Sales Bill transporter + transport field validation (no GST/billing math).
 */

const TRANSPORT_REFERENCE_MAX_LEN = 64;
/** Letters, digits, spaces, and common logistics punctuation only. */
const TRANSPORT_REFERENCE_ALLOWED = /^[A-Za-z0-9][A-Za-z0-9 .\-\/_]*$/;
const TRANSPORT_AMOUNT_MAX_DECIMALS = 2;

function trimText(value) {
  if (value == null) return "";
  return String(value).trim();
}

function trimNullable(value) {
  const t = trimText(value);
  return t === "" ? null : t;
}

/**
 * Strict transportation amount: 0 or positive, max 2 decimals.
 * Rejects text, commas, negatives, and excess fraction digits.
 * @param {unknown} value
 * @returns {{ ok: true; value: number } | { ok: false; message: string }}
 */
function normalizeTransportationAmount(value) {
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

/**
 * @param {{ amount?: unknown; chargedBy?: string | null }} input
 */
function isSalesBillTransporterRequired(input) {
  const amountGate = normalizeTransportationAmount(input?.amount);
  const amount = amountGate.ok ? amountGate.value : 0;
  const chargedBy = String(input?.chargedBy || "OUR_COMPANY");
  if (amount > 1e-9) return true;
  if (chargedBy === "TRANSPORTER_DIRECTLY") return true;
  return false;
}

function isSalesBillTransportDetailsApplicable(input) {
  return isSalesBillTransporterRequired(input);
}

/**
 * @param {unknown} value
 * @returns {{ ok: true; value: string | null } | { ok: false; message: string }}
 */
function normalizeTransportReferenceNo(value) {
  if (value == null || value === undefined) return { ok: true, value: null };
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
 * @param {unknown} value
 * @returns {{ ok: true; value: string | null } | { ok: false; message: string }}
 */
function normalizeVehicleNumber(value) {
  if (value == null || value === undefined) return { ok: true, value: null };
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

/**
 * @param {{
 *   amount?: unknown;
 *   chargedBy?: string | null;
 *   transporterId?: unknown;
 *   transporterName?: unknown;
 *   referenceNo?: unknown;
 *   vehicleNumber?: unknown;
 *   allowLegacyNameOnly?: boolean;
 *   allowLegacyVehicleOmit?: boolean;
 * }} input
 */
function validateSalesBillTransportationInput(input = {}) {
  const amountGate = normalizeTransportationAmount(input.amount);
  if (!amountGate.ok) return amountGate;
  const amount = amountGate.value;

  const chargedBy = String(input.chargedBy || "OUR_COMPANY");
  if (chargedBy !== "OUR_COMPANY" && chargedBy !== "TRANSPORTER_DIRECTLY") {
    return { ok: false, message: "Invalid transportation charged-by value." };
  }

  const ref = normalizeTransportReferenceNo(input.referenceNo);
  if (!ref.ok) return ref;

  const vehicle = normalizeVehicleNumber(input.vehicleNumber);
  if (!vehicle.ok) return vehicle;

  const required = isSalesBillTransporterRequired({ amount, chargedBy });
  const transporterId = Number(input.transporterId);
  const hasId = Number.isFinite(transporterId) && transporterId > 0;
  const legacyName = trimNullable(input.transporterName);

  if (required) {
    if (!hasId) {
      if (!(input.allowLegacyNameOnly && legacyName)) {
        return { ok: false, message: "Transporter Name is required when transportation applies." };
      }
    }
    if (!vehicle.value && !input.allowLegacyVehicleOmit) {
      return { ok: false, message: "Enter a valid vehicle number." };
    }
  }

  return {
    ok: true,
    value: {
      amount,
      chargedBy,
      transporterId: hasId ? transporterId : null,
      transporterName: legacyName,
      referenceNo: ref.value,
      vehicleNumber: vehicle.value,
      required,
    },
  };
}

module.exports = {
  TRANSPORT_REFERENCE_MAX_LEN,
  TRANSPORT_REFERENCE_ALLOWED,
  TRANSPORT_AMOUNT_MAX_DECIMALS,
  isSalesBillTransporterRequired,
  isSalesBillTransportDetailsApplicable,
  normalizeTransportationAmount,
  normalizeTransportReferenceNo,
  normalizeVehicleNumber,
  validateSalesBillTransportationInput,
  trimNullable,
};
