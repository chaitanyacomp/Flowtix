-- Phase 8B: immutable FG production plan snapshot per locked revision.
CREATE TABLE `MonthlyProductionPlanRevisionLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `planId` INTEGER NOT NULL,
  `revision` INTEGER NOT NULL,
  `fgItemId` INTEGER NOT NULL,
  `suggestedFgQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `plannedFgQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `plannedQtyOverridden` BOOLEAN NOT NULL DEFAULT false,
  `source` ENUM('CUSTOMER_SCHEDULE', 'SALES_ORDER', 'REQUIREMENT_SHEET', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
  `remarks` TEXT NULL,
  `unitSnapshot` VARCHAR(64) NULL,
  `itemNameSnapshot` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (`id`),
  UNIQUE INDEX `MonthlyProductionPlanRevisionLine_planId_revision_fgItemId_key`(`planId`, `revision`, `fgItemId`),
  INDEX `MonthlyProductionPlanRevisionLine_planId_revision_idx`(`planId`, `revision`),
  INDEX `MonthlyProductionPlanRevisionLine_fgItemId_idx`(`fgItemId`),
  CONSTRAINT `MonthlyProductionPlanRevisionLine_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `MonthlyProductionPlan`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `MonthlyProductionPlanRevisionLine_fgItemId_fkey` FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
