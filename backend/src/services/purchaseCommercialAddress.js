const { normalizeGstinOnSave, gstStateCodeFromGstin } = require("./gstinNormalize");

const REGISTERED_OFFICE_LABEL = "Registered Office";

function safeStrOrNull(v, max = null) {
  const t = v == null ? "" : String(v).trim();
  if (!t) return null;
  if (max != null) return t.slice(0, max);
  return t;
}

function commercialSnapshotsPresent(po) {
  return Boolean(
    po?.supplierNameSnapshot ||
      po?.supplyLocationLabelSnapshot ||
      po?.purchaseSourceStateCodeSnapshot ||
      po?.purchaseSourceStateNameSnapshot,
  );
}

function snapshotStateLabel(po) {
  if (!po) return "LEGACY";
  if (commercialSnapshotsPresent(po)) return "FROZEN";
  return "LIVE";
}

function mapRegisteredSupplier(supplier) {
  if (!supplier) return null;
  return {
    name: safeStrOrNull(supplier.name, 256),
    address: safeStrOrNull(supplier.address),
    gstin: normalizeGstinOnSave(supplier.gst),
    stateName:
      safeStrOrNull(supplier.stateName, 128) ??
      safeStrOrNull(supplier.stateRef?.stateName, 128) ??
      safeStrOrNull(supplier.state, 128),
    stateCode:
      safeStrOrNull(supplier.stateCode, 2) ?? safeStrOrNull(supplier.stateRef?.stateCode, 2),
  };
}

function mapSupplyLocationRow(location, supplier) {
  if (location) {
    return {
      id: location.id,
      label: safeStrOrNull(location.label, 128),
      address: safeStrOrNull(location.address),
      city: safeStrOrNull(location.city, 128),
      gstin: normalizeGstinOnSave(location.gst),
      stateName: safeStrOrNull(location.stateRef?.stateName, 128),
      stateCode: safeStrOrNull(location.stateRef?.stateCode, 2),
    };
  }
  if (supplier) {
    const reg = mapRegisteredSupplier(supplier);
    return {
      id: null,
      label: REGISTERED_OFFICE_LABEL,
      address: reg?.address ?? null,
      city: null,
      gstin: reg?.gstin ?? null,
      stateName: reg?.stateName ?? null,
      stateCode: reg?.stateCode ?? null,
    };
  }
  return null;
}

async function loadActiveStateByCode(tx, stateCode) {
  const code = gstStateCodeFromGstin(stateCode) ?? String(stateCode ?? "").trim();
  if (!/^\d{2}$/.test(code)) return null;
  return tx.state.findFirst({
    where: { stateCode: code, isActive: true },
    select: { id: true, stateName: true, stateCode: true },
  });
}

function resolvePurchaseSourceState(supplyLocation, registered) {
  const locStateCode = safeStrOrNull(supplyLocation?.stateCode, 2);
  const locStateName = safeStrOrNull(supplyLocation?.stateName, 128);
  if (locStateCode || locStateName) {
    return {
      stateCode: locStateCode,
      stateName: locStateName,
      source: supplyLocation?.id != null ? "SUPPLY_LOCATION" : "REGISTERED",
    };
  }

  const locGstin = normalizeGstinOnSave(supplyLocation?.gstin);
  const gstCode = locGstin ? gstStateCodeFromGstin(locGstin) : null;
  if (gstCode) {
    return {
      stateCode: gstCode,
      stateName: locStateName,
      source: supplyLocation?.id != null ? "SUPPLY_LOCATION" : "REGISTERED",
    };
  }

  const regCode = safeStrOrNull(registered?.stateCode, 2);
  const regName = safeStrOrNull(registered?.stateName, 128);
  if (regCode || regName) {
    return { stateCode: regCode, stateName: regName, source: "REGISTERED" };
  }

  return { stateCode: null, stateName: null, source: null };
}

function getPurchaseGstMode(companyStateCode, purchaseSourceStateCode) {
  const c = safeStrOrNull(companyStateCode, 2);
  const p = safeStrOrNull(purchaseSourceStateCode, 2);
  if (!c || !p) return "UNKNOWN";
  return c === p ? "LOCAL" : "INTERSTATE";
}

async function getCompanyStateCode(tx) {
  const row = await tx.appSetting.findUnique({
    where: { id: 1 },
    select: { companyStateRef: { select: { stateCode: true } } },
  });
  return row?.companyStateRef?.stateCode ?? null;
}

async function resolveSupplierLocationFallback(tx, supplierId, requestedLocationId = null) {
  const sid = Number(supplierId);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  const reqId = requestedLocationId != null ? Number(requestedLocationId) : null;
  if (Number.isFinite(reqId) && reqId > 0) {
    const row = await tx.supplierLocation.findFirst({
      where: { id: reqId, supplierId: sid, isActive: true },
      include: { stateRef: { select: { stateName: true, stateCode: true } } },
    });
    if (row) return row;
    const err = new Error("Supply location not found or inactive for this supplier.");
    err.statusCode = 400;
    throw err;
  }

  const def = await tx.supplierLocation.findFirst({
    where: { supplierId: sid, isActive: true, isDefault: true },
    orderBy: [{ id: "asc" }],
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });
  if (def) return def;

  const anyLoc = await tx.supplierLocation.findFirst({
    where: { supplierId: sid, isActive: true },
    orderBy: [{ id: "asc" }],
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });
  return anyLoc;
}

function mapPurchaseCommercialSnapshots({ supplier, location, purchaseSource, gstMode }) {
  const registered = mapRegisteredSupplier(supplier);
  const supply = mapSupplyLocationRow(location, supplier);
  return {
    supplierLocationId: location?.id ?? null,
    supplierNameSnapshot: registered?.name ?? null,
    supplierRegisteredGstinSnapshot: registered?.gstin ?? null,
    supplierRegisteredAddressSnapshot: registered?.address ?? null,
    supplierRegisteredStateNameSnapshot: registered?.stateName ?? null,
    supplierRegisteredStateCodeSnapshot: registered?.stateCode ?? null,
    supplyLocationLabelSnapshot: supply?.label ?? null,
    supplyLocationAddressSnapshot: supply?.address ?? null,
    supplyLocationGstinSnapshot: supply?.gstin ?? null,
    supplyLocationStateNameSnapshot: supply?.stateName ?? null,
    supplyLocationStateCodeSnapshot: supply?.stateCode ?? null,
    purchaseSourceStateNameSnapshot: purchaseSource?.stateName ?? null,
    purchaseSourceStateCodeSnapshot: purchaseSource?.stateCode ?? null,
    purchaseSourceSnapshot: purchaseSource?.source ?? null,
    purchaseGstModeSnapshot: gstMode ?? null,
    supplierStateSnapshot: registered?.stateName ?? null,
    supplierStateCodeSnapshot: registered?.stateCode ?? null,
  };
}

function mapCommercialViewFromPoRow(po, companyStateCode) {
  const registered = {
    name: safeStrOrNull(po.supplierNameSnapshot, 256) ?? mapRegisteredSupplier(po.supplier)?.name,
    address: safeStrOrNull(po.supplierRegisteredAddressSnapshot) ?? mapRegisteredSupplier(po.supplier)?.address,
    gstin: normalizeGstinOnSave(po.supplierRegisteredGstinSnapshot) ?? mapRegisteredSupplier(po.supplier)?.gstin,
    stateName:
      safeStrOrNull(po.supplierRegisteredStateNameSnapshot, 128) ??
      mapRegisteredSupplier(po.supplier)?.stateName,
    stateCode:
      safeStrOrNull(po.supplierRegisteredStateCodeSnapshot, 2) ??
      mapRegisteredSupplier(po.supplier)?.stateCode,
  };
  const supply = {
    id: po.supplierLocationId ?? po.supplierLocation?.id ?? null,
    label:
      safeStrOrNull(po.supplyLocationLabelSnapshot, 128) ??
      mapSupplyLocationRow(po.supplierLocation, po.supplier)?.label,
    address:
      safeStrOrNull(po.supplyLocationAddressSnapshot) ??
      mapSupplyLocationRow(po.supplierLocation, po.supplier)?.address,
    gstin:
      normalizeGstinOnSave(po.supplyLocationGstinSnapshot) ??
      mapSupplyLocationRow(po.supplierLocation, po.supplier)?.gstin,
    stateName:
      safeStrOrNull(po.supplyLocationStateNameSnapshot, 128) ??
      mapSupplyLocationRow(po.supplierLocation, po.supplier)?.stateName,
    stateCode:
      safeStrOrNull(po.supplyLocationStateCodeSnapshot, 2) ??
      mapSupplyLocationRow(po.supplierLocation, po.supplier)?.stateCode,
  };
  const purchaseSource = {
    stateName: safeStrOrNull(po.purchaseSourceStateNameSnapshot, 128),
    stateCode: safeStrOrNull(po.purchaseSourceStateCodeSnapshot, 2),
    source: safeStrOrNull(po.purchaseSourceSnapshot, 32),
  };
  const gstMode =
    safeStrOrNull(po.purchaseGstModeSnapshot, 32) ??
    getPurchaseGstMode(companyStateCode, purchaseSource.stateCode);
  return {
    snapshotState: snapshotStateLabel(po),
    registeredSupplier: registered,
    supplyLocation: supply,
    purchaseSource,
    gstMode,
  };
}

async function resolveSupplierCommercialView(tx, poOrInput, opts = {}) {
  const companyStateCode = opts.companyStateCode ?? (await getCompanyStateCode(tx));

  if (poOrInput && commercialSnapshotsPresent(poOrInput)) {
    return mapCommercialViewFromPoRow(poOrInput, companyStateCode);
  }

  const supplierId = poOrInput?.supplierId ?? poOrInput?.supplier?.id ?? null;
  if (!supplierId) {
    return {
      snapshotState: "LEGACY",
      registeredSupplier: null,
      supplyLocation: null,
      purchaseSource: { stateCode: null, stateName: null, source: null },
      gstMode: "UNKNOWN",
    };
  }

  const supplier =
    poOrInput?.supplier ??
    (await tx.supplier.findUnique({
      where: { id: Number(supplierId) },
      include: { stateRef: { select: { stateName: true, stateCode: true } } },
    }));

  const location = await resolveSupplierLocationFallback(
    tx,
    supplierId,
    poOrInput?.supplierLocationId ?? poOrInput?.supplierLocation?.id ?? null,
  );
  const registered = mapRegisteredSupplier(supplier);
  let supply = mapSupplyLocationRow(location, supplier);

  if (location && supply && !supply.stateCode && supply.gstin) {
    const st = await loadActiveStateByCode(tx, supply.gstin);
    if (st) {
      supply = { ...supply, stateName: st.stateName, stateCode: st.stateCode };
    }
  }

  const purchaseSource = resolvePurchaseSourceState(supply, registered);
  if (!purchaseSource.stateName && purchaseSource.stateCode) {
    const st = await loadActiveStateByCode(tx, purchaseSource.stateCode);
    if (st) purchaseSource.stateName = st.stateName;
  }

  const gstMode = getPurchaseGstMode(companyStateCode, purchaseSource.stateCode);

  return {
    snapshotState: snapshotStateLabel(poOrInput),
    registeredSupplier: registered,
    supplyLocation: supply,
    purchaseSource,
    gstMode,
  };
}

async function freezeRmPurchaseOrderCommercialSnapshots(tx, input) {
  const supplierId = Number(input.supplierId);
  if (!Number.isFinite(supplierId) || supplierId <= 0) {
    const err = new Error("Supplier is required.");
    err.statusCode = 400;
    throw err;
  }

  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });
  if (!supplier) {
    const err = new Error("Supplier not found.");
    err.statusCode = 404;
    throw err;
  }

  const location = await resolveSupplierLocationFallback(tx, supplierId, input.supplierLocationId ?? null);
  const companyStateCode = input.companyStateCode ?? (await getCompanyStateCode(tx));
  const registered = mapRegisteredSupplier(supplier);
  let supply = mapSupplyLocationRow(location, supplier);

  if (location && supply && !supply.stateCode && supply.gstin) {
    const st = await loadActiveStateByCode(tx, supply.gstin);
    if (st) {
      supply = { ...supply, stateName: st.stateName, stateCode: st.stateCode };
    }
  }

  const purchaseSource = resolvePurchaseSourceState(supply, registered);
  if (!purchaseSource.stateName && purchaseSource.stateCode) {
    const st = await loadActiveStateByCode(tx, purchaseSource.stateCode);
    if (st) purchaseSource.stateName = st.stateName;
  }

  const gstMode = getPurchaseGstMode(companyStateCode, purchaseSource.stateCode);

  return mapPurchaseCommercialSnapshots({
    supplier,
    location,
    purchaseSource,
    gstMode,
  });
}

async function enrichRmPurchaseOrderCommercial(tx, po) {
  if (!po) return po;
  const companyStateCode = await getCompanyStateCode(tx);
  const resolvedSupplierCommercial = commercialSnapshotsPresent(po)
    ? mapCommercialViewFromPoRow(po, companyStateCode)
    : await resolveSupplierCommercialView(tx, po, { companyStateCode });
  return {
    ...po,
    resolvedSupplierCommercial,
  };
}

function emptyStr(v) {
  return safeStrOrNull(v) ?? "";
}

function purchaseBillCommercialSnapshotsPresent(bill) {
  return Boolean(
    emptyStr(bill?.supplierNameSnapshot) ||
      emptyStr(bill?.supplyLocationLabelSnapshot) ||
      emptyStr(bill?.purchaseSourceStateCodeSnapshot) ||
      emptyStr(bill?.purchaseSourceStateNameSnapshot),
  );
}

function purchaseBillSnapshotStateLabel(bill) {
  if (!bill) return "LEGACY";
  if (purchaseBillCommercialSnapshotsPresent(bill)) return "FROZEN";
  if (emptyStr(bill?.supplierStateCodeSnapshot) || emptyStr(bill?.supplierStateSnapshot)) return "LEGACY";
  return "LIVE";
}

function mapPoCommercialToPurchaseBillSnapshots(poOrSnaps) {
  const src = poOrSnaps ?? {};
  return {
    supplierNameSnapshot: emptyStr(src.supplierNameSnapshot),
    supplierRegisteredGstinSnapshot: emptyStr(src.supplierRegisteredGstinSnapshot),
    supplierRegisteredAddressSnapshot: emptyStr(src.supplierRegisteredAddressSnapshot),
    supplierRegisteredStateNameSnapshot: emptyStr(src.supplierRegisteredStateNameSnapshot),
    supplierRegisteredStateCodeSnapshot: emptyStr(src.supplierRegisteredStateCodeSnapshot),
    supplyLocationLabelSnapshot: emptyStr(src.supplyLocationLabelSnapshot),
    supplyLocationAddressSnapshot: emptyStr(src.supplyLocationAddressSnapshot),
    supplyLocationGstinSnapshot: emptyStr(src.supplyLocationGstinSnapshot),
    supplyLocationStateNameSnapshot: emptyStr(src.supplyLocationStateNameSnapshot),
    supplyLocationStateCodeSnapshot: emptyStr(src.supplyLocationStateCodeSnapshot),
    purchaseSourceStateNameSnapshot: emptyStr(src.purchaseSourceStateNameSnapshot),
    purchaseSourceStateCodeSnapshot: emptyStr(src.purchaseSourceStateCodeSnapshot),
    purchaseSourceSnapshot: emptyStr(src.purchaseSourceSnapshot),
    purchaseGstModeSnapshot: emptyStr(src.purchaseGstModeSnapshot),
    supplierStateSnapshot: emptyStr(src.supplierStateSnapshot) || null,
    supplierStateCodeSnapshot: emptyStr(src.supplierStateCodeSnapshot) || null,
  };
}

async function resolvePurchaseBillCommercialSnapshots(tx, source) {
  const rmPo = source?.rmPo ?? source ?? null;
  if (!rmPo?.supplierId) return mapPoCommercialToPurchaseBillSnapshots(null);

  if (commercialSnapshotsPresent(rmPo)) {
    return mapPoCommercialToPurchaseBillSnapshots(rmPo);
  }

  const frozen = await freezeRmPurchaseOrderCommercialSnapshots(tx, {
    supplierId: rmPo.supplierId,
    supplierLocationId: rmPo.supplierLocationId ?? null,
  });
  return mapPoCommercialToPurchaseBillSnapshots(frozen);
}

function resolvePurchaseBillSourceStateCode(bill) {
  const fromPurchaseSource = emptyStr(bill?.purchaseSourceStateCodeSnapshot);
  if (fromPurchaseSource) return fromPurchaseSource;
  const legacy = emptyStr(bill?.supplierStateCodeSnapshot);
  if (legacy) return legacy;
  return (
    safeStrOrNull(bill?.supplier?.stateCode) ?? safeStrOrNull(bill?.supplier?.stateRef?.stateCode) ?? null
  );
}

function resolvePurchaseBillSourceStateName(bill) {
  const fromPurchaseSource = emptyStr(bill?.purchaseSourceStateNameSnapshot);
  if (fromPurchaseSource) return fromPurchaseSource;
  const legacy = emptyStr(bill?.supplierStateSnapshot);
  if (legacy) return legacy;
  return (
    safeStrOrNull(bill?.supplier?.stateName) ??
    safeStrOrNull(bill?.supplier?.stateRef?.stateName) ??
    safeStrOrNull(bill?.supplier?.state) ??
    null
  );
}

function resolvePurchaseBillIntraState(bill, companyState) {
  const companyCode = companyState?.companyStateRef?.stateCode ?? null;
  const sourceCode = resolvePurchaseBillSourceStateCode(bill);
  if (!companyCode || !sourceCode) {
    return { intraState: false, basis: "MISSING_STATE_CODE" };
  }
  const basis = emptyStr(bill?.purchaseSourceStateCodeSnapshot)
    ? "PURCHASE_SOURCE_SNAPSHOT"
    : emptyStr(bill?.supplierStateCodeSnapshot)
      ? "LEGACY_SUPPLIER_SNAPSHOT"
      : "LIVE_SUPPLIER";
  return {
    intraState: String(companyCode) === String(sourceCode),
    basis,
  };
}

function mapCommercialViewFromBillRow(bill, companyStateCode) {
  const registered = {
    name: emptyStr(bill.supplierNameSnapshot) || mapRegisteredSupplier(bill.supplier)?.name,
    address: emptyStr(bill.supplierRegisteredAddressSnapshot) || mapRegisteredSupplier(bill.supplier)?.address,
    gstin: normalizeGstinOnSave(emptyStr(bill.supplierRegisteredGstinSnapshot)) || mapRegisteredSupplier(bill.supplier)?.gstin,
    stateName:
      emptyStr(bill.supplierRegisteredStateNameSnapshot) || mapRegisteredSupplier(bill.supplier)?.stateName,
    stateCode:
      emptyStr(bill.supplierRegisteredStateCodeSnapshot) || mapRegisteredSupplier(bill.supplier)?.stateCode,
  };
  const supply = {
    id: null,
    label: emptyStr(bill.supplyLocationLabelSnapshot) || null,
    address: emptyStr(bill.supplyLocationAddressSnapshot) || null,
    gstin: normalizeGstinOnSave(emptyStr(bill.supplyLocationGstinSnapshot)) || null,
    stateName: emptyStr(bill.supplyLocationStateNameSnapshot) || null,
    stateCode: emptyStr(bill.supplyLocationStateCodeSnapshot) || null,
  };
  const purchaseSource = {
    stateName: emptyStr(bill.purchaseSourceStateNameSnapshot) || resolvePurchaseBillSourceStateName(bill),
    stateCode: emptyStr(bill.purchaseSourceStateCodeSnapshot) || resolvePurchaseBillSourceStateCode(bill),
    source: emptyStr(bill.purchaseSourceSnapshot) || (purchaseBillCommercialSnapshotsPresent(bill) ? "REGISTERED" : null),
  };
  const gstMode =
    emptyStr(bill.purchaseGstModeSnapshot) || getPurchaseGstMode(companyStateCode, purchaseSource.stateCode);
  return {
    snapshotState: purchaseBillSnapshotStateLabel(bill),
    registeredSupplier: registered,
    supplyLocation: supply,
    purchaseSource,
    gstMode,
  };
}

function resolvePurchaseBillCommercialView(bill, companyStateCode) {
  if (!bill) {
    return {
      snapshotState: "LEGACY",
      registeredSupplier: null,
      supplyLocation: null,
      purchaseSource: { stateCode: null, stateName: null, source: null },
      gstMode: "UNKNOWN",
    };
  }
  if (purchaseBillCommercialSnapshotsPresent(bill)) {
    return mapCommercialViewFromBillRow(bill, companyStateCode);
  }
  const registered = mapRegisteredSupplier(bill.supplier);
  const legacySource = {
    stateName: resolvePurchaseBillSourceStateName(bill),
    stateCode: resolvePurchaseBillSourceStateCode(bill),
    source: emptyStr(bill.supplierStateCodeSnapshot) ? "REGISTERED" : null,
  };
  const gstMode = getPurchaseGstMode(companyStateCode, legacySource.stateCode);
  return {
    snapshotState: purchaseBillSnapshotStateLabel(bill),
    registeredSupplier: registered,
    supplyLocation: registered
      ? {
          id: null,
          label: REGISTERED_OFFICE_LABEL,
          address: registered.address,
          gstin: registered.gstin,
          stateName: registered.stateName,
          stateCode: registered.stateCode,
        }
      : null,
    purchaseSource: legacySource,
    gstMode,
  };
}

module.exports = {
  REGISTERED_OFFICE_LABEL,
  commercialSnapshotsPresent,
  snapshotStateLabel,
  mapRegisteredSupplier,
  mapSupplyLocationRow,
  resolvePurchaseSourceState,
  getPurchaseGstMode,
  resolveSupplierLocationFallback,
  mapPurchaseCommercialSnapshots,
  mapCommercialViewFromPoRow,
  resolveSupplierCommercialView,
  freezeRmPurchaseOrderCommercialSnapshots,
  enrichRmPurchaseOrderCommercial,
  getCompanyStateCode,
  purchaseBillCommercialSnapshotsPresent,
  purchaseBillSnapshotStateLabel,
  mapPoCommercialToPurchaseBillSnapshots,
  resolvePurchaseBillCommercialSnapshots,
  resolvePurchaseBillSourceStateCode,
  resolvePurchaseBillSourceStateName,
  resolvePurchaseBillIntraState,
  mapCommercialViewFromBillRow,
  resolvePurchaseBillCommercialView,
};
