/**
 * HTTP-level proof that browser Preview/Apply routes use the canonical mapper
 * (not a duplicate/stale code path). Uses Master.xml fixture via multipart upload.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const request = require("supertest");
const { createApp } = require("../src/createApp");
const { signAccessToken } = require("../src/utils/jwt");
const { prisma } = require("../src/utils/prisma");
const { TALLY_IMPORT_PIPELINE_ID } = require("../src/services/tallyMasterImport/mapLedgerToParty");

const MASTER_XML = path.join(__dirname, "fixtures/tally/Master.xml");

function adminAuth() {
  return {
    Authorization: `Bearer ${signAccessToken({
      userId: 1,
      email: "admin@test.com",
      role: "ADMIN",
      name: "Admin",
    })}`,
  };
}

/** @type {Record<string, Function>} */
const prismaRestore = {};

function stubPrismaForPreview(existingCustomers = []) {
  prismaRestore.state = prisma.state.findMany;
  prismaRestore.customer = prisma.customer.findMany;
  prismaRestore.supplier = prisma.supplier.findMany;
  prismaRestore.item = prisma.item.findMany;
  prismaRestore.unit = prisma.unit.findMany;

  prisma.state.findMany = async () => [{ id: 1, stateName: "Maharashtra", stateCode: "27" }];
  prisma.customer.findMany = async () => existingCustomers;
  prisma.supplier.findMany = async () => [];
  prisma.item.findMany = async () => [];
  prisma.unit.findMany = async () => [];
}

function restorePrismaPreviewStubs() {
  if (prismaRestore.state) prisma.state.findMany = prismaRestore.state;
  if (prismaRestore.customer) prisma.customer.findMany = prismaRestore.customer;
  if (prismaRestore.supplier) prisma.supplier.findMany = prismaRestore.supplier;
  if (prismaRestore.item) prisma.item.findMany = prismaRestore.item;
  if (prismaRestore.unit) prisma.unit.findMany = prismaRestore.unit;
}

test("HTTP Preview /api/admin/tally-import/preview maps TATA from Master.xml", async () => {
  assert.ok(fs.existsSync(MASTER_XML), "Master.xml fixture missing");
  stubPrismaForPreview([]);
  try {
    const app = createApp();
    const res = await request(app)
      .post("/api/admin/tally-import/preview")
      .set(adminAuth())
      .field(
        "options",
        JSON.stringify({
          defaultItemType: "FG",
          duplicateAction: "SKIP",
          fallbackStateId: 1,
        }),
      )
      .attach("file", MASTER_XML);

    assert.equal(res.status, 200, res.body?.error?.message || JSON.stringify(res.body));
    assert.ok(res.body.runtime?.pipelineId === TALLY_IMPORT_PIPELINE_ID, "stale/wrong pipeline on live route");
    // Bundler-safe static module id (not filesystem require.resolve — breaks packaged server.js)
    assert.equal(res.body.runtime?.mapperModule, "tallyMasterImport/mapLedgerToParty");

    const tata = (res.body.customers || []).find(
      (c) => String(c.tallyName || c.mapped?.name || "").toUpperCase() === "TATA",
    );
    assert.ok(tata, "TATA customer missing from preview response");
    assert.equal(tata.mapped.gstin || tata.mapped.gst, "27ALSKD1412A1Z5");
    assert.equal(tata.mapped.contactPerson || tata.mapped.contact, "Mahesh");
    assert.equal(tata.mapped.phone, "8754789587");
    assert.match(String(tata.mapped.address || ""), /985 Hinjawadi Phase 2/);
    assert.equal(tata.mapped.state || tata.mapped.stateText, "Maharashtra");
    assert.equal(tata.mapped.pincode, "4110085");
    assert.ok(!String(tata.mapped.address || "").startsWith("TATA\n") && tata.mapped.address !== "TATA");
    assert.ok(!(tata.warnings || []).some((w) => /GSTIN must be exactly 15/i.test(w)));
    // Preview must expose XML values even when action is CREATE/SKIP
    assert.ok(["CREATE", "SKIP_DUPLICATE", "UPDATE_EMPTY_FIELDS"].includes(tata.proposedAction));
  } finally {
    restorePrismaPreviewStubs();
  }
});

test("HTTP Preview still shows XML values when existing TATA would be skipped", async () => {
  stubPrismaForPreview([
    {
      id: 99,
      name: "TATA",
      gst: null,
      address: "TATA",
      stateId: null,
      state: null,
      contact: null,
      email: null,
    },
  ]);
  try {
    const app = createApp();
    const res = await request(app)
      .post("/api/admin/tally-import/preview")
      .set(adminAuth())
      .field(
        "options",
        JSON.stringify({
          defaultItemType: "FG",
          duplicateAction: "SKIP",
          fallbackStateId: 1,
        }),
      )
      .attach("file", MASTER_XML);

    assert.equal(res.status, 200, res.body?.error?.message || JSON.stringify(res.body));
    const tata = (res.body.customers || []).find(
      (c) => String(c.tallyName || c.mapped?.name || "").toUpperCase() === "TATA",
    );
    assert.ok(tata);
    assert.equal(tata.proposedAction, "SKIP_DUPLICATE");
    assert.equal(tata.mapped.gst, "27ALSKD1412A1Z5");
    assert.equal(tata.mapped.contact, "Mahesh");
    assert.equal(tata.mapped.phone, "8754789587");
    assert.match(String(tata.mapped.address || ""), /985 Hinjawadi Phase 2/);
  } finally {
    restorePrismaPreviewStubs();
  }
});

test("HTTP Confirm Import creates TATA with mapped fields and one Registered Office address", async () => {
  assert.ok(fs.existsSync(MASTER_XML), "Master.xml fixture missing");

  /** @type {any[]} */
  const createdCustomers = [];
  /** @type {any[]} */
  const createdAddresses = [];
  /** @type {any[]} */
  const updatedCustomers = [];
  /** @type {any[]} */
  const updatedAddresses = [];

  const prev = {
    stateFind: prisma.state.findMany,
    custFind: prisma.customer.findMany,
    custCreate: prisma.customer.create,
    custFindUnique: prisma.customer.findUnique,
    custUpdate: prisma.customer.update,
    addrFind: prisma.customerDeliveryAddress.findMany,
    addrCreate: prisma.customerDeliveryAddress.create,
    addrUpdate: prisma.customerDeliveryAddress.update,
    supFind: prisma.supplier.findMany,
    itemFind: prisma.item.findMany,
    unitFind: prisma.unit.findMany,
    unitFindActive: null,
  };

  prisma.state.findMany = async () => [{ id: 1, stateName: "Maharashtra", stateCode: "27" }];
  prisma.customer.findMany = async () => [...createdCustomers];
  prisma.supplier.findMany = async () => [];
  prisma.item.findMany = async () => [];
  prisma.unit.findMany = async () => [];
  prisma.customer.create = async ({ data }) => {
    const row = { id: 501 + createdCustomers.length, ...data };
    createdCustomers.push(row);
    return { id: row.id };
  };
  prisma.customer.findUnique = async ({ where }) => createdCustomers.find((c) => c.id === where.id) || null;
  prisma.customer.update = async ({ where, data }) => {
    updatedCustomers.push({ where, data });
    const row = createdCustomers.find((c) => c.id === where.id);
    if (row) Object.assign(row, data);
    return row;
  };
  prisma.customerDeliveryAddress.findMany = async ({ where }) =>
    createdAddresses.filter((a) => a.customerId === where.customerId);
  prisma.customerDeliveryAddress.create = async ({ data }) => {
    const row = { id: 801 + createdAddresses.length, ...data };
    createdAddresses.push(row);
    return { id: row.id };
  };
  prisma.customerDeliveryAddress.update = async ({ where, data }) => {
    updatedAddresses.push({ where, data });
    const row = createdAddresses.find((a) => a.id === where.id);
    if (row) Object.assign(row, data);
    return row;
  };

  try {
    const app = createApp();
    const preview = await request(app)
      .post("/api/admin/tally-import/preview")
      .set(adminAuth())
      .field(
        "options",
        JSON.stringify({
          defaultItemType: "FG",
          duplicateAction: "UPDATE_EMPTY_FIELDS_ONLY",
          fallbackStateId: 1,
        }),
      )
      .attach("file", MASTER_XML);
    assert.equal(preview.status, 200, preview.body?.error?.message || JSON.stringify(preview.body));
    const token = preview.body.previewToken;
    assert.ok(token);

    const apply1 = await request(app)
      .post("/api/admin/tally-import/apply")
      .set(adminAuth())
      .send({ previewToken: token, confirm: true });
    assert.equal(apply1.status, 200, apply1.body?.error?.message || JSON.stringify(apply1.body));
    assert.ok(apply1.body.created >= 1);

    const tataCust = createdCustomers.find((c) => String(c.name).toUpperCase() === "TATA");
    assert.ok(tataCust, "customer create not called for TATA");
    assert.equal(tataCust.gst, "27ALSKD1412A1Z5");
    assert.equal(tataCust.contact, "Mahesh");
    assert.match(String(tataCust.address || ""), /985 Hinjawadi Phase 2/);

    const addrs = createdAddresses.filter((a) => a.customerId === tataCust.id);
    assert.equal(addrs.length, 1, "expected one Registered Office delivery address");
    assert.equal(addrs[0].label, "Registered Office");
    assert.equal(addrs[0].locationType, "REGISTERED_OFFICE");
    assert.equal(addrs[0].isDefault, true);
    assert.equal(addrs[0].isActive, true);
    assert.equal(addrs[0].contactPerson, "Mahesh");
    assert.equal(addrs[0].phone, "8754789587");
    assert.equal(addrs[0].gst, "27ALSKD1412A1Z5");
    // Same GSTIN on Customer registered entity and Registered Office location is allowed
    assert.equal(addrs[0].gst, tataCust.gst);

    // Re-import should not duplicate customer/address
    const preview2 = await request(app)
      .post("/api/admin/tally-import/preview")
      .set(adminAuth())
      .field(
        "options",
        JSON.stringify({
          defaultItemType: "FG",
          duplicateAction: "UPDATE_EMPTY_FIELDS_ONLY",
          fallbackStateId: 1,
        }),
      )
      .attach("file", MASTER_XML);
    assert.equal(preview2.status, 200);
    const apply2 = await request(app)
      .post("/api/admin/tally-import/apply")
      .set(adminAuth())
      .send({ previewToken: preview2.body.previewToken, confirm: true });
    assert.equal(apply2.status, 200);
    assert.equal(createdCustomers.filter((c) => String(c.name).toUpperCase() === "TATA").length, 1);
    assert.equal(createdAddresses.filter((a) => a.customerId === tataCust.id).length, 1);
  } finally {
    prisma.state.findMany = prev.stateFind;
    prisma.customer.findMany = prev.custFind;
    prisma.customer.create = prev.custCreate;
    prisma.customer.findUnique = prev.custFindUnique;
    prisma.customer.update = prev.custUpdate;
    prisma.customerDeliveryAddress.findMany = prev.addrFind;
    prisma.customerDeliveryAddress.create = prev.addrCreate;
    prisma.customerDeliveryAddress.update = prev.addrUpdate;
    prisma.supplier.findMany = prev.supFind;
    prisma.item.findMany = prev.itemFind;
    prisma.unit.findMany = prev.unitFind;
  }
});
