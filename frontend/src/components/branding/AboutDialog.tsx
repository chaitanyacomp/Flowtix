import * as React from "react";
import {
  BRAND_PRODUCT_NAME,
  BRAND_TAGLINE,
  BRAND_COMPANY_NAME,
  BRAND_COPYRIGHT,
  BRAND_SUPPORT_EMAIL,
  BRAND_WEBSITE,
  BRAND_LICENSE_LABEL,
  BrandBanner,
  CompanyLogo,
} from "./Branding";
import { Button } from "../ui/button";

type AboutDialogProps = {
  open: boolean;
  onClose: () => void;
  productVersion?: string | null;
};

/**
 * Release-facing About dialog — product identity only (no business logic).
 */
export function AboutDialog({ open, onClose, productVersion }: AboutDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flowtix-about-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center">
          <BrandBanner size="md" className="max-w-[240px]" />
        </div>
        <h2 id="flowtix-about-title" className="mt-4 text-center text-lg font-semibold text-slate-900">
          {BRAND_PRODUCT_NAME}
        </h2>
        <p className="mt-1 text-center text-sm text-slate-600">{BRAND_TAGLINE}</p>
        <dl className="mt-4 space-y-1.5 text-sm text-slate-700">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Version</dt>
            <dd className="font-medium">{productVersion || "1.0.0"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Vendor</dt>
            <dd className="font-medium text-right">{BRAND_COMPANY_NAME}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Support</dt>
            <dd className="font-medium text-right">{BRAND_SUPPORT_EMAIL}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Web</dt>
            <dd className="font-medium text-right break-all">{BRAND_WEBSITE}</dd>
          </div>
        </dl>
        <p className="mt-4 text-center text-xs text-slate-500">{BRAND_LICENSE_LABEL}</p>
        <p className="mt-1 text-center text-xs text-slate-500">{BRAND_COPYRIGHT}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <CompanyLogo size="xs" variant="transparent" alt="" className="opacity-60" />
          <span className="text-[11px] text-slate-500">Software by {BRAND_COMPANY_NAME}</span>
        </div>
        <div className="mt-5 flex justify-center">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
