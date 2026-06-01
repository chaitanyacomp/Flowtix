import * as React from "react";
import { cn } from "../../lib/utils";
import compactLogoSrc from "../../assets/branding/Compact-Logo.png";
import bannerLogoSrc from "../../assets/branding/Banner Logo.png";
import companyLogoSrc from "../../assets/branding/Company Logo.jpeg";

/**
 * Centralized FT ERP branding primitives.
 *
 * Brand hierarchy
 * ───────────────
 *   Company         — Chaitanya Computer Solutions (corporate identity)
 *   Product         — Flowtix ERP                  (full product brand)
 *   Operational ID  — FT ERP / FT                  (compact inside-app identity)
 *
 * Three distinct assets live under `assets/branding/`, each with a single
 * intended audience. This module is the single source of truth for which
 * asset / which wording is allowed in which surface — never import the raw
 * asset files directly from a page.
 *
 *   `Compact-Logo.png`   → operational (sidebar, topbar, favicon, watermark)
 *   `Banner Logo.png`    → product (login, splash, hero, marketing)
 *   `Company Logo.jpeg`  → company (footer, about, profile, print/PDF)
 *
 * The compact PNG bakes "ENQUIRY TO DISPATCH" under the mark; `BrandMark`
 * crops that tagline out via CSS so the mark stays clean at icon sizes.
 * The wide banner PNG does **not** carry the tagline — clean wordmark
 * only — so we never re-render it next to the banner on the login page.
 */

/* ────────────────────────────────────────────────────────────────────── */
/* Constants                                                              */
/* ────────────────────────────────────────────────────────────────────── */

/** Full product name. Use in tab title, login hero copy, marketing surfaces. */
export const BRAND_PRODUCT_NAME = "Flowtix ERP";

/** Sidebar wordmark — short operational form next to the compact "Ft" mark. */
export const BRAND_OPERATIONAL_LABEL = "FT ERP";

/** Single-letter / pair operational identity. Use sparingly (header divider). */
export const BRAND_OPERATIONAL_SHORT = "FT";

/** Corporate / software-vendor identity. Never replaces the product brand. */
export const BRAND_COMPANY_NAME = "Chaitanya Computer Solutions";

/**
 * Product tagline. Still baked into the compact PNG mark; the wide
 * banner asset no longer carries this line, so it is *only* used in
 * meta/description copy and the compact mark — never re-rendered as
 * a separate text element next to the banner on the login page.
 */
export const BRAND_TAGLINE = "Enquiry to Dispatch";

/** Short vendor attribution line used in footers / about surfaces. */
export const BRAND_COMPANY_ATTRIBUTION = `Software by ${BRAND_COMPANY_NAME}`;

/** Compact "Ft" identity asset (PNG, transparent). Operational surfaces only. */
export const BRAND_COMPACT_LOGO_SRC = compactLogoSrc;

/** Full "Flowtix ERP" banner (PNG, true alpha). Product surfaces only. */
export const BRAND_BANNER_LOGO_SRC = bannerLogoSrc;

/** Chaitanya Computer Solutions corporate logo (JPEG). Company surfaces only. */
export const BRAND_COMPANY_LOGO_SRC = companyLogoSrc;

/* ────────────────────────────────────────────────────────────────────── */
/* JPEG → transparent PNG chroma-key (Company Logo only)                  */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * The Company Logo asset ships as a JPEG with a light-gray plate
 * (#F7F7F7). On a coloured gradient surface (login footer), CSS
 * `mix-blend-mode: multiply` only darkens the plate — it can never erase
 * a light colour against a coloured-but-lighter background.
 *
 * To get truly transparent rendering we process the JPEG **once** at
 * module init via a canvas chroma-key:
 *   - sample the pixel
 *   - if it's near-neutral and bright (the plate), drop alpha to zero
 *   - if it's slightly tinted toward the plate, ramp alpha with the distance
 * Result is cached and exposed via a tiny subscription so React components
 * can pick the transparent URL up as soon as it's ready (with the original
 * JPEG as the immediate fallback).
 *
 * The Banner Logo no longer needs this — it ships as a true-alpha PNG.
 */

type ChromaResult = { transparentSrc: string | null };

function makeChromaSlot(
  srcUrl: string,
  plateGray: number,
): ChromaResult & {
  subscribe: (cb: () => void) => () => void;
  start: () => void;
} {
  const slot: ChromaResult = { transparentSrc: null };
  const subscribers = new Set<() => void>();
  let started = false;

  const start = () => {
    if (started) return;
    started = true;
    if (
      typeof window === "undefined" ||
      typeof Image === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const px = imageData.data;
        // Chroma-key tuned for the shipped plate colour. We mask any
        // near-neutral pixel bright enough to be plate, and ramp alpha by
        // distance from the plate so anti-aliased mark edges stay smooth.
        const PLATE_FLOOR = plateGray - 18; // start fading
        const PLATE_FULL = plateGray - 4; // fully transparent
        const NEUTRAL_TOL = 14; // |max-min| must be small (near-gray)
        for (let i = 0; i < px.length; i += 4) {
          const r = px[i];
          const g = px[i + 1];
          const b = px[i + 2];
          const minC = r < g ? (r < b ? r : b) : g < b ? g : b;
          const maxC = r > g ? (r > b ? r : b) : g > b ? g : b;
          if (maxC - minC > NEUTRAL_TOL) continue;
          if (minC < PLATE_FLOOR) continue;
          if (minC >= PLATE_FULL) {
            px[i + 3] = 0;
          } else {
            const t = (minC - PLATE_FLOOR) / (PLATE_FULL - PLATE_FLOOR);
            px[i + 3] = Math.max(0, Math.round(px[i + 3] * (1 - t)));
          }
        }
        ctx.putImageData(imageData, 0, 0);
        slot.transparentSrc = canvas.toDataURL("image/png");
        subscribers.forEach((cb) => cb());
      } catch {
        /* fall back silently to the original JPEG */
      }
    };
    img.onerror = () => {
      /* fall back silently */
    };
    img.src = srcUrl;
  };

  return {
    get transparentSrc() {
      return slot.transparentSrc;
    },
    subscribe: (cb) => {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
    start,
  };
}

const companyChromaSlot = makeChromaSlot(BRAND_COMPANY_LOGO_SRC, 247);

if (typeof window !== "undefined") {
  // Kick processing immediately so the footer never flashes the plate.
  companyChromaSlot.start();
}

function useChromaSrc(
  slot: typeof companyChromaSlot,
  fallback: string,
  enabled: boolean,
): string {
  const [src, setSrc] = React.useState<string>(slot.transparentSrc ?? fallback);
  React.useEffect(() => {
    if (!enabled) return;
    slot.start();
    if (slot.transparentSrc) {
      setSrc(slot.transparentSrc);
      return;
    }
    const unsubscribe = slot.subscribe(() => {
      if (slot.transparentSrc) setSrc(slot.transparentSrc);
    });
    return unsubscribe;
  }, [slot, enabled]);
  return enabled ? src : fallback;
}

/** Backwards-compat alias: existing call sites referring to `BRAND_NAME`. */
export const BRAND_NAME = BRAND_OPERATIONAL_LABEL;

/** Combined product + tagline. */
export const BRAND_PRODUCT_FULL_NAME = `${BRAND_PRODUCT_NAME} — ${BRAND_TAGLINE}`;

/** Legacy alias kept for any external imports referencing the source path. */
export const BRAND_LOGO_SRC = BRAND_COMPACT_LOGO_SRC;

/* ────────────────────────────────────────────────────────────────────── */
/* Compact "Ft" mark (operational identity)                               */
/* ────────────────────────────────────────────────────────────────────── */

type BrandMarkSize = "xs" | "sm" | "md" | "lg" | "xl";

const MARK_SIZE_CLASSES: Record<BrandMarkSize, string> = {
  xs: "h-5 w-5",
  sm: "h-6 w-6",
  md: "h-7 w-7",
  lg: "h-10 w-10",
  xl: "h-16 w-16",
};

export interface BrandMarkProps {
  /** Predefined sizing token — use a numeric `size` for fully custom sizes. */
  size?: BrandMarkSize;
  className?: string;
  /** Accessible label; pass `""` to render purely decorative. */
  alt?: string;
  /** When `true`, decorative usage (defaults `alt` to "" and hides from AT). */
  decorative?: boolean;
}

/**
 * Compact "Ft" mark only — crops the baked tagline out of the source PNG via
 * CSS, so it stays clean in tight surfaces (favicon, sidebar header collapsed
 * rail, topbar). Width and height are kept square.
 *
 * **Use for operational surfaces only** (sidebar, topbar, watermark, favicon).
 * Never use this in login / hero / company-identity surfaces — use
 * `BrandBanner` (product) or `CompanyLogo` (company) instead.
 */
export const BrandMark = React.forwardRef<HTMLSpanElement, BrandMarkProps>(
  function BrandMark({ size = "sm", className, alt, decorative }, ref) {
    const isDecorative = decorative === true || alt === "";
    const resolvedAlt = isDecorative ? "" : alt ?? `${BRAND_OPERATIONAL_LABEL} logo`;
    return (
      <span
        ref={ref}
        className={cn("erp-brand-mark", MARK_SIZE_CLASSES[size], className)}
        aria-hidden={isDecorative ? true : undefined}
      >
        <img
          src={BRAND_COMPACT_LOGO_SRC}
          alt={resolvedAlt}
          draggable={false}
          loading="eager"
          decoding="async"
        />
      </span>
    );
  },
);

/* ────────────────────────────────────────────────────────────────────── */
/* Sidebar / header lockup (operational identity, horizontal)             */
/* ────────────────────────────────────────────────────────────────────── */

export interface BrandLogoProps {
  /** Sidebar header sizing. `compact` is denser for the sidebar row. */
  size?: "compact" | "default";
  className?: string;
  /** Wordmark text. Defaults to the operational "FT ERP" label. */
  label?: string;
  /** Optional tagline shown below the wordmark (login / splash usage). */
  tagline?: string | null;
}

/**
 * Horizontal lockup: compact "Ft" mark + "FT ERP" wordmark. Used in the
 * sidebar header (expanded) and the dashboard topbar. **Operational only** —
 * do not use this for login or marketing.
 */
export function BrandLogo({
  size = "default",
  className,
  label = BRAND_OPERATIONAL_LABEL,
  tagline = null,
}: BrandLogoProps) {
  const markSize: BrandMarkSize = size === "compact" ? "sm" : "md";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <BrandMark size={markSize} decorative />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[13px] font-semibold tracking-tight text-slate-900">
          {label}
        </span>
        {tagline ? (
          <span className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">
            {tagline}
          </span>
        ) : null}
      </span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Banner Logo (product identity, wide)                                   */
/* ────────────────────────────────────────────────────────────────────── */

export interface BrandBannerProps {
  className?: string;
  /** Visual width tokens — keep responsive and never larger than `xl`. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Accessible label. Pass `""` for decorative. */
  alt?: string;
  /**
   * Visual treatment.
   * - `plate` (default): soft rounded panel for marketing/print surfaces
   *   where a card-style frame reads cleanly.
   * - `transparent`: no frame, no background. The shipped asset is a
   *   true-alpha PNG, so it composites cleanly over any surface — used
   *   for the login hero, splash, and other operational SaaS surfaces.
   */
  variant?: "plate" | "transparent";
}

const BANNER_SIZE_CLASSES: Record<NonNullable<BrandBannerProps["size"]>, string> = {
  sm: "max-w-[180px]",
  md: "max-w-[260px]",
  lg: "max-w-[340px]",
  xl: "max-w-[420px]",
};

/**
 * Flowtix ERP product banner (Banner Logo.png — true-alpha PNG) — used
 * for login, splash, and any marketing/hero surface. The default `plate`
 * variant wraps the image in a soft rounded panel; the `transparent`
 * variant drops the frame entirely so the banner reads as a clean
 * floating mark against the surrounding background.
 *
 * **Product surfaces only.** Never use this in the sidebar/topbar — the
 * operational surfaces use `BrandMark`/`BrandLogo` to stay compact.
 */
export function BrandBanner({
  className,
  size = "lg",
  alt = BRAND_PRODUCT_NAME,
  variant = "plate",
}: BrandBannerProps) {
  const isTransparent = variant === "transparent";
  return (
    <span
      className={cn(
        "erp-brand-banner inline-flex w-full select-none items-center justify-center",
        isTransparent && "erp-brand-banner--transparent",
        BANNER_SIZE_CLASSES[size],
        className,
      )}
    >
      <img
        src={BRAND_BANNER_LOGO_SRC}
        alt={alt}
        draggable={false}
        loading="eager"
        decoding="async"
        className="h-auto w-full"
      />
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Company Logo (corporate identity, square)                              */
/* ────────────────────────────────────────────────────────────────────── */

export interface CompanyLogoProps {
  className?: string;
  /** Visual size tokens. Keep small — corporate identity is supportive only. */
  size?: "xs" | "sm" | "md" | "lg";
  alt?: string;
  /**
   * Visual treatment.
   * - `plate` (default): soft rounded card matching the JPEG's plate color.
   * - `transparent`: drop the frame and blend the plate into the surrounding
   *   light surface via `mix-blend-mode: multiply`. Use for very subtle
   *   footer / inline attributions.
   */
  variant?: "plate" | "transparent";
}

const COMPANY_SIZE_CLASSES: Record<NonNullable<CompanyLogoProps["size"]>, string> = {
  xs: "h-5 w-5",
  sm: "h-7 w-7",
  md: "h-10 w-10",
  lg: "h-16 w-16",
};

/**
 * Chaitanya Computer Solutions corporate logo. **Use only on company /
 * footer / about / print surfaces**, never in the operational workspace.
 * The default `plate` variant wraps the image in a soft rounded card; the
 * `transparent` variant drops the frame so the corporate mark reads as a
 * subtle inline glyph next to "Powered by …" text.
 */
export function CompanyLogo({
  className,
  size = "sm",
  alt = `${BRAND_COMPANY_NAME} logo`,
  variant = "plate",
}: CompanyLogoProps) {
  const isTransparent = variant === "transparent";
  const src = useChromaSrc(companyChromaSlot, BRAND_COMPANY_LOGO_SRC, isTransparent);
  return (
    <span
      className={cn(
        "erp-company-logo inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-md",
        isTransparent && "erp-company-logo--transparent",
        COMPANY_SIZE_CLASSES[size],
        className,
      )}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-contain"
      />
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Company attribution line (vendor footer)                               */
/* ────────────────────────────────────────────────────────────────────── */

export interface CompanyAttributionProps {
  className?: string;
  /** When `true`, hide the small company logo and show plain text only. */
  textOnly?: boolean;
  /** Override the default "Software by …" wording. */
  label?: string;
}

/**
 * Slim "Software by Chaitanya Computer Solutions" attribution row, used in
 * the login footer and any company-identity surface. Keeps the corporate
 * brand visible without competing with the product brand.
 */
export function CompanyAttribution({
  className,
  textOnly,
  label = BRAND_COMPANY_ATTRIBUTION,
}: CompanyAttributionProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium leading-snug text-slate-500",
        className,
      )}
    >
      {textOnly ? null : <CompanyLogo size="xs" alt="" />}
      <span className="truncate">{label}</span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Branded full-surface splash / Suspense fallback                        */
/* ────────────────────────────────────────────────────────────────────── */

export interface BrandSplashProps {
  /** Optional sub-label rendered under the tagline (e.g. "Loading…"). */
  hint?: string;
  className?: string;
}

/**
 * Branded full-surface splash. Uses the **product banner** to match the
 * login hero, plus an indeterminate brand bar. Subtle by design — no
 * spinners or large logos that compete with the product identity.
 */
export function BrandSplash({ hint, className }: BrandSplashProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "erp-brand-splash flex min-h-[60vh] w-full items-center justify-center px-4 py-10",
        className,
      )}
    >
      <div className="erp-brand-fade-in flex flex-col items-center gap-3 text-center">
        <BrandBanner size="lg" variant="transparent" />
        <div className="erp-brand-splash-bar" aria-hidden />
        {hint ? (
          <span className="text-xs font-medium text-slate-500">{hint}</span>
        ) : (
          <span className="sr-only">Loading {BRAND_PRODUCT_NAME}</span>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/* Document identity bootstrap                                            */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Sets `document.title` and the favicon link to the FT ERP brand.
 *
 * The shipped compact asset bakes the tagline below the "Ft" mark, which
 * would become unreadable noise at favicon sizes (16/32 px). We crop the
 * bottom tagline strip onto a square canvas before pointing the favicon at
 * the generated data URL — same visual logic as `BrandMark`, baked into a
 * raster favicon at startup. Safe no-op outside the browser.
 */
export function applyBrandIdentity(): void {
  if (typeof document === "undefined") return;
  try {
    document.title = BRAND_PRODUCT_NAME;
  } catch {
    /* ignore */
  }

  const ensureLink = (rel: string): HTMLLinkElement => {
    let link = document.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      document.head.appendChild(link);
    }
    return link;
  };

  const fallbackLink = ensureLink("icon");
  fallbackLink.type = "image/png";
  fallbackLink.href = BRAND_COMPACT_LOGO_SRC;

  if (typeof Image === "undefined" || typeof document.createElement !== "function") {
    return;
  }

  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      const target = 64;
      canvas.width = target;
      canvas.height = target;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const sW = img.width;
      // Top ~78% of source contains the "Ft" mark; the rest is the baked tagline.
      const sH = Math.max(1, Math.round(img.height * 0.78));
      const scale = target / sW;
      const dW = target;
      const dH = sH * scale;
      const dY = Math.max(0, (target - dH) / 2);
      ctx.clearRect(0, 0, target, target);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, sW, sH, 0, dY, dW, dH);
      const dataUrl = canvas.toDataURL("image/png");
      const link = ensureLink("icon");
      link.type = "image/png";
      link.href = dataUrl;

      const apple = ensureLink("apple-touch-icon");
      apple.type = "image/png";
      apple.href = dataUrl;
    } catch {
      /* fall back silently to the uncropped PNG already set above */
    }
  };
  img.onerror = () => {
    /* keep uncropped fallback */
  };
  img.src = BRAND_COMPACT_LOGO_SRC;
}
