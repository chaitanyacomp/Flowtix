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
import { snapshotPartyMasterForm } from "../../lib/partyMasterDirtySnapshot";
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
import { ErpModalFrameBody, ErpModalFrameFooter } from "./ErpModalFrame";

export type DeliveryAddressDraft = PartyLocationDraft;

export function newDeliveryAddressDraft(partial?: Partial<DeliveryAddressDraft>): DeliveryAddressDraft {
  return {
    key: partial?.key ?? `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    id: partial?.id,
    label: partial?.label ?? "",
    locationType: partial?.locationType ?? "OTHER",
    address: partial?.address ?? "",
    city: partial?.city ?? "",
    district: partial?.district ?? "",
    stateId: partial?.stateId ?? "",
    pincode: partial?.pincode ?? "",
    country: partial?.country ?? "",
    gstin: partial?.gstin ?? "",
    contactPerson: partial?.contactPerson ?? "",
    phone: partial?.phone ?? "",
    email: partial?.email ?? "",
    notes: partial?.notes ?? "",
    isDefault: partial?.isDefault ?? false,
    isActive: partial?.isActive ?? true,
  };
}

type Props = {
  states: StateRow[];
  onCancel: () => void;
  onSaved: () => void;
  editingId?: number | null;
  /** Field-level dirty via baseline — not merely that the modal is open. */
  onDirtyChange?: (dirty: boolean) => void;
};

export function CustomerMasterForm({ states, onCancel, onSaved, editingId, onDirtyChange }: Props) {
  const [loading, setLoading] = React.useState(Boolean(editingId));
  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [gstin, setGstin] = React.useState("");
  const [stateId, setStateId] = React.useState<number | "">("");
  const [address, setAddress] = React.useState("");
  const [isActive, setIsActive] = React.useState(true);
  const [deliveryAddresses, setDeliveryAddresses] = React.useState<DeliveryAddressDraft[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [gstTouched, setGstTouched] = React.useState(false);
  const gstAutoStateRef = React.useRef(false);
  const [baseline, setBaseline] = React.useState<string | null>(null);
  const hydrateCapturedRef = React.useRef(false);

  const formSnapshot = React.useMemo(
    () =>
      snapshotPartyMasterForm(
        { name, contact, email, gstin, stateId, address, isActive },
        deliveryAddresses,
      ),
    [name, contact, email, gstin, stateId, address, isActive, deliveryAddresses],
  );

  React.useEffect(() => {
    if (editingId) return;
    hydrateCapturedRef.current = true;
    setBaseline(formSnapshot);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- capture create defaults once
  }, [editingId]);

  React.useEffect(() => {
    if (!editingId) return;
    if (loading) {
      hydrateCapturedRef.current = false;
      setBaseline(null);
      return;
    }
    if (hydrateCapturedRef.current) return;
    const t = window.setTimeout(() => {
      hydrateCapturedRef.current = true;
      setBaseline(formSnapshot);
    }, 50);
    return () => window.clearTimeout(t);
  }, [editingId, loading, formSnapshot]);

  const isDirty = baseline != null && formSnapshot !== baseline;

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  React.useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

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
      deliveryAddresses?: Array<{
        id: number;
        label: string;
        locationType?: string | null;
        address?: string | null;
        city?: string | null;
        district?: string | null;
        stateId?: number | null;
        pincode?: string | null;
        country?: string | null;
        gstin?: string | null;
        contactPerson?: string | null;
        phone?: string | null;
        email?: string | null;
        notes?: string | null;
        isDefault?: boolean;
        isActive?: boolean;
      }>;
    }>(`/api/customers/${editingId}`)
      .then((row) => {
        const nextGstin = row.gstin ?? "";
        let nextStateId: number | "" = row.stateId ?? "";
        const autoId = resolveStateIdFromGstin(normalizeGstinInput(nextGstin), states);
        if (autoId !== "") nextStateId = autoId;
        setName(row.name ?? "");
        setContact(row.contact ?? "");
        setEmail(row.email ?? "");
        setGstin(nextGstin);
        setStateId(nextStateId);
        setAddress(row.address ?? "");
        setIsActive(row.isActive !== false);
        setDeliveryAddresses(
          (row.deliveryAddresses ?? []).map((a) =>
            newDeliveryAddressDraft({
              key: `addr-${a.id}`,
              id: a.id,
              label: a.label,
              locationType: (a.locationType as DeliveryAddressDraft["locationType"]) || "OTHER",
              address: a.address ?? "",
              city: a.city ?? "",
              district: a.district ?? "",
              stateId: a.stateId ?? "",
              pincode: a.pincode ?? "",
              country: a.country ?? "",
              gstin: a.gstin ?? "",
              contactPerson: a.contactPerson ?? "",
              phone: a.phone ?? "",
              email: a.email ?? "",
              notes: a.notes ?? "",
              isDefault: Boolean(a.isDefault),
              isActive: a.isActive !== false,
            }),
          ),
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load customer."))
      .finally(() => setLoading(false));
  }, [editingId, states]);

  React.useEffect(() => {
    const g = normalizeGstinInput(gstin);
    if (g.length < 2) return;
    const autoId = resolveStateIdFromGstin(g, states);
    if (autoId === "") return;
    gstAutoStateRef.current = true;
    setStateId(autoId);
  }, [gstin, states]);

  const gstFormatError = gstTouched ? validateGstinFormatMessage(gstin) : null;
  const gstStateError =
    gstTouched && !gstFormatError ? validateGstinAgainstState(gstin, stateId, states) : null;

  function updateDelivery(key: string, patch: Partial<DeliveryAddressDraft>) {
    setDeliveryAddresses((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function addDeliveryRow() {
    setDeliveryAddresses((rows) => [...rows, newDeliveryAddressDraft({ isDefault: rows.length === 0 })]);
  }

  function removeDeliveryRow(key: string) {
    setDeliveryAddresses((rows) => {
      const next = rows.filter((r) => r.key !== key);
      if (next.length && !next.some((r) => r.isDefault)) next[0].isDefault = true;
      return [...next];
    });
  }

  function setDefaultDelivery(key: string) {
    setDeliveryAddresses((rows) => rows.map((r) => ({ ...r, isDefault: r.key === key })));
  }

  function validateForm(): string | null {
    if (!name.trim()) return "Customer name is required.";
    const gstErr = validateGstinFormatMessage(gstin) ?? validateGstinAgainstState(gstin, stateId, states);
    if (gstErr) return gstErr;
    for (const row of deliveryAddresses) {
      if (!row.label.trim()) return "Each delivery location needs a location label.";
      const rowGstErr =
        validateGstinFormatMessage(row.gstin) ??
        validateGstinAgainstState(row.gstin, row.stateId, states);
      if (rowGstErr) return `Delivery location "${row.label.trim() || "Untitled"}": ${rowGstErr}`;
    }
    // Same GSTIN may appear on customer + own locations; only reject malformed GSTIN above.
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
      deliveryAddresses: deliveryAddresses.map((row) => ({
        ...(row.id ? { id: row.id } : {}),
        label: row.label.trim(),
        locationType: row.locationType || "OTHER",
        address: row.address.trim() || null,
        city: row.city.trim() || null,
        district: (row.district ?? "").trim() || null,
        stateId: row.stateId === "" ? null : Number(row.stateId),
        pincode: (row.pincode ?? "").trim() || null,
        country: (row.country ?? "").trim() || null,
        gstin: normalizeGstinInput(row.gstin) || null,
        contactPerson: row.contactPerson.trim() || null,
        phone: row.phone.trim() || null,
        email: (row.email ?? "").trim() || null,
        notes: (row.notes ?? "").trim() || null,
        isDefault: row.isDefault,
        isActive: row.isActive,
      })),
    };
    try {
      if (editingId) {
        await apiFetch(`/api/customers/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/api/customers", { method: "POST", body: JSON.stringify(payload) });
      }
      setBaseline(formSnapshot);
      onDirtyChange?.(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save customer.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <PartyMasterLoading message="Loading customer…" />;
  }

  return (
    <form onSubmit={onSubmit} className={partyMasterFormClass}>
      <ErpModalFrameBody className="space-y-3">
      <PartyMasterSection variant="registered" title="Registered entity">
        <div className={partyMasterGridClass}>
          <PartyMasterField label="Customer name" className="sm:col-span-2">
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
            hint="Optional for unregistered customers"
            gstFormatError={gstFormatError}
            gstStateError={gstStateError}
          />
          <PartyMasterStateField
            value={stateId}
            onChange={(v) => {
              gstAutoStateRef.current = false;
              setStateId(v);
              setGstTouched(true);
            }}
            states={states}
          />
          <PartyMasterField label="Registered office address" className="sm:col-span-2">
            <PartyMasterTextArea value={address} onChange={setAddress} />
          </PartyMasterField>
          <PartyMasterActiveCheckbox
            label="Active customer"
            checked={isActive}
            onChange={setIsActive}
            className="sm:col-span-2"
          />
        </div>
      </PartyMasterSection>

      <PartyMasterSection
        variant="locations"
        title="Delivery Locations"
        action={<PartyMasterAddLocationButton onClick={addDeliveryRow} />}
      >
        {deliveryAddresses.length === 0 ? (
          <PartyMasterLocationsHelper>
            Add plant, warehouse, or branch delivery locations for ship-to / dispatch. Bill-to remains the registered
            entity above. The same GSTIN may appear on the customer and its locations.
          </PartyMasterLocationsHelper>
        ) : (
          <div className="mt-2 space-y-2">
            {deliveryAddresses.map((row) => (
              <PartyMasterLocationCard
                key={row.key}
                row={row}
                states={states}
                labelPlaceholder="Pune Plant"
                showCustomerLocationExtras
                onChange={(patch) => updateDelivery(row.key, patch)}
                onRemove={() => removeDeliveryRow(row.key)}
                onSetDefault={() => setDefaultDelivery(row.key)}
              />
            ))}
          </div>
        )}
      </PartyMasterSection>

      {error ? <PartyMasterFormError message={error} /> : null}
      </ErpModalFrameBody>

      <ErpModalFrameFooter>
        <PartyMasterFormFooter
          onCancel={onCancel}
          submitting={submitting}
          submitLabel={editingId ? "Save customer" : "Create customer"}
        />
      </ErpModalFrameFooter>
    </form>
  );
}
