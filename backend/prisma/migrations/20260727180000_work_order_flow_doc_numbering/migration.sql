-- Flow-wise Work Order document numbering (MySQL).
-- Independent DocSequence rows per flow + calendar year2.
-- Legacy WORK_ORDER (WO-YY-####) retained; existing WorkOrder.docNo values are not renumbered.

ALTER TABLE `DocSequence` MODIFY `docType` ENUM(
  'SALES_ORDER',
  'WORK_ORDER',
  'WORK_ORDER_REGULAR',
  'WORK_ORDER_NO_QTY',
  'WORK_ORDER_GREEN_LEVEL',
  'PRODUCTION_ENTRY',
  'QC_ENTRY',
  'DISPATCH',
  'SALES_BILL',
  'REQUIREMENT_SHEET',
  'MATERIAL_REQUIREMENT',
  'PURCHASE_REQUEST',
  'MATERIAL_ISSUE_NOTE',
  'MATERIAL_RETURN_NOTE',
  'MATERIAL_WASTAGE_NOTE',
  'PRODUCTION_MATERIAL_REQUEST',
  'BOM',
  'MONTHLY_PRODUCTION_PLAN'
) NOT NULL;
