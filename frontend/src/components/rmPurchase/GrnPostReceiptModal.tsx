import * as React from "react";
import { X } from "lucide-react";
import { ErpModal } from "../erp/ErpModal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { FieldShortcutHint } from "../ui/FieldShortcutHint";
import {
  computeGrnBalanceAfterReceipt,
  formatGrnWorkspaceQty,
} from "../../lib/grnReceivingWorkspaceUx";
import {
  formatRmPoNo,
  receivedForLine,
  type GrnLineDraft,
  type GrnReceivingLocation,
  type RmPoRow,
} from "../../pages/rmPurchase/rmPurchaseShared";

export type GrnPostReceiptModalProps = {
  po: RmPoRow;
  grnDateInput: string;
  grnSupplierInvoiceNo: string;
  grnFieldErrors: { grnDate?: string; supplierInvoiceNo?: string };
  grnLines: GrnLineDraft[];
  grnLocations: GrnReceivingLocation[];
  grnLocationsLoading: boolean;
  grning: boolean;
  grnPostDisabled: boolean;
  onRequestClose: () => void;
  onGrnDateChange: (value: string) => void;
  onSupplierInvoiceChange: (value: string) => void;
  onReceiveFull: () => void;
  onReceiveNone: () => void;
  onConfirmReceipt: () => void;
  onGrnLinesChange: (updater: (prev: GrnLineDraft[]) => GrnLineDraft[]) => void;
  grnQtyInputRefs: React.MutableRefObject<(HTMLInputElement | null)[]>;
  grnLocationSelectRefs: React.MutableRefObject<(HTMLSelectElement | null)[]>;
  onGrnQtyKeyDown: (rowIndex: number, e: React.KeyboardEvent<HTMLInputElement>) => void;
  onGrnLocationKeyDown: (rowIndex: number, e: React.KeyboardEvent<HTMLSelectElement>) => void;
  grnQtyBind: (rowIndex: number, rmPoLineId: number) => {
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
  };
  showGrnQtyShortcut: boolean;
  grnQtyShortcutHint: string;
  postGrnFocusBind: {
    onFocus: React.FocusEventHandler<HTMLElement>;
    onBlur: React.FocusEventHandler<HTMLElement>;
  };
  showPostGrnShortcut: boolean;
  postGrnShortcutHint: string;
  onPostGrnShortcutUsed: () => void;
};

export function GrnPostReceiptModal({
  po,
  grnDateInput,
  grnSupplierInvoiceNo,
  grnFieldErrors,
  grnLines,
  grnLocations,
  grnLocationsLoading,
  grning,
  grnPostDisabled,
  onRequestClose,
  onGrnDateChange,
  onSupplierInvoiceChange,
  onReceiveFull,
  onReceiveNone,
  onConfirmReceipt,
  onGrnLinesChange,
  grnQtyInputRefs,
  grnLocationSelectRefs,
  onGrnQtyKeyDown,
  onGrnLocationKeyDown,
  grnQtyBind,
  showGrnQtyShortcut,
  grnQtyShortcutHint,
  postGrnFocusBind,
  showPostGrnShortcut,
  postGrnShortcutHint,
  onPostGrnShortcutUsed,
}: GrnPostReceiptModalProps) {
  return (
    <ErpModal
      onClose={onRequestClose}
      escapeDisabled={() => grning}
      aria-labelledby="rm-grn-title"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[72rem] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
        data-testid="grn-post-receipt-modal"
      >
        <div className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white px-5 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-2">
              <h2 id="rm-grn-title" className="text-lg font-semibold text-slate-900">
                Post Goods Receipt — {formatRmPoNo(po.id)}
              </h2>
              <dl className="grid gap-x-6 gap-y-1 text-[12px] text-slate-700 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="font-medium text-slate-500">Supplier</dt>
                  <dd className="font-medium text-slate-900">{po.supplier?.name?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Supplier PO Number</dt>
                  <dd className="font-mono text-slate-900">{po.supplierPoNumber?.trim() || "—"}</dd>
                </div>
                <div>
                  <dt className="font-medium text-slate-500">Internal RM PO Number</dt>
                  <dd className="font-mono text-slate-900">{formatRmPoNo(po.id)}</dd>
                </div>
              </dl>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 shrink-0 p-0"
              disabled={grning}
              onClick={onRequestClose}
              aria-label="Close post goods receipt"
              data-testid="grn-post-receipt-modal-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
            <div className="grid min-w-[10rem] gap-1">
              <label htmlFor="rm-grn-date" className="text-[11px] font-medium text-slate-600">
                GRN date *
              </label>
              <Input
                id="rm-grn-date"
                type="date"
                className="h-8 max-w-[11rem] text-[12px]"
                value={grnDateInput}
                onChange={(e) => onGrnDateChange(e.target.value)}
                disabled={grning}
              />
              {grnFieldErrors.grnDate ? (
                <p className="text-[11px] text-red-600" role="alert">
                  {grnFieldErrors.grnDate}
                </p>
              ) : null}
            </div>
            <div className="grid min-w-[12rem] flex-1 gap-1">
              <label htmlFor="rm-grn-supplier-inv" className="text-[11px] font-medium text-slate-600">
                Supplier invoice number *
              </label>
              <Input
                id="rm-grn-supplier-inv"
                type="text"
                className="h-8 max-w-md text-[12px]"
                autoCapitalize="off"
                autoCorrect="off"
                value={grnSupplierInvoiceNo}
                onChange={(e) => onSupplierInvoiceChange(e.target.value)}
                disabled={grning}
              />
              {grnFieldErrors.supplierInvoiceNo ? (
                <p className="text-[11px] text-red-600" role="alert">
                  {grnFieldErrors.supplierInvoiceNo}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-0.5">
              <Button type="button" variant="outline" size="sm" disabled={grning} onClick={onReceiveFull}>
                Receive full
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={grning} onClick={onReceiveNone}>
                Clear receive qty
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-5">
          <div
            className="max-h-[min(52vh,28rem)] overflow-auto py-3"
            data-testid="grn-post-receipt-lines-scroll"
          >
            <table className="erp-table erp-table-dense w-full min-w-[52rem] text-[12px] [&_td]:py-1 [&_th]:py-1">
              <thead className="sticky top-0 z-[1] border-b border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2 text-left">Item</th>
                  <th className="px-2 text-left">Unit</th>
                  <th className="px-2 text-right">Ordered qty</th>
                  <th className="px-2 text-right">Previously received</th>
                  <th className="px-2 text-right">Pending qty</th>
                  <th className="px-2 text-left">Receiving location</th>
                  <th className="px-2 text-right">Receive qty</th>
                  <th className="px-2 text-right">Balance after receipt</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((ln, i) => {
                  const got = receivedForLine(po, ln.id);
                  const pending = Math.max(0, Number(ln.qty) - got);
                  const gl = grnLines.find((g) => g.rmPoLineId === ln.id);
                  const receiveQty = gl?.receivedQty ?? Number.NaN;
                  const balanceAfter = computeGrnBalanceAfterReceipt(pending, receiveQty);
                  const unit = ln.unit?.trim() || ln.item?.unitName?.trim() || "—";

                  return (
                    <tr key={ln.id} className="border-t border-slate-100 align-middle">
                      <td className="max-w-[11rem] truncate px-2 font-medium text-slate-900" title={ln.item?.itemName ?? "—"}>
                        {ln.item?.itemName ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 text-slate-600">{unit}</td>
                      <td className="px-2 text-right tabular-nums text-slate-800">
                        {formatGrnWorkspaceQty(Number(ln.qty), ln.unit ?? undefined)}
                      </td>
                      <td className="px-2 text-right tabular-nums text-slate-600">
                        {formatGrnWorkspaceQty(got, ln.unit ?? undefined)}
                      </td>
                      <td className="px-2 text-right tabular-nums font-medium text-amber-950">
                        {pending > 1e-9 ? formatGrnWorkspaceQty(pending, ln.unit ?? undefined) : "—"}
                      </td>
                      <td className="px-2">
                        <select
                          ref={(el) => {
                            grnLocationSelectRefs.current[i] = el;
                          }}
                          id={`grn-loc-${ln.id}`}
                          className="h-8 min-w-[9rem] max-w-[12rem] rounded-md border border-slate-200 bg-white px-2 text-[12px] text-slate-900"
                          value={gl?.locationId && gl.locationId > 0 ? String(gl.locationId) : ""}
                          disabled={grning || grnLocationsLoading || !grnLocations.length}
                          onKeyDown={(e) => onGrnLocationKeyDown(i, e)}
                          onChange={(e) => {
                            const locationId = Number(e.target.value);
                            onGrnLinesChange((prev) => {
                              const n = [...prev];
                              const ix = n.findIndex((x) => x.rmPoLineId === ln.id);
                              const qty = ix >= 0 ? n[ix]!.receivedQty : Number.NaN;
                              if (ix >= 0) n[ix] = { rmPoLineId: ln.id, receivedQty: qty, locationId };
                              else n.push({ rmPoLineId: ln.id, receivedQty: Number.NaN, locationId });
                              return n;
                            });
                          }}
                        >
                          <option value="">{grnLocationsLoading ? "Loading…" : "Select location"}</option>
                          {grnLocations.map((loc) => (
                            <option key={loc.id} value={String(loc.id)}>
                              {loc.locationName}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-2 text-right">
                        <FieldShortcutHint
                          show={i === 0 && showGrnQtyShortcut}
                          hint={grnQtyShortcutHint}
                          placement="below-end"
                        >
                          <Input
                            ref={(el) => {
                              grnQtyInputRefs.current[i] = el;
                            }}
                            type="number"
                            className="ml-auto h-8 w-[6.5rem] text-right text-[12px] tabular-nums"
                            value={gl && Number.isFinite(gl.receivedQty) ? String(gl.receivedQty) : ""}
                            min={0}
                            step="any"
                            disabled={grning}
                            onKeyDown={(e) => onGrnQtyKeyDown(i, e)}
                            {...grnQtyBind(i, ln.id)}
                            aria-label={`Receive qty for ${ln.item?.itemName ?? "item"}`}
                          />
                        </FieldShortcutHint>
                      </td>
                      <td className="px-2 text-right tabular-nums text-slate-700">
                        {Number.isFinite(receiveQty) && receiveQty > 0
                          ? formatGrnWorkspaceQty(balanceAfter, ln.unit ?? undefined)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="sticky bottom-0 z-10 flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <Button
            type="button"
            variant="outline"
            onClick={onRequestClose}
            disabled={grning}
            data-testid="grn-post-receipt-modal-cancel"
          >
            Close
          </Button>
          <FieldShortcutHint
            show={showPostGrnShortcut}
            hint={postGrnShortcutHint}
            placement="above"
            className="inline-block"
          >
            <Button
              type="button"
              onClick={() => {
                onPostGrnShortcutUsed();
                onConfirmReceipt();
              }}
              disabled={grnPostDisabled}
              onFocus={postGrnFocusBind.onFocus}
              onBlur={postGrnFocusBind.onBlur}
              data-testid="grn-post-receipt-modal-confirm"
            >
              {grning ? "Posting…" : "Confirm receipt"}
            </Button>
          </FieldShortcutHint>
        </div>
      </div>
    </ErpModal>
  );
}
