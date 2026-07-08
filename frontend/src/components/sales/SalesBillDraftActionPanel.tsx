import { Check, X } from "lucide-react";
import { Button } from "../ui/button";
import type { SalesBillFinalizeCheck } from "../../lib/salesBillFinalizeValidation";
import { cn } from "../../lib/utils";

export function SalesBillFinalizeChecklist({
  checks,
  className,
}: {
  checks: SalesBillFinalizeCheck[];
  className?: string;
}) {
  if (!checks.length) return null;
  return (
    <ul className={cn("space-y-1", className)} data-testid="sales-bill-finalize-checklist">
      {checks.map((check) => (
        <li key={check.id} className="flex items-start gap-2 text-[11px] leading-snug">
          {check.passed ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden />
          ) : (
            <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
          )}
          <span className={check.passed ? "text-slate-700" : "text-amber-900"}>{check.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function SalesBillDraftActionPanel({
  saving,
  deleting,
  canFinalize,
  onFinalize,
  onSaveDraft,
  onDeleteDraft,
  checks,
  deleteDisabled = false,
  className,
}: {
  saving: boolean;
  deleting: boolean;
  canFinalize: boolean;
  onFinalize: () => void;
  onSaveDraft: () => void;
  onDeleteDraft: () => void;
  checks: SalesBillFinalizeCheck[];
  deleteDisabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-slate-200 bg-white", className)} data-testid="sales-bill-draft-action-panel">
      <div className="border-b border-slate-100 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Actions</h3>
      </div>
      <div className="space-y-3 px-3 py-3">
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full text-sm"
          data-testid="save-sales-bill-draft-btn"
          disabled={saving}
          onClick={onSaveDraft}
        >
          {saving ? "Saving…" : "Save Draft"}
        </Button>
        <Button
          type="button"
          className="h-10 w-full text-sm font-semibold"
          data-testid="finalize-sales-bill-btn"
          disabled={saving || !canFinalize}
          onClick={onFinalize}
        >
          {saving ? "Working…" : "Finalize Bill"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full text-sm text-red-700 hover:bg-red-50 hover:text-red-800"
          data-testid="delete-sales-bill-draft-btn"
          disabled={deleting || saving || deleteDisabled}
          onClick={onDeleteDraft}
        >
          {deleting ? "Deleting…" : "Delete Draft"}
        </Button>
        {!canFinalize ? (
          <div className="rounded-md border border-amber-100 bg-amber-50/80 px-2.5 py-2">
            <p className="text-[11px] font-medium text-amber-950">Complete checks before finalize</p>
            <SalesBillFinalizeChecklist checks={checks} className="mt-1.5" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
