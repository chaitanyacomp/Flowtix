import * as React from "react";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

export type TransporterOption = {
  id: number;
  name: string;
  isActive?: boolean;
  isTransporter?: boolean;
};

type Props = {
  options: TransporterOption[];
  valueId: number | null;
  onChange: (id: number | null, name: string | null) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string | null;
  canAdd?: boolean;
  onAdd?: () => void;
  className?: string;
};

export function SalesBillTransporterSelect({
  options,
  valueId,
  onChange,
  required = false,
  disabled = false,
  error = null,
  canAdd = false,
  onAdd,
  className,
}: Props) {
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.id === valueId) ?? null;
  const display = selected?.name ?? "";

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = options.filter((o) => o.isActive !== false);
    if (!q) return active;
    return active.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  React.useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <label className="text-xs font-semibold text-slate-700">
        Transporter Name{required ? " *" : ""}
        <div className="mt-1 flex gap-1.5">
          <Input
            className={cn("h-9", error && "border-red-400 focus-visible:ring-red-300")}
            value={open ? query : display}
            placeholder={required ? "Select transporter" : "Optional"}
            disabled={disabled}
            autoComplete="off"
            onFocus={() => {
              setOpen(true);
              setQuery(display);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
              if (!e.target.value.trim()) onChange(null, null);
            }}
            aria-invalid={Boolean(error)}
            aria-required={required}
          />
          {canAdd ? (
            <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 px-2 text-[11px]" onClick={onAdd}>
              + Add Transporter
            </Button>
          ) : null}
        </div>
      </label>
      {error ? <p className="mt-1 text-[11px] font-medium text-red-700">{error}</p> : null}
      {open && !disabled ? (
        <ul
          className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded border border-slate-200 bg-white py-1 shadow-md"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-1.5 text-[11px] text-slate-500">No matching transporters.</li>
          ) : (
            filtered.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={opt.id === valueId}
                  className={cn(
                    "flex w-full px-2 py-1.5 text-left text-xs hover:bg-slate-50",
                    opt.id === valueId && "bg-sky-50 font-semibold text-sky-950",
                  )}
                  onClick={() => {
                    onChange(opt.id, opt.name);
                    setQuery(opt.name);
                    setOpen(false);
                  }}
                >
                  {opt.name}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
