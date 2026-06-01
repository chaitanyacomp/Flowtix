const { prisma } = require("../utils/prisma");
const {
  normalizeGstinOnSave,
  validateGstinFormatMessage,
  validateGstinAgainstState,
  gstStateCodeFromGstin,
} = require("./gstinNormalize");

const DUPLICATE_GSTIN_MESSAGE = "This GSTIN is already registered to another customer or delivery address.";

function mapCustomerRow(row) {
  if (!row) return null;
  const deliveryAddresses = (row.deliveryAddresses ?? []).map(mapDeliveryAddressRow);
  return {
    id: row.id,
    name: row.name,
    contact: row.contact ?? null,
    email: row.email ?? null,
    address: row.address ?? null,
    gst: row.gst ?? null,
    gstin: row.gst ?? null,
    state: row.state ?? null,
    stateId: row.stateId ?? null,
    stateName: row.stateRef?.stateName ?? null,
    stateCode: row.stateRef?.stateCode ?? null,
    isActive: row.isActive !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deliveryAddresses,
    deliveryAddressCount: deliveryAddresses.length,
  };
}

function mapDeliveryAddressRow(row) {
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    address: row.address ?? null,
    city: row.city ?? null,
    stateId: row.stateId ?? null,
    stateName: row.stateRef?.stateName ?? null,
    stateCode: row.stateRef?.stateCode ?? null,
    gstin: row.gst ?? null,
    contactPerson: row.contactPerson ?? null,
    phone: row.phone ?? null,
    isDefault: Boolean(row.isDefault),
    isActive: row.isActive !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const customerInclude = {
  stateRef: { select: { id: true, stateName: true, stateCode: true } },
  deliveryAddresses: {
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
  },
};

async function loadActiveStateById(stateId) {
  if (stateId == null) return null;
  const id = Number(stateId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const state = await prisma.state.findUnique({
    where: { id },
    select: { id: true, stateName: true, stateCode: true, isActive: true },
  });
  if (!state || !state.isActive) return null;
  return state;
}

async function loadActiveStateByCode(stateCode) {
  const code = gstStateCodeFromGstin(stateCode) ?? String(stateCode ?? "").trim();
  if (!/^\d{2}$/.test(code)) return null;
  return prisma.state.findFirst({
    where: { stateCode: code, isActive: true },
    select: { id: true, stateName: true, stateCode: true, isActive: true },
  });
}

async function assertGstinUnique(gstin, opts = {}) {
  const normalized = normalizeGstinOnSave(gstin);
  if (!normalized) return;

  const excludeCustomerId = opts.excludeCustomerId != null ? Number(opts.excludeCustomerId) : null;
  const excludeDeliveryAddressIds = new Set(
    (opts.excludeDeliveryAddressIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0),
  );
  const forDeliveryAddress = Boolean(opts.forDeliveryAddress);

  const customerHit = await prisma.customer.findFirst({
    where: {
      gst: normalized,
      ...(excludeCustomerId ? { NOT: { id: excludeCustomerId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (customerHit) {
    const err = new Error(DUPLICATE_GSTIN_MESSAGE);
    err.statusCode = 409;
    throw err;
  }

  if (forDeliveryAddress && excludeCustomerId) {
    const parent = await prisma.customer.findUnique({
      where: { id: excludeCustomerId },
      select: { gst: true },
    });
    if (parent?.gst === normalized) {
      const err = new Error(DUPLICATE_GSTIN_MESSAGE);
      err.statusCode = 409;
      throw err;
    }
  }

  const addressHit = await prisma.customerDeliveryAddress.findFirst({
    where: {
      gst: normalized,
      ...(excludeDeliveryAddressIds.size
        ? { NOT: { id: { in: [...excludeDeliveryAddressIds] } } }
        : {}),
    },
    select: { id: true, label: true, customerId: true },
  });
  if (addressHit) {
    const err = new Error(DUPLICATE_GSTIN_MESSAGE);
    err.statusCode = 409;
    throw err;
  }
}

async function validateRegisteredGstin(gstin, stateId) {
  const normalized = normalizeGstinOnSave(gstin);
  if (!normalized) {
    if (stateId != null) {
      const manualState = await loadActiveStateById(stateId);
      if (!manualState) {
        const err = new Error("Invalid state. Choose a valid state.");
        err.statusCode = 400;
        throw err;
      }
      return { gst: null, stateId: manualState.id, state: manualState.stateName };
    }
    return { gst: null, stateId: null, state: null };
  }

  const formatMsg = validateGstinFormatMessage(normalized);
  if (formatMsg) {
    const err = new Error(formatMsg);
    err.statusCode = 400;
    throw err;
  }

  let resolvedState = stateId != null ? await loadActiveStateById(stateId) : null;
  if (!resolvedState) {
    resolvedState = await loadActiveStateByCode(normalized);
  }
  const stateErr = validateGstinAgainstState(normalized, resolvedState ?? {});
  if (stateErr) {
    const err = new Error(stateErr);
    err.statusCode = 400;
    throw err;
  }

  return {
    gst: normalized,
    stateId: resolvedState?.id ?? null,
    state: resolvedState?.stateName ?? null,
  };
}

function normalizeDeliveryAddressInput(raw, index) {
  const label = String(raw.label ?? "").trim();
  if (!label) {
    const err = new Error(`Delivery address ${index + 1}: label is required.`);
    err.statusCode = 400;
    throw err;
  }
  const address = raw.address != null ? String(raw.address).trim() || null : null;
  const city = raw.city != null ? String(raw.city).trim() || null : null;
  const contactPerson = raw.contactPerson != null ? String(raw.contactPerson).trim() || null : null;
  const phone = raw.phone != null ? String(raw.phone).trim() || null : null;
  const gstRaw = raw.gstin !== undefined ? raw.gstin : raw.gst;
  const gst = normalizeGstinOnSave(gstRaw);
  return {
    id: raw.id != null && Number(raw.id) > 0 ? Number(raw.id) : null,
    label: label.slice(0, 128),
    address,
    city: city ? city.slice(0, 128) : null,
    stateId: raw.stateId != null && Number(raw.stateId) > 0 ? Number(raw.stateId) : null,
    gst,
    contactPerson: contactPerson ? contactPerson.slice(0, 128) : null,
    phone: phone ? phone.slice(0, 32) : null,
    isDefault: Boolean(raw.isDefault),
    isActive: raw.isActive !== false,
  };
}

async function validateDeliveryAddresses(addresses, customerIdForExclude) {
  const normalized = (addresses ?? []).map(normalizeDeliveryAddressInput);
  const excludeIds = normalized.map((a) => a.id).filter(Boolean);

  for (let i = 0; i < normalized.length; i += 1) {
    const row = normalized[i];
    if (row.gst) {
      const formatMsg = validateGstinFormatMessage(row.gst);
      if (formatMsg) {
        const err = new Error(`Delivery address "${row.label}": ${formatMsg}`);
        err.statusCode = 400;
        throw err;
      }
      let state = row.stateId ? await loadActiveStateById(row.stateId) : null;
      if (!state) state = await loadActiveStateByCode(row.gst);
      const stateErr = validateGstinAgainstState(row.gst, state ?? {});
      if (stateErr) {
        const err = new Error(`Delivery address "${row.label}": ${stateErr}`);
        err.statusCode = 400;
        throw err;
      }
      row.stateId = state?.id ?? row.stateId;
      await assertGstinUnique(row.gst, {
        excludeCustomerId: customerIdForExclude,
        excludeDeliveryAddressIds: excludeIds,
        forDeliveryAddress: true,
      });
    } else if (row.stateId) {
      const state = await loadActiveStateById(row.stateId);
      if (!state) {
        const err = new Error(`Delivery address "${row.label}": invalid state.`);
        err.statusCode = 400;
        throw err;
      }
    }
  }

  let defaultApplied = false;
  for (const row of normalized) {
    if (row.isDefault && !defaultApplied) {
      row.isDefault = true;
      defaultApplied = true;
    } else {
      row.isDefault = false;
    }
  }
  if (!defaultApplied && normalized.length > 0) {
    normalized[0].isDefault = true;
  }

  return normalized;
}

async function syncDeliveryAddresses(tx, customerId, addresses) {
  const existing = await tx.customerDeliveryAddress.findMany({
    where: { customerId },
    select: { id: true },
  });
  const keepIds = new Set(addresses.map((a) => a.id).filter(Boolean));
  const deleteIds = existing.map((e) => e.id).filter((id) => !keepIds.has(id));
  if (deleteIds.length) {
    await tx.customerDeliveryAddress.deleteMany({ where: { id: { in: deleteIds } } });
  }

  for (const row of addresses) {
    const data = {
      label: row.label,
      address: row.address,
      city: row.city,
      stateId: row.stateId,
      gst: row.gst,
      contactPerson: row.contactPerson,
      phone: row.phone,
      isDefault: row.isDefault,
      isActive: row.isActive,
    };
    if (row.id) {
      await tx.customerDeliveryAddress.update({ where: { id: row.id }, data });
    } else {
      await tx.customerDeliveryAddress.create({
        data: { ...data, customerId },
      });
    }
  }
}

async function getCustomerById(id) {
  const row = await prisma.customer.findUnique({
    where: { id: Number(id) },
    include: customerInclude,
  });
  return mapCustomerRow(row);
}

module.exports = {
  DUPLICATE_GSTIN_MESSAGE,
  mapCustomerRow,
  mapDeliveryAddressRow,
  customerInclude,
  loadActiveStateById,
  loadActiveStateByCode,
  assertGstinUnique,
  validateRegisteredGstin,
  validateDeliveryAddresses,
  syncDeliveryAddresses,
  getCustomerById,
};
