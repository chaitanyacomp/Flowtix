/**
 * Phase 1 ERP UI foundation — class-name tokens aligned with `src/style.css`
 * (`@layer components` / `:root` ERP variables).
 *
 * Use these for programmatic `className` composition. Prefer the React
 * primitives in `components/erp/foundation/*` for common layouts.
 */
export const erpTypography = {
  pageTitle: "erp-type-page-title",
  sectionTitle: "erp-type-section-title",
  subsectionTitle: "erp-type-subsection-title",
  workflowLabel: "erp-type-workflow-label",
  tableBody: "erp-type-table-body",
  helper: "erp-type-helper",
  kpiValue: "erp-type-kpi-value",
  kpiLabel: "erp-type-kpi-label",
  actionButton: "erp-type-action-button",
} as const;

export const erpSpacing = {
  pageTop: "erp-space-page-top",
  sectionY: "erp-space-section-y",
  cardPadding: "erp-space-card-padding",
  formGap: "erp-space-form-gap",
  tableCell: "erp-space-table-cell",
  workflowStrip: "erp-space-workflow-strip",
} as const;

export const erpKpi = {
  strip: "erp-kpi-strip",
  stripCompact: "erp-kpi-strip erp-kpi-strip--compact",
  segment: "erp-kpi-segment",
  label: "erp-kpi-label",
  value: "erp-kpi-value",
  valueMuted: "erp-kpi-value-muted",
  valueWarn: "erp-kpi-value-warn",
  valueCrit: "erp-kpi-value-crit",
} as const;

export const erpTable = {
  wrap: "erp-table-wrap",
  standard: "erp-table",
  /** Operator queue tables (QC batch picker, etc.) */
  queue: "erp-table erp-table-queue",
  numericCell: "erp-table-num",
  actionCell: "erp-table-action-col",
  /** Flex row for right-aligned workflow buttons in a table cell */
  actions: "erp-table-actions",
  /** Text link CTA inside action column (e.g. Create Sales Bill) */
  actLink: "erp-table-act erp-table-act--link",
} as const;

export const erpForm = {
  stack: "erp-form",
  field: "erp-form-field",
  label: "erp-form-label",
} as const;

export const erpSection = {
  card: "erp-section-card",
  cardHeader: "erp-section-card-header",
  cardBody: "erp-section-card-body",
} as const;

export const erpWorkflow = {
  banner: "erp-workflow-banner",
} as const;

export type ErpActionTier = "primary" | "secondary" | "tertiary" | "danger";

export { resolveErpStatusTone, formatErpStatusLabel, erpStatusToneToBadgeVariant } from "./erpStatusTone";
export type { ErpStatusTone } from "./erpStatusTone";
