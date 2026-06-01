import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import {
  normalizeGstinInput,
  resolveStateIdFromGstin,
  validateGstinAgainstState,
  validateGstinFormatMessage,
  type StateRow,
} from "../../lib/gstinValidation";
import { Plus, Star, Trash2 } from "lucide-react";
import { ErpModal } from "./ErpModal";

/** Shared layout tokens for Customer / Supplier master forms */
export const partyMasterFormClass = "space-y-3";
export const partyMasterGridClass = "mt-2 grid gap-3 sm:grid-cols-2";
export const partyMasterRegisteredSectionClass =
  "rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-3 shadow-sm ring-1 ring-slate-100/80";
export const partyMasterLocationsSectionClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm ring-1 ring-slate-100/80";

export type PartyLocationDraft = {
  key: string;
  id?: number;
  label: string;
  address: string;
  city: string;
  stateId: number | "";
  gstin: string;
  contactPerson: string;
  phone: string;
  isDefault: boolean;
  isActive: boolean;
};

export function PartyMasterModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const titleId = React.useId();
  return (
    <ErpModal onClose={onClose} aria-labelledby={titleId}>
      <Card className="erp-modal-shell max-h-[90vh] w-full max-w-3xl overflow-hidden">
        <CardHeader className="border-b border-slate-100 px-4 py-3">
          <CardTitle id={titleId} className="text-base font-semibold text-slate-900">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="max-h-[calc(90vh-4.25rem)] overflow-y-auto px-4 py-3">{children}</CardContent>
      </Card>
    </ErpModal>
  );
}

export function PartyMasterLoading({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-slate-600">{message}</p>;
}

export function PartyMasterField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <span className="text-xs font-medium text-slate-700">{label}</span>
      {hint ? <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{hint}</p> : null}
      <div className="mt-1">{children}</div>
    </div>
  );
}

export function PartyMasterSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">{children}</h3>
  );
}

export function PartyMasterSection({
  variant,
  title,
  action,
  children,
}: {
  variant: "registered" | "locations";
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className={variant === "registered" ? partyMasterRegisteredSectionClass : partyMasterLocationsSectionClass}
    >
      <div className={action ? "flex flex-wrap items-center justify-between gap-2" : undefined}>
        <PartyMasterSectionTitle>{title}</PartyMasterSectionTitle>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PartyMasterSelect({
  value,
  onChange,
  children,
  className,
}: {
  value: number | "";
  onChange: (value: number | "") => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-slate-200 bg-white px-2.5 text-sm text-slate-900 shadow-sm",
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
    >
      {children}
    </select>
  );
}

export function PartyMasterTextArea({
  value,
  onChange,
  rows = 2,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  className?: string;
}) {
  return (
    <textarea
      className={cn(
        "min-h-[2.75rem] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm",
        className,
      )}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  );
}

export function PartyMasterGstField({
  value,
  onChange,
  onBlur,
  hint,
  gstFormatError,
  gstStateError,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  hint?: string;
  gstFormatError: string | null;
  gstStateError: string | null;
}) {
  return (
    <PartyMasterField label="Registered GSTIN" hint={hint}>
      <Input
        value={value}
        onChange={(e) => onChange(normalizeGstinInput(e.target.value))}
        onBlur={onBlur}
        className="h-9 font-mono text-sm uppercase"
        maxLength={15}
        placeholder="15-character GSTIN"
      />
      {gstFormatError ? <PartyMasterInlineError message={gstFormatError} /> : null}
      {!gstFormatError && gstStateError ? <PartyMasterInlineError message={gstStateError} /> : null}
    </PartyMasterField>
  );
}

export function PartyMasterStateField({
  value,
  onChange,
  states,
  label = "Registered state",
}: {
  value: number | "";
  onChange: (value: number | "") => void;
  states: StateRow[];
  label?: string;
}) {
  return (
    <PartyMasterField label={label}>
      <PartyMasterSelect value={value} onChange={onChange}>
        <option value="">Select state</option>
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.stateName} ({s.stateCode})
          </option>
        ))}
      </PartyMasterSelect>
    </PartyMasterField>
  );
}

export function PartyMasterActiveCheckbox({
  label,
  checked,
  onChange,
  className,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <label className={cn("flex items-center gap-2 text-sm text-slate-700", className)}>
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function PartyMasterAddLocationButton({ onClick }: { onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" className="h-8 px-2.5 text-xs" onClick={onClick}>
      <Plus className="mr-1 h-3.5 w-3.5" />
      Add location
    </Button>
  );
}

export function PartyMasterLocationsHelper({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs leading-relaxed text-slate-600">{children}</p>;
}

export function PartyMasterLocationCard({
  row,
  states,
  labelPlaceholder,
  onChange,
  onRemove,
  onSetDefault,
}: {
  row: PartyLocationDraft;
  states: StateRow[];
  labelPlaceholder: string;
  onChange: (patch: Partial<PartyLocationDraft>) => void;
  onRemove: () => void;
  onSetDefault: () => void;
}) {
  const [gstTouched, setGstTouched] = React.useState(false);

  React.useEffect(() => {
    const g = normalizeGstinInput(row.gstin);
    if (g.length < 2) return;
    const autoId = resolveStateIdFromGstin(g, states);
    if (autoId !== "") onChange({ stateId: autoId });
  }, [row.gstin, states, onChange]);

  const gstFormatError = gstTouched ? validateGstinFormatMessage(row.gstin) : null;
  const gstStateError =
    gstTouched && !gstFormatError ? validateGstinAgainstState(row.gstin, row.stateId, states) : null;

  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        row.isDefault ? "border-slate-400 bg-slate-50/90" : "border-slate-200 bg-white",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {row.isDefault ? (
            <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              <Star className="h-3 w-3" fill="currentColor" />
              Default
            </span>
          ) : (
            <button type="button" className="text-[11px] font-semibold text-slate-600 underline" onClick={onSetDefault}>
              Set as default
            </button>
          )}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded border-slate-300"
              checked={row.isActive}
              onChange={(e) => onChange({ isActive: e.target.checked })}
            />
            Active
          </label>
        </div>
        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove} aria-label="Remove location">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className={partyMasterGridClass}>
        <PartyMasterField label="Location label">
          <Input
            className="h-9"
            value={row.label}
            onChange={(e) => onChange({ label: e.target.value })}
            placeholder={labelPlaceholder}
          />
        </PartyMasterField>
        <PartyMasterField label="City">
          <Input className="h-9" value={row.city} onChange={(e) => onChange({ city: e.target.value })} />
        </PartyMasterField>
        <PartyMasterField label="Address" className="sm:col-span-2">
          <PartyMasterTextArea value={row.address} onChange={(v) => onChange({ address: v })} />
        </PartyMasterField>
        <PartyMasterField label="GSTIN">
          <Input
            value={row.gstin}
            onChange={(e) => {
              setGstTouched(true);
              onChange({ gstin: normalizeGstinInput(e.target.value) });
            }}
            onBlur={() => setGstTouched(true)}
            className="h-9 font-mono text-sm uppercase"
            maxLength={15}
          />
          {gstFormatError ? <PartyMasterInlineError message={gstFormatError} /> : null}
          {!gstFormatError && gstStateError ? <PartyMasterInlineError message={gstStateError} /> : null}
        </PartyMasterField>
        <PartyMasterField label="State">
          <PartyMasterSelect value={row.stateId} onChange={(v) => onChange({ stateId: v })}>
            <option value="">Select state</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.stateName} ({s.stateCode})
              </option>
            ))}
          </PartyMasterSelect>
        </PartyMasterField>
        <PartyMasterField label="Contact person">
          <Input className="h-9" value={row.contactPerson} onChange={(e) => onChange({ contactPerson: e.target.value })} />
        </PartyMasterField>
        <PartyMasterField label="Phone">
          <Input className="h-9" value={row.phone} onChange={(e) => onChange({ phone: e.target.value })} />
        </PartyMasterField>
      </div>
    </div>
  );
}

export function PartyMasterFormError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</div>
  );
}

export function PartyMasterFormFooter({
  onCancel,
  submitting,
  submitLabel,
}: {
  onCancel: () => void;
  submitting: boolean;
  submitLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
      <Button type="button" variant="outline" className="h-9" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" className="h-9" disabled={submitting}>
        {submitting ? "Saving…" : submitLabel}
      </Button>
    </div>
  );
}

function PartyMasterInlineError({ message }: { message: string }) {
  return <p className="mt-1 text-[11px] font-medium text-red-700">{message}</p>;
}
