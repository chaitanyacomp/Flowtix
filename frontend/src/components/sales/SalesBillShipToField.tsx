import * as React from "react";
import { ErpModal } from "../erp/ErpModal";
import { Button } from "../ui/button";
import { apiFetch } from "../../services/api";

export type ShipToAddressOption = {
  id: number;
  label: string;
  address: string;
  gst: string | null;
  isDefault: boolean;
  stateCode: string | null;
  stateName: string | null;
};

export type ShipToSummary = {
  label: string | null;
  address: string;
  gstin: string | null;
  stateName: string | null;
  stateCode: string | null;
};

export type SalesBillShipToOptions = {
  addresses: ShipToAddressOption[];
  selectedShipToAddressId: number | null;
  dispatchShipTo: ShipToSummary | null;
  invoiceShipTo: ShipToSummary | null;
  differsFromDispatch: boolean;
  allowDropdown: boolean;
};

type BillLike = {
  id: number;
  status: string;
  shipToAddressId?: number | null;
  shipToLabelSnapshot?: string | null;
  shipToAddressSnapshot?: string | null;
  shipToStateCodeSnapshot?: string | null;
  shipToStateNameSnapshot?: string | null;
  shipToGstinSnapshot?: string | null;
  dispatchShipToLabelSnapshot?: string | null;
  dispatchShipToStateCodeSnapshot?: string | null;
};

function formatShipToLine(summary: ShipToSummary | null | undefined): string {
  if (!summary) return "Same as Bill To";
  const label = summary.label?.trim();
  const state =
    [summary.stateCode?.trim(), summary.stateName?.trim()].filter(Boolean).join(" · ") || null;
  if (label && state) return `${label} · ${state}`;
  return label || state || "Delivery address";
}

function resolveSelectedAddressId(
  bill: BillLike,
  options: SalesBillShipToOptions | null,
): string {
  if (bill.shipToAddressId) return String(bill.shipToAddressId);
  if (!options?.addresses.length) return "";
  const label = bill.shipToLabelSnapshot?.trim().toLowerCase() ?? "";
  const code = bill.shipToStateCodeSnapshot?.trim() ?? "";
  const match = options.addresses.find(
    (a) =>
      a.label.trim().toLowerCase() === label &&
      (code ? (a.stateCode ?? "") === code : true),
  );
  return match ? String(match.id) : "";
}

export function SalesBillShipToField({
  bill,
  readOnly,
  showAddress,
  onToggleAddress,
  onBillUpdated,
  onError,
}: {
  bill: BillLike;
  readOnly: boolean;
  showAddress: boolean;
  onToggleAddress: () => void;
  onBillUpdated: (bill: unknown) => void;
  onError: (message: string) => void;
}) {
  const [options, setOptions] = React.useState<SalesBillShipToOptions | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [pendingAddressId, setPendingAddressId] = React.useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const isDraft = bill.status === "DRAFT" && !readOnly;

  React.useEffect(() => {
    if (!isDraft) {
      setOptions(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetch<SalesBillShipToOptions>(`/api/sales-bills/${bill.id}/ship-to-options`)
      .then((res) => {
        if (!cancelled) setOptions(res);
      })
      .catch((e) => {
        if (!cancelled) onError(e instanceof Error ? e.message : "Could not load Ship To options.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bill.id, isDraft, onError]);

  const selectedValue = resolveSelectedAddressId(bill, options);
  const allowDropdown = Boolean(isDraft && options?.allowDropdown);
  const invoiceLine = formatShipToLine(
    options?.invoiceShipTo ?? {
      label: bill.shipToLabelSnapshot ?? null,
      address: bill.shipToAddressSnapshot ?? "",
      gstin: bill.shipToGstinSnapshot ?? null,
      stateName: bill.shipToStateNameSnapshot ?? null,
      stateCode: bill.shipToStateCodeSnapshot ?? null,
    },
  );
  const differsFromDispatch =
    options?.differsFromDispatch ||
    Boolean(
      bill.dispatchShipToLabelSnapshot?.trim() &&
        bill.shipToLabelSnapshot?.trim() &&
        bill.dispatchShipToLabelSnapshot.trim() !== bill.shipToLabelSnapshot.trim(),
    );

  async function applyShipTo(shipToAddressId: number, confirmed = false) {
    setBusy(true);
    onError("");
    try {
      const updated = await apiFetch(`/api/sales-bills/${bill.id}/ship-to`, {
        method: "PATCH",
        body: JSON.stringify({ shipToAddressId, confirmed }),
      });
      onBillUpdated(updated);
      setConfirmOpen(false);
      setPendingAddressId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update Ship To.";
      if (msg.includes("Confirm to continue")) {
        setPendingAddressId(shipToAddressId);
        setConfirmOpen(true);
        return;
      }
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  function onSelectChange(nextId: string) {
    const id = Number(nextId);
    if (!Number.isFinite(id) || id <= 0) return;
    if (selectedValue === nextId) return;
    void applyShipTo(id, false);
  }

  return (
    <div className="min-w-0 w-full rounded border border-slate-200 bg-white px-2.5 py-2" data-testid="sales-bill-ship-to-field">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="text-[11px] font-medium text-slate-600">Ship To</div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={onToggleAddress}
          aria-expanded={showAddress}
        >
          {showAddress ? "Hide" : "View"}
        </Button>
      </div>

      {loading ? <p className="mt-1 text-xs text-slate-500">Loading addresses…</p> : null}

      {allowDropdown ? (
        <select
          className="mt-1.5 box-border h-9 w-full min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
          value={selectedValue}
          disabled={busy || loading}
          data-testid="sales-bill-ship-to-select"
          onChange={(e) => onSelectChange(e.target.value)}
        >
          {!selectedValue ? <option value="">Select Ship To…</option> : null}
          {(options?.addresses ?? []).map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.label}
              {a.stateCode ? ` · ${a.stateCode}` : ""}
              {a.isDefault ? " (Default)" : ""}
            </option>
          ))}
        </select>
      ) : (
        <div className="mt-0.5 break-words text-[13px] font-semibold leading-snug text-slate-900">{invoiceLine}</div>
      )}

      {differsFromDispatch && !readOnly ? (
        <p className="mt-1 text-[11px] text-amber-800" data-testid="sales-bill-ship-to-differs-hint">
          Differs from dispatch delivery address.
        </p>
      ) : null}

      {showAddress ? (
        <div className="mt-2 space-y-1 rounded border border-slate-200 bg-slate-50 p-2 text-[12px] leading-snug text-slate-700">
          <div>
            <span className="font-medium text-slate-800">Invoice Ship To: </span>
            <span className="whitespace-pre-wrap break-words">
              {bill.shipToAddressSnapshot?.trim() || "Same as Bill To"}
            </span>
          </div>
          {options?.dispatchShipTo ? (
            <div>
              <span className="font-medium text-slate-800">Dispatch Ship To: </span>
              <span className="whitespace-pre-wrap break-words">
                {options.dispatchShipTo.address?.trim() || options.dispatchShipTo.label || "—"}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {confirmOpen ? (
        <ErpModal onClose={() => setConfirmOpen(false)} backdropClassName="bg-black/30" aria-label="Confirm Ship To change">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-semibold text-slate-900">Confirm Ship To change</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                The selected Ship-To address differs from the Dispatch address. This change will be recorded in the audit
                trail. Continue?
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
              <Button type="button" variant="outline" className="h-8 text-xs" disabled={busy} onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="h-8 text-xs"
                data-testid="sales-bill-ship-to-confirm"
                disabled={busy || !pendingAddressId}
                onClick={() => pendingAddressId && void applyShipTo(pendingAddressId, true)}
              >
                {busy ? "Updating…" : "Continue"}
              </Button>
            </div>
          </div>
        </ErpModal>
      ) : null}
    </div>
  );
}
