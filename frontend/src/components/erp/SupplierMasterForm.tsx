import * as React from "react";
import { apiFetch } from "../../services/api";
import { Input } from "../ui/input";
import {
  normalizeGstinInput,
  resolveStateIdFromGstin,
  validateGstinAgainstState,
  validateGstinFormatMessage,
  type StateRow,
} from "../../lib/gstinValidation";
import {
  partyMasterFormClass,
  partyMasterGridClass,
  PartyMasterActiveCheckbox,
  PartyMasterAddLocationButton,
  PartyMasterField,
  PartyMasterFormError,
  PartyMasterFormFooter,
  PartyMasterGstField,
  PartyMasterLoading,
  PartyMasterLocationCard,
  PartyMasterLocationsHelper,
  PartyMasterSection,
  PartyMasterStateField,
  PartyMasterTextArea,
  type PartyLocationDraft,
} from "./partyMasterUi";

export type SupplierLocationDraft = PartyLocationDraft;

export function newSupplierLocationDraft(partial?: Partial<SupplierLocationDraft>): SupplierLocationDraft {
  return {
    key: partial?.key ?? `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id: partial?.id,
    label: partial?.label ?? "",
    address: partial?.address ?? "",
    city: partial?.city ?? "",
    stateId: partial?.stateId ?? "",
    gstin: partial?.gstin ?? "",
    contactPerson: partial?.contactPerson ?? "",
    phone: partial?.phone ?? "",
    isDefault: partial?.isDefault ?? false,
    isActive: partial?.isActive ?? true,
  };
}

type Props = {
  states: StateRow[];
  onCancel: () => void;
  onSaved: () => void;
  editingId?: number | null;
};

export function SupplierMasterForm({ states, onCancel, onSaved, editingId }: Props) {
  const [loading, setLoading] = React.useState(Boolean(editingId));
  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [gstin, setGstin] = React.useState("");
  const [stateId, setStateId] = React.useState<number | "">("");
  const [address, setAddress] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [locations, setLocations] = React.useState<SupplierLocationDraft[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [gstTouched, setGstTouched] = React.useState(false);

  React.useEffect(() => {
    if (!editingId) return;
    setLoading(true);
    apiFetch<{
      name: string;
      contact?: string | null;
      email?: string | null;
      gstin?: string | null;
      stateId?: number | null;
      address?: string | null;
      isActive?: boolean;
      locations?: Array<{
        id: number;
        label: string;
        address?: string | null;
        city?: string | null;
        stateId?: number | null;
        gstin?: string | null;
        contactPerson?: string | null;
        phone?: string | null;
        isDefault?: boolean;
        isActive?: boolean;
      }>;
    }>(`/api/suppliers/${editingId}`)
      .then((row) => {
        setName(row.name ?? "");
        setContact(row.contact ?? "");
        setEmail(row.email ?? "");
        setGstin(row.gstin ?? "");
        setStateId(row.stateId ?? "");
        setAddress(row.address ?? "");
        setIsActive(row.isActive !== false);
        setLocations(
          (row.locations ?? []).map((a) =>
            newSupplierLocationDraft({
              key: `loc-${a.id}`,
              id: a.id,
              label: a.label,
              address: a.address ?? "",
              city: a.city ?? "",
              stateId: a.stateId ?? "",
              gstin: a.gstin ?? "",
              contactPerson: a.contactPerson ?? "",
              phone: a.phone ?? "",
              isDefault: Boolean(a.isDefault),
              isActive: a.isActive !== false,
            }),
          ),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load supplier."))
      .finally(() => setLoading(false));
  }, [editingId]);

  React.useEffect(() => {
    const g = normalizeGstinInput(gstin);
    if (g.length < 2) return;
    const autoId = resolveStateIdFromGstin(g, states);
    if (autoId === "") return;
    setStateId(autoId);
  }, [gstin, states]);

  const gstFormatError = gstTouched ? validateGstinFormatMessage(gstin) : null;
  const gstStateError =
    gstTouched && !gstFormatError ? validateGstinAgainstState(gstin, stateId, states) : null;

  function updateLocation(key: string, patch: Partial<SupplierLocationDraft>) {
    setLocations((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addLocationRow() {
    setLocations((rows) => [...rows, newSupplierLocationDraft({ isDefault: rows.length === 0 })]);
  }

  function removeLocationRow(key: string) {
    setLocations((rows) => {
      const next = rows.filter((r) => r.key !== key);
      if (next.length && !next.some((r) => r.isDefault)) next[0].isDefault = true;
      return [...next];
    });
  }

  function setDefaultLocation(key: string) {
    setLocations((rows) => rows.map((r) => ({ ...r, isDefault: r.key === key })));
  }

  function validateForm(): string | null {
    if (!name.trim()) return "Supplier name is required.";
    const gstErr = validateGstinFormatMessage(gstin) ?? validateGstinAgainstState(gstin, stateId, states);
    if (gstErr) return gstErr;
    for (const row of locations) {
      if (!row.label.trim()) return "Each supply location needs a label.";
      const rowGstErr =
        validateGstinFormatMessage(row.gstin) ?? validateGstinAgainstState(row.gstin, row.stateId, states);
      if (rowGstErr) return `Supply location "${row.label.trim() || "Untitled"}": ${rowGstErr}`;
    }
    const gstSet = new Set<string>();
    const mainGst = normalizeGstinInput(gstin);
    if (mainGst) gstSet.add(mainGst);
    for (const row of locations) {
      const g = normalizeGstinInput(row.gstin);
      if (!g) continue;
      if (gstSet.has(g)) return "Duplicate GSTIN is not allowed within this supplier.";
      gstSet.add(g);
    }
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGstTouched(true);
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      contact: contact.trim() || null,
      email: email.trim() || null,
      gstin: normalizeGstinInput(gstin) || null,
      stateId: stateId === "" ? null : Number(stateId),
      address: address.trim() || null,
      isActive,
      locations: locations.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        label: row.label.trim(),
        address: row.address.trim() || null,
        city: row.city.trim() || null,
        stateId: row.stateId === "" ? null : Number(row.stateId),
        gstin: normalizeGstinInput(row.gstin) || null,
        contactPerson: row.contactPerson.trim() || null,
        phone: row.phone.trim() || null,
        isDefault: row.isDefault,
        isActive: row.isActive,
      })),
    };
    try {
      if (editingId) {
        await apiFetch(`/api/suppliers/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/api/suppliers", { method: "POST", body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save supplier.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <PartyMasterLoading message="Loading supplier…" />;
  }

  return (
    <form onSubmit={onSubmit} className={partyMasterFormClass}>
      <PartyMasterSection variant="registered" title="Registered entity">
        <div className={partyMasterGridClass}>
          <PartyMasterField label="Supplier name" className="sm:col-span-2">
            <Input className="h-9" value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
          </PartyMasterField>
          <PartyMasterField label="Contact">
            <Input className="h-9" value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="tel" />
          </PartyMasterField>
          <PartyMasterField label="Email">
            <Input
              className="h-9"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
            />
          </PartyMasterField>
          <PartyMasterGstField
            value={gstin}
            onChange={setGstin}
            onBlur={() => setGstTouched(true)}
            hint="Optional for unregistered suppliers"
            gstFormatError={gstFormatError}
            gstStateError={gstStateError}
          />
          <PartyMasterStateField
            value={stateId}
            onChange={(v) => {
              setStateId(v);
              setGstTouched(true);
            }}
            states={states}
          />
          <PartyMasterField label="Registered office address" className="sm:col-span-2">
            <PartyMasterTextArea value={address} onChange={setAddress} />
          </PartyMasterField>
          <PartyMasterActiveCheckbox
            label="Active supplier"
            checked={isActive}
            onChange={setIsActive}
            className="sm:col-span-2"
          />
        </div>
      </PartyMasterSection>

      <PartyMasterSection
        variant="locations"
        title="Supplier Locations"
        action={<PartyMasterAddLocationButton onClick={addLocationRow} />}
      >
        {locations.length === 0 ? (
          <PartyMasterLocationsHelper>
            Add depot, plant, or warehouse locations where this supplier ships from. Registered entity above remains the
            legal party for PO and bills.
          </PartyMasterLocationsHelper>
        ) : (
          <div className="mt-2 space-y-2">
            {locations.map((row) => (
              <PartyMasterLocationCard
                key={row.key}
                row={row}
                states={states}
                labelPlaceholder="Mumbai Depot"
                onChange={(patch) => updateLocation(row.key, patch)}
                onRemove={() => removeLocationRow(row.key)}
                onSetDefault={() => setDefaultLocation(row.key)}
              />
            ))}
          </div>
        )}
      </PartyMasterSection>

      {error ? <PartyMasterFormError message={error} /> : null}

      <PartyMasterFormFooter
        onCancel={onCancel}
        submitting={submitting}
        submitLabel={editingId ? "Save supplier" : "Create supplier"}
      />
    </form>
  );
}
