import * as React from "react";
import { parsePositiveQuantityDraft } from "../lib/quantityDraft";

/**
 * Reusable “mandatory positive quantity” field: starts blank, no unsafe numeric default.
 * Pair with {@link useDependentFieldFocus} + disabled primary action until `isValid`.
 */
export function useMandatoryPositiveQtyDraft(initialRaw = "") {
  const [raw, setRaw] = React.useState(initialRaw);
  const parsed = React.useMemo(() => parsePositiveQuantityDraft(raw), [raw]);
  const isValid = parsed != null;
  const reset = React.useCallback(() => setRaw(""), []);

  return { raw, setRaw, parsed, isValid, reset };
}
