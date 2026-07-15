const { prisma } = require("../utils/prisma");
const {
  normalizeGstinOnSave,
  validateGstinFormatMessage,
  validateGstinAgainstState,
  gstStateCodeFromGstin,
} = require("./gstinNormalize");

const DUPLICATE_GSTIN_MESSAGE = "This GSTIN is already registered to another customer.";

const LOCATION_TYPES = new Set(["REGISTERED_OFFICE", "PLANT", "WAREHOUSE", "DEPOT", "OTHER"]);

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
    deliveryLocations: deliveryAddresses,
    deliveryAddressCount: deliveryAddresses.length,
    deliveryLocationCount: deliveryAddresses.length,
  };
}

function mapDeliveryAddressRow(row) {
  const locationType = LOCATION_TYPES.has(row.locationType) ? row.locationType : "OTHER";
  return {
    id: row.id,
    customerId: row.customerId,
    label: row.label,
    locationLabel: row.label,
    locationType,
    address: row.address ?? null,
    city: row.city ?? null,
    district: row.district ?? null,
    stateId: row.stateId ?? null,
    stateName: row.stateRef?.stateName ?? null,
    stateCode: row.stateRef?.stateCode ?? null,
    pincode: row.pincode ?? null,
    country: row.country ?? null,
    gstin: row.gst ?? null,
    contactPerson: row.contactPerson ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    notes: row.notes ?? null,
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

/**
 * GSTIN uniqueness is cross-customer only.
 * Same GSTIN may exist on a customer and any of its own delivery locations.
 * Same GSTIN may also repeat across multiple locations for one customer.
 *
 * @param {string | null | undefined} gstin
 * @param {{ excludeCustomerId?: number | null; excludeDeliveryAddressIds?: number[]; forDeliveryAddress?: boolean; ownerCustomerId?: number | null }} [opts]
 */
async function assertGstinUnique(gstin, opts = {}) {
  const normalized = normalizeGstinOnSave(gstin);
  if (!normalized) return;

  const excludeCustomerId = opts.excludeCustomerId != null ? Number(opts.excludeCustomerId) : null;
  const ownerCustomerId =
    opts.ownerCustomerId != null
      ? Number(opts.ownerCustomerId)
      : opts.forDeliveryAddress && excludeCustomerId
        ? excludeCustomerId
        : null;

  // Another customer's registered GSTIN
  const customerHit = await prisma.customer.findFirst({
    where: {
      gst: normalized,
      ...(excludeCustomerId ? { NOT: { id: excludeCustomerId } } : {}),
      ...(ownerCustomerId ? { NOT: { id: ownerCustomerId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (customerHit) {
    const err = new Error(DUPLICATE_GSTIN_MESSAGE);
    err.statusCode = 409;
    throw err;
  }

  // Another customer's delivery location GSTIN (same customer locations are allowed)
  const addressHit = await prisma.customerDeliveryAddress.findFirst({
    where: {
      gst: normalized,
      ...(ownerCustomerId ? { NOT: { customerId: ownerCustomerId } } : {}),
      ...(excludeCustomerId && !ownerCustomerId ? { NOT: { customerId: excludeCustomerId } } : {}),
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

function normalizeLocationType(raw, label) {
  const t = String(raw || "").trim().toUpperCase();
  if (LOCATION_TYPES.has(t)) return t;
  const lbl = String(label || "").trim().toLowerCase();
  if (lbl === "registered office" || lbl === "primary") return "REGISTERED_OFFICE";
  if (/\bplant\b/.test(lbl)) return "PLANT";
  if (/\bwarehouse\b|\bgodown\b/.test(lbl)) return "WAREHOUSE";
  if (/\bdepot\b/.test(lbl)) return "DEPOT";
  return "OTHER";
}

function normalizeDeliveryAddressInput(raw, index) {
  const label = String(raw.label ?? raw.locationLabel ?? "").trim();
  if (!label) {
    const err = new Error(`Delivery location ${index + 1}: location label is required.`);
    err.statusCode = 400;
    throw err;
  }
  const address = raw.address != null ? String(raw.address).trim() || null : null;
  const city = raw.city != null ? String(raw.city).trim() || null : null;
  const district = raw.district != null ? String(raw.district).trim() || null : null;
  const pincode = raw.pincode != null ? String(raw.pincode).trim() || null : null;
  const country = raw.country != null ? String(raw.country).trim() || null : null;
  const contactPerson = raw.contactPerson != null ? String(raw.contactPerson).trim() || null : null;
  const phone = raw.phone != null ? String(raw.phone).trim() || null : null;
  const email = raw.email != null ? String(raw.email).trim() || null : null;
  const notes = raw.notes != null ? String(raw.notes).trim() || null : null;
  const gstRaw = raw.gstin !== undefined ? raw.gstin : raw.gst;
  const gst = normalizeGstinOnSave(gstRaw);
  return {
    id: raw.id != null && Number(raw.id) > 0 ? Number(raw.id) : null,
    label: label.slice(0, 128),
    locationType: normalizeLocationType(raw.locationType, label),
    address,
    city: city ? city.slice(0, 128) : null,
    district: district ? district.slice(0, 128) : null,
    stateId: raw.stateId != null && Number(raw.stateId) > 0 ? Number(raw.stateId) : null,
    pincode: pincode ? pincode.slice(0, 16) : null,
    country: country ? country.slice(0, 64) : null,
    gst,
    contactPerson: contactPerson ? contactPerson.slice(0, 128) : null,
    phone: phone ? phone.slice(0, 32) : null,
    email: email ? email.slice(0, 254) : null,
    notes: notes || null,
    isDefault: Boolean(raw.isDefault),
    isActive: raw.isActive !== false,
  };
}

async function validateDeliveryAddresses(addresses, customerIdForExclude) {
  const normalized = (addresses ?? []).map(normalizeDeliveryAddressInput);

  for (let i = 0; i < normalized.length; i += 1) {
    const row = normalized[i];
    if (row.gst) {
      const formatMsg = validateGstinFormatMessage(row.gst);
      if (formatMsg) {
        const err = new Error(`Delivery location "${row.label}": ${formatMsg}`);
        err.statusCode = 400;
        throw err;
      }
      let state = row.stateId ? await loadActiveStateById(row.stateId) : null;
      if (!state) state = await loadActiveStateByCode(row.gst);
      const stateErr = validateGstinAgainstState(row.gst, state ?? {});
      if (stateErr) {
        const err = new Error(`Delivery location "${row.label}": ${stateErr}`);
        err.statusCode = 400;
        throw err;
      }
      row.stateId = state?.id ?? row.stateId;
      await assertGstinUnique(row.gst, {
        excludeCustomerId: customerIdForExclude,
        ownerCustomerId: customerIdForExclude,
        forDeliveryAddress: true,
      });
    } else if (row.stateId) {
      const state = await loadActiveStateById(row.stateId);
      if (!state) {
        const err = new Error(`Delivery location "${row.label}": invalid state.`);
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

/**
 * Locations referenced by SO / Sales Bill / Dispatch cannot be hard-deleted.
 * @param {import("@prisma/client").Prisma.TransactionClient | import("@prisma/client").PrismaClient} db
 * @param {number[]} locationIds
 */
async function assertDeliveryLocationsDeletable(db, locationIds) {
  const ids = [...new Set((locationIds || []).map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return;

  const [soHit, billHit, dispatchHit] = await Promise.all([
    db.salesOrder.findFirst({
      where: { shipToAddressId: { in: ids } },
      select: { id: true, shipToAddressId: true },
    }),
    db.salesBill.findFirst({
      where: { shipToAddressId: { in: ids } },
      select: { id: true, shipToAddressId: true },
    }),
    db.dispatch.findFirst({
      where: { deliveryLocationId: { in: ids } },
      select: { id: true, deliveryLocationId: true },
    }),
  ]);

  if (soHit || billHit || dispatchHit) {
    const err = new Error(
      "This delivery location is used on Sales Order, Sales Bill, or Dispatch history. Mark it Inactive instead of deleting.",
    );
    err.statusCode = 409;
    err.code = "DELIVERY_LOCATION_IN_USE";
    throw err;
  }
}

async function syncDeliveryAddresses(tx, customerId, addresses) {
  const existing = await tx.customerDeliveryAddress.findMany({
    where: { customerId },
    select: { id: true },
  });
  const keepIds = new Set(addresses.map((a) => a.id).filter(Boolean));
  const deleteIds = existing.map((e) => e.id).filter((id) => !keepIds.has(id));
  if (deleteIds.length) {
    await assertDeliveryLocationsDeletable(tx, deleteIds);
    await tx.customerDeliveryAddress.deleteMany({ where: { id: { in: deleteIds } } });
  }

  for (const row of addresses) {
    const data = {
      label: row.label,
      locationType: row.locationType,
      address: row.address,
      city: row.city,
      district: row.district,
      stateId: row.stateId,
      pincode: row.pincode,
      country: row.country,
      gst: row.gst,
      contactPerson: row.contactPerson,
      phone: row.phone,
      email: row.email,
      notes: row.notes,
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

/**
 * Active delivery locations for a customer (Dispatch / SO dropdown).
 * @param {number} customerId
 */
async function listActiveDeliveryLocationsForCustomer(customerId) {
  const rows = await prisma.customerDeliveryAddress.findMany({
    where: { customerId: Number(customerId), isActive: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
  });
  return rows.map(mapDeliveryAddressRow);
}

/**
 * Build immutable dispatch snapshot from a CustomerDeliveryAddress row.
 * @param {ReturnType<typeof mapDeliveryAddressRow> | null | undefined} loc
 */
function buildDispatchDeliverySnapshot(loc) {
  if (!loc) {
    return {
      deliveryLocationId: null,
      deliveryLocationLabelSnapshot: null,
      deliveryAddressSnapshot: null,
      deliveryCitySnapshot: null,
      deliveryStateNameSnapshot: null,
      deliveryStateCodeSnapshot: null,
      deliveryPincodeSnapshot: null,
      deliveryCountrySnapshot: null,
      deliveryGstinSnapshot: null,
      deliveryContactPersonSnapshot: null,
      deliveryPhoneSnapshot: null,
      deliveryEmailSnapshot: null,
    };
  }
  return {
    deliveryLocationId: loc.id,
    deliveryLocationLabelSnapshot: loc.locationLabel || loc.label || null,
    deliveryAddressSnapshot: loc.address || null,
    deliveryCitySnapshot: loc.city || null,
    deliveryStateNameSnapshot: loc.stateName || null,
    deliveryStateCodeSnapshot: loc.stateCode || null,
    deliveryPincodeSnapshot: loc.pincode || null,
    deliveryCountrySnapshot: loc.country || null,
    deliveryGstinSnapshot: loc.gstin || null,
    deliveryContactPersonSnapshot: loc.contactPerson || null,
    deliveryPhoneSnapshot: loc.phone || null,
    deliveryEmailSnapshot: loc.email || null,
  };
}

module.exports = {
  DUPLICATE_GSTIN_MESSAGE,
  LOCATION_TYPES,
  mapCustomerRow,
  mapDeliveryAddressRow,
  customerInclude,
  loadActiveStateById,
  loadActiveStateByCode,
  assertGstinUnique,
  validateRegisteredGstin,
  validateDeliveryAddresses,
  syncDeliveryAddresses,
  assertDeliveryLocationsDeletable,
  getCustomerById,
  listActiveDeliveryLocationsForCustomer,
  buildDispatchDeliverySnapshot,
  normalizeLocationType,
};
