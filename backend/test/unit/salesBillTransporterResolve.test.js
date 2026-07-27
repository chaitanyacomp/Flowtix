const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { resolveSalesBillTransporterForSave } = require("../../src/services/salesBillService");

function mockTx(supplierRow) {
  return {
    supplier: {
      findUnique: async ({ where }) => {
        if (!supplierRow || supplierRow.id !== where.id) return null;
        return supplierRow;
      },
    },
  };
}

describe("resolveSalesBillTransporterForSave", () => {
  it("snapshots name from active transporter master and ignores client name", async () => {
    const tx = mockTx({ id: 5, name: "Master Carrier", isActive: true, isTransporter: true });
    const out = await resolveSalesBillTransporterForSave(
      tx,
      {
        amount: 100,
        chargedBy: "OUR_COMPANY",
        transporterId: 5,
        transporterName: "Spoofed Name",
        referenceNo: " LR-1 ",
        vehicleNumber: "mh12ab1234",
      },
      {},
    );
    assert.equal(out.transporterId, 5);
    assert.equal(out.transporterName, "Master Carrier");
    assert.equal(out.referenceNo, "LR-1");
    assert.equal(out.vehicleNumber, "MH 12 AB 1234");
  });

  it("rejects inactive or non-transporter suppliers", async () => {
    await assert.rejects(
      () =>
        resolveSalesBillTransporterForSave(
          mockTx({ id: 5, name: "X", isActive: false, isTransporter: true }),
          { amount: 10, chargedBy: "OUR_COMPANY", transporterId: 5, vehicleNumber: "MH12AB1234" },
        ),
      (err) => err.statusCode === 400 && /active transporter/i.test(err.message),
    );
    await assert.rejects(
      () =>
        resolveSalesBillTransporterForSave(
          mockTx({ id: 5, name: "X", isActive: true, isTransporter: false }),
          { amount: 10, chargedBy: "OUR_COMPANY", transporterId: 5, vehicleNumber: "MH12AB1234" },
        ),
      (err) => err.statusCode === 400 && /active transporter/i.test(err.message),
    );
    await assert.rejects(
      () =>
        resolveSalesBillTransporterForSave(mockTx(null), {
          amount: 10,
          chargedBy: "OUR_COMPANY",
          transporterId: 999,
          vehicleNumber: "MH12AB1234",
        }),
      (err) => err.statusCode === 400,
    );
  });

  it("keeps legacy name snapshot without accepting a free-text replacement", async () => {
    const out = await resolveSalesBillTransporterForSave(
      mockTx(null),
      {
        amount: 40,
        chargedBy: "OUR_COMPANY",
        transporterName: "Attempted Rewrite",
      },
      {
        allowLegacyNameOnly: true,
        allowLegacyVehicleOmit: true,
        legacyTransporterName: "Historical Carrier",
      },
    );
    assert.equal(out.transporterId, null);
    assert.equal(out.transporterName, "Historical Carrier");
  });

  it("rejects invalid transportation amount and vehicle text", async () => {
    await assert.rejects(
      () =>
        resolveSalesBillTransporterForSave(mockTx(null), {
          amount: "1,000",
          chargedBy: "OUR_COMPANY",
        }),
      (err) => err.statusCode === 400 && /Transportation charges/i.test(err.message),
    );
    await assert.rejects(
      () =>
        resolveSalesBillTransporterForSave(
          mockTx({ id: 5, name: "Master Carrier", isActive: true, isTransporter: true }),
          {
            amount: 10,
            chargedBy: "OUR_COMPANY",
            transporterId: 5,
            vehicleNumber: "not a plate",
          },
        ),
      (err) => err.statusCode === 400 && /valid vehicle number/i.test(err.message),
    );
  });

  it("clears transporter when transport is not applicable", async () => {
    const out = await resolveSalesBillTransporterForSave(
      mockTx(null),
      { amount: 0, chargedBy: "OUR_COMPANY", transporterName: "Ignore Me", vehicleNumber: "" },
      {},
    );
    assert.equal(out.transporterId, null);
    assert.equal(out.transporterName, null);
    assert.equal(out.vehicleNumber, null);
  });
});
