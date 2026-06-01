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

export type DeliveryAddressDraft = PartyLocationDraft;

export function newDeliveryAddressDraft(partial?: Partial<DeliveryAddressDraft>): DeliveryAddressDraft {
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

export function CustomerMasterForm({ states, onCancel, onSaved, editingId }: Props) {
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
        address?: string | null;
        city?: string | null;
        stateId?: number | null;
        gstin?: string | null;
        contactPerson?: string | null;
        phone?: string | null;
        isDefault?: boolean;
        isActive?: boolean;
      }>;
    }>(`/api/customers/${editingId}`)
      .then((row) => {
        setName(row.name ?? "");
        setContact(row.contact ?? "");
        setEmail(row.email ?? "");
        setGstin(row.gstin ?? "");
        setStateId(row.stateId ?? "");
        setAddress(row.address ?? "");
        setIsActive(row.isActive !== false);
        setDeliveryAddresses(
          (row.deliveryAddresses ?? []).map((a) =>
            newDeliveryAddressDraft({
              key: `addr-${a.id}`,
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
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load customer."))
      .finally(() => setLoading(false));
  }, [editingId]);

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
      if (!row.label.trim()) return "Each delivery address needs a label.";
      const rowGstErr =
        validateGstinFormatMessage(row.gstin) ??
        validateGstinAgainstState(row.gstin, row.stateId, states);
      if (rowGstErr) return `Delivery address "${row.label.trim() || "Untitled"}": ${rowGstErr}`;
    }
    const gstSet = new Set<string>();
    const mainGst = normalizeGstinInput(gstin);
    if (mainGst) gstSet.add(mainGst);
    for (const row of deliveryAddresses) {
      const g = normalizeGstinInput(row.gstin);
      if (!g) continue;
      if (gstSet.has(g)) return "Duplicate GSTIN is not allowed within this customer.";
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
      deliveryAddresses: deliveryAddresses.map((row) => ({
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
        await apiFetch(`/api/customers/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      } else {
        await apiFetch("/api/customers", { method: "POST", body: JSON.stringify(payload) });
      }
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
        title="Delivery Addresses"
        action={<PartyMasterAddLocationButton onClick={addDeliveryRow} />}
      >
        {deliveryAddresses.length === 0 ? (
          <PartyMasterLocationsHelper>
            Add plant, warehouse, or branch locations for ship-to operations. Bill-to remains the registered entity above.
          </PartyMasterLocationsHelper>
        ) : (
          <div className="mt-2 space-y-2">
            {deliveryAddresses.map((row) => (
              <PartyMasterLocationCard
                key={row.key}
                row={row}
                states={states}
                labelPlaceholder="Pune Plant"
                onChange={(patch) => updateDelivery(row.key, patch)}
                onRemove={() => removeDeliveryRow(row.key)}
                onSetDefault={() => setDefaultDelivery(row.key)}
              />
            ))}
          </div>
        )}
      </PartyMasterSection>

      {error ? <PartyMasterFormError message={error} /> : null}

      <PartyMasterFormFooter
        onCancel={onCancel}
        submitting={submitting}
        submitLabel={editingId ? "Save customer" : "Create customer"}
      />
    </form>
  );
}
