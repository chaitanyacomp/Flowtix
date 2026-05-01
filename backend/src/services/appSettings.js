const { prisma } = require("../utils/prisma");
const { normalizeStockAdjustmentPolicy } = require("./stockAdjustmentPolicy");

async function ensureAppSettings() {
  await prisma.appSetting.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      maxRegularSoBufferPercent: 10,
      strictInventoryControl: false,
      stockAdjustmentReverseRoles: "ADMIN_ONLY",
      stockAdjustmentReverseWindowType: "HOURS",
      stockAdjustmentReverseWindowValue: 24,
      stockAdjustmentCreateRoles: "ADMIN_AND_STORE",
    },
    update: {},
  });
}

async function getStrictInventoryControl() {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({ where: { id: 1 } });
  return Boolean(row?.strictInventoryControl);
}

async function setStrictInventoryControl(value) {
  await ensureAppSettings();
  return prisma.appSetting.update({
    where: { id: 1 },
    data: { strictInventoryControl: Boolean(value) },
  });
}

async function getStockAdjustmentPolicy() {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({ where: { id: 1 } });
  return normalizeStockAdjustmentPolicy(row);
}

/**
 * @param {{
 *   stockAdjustmentReverseRoles: string;
 *   stockAdjustmentReverseWindowType: string;
 *   stockAdjustmentReverseWindowValue: number;
 *   stockAdjustmentCreateRoles: string;
 * }} data — caller validates (e.g. zod); values are normalized before persist
 */
async function updateStockAdjustmentPolicy(data) {
  await ensureAppSettings();
  const normalized = normalizeStockAdjustmentPolicy(data);
  await prisma.appSetting.update({
    where: { id: 1 },
    data: {
      stockAdjustmentReverseRoles: normalized.stockAdjustmentReverseRoles,
      stockAdjustmentReverseWindowType: normalized.stockAdjustmentReverseWindowType,
      stockAdjustmentReverseWindowValue: normalized.stockAdjustmentReverseWindowValue,
      stockAdjustmentCreateRoles: normalized.stockAdjustmentCreateRoles,
    },
  });
  return getStockAdjustmentPolicy();
}

async function getCompanyState() {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({ where: { id: 1 }, select: { companyState: true } });
  return row?.companyState ?? null;
}

async function getCompanyStateDetails() {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: {
      companyState: true,
      companyStateId: true,
      companyGstin: true,
      companyStateRef: { select: { id: true, stateName: true, stateCode: true } },
    },
  });
  return {
    companyState: row?.companyState ?? null,
    companyStateId: row?.companyStateId ?? null,
    companyStateName: row?.companyStateRef?.stateName ?? null,
    companyStateCode: row?.companyStateRef?.stateCode ?? null,
    companyGstin: row?.companyGstin ?? null,
  };
}

/**
 * @param {string | null | undefined} raw — `undefined` = no change (caller omitted field)
 */
async function setCompanyState(raw) {
  await ensureAppSettings();
  if (raw === undefined) {
    return getCompanyState();
  }
  let companyState = null;
  if (raw !== null) {
    const t = String(raw).trim();
    companyState = t === "" ? null : t.slice(0, 128);
  }
  await prisma.appSetting.update({
    where: { id: 1 },
    data: { companyState },
  });
  return companyState;
}

/**
 * Backward-safe setter:
 * - companyStateId: structured state link (preferred)
 * - companyState: legacy free-text (kept for compatibility)
 */
async function setCompanyStateDetails({ companyStateId, companyState }) {
  await ensureAppSettings();

  const next = {};
  if (companyStateId !== undefined) {
    next.companyStateId = companyStateId === null ? null : Number(companyStateId);
  }
  if (companyState !== undefined) {
    let val = null;
    if (companyState !== null) {
      const t = String(companyState).trim();
      val = t === "" ? null : t.slice(0, 128);
    }
    next.companyState = val;
  }

  if (Object.keys(next).length) {
    await prisma.appSetting.update({ where: { id: 1 }, data: next });
  }
  return getCompanyStateDetails();
}

function normalizeCompanyGstin(raw) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  const t = String(raw).trim().toUpperCase();
  return t === "" ? null : t.slice(0, 15);
}

async function setCompanyGstDetails({ companyStateId, companyState, companyGstin }) {
  await ensureAppSettings();

  const next = {};
  if (companyStateId !== undefined) {
    next.companyStateId = companyStateId === null ? null : Number(companyStateId);
  }
  if (companyState !== undefined) {
    let val = null;
    if (companyState !== null) {
      const t = String(companyState).trim();
      val = t === "" ? null : t.slice(0, 128);
    }
    next.companyState = val;
  }
  const gst = normalizeCompanyGstin(companyGstin);
  if (gst !== undefined) {
    next.companyGstin = gst;
  }

  if (Object.keys(next).length) {
    await prisma.appSetting.update({ where: { id: 1 }, data: next });
  }
  return getCompanyStateDetails();
}

const { clampMaxRegularSoBufferPercent } = require("./regularSoBufferQty");

async function getMaxRegularSoBufferPercent() {
  await ensureAppSettings();
  const row = await prisma.appSetting.findUnique({
    where: { id: 1 },
    select: { maxRegularSoBufferPercent: true },
  });
  return clampMaxRegularSoBufferPercent(row?.maxRegularSoBufferPercent);
}

/**
 * @param {number} pct
 */
async function setMaxRegularSoBufferPercent(pct) {
  await ensureAppSettings();
  const v = clampMaxRegularSoBufferPercent(pct);
  await prisma.appSetting.update({
    where: { id: 1 },
    data: { maxRegularSoBufferPercent: v },
  });
  return v;
}

module.exports = {
  ensureAppSettings,
  getMaxRegularSoBufferPercent,
  setMaxRegularSoBufferPercent,
  getStrictInventoryControl,
  setStrictInventoryControl,
  getStockAdjustmentPolicy,
  updateStockAdjustmentPolicy,
  getCompanyState,
  setCompanyState,
  getCompanyStateDetails,
  setCompanyStateDetails,
  setCompanyGstDetails,
};
