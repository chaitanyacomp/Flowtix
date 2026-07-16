import { describe, expect, it } from "vitest";
import { snapshotPartyMasterForm, snapshotPartyLocation } from "../../src/lib/partyMasterDirtySnapshot";
import { snapshotItemForm } from "../../src/lib/itemMasterDirtySnapshot";
import type { PartyLocationDraft } from "../../src/components/erp/partyMasterUi";

function loc(partial: Partial<PartyLocationDraft> & { key: string }): PartyLocationDraft {
  return {
    key: partial.key,
    id: partial.id,
    label: partial.label ?? "",
    locationType: partial.locationType ?? "OTHER",
    address: partial.address ?? "",
    city: partial.city ?? "",
    district: partial.district ?? "",
    stateId: partial.stateId ?? "",
    pincode: partial.pincode ?? "",
    country: partial.country ?? "",
    gstin: partial.gstin ?? "",
    contactPerson: partial.contactPerson ?? "",
    phone: partial.phone ?? "",
    email: partial.email ?? "",
    notes: partial.notes ?? "",
    isDefault: partial.isDefault ?? false,
    isActive: partial.isActive ?? true,
  };
}

describe("partyMasterDirtySnapshot", () => {
  it("treats null/empty/whitespace header fields as equal", () => {
    const a = snapshotPartyMasterForm(
      { name: " Acme ", contact: "", email: null as unknown as string, gstin: "", stateId: "", address: "  ", isActive: true },
      [],
    );
    const b = snapshotPartyMasterForm(
      { name: "Acme", contact: "", email: "", gstin: "", stateId: null, address: "", isActive: true },
      [],
    );
    expect(a).toBe(b);
  });

  it("ignores location key and API order for persisted rows", () => {
    const a = snapshotPartyMasterForm(
      { name: "C", contact: "", email: "", gstin: "", stateId: 1, address: "", isActive: true },
      [
        loc({ key: "a", id: 2, label: "B", address: "x" }),
        loc({ key: "b", id: 1, label: "A", address: "y" }),
      ],
    );
    const b = snapshotPartyMasterForm(
      { name: "C", contact: "", email: "", gstin: "", stateId: 1, address: "", isActive: true },
      [
        loc({ key: "other", id: 1, label: "A", address: "y" }),
        loc({ key: "diff", id: 2, label: "B", address: "x" }),
      ],
    );
    expect(a).toBe(b);
  });

  it("marks add/remove location as dirty then clean when reverted", () => {
    const header = { name: "C", contact: "", email: "", gstin: "", stateId: null as number | null, address: "", isActive: true };
    const base = snapshotPartyMasterForm(header, []);
    const withLoc = snapshotPartyMasterForm(header, [loc({ key: "n1", label: "Plant" })]);
    expect(withLoc).not.toBe(base);
    expect(snapshotPartyMasterForm(header, [])).toBe(base);
  });

  it("excludes key from location snapshot", () => {
    const s1 = snapshotPartyLocation(loc({ key: "k1", id: 9, label: "L" }));
    const s2 = snapshotPartyLocation(loc({ key: "k2", id: 9, label: "L" }));
    expect(s1).toEqual(s2);
    expect(s1).not.toHaveProperty("key");
  });
});

describe("itemMasterDirtySnapshot", () => {
  const empty = {
    creatingType: "RM" as const,
    name: "",
    unitId: "" as const,
    legacyUnitText: "",
    minimumStock: "",
    lowStockAlert: "",
    bufferPct: "",
    targetStock: "",
    criticalCoveragePct: "50",
    warningCoveragePct: "80",
    hsnCode: "",
    gstRateStr: "",
    fgManualGreenLevel: "",
  };

  it("opens create clean against same defaults", () => {
    expect(snapshotItemForm(empty)).toBe(snapshotItemForm({ ...empty }));
  });

  it("normalizes qty strings and HSN case", () => {
    const a = snapshotItemForm({ ...empty, name: " Bolt ", minimumStock: "10.0", hsnCode: "abc", gstRateStr: "18" });
    const b = snapshotItemForm({ ...empty, name: "Bolt", minimumStock: "10", hsnCode: "ABC", gstRateStr: "18.0" });
    expect(a).toBe(b);
  });

  it("reverting a field restores clean", () => {
    const base = snapshotItemForm(empty);
    const dirty = snapshotItemForm({ ...empty, name: "X" });
    expect(dirty).not.toBe(base);
    expect(snapshotItemForm({ ...empty, name: "" })).toBe(base);
  });
});
