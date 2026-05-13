/**
 * REGULAR FLOW ONLY
 *
 * Flow:
 * Enquiry
 * → Quotation
 * → Regular Sales Order
 * → RM Check
 * → Work Order
 * → Production
 * → QC
 * → Dispatch
 * → Sales Bill
 *
 * This flow is:
 * - fixed quantity
 * - customer PO driven
 * - WO driven
 * - dispatch against SO qty
 *
 * DO NOT IMPORT:
 * - Requirement Sheet logic
 * - NO_QTY planning services
 * - cycle planning helpers
 * - carry-forward shortage logic
 * - NO_QTY dashboard widgets
 *
 * Canonical route: `/work-orders/prepare`. Implementation is shared with `RmCheckPage`
 * (same RM check / WO preparation APIs — no `/api/planning-dashboard` calls).
 */
import { RmCheckPage } from "./RmCheckPage";

export function RegularWorkOrderPlanningPage() {
  return <RmCheckPage />;
}
