import * as React from "react";
import { X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { apiFetch, ApiRequestError } from "../../services/api";
import { cn } from "../../lib/utils";
import { ErpModal } from "./ErpModal";

export type HoldStockRow = {
  itemId: number;
  item: { itemName: string; itemType: string; unit: string };
  qcHoldQty: number;
};

export type HoldMoveAction = "USABLE" | "REWORK" | "SCRAP";

const ACTION_OPTIONS: { value: HoldMoveAction; label: string }[] = [
  { value: "USABLE", label: "Move to Usable" },
  { value: "REWORK", label: "Move to Rework" },
  { value: "SCRAP", label: "Scrap" },
];

export function bucketToastLabel(a: HoldMoveAction): string {
  if (a === "USABLE") return "Usable";
  if (a === "REWORK") return "Rework";
  return "Scrap";
}

function parseQtyInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return n;
}

type Props = {
  open: boolean;
  row: HoldStockRow | null;
  onClose: () => void;
  onSuccess: (args: { qty: number; action: HoldMoveAction }) => void;
};

export function HoldStockModal({ open, row, onClose, onSuccess }: Props) {
  const [action, setAction] = React.useState<HoldMoveAction | null>(null);
  const [qtyDraft, setQtyDraft] = React.useState("");
  const [remarks, setRemarks] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const qtyInputRef = React.useRef<HTMLInputElement>(null);

  const holdQty = row ? row.qcHoldQty : 0;

  React.useEffect(() => {
    if (!open || !row) return;
    setAction(null);
    setQtyDraft(String(row.qcHoldQty));
    setRemarks("");
    setError(null);
    setSubmitting(false);
    const t = window.setTimeout(() => {
      const el = qtyInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [open, row?.itemId]);

  const parsedQty = parseQtyInput(qtyDraft);
  const qtyValid =
    parsedQty != null && parsedQty > 0 && parsedQty <= holdQty + 1e-9;
  const confirmDisabled = submitting || action == null || !qtyValid;

  async function handleConfirm() {
    if (!row || action == null || parsedQty == null || !qtyValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch("/api/stock/move-hold", {
        method: "POST",
        body: JSON.stringify({
          itemId: row.itemId,
          qty: parsedQty,
          action,
          remarks: remarks.trim() || undefined,
        }),
      });
      onSuccess({ qty: parsedQty, action });
      onClose();
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : "Request failed";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (!open || !row) return null;

  return (
    <ErpModal
      open={open}
      onClose={onClose}
      closeOnBackdropClick
      aria-labelledby="hold-stock-modal-title"
    >
      <Card className="erp-modal-shell max-w-md">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-slate-200 pb-3">
          <CardTitle id="hold-stock-modal-title" className="text-lg font-semibold tracking-tight">
            Manage Hold Stock
          </CardTitle>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="space-y-1 rounded-md border border-slate-200 bg-slate-50/80 p-3 text-sm">
            <div className="text-xs font-medium text-slate-600">Item</div>
            <div className="font-medium text-slate-900">{row.item.itemName}</div>
            <div className="mt-2 text-xs font-medium text-slate-600">Current Hold Qty</div>
            <div className="tabular-nums font-semibold text-amber-950">
              {holdQty} {row.item.unit}
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-800">Action</legend>
            <div className="grid gap-2">
              {ACTION_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm",
                    action === opt.value ? "border-amber-300 bg-amber-50/90" : "border-slate-200 bg-white",
                  )}
                >
                  <input
                    type="radio"
                    name="hold-move-action"
                    className="h-4 w-4 accent-amber-600"
                    checked={action === opt.value}
                    onChange={() => setAction(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Quantity
            <Input
              ref={qtyInputRef}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className="h-9 tabular-nums"
              value={qtyDraft}
              onChange={(e) => setQtyDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
          </label>

          <label className="grid gap-1 text-sm font-medium text-slate-800">
            Remarks <span className="font-normal text-slate-500">(optional)</span>
            <textarea
              className="min-h-[4rem] w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Note for audit trail…"
              maxLength={2000}
            />
          </label>

          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleConfirm()} disabled={confirmDisabled}>
              {submitting ? "Working…" : "Confirm"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </ErpModal>
  );
}
