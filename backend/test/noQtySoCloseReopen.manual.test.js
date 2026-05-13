/**
 * Manual / integration checklist for NO_QTY SO close + reopen (no stock movement).
 * Run with: node --test backend/test/noQtySoCloseReopen.manual.test.js
 * Full DB checks: use NODE_ENV=test + TEST_DATABASE_URL + `npm run test:integration:db`
 * and extend with real API calls.
 */

const { describe, it } = require("node:test");

describe.skip("NO_QTY SO close / reopen — manual validation checklist", () => {
  it("documents scenarios (implement as integration tests when DB available)", () => {
    void [
      "1) Close NO_QTY SO with last shortage 500: snapshot line created; SO MANUALLY_CLOSED; no new StockTransaction rows; dashboard does not show Create Next RS for that SO.",
      "2) Reopen CONTINUE_SHORTAGE: admin password required; SO OPEN; snapshot status REOPENED_CONTINUE; RS draft carry-forward matches frozen shortage; suggested WO uses current USABLE only.",
      "3) Reopen IGNORE_SHORTAGE: SO OPEN; snapshot REOPENED_IGNORED; RS draft carry-forward 0; closed shortage still visible in reports from snapshot lines.",
      "4) After close, consume usable elsewhere; reopen CONTINUE; planning reflects current usable, not historical.",
      "5) Pending QC / rework / scrap: close and reopen do not post BUCKET_TRANSFER or QC stock rows.",
    ];
  });
});
