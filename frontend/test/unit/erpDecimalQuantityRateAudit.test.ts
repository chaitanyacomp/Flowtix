/**
 * ERP-wide Quantity/Rate decimal input audit.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blockDecimalSpinnerKeys,
  blockDecimalWheel,
  normalizeDecimalOnBlur,
  sanitizeDecimalInput,
} from "../../src/lib/keyboardDecimalInput";

const srcRoot = resolve(__dirname, "../../src");

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsx(full, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

const ALLOWED_TYPE_NUMBER = new Set([
  // Integer admin reverse-window days/hours — not a qty/rate commercial field
  relative(srcRoot, join(srcRoot, "pages/AdminSettingsPage.tsx")).replace(/\\/g, "/"),
]);

describe("ERP decimal Quantity/Rate audit", () => {
  const files = walkTsx(srcRoot);

  it("has no type=number outside justified allowlist", () => {
    /** @type {{ file: string; line: string }[]} */
    const hits: { file: string; line: string }[] = [];
    for (const file of files) {
      const rel = relative(srcRoot, file).replace(/\\/g, "/");
      if (rel === "lib/keyboardDecimalInput.ts") continue;
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (/type\s*=\s*["']number["']/.test(line) || /type=\{["']number["']\}/.test(line)) {
          hits.push({ file: `${rel}:${i + 1}`, line: line.trim() });
        }
      });
    }
    const unexpected = hits.filter((h) => {
      const filePath = h.file.split(":")[0]!;
      return !ALLOWED_TYPE_NUMBER.has(filePath);
    });
    expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
  });

  it("shared DecimalInput uses text + decimal inputMode and blocks spinners", () => {
    const src = readFileSync(join(srcRoot, "components/ui/DecimalInput.tsx"), "utf8");
    expect(src).toContain('type="text"');
    expect(src).toContain('inputMode="decimal"');
    expect(src).toContain("blockDecimalSpinnerKeys");
    expect(src).toContain("blockDecimalWheel");
    expect(src).toContain("sanitizeDecimalInput");
    expect(src).toContain("normalizeDecimalOnBlur");
    expect(src).not.toMatch(/type=["']number["']/);
  });

  it("GRN Post Goods Receipt Receive qty uses DecimalInput (no spinner)", () => {
    const src = readFileSync(join(srcRoot, "components/rmPurchase/GrnPostReceiptModal.tsx"), "utf8");
    expect(src).toContain("DecimalInput");
    expect(src).toContain("Receive qty");
    expect(src).not.toMatch(/type=["']number["']/);
    expect(src).toContain("onReceiveFull");
    expect(src).toContain("onReceiveNone");
    expect(src).toContain("grnPostDisabled");
    expect(src).toContain('data-testid="grn-post-receipt-modal-confirm"');
    expect(src).toContain("sticky bottom-0");
  });

  it("Create RM PO Rate and Order Qty use DecimalInput", () => {
    const src = readFileSync(join(srcRoot, "components/purchase/PendingMaterialRequestsPanel.tsx"), "utf8");
    expect(src).toContain("DecimalInput");
    expect(src).toContain("rm-po-order-qty");
    expect(src).toContain("rm-po-rate");
    expect(src).not.toMatch(/type=["']number["']/);
  });

  it("decimal helpers: reject invalid, allow decimals, blur normalize, block wheel/arrows", () => {
    expect(sanitizeDecimalInput("78.5")).toBe("78.5");
    expect(sanitizeDecimalInput("0.42")).toBe("0.42");
    expect(sanitizeDecimalInput("175.25")).toBe("175.25");
    expect(sanitizeDecimalInput("12a")).toBeNull();
    expect(sanitizeDecimalInput("-1")).toBeNull();
    expect(normalizeDecimalOnBlur("2.5000")).toBe("2.5");
    expect(normalizeDecimalOnBlur(".")).toBe("0");

    let arrowsBlocked = 0;
    blockDecimalSpinnerKeys({
      key: "ArrowUp",
      preventDefault: () => {
        arrowsBlocked += 1;
      },
    });
    blockDecimalSpinnerKeys({
      key: "ArrowDown",
      preventDefault: () => {
        arrowsBlocked += 1;
      },
    });
    expect(arrowsBlocked).toBe(2);

    let wheelBlocked = false;
    blockDecimalWheel({
      preventDefault: () => {
        wheelBlocked = true;
      },
    });
    expect(wheelBlocked).toBe(true);
  });

  it("numeric column alignment classes remain right-aligned in GRN modal table", () => {
    const src = readFileSync(join(srcRoot, "components/rmPurchase/GrnPostReceiptModal.tsx"), "utf8");
    expect(src).toMatch(/text-right[^"]*Receive qty|Receive qty[\s\S]*?text-right/);
    expect(src).toContain("text-right tabular-nums");
  });
});
