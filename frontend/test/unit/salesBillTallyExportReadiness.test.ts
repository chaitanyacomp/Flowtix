import { describe, expect, it } from "vitest";
import {
  isMissingTransportationLedgerError,
  parseSalesBillTallyExportError,
  tallyTransportationMappingHref,
} from "../../src/lib/salesBillTallyExportReadiness";

describe("salesBillTallyExportReadiness", () => {
  it("builds Map Transportation Ledger deep-link with returnTo", () => {
    expect(tallyTransportationMappingHref({ salesBillId: 177 })).toBe(
      "/admin/settings?section=tally-ledgers&focus=transportation&returnTo=%2Fsales-bills%2F177",
    );
  });

  it("parses structured transportation mapping API errors", () => {
    const parsed = parseSalesBillTallyExportError({
      error: {
        message: "Tally export blocked: Transportation Charges is not mapped to a Tally ledger.\n\nBill: SB-26-0001",
        code: "MISSING_TRANSPORTATION_LEDGER_MAPPING",
        action: "MAP_TRANSPORTATION_LEDGER",
        tallyExportReadiness: {
          ready: false,
          status: "MISSING_TRANSPORTATION_LEDGER_MAPPING",
          label: "Missing Transportation Ledger Mapping",
        },
      },
    });
    expect(parsed.code).toBe("MISSING_TRANSPORTATION_LEDGER_MAPPING");
    expect(parsed.action).toBe("MAP_TRANSPORTATION_LEDGER");
    expect(isMissingTransportationLedgerError(parsed.message, parsed.code)).toBe(true);
    expect(parsed.message).toContain("Transportation Charges");
    expect(parsed.message).not.toMatch(/mapping is missing for 177/);
  });
});
