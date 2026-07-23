import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  FUTURE_ITEM_TYPE_CANDIDATES,
  ITEM_TYPE_CODES,
  ITEM_TYPE_DEFINITIONS,
  MANUALLY_CREATABLE_ITEM_TYPES,
  isItemTypeCode,
  itemTypeLabel,
} from "../../src/lib/itemTypes";

const root = path.resolve(__dirname, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("itemTypes catalog", () => {
  it("authoritative codes are RM, FG, SFG, CONSUMABLE only", () => {
    expect([...ITEM_TYPE_CODES]).toEqual(["RM", "FG", "SFG", "CONSUMABLE"]);
    expect(ITEM_TYPE_DEFINITIONS.map((d) => d.code)).toEqual([...ITEM_TYPE_CODES]);
    expect(MANUALLY_CREATABLE_ITEM_TYPES.map((d) => d.code)).toEqual([...ITEM_TYPE_CODES]);
  });

  it("does not treat future packing/tool/scrap as schema types", () => {
    for (const c of FUTURE_ITEM_TYPE_CANDIDATES) {
      expect(isItemTypeCode(c)).toBe(false);
    }
  });

  it("labels Consumable clearly", () => {
    expect(itemTypeLabel("CONSUMABLE")).toBe("Consumable");
  });
});

describe("Items workbench Add Item Consumable support", () => {
  it("uses Add Item dropdown with all supported types including Consumable", () => {
    const page = read("src/pages/ItemsPage.tsx");
    const menu = read("src/components/masters/AddItemTypeMenu.tsx");
    const catalog = read("src/lib/itemTypes.ts");
    expect(page).toContain("AddItemTypeMenu");
    expect(page).not.toMatch(/\+ Raw material/);
    expect(menu).toContain("MANUALLY_CREATABLE_ITEM_TYPES");
    expect(menu).toContain("data-testid={`add-item-type-${t.code}`}");
    expect(menu).toContain("{t.label}");
    expect(catalog).toContain('label: "Raw Material"');
    expect(catalog).toContain('label: "Finished Good"');
    expect(catalog).toContain('label: "Semi-finished Good"');
    expect(catalog).toContain('label: "Consumable"');
    expect(MANUALLY_CREATABLE_ITEM_TYPES.map((t) => t.code)).toEqual(["RM", "FG", "SFG", "CONSUMABLE"]);
  });

  it("openAdd accepts CONSUMABLE and edit preserves CONSUMABLE (no remap to RM)", () => {
    const page = read("src/pages/ItemsPage.tsx");
    expect(page).toMatch(/function openAdd\(type: ItemTypeCode\)/);
    expect(page).not.toContain('itemType === "CONSUMABLE" ? "RM"');
    expect(page).toContain("itemType: creatingType");
    expect(page).toContain("typeChangeAllowed");
  });

  it("Type filter options come from ITEM_TYPE_DEFINITIONS", () => {
    const page = read("src/pages/ItemsPage.tsx");
    expect(page).toContain("ITEM_TYPE_DEFINITIONS.map");
  });

  it("form title shows selected type on add", () => {
    const page = read("src/pages/ItemsPage.tsx");
    expect(page).toContain("Add Item — ${itemTypeLabel(creatingType)}");
  });
});
