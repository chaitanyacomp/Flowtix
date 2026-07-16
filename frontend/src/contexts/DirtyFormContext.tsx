import * as React from "react";
import { confirmLeaveIfDirty, UNSAVED_CHANGES_LEAVE_MESSAGE } from "../lib/unsavedChangesPolicy";

type DirtyEntry = { dirty: boolean; message: string };

type DirtyFormRegistryApi = {
  register: (id: string, dirty: boolean, message?: string) => void;
  unregister: (id: string) => void;
  isAnyDirty: () => boolean;
  /** Returns true when the user may leave. */
  confirmLeave: (fallbackMessage?: string) => boolean;
};

const DirtyFormContext = React.createContext<DirtyFormRegistryApi | null>(null);

export function DirtyFormProvider({ children }: { children: React.ReactNode }) {
  const entriesRef = React.useRef<Map<string, DirtyEntry>>(new Map());

  const api = React.useMemo<DirtyFormRegistryApi>(() => {
    return {
      register(id, dirty, message = UNSAVED_CHANGES_LEAVE_MESSAGE) {
        entriesRef.current.set(id, { dirty, message });
      },
      unregister(id) {
        entriesRef.current.delete(id);
      },
      isAnyDirty() {
        for (const e of entriesRef.current.values()) {
          if (e.dirty) return true;
        }
        return false;
      },
      confirmLeave(fallbackMessage = UNSAVED_CHANGES_LEAVE_MESSAGE) {
        let dirty = false;
        let message = fallbackMessage;
        for (const e of entriesRef.current.values()) {
          if (e.dirty) {
            dirty = true;
            message = e.message;
            break;
          }
        }
        return confirmLeaveIfDirty(dirty, message);
      },
    };
  }, []);

  return <DirtyFormContext.Provider value={api}>{children}</DirtyFormContext.Provider>;
}

export function useDirtyFormRegistry(): DirtyFormRegistryApi | null {
  return React.useContext(DirtyFormContext);
}

/** Confirm before programmatic or link navigation when any form is dirty. */
export function useConfirmLeaveDirty(): (fallbackMessage?: string) => boolean {
  const registry = useDirtyFormRegistry();
  return React.useCallback(
    (fallbackMessage?: string) => registry?.confirmLeave(fallbackMessage) ?? true,
    [registry],
  );
}
