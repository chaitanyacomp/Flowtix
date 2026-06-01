import * as React from "react";
import { registerErpModal } from "../lib/erpModalEscape";

/**
 * Register a modal layer for global Escape when not using {@link ErpModal}.
 * Alias: {@link useEscapeToClose}.
 */
export function useErpModalEscape(
  onClose: () => void,
  options?: { enabled?: boolean; disabled?: () => boolean },
) {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const enabled = options?.enabled ?? true;
  const disabled = options?.disabled;

  React.useEffect(() => {
    if (!enabled) return;
    return registerErpModal(() => onCloseRef.current(), { disabled });
  }, [enabled, disabled]);
}

/** @alias useErpModalEscape */
export const useEscapeToClose = useErpModalEscape;
