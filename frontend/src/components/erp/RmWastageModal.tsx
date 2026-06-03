/**
 * Declare RM wastage (MWN) from production — final loss, not returned to store.
 */
import * as React from "react";
import { apiFetch } from "../../services/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useToast } from "../../contexts/ToastContext";
import { RM_WASTAGE_REASON_OPTIONS, validateWastageQtyInput } from "../../lib/rmWastageUx";

type WastageLine = {
  itemId: number;
  itemName: string;
  unit: string;
  returnableQty: number;
  availableWastageQty?: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  workOrderId: number;
  pmrId?: number | "";
  fromLocationId: number;
  line: WastageLine;
};

function fmtQty(n: number, unit?: string) {
  const u = unit?.trim() ? ` ${unit}` : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${u}`;
}

export function RmWastageModal({ open, onClose, onSuccess, workOrderId, pmrId, fromLocationId, line }: Props) {
  const { showSuccess, showError } = useToast();
  const [qty, setQty] = React.useState("");
  const [reason, setReason] = React.useState("PROCESS_LOSS");
  const [remarks, setRemarks] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const available = line.availableWastageQty ?? line.returnableQty;

  React.useEffect(() => {
    if (open) {
      setQty("");
      setReason("PROCESS_LOSS");
      setRemarks("");
    }
  }, [open, line.itemId]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const check = validateWastageQtyInput(qty, available);
    if (!check.ok) {
      showError(check.message);
      return;
    }
    if (!remarks.trim()) {
      showError("Remarks are required for wastage.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ docNo: string }>("/api/production-material-returns/wastage", {
        method: "POST",
        body: JSON.stringify({
          workOrderId,
          fromLocationId,
          productionMaterialRequestId: typeof pmrId === "number" ? pmrId : null,
          itemId: line.itemId,
          qty: check.qty,
          reason,
          remarks: remarks.trim(),
        }),
      });
      showSuccess(`RM wastage ${res.docNo ?? "posted"}.`);
      onSuccess();
      onClose();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Wastage failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-slate-900">Declare RM wastage</h3>
        <p className="mt-0.5 text-xs text-slate-600">
          Final loss from production. Stock is written off (not returned to store).
        </p>

        <div className="mt-3 grid gap-2 text-[12px]">
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">RM item</span>
            <Input value={line.itemName} readOnly className="h-8 bg-slate-50 text-[13px]" />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Available wastage qty</span>
            <Input value={fmtQty(available, line.unit)} readOnly className="h-8 bg-slate-50 text-[13px]" />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Wastage qty *</span>
            <Input
              type="number"
              step="any"
              min={0}
              max={available}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="h-8 text-[13px]"
              required
            />
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Reason *</span>
            <select
              className="erp-flow-filter-input h-8 rounded-md border border-slate-200 px-2 text-[13px]"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            >
              {RM_WASTAGE_REASON_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-0.5">
            <span className="font-medium text-slate-600">Remarks *</span>
            <Input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              className="h-8 text-[13px]"
              required
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            Post wastage
          </Button>
        </div>
      </form>
    </div>
  );
}
