const { normalizeGstinOnSave } = require("./gstinNormalize");

function safeStrOrNull(v, max = null) {
  const t = v == null ? "" : String(v).trim();
  if (!t) return null;
  if (max != null) return t.slice(0, max);
  return t;
}

function snapshotsPresent(so) {
  // Minimal marker: billToNameSnapshot OR shipToLabelSnapshot OR posStateCodeSnapshot
  return Boolean(
    so?.billToNameSnapshot ||
      so?.shipToLabelSnapshot ||
      so?.posStateCodeSnapshot ||
      so?.billToStateCodeSnapshot ||
      so?.shipToStateCodeSnapshot,
  );
}

function resolvePlaceOfSupply({ shipTo, billTo }) {
  const shipCode = safeStrOrNull(shipTo?.stateCode, 2);
  if (shipCode) {
    return { stateCode: shipCode, stateName: safeStrOrNull(shipTo?.stateName, 128) ?? null, source: "SHIP_TO" };
  }
  const billCode = safeStrOrNull(billTo?.stateCode, 2);
  if (billCode) {
    return { stateCode: billCode, stateName: safeStrOrNull(billTo?.stateName, 128) ?? null, source: "BILL_TO" };
  }
  return { stateCode: null, stateName: null, source: null };
}

function gstModeFromCompanyVsPos({ companyStateCode, posStateCode }) {
  const c = safeStrOrNull(companyStateCode, 2);
  const p = safeStrOrNull(posStateCode, 2);
  if (!c || !p) return null;
  return c === p ? "LOCAL" : "INTERSTATE";
}

async function resolveShipToAddress(tx, so) {
  const customerId = so?.customerId ?? so?.po?.customerId ?? null;
  if (!customerId) return null;

  const directId = Number(so.shipToAddressId ?? 0);
  if (Number.isFinite(directId) && directId > 0) {
    const row = await tx.customerDeliveryAddress.findFirst({
      where: { id: directId, customerId: Number(customerId), isActive: true },
      include: { stateRef: { select: { stateName: true, stateCode: true } } },
    });
    if (row) return row;
  }

  const def = await tx.customerDeliveryAddress.findFirst({
    where: { customerId: Number(customerId), isDefault: true, isActive: true },
    orderBy: [{ id: "asc" }],
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });
  if (def) return def;

  const anyActive = await tx.customerDeliveryAddress.findFirst({
    where: { customerId: Number(customerId), isActive: true },
    orderBy: [{ id: "asc" }],
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });
  if (anyActive) return anyActive;

  return null;
}

async function resolveBillToCustomer(tx, so) {
  const customerId = so?.customerId ?? so?.po?.customerId ?? null;
  if (!customerId) return null;
  return tx.customer.findUnique({
    where: { id: Number(customerId) },
    include: { stateRef: { select: { stateName: true, stateCode: true } } },
  });
}

function mapResolvedBillTo(customer) {
  if (!customer) return null;
  return {
    name: safeStrOrNull(customer.name, 256) ?? null,
    address: safeStrOrNull(customer.address) ?? null,
    gstin: normalizeGstinOnSave(customer.gst),
    stateName: safeStrOrNull(customer.stateRef?.stateName ?? customer.state, 128) ?? null,
    stateCode: safeStrOrNull(customer.stateRef?.stateCode, 2) ?? null,
  };
}

function mapResolvedShipTo(addr, fallbackCustomer) {
  if (addr) {
    return {
      label: safeStrOrNull(addr.label, 128) ?? null,
      address: safeStrOrNull(addr.address) ?? null,
      gstin: normalizeGstinOnSave(addr.gst),
      stateName: safeStrOrNull(addr.stateRef?.stateName, 128) ?? null,
      stateCode: safeStrOrNull(addr.stateRef?.stateCode, 2) ?? null,
    };
  }
  // Fallback: registered office address operationally (legacy safety)
  if (fallbackCustomer) {
    return {
      label: "Registered Office",
      address: safeStrOrNull(fallbackCustomer.address) ?? null,
      gstin: normalizeGstinOnSave(fallbackCustomer.gst),
      stateName: safeStrOrNull(fallbackCustomer.stateRef?.stateName ?? fallbackCustomer.state, 128) ?? null,
      stateCode: safeStrOrNull(fallbackCustomer.stateRef?.stateCode, 2) ?? null,
    };
  }
  return null;
}

function snapshotStateLabel(so) {
  if (!so) return "LEGACY";
  if (snapshotsPresent(so)) return "FROZEN";
  return "LIVE";
}

async function resolveCommercialView(tx, so, opts = {}) {
  const companyStateCode = opts.companyStateCode ?? null;
  if (!so) {
    return {
      snapshotState: "LEGACY",
      resolvedBillTo: null,
      resolvedShipTo: null,
      resolvedPOS: { stateCode: null, stateName: null, source: null, gstMode: null },
    };
  }

  if (snapshotsPresent(so)) {
    const billTo = {
      name: safeStrOrNull(so.billToNameSnapshot, 256) ?? null,
      address: safeStrOrNull(so.billToAddressSnapshot) ?? null,
      gstin: normalizeGstinOnSave(so.billToGstinSnapshot),
      stateName: safeStrOrNull(so.billToStateNameSnapshot, 128) ?? null,
      stateCode: safeStrOrNull(so.billToStateCodeSnapshot, 2) ?? null,
    };
    const shipTo = {
      label: safeStrOrNull(so.shipToLabelSnapshot, 128) ?? null,
      address: safeStrOrNull(so.shipToAddressSnapshot) ?? null,
      gstin: normalizeGstinOnSave(so.shipToGstinSnapshot),
      stateName: safeStrOrNull(so.shipToStateNameSnapshot, 128) ?? null,
      stateCode: safeStrOrNull(so.shipToStateCodeSnapshot, 2) ?? null,
    };
    const pos = {
      stateCode: safeStrOrNull(so.posStateCodeSnapshot, 2) ?? null,
      stateName: safeStrOrNull(so.posStateNameSnapshot, 128) ?? null,
      source: safeStrOrNull(so.posSourceSnapshot, 32) ?? null,
    };
    return {
      snapshotState: snapshotStateLabel(so),
      resolvedBillTo: billTo,
      resolvedShipTo: shipTo,
      resolvedPOS: {
        ...pos,
        gstMode: gstModeFromCompanyVsPos({ companyStateCode, posStateCode: pos.stateCode }),
      },
    };
  }

  const billCustomer = await resolveBillToCustomer(tx, so);
  const shipAddr = await resolveShipToAddress(tx, so);
  const billTo = mapResolvedBillTo(billCustomer);
  const shipTo = mapResolvedShipTo(shipAddr, billCustomer);
  const pos = resolvePlaceOfSupply({ shipTo, billTo });

  return {
    snapshotState: snapshotStateLabel(so),
    resolvedBillTo: billTo,
    resolvedShipTo: shipTo,
    resolvedPOS: {
      stateCode: pos.stateCode,
      stateName: pos.stateName,
      source: pos.source,
      gstMode: gstModeFromCompanyVsPos({ companyStateCode, posStateCode: pos.stateCode }),
    },
  };
}

async function ensureShipToAutoPick(tx, soId) {
  const so = await tx.salesOrder.findUnique({
    where: { id: Number(soId) },
    include: { po: true },
  });
  if (!so) return null;
  if (so.shipToAddressId != null) return so;
  const customerId = so.customerId ?? so.po?.customerId ?? null;
  if (!customerId) return so;
  const def = await tx.customerDeliveryAddress.findFirst({
    where: { customerId: Number(customerId), isDefault: true, isActive: true },
    orderBy: [{ id: "asc" }],
    select: { id: true },
  });
  if (!def) return so;
  return tx.salesOrder.update({ where: { id: so.id }, data: { shipToAddressId: def.id } });
}

async function freezeSalesOrderCommercialSnapshots(tx, soId, opts = {}) {
  const id = Number(soId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const so = await tx.salesOrder.findUnique({
    where: { id },
    include: { po: true },
  });
  if (!so) return null;
  if (snapshotsPresent(so)) return so;

  // Auto-pick default ship-to if missing, but do not block if none exists.
  const soAfterPick = await ensureShipToAutoPick(tx, id);
  const view = await resolveCommercialView(tx, soAfterPick ?? so, { companyStateCode: opts.companyStateCode ?? null });

  const billTo = view.resolvedBillTo;
  const shipTo = view.resolvedShipTo;
  const pos = view.resolvedPOS;

  // Persist snapshots (all nullable; only set what we can resolve).
  return tx.salesOrder.update({
    where: { id },
    data: {
      billToNameSnapshot: billTo?.name ?? null,
      billToAddressSnapshot: billTo?.address ?? null,
      billToGstinSnapshot: billTo?.gstin ?? null,
      billToStateNameSnapshot: billTo?.stateName ?? null,
      billToStateCodeSnapshot: billTo?.stateCode ?? null,

      shipToLabelSnapshot: shipTo?.label ?? null,
      shipToAddressSnapshot: shipTo?.address ?? null,
      shipToGstinSnapshot: shipTo?.gstin ?? null,
      shipToStateNameSnapshot: shipTo?.stateName ?? null,
      shipToStateCodeSnapshot: shipTo?.stateCode ?? null,

      posStateNameSnapshot: pos?.stateName ?? null,
      posStateCodeSnapshot: pos?.stateCode ?? null,
      posSourceSnapshot: pos?.source ?? null,
    },
  });
}

function mapCommercialViewToSalesBillSnapshots(view) {
  const billTo = view?.resolvedBillTo ?? null;
  const shipTo = view?.resolvedShipTo ?? null;
  const pos = view?.resolvedPOS ?? null;
  return {
    customerNameSnapshot: String(billTo?.name ?? "").slice(0, 256),
    customerStateNameSnapshot: String(billTo?.stateName ?? "").slice(0, 128),
    customerStateCodeSnapshot: String(billTo?.stateCode ?? "").slice(0, 2),
    billToAddressSnapshot: String(billTo?.address ?? ""),
    billToGstinSnapshot: String(billTo?.gstin ?? "").slice(0, 15),
    shipToLabelSnapshot: String(shipTo?.label ?? "").slice(0, 128),
    shipToAddressSnapshot: String(shipTo?.address ?? ""),
    shipToGstinSnapshot: String(shipTo?.gstin ?? "").slice(0, 15),
    shipToStateNameSnapshot: String(shipTo?.stateName ?? "").slice(0, 128),
    shipToStateCodeSnapshot: String(shipTo?.stateCode ?? "").slice(0, 2),
    posStateNameSnapshot: String(pos?.stateName ?? "").slice(0, 128),
    posStateCodeSnapshot: String(pos?.stateCode ?? "").slice(0, 2),
    posSourceSnapshot: String(pos?.source ?? "").slice(0, 32),
  };
}

/**
 * Resolve invoice-grade commercial snapshots for SalesBill creation.
 * Ensures SO snapshots are frozen first, then copies resolved Bill To / Ship To / POS.
 */
async function resolveSalesBillCommercialSnapshots(tx, so, opts = {}) {
  const soId = Number(so?.id ?? 0);
  if (!Number.isFinite(soId) || soId <= 0) {
    return mapCommercialViewToSalesBillSnapshots(null);
  }
  const companyStateCode = opts.companyStateCode ?? null;
  await freezeSalesOrderCommercialSnapshots(tx, soId, { companyStateCode });
  const soFresh = await tx.salesOrder.findUnique({
    where: { id: soId },
    include: { po: true },
  });
  const view = await resolveCommercialView(tx, soFresh ?? so, { companyStateCode });
  return mapCommercialViewToSalesBillSnapshots(view);
}

module.exports = {
  snapshotsPresent,
  resolvePlaceOfSupply,
  gstModeFromCompanyVsPos,
  resolveCommercialView,
  freezeSalesOrderCommercialSnapshots,
  ensureShipToAutoPick,
  mapCommercialViewToSalesBillSnapshots,
  resolveSalesBillCommercialSnapshots,
};

