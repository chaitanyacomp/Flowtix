import * as React from "react";

const DEFAULT_FIELD_HINT_MS = 3800;
const DEFAULT_MAX_FIELD_SHOWS = 2;
const STORAGE_PREFIX = "erp-shortcut-tip-dismissed:";

export type ShortcutBarSegment = {
  keys: string;
  action: string;
};

export type UseShortcutHintsConfig = {
  pageKey: string;
  bottomShortcutBarText?: string;
  bottomShortcutBarSegments?: ShortcutBarSegment[];
  fieldShortcuts?: Record<string, string>;
  firstUseTipText?: string;
  fieldHintAutoHideMs?: number;
  /** After this many focus-driven displays per field, stop showing hints for that field this session. */
  fieldHintMaxShowsPerSession?: number;
};

export type FieldBinding = {
  onFocus: React.FocusEventHandler<HTMLElement>;
  onBlur: React.FocusEventHandler<HTMLElement>;
  onInput: React.FormEventHandler<HTMLElement>;
  onChange: React.ChangeEventHandler<HTMLElement>;
};

export type UseShortcutHintsResult = {
  bottomBarText: string;
  firstUseTipVisible: boolean;
  dismissFirstUseTip: () => void;
  activeFieldId: string | null;
  activeFieldHintText: string | null;
  bindField: (
    fieldId: string,
    merge?: Partial<Pick<FieldBinding, "onFocus" | "onBlur" | "onInput" | "onChange">>,
  ) => FieldBinding;
  /** Call when the user invokes the shortcut for this field — stops repeat hints this session. */
  markFieldShortcutUsed: (fieldId: string) => void;
};

function buildBottomBarText(config: UseShortcutHintsConfig): string {
  if (config.bottomShortcutBarText?.trim()) {
    return config.bottomShortcutBarText.trim();
  }
  const segs = config.bottomShortcutBarSegments;
  if (!segs?.length) return "";
  return segs
    .map((s) => `${s.keys.trim()} ${s.action.trim()}`.trim())
    .filter(Boolean)
    .join(" · ");
}

function storageKey(pageKey: string): string {
  return `${STORAGE_PREFIX}${pageKey}`;
}

export function useShortcutHints(config: UseShortcutHintsConfig): UseShortcutHintsResult {
  const {
    pageKey,
    fieldShortcuts = {},
    firstUseTipText,
    fieldHintAutoHideMs = DEFAULT_FIELD_HINT_MS,
    fieldHintMaxShowsPerSession = DEFAULT_MAX_FIELD_SHOWS,
  } = config;

  const bottomBarText = buildBottomBarText(config);

  const [firstUseTipVisible, setFirstUseTipVisible] = React.useState(false);
  React.useEffect(() => {
    if (!firstUseTipText?.trim()) {
      setFirstUseTipVisible(false);
      return;
    }
    try {
      const dismissed = localStorage.getItem(storageKey(pageKey));
      setFirstUseTipVisible(dismissed !== "1");
    } catch {
      setFirstUseTipVisible(true);
    }
  }, [pageKey, firstUseTipText]);

  const dismissFirstUseTip = React.useCallback(() => {
    try {
      localStorage.setItem(storageKey(pageKey), "1");
    } catch {
      /* ignore */
    }
    setFirstUseTipVisible(false);
  }, [pageKey]);

  const [activeFieldId, setActiveFieldId] = React.useState<string | null>(null);
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedRef = React.useRef<Set<string>>(new Set());
  const showCountRef = React.useRef<Map<string, number>>(new Map());

  const clearHideTimer = React.useCallback(() => {
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const hideFieldHint = React.useCallback((fieldId: string) => {
    setActiveFieldId((cur) => (cur === fieldId ? null : cur));
  }, []);

  const markFieldShortcutUsed = React.useCallback(
    (fieldId: string) => {
      suppressedRef.current.add(fieldId);
      clearHideTimer();
      setActiveFieldId((cur) => (cur === fieldId ? null : cur));
    },
    [clearHideTimer],
  );

  const scheduleAutoHide = React.useCallback(
    (fieldId: string) => {
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        hideFieldHint(fieldId);
        hideTimerRef.current = null;
      }, fieldHintAutoHideMs);
    },
    [clearHideTimer, fieldHintAutoHideMs, hideFieldHint],
  );

  React.useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const bindField = React.useCallback(
    (
      fieldId: string,
      merge?: Partial<Pick<FieldBinding, "onFocus" | "onBlur" | "onInput" | "onChange">>,
    ): FieldBinding => {
      const hint = fieldShortcuts[fieldId];
      return {
        onFocus: (e) => {
          merge?.onFocus?.(e);
          if (!hint) return;
          if (suppressedRef.current.has(fieldId)) return;

          const nextCount = (showCountRef.current.get(fieldId) ?? 0) + 1;
          if (nextCount > fieldHintMaxShowsPerSession) {
            suppressedRef.current.add(fieldId);
            return;
          }
          showCountRef.current.set(fieldId, nextCount);

          clearHideTimer();
          setActiveFieldId(fieldId);
          scheduleAutoHide(fieldId);
        },
        onBlur: (e) => {
          merge?.onBlur?.(e);
          clearHideTimer();
          hideFieldHint(fieldId);
        },
        onInput: (e) => {
          merge?.onInput?.(e);
          clearHideTimer();
          hideFieldHint(fieldId);
        },
        onChange: (e) => {
          merge?.onChange?.(e);
          clearHideTimer();
          hideFieldHint(fieldId);
        },
      };
    },
    [
      clearHideTimer,
      fieldHintMaxShowsPerSession,
      fieldShortcuts,
      hideFieldHint,
      scheduleAutoHide,
    ],
  );

  const activeFieldHintText =
    activeFieldId && fieldShortcuts[activeFieldId] ? fieldShortcuts[activeFieldId] : null;

  return {
    bottomBarText,
    firstUseTipVisible: Boolean(firstUseTipText?.trim() && firstUseTipVisible),
    dismissFirstUseTip,
    activeFieldId,
    activeFieldHintText,
    bindField,
    markFieldShortcutUsed,
  };
}
