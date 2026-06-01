import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { PageContainer, PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { apiFetch, getApiUrl, ApiRequestError } from "../services/api";
import { useToast } from "../contexts/ToastContext";
import { useIsAdmin } from "../hooks/useIsAdmin";
import { Navigate } from "react-router-dom";
import { Upload, Trash2, ImageOff } from "lucide-react";
import {
  CompanyLogo,
  BRAND_COMPANY_NAME,
  BRAND_PRODUCT_NAME,
  BRAND_TAGLINE,
} from "../components/branding/Branding";

type StateRow = { id: number; stateName: string; stateCode: string };

type CompanyProfile = {
  companyName: string | null;
  companyAddressLine1: string | null;
  companyAddressLine2: string | null;
  companyCity: string | null;
  companyState: string | null;
  companyStateId: number | null;
  companyStateName: string | null;
  companyStateCode: string | null;
  companyPincode: string | null;
  companyGstin: string | null;
  companyPan: string | null;
  companyMobile: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companySignatoryName: string | null;
  hasLogo: boolean;
  hasSignature: boolean;
  logoMime: string | null;
  signatureMime: string | null;
};

const EMPTY_PROFILE: CompanyProfile = {
  companyName: null,
  companyAddressLine1: null,
  companyAddressLine2: null,
  companyCity: null,
  companyState: null,
  companyStateId: null,
  companyStateName: null,
  companyStateCode: null,
  companyPincode: null,
  companyGstin: null,
  companyPan: null,
  companyMobile: null,
  companyPhone: null,
  companyEmail: null,
  companyWebsite: null,
  companySignatoryName: null,
  hasLogo: false,
  hasSignature: false,
  logoMime: null,
  signatureMime: null,
};

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const SIGNATURE_MAX_BYTES = 1 * 1024 * 1024;
const LOGO_ACCEPT_MIME = ["image/png", "image/jpeg", "image/jpg", "image/svg+xml"];
const SIGNATURE_ACCEPT_MIME = ["image/png", "image/jpeg", "image/jpg"];

function buildAssetUrl(kind: "logo" | "signature", bust: number): string {
  return `${getApiUrl(`/api/company-profile/${kind}/file`)}${bust ? `?v=${bust}` : ""}`;
}

function bytesToHuman(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

/* ------------------------- Auth-aware asset image ------------------------ */
/**
 * The branding asset endpoints require `Authorization: Bearer …`, which a raw
 * `<img src>` can't send. So we fetch the asset as a blob (with auth) and
 * render the resulting object URL.
 */
function useAuthedAsset(kind: "logo" | "signature", token: string, present: boolean, bust: number) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!present) {
      setUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setError(null);
    fetch(buildAssetUrl(kind, bust), {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load ${kind} (${r.status})`);
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load image");
        setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [kind, token, present, bust]);

  return { url, error };
}

/* --------------------------------- Page --------------------------------- */

export function CompanyProfilePage() {
  const toast = useToast();
  const isAdmin = useIsAdmin();
  const token = React.useMemo(() => localStorage.getItem("token") || "", []);

  const [profile, setProfile] = React.useState<CompanyProfile>(EMPTY_PROFILE);
  const [states, setStates] = React.useState<StateRow[]>([]);
  const [assetBust, setAssetBust] = React.useState<number>(0);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [uploadingLogo, setUploadingLogo] = React.useState(false);
  const [uploadingSign, setUploadingSign] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const logoInputRef = React.useRef<HTMLInputElement | null>(null);
  const signInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setError(null);
    setLoading(true);
    Promise.all([apiFetch<CompanyProfile>("/api/company-profile"), apiFetch<StateRow[]>("/api/states")])
      .then(([p, st]) => {
        setProfile(p);
        setStates(st);
        setAssetBust(Date.now());
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to load company profile";
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  if (!isAdmin) return <Navigate to="/" replace />;

  function patch<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setProfile((prev) => ({ ...prev, [key]: value }));
  }

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const body = {
        companyName: profile.companyName?.trim() || null,
        companyAddressLine1: profile.companyAddressLine1?.trim() || null,
        companyAddressLine2: profile.companyAddressLine2?.trim() || null,
        companyCity: profile.companyCity?.trim() || null,
        companyStateId: profile.companyStateId,
        companyPincode: profile.companyPincode?.trim() || null,
        companyGstin: profile.companyGstin?.trim() ? profile.companyGstin.trim().toUpperCase() : null,
        companyPan: profile.companyPan?.trim() ? profile.companyPan.trim().toUpperCase() : null,
        companyMobile: profile.companyMobile?.trim() || null,
        companyPhone: profile.companyPhone?.trim() || null,
        companyEmail: profile.companyEmail?.trim() || null,
        companyWebsite: profile.companyWebsite?.trim() || null,
        companySignatoryName: profile.companySignatoryName?.trim() || null,
      };
      const saved = await apiFetch<CompanyProfile>("/api/company-profile", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setProfile(saved);
      toast.showSuccess("Company profile saved");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setSaving(false);
    }
  }

  function validateFile(file: File, kind: "logo" | "signature"): string | null {
    const allowed = kind === "logo" ? LOGO_ACCEPT_MIME : SIGNATURE_ACCEPT_MIME;
    const maxBytes = kind === "logo" ? LOGO_MAX_BYTES : SIGNATURE_MAX_BYTES;
    if (!allowed.includes(file.type)) {
      return `Unsupported ${kind} format. Use ${kind === "logo" ? "PNG, JPG, or SVG" : "PNG or JPG"}.`;
    }
    if (file.size > maxBytes) {
      return `${kind === "logo" ? "Logo" : "Signature"} file is too large (max ${
        kind === "logo" ? "2 MB" : "1 MB"
      }).`;
    }
    return null;
  }

  async function uploadAsset(kind: "logo" | "signature", file: File) {
    const setBusy = kind === "logo" ? setUploadingLogo : setUploadingSign;
    setBusy(true);
    setError(null);
    try {
      const validation = validateFile(file, kind);
      if (validation) {
        throw new ApiRequestError(validation, 400);
      }
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(getApiUrl(`/api/company-profile/${kind}`), {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `${kind === "logo" ? "Logo" : "Signature"} upload failed (${res.status})`;
        throw new ApiRequestError(msg, res.status);
      }
      setProfile(data as CompanyProfile);
      setAssetBust(Date.now());
      toast.showSuccess(`${kind === "logo" ? "Logo" : "Signature"} uploaded`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setBusy(false);
      // Reset input so re-uploading the same file works.
      const ref = kind === "logo" ? logoInputRef : signInputRef;
      if (ref.current) ref.current.value = "";
    }
  }

  async function removeAsset(kind: "logo" | "signature") {
    const setBusy = kind === "logo" ? setUploadingLogo : setUploadingSign;
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<CompanyProfile>(`/api/company-profile/${kind}`, { method: "DELETE" });
      setProfile(saved);
      setAssetBust(Date.now());
      toast.showSuccess(`${kind === "logo" ? "Logo" : "Signature"} removed`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Remove failed";
      setError(msg);
      toast.showError(msg);
    } finally {
      setBusy(false);
    }
  }

  const logoAsset = useAuthedAsset("logo", token, profile.hasLogo, assetBust);
  const signAsset = useAuthedAsset("signature", token, profile.hasSignature, assetBust);

  const stateLabel = profile.companyStateId
    ? states.find((s) => s.id === profile.companyStateId)
      ? `${states.find((s) => s.id === profile.companyStateId)!.stateName} (${
          states.find((s) => s.id === profile.companyStateId)!.stateCode
        })`
      : profile.companyStateName || profile.companyState
    : profile.companyStateName || profile.companyState;

  return (
    <PageContainer>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <PageHeader title="Company Profile" />
        <p className="text-[12px] text-slate-600">
          Drives branding on every document: Quotation, Sales Bill, Purchase Bill, future exports.
        </p>
      </div>

      {/* Vendor identity — Chaitanya Computer Solutions remains the software
          provider while Flowtix ERP stays the product brand. Tasteful badge,
          kept compact so it never competes with the customer's own branding. */}
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-200/80 bg-white px-3 py-2 shadow-[0_1px_2px_0_rgb(15_23_42_/0.04)]">
        <CompanyLogo size="md" />
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Software by
          </span>
          <span className="truncate text-[13px] font-semibold tracking-tight text-slate-900">
            {BRAND_COMPANY_NAME}
          </span>
          <span className="truncate text-[11px] text-slate-500">
            {BRAND_PRODUCT_NAME} · {BRAND_TAGLINE}
          </span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start">
        {/* ============ LEFT: form ============ */}
        <div className="flex h-full min-w-0 flex-col gap-3">
          {/* Identity */}
          <Card className="min-w-0 border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Company Identity</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Company Name</span>
                <Input
                  className="h-9"
                  value={profile.companyName ?? ""}
                  onChange={(e) => patch("companyName", e.target.value)}
                  placeholder="e.g. DankelTek Engineering Pvt Ltd"
                  disabled={loading}
                  maxLength={160}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">GSTIN</span>
                <Input
                  className="h-9 font-mono"
                  value={profile.companyGstin ?? ""}
                  onChange={(e) => patch("companyGstin", e.target.value.toUpperCase())}
                  placeholder="15-char GSTIN"
                  disabled={loading}
                  maxLength={15}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">PAN (optional)</span>
                <Input
                  className="h-9 font-mono"
                  value={profile.companyPan ?? ""}
                  onChange={(e) => patch("companyPan", e.target.value.toUpperCase())}
                  placeholder="10-char PAN"
                  disabled={loading}
                  maxLength={10}
                />
              </label>
            </CardContent>
          </Card>

          {/* Address */}
          <Card className="min-w-0 border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Registered Address</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Address Line 1</span>
                <Input
                  className="h-9"
                  value={profile.companyAddressLine1 ?? ""}
                  onChange={(e) => patch("companyAddressLine1", e.target.value)}
                  placeholder="Plot / Street / Building"
                  disabled={loading}
                  maxLength={160}
                />
              </label>
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Address Line 2</span>
                <Input
                  className="h-9"
                  value={profile.companyAddressLine2 ?? ""}
                  onChange={(e) => patch("companyAddressLine2", e.target.value)}
                  placeholder="Area / Industrial Estate / MIDC"
                  disabled={loading}
                  maxLength={160}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">City</span>
                <Input
                  className="h-9"
                  value={profile.companyCity ?? ""}
                  onChange={(e) => patch("companyCity", e.target.value)}
                  disabled={loading}
                  maxLength={96}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">PIN Code</span>
                <Input
                  className="h-9 font-mono"
                  value={profile.companyPincode ?? ""}
                  onChange={(e) => patch("companyPincode", e.target.value)}
                  placeholder="6 digits"
                  disabled={loading}
                  maxLength={12}
                />
              </label>
              <label className="grid gap-1 sm:col-span-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">State</span>
                <NativeSelect
                  className="h-9"
                  value={profile.companyStateId ?? ""}
                  onChange={(e) =>
                    patch("companyStateId", e.target.value === "" ? null : Number(e.target.value))
                  }
                  disabled={loading}
                >
                  <option value="">Select state</option>
                  {states.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.stateName} ({s.stateCode})
                    </option>
                  ))}
                </NativeSelect>
              </label>
            </CardContent>
          </Card>

          {/* Contact */}
          <Card className="min-w-0 border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Contact</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Mobile</span>
                <Input
                  className="h-9"
                  value={profile.companyMobile ?? ""}
                  onChange={(e) => patch("companyMobile", e.target.value)}
                  placeholder="+91 …"
                  disabled={loading}
                  maxLength={32}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Phone</span>
                <Input
                  className="h-9"
                  value={profile.companyPhone ?? ""}
                  onChange={(e) => patch("companyPhone", e.target.value)}
                  placeholder="Landline"
                  disabled={loading}
                  maxLength={32}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Email</span>
                <Input
                  type="email"
                  className="h-9"
                  value={profile.companyEmail ?? ""}
                  onChange={(e) => patch("companyEmail", e.target.value)}
                  placeholder="sales@example.com"
                  disabled={loading}
                  maxLength={160}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Website</span>
                <Input
                  className="h-9"
                  value={profile.companyWebsite ?? ""}
                  onChange={(e) => patch("companyWebsite", e.target.value)}
                  placeholder="example.com"
                  disabled={loading}
                  maxLength={160}
                />
              </label>
            </CardContent>
          </Card>

          {/* Branding uploads */}
          <Card className="min-w-0 border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Branding</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* Logo */}
              <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50/40 p-2.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Company Logo</div>
                <div className="flex h-24 items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-white">
                  {logoAsset.url ? (
                    <img
                      src={logoAsset.url}
                      alt="Company logo"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-[11px] text-slate-500">
                      <ImageOff className="h-5 w-5 opacity-60" />
                      <span>No logo uploaded</span>
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept={LOGO_ACCEPT_MIME.join(",")}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadAsset("logo", f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => logoInputRef.current?.click()}
                    disabled={uploadingLogo || loading}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {profile.hasLogo ? "Replace" : "Upload"}
                  </Button>
                  {profile.hasLogo ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeAsset("logo")}
                      disabled={uploadingLogo || loading}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="text-[11px] leading-snug text-slate-500">
                  PNG / JPG / SVG · max {bytesToHuman(LOGO_MAX_BYTES)} · landscape recommended,
                  transparent PNG preferred (≥300px wide).
                </div>
                {logoAsset.error ? (
                  <div className="text-[11px] text-red-700">{logoAsset.error}</div>
                ) : null}
              </div>

              {/* Signature */}
              <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50/40 p-2.5">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Authorised Signatory
                </div>
                <label className="grid gap-1">
                  <span className="text-[11px] text-slate-500">Signatory Name</span>
                  <Input
                    className="h-9"
                    value={profile.companySignatoryName ?? ""}
                    onChange={(e) => patch("companySignatoryName", e.target.value)}
                    placeholder="e.g. Rakesh Iyer (Director)"
                    disabled={loading}
                    maxLength={160}
                  />
                </label>
                <div className="flex h-16 items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-white">
                  {signAsset.url ? (
                    <img
                      src={signAsset.url}
                      alt="Signature"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-[11px] text-slate-500">No signature image (optional)</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={signInputRef}
                    type="file"
                    accept={SIGNATURE_ACCEPT_MIME.join(",")}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadAsset("signature", f);
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => signInputRef.current?.click()}
                    disabled={uploadingSign || loading}
                  >
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {profile.hasSignature ? "Replace" : "Upload"}
                  </Button>
                  {profile.hasSignature ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void removeAsset("signature")}
                      disabled={uploadingSign || loading}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="text-[11px] leading-snug text-slate-500">
                  PNG / JPG · max {bytesToHuman(SIGNATURE_MAX_BYTES)} · transparent PNG with dark
                  signature preferred.
                </div>
                {signAsset.error ? (
                  <div className="text-[11px] text-red-700">{signAsset.error}</div>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" onClick={() => void onSave()} disabled={loading || saving}>
              {saving ? "Saving…" : "Save Company Profile"}
            </Button>
          </div>
        </div>

        {/* ============ RIGHT: live preview ============ */}
        <div className="flex h-full min-w-0 flex-col gap-3">
          <Card className="flex h-full min-w-0 flex-col border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Document Header Preview</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-3">
              <p className="text-[12px] leading-snug text-slate-600">
                Approximate preview of how the quotation header will render. Same data also drives
                Sales Bill, Purchase Bill, and future document exports.
              </p>
              <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-slate-50/60">
                    {logoAsset.url ? (
                      <img
                        src={logoAsset.url}
                        alt="Company logo preview"
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-slate-400">No logo</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="truncate text-[13px] font-semibold text-slate-900">
                      {profile.companyName?.trim() || "Your Company Name"}
                    </div>
                    {profile.companyAddressLine1?.trim() ? (
                      <div className="text-[11px] text-slate-600">{profile.companyAddressLine1}</div>
                    ) : null}
                    {profile.companyAddressLine2?.trim() ? (
                      <div className="text-[11px] text-slate-600">{profile.companyAddressLine2}</div>
                    ) : null}
                    {profile.companyCity || stateLabel || profile.companyPincode ? (
                      <div className="text-[11px] text-slate-600">
                        {[profile.companyCity?.trim(), stateLabel, profile.companyPincode?.trim()]
                          .filter(Boolean)
                          .join(", ")}
                      </div>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-slate-500">
                      {profile.companyGstin?.trim() ? (
                        <span>GSTIN: {profile.companyGstin}</span>
                      ) : null}
                      {profile.companyPan?.trim() ? <span>PAN: {profile.companyPan}</span> : null}
                      {profile.companyMobile?.trim() || profile.companyPhone?.trim() ? (
                        <span>
                          Tel:{" "}
                          {[profile.companyMobile?.trim(), profile.companyPhone?.trim()]
                            .filter(Boolean)
                            .join(" / ")}
                        </span>
                      ) : null}
                      {profile.companyEmail?.trim() ? <span>Email: {profile.companyEmail}</span> : null}
                      {profile.companyWebsite?.trim() ? <span>{profile.companyWebsite}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-center border-t border-slate-200 pt-3">
                  <div className="rounded-md bg-slate-900 px-4 py-1 text-[12px] font-semibold tracking-widest text-white">
                    QUOTATION
                  </div>
                </div>
              </div>

              <div className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  Signature Block Preview
                </div>
                <div className="mt-2 flex items-end justify-end gap-2">
                  <div className="min-w-0 flex flex-col items-end gap-1">
                    <div className="text-[10.5px] text-slate-500">
                      For {profile.companyName?.trim() || "Your Company Name"}
                    </div>
                    <div className="flex h-12 w-32 items-center justify-center overflow-hidden rounded-md border border-dashed border-slate-300 bg-slate-50/60">
                      {signAsset.url ? (
                        <img
                          src={signAsset.url}
                          alt="Signature preview"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <span className="text-[10px] text-slate-400">Signature & stamp</span>
                      )}
                    </div>
                    {profile.companySignatoryName?.trim() ? (
                      <div className="text-[12px] font-semibold text-slate-900">
                        {profile.companySignatoryName}
                      </div>
                    ) : null}
                    <div className="text-[10.5px] text-slate-500">Authorised Signatory</div>
                  </div>
                </div>
              </div>

              <p className="text-[11px] leading-snug text-slate-500">
                Tip: keep your logo landscape and ≥300 px wide so it stays crisp on A4 PDF. Use a
                transparent PNG for best rendering across light/dark document backgrounds.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageContainer>
  );
}
