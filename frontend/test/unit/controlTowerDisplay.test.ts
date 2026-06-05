import { describe, expect, it } from "vitest";

import {
  formatControlTowerOwner,
  formatControlTowerStatus,
} from "../../src/lib/controlTowerDisplay";

describe("controlTowerDisplay", () => {
  it("formatControlTowerStatus maps known enum values", () => {
    expect(formatControlTowerStatus("QA_PENDING")).toBe("QA pending");
    expect(formatControlTowerStatus("PROCUREMENT_IN_PROGRESS")).toBe("Procurement in progress");
  });

  it("formatControlTowerStatus title-cases unknown tokens", () => {
    expect(formatControlTowerStatus("CUSTOM_STAGE")).toBe("Custom Stage");
  });

  it("formatControlTowerOwner maps ERP roles", () => {
    expect(formatControlTowerOwner("STORE")).toBe("Store");
    expect(formatControlTowerOwner("ADMIN")).toBe("Admin");
  });
});
