import { describe, expect, it } from "vitest";
import {
  buildListReturnTo,
  consumeListScrollPosition,
  LIST_STATE_FORBIDDEN_RESTORE_KEYS,
  readListPageParam,
  resolveListBackTarget,
  sanitizeListSearchParams,
  saveListScrollPosition,
  withListReturnContext,
} from "../../src/lib/listNavigationState";

describe("listNavigationState helpers", () => {
  it("buildListReturnTo keeps filters and strips forbidden modal/action keys", () => {
    const params = new URLSearchParams("poStatus=OPEN&q=hdpe&action=new-so&openInvoice=9");
    const built = buildListReturnTo("/rm-po-grn", params.toString());
    expect(built).toBe("/rm-po-grn?poStatus=OPEN&q=hdpe");
    expect(built).not.toContain("action=");
    expect(built).not.toContain("openInvoice=");
  });

  it("withListReturnContext appends returnTo once", () => {
    const list = "/sales-orders?soType=NO_QTY&search=acme";
    const href = withListReturnContext("/sales-orders/12/requirement-sheets", list);
    expect(href).toContain("returnTo=");
    expect(href).toContain(encodeURIComponent(list));
    expect(withListReturnContext(`${href}&foo=1`, list)).toBe(`${href}&foo=1`);
  });

  it("resolveListBackTarget rejects unsafe values", () => {
    expect(resolveListBackTarget("//evil", "/dashboard")).toBe("/dashboard");
    expect(resolveListBackTarget("/login", "/dashboard")).toBe("/dashboard");
    expect(resolveListBackTarget("/work-orders?q=wo-1", "/dashboard")).toBe("/work-orders?q=wo-1");
  });

  it("readListPageParam falls back for invalid page numbers", () => {
    const sp = new URLSearchParams("ledgerPage=0&ledgerPage=abc");
    expect(readListPageParam(sp, "ledgerPage", 1)).toBe(1);
    sp.set("ledgerPage", "3");
    expect(readListPageParam(sp, "ledgerPage", 1)).toBe(3);
  });

  it("does not restore forbidden keys via sanitize", () => {
    const clean = sanitizeListSearchParams(new URLSearchParams("q=test&modal=1&finalize=1"));
    expect(clean.get("q")).toBe("test");
    for (const k of LIST_STATE_FORBIDDEN_RESTORE_KEYS) {
      expect(clean.has(k)).toBe(false);
    }
  });

  it("scroll restore is path-scoped and consume-once", () => {
    saveListScrollPosition("/dispatch", 880);
    expect(consumeListScrollPosition("/dispatch")).toBe(880);
    expect(consumeListScrollPosition("/dispatch")).toBeNull();
    expect(consumeListScrollPosition("/sales-orders")).toBeNull();
  });
});

describe("list query defaults", () => {
  it("empty search opens list with normal defaults", () => {
    const built = buildListReturnTo("/sales-orders", "");
    expect(built).toBe("/sales-orders");
  });

  it("bookmark with filters round-trips through returnTo", () => {
    const list = buildListReturnTo("/work-orders", "woStatus=OPEN&q=wo-26&sort=date&dir=desc");
    const detail = withListReturnContext("/work-orders/99", list);
    const sp = new URLSearchParams(detail.split("?")[1] ?? "");
    const back = resolveListBackTarget(sp.get("returnTo"), "/dashboard");
    expect(back).toBe("/work-orders?woStatus=OPEN&q=wo-26&sort=date&dir=desc");
  });
});
