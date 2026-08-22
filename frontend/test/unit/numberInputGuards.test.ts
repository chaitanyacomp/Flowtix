/**
 * Global number-input spinner + wheel protection regression.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  blockNumberInputWheel,
  installNumberInputGuards,
  isHtmlNumberInput,
  shouldBlockNumberInputWheel,
} from "../../src/lib/numberInputGuards";

const styleCss = readFileSync(resolve(__dirname, "../../src/style.css"), "utf8");
const mainTsx = readFileSync(resolve(__dirname, "../../src/main.tsx"), "utf8");

function makeNumberInput(overrides: Partial<HTMLInputElement> = {}): HTMLInputElement {
  return {
    tagName: "INPUT",
    type: "number",
    blur: vi.fn(),
    ...overrides,
  } as unknown as HTMLInputElement;
}

describe("global number input spinner / wheel guards", () => {
  it("defines CSS that hides spinners for Chromium/Edge/Safari and Firefox", () => {
    expect(styleCss).toContain('input[type="number"]');
    expect(styleCss).toMatch(/input\[type=["']number["']\][\s\S]*?-moz-appearance:\s*textfield/);
    expect(styleCss).toMatch(/input\[type=["']number["']\][\s\S]*?appearance:\s*textfield/);
    expect(styleCss).toContain("::-webkit-inner-spin-button");
    expect(styleCss).toContain("::-webkit-outer-spin-button");
    expect(styleCss).toMatch(/::-webkit-inner-spin-button[\s\S]*?-webkit-appearance:\s*none/);
    expect(styleCss).toMatch(/::-webkit-outer-spin-button[\s\S]*?-webkit-appearance:\s*none/);
  });

  it("boots the wheel guard from main.tsx without converting inputs to text", () => {
    expect(mainTsx).toContain("installNumberInputGuards");
    expect(mainTsx).not.toMatch(/type\s*=\s*["']text["'].*number|number.*type\s*=\s*["']text["']/);
  });

  it("detects number inputs and ignores other controls", () => {
    expect(isHtmlNumberInput(makeNumberInput())).toBe(true);
    expect(isHtmlNumberInput({ tagName: "INPUT", type: "text" } as HTMLInputElement)).toBe(false);
    expect(isHtmlNumberInput({ tagName: "TEXTAREA", type: "number" } as unknown as HTMLInputElement)).toBe(
      false,
    );
    expect(isHtmlNumberInput(null)).toBe(false);
  });

  it("blocks wheel only when a number input is focused", () => {
    const number = makeNumberInput();
    const text = { tagName: "INPUT", type: "text" } as HTMLInputElement;

    expect(shouldBlockNumberInputWheel({ target: number, activeElement: number })).toBe(true);
    expect(shouldBlockNumberInputWheel({ target: number, activeElement: null })).toBe(false);
    expect(shouldBlockNumberInputWheel({ target: text, activeElement: text })).toBe(false);

    let prevented = 0;
    const blocked = blockNumberInputWheel(
      {
        target: number,
        preventDefault: () => {
          prevented += 1;
        },
      },
      number,
    );
    expect(blocked).toBe(true);
    expect(prevented).toBe(1);

    prevented = 0;
    const skipped = blockNumberInputWheel(
      {
        target: number,
        preventDefault: () => {
          prevented += 1;
        },
      },
      null,
    );
    expect(skipped).toBe(false);
    expect(prevented).toBe(0);
  });

  it("installNumberInputGuards registers a non-passive capture wheel listener", () => {
    const listeners: Array<{ type: string; opts: AddEventListenerOptions | boolean | undefined }> = [];
    const number = makeNumberInput();
    const doc = {
      activeElement: number as Element | null,
      addEventListener: vi.fn((type: string, _fn: EventListener, opts?: AddEventListenerOptions | boolean) => {
        listeners.push({ type, opts });
      }),
      removeEventListener: vi.fn(),
    } as unknown as Document;

    const uninstall = installNumberInputGuards(doc);
    expect(doc.addEventListener).toHaveBeenCalled();
    expect(listeners.some((l) => l.type === "wheel")).toBe(true);
    const wheel = listeners.find((l) => l.type === "wheel");
    expect(wheel?.opts).toMatchObject({ capture: true, passive: false });

    const handler = (doc.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === "wheel",
    )?.[1] as (event: WheelEvent) => void;

    const preventDefault = vi.fn();
    handler({
      target: number,
      preventDefault,
    } as unknown as WheelEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(number.blur).toHaveBeenCalled();

    uninstall();
    expect(doc.removeEventListener).toHaveBeenCalled();
  });
});
