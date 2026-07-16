import * as React from "react";

/**
 * Prevents double-submit for Create / Approve / Finalize / Confirm style actions.
 * While locked, `run` is a no-op and `pending` is true for button disable.
 */
export function useMutationLock() {
  const [pending, setPending] = React.useState(false);
  const lockedRef = React.useRef(false);

  const run = React.useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    if (lockedRef.current) return undefined;
    lockedRef.current = true;
    setPending(true);
    try {
      return await task();
    } finally {
      lockedRef.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run, isPending: pending };
}
