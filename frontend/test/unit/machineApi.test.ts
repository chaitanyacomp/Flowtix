import { describe, expect, it } from "vitest";
import { MACHINE_TYPES, normalizeMachineCodePreview } from "../../src/lib/machineApi";

describe("machineApi helpers (Machine Master)", () => {
  it("lists machine types with labels", () => {
    expect(MACHINE_TYPES.length).toBeGreaterThanOrEqual(5);
    expect(MACHINE_TYPES.some((t) => t.value === "INJECTION_MOULDING")).toBe(true);
    expect(MACHINE_TYPES.find((t) => t.value === "CNC")?.label).toBe("CNC");
  });

  it("normalizes machine code like the backend (trim, upper, spaces → _)", () => {
    expect(normalizeMachineCodePreview("  inj 01 ")).toBe("INJ_01");
    expect(normalizeMachineCodePreview("m1")).toBe("M1");
    expect(normalizeMachineCodePreview("   ")).toBe("");
  });
});
