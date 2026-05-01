const { prisma } = require("../utils/prisma");

function normalizeStateKey(raw) {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return t.length ? t : "";
}

/**
 * India states/UTs GST codes (2-digit, string).
 * Notes:
 * - Names are kept clean for UI display.
 * - Codes are GST-style state codes used in Tally.
 */
const INDIA_STATES = [
  { stateName: "Jammu and Kashmir", stateCode: "01" },
  { stateName: "Himachal Pradesh", stateCode: "02" },
  { stateName: "Punjab", stateCode: "03" },
  { stateName: "Chandigarh", stateCode: "04" },
  { stateName: "Uttarakhand", stateCode: "05" },
  { stateName: "Haryana", stateCode: "06" },
  { stateName: "Delhi", stateCode: "07" },
  { stateName: "Rajasthan", stateCode: "08" },
  { stateName: "Uttar Pradesh", stateCode: "09" },
  { stateName: "Bihar", stateCode: "10" },
  { stateName: "Sikkim", stateCode: "11" },
  { stateName: "Arunachal Pradesh", stateCode: "12" },
  { stateName: "Nagaland", stateCode: "13" },
  { stateName: "Manipur", stateCode: "14" },
  { stateName: "Mizoram", stateCode: "15" },
  { stateName: "Tripura", stateCode: "16" },
  { stateName: "Meghalaya", stateCode: "17" },
  { stateName: "Assam", stateCode: "18" },
  { stateName: "West Bengal", stateCode: "19" },
  { stateName: "Jharkhand", stateCode: "20" },
  { stateName: "Odisha", stateCode: "21" },
  { stateName: "Chhattisgarh", stateCode: "22" },
  { stateName: "Madhya Pradesh", stateCode: "23" },
  { stateName: "Gujarat", stateCode: "24" },
  { stateName: "Dadra and Nagar Haveli and Daman and Diu", stateCode: "26" },
  { stateName: "Maharashtra", stateCode: "27" },
  { stateName: "Karnataka", stateCode: "29" },
  { stateName: "Goa", stateCode: "30" },
  { stateName: "Lakshadweep", stateCode: "31" },
  { stateName: "Kerala", stateCode: "32" },
  { stateName: "Tamil Nadu", stateCode: "33" },
  { stateName: "Puducherry", stateCode: "34" },
  { stateName: "Andaman and Nicobar Islands", stateCode: "35" },
  { stateName: "Telangana", stateCode: "36" },
  { stateName: "Andhra Pradesh", stateCode: "37" },
  { stateName: "Ladakh", stateCode: "38" },
];

/**
 * Upsert the India State master list. Safe to run on every startup.
 */
async function ensureIndiaStatesSeeded() {
  for (const s of INDIA_STATES) {
    await prisma.state.upsert({
      where: { stateCode: s.stateCode },
      update: { stateName: s.stateName, isActive: true },
      create: { stateName: s.stateName, stateCode: s.stateCode, isActive: true },
    });
  }
}

function buildStateMatchIndex(states) {
  const byCode = new Map();
  const byNameKey = new Map();

  for (const s of states) {
    byCode.set(String(s.stateCode), s);
    byNameKey.set(normalizeStateKey(s.stateName), s);
  }

  // Minimal aliases for common legacy values (kept small on purpose for safety).
  const alias = new Map([
    ["nct delhi", "07"],
    ["new delhi", "07"],
    ["delhi nct", "07"],
    ["orissa", "21"],
    ["odissa", "21"],
    ["pondicherry", "34"],
    ["puducherry", "34"],
    ["j&k", "01"],
    ["jammu & kashmir", "01"],
    ["dadra and nagar haveli", "26"],
    ["daman and diu", "26"],
    ["dadra & nagar haveli", "26"],
  ]);

  return { byCode, byNameKey, alias };
}

function tryResolveStateId({ legacyStateText, statesIndex }) {
  const raw = String(legacyStateText ?? "").trim();
  if (!raw) return null;

  const key = normalizeStateKey(raw);
  if (!key) return null;

  // If user stored the 2-digit GST code directly.
  const digits = key.replace(/[^\d]/g, "");
  if (digits.length === 2 && statesIndex.byCode.has(digits)) {
    return statesIndex.byCode.get(digits).id;
  }

  const aliasCode = statesIndex.alias.get(key);
  if (aliasCode && statesIndex.byCode.has(aliasCode)) {
    return statesIndex.byCode.get(aliasCode).id;
  }

  const direct = statesIndex.byNameKey.get(key);
  if (direct) return direct.id;

  return null;
}

/**
 * Backfill nullable stateId columns from legacy free-text state fields.
 * - Does NOT overwrite existing stateId.
 * - Leaves unmatched legacy text as-is (no hard blocking).
 */
async function backfillLegacyStateLinks() {
  const states = await prisma.state.findMany({ where: { isActive: true } });
  const idx = buildStateMatchIndex(states);

  const suppliers = await prisma.supplier.findMany({
    where: { stateId: null, state: { not: null } },
    select: { id: true, state: true },
  });
  for (const s of suppliers) {
    const stateId = tryResolveStateId({ legacyStateText: s.state, statesIndex: idx });
    if (stateId) {
      await prisma.supplier.update({ where: { id: s.id }, data: { stateId } });
    }
  }

  const customers = await prisma.customer.findMany({
    where: { stateId: null, state: { not: null } },
    select: { id: true, state: true },
  });
  for (const c of customers) {
    const stateId = tryResolveStateId({ legacyStateText: c.state, statesIndex: idx });
    if (stateId) {
      await prisma.customer.update({ where: { id: c.id }, data: { stateId } });
    }
  }

  const app = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { id: true, companyStateId: true, companyState: true },
  });
  if (app && app.companyStateId == null && app.companyState != null) {
    const stateId = tryResolveStateId({ legacyStateText: app.companyState, statesIndex: idx });
    if (stateId) {
      await prisma.appSetting.update({ where: { id: 1 }, data: { companyStateId: stateId } });
    }
  }
}

module.exports = {
  INDIA_STATES,
  ensureIndiaStatesSeeded,
  backfillLegacyStateLinks,
  normalizeStateKey,
  tryResolveStateId,
};

