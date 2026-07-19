ALTER TABLE `MaterialIssueLine`
  ADD COLUMN `theoreticalBomQty` DECIMAL(18,6) NULL,
  ADD COLUMN `includedRunnerQty` DECIMAL(18,6) NULL,
  ADD COLUMN `plannedAllowancePct` DECIMAL(7,4) NULL,
  ADD COLUMN `plannedAllowanceQty` DECIMAL(18,6) NULL,
  ADD COLUMN `recommendedIssueQty` DECIMAL(18,6) NULL,
  ADD COLUMN `allowanceReason` VARCHAR(500) NULL,
  ADD COLUMN `allowanceApprovalStatus` VARCHAR(32) NULL,
  ADD COLUMN `allowanceApprovedByUserId` INTEGER NULL,
  ADD COLUMN `allowanceApprovedAt` DATETIME(3) NULL,
  ADD COLUMN `allowanceEnteredByUserId` INTEGER NULL,
  ADD COLUMN `allowanceEnteredAt` DATETIME(3) NULL,
  ADD COLUMN `conversionBasis` VARCHAR(500) NULL;

ALTER TABLE `ProductionWorkOrderReport`
  ADD COLUMN `productionResult` VARCHAR(16) NULL;

ALTER TABLE `ProductionWorkOrderReportLine`
  ADD COLUMN `theoreticalBomQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN `runnerWasteQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN `plannedAllowancePct` DECIMAL(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN `plannedAllowanceQty` DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN `recommendedIssueQty` DECIMAL(18,6) NOT NULL DEFAULT 0;

ALTER TABLE `ProductionWorkOrderReportWastageDetail`
  MODIFY `wastageTypeId` INTEGER NULL,
  ADD COLUMN `itemId` INTEGER NULL,
  ADD COLUMN `source` VARCHAR(32) NOT NULL DEFAULT 'MANUAL_PRODUCTION';

CREATE INDEX `ProductionWorkOrderReportWastageDetail_itemId_idx`
  ON `ProductionWorkOrderReportWastageDetail`(`itemId`);
ALTER TABLE `ProductionWorkOrderReportWastageDetail`
  ADD CONSTRAINT `ProductionWorkOrderReportWastageDetail_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
