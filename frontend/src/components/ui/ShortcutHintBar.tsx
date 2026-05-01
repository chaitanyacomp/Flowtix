import * as React from "react";
import { cn } from "../../lib/utils";
import type { ShortcutBarItem } from "../../lib/shortcutHintCopy";

export type ShortcutHintBarProps = {
  /** Structured items (preferred): wraps cleanly on narrow screens. */
  items?: ShortcutBarItem[];
  /** Legacy single line; used if `items` is empty. */
  text?: string;
  className?: string;
  innerClassName?: string;
};

function ariaLabelFromItems(items: ShortcutBarItem[]): string {
  return items.map((s) => `${s.keys} ${s.action}`.trim()).join(", ");
}

/**
 * Slim sticky shortcut reference. Uses flex-wrap when `items` is provided.
 */
export function ShortcutHintBar({ items, text, className, innerClassName }: ShortcutHintBarProps) {
  if (items?.length) {
    const label = ariaLabelFromItems(items);
    return (
      <div
        className={cn(
          "pointer-events-none sticky bottom-0 z-10 border-t border-slate-200/80 bg-slate-50/95 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-[2px]",
          className,
        )}
        role="note"
        aria-label={`Keyboard shortcuts: ${label}`}
      >
        <div
          className={cn(
            "mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-x-1.5 gap-y-1 px-2 sm:gap-x-2 sm:gap-y-1.5 sm:px-3",
            innerClassName,
          )}
        >
          {items.map((it, i) => (
            <React.Fragment key={`${it.keys}-${it.action}-${i}`}>
              {i > 0 ? (
                <span className="select-none text-[10px] text-slate-300 sm:text-xs" aria-hidden>
                  ·
                </span>
              ) : null}
              <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1 text-[11px] leading-snug text-slate-500 sm:text-xs">
                <span className="font-mono text-[10px] text-slate-600 sm:text-[11px]">{it.keys}</span>
                <span className="text-slate-500">{it.action}</span>
              </span>
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  return (
    <div
      className={cn(
        "pointer-events-none sticky bottom-0 z-10 border-t border-slate-200/80 bg-slate-50/95 px-2 py-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] text-center backdrop-blur-[2px] sm:px-3",
        className,
      )}
      role="note"
      aria-label={`Keyboard shortcuts: ${trimmed}`}
    >
      <p
        className={cn(
          "mx-auto max-w-5xl break-words text-[11px] leading-relaxed text-slate-500 sm:text-xs",
          innerClassName,
        )}
      >
        {trimmed}
      </p>
    </div>
  );
}

export type ShortcutFirstUseTipProps = {
  visible: boolean;
  message: string;
  onDismiss: () => void;
  className?: string;
};

export function ShortcutFirstUseTip({ visible, message, onDismiss, className }: ShortcutFirstUseTipProps) {
  if (!visible || !message.trim()) return null;

  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <p className="min-w-0 flex-1 leading-relaxed">{message.trim()}</p>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded border border-transparent px-2 py-0.5 text-[11px] font-medium text-slate-600 underline decoration-slate-300 underline-offset-2 hover:bg-slate-100 hover:text-slate-800"
      >
        Dismiss
      </button>
    </div>
  );
}
