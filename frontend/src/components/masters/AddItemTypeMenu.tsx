import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "../ui/button";
import { MANUALLY_CREATABLE_ITEM_TYPES, type ItemTypeCode } from "../../lib/itemTypes";
import { cn } from "../../lib/utils";

type Props = {
  onSelect: (type: ItemTypeCode) => void;
  className?: string;
};

/**
 * Compact “+ Add Item ▾” menu listing every manually creatable inventory type.
 */
export function AddItemTypeMenu({ onSelect, className }: Props) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", className)} data-testid="add-item-type-menu">
      <Button
        type="button"
        size="sm"
        className="h-9 gap-1"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="add-item-menu-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        + Add Item
        <ChevronDown className="h-3.5 w-3.5 opacity-80" aria-hidden />
      </Button>
      {open ? (
        <div
          role="menu"
          aria-label="Item types"
          className="absolute right-0 z-20 mt-1 min-w-[14rem] rounded-md border border-slate-200 bg-white py-1 shadow-md"
          data-testid="add-item-menu-panel"
        >
          {MANUALLY_CREATABLE_ITEM_TYPES.map((t) => (
            <button
              key={t.code}
              type="button"
              role="menuitem"
              className="flex w-full items-center px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
              data-testid={`add-item-type-${t.code}`}
              onClick={() => {
                setOpen(false);
                onSelect(t.code);
              }}
            >
              <span className="font-medium">{t.label}</span>
              <span className="ml-auto pl-3 text-[11px] font-semibold text-slate-500">{t.shortLabel}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
