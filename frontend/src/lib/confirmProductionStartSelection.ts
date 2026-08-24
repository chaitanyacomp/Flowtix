import {
  parseActualPurgeQtyDraft,
  suggestPurgeFromActualCondition,
  type MaterialCondition,
  type ProductionRunStartConfirmation,
  type SetupCondition,
} from "./productionRunStartConfirmation";

/**
 * Local selection for Confirm Production Start.
 * Preview/API refresh must never clear operator choices unless the open session resets.
 */
export type ConfirmStartSelectionState = {
  materialCondition: MaterialCondition | null;
  setupCondition: SetupCondition | null;
  actualPurgeRequired: boolean | null;
  purgeQtyDraft: string;
  overrideReason: string;
};

export type ConfirmStartSelectionAction =
  | { type: "RESET_SESSION" }
  | { type: "SELECT_MATERIAL"; value: MaterialCondition; standardPurgeQtyGrams: number }
  | { type: "SELECT_MOULD"; value: SetupCondition }
  | { type: "SET_PURGE_REQUIRED"; value: boolean; standardPurgeQtyGrams: number }
  | { type: "SET_PURGE_QTY"; value: string }
  | { type: "SET_OVERRIDE_REASON"; value: string }
  | {
      type: "PREVIEW_LOADED";
      confirmation: ProductionRunStartConfirmation | null | undefined;
    };

export function emptyConfirmStartSelection(): ConfirmStartSelectionState {
  return {
    materialCondition: null,
    setupCondition: null,
    actualPurgeRequired: null,
    purgeQtyDraft: "",
    overrideReason: "",
  };
}

function syncPurgeFromMaterial(
  material: MaterialCondition,
  standardPurgeQtyGrams: number,
): Pick<ConfirmStartSelectionState, "actualPurgeRequired" | "purgeQtyDraft" | "overrideReason"> {
  const suggestion = suggestPurgeFromActualCondition(material);
  const required = suggestion.suggestedPurgingRequired;
  if (required == null) {
    return { actualPurgeRequired: null, purgeQtyDraft: "", overrideReason: "" };
  }
  return {
    actualPurgeRequired: required,
    purgeQtyDraft: required ? String(standardPurgeQtyGrams) : "0",
    overrideReason: "",
  };
}

export function reduceConfirmStartSelection(
  state: ConfirmStartSelectionState,
  action: ConfirmStartSelectionAction,
): ConfirmStartSelectionState {
  switch (action.type) {
    case "RESET_SESSION":
      return emptyConfirmStartSelection();
    case "SELECT_MATERIAL":
      return {
        ...state,
        materialCondition: action.value,
        ...syncPurgeFromMaterial(action.value, action.standardPurgeQtyGrams),
      };
    case "SELECT_MOULD":
      // Mould is independent — never touches material or purge.
      return { ...state, setupCondition: action.value };
    case "SET_PURGE_REQUIRED": {
      const nextRequired = action.value;
      return {
        ...state,
        actualPurgeRequired: nextRequired,
        purgeQtyDraft: nextRequired ? String(action.standardPurgeQtyGrams) : "0",
      };
    }
    case "SET_PURGE_QTY":
      return { ...state, purgeQtyDraft: action.value };
    case "SET_OVERRIDE_REASON":
      return { ...state, overrideReason: action.value };
    case "PREVIEW_LOADED": {
      const c = action.confirmation;
      if (!c) {
        // Preview refresh / API response must not wipe local operator choices.
        return state;
      }
      return {
        materialCondition: c.actualMaterialCondition as MaterialCondition,
        setupCondition: c.actualSetupCondition as SetupCondition,
        actualPurgeRequired: c.actualPurgingRequired,
        purgeQtyDraft: String(c.actualPurgeQtyGrams ?? ""),
        overrideReason: c.purgeOverrideReason ?? "",
      };
    }
    default:
      return state;
  }
}

/** Simulate a preview re-render that must leave local selection intact. */
export function selectionSurvivesPreviewRerender(
  before: ConfirmStartSelectionState,
  afterPreviewAction: ConfirmStartSelectionState,
): boolean {
  return (
    before.materialCondition === afterPreviewAction.materialCondition &&
    before.setupCondition === afterPreviewAction.setupCondition &&
    before.actualPurgeRequired === afterPreviewAction.actualPurgeRequired &&
    before.purgeQtyDraft === afterPreviewAction.purgeQtyDraft
  );
}

export function isConfirmStartSelectionComplete(state: ConfirmStartSelectionState): boolean {
  if (!state.materialCondition || !state.setupCondition) return false;
  if (state.actualPurgeRequired == null) return false;
  const suggestion = suggestPurgeFromActualCondition(state.materialCondition);
  const isOverride =
    suggestion.suggestedPurgingRequired != null &&
    state.actualPurgeRequired !== suggestion.suggestedPurgingRequired;
  if (isOverride && !state.overrideReason.trim()) return false;
  const qty = parseActualPurgeQtyDraft(state.purgeQtyDraft, state.actualPurgeRequired);
  return qty.ok;
}
