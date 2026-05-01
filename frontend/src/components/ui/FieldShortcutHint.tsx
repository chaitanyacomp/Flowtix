import * as React from "react";
import { cn } from "../../lib/utils";

const FADE_MS = 200;

export type FieldShortcutHintPlacement = "below" | "above" | "below-end";

export type FieldShortcutHintProps = {
  show: boolean;
  hint: string;
  children: React.ReactNode;
  placement?: FieldShortcutHintPlacement;
  className?: string;
  hintClassName?: string;
};

/**
 * Non-interactive hint with a quiet fade in/out. Parent controls `show`.
 */
export function FieldShortcutHint({
  show,
  hint,
  children,
  placement = "below",
  className,
  hintClassName,
}: FieldShortcutHintProps) {
  const trimmed = hint.trim();
  const [mounted, setMounted] = React.useState(false);
  const [opaque, setOpaque] = React.useState(false);

  React.useEffect(() => {
    if (show && trimmed) {
      setMounted(true);
      const id = requestAnimationFrame(() => setOpaque(true));
      return () => cancelAnimationFrame(id);
    }
    setOpaque(false);
    const t = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(t);
  }, [show, trimmed]);

  const positionClasses =
    placement === "above"
      ? "bottom-full mb-1 left-0"
      : placement === "below-end"
        ? "top-full right-0 left-auto mt-1 max-w-[min(18rem,calc(100vw-2rem))]"
        : "top-full left-0 mt-1 max-w-[min(20rem,calc(100vw-2rem))]";

  return (
    <div className={cn("relative", className)}>
      {children}
      {mounted && trimmed ? (
        <div
          className={cn(
            "pointer-events-none absolute z-[20] rounded border border-slate-200/80 bg-white/98 px-2 py-1 text-[11px] leading-snug text-slate-500 shadow-sm transition-opacity ease-out",
            positionClasses,
            opaque ? "opacity-100 duration-200" : "opacity-0 duration-200",
            hintClassName,
          )}
          style={{ transitionDuration: `${FADE_MS}ms` }}
          role="status"
          aria-live="polite"
        >
          {trimmed}
        </div>
      ) : null}
    </div>
  );
}
