/**
 * Flowtix ERP — commercial demo environment seed (Milestone 4).
 *
 * Creates realistic manufacturing masters + sample commercial documents.
 * LAB / DEMO ONLY — never run against a live customer database.
 *
 * Prerequisites:
 *   - Migrated MySQL database (prisma migrate deploy)
 *   - DATABASE_URL pointing at the demo database
 *
 * Usage (from repo root):
 *   set DEMO_SEED_CONFIRM=YES
 *   node deployment/demo/seed-demo-environment.js
 *
 * Does not modify ERP business rules. Uses Prisma writes for masters/documents
 * in safe initial states; operators complete remaining workflow steps via UI
 * (see DEMO_WALKTHROUGH.md).
 */
const path = require("path");
const bcrypt = require("bcryptjs");

const backendRoot = path.resolve(__dirname, "..", "..", "backend");
require("dotenv").config({ path: path.join(backendRoot, ".env") });

const { PrismaClient } = require(path.join(backendRoot, "prisma", "generated", "client"));
const {
  ensureIndiaStatesSeeded,
  backfillLegacyStateLinks,
} = require(path.join(backendRoot, "src", "services", "stateMaster"));
const {
  ensureDefaultUnitsSeeded,
  backfillLegacyItemUnitLinks,
} = require(path.join(backendRoot, "src", "services", "unitMaster"));

const prisma = new PrismaClient();

const DEMO_PASSWORD = "Flowtix@Demo1";

const DEMO_USERS = [
  { email: "admin@flowtix.demo", name: "Demo Administrator", role: "ADMIN", persona: "Administrator" },
  { email: "sales@flowtix.demo", name: "Demo Sales Executive", role: "ADMIN", persona: "Sales Executive" },
  { email: "purchase@flowtix.demo", name: "Demo Purchase Manager", role: "PURCHASE", persona: "Purchase Manager" },
  { email: "store@flowtix.demo", name: "Demo Store Manager", role: "STORE", persona: "Store Manager" },
  { email: "production@flowtix.demo", name: "Demo Production Supervisor", role: "PRODUCTION", persona: "Production Supervisor" },
  { email: "qa@flowtix.demo", name: "Demo QA Engineer", role: "QA", persona: "QA Engineer" },
  { email: "dispatch@flowtix.demo", name: "Demo Dispatch Executive", role: "STORE", persona: "Dispatch Executive" },
  { email: "accounts@flowtix.demo", name: "Demo Accounts Executive", role: "ADMIN", persona: "Accounts Executive" },
  { email: "auditor@flowtix.demo", name: "Demo Read-Only Auditor", role: "ADMIN", persona: "Read-Only Auditor" },
];

function assertSafeToSeed() {
  if (String(process.env.DEMO_SEED_CONFIRM || "").toUpperCase() !== "YES") {
    console.error("[seed-demo] Refusing: set DEMO_SEED_CONFIRM=YES to proceed.");
    console.error("  This script writes demo masters/documents into DATABASE_URL.");
    process.exit(2);
  }
  const url = String(process.env.DATABASE_URL || "");
  if (!url) {
    console.error("[seed-demo] DATABASE_URL is not set.");
    process.exit(2);
  }
  const lower = url.toLowerCase();
  if (/flowtix_erp_prod|production_erp|customer_live/.test(lower)) {
    console.error("[seed-demo] Refusing: DATABASE_URL looks like a production database name.");
    process.exit(2);
  }
}

async function upsertUser(u) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email: u.email },
    update: { name: u.name, role: u.role, passwordHash, isActive: true },
    create: { email: u.email, name: u.name, role: u.role, passwordHash, isActive: true },
  });
}

async function ensureLocation(row) {
  const existing = await prisma.location.findUnique({ where: { locationCode: row.locationCode } });
  if (existing) {
    return prisma.location.update({
      where: { id: existing.id },
      data: { ...row, isActive: true },
    });
  }
  return prisma.location.create({ data: { ...row, isSystem: true, isActive: true } });
}

async function ensureUnit(code, name) {
  let u = await prisma.unit.findFirst({ where: { unitCode: code } });
  if (u) return u;
  u = await prisma.unit.findFirst({ where: { unitName: name } });
  if (u) return u;
  return prisma.unit.create({
    data: { unitCode: code, unitName: name, isActive: true },
  });
}

async function ensureItem(data) {
  const existing = await prisma.item.findFirst({
    where: { itemName: data.itemName, itemType: data.itemType },
  });
  if (existing) {
    return prisma.item.update({ where: { id: existing.id }, data: { ...data, isActive: true } });
  }
  return prisma.item.create({ data: { ...data, isActive: true } });
}

async function ensureByName(model, name, createData) {
  const existing = await model.findFirst({ where: { name } });
  if (existing) return existing;
  return model.create({ data: createData });
}

async function main() {
  assertSafeToSeed();
  console.log("[seed-demo] Starting Flowtix commercial demo seed...");

  await ensureIndiaStatesSeeded();
  await ensureDefaultUnitsSeeded();

  const mh = await prisma.state.findUnique({ where: { stateCode: "27" } });
  const admin = await upsertUser(DEMO_USERS[0]);
  for (const u of DEMO_USERS.slice(1)) await upsertUser(u);

  await prisma.appSetting.upsert({
    where: { id: 1 },
    update: {
      companyName: "DankelTek Precision Components Pvt Ltd",
      companyAddressLine1: "Plot 42, Midc Industrial Area",
      companyAddressLine2: "Chakan Phase II",
      companyCity: "Pune",
      companyPincode: "410501",
      companyState: mh?.stateName ?? "Maharashtra",
      companyStateId: mh?.id ?? null,
      companyGstin: "27AABCD1234E1Z5",
      companyPan: "AABCD1234E",
      companyMobile: "+91 98765 43210",
      companyEmail: "ops@dankeltek.example",
      companyWebsite: "https://www.dankeltek.example",
      companySignatoryName: "R. Kulkarni",
      maxRegularSoBufferPercent: 10,
    },
    create: {
      id: 1,
      companyName: "DankelTek Precision Components Pvt Ltd",
      companyAddressLine1: "Plot 42, Midc Industrial Area",
      companyAddressLine2: "Chakan Phase II",
      companyCity: "Pune",
      companyPincode: "410501",
      companyState: mh?.stateName ?? "Maharashtra",
      companyStateId: mh?.id ?? null,
      companyGstin: "27AABCD1234E1Z5",
      companyPan: "AABCD1234E",
      companyMobile: "+91 98765 43210",
      companyEmail: "ops@dankeltek.example",
      companyWebsite: "https://www.dankeltek.example",
      companySignatoryName: "R. Kulkarni",
    },
  });

  const locRm = await ensureLocation({
    locationCode: "LOC-RM-STORE",
    locationName: "RM Store",
    locationType: "RM_STORE",
    departmentOwner: "STORES",
    allowRm: true,
    allowFg: false,
    allowSfg: true,
    allowConsumable: true,
  });
  const locFg = await ensureLocation({
    locationCode: "LOC-FG-STORE",
    locationName: "FG Store",
    locationType: "FG_STORE",
    departmentOwner: "STORES",
    allowRm: false,
    allowFg: true,
    allowSfg: true,
    allowConsumable: false,
  });
  await ensureLocation({
    locationCode: "LOC-PROD-FLOOR",
    locationName: "Production Floor",
    locationType: "PRODUCTION",
    departmentOwner: "PRODUCTION",
    allowRm: true,
    allowFg: true,
    allowSfg: true,
    allowConsumable: true,
  });
  await ensureLocation({
    locationCode: "LOC-DISPATCH",
    locationName: "Dispatch Bay",
    locationType: "DISPATCH",
    departmentOwner: "STORES",
    allowRm: false,
    allowFg: true,
    allowSfg: false,
    allowConsumable: false,
  });

  const unitNos = await ensureUnit("NOS", "Nos");
  const unitKg = await ensureUnit("KG", "Kg");

  const customer1 = await ensureByName(prisma.customer, "Precision Auto Components Pvt Ltd", {
    name: "Precision Auto Components Pvt Ltd",
    contact: "Suresh Patil",
    email: "purchase@precision-auto.example",
    address: "Sector 12, MIDC, Aurangabad, Maharashtra 431006",
    gst: "27AABCP5678F1Z2",
    state: "Maharashtra",
    stateId: mh?.id ?? null,
    isActive: true,
  });

  const customer2 = await ensureByName(prisma.customer, "Western Rail Engineering Works", {
    name: "Western Rail Engineering Works",
    contact: "Meena Joshi",
    email: "stores@wrew.example",
    address: "Carriage Workshop Road, Lower Parel, Mumbai 400013",
    gst: "27AAACW9012G1Z8",
    state: "Maharashtra",
    stateId: mh?.id ?? null,
    isActive: true,
  });

  const supplierPoly = await ensureByName(prisma.supplier, "Polymer Traders India", {
    name: "Polymer Traders India",
    contact: "Anil Deshmukh",
    email: "sales@polymer-traders.example",
    address: "B-14, Plastic Zone, Vapi, Gujarat 396195",
    gst: "24AABCP7788H1Z3",
    state: "Gujarat",
    stateName: "Gujarat",
    stateCode: "24",
    isActive: true,
  });

  const supplierMetal = await ensureByName(prisma.supplier, "Metal Forms India Pvt Ltd", {
    name: "Metal Forms India Pvt Ltd",
    contact: "Priya Nair",
    email: "orders@metalforms.example",
    address: "Industrial Estate, Pimpri, Pune 411018",
    gst: "27AADCM3344J1Z6",
    state: "Maharashtra",
    stateName: "Maharashtra",
    stateCode: "27",
    stateId: mh?.id ?? null,
    isActive: true,
  });

  const fgHousing = await ensureItem({
    itemName: "FG-Housing Cover HC-240",
    itemType: "FG",
    unit: "Nos",
    unitId: unitNos.id,
    hsnCode: "87089900",
    gstRate: 18,
    minStockLevel: 50,
  });
  const fgBracket = await ensureItem({
    itemName: "FG-Mounting Bracket MB-110",
    itemType: "FG",
    unit: "Nos",
    unitId: unitNos.id,
    hsnCode: "73089090",
    gstRate: 18,
    minStockLevel: 100,
  });
  const rmPp = await ensureItem({
    itemName: "RM-PP Granules Natural",
    itemType: "RM",
    unit: "Kg",
    unitId: unitKg.id,
    hsnCode: "39021000",
    gstRate: 18,
    minStockLevel: 500,
  });
  const rmSteel = await ensureItem({
    itemName: "RM-CRCA Sheet 1.2mm",
    itemType: "RM",
    unit: "Kg",
    unitId: unitKg.id,
    hsnCode: "72104900",
    gstRate: 18,
    minStockLevel: 300,
  });
  const rmScrew = await ensureItem({
    itemName: "RM-M6 Hex Screw SS",
    itemType: "RM",
    unit: "Nos",
    unitId: unitNos.id,
    hsnCode: "73181500",
    gstRate: 18,
    minStockLevel: 2000,
  });

  let bom = await prisma.bom.findFirst({ where: { fgItemId: fgHousing.id, revisionNo: 1 } });
  if (!bom) {
    bom = await prisma.bom.create({
      data: {
        fgItemId: fgHousing.id,
        docNo: "BOM-26-DEMO-0001",
        bomType: "STANDARD",
        status: "APPROVED",
        normalizationMode: "PER_PIECE",
        revisionNo: 1,
        effectiveFrom: new Date(),
        remarks: "Demo BOM — Housing Cover HC-240",
        approvedAt: new Date(),
        isLocked: true,
        lockedAt: new Date(),
        fgWeight: 0.38,
        fgWeightUnitId: unitKg.id,
        runnerWeight: 0.04,
        outputQty: 1,
        lines: {
          create: [
            { rmItemId: rmPp.id, baseQty: 0.42, notes: "Injection shot weight incl. runner share" },
            { rmItemId: rmScrew.id, baseQty: 4, notes: "Fasteners per assembly" },
          ],
        },
      },
    });
  }

  let bom2 = await prisma.bom.findFirst({ where: { fgItemId: fgBracket.id, revisionNo: 1 } });
  if (!bom2) {
    bom2 = await prisma.bom.create({
      data: {
        fgItemId: fgBracket.id,
        docNo: "BOM-26-DEMO-0002",
        bomType: "STANDARD",
        status: "APPROVED",
        normalizationMode: "PER_PIECE",
        revisionNo: 1,
        effectiveFrom: new Date(),
        remarks: "Demo BOM — Mounting Bracket MB-110",
        approvedAt: new Date(),
        isLocked: true,
        lockedAt: new Date(),
        fgWeight: 0.75,
        fgWeightUnitId: unitKg.id,
        runnerWeight: 0,
        outputQty: 1,
        lines: {
          create: [
            { rmItemId: rmSteel.id, baseQty: 0.85, notes: "Blank + trim" },
            { rmItemId: rmScrew.id, baseQty: 2, notes: "Mounting screws" },
          ],
        },
      },
    });
  }

  async function ensureOpening(itemId, locationId, qty) {
    const existing = await prisma.stockTransaction.findFirst({
      where: { itemId, locationId, transactionType: "OPENING", refId: itemId },
    });
    if (existing) return existing;
    return prisma.stockTransaction.create({
      data: {
        itemId,
        locationId,
        transactionType: "OPENING",
        refId: itemId,
        stockBucket: "USABLE",
        qtyIn: qty,
        qtyOut: 0,
        reason: "Demo opening stock",
        createdByUserId: admin.id,
        approvedByUserId: admin.id,
      },
    });
  }
  await ensureOpening(rmPp.id, locRm.id, 2500);
  await ensureOpening(rmSteel.id, locRm.id, 1800);
  await ensureOpening(rmScrew.id, locRm.id, 25000);
  await ensureOpening(fgHousing.id, locFg.id, 120);
  await ensureOpening(fgBracket.id, locFg.id, 200);

  let so = await prisma.salesOrder.findFirst({ where: { docNo: "SO-26-DEMO-0001" } });
  if (!so) {
    so = await prisma.salesOrder.create({
      data: {
        docNo: "SO-26-DEMO-0001",
        customerId: customer1.id,
        customerPoReference: "PAC/PO/2026/8841",
        orderType: "NORMAL",
        internalStatus: "OPEN",
        remarks: "Demo regular SO — Housing Cover + Bracket",
        billToNameSnapshot: customer1.name,
        billToAddressSnapshot: customer1.address,
        billToGstinSnapshot: customer1.gst,
        billToStateNameSnapshot: "Maharashtra",
        billToStateCodeSnapshot: "27",
        shipToLabelSnapshot: "Works",
        shipToAddressSnapshot: customer1.address,
        shipToGstinSnapshot: customer1.gst,
        shipToStateNameSnapshot: "Maharashtra",
        shipToStateCodeSnapshot: "27",
        posStateNameSnapshot: "Maharashtra",
        posStateCodeSnapshot: "27",
        posSourceSnapshot: "BILL_TO",
        lines: {
          create: [
            {
              itemId: fgHousing.id,
              customerPoQty: 500,
              bufferPercent: 5,
              qty: 525,
              rate: 185.0,
            },
            {
              itemId: fgBracket.id,
              customerPoQty: 800,
              bufferPercent: 5,
              qty: 840,
              rate: 62.5,
            },
          ],
        },
      },
    });
  }

  let soNq = await prisma.salesOrder.findFirst({ where: { docNo: "SO-26-DEMO-NQ-0001" } });
  if (!soNq) {
    soNq = await prisma.salesOrder.create({
      data: {
        docNo: "SO-26-DEMO-NQ-0001",
        customerId: customer2.id,
        customerPoReference: "WREW/IND/26/112",
        orderType: "NO_QTY",
        internalStatus: "OPEN",
        remarks: "Demo NO_QTY SO — rate capture for cycle planning",
        billToNameSnapshot: customer2.name,
        billToAddressSnapshot: customer2.address,
        billToGstinSnapshot: customer2.gst,
        billToStateNameSnapshot: "Maharashtra",
        billToStateCodeSnapshot: "27",
        lines: {
          create: [
            {
              itemId: fgHousing.id,
              customerPoQty: 0,
              bufferPercent: 0,
              qty: 0,
              rate: 190.0,
              gstRate: 18,
            },
          ],
        },
      },
    });
  }

  await backfillLegacyStateLinks();
  await backfillLegacyItemUnitLinks();

  console.log("[seed-demo] Completed.");
  console.log("  Company : DankelTek Precision Components Pvt Ltd");
  console.log(`  Customers: ${customer1.name}; ${customer2.name}`);
  console.log(`  Suppliers: ${supplierPoly.name}; ${supplierMetal.name}`);
  console.log(`  FG items : ${fgHousing.itemName}; ${fgBracket.itemName}`);
  console.log(`  BOM      : ${bom.docNo}; ${bom2.docNo}`);
  console.log("  SO       : SO-26-DEMO-0001 (NORMAL), SO-26-DEMO-NQ-0001 (NO_QTY)");
  console.log(`  Users    : ${DEMO_USERS.length} (@flowtix.demo)`);
  console.log(`  Password : ${DEMO_PASSWORD}  (change after first login — see DEMO_USERS.md)`);
  console.log("  Next     : Follow DEMO_WALKTHROUGH.md for RS / Planning / PO / WO / QC / Dispatch / Bills");
}

main()
  .catch((e) => {
    console.error("[seed-demo] FATAL:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
