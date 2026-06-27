-- P16-C: auditable production surplus on WO line completion (MySQL)

-- Extend ProductionShortfallResolutionType on both enum columns (existing values preserved).
ALTER TABLE `ProductionShortfallResolution`
  MODIFY COLUMN `resolutionType` ENUM(
    'BLOCKED',
    'CARRY_FORWARD',
    'WAIVE_BALANCE',
    'SURPLUS_PRODUCTION'
  ) NOT NULL;

ALTER TABLE `WorkOrderProductionExecution`
  MODIFY COLUMN `lastResolutionType` ENUM(
    'BLOCKED',
    'CARRY_FORWARD',
    'WAIVE_BALANCE',
    'SURPLUS_PRODUCTION'
  ) NULL;

ALTER TABLE `WorkOrderLine`
  ADD COLUMN `executionSurplusQty` DECIMAL(18, 3) NULL;
