import * as React from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { PageBackLink, PageContainer, StickyWorkspaceHead } from "../../components/PageHeader";
import { Button, buttonVariants } from "../../components/ui/button";
import { cn } from "../../lib/utils";
import { apiFetch } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { RmPoInternalTraceabilityView } from "../../components/rmPurchase/RmPoInternalTraceabilityView";
import { printRmPoInternalTraceability } from "../../lib/rmPoDocumentActions";
import { buildRmPoDetailHref } from "../../lib/rmPurchaseWoContinuity";
import type { RmPoTracePayload } from "../../lib/rmPoDocumentTrace";
import type { RmPoCompanyProfile } from "../../lib/rmPoSupplierDocument";
import {
  poOrderedReceivedPending,
  receivedForLine,
  type RmPoRow,
} from "./rmPurchaseShared";

export function RmPurchasePoTraceabilityPage() {
  const { poId: poIdParam } = useParams();
  const poId = Number(poIdParam);
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";

  const [po, setPo] = React.useState<RmPoRow | null>(null);
  const [poTrace, setPoTrace] = React.useState<RmPoTracePayload | null>(null);
  const [poTraceError, setPoTraceError] = React.useState<string | null>(null);
  const [companyProfile, setCompanyProfile] = React.useState<RmPoCompanyProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reversingGrnId, setReversingGrnId] = React.useState(0);

  const poHref = buildRmPoDetailHref(Number.isFinite(poId) && poId > 0 ? poId : 0);

  const load = React.useCallback(async () => {
    if (!Number.isFinite(poId) || poId <= 0) {
      setError("Invalid purchase order link.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [p, traceResult, profile] = await Promise.all([
        apiFetch<RmPoRow>(`/api/purchase/rm-pos/${poId}`),
        apiFetch<RmPoTracePayload>(`/api/procurement-trace/rm-po/${poId}`).catch((err: unknown) => ({
          error: err instanceof Error ? err.message : "Failed to load trace",
        })),
        apiFetch<RmPoCompanyProfile>("/api/company-profile").catch(() => null),
      ]);
      setPo(p);
      setCompanyProfile(profile);
      if (traceResult && "error" in traceResult) {
        setPoTrace(null);
        setPoTraceError(String(traceResult.error));
      } else {
        setPoTrace(traceResult as RmPoTracePayload);
        setPoTraceError(null);
      }
    } catch (e) {
      setPo(null);
      setError(e instanceof Error ? e.message : "Failed to load purchase order");
    } finally {
      setLoading(false);
    }
  }, [poId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function onReverseGrn(grnId: number) {
    const ok = window.confirm("Reverse this GRN? This will undo the stock receipt.");
    if (!ok) return;
    const reason = window.prompt("Reversal reason (required)") ?? "";
    if (!reason.trim()) {
      setError("Reversal reason is required");
      return;
    }
    setError(null);
    setReversingGrnId(grnId);
    try {
      await apiFetch(`/api/purchase/grns/${grnId}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reverse GRN");
    } finally {
      setReversingGrnId(0);
    }
  }

  const receiveInfo = po ? poOrderedReceivedPending(po) : null;
  const billingByLine = po?.billingSummary?.finalizedBilledQtyByPoLineId ?? {};
  const cancelledByLine = po?.billingSummary?.cancelledBilledQtyByPoLineId ?? {};
  const billingTotals = React.useMemo(() => {
    if (!po) return { billed: 0, pendingBilling: 0, rebillable: 0 };
    let billed = 0;
    let pendingBilling = 0;
    let rebillable = 0;
    for (const ln of po.lines) {
      const received = receivedForLine(po, ln.id);
      const billedLn = Number(billingByLine[ln.id] ?? 0);
      const cancelledLn = Number(cancelledByLine[ln.id] ?? 0);
      billed += billedLn;
      rebillable += cancelledLn;
      pendingBilling += Math.max(0, received - billedLn);
    }
    return { billed, pendingBilling, rebillable };
  }, [po, billingByLine, cancelledByLine]);

  const poPrimaryUnit = po?.lines[0]?.unit?.trim() ?? "";
  const stockStatusLabel =
    po?.status === "COMPLETED"
      ? "Fully Received"
      : po?.status === "PARTIAL"
        ? "Partially Received"
        : "Not Received";
  const billingStatusLabel =
    billingTotals.billed <= 1e-9
      ? "Not Started"
      : billingTotals.pendingBilling > 1e-9
        ? "In Progress"
        : "Completed";

  if (!Number.isFinite(poId) || poId <= 0) {
    return (
      <PageContainer>
        <StickyWorkspaceHead lead={<PageBackLink to="/rm-po-grn" label="Back to Material Planning" />} />
        <p className="text-sm text-red-700">Invalid purchase order link.</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer className="erp-txn-workspace space-y-1.5 pb-1">
      <StickyWorkspaceHead
        lead={<PageBackLink to={poHref} label="Back to RM Purchase Order" />}
        className="mb-0"
      />

      <div className="rm-po-no-print flex flex-wrap items-center justify-between gap-3 px-0.5">
        <p className="text-sm font-bold uppercase tracking-wide text-slate-700">Internal Procurement Traceability</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 text-sm"
            data-testid="rm-po-traceability-print-btn"
            onClick={() => printRmPoInternalTraceability()}
          >
            <Printer className="h-4 w-4" />
            Print / Save as PDF
          </Button>
          <Link
            to={poHref}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5 text-sm no-underline")}
            data-testid="rm-po-traceability-back-btn"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to RM PO
          </Link>
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-600">Loading…</p> : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-sm text-red-800">{error}</div>
      ) : null}

      {!loading && po ? (
        <RmPoInternalTraceabilityView
          po={po}
          companyProfile={companyProfile}
          trace={poTrace}
          traceError={poTraceError}
          receiveInfo={receiveInfo}
          billingTotals={billingTotals}
          poPrimaryUnit={poPrimaryUnit}
          stockStatusLabel={stockStatusLabel}
          billingStatusLabel={billingStatusLabel}
          isAdmin={isAdmin}
          reversingGrnId={reversingGrnId}
          onReverseGrn={(id) => void onReverseGrn(id)}
        />
      ) : null}

      {!loading && !po && !error ? <p className="text-sm text-slate-600">Purchase order not found.</p> : null}
    </PageContainer>
  );
}
