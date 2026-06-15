import { PROCUREMENT_TERMS } from "./procurementTerminology";

export type PendingPrPoPrepUi = {
  showCheckboxes: boolean;
  showPrepareButton: boolean;
  readOnlyMessage: string | null;
};

/** PO preparation chrome — Store read-only, Purchase/Admin interactive. */
export function resolvePendingPrPoPrepUi(canPrepareRmPo = false): PendingPrPoPrepUi {
  if (canPrepareRmPo) {
    return {
      showCheckboxes: true,
      showPrepareButton: true,
      readOnlyMessage: null,
    };
  }
  return {
    showCheckboxes: false,
    showPrepareButton: false,
    readOnlyMessage: PROCUREMENT_TERMS.WAITING_FOR_PURCHASE_RM_PO,
  };
}
