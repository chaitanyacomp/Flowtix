import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearProductionReportDraft,
  getProductionReportDraft,
  isProductionReportDraftDirty,
  saveProductionReportDraft,
} from "../../src/lib/productionReportDraftCache";

function installMemorySessionStorage() {
  const store = new Map<string, string>();
  const api = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: api,
  });
  return api;
}

describe("productionReportDraftCache", () => {
  beforeEach(() => {
    installMemorySessionStorage();
  });

  afterEach(() => {
    clearProductionReportDraft(42);
    try {
      sessionStorage.clear();
    } catch {
      // ignore
    }
  });

  it("persists unconfirmed wastage draft to sessionStorage for refresh survival", () => {
    saveProductionReportDraft(
      42,
      {
        lineInputs: {
          7: {
            rmConsumedQty: "10",
            rmReturnQty: "1",
            remarks: "",
          },
        },
        wastageRows: [{ key: "wd-1", itemId: 7, wastageTypeId: 3, qty: "2", remarks: "trim" }],
        remarks: "operator note",
      },
      { dirty: true },
    );

    expect(isProductionReportDraftDirty(42)).toBe(true);
    const raw = sessionStorage.getItem("erp:production-report-draft:v1:42");
    expect(raw).toBeTruthy();
    expect(JSON.parse(String(raw)).wastageRows[0].qty).toBe("2");

    // Simulate page reload: memory map empty, sessionStorage still has draft.
    clearProductionReportDraft(42);
    sessionStorage.setItem(
      "erp:production-report-draft:v1:42",
      JSON.stringify({
        lineInputs: {},
        wastageRows: [{ key: "wd-2", wastageTypeId: 1, qty: "1.5", remarks: "" }],
        remarks: "after refresh",
        dirty: true,
        reportConfirmed: false,
      }),
    );

    const restored = getProductionReportDraft(42);
    expect(restored?.remarks).toBe("after refresh");
    expect(restored?.wastageRows[0]?.qty).toBe("1.5");
  });

  it("clears draft after confirm", () => {
    saveProductionReportDraft(
      42,
      { lineInputs: {}, wastageRows: [{ key: "a", wastageTypeId: 1, qty: "1", remarks: "" }], remarks: "" },
      { dirty: true },
    );
    clearProductionReportDraft(42);
    expect(getProductionReportDraft(42)).toBeNull();
    expect(isProductionReportDraftDirty(42)).toBe(false);
    expect(sessionStorage.getItem("erp:production-report-draft:v1:42")).toBeNull();
  });
});
