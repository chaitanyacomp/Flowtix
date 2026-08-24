/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MATERIAL_CONDITIONS,
  SETUP_CONDITIONS,
  CONFIRM_START_MODAL_TITLE,
  MATERIAL_REQUIRED_LABEL,
  MATERIAL_QUESTION,
  MOULD_QUESTION,
  MACHINE_MATERIAL_NOT_RECORDED_NOTE,
  CONFIRM_START_LAYOUT,
  CONFIRM_START_BANNED_OPERATOR_WORDS,
  parseActualPurgeQtyDraft,
  suggestPurgeFromActualCondition,
  canEnableConfirmStart,
  formatReadableMaterialProfileLabel,
  mouldChoiceAffectsPurgeDecision,
  operatorMessageFromConfirmError,
  formatStartConfirmSuccessSummary,
} from "../../src/lib/productionRunStartConfirmation";
import {
  emptyConfirmStartSelection,
  isConfirmStartSelectionComplete,
  reduceConfirmStartSelection,
  selectionSurvivesPreviewRerender,
} from "../../src/lib/confirmProductionStartSelection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function operatorFacingCopyBlob(): string {
  return [
    ...MATERIAL_CONDITIONS.map((c) => c.label),
    ...SETUP_CONDITIONS.map((c) => c.label),
    CONFIRM_START_MODAL_TITLE,
    MATERIAL_REQUIRED_LABEL,
    MATERIAL_QUESTION,
    MOULD_QUESTION,
    MACHINE_MATERIAL_NOT_RECORDED_NOTE,
    "Purging required",
    "Purging not required",
    "Purging quantity (g)",
    "Difference from standard",
    "Confirm Start",
    ...MATERIAL_CONDITIONS.map((c) => suggestPurgeFromActualCondition(c.value).suggestedPurgingReason ?? ""),
    formatReadableMaterialProfileLabel([]),
    formatReadableMaterialProfileLabel([{ itemName: "PP Black Grinding", mixPercent: 100 }]),
  ].join("\n");
}

describe("production start confirmation — exact operator labels", () => {
  it("uses exact simple material and mould labels", () => {
    expect(CONFIRM_START_MODAL_TITLE).toBe("Check Machine Before Start");
    expect(MATERIAL_REQUIRED_LABEL).toBe("Material required for this job:");
    expect(MATERIAL_QUESTION).toBe("Which material is inside the machine now?");
    expect(MOULD_QUESTION).toBe("Is the correct mould fitted?");
    expect(MACHINE_MATERIAL_NOT_RECORDED_NOTE).toBe(
      "Machine material is not recorded. Please check before starting.",
    );
    expect(MATERIAL_CONDITIONS.map((c) => c.label)).toEqual([
      "Same material as this job",
      "Different material",
      "Machine is empty/cleaned",
      "Not sure",
    ]);
    expect(SETUP_CONDITIONS.map((c) => c.label)).toEqual([
      "Correct mould was already fitted",
      "Correct mould is fitted now",
    ]);
    expect(MATERIAL_CONDITIONS.map((c) => c.value)).toEqual([
      "SAME_MATERIAL_RETAINED",
      "DIFFERENT_MATERIAL_RETAINED",
      "MACHINE_CLEARED",
      "UNKNOWN",
    ]);
  });

  it("contains no banned technical words in operator-facing UI copy", () => {
    const blob = operatorFacingCopyBlob().toLowerCase();
    for (const word of CONFIRM_START_BANNED_OPERATOR_WORDS) {
      expect(blob, `banned word present: ${word}`).not.toContain(word.toLowerCase());
    }
    expect(blob).not.toContain("same planned material retained");
    expect(blob).not.toContain("rm allocation");
  });
});

describe("production start confirmation — selection interactions", () => {
  it("starts with nothing selected and Confirm disabled", () => {
    const state = emptyConfirmStartSelection();
    expect(state.materialCondition).toBeNull();
    expect(state.setupCondition).toBeNull();
    expect(state.actualPurgeRequired).toBeNull();
    expect(isConfirmStartSelectionComplete(state)).toBe(false);
    expect(
      canEnableConfirmStart({
        materialCondition: state.materialCondition,
        setupCondition: state.setupCondition,
        actualPurgeRequired: state.actualPurgeRequired,
        purgeQtyOk: false,
        overrideReasonOk: true,
      }),
    ).toBe(false);
  });

  it("clicking each material card selects that value", () => {
    let state = emptyConfirmStartSelection();
    for (const opt of MATERIAL_CONDITIONS) {
      state = reduceConfirmStartSelection(state, {
        type: "SELECT_MATERIAL",
        value: opt.value,
        standardPurgeQtyGrams: 120,
      });
      expect(state.materialCondition).toBe(opt.value);
    }
  });

  it("changing from first material option to another moves selection", () => {
    let state = reduceConfirmStartSelection(emptyConfirmStartSelection(), {
      type: "SELECT_MATERIAL",
      value: "SAME_MATERIAL_RETAINED",
      standardPurgeQtyGrams: 100,
    });
    expect(state.materialCondition).toBe("SAME_MATERIAL_RETAINED");
    expect(state.actualPurgeRequired).toBe(false);
    state = reduceConfirmStartSelection(state, {
      type: "SELECT_MATERIAL",
      value: "DIFFERENT_MATERIAL_RETAINED",
      standardPurgeQtyGrams: 100,
    });
    expect(state.materialCondition).toBe("DIFFERENT_MATERIAL_RETAINED");
    expect(state.actualPurgeRequired).toBe(true);
    expect(state.purgeQtyDraft).toBe("100");
  });

  it("selects mould independently without changing material or purge", () => {
    let state = reduceConfirmStartSelection(emptyConfirmStartSelection(), {
      type: "SELECT_MATERIAL",
      value: "MACHINE_CLEARED",
      standardPurgeQtyGrams: 80,
    });
    const material = state.materialCondition;
    const purge = state.actualPurgeRequired;
    const qty = state.purgeQtyDraft;
    state = reduceConfirmStartSelection(state, {
      type: "SELECT_MOULD",
      value: "NEW_SETUP_COMPLETED",
    });
    expect(state.setupCondition).toBe("NEW_SETUP_COMPLETED");
    expect(state.materialCondition).toBe(material);
    expect(state.actualPurgeRequired).toBe(purge);
    expect(state.purgeQtyDraft).toBe(qty);
    state = reduceConfirmStartSelection(state, {
      type: "SELECT_MOULD",
      value: "SETUP_RETAINED",
    });
    expect(state.setupCondition).toBe("SETUP_RETAINED");
    expect(state.materialCondition).toBe(material);
  });

  it("local selection survives preview rerender / API response without confirmation", () => {
    let state = reduceConfirmStartSelection(emptyConfirmStartSelection(), {
      type: "SELECT_MATERIAL",
      value: "UNKNOWN",
      standardPurgeQtyGrams: 50,
    });
    state = reduceConfirmStartSelection(state, {
      type: "SELECT_MOULD",
      value: "SETUP_RETAINED",
    });
    const before = { ...state };
    const after = reduceConfirmStartSelection(state, {
      type: "PREVIEW_LOADED",
      confirmation: null,
    });
    expect(selectionSurvivesPreviewRerender(before, after)).toBe(true);
    expect(after.materialCondition).toBe("UNKNOWN");
    expect(after.setupCondition).toBe("SETUP_RETAINED");
  });

  it("Confirm enables only after complete valid material + mould + purge selection", () => {
    let state = emptyConfirmStartSelection();
    expect(isConfirmStartSelectionComplete(state)).toBe(false);

    state = reduceConfirmStartSelection(state, {
      type: "SELECT_MATERIAL",
      value: "SAME_MATERIAL_RETAINED",
      standardPurgeQtyGrams: 100,
    });
    expect(isConfirmStartSelectionComplete(state)).toBe(false);

    state = reduceConfirmStartSelection(state, {
      type: "SELECT_MOULD",
      value: "NEW_SETUP_COMPLETED",
    });
    expect(isConfirmStartSelectionComplete(state)).toBe(true);
    expect(
      canEnableConfirmStart({
        materialCondition: state.materialCondition,
        setupCondition: state.setupCondition,
        actualPurgeRequired: state.actualPurgeRequired,
        purgeQtyOk: parseActualPurgeQtyDraft(state.purgeQtyDraft, state.actualPurgeRequired!).ok,
        overrideReasonOk: true,
      }),
    ).toBe(true);
  });

  it("each material condition produces the correct purge decision", () => {
    expect(suggestPurgeFromActualCondition("SAME_MATERIAL_RETAINED").suggestedPurgingRequired).toBe(false);
    expect(suggestPurgeFromActualCondition("DIFFERENT_MATERIAL_RETAINED").suggestedPurgingRequired).toBe(true);
    expect(suggestPurgeFromActualCondition("MACHINE_CLEARED").suggestedPurgingRequired).toBe(true);
    expect(suggestPurgeFromActualCondition("UNKNOWN").suggestedPurgingRequired).toBe(true);
    expect(suggestPurgeFromActualCondition(null).suggestedPurgingRequired).toBe(null);
  });

  it("mould choice does not independently trigger purging", () => {
    expect(mouldChoiceAffectsPurgeDecision("SETUP_RETAINED")).toBe(false);
    expect(mouldChoiceAffectsPurgeDecision("NEW_SETUP_COMPLETED")).toBe(false);
  });

  it("formats success summary without confirmer name dangling", () => {
    expect(
      formatStartConfirmSuccessSummary({
        actualPurgingRequired: true,
        actualPurgeQtyGrams: 200,
        purgeVarianceGrams: 0,
        runSequence: 1,
      }),
    ).toEqual({
      purgeLine: "Purging: 200 g · Difference from standard: 0 g",
      readyLine: "Run 1 is ready for production.",
    });
    expect(
      formatStartConfirmSuccessSummary({
        actualPurgingRequired: false,
        actualPurgeQtyGrams: 0,
        purgeVarianceGrams: 0,
        runSequence: 2,
      }),
    ).toEqual({
      purgeLine: "Purging not required",
      readyLine: "Run 2 is ready for production.",
    });
    const noRun = formatStartConfirmSuccessSummary({
      actualPurgingRequired: true,
      actualPurgeQtyGrams: 200,
      purgeVarianceGrams: 0,
    });
    expect(noRun.purgeLine).toBe("Purging: 200 g · Difference from standard: 0 g");
    expect(noRun.readyLine).toBeNull();
    expect(noRun.purgeLine).not.toMatch(/Production$/);
    expect(noRun.purgeLine).not.toContain(" · Production");
  });
});

describe("production start confirmation — modal wiring & layout", () => {
  const modal = fs.readFileSync(
    path.join(__dirname, "../../src/components/erp/production/ConfirmProductionStartModal.tsx"),
    "utf8",
  );
  const panel = fs.readFileSync(
    path.join(__dirname, "../../src/components/erp/production/ProductionRunStartConfirmPanel.tsx"),
    "utf8",
  );

  it("wires native radios, reducer, and exact questions with no autofocus default", () => {
    expect(modal).toContain("reduceConfirmStartSelection");
    expect(modal).toContain("emptyConfirmStartSelection");
    expect(modal).toContain('type="radio"');
    expect(modal).toContain('role="radiogroup"');
    expect(modal).toContain("CONFIRM_START_MODAL_TITLE");
    expect(modal).toContain("MATERIAL_QUESTION");
    expect(modal).toContain("MOULD_QUESTION");
    expect(modal).toContain("MACHINE_MATERIAL_NOT_RECORDED_NOTE");
    expect(modal).toContain("Purging quantity (g)");
    expect(modal).toContain("Difference from standard");
    expect(modal).toContain("Confirm Start");
    expect(modal).not.toContain("firstChoiceRef");
    expect(modal).not.toContain("requestAnimationFrame");
    expect(modal).not.toContain("RM allocation");
    expect(modal).not.toContain("Same planned material retained");
    expect(modal).not.toContain("conservative");
    expect(modal).not.toContain("physical setup");
    // Role gates Confirm only — not the radio cards
    expect(modal).toContain("choicesLocked");
    expect(modal).toContain("canConfirm &&");
    expect(modal).toContain("canEnableConfirmStart");
  });

  it("wires success summary helper and omits confirmer name from readonly copy", () => {
    expect(modal).toContain("formatStartConfirmSuccessSummary");
    expect(modal).toContain("start-confirm-success-purge");
    expect(modal).toContain("start-confirm-success-ready");
    expect(modal).not.toContain("confirmedBy?.name");
    expect(modal).not.toContain("Purging quantity ${");
    expect(modal).not.toContain("` · ${preview.confirmation.confirmedBy");
  });

  it("1280×768 compact modal layout contract", () => {
    expect(CONFIRM_START_LAYOUT.viewportWidth).toBe(1280);
    expect(CONFIRM_START_LAYOUT.viewportHeight).toBe(768);
    expect(CONFIRM_START_LAYOUT.optionTextClass).toBe("text-sm");
    expect(CONFIRM_START_LAYOUT.maxModalHeightClass).toBe("max-h-[min(85vh,640px)]");
    expect(CONFIRM_START_LAYOUT.maxModalWidthClass).toBe("max-w-xl");
    expect(CONFIRM_START_LAYOUT.bodyScrollClass).toBe("min-h-0 flex-1 overflow-y-auto");
    expect(CONFIRM_START_LAYOUT.footerStickyClass).toBe("shrink-0 border-t bg-white");
    expect(modal).toContain("CONFIRM_START_LAYOUT.maxModalHeightClass");
    expect(modal).toContain("CONFIRM_START_LAYOUT.maxModalWidthClass");
    expect(modal).toContain("CONFIRM_START_LAYOUT.bodyScrollClass");
    expect(modal).toContain("CONFIRM_START_LAYOUT.footerStickyClass");
    expect(modal).toContain("CONFIRM_START_LAYOUT.optionTextClass");
    expect(modal).toContain("data-layout-viewport=");
    expect(modal).toContain("CONFIRM_START_LAYOUT.viewportWidth");
    expect(modal).toContain("CONFIRM_START_LAYOUT.viewportHeight");
    expect(modal).toContain('data-testid="start-confirm-footer"');
    expect(modal).toContain("flex-col");
    expect(modal).toContain("overflow-hidden");
    expect(modal).toContain("shrink-0");
    // Both question groups present (must remain in body, not behind footer)
    expect(modal).toContain("start-material-condition");
    expect(modal).toContain("start-setup-condition");
  });

  it("formats readable material label without banned wording", () => {
    expect(
      formatReadableMaterialProfileLabel([{ itemName: "PP Black Grinding", mixPercent: 100, rmItemId: 1 }]),
    ).toBe("PP Black Grinding — 100%");
    expect(formatReadableMaterialProfileLabel([])).toBe("Not available");
  });

  it("never surfaces raw Prisma create failures to the operator", () => {
    expect(
      operatorMessageFromConfirmError({
        message: "Invalid `tx.workOrderProductionRunStartConfirmation.create()` invocation",
      }),
    ).toBe("Could not confirm production start. Please try again or contact Admin.");
  });

  it("validates actual purge qty drafts", () => {
    expect(parseActualPurgeQtyDraft("0", false)).toEqual({ ok: true, value: 0 });
    expect(parseActualPurgeQtyDraft("-1", true).ok).toBe(false);
    expect(parseActualPurgeQtyDraft("10", true)).toEqual({ ok: true, value: 10 });
  });

  it("panel still exposes role gate and entry gate", () => {
    expect(panel).toContain("canConfirm");
    expect(panel).toContain("disabled={!canConfirm}");
    expect(panel).toContain("onEntryGateChange");
    expect(panel).toContain('data-testid="production-run-start-panel"');
  });
});
