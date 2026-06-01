-- Monthly Planning Workspace — Phase 1 data foundation (additive only).
-- Adds Monthly Production Plan + RM Plan snapshot tables, two new enums,
-- extends DocType and MaterialPlanningSourceType, and adds nullable
-- variance-anchor columns on MaterialRequirement. No existing logic changes.

-- Extend DocType enum (DocSequence.docType) with MONTHLY_PRODUCTION_PLAN.
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
  'BOM',
  'MONTHLY_PRODUCTION_PLAN'
) NOT NULL;

-- Extend MaterialPlanningSourceType enum (MaterialRequirement.sourceType) with MONTHLY_PLAN.
ALTER TABLE `MaterialRequirement` MODIFY `sourceType` ENUM(
  'QUOTATION',
  'SALES_ORDER',
  'WORK_ORDER_PLANNING',
  'STOCK_REPLENISHMENT',
  'MONTHLY_PLAN'
) NOT NULL;

-- CreateTable: MonthlyProductionPlan
CREATE TABLE `MonthlyProductionPlan` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `docNo` VARCHAR(32) NULL,
  `periodKey` VARCHAR(16) NOT NULL,
  `status` ENUM('DRAFT', 'LOCKED') NOT NULL DEFAULT 'DRAFT',
  `currentRevision` INTEGER NOT NULL DEFAULT 0,
  `remarks` TEXT NULL,
  `lockedAt` DATETIME(3) NULL,
  `lockedByUserId` INTEGER NULL,
  `reopenedAt` DATETIME(3) NULL,
  `reopenedByUserId` INTEGER NULL,
  `releasedAt` DATETIME(3) NULL,
  `releasedByUserId` INTEGER NULL,
  `releasedRevision` INTEGER NULL,
  `createdByUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MonthlyProductionPlan_docNo_key`(`docNo`),
  UNIQUE INDEX `MonthlyProductionPlan_periodKey_key`(`periodKey`),
  INDEX `MonthlyProductionPlan_status_idx`(`status`),
  INDEX `MonthlyProductionPlan_periodKey_idx`(`periodKey`),
  INDEX `MonthlyProductionPlan_releasedAt_idx`(`releasedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: MonthlyProductionPlanLine
CREATE TABLE `MonthlyProductionPlanLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `planId` INTEGER NOT NULL,
  `fgItemId` INTEGER NOT NULL,
  `suggestedFgQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `plannedFgQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `source` ENUM('CUSTOMER_SCHEDULE', 'SALES_ORDER', 'REQUIREMENT_SHEET', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MonthlyProductionPlanLine_planId_fgItemId_key`(`planId`, `fgItemId`),
  INDEX `MonthlyProductionPlanLine_planId_idx`(`planId`),
  INDEX `MonthlyProductionPlanLine_fgItemId_idx`(`fgItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: RmPlan
CREATE TABLE `RmPlan` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `planId` INTEGER NOT NULL,
  `revision` INTEGER NOT NULL,
  `totalFgPlannedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `fgPlanHashSnapshot` VARCHAR(64) NULL,
  `recalculatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `recalculatedByUserId` INTEGER NULL,

  UNIQUE INDEX `RmPlan_planId_revision_key`(`planId`, `revision`),
  INDEX `RmPlan_planId_idx`(`planId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: RmPlanLine
CREATE TABLE `RmPlanLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `rmPlanId` INTEGER NOT NULL,
  `rmItemId` INTEGER NOT NULL,
  `grossDemandQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `freeStockSnapshot` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `reservedSnapshot` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `incomingPoSnapshot` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `minStockTopUpQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `netRequirementQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `unitSnapshot` VARCHAR(64) NULL,
  `leadTimeRiskFlag` BOOLEAN NOT NULL DEFAULT false,
  `belowMinStockFlag` BOOLEAN NOT NULL DEFAULT false,
  `warningsJson` JSON NULL,

  UNIQUE INDEX `RmPlanLine_rmPlanId_rmItemId_key`(`rmPlanId`, `rmItemId`),
  INDEX `RmPlanLine_rmPlanId_idx`(`rmPlanId`),
  INDEX `RmPlanLine_rmItemId_idx`(`rmItemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable: MaterialRequirement variance-anchor columns (nullable; legacy rows unaffected).
ALTER TABLE `MaterialRequirement` ADD COLUMN `monthlyProductionPlanId` INTEGER NULL;
ALTER TABLE `MaterialRequirement` ADD COLUMN `sourceRevision` INTEGER NULL;
CREATE INDEX `MaterialRequirement_monthlyProductionPlanId_idx` ON `MaterialRequirement`(`monthlyProductionPlanId`);

-- AddForeignKey: MonthlyProductionPlan actor links
ALTER TABLE `MonthlyProductionPlan` ADD CONSTRAINT `MonthlyProductionPlan_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MonthlyProductionPlan` ADD CONSTRAINT `MonthlyProductionPlan_lockedByUserId_fkey` FOREIGN KEY (`lockedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MonthlyProductionPlan` ADD CONSTRAINT `MonthlyProductionPlan_reopenedByUserId_fkey` FOREIGN KEY (`reopenedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `MonthlyProductionPlan` ADD CONSTRAINT `MonthlyProductionPlan_releasedByUserId_fkey` FOREIGN KEY (`releasedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: MonthlyProductionPlanLine
ALTER TABLE `MonthlyProductionPlanLine` ADD CONSTRAINT `MonthlyProductionPlanLine_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `MonthlyProductionPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `MonthlyProductionPlanLine` ADD CONSTRAINT `MonthlyProductionPlanLine_fgItemId_fkey` FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: RmPlan
ALTER TABLE `RmPlan` ADD CONSTRAINT `RmPlan_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `MonthlyProductionPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RmPlan` ADD CONSTRAINT `RmPlan_recalculatedByUserId_fkey` FOREIGN KEY (`recalculatedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: RmPlanLine
ALTER TABLE `RmPlanLine` ADD CONSTRAINT `RmPlanLine_rmPlanId_fkey` FOREIGN KEY (`rmPlanId`) REFERENCES `RmPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RmPlanLine` ADD CONSTRAINT `RmPlanLine_rmItemId_fkey` FOREIGN KEY (`rmItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: MaterialRequirement → MonthlyProductionPlan (variance anchor; SET NULL on plan delete)
ALTER TABLE `MaterialRequirement` ADD CONSTRAINT `MaterialRequirement_monthlyProductionPlanId_fkey` FOREIGN KEY (`monthlyProductionPlanId`) REFERENCES `MonthlyProductionPlan`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
