-- Phase 3D — Material Return Note (MRN): production → store RM return

ALTER TABLE `DocSequence` MODIFY `docType` ENUM(
  'SALES_ORDER',
  'WORK_ORDER',
  'PRODUCTION_ENTRY',
  'QC_ENTRY',
  'DISPATCH',
  'SALES_BILL',
  'REQUIREMENT_SHEET',
  'MATERIAL_REQUIREMENT',
  'PURCHASE_REQUEST',
  'MATERIAL_ISSUE_NOTE',
  'MATERIAL_RETURN_NOTE',
  'PRODUCTION_MATERIAL_REQUEST',
  'BOM'
) NOT NULL;

-- MaterialReturnNote / MaterialReturnLine DDL moved to 20260521220000_production_material_request
-- (requires Location + ProductionMaterialRequest, which are created later in the chain).
