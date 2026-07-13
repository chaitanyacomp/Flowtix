/**
 * Regression: second Work Order creation from the same Requirement Sheet.
 *
 * Guards the FT-PD-022 / FT-PD-031 rule "One Requirement Sheet may create
 * multiple Work Orders while RS Balance > 0".
 *
 * The production defect was a malformed Zod v4 record schema on the
 * POST /api/requirement-sheets/:id/create-wo body:
 *
 *   woPlacedByItem: z.record(z.coerce.number())        // single-arg -> value schema undefined
 *
 * Under Zod v4 the single-argument form leaves the value schema undefined and
 * throws "Cannot read properties of undefined (reading '_zod')" as soon as
 * woPlacedByItem is non-empty — which happens on every WO after the first.
 * The corrected two-argument form parses cleanly:
 *
 *   woPlacedByItem: z.record(z.string(), z.coerce.number())
 *
 * These tests drive the REAL route validation path (Express router + schema
 * parse) so they fail with the old schema and pass with the fixed schema.
 * The WO-creation service is stubbed so this test stays isolated from the
 * separate MISSING_BOM placement-engine decision.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const http = require("http");
const express = require("express");
const { z } = require("zod");

const SRC = path.join(__dirname, "..", "..", "src");
const prismaPath = require.resolve(path.join(SRC, "utils", "prisma"));
const authPath = require.resolve(path.join(SRC, "middleware", "auth"));
const releasePath = require.resolve(path.join(SRC, "services", "noQtyExecutionReleaseService"));
const pmrPath = require.resolve(path.join(SRC, "services", "productionMaterialRequestService"));
const routerPath = require.resolve(path.join(SRC, "routes", "requirementSheets"));

function fakeModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports, children: [], paths: [] };
}

// Shared mutable capture for the stubbed WO-creation service.
const capture = { calledWith: null };

// Locked NO_QTY requirement sheet with 60,000 demand and one FG line.
const SHEET = {
  id: 42,
  salesOrderId: 10,
  cycleId: 3,
  periodKey: "2026-06",
  version: 1,
  status: "LOCKED",
  salesOrder: { id: 10, orderType: "NO_QTY", customerReturnId: null, lines: [{ itemId: 456, item: { itemType: "FG" } }] },
  lines: [{ id: 1, itemId: 456, requirementQty: "60000", item: { itemName: "FG-456", unit: "Nos" } }],
};

// Minimal transaction client covering only the route pre-service checks.
const tx = {
  requirementSheet: {
    findUnique: async () => SHEET,
    aggregate: async () => ({ _max: { version: 1 } }),
  },
  monthlyProductionPlan: {
    // Period released to procurement -> execution boundary passes.
    findFirst: async () => ({ id: 1, periodKey: "2026-06" }),
  },
};

const mockPrisma = {
  $transaction: async (cb) => cb(tx),
};

let server;
let baseUrl;

function postCreateWo(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      `${baseUrl}/api/requirement-sheets/42/create-wo`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: "Bearer test-token",
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = { raw: data };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

before(async () => {
  // Inject module mocks BEFORE the router is required so it captures the stubs.
  require.cache[prismaPath] = fakeModule(prismaPath, { prisma: mockPrisma });
  require.cache[authPath] = fakeModule(authPath, {
    requireAuth: (req, _res, next) => {
      req.user = { userId: 1, role: "STORE" };
      next();
    },
    requireRole: () => (_req, _res, next) => next(),
  });
  require.cache[pmrPath] = fakeModule(pmrPath, {
    ensureSubmittedProductionMaterialRequestForWorkOrder: async () => ({
      id: 900,
      docNo: "PMR-26-0900",
      status: "SUBMITTED",
    }),
    getExistingProductionMaterialRequestForWorkOrder: async () => null,
  });

  // Preserve the real placement-count constant, stub only the create service.
  const realRelease = require(releasePath);
  require.cache[releasePath] = fakeModule(releasePath, {
    ...realRelease,
    createNoQtyWorkOrderFromLockedSheet: async (_tx, _sheet, options) => {
      capture.calledWith = options;
      // Second WO of 10,000 placed against the remaining 50,000 balance.
      return {
        workOrderId: 1002,
        workOrderDocNo: "WO-26-1002",
        workOrderIds: [1002],
        workOrders: [{ workOrderId: 1002, workOrderDocNo: "WO-26-1002", fgItemId: 456, qty: 10000 }],
        created: true,
        skippedReason: null,
      };
    },
  });

  const { requirementSheetsRouter } = require(routerPath);

  const app = express();
  app.use(express.json());
  app.use("/api", requirementSheetsRouter);
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: { message: err.message } });
  });

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  delete require.cache[prismaPath];
  delete require.cache[authPath];
  delete require.cache[pmrPath];
  delete require.cache[releasePath];
  delete require.cache[routerPath];
});

describe("POST /requirement-sheets/:id/create-wo — second WO schema regression", () => {
  it("parses a non-empty placementSnapshot.woPlacedByItem and reaches WO creation (second WO)", async () => {
    capture.calledWith = null;

    // The first WO already placed 10,000 -> woPlacedByItem is non-empty here.
    const res = await postCreateWo({
      lines: [{ itemId: 456, qty: 10000 }],
      placementSnapshot: {
        totalWoPlacedQty: 10000,
        totalRsBalanceQty: 50000,
        totalExecutableQty: 50000,
        placementStatus: "READY",
        woPlacedByItem: { "456": 10000 },
        lines: [{ itemId: 456, rsBalanceQty: 50000, suggestedExecutableQty: 50000 }],
      },
    });

    // Schema parsed (no _zod TypeError -> not a 500) and WO created.
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.workOrderId, 1002);

    // Control reached the WO-creation transaction/service with the parsed payload.
    assert.ok(capture.calledWith, "createNoQtyWorkOrderFromLockedSheet was not reached");
    assert.equal(capture.calledWith.placementSnapshot.woPlacedByItem["456"], 10000);
    assert.equal(capture.calledWith.requestedLines[0].qty, 10000);

    // RS stays open for further placement while balance remains.
    assert.equal(res.body.rsRemainsOpenForPlacement, true);
  });

  it("still parses when woPlacedByItem is empty (first WO)", async () => {
    capture.calledWith = null;

    const res = await postCreateWo({
      lines: [{ itemId: 456, qty: 10000 }],
      placementSnapshot: {
        totalWoPlacedQty: 0,
        totalRsBalanceQty: 60000,
        totalExecutableQty: 60000,
        placementStatus: "READY",
        woPlacedByItem: {},
        lines: [{ itemId: 456, rsBalanceQty: 60000, suggestedExecutableQty: 60000 }],
      },
    });

    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);
    assert.ok(capture.calledWith, "createNoQtyWorkOrderFromLockedSheet was not reached");
  });
});

describe("z.record schema contract (fix documentation)", () => {
  it("two-argument z.record parses non-empty maps; single-argument form throws under Zod v4", () => {
    const fixedSchema = z.record(z.string(), z.coerce.number());
    assert.deepEqual(fixedSchema.parse({ "456": 10000 }), { "456": 10000 });

    const brokenSchema = z.record(z.coerce.number());
    assert.throws(() => brokenSchema.parse({ "456": 10000 }));
  });
});
