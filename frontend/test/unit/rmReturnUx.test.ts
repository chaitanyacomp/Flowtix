import { describe, expect, it } from "vitest";
import {
  computeUnusedIssuedRmQty,
  validateReturnQtyInput,
} from "../../src/lib/rmReturnUx";

describe("rmReturnUx", () => {
  it("computes unused issued RM", () => {
    expect(computeUnusedIssuedRmQty(5200, 3120, 0)).toBe(2080);
    expect(computeUnusedIssuedRmQty(5200, 3120, 1000)).toBe(1080);
  });

  it("validates partial return within returnable", () => {
    expect(validateReturnQtyInput("1000", 2080)).toEqual({ ok: true, qty: 1000 });
  });

  it("rejects return above returnable", () => {
    const r = validateReturnQtyInput("2500", 2080);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("2080");
  });

  it("rejects zero or negative return", () => {
    expect(validateReturnQtyInput("0", 100).ok).toBe(false);
    expect(validateReturnQtyInput("-5", 100).ok).toBe(false);
  });
});
