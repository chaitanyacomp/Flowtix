/**
 * Resolve and freeze Customer Delivery Location onto a Dispatch create payload.
 */
const {
  buildDispatchDeliverySnapshot,
  mapDeliveryAddressRow,
} = require("./customerMasterService");

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} customerId
 */
async function listActiveDeliveryLocationsForCustomer(db, customerId) {
  const id = Number(customerId);
  if (!Number.isFinite(id) || id <= 0) return [];
  const rows = await db.customerDeliveryAddress.findMany({
    where: { customerId: id, isActive: true },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    include: { stateRef: { select: { id: true, stateName: true, stateCode: true } } },
  });
  return rows.map(mapDeliveryAddressRow);
}

/**
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} db
 * @param {number} customerId
 * @param {number | null | undefined} deliveryLocationId
 */
async function resolveDeliveryLocationForDispatch(db, customerId, deliveryLocationId) {
  const locations = await listActiveDeliveryLocationsForCustomer(db, customerId);
  if (!locations.length) {
    return buildDispatchDeliverySnapshot(null);
  }

  let chosen = null;
  const wantId = deliveryLocationId != null ? Number(deliveryLocationId) : null;
  if (wantId && Number.isFinite(wantId) && wantId > 0) {
    chosen = locations.find((l) => l.id === wantId) || null;
    if (!chosen) {
      const err = new Error("Selected delivery location is not active for this customer.");
      err.statusCode = 400;
      err.code = "DELIVERY_LOCATION_INVALID";
      throw err;
    }
  } else {
    chosen = locations.find((l) => l.isDefault) || locations[0];
  }

  return buildDispatchDeliverySnapshot(chosen);
}

/**
 * Prefer Dispatch frozen snapshot for Sales Bill logistics ship-to.
 * Falls back to SO commercial ship-to when legacy dispatch has no snapshot.
 *
 * @param {object | null | undefined} dispatch
 * @param {object | null | undefined} soShipTo — resolved SO ship-to DTO
 */
function shipToFromDispatchOrSo(dispatch, soShipTo) {
  if (dispatch?.deliveryLocationLabelSnapshot || dispatch?.deliveryAddressSnapshot || dispatch?.deliveryGstinSnapshot) {
    return {
      label: dispatch.deliveryLocationLabelSnapshot || "Ship To",
      address: dispatch.deliveryAddressSnapshot || "",
      gstin: dispatch.deliveryGstinSnapshot || "",
      stateName: dispatch.deliveryStateNameSnapshot || "",
      stateCode: dispatch.deliveryStateCodeSnapshot || "",
      city: dispatch.deliveryCitySnapshot || null,
      pincode: dispatch.deliveryPincodeSnapshot || null,
      country: dispatch.deliveryCountrySnapshot || null,
      contactPerson: dispatch.deliveryContactPersonSnapshot || null,
      phone: dispatch.deliveryPhoneSnapshot || null,
      email: dispatch.deliveryEmailSnapshot || null,
      sameAsBillTo: false,
      fromDispatchSnapshot: true,
    };
  }
  return soShipTo || null;
}

module.exports = {
  resolveDeliveryLocationForDispatch,
  shipToFromDispatchOrSo,
  listActiveDeliveryLocationsForCustomer,
  buildDispatchDeliverySnapshot,
  mapDeliveryAddressRow,
};
