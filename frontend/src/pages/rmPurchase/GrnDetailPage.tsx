import * as React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { PageContainer } from "../../components/PageHeader";
import { apiFetch } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";
import { GrnDocumentView } from "../../components/rmPurchase/GrnDocumentView";
import type { GrnCompanyProfile, GrnDocumentPayload } from "../../lib/grnDocument";
import { buildRmPoDetailHref } from "../../lib/rmPurchaseWoContinuity";

export function GrnDetailPage() {
  const { grnId: grnIdParam } = useParams();
  const grnId = Number(grnIdParam);
  const [searchParams] = useSearchParams();
  const isAdmin = useAuth().user?.role === "ADMIN";

  const [detail, setDetail] = React.useState<GrnDocumentPayload | null>(null);
  const [companyProfile, setCompanyProfile] = React.useState<GrnCompanyProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [reversing, setReversing] = React.useState(false);

  const load = React.useCallback(async () => {
    if (!Number.isFinite(grnId) || grnId <= 0) {
      setError("Invalid GRN id");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [doc, profile] = await Promise.all([
        apiFetch<GrnDocumentPayload>(`/api/purchase/grns/${grnId}`),
        apiFetch<GrnCompanyProfile>("/api/company-profile").catch(() => null),
      ]);
      setDetail(doc);
      setCompanyProfile(profile);
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : "Failed to load GRN");
    } finally {
      setLoading(false);
    }
  }, [grnId]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function onReverseGrn() {
    if (!detail) return;
    const ok = window.confirm("Reverse this GRN? This will undo the stock receipt.");
    if (!ok) return;
    const reason = window.prompt("Reversal reason (required)") ?? "";
    if (!reason.trim()) {
      setError("Reversal reason is required");
      return;
    }
    setError(null);
    setReversing(true);
    try {
      await apiFetch(`/api/purchase/grns/${detail.grn.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reverse GRN");
    } finally {
      setReversing(false);
    }
  }

  const returnTo = searchParams.get("returnTo") ?? "";
  const poHref =
    returnTo.startsWith("/") && returnTo.includes("/rm-po-grn/")
      ? returnTo
      : buildRmPoDetailHref(detail?.po.id ?? 0);

  return (
    <PageContainer>
      {loading ? <p className="text-sm text-slate-600">Loading GRN…</p> : null}
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {error}
        </p>
      ) : null}
      {!loading && detail ? (
        <GrnDocumentView
          detail={detail}
          companyProfile={companyProfile}
          poHref={poHref}
          isAdmin={isAdmin}
          reversing={reversing}
          onReverse={() => void onReverseGrn()}
        />
      ) : null}
      {!loading && !detail && !error ? <p className="text-sm text-slate-600">Goods receipt note not found.</p> : null}
    </PageContainer>
  );
}
