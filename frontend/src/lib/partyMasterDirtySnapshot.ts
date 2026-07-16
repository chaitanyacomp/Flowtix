import { normalizeGstinInput } from "./gstinValidation";
import type { PartyLocationDraft } from "../components/erp/partyMasterUi";

/** Trim; treat null/undefined as empty. */
export function normText(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/** Empty string / null / undefined → null; otherwise finite number. */
export function normStateId(v: number | "" | null | undefined): number | null {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normGstin(v: string | null | undefined): string {
  return normalizeGstinInput(v ?? "") || "";
}

/** Delivery / supply location fields that affect save — excludes UI-only `key`. */
export function snapshotPartyLocation(row: PartyLocationDraft): Record<string, unknown> {
  return {
    id: row.id != null && Number.isFinite(Number(row.id)) ? Number(row.id) : null,
    label: normText(row.label),
    locationType: row.locationType || "OTHER",
    address: normText(row.address),
    city: normText(row.city),
    district: normText(row.district),
    stateId: normStateId(row.stateId),
    pincode: normText(row.pincode),
    country: normText(row.country),
    gstin: normGstin(row.gstin),
    contactPerson: normText(row.contactPerson),
    phone: normText(row.phone),
    email: normText(row.email),
    notes: normText(row.notes),
    isDefault: Boolean(row.isDefault),
    isActive: row.isActive !== false,
  };
}

function sortLocationSnapshots(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...rows].sort((a, b) => {
    const aId = a.id as number | null;
    const bId = b.id as number | null;
    if (aId != null && bId != null && aId !== bId) return aId - bId;
    if (aId != null && bId == null) return -1;
    if (aId == null && bId != null) return 1;
    const al = String(a.label ?? "");
    const bl = String(b.label ?? "");
    if (al !== bl) return al.localeCompare(bl);
    return String(a.address ?? "").localeCompare(String(b.address ?? ""));
  });
}

export type PartyMasterHeaderSnapshot = {
  name: string;
  contact: string;
  email: string;
  gstin: string;
  stateId: number | "" | null;
  address: string;
  isActive: boolean;
};

export function snapshotPartyMasterForm(
  header: PartyMasterHeaderSnapshot,
  locations: PartyLocationDraft[],
): string {
  return JSON.stringify({
    name: normText(header.name),
    contact: normText(header.contact),
    email: normText(header.email),
    gstin: normGstin(header.gstin),
    stateId: normStateId(header.stateId),
    address: normText(header.address),
    isActive: Boolean(header.isActive),
    locations: sortLocationSnapshots(locations.map(snapshotPartyLocation)),
  });
}
