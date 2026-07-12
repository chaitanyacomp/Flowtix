-- Monthly Plan ↔ Requirement Sheet source-identity coverage (Additional Plan fix).
-- Plan coverage is bound to RS line / component identity, not period+FG quantity alone.

CREATE TABLE `MonthlyPlanRequirementCoverage` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `planId` INTEGER NOT NULL,
  `planLineId` INTEGER NULL,
  `periodKey` VARCHAR(16) NOT NULL,
  `fgItemId` INTEGER NOT NULL,
  `requirementSheetId` INTEGER NULL,
  `requirementSheetLineId` INTEGER NULL,
  `salesOrderId` INTEGER NULL,
  `cycleId` INTEGER NULL,
  `cycleNo` INTEGER NULL,
  `componentType` ENUM(
    'RS_BASE_DEMAND',
    'PRODUCTION_SHORTFALL',
    'QC_REJECTION_RECOVERY',
    'GREEN_LEVEL'
  ) NOT NULL,
  `sourceKey` VARCHAR(128) NOT NULL,
  `componentQty` DECIMAL(18, 3) NOT NULL,
  `coveredQty` DECIMAL(18, 3) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `MonthlyPlanRequirementCoverage_planId_sourceKey_key`
  ON `MonthlyPlanRequirementCoverage`(`planId`, `sourceKey`);

CREATE INDEX `MonthlyPlanRequirementCoverage_periodKey_fgItemId_idx`
  ON `MonthlyPlanRequirementCoverage`(`periodKey`, `fgItemId`);

CREATE INDEX `MonthlyPlanRequirementCoverage_requirementSheetId_idx`
  ON `MonthlyPlanRequirementCoverage`(`requirementSheetId`);

CREATE INDEX `MonthlyPlanRequirementCoverage_requirementSheetLineId_idx`
  ON `MonthlyPlanRequirementCoverage`(`requirementSheetLineId`);

CREATE INDEX `MonthlyPlanRequirementCoverage_sourceKey_idx`
  ON `MonthlyPlanRequirementCoverage`(`sourceKey`);

CREATE INDEX `MonthlyPlanRequirementCoverage_planId_idx`
  ON `MonthlyPlanRequirementCoverage`(`planId`);

ALTER TABLE `MonthlyPlanRequirementCoverage`
  ADD CONSTRAINT `MonthlyPlanRequirementCoverage_planId_fkey`
  FOREIGN KEY (`planId`) REFERENCES `MonthlyProductionPlan`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `MonthlyPlanRequirementCoverage`
  ADD CONSTRAINT `MonthlyPlanRequirementCoverage_planLineId_fkey`
  FOREIGN KEY (`planLineId`) REFERENCES `MonthlyProductionPlanLine`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MonthlyPlanRequirementCoverage`
  ADD CONSTRAINT `MonthlyPlanRequirementCoverage_fgItemId_fkey`
  FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `MonthlyPlanRequirementCoverage`
  ADD CONSTRAINT `MonthlyPlanRequirementCoverage_requirementSheetId_fkey`
  FOREIGN KEY (`requirementSheetId`) REFERENCES `RequirementSheet`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MonthlyPlanRequirementCoverage`
  ADD CONSTRAINT `MonthlyPlanRequirementCoverage_requirementSheetLineId_fkey`
  FOREIGN KEY (`requirementSheetLineId`) REFERENCES `RequirementSheetLine`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
