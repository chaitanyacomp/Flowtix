-- Batch 3A: NO_QTY recovery foundation (schema + backfill).
-- Additive / backward-compatible. Legacy CarryForwardPending.status and remainingQty retained.
-- MANUALLY_CLOSED rows migrated to CLOSED_WITH_WAIVER; enum value MANUALLY_CLOSED kept for dual-read.

-- ---------------------------------------------------------------------------
-- 1) SalesOrderInternalStatus: add CLOSED_WITH_WAIVER
-- ---------------------------------------------------------------------------
ALTER TABLE `SalesOrder` MODIFY `internalStatus` ENUM(
  'DRAFT',
  'OPEN',
  'APPROVED',
  'IN_PROCESS',
  'COMPLETED',
  'CLOSED',
  'MANUALLY_CLOSED',
  'CLOSED_WITH_WAIVER'
) NOT NULL DEFAULT 'DRAFT';

UPDATE `SalesOrder`
SET `internalStatus` = 'CLOSED_WITH_WAIVER'
WHERE `internalStatus` = 'MANUALLY_CLOSED';

-- ---------------------------------------------------------------------------
-- 2) RequirementSheetLine quantity components
-- ---------------------------------------------------------------------------
ALTER TABLE `RequirementSheetLine`
  ADD COLUMN `baseDemandQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `productionShortfallQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `qcRejectionRecoveryQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `approvedManualAdjustmentQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `totalRsQty` DECIMAL(18, 3) NOT NULL DEFAULT 0;

UPDATE `RequirementSheetLine`
SET
  `baseDemandQty` = `requirementQty`,
  `productionShortfallQty` = COALESCE(`shortfallQtySnapshot`, 0),
  `qcRejectionRecoveryQty` = 0,
  `approvedManualAdjustmentQty` = 0,
  `totalRsQty` = CASE
    WHEN `suggestedWoQtySnapshot` IS NOT NULL THEN `suggestedWoQtySnapshot`
    ELSE (`requirementQty` + COALESCE(`shortfallQtySnapshot`, 0))
  END;

-- ---------------------------------------------------------------------------
-- 3) CarryForwardPending recovery source columns
-- ---------------------------------------------------------------------------
ALTER TABLE `CarryForwardPending`
  MODIFY `sourceWorkOrderId` INTEGER NULL,
  ADD COLUMN `recoveryType` ENUM('PRODUCTION_SHORTFALL', 'QC_FINAL_REJECTION') NOT NULL DEFAULT 'PRODUCTION_SHORTFALL',
  ADD COLUMN `sourceDocumentType` ENUM(
    'WORK_ORDER',
    'PRODUCTION_SHORTFALL_RESOLUTION',
    'QC_REJECTED_DISPOSITION',
    'QC_ENTRY',
    'SCRAP_RECORD'
  ) NULL,
  ADD COLUMN `sourceDocumentId` INTEGER NULL,
  ADD COLUMN `sourceQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `recoveryStatus` ENUM(
    'OPEN',
    'PARTIALLY_ALLOCATED',
    'FULLY_ALLOCATED',
    'PARTIALLY_WAIVED',
    'WAIVED',
    'CANCELLED'
  ) NOT NULL DEFAULT 'OPEN',
  ADD COLUMN `waivedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `cancelledAt` DATETIME(3) NULL,
  ADD COLUMN `cancelledByUserId` INTEGER NULL,
  ADD COLUMN `cancelReason` TEXT NULL,
  ADD COLUMN `migrationIncomplete` BOOLEAN NOT NULL DEFAULT false;

UPDATE `CarryForwardPending`
SET
  `sourceQty` = `remainingQty`,
  `recoveryType` = 'PRODUCTION_SHORTFALL',
  `recoveryStatus` = CASE
    WHEN `status` = 'CONSUMED' THEN 'FULLY_ALLOCATED'
    ELSE 'OPEN'
  END,
  `sourceDocumentType` = CASE
    WHEN `productionShortfallResolutionId` IS NOT NULL THEN 'PRODUCTION_SHORTFALL_RESOLUTION'
    WHEN `sourceWorkOrderId` IS NOT NULL THEN 'WORK_ORDER'
    ELSE NULL
  END,
  `sourceDocumentId` = CASE
    WHEN `productionShortfallResolutionId` IS NOT NULL THEN `productionShortfallResolutionId`
    WHEN `sourceWorkOrderId` IS NOT NULL THEN `sourceWorkOrderId`
    ELSE NULL
  END;

-- Clear duplicate provenance keys (keep lowest id); mark others incomplete and null provenance.
UPDATE `CarryForwardPending` c
INNER JOIN (
  SELECT `recoveryType`, `sourceDocumentType`, `sourceDocumentId`, MIN(`id`) AS keepId
  FROM `CarryForwardPending`
  WHERE `sourceDocumentType` IS NOT NULL AND `sourceDocumentId` IS NOT NULL
  GROUP BY `recoveryType`, `sourceDocumentType`, `sourceDocumentId`
  HAVING COUNT(*) > 1
) d
  ON c.`recoveryType` = d.`recoveryType`
 AND c.`sourceDocumentType` = d.`sourceDocumentType`
 AND c.`sourceDocumentId` = d.`sourceDocumentId`
 AND c.`id` <> d.keepId
SET
  c.`sourceDocumentType` = NULL,
  c.`sourceDocumentId` = NULL,
  c.`migrationIncomplete` = true;

CREATE INDEX `CarryForwardPending_salesOrderId_recoveryStatus_idx`
  ON `CarryForwardPending`(`salesOrderId`, `recoveryStatus`);

CREATE INDEX `CarryForwardPending_salesOrderId_itemId_recoveryType_idx`
  ON `CarryForwardPending`(`salesOrderId`, `itemId`, `recoveryType`);

CREATE INDEX `CarryForwardPending_sourceDocumentType_sourceDocumentId_idx`
  ON `CarryForwardPending`(`sourceDocumentType`, `sourceDocumentId`);

CREATE UNIQUE INDEX `CarryForwardPending_recovery_source_key`
  ON `CarryForwardPending`(`recoveryType`, `sourceDocumentType`, `sourceDocumentId`);

ALTER TABLE `CarryForwardPending`
  ADD CONSTRAINT `CarryForwardPending_cancelledByUserId_fkey`
  FOREIGN KEY (`cancelledByUserId`) REFERENCES `User`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4) RecoveryAllocation
-- ---------------------------------------------------------------------------
CREATE TABLE `RecoveryAllocation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `recoverySourceId` INTEGER NOT NULL,
  `requirementSheetId` INTEGER NOT NULL,
  `requirementSheetLineId` INTEGER NOT NULL,
  `allocatedQty` DECIMAL(18, 3) NOT NULL,
  `status` ENUM('RESERVED', 'COMMITTED', 'REVERSED') NOT NULL,
  `reservedAt` DATETIME(3) NULL,
  `reservedByUserId` INTEGER NULL,
  `committedAt` DATETIME(3) NULL,
  `committedByUserId` INTEGER NULL,
  `reversedAt` DATETIME(3) NULL,
  `reversedByUserId` INTEGER NULL,
  `reverseReason` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `RecoveryAllocation_recoverySourceId_status_idx`(`recoverySourceId`, `status`),
  INDEX `RecoveryAllocation_requirementSheetLineId_status_idx`(`requirementSheetLineId`, `status`),
  INDEX `RecoveryAllocation_requirementSheetId_status_idx`(`requirementSheetId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RecoveryAllocation`
  ADD CONSTRAINT `RecoveryAllocation_recoverySourceId_fkey`
  FOREIGN KEY (`recoverySourceId`) REFERENCES `CarryForwardPending`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RecoveryAllocation`
  ADD CONSTRAINT `RecoveryAllocation_requirementSheetId_fkey`
  FOREIGN KEY (`requirementSheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RecoveryAllocation`
  ADD CONSTRAINT `RecoveryAllocation_requirementSheetLineId_fkey`
  FOREIGN KEY (`requirementSheetLineId`) REFERENCES `RequirementSheetLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `RecoveryAllocation`
  ADD CONSTRAINT `RecoveryAllocation_reservedByUserId_fkey`
  FOREIGN KEY (`reservedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RecoveryAllocation`
  ADD CONSTRAINT `RecoveryAllocation_committedByUserId_fkey`
  FOREIGN KEY (`committedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RecoveryAllocation`
  ADD CONSTRAINT `RecoveryAllocation_reversedByUserId_fkey`
  FOREIGN KEY (`reversedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Best-effort: CONSUMED CF with target RS → COMMITTED allocation on matching line
INSERT INTO `RecoveryAllocation` (
  `recoverySourceId`,
  `requirementSheetId`,
  `requirementSheetLineId`,
  `allocatedQty`,
  `status`,
  `committedAt`,
  `createdAt`
)
SELECT
  cf.`id`,
  cf.`targetRequirementSheetId`,
  rsl.`id`,
  cf.`sourceQty`,
  'COMMITTED',
  COALESCE(cf.`consumedAt`, cf.`createdAt`),
  COALESCE(cf.`consumedAt`, cf.`createdAt`)
FROM `CarryForwardPending` cf
INNER JOIN `RequirementSheetLine` rsl
  ON rsl.`sheetId` = cf.`targetRequirementSheetId`
 AND rsl.`itemId` = cf.`itemId`
WHERE cf.`status` = 'CONSUMED'
  AND cf.`targetRequirementSheetId` IS NOT NULL
  AND cf.`sourceQty` > 0;

UPDATE `CarryForwardPending` cf
LEFT JOIN `RecoveryAllocation` ra
  ON ra.`recoverySourceId` = cf.`id` AND ra.`status` = 'COMMITTED'
SET cf.`migrationIncomplete` = true
WHERE cf.`status` = 'CONSUMED'
  AND ra.`id` IS NULL;

-- ---------------------------------------------------------------------------
-- 5) NoQtySoWaiver + lines
-- ---------------------------------------------------------------------------
CREATE TABLE `NoQtySoWaiver` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `salesOrderId` INTEGER NOT NULL,
  `reasonCode` ENUM(
    'MACHINE_BREAKDOWN',
    'CAPACITY_CONSTRAINT',
    'WAITING_FOR_RM',
    'TOOL_MAINTENANCE',
    'CUSTOMER_PRIORITY_CHANGE',
    'MANAGEMENT_DECISION',
    'QUALITY_CONCERN',
    'CUSTOMER_CANCELLED_BALANCE',
    'COMMERCIAL_SETTLEMENT',
    'OTHER'
  ) NOT NULL,
  `remarks` TEXT NOT NULL,
  `approvedByUserId` INTEGER NOT NULL,
  `approvedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `NoQtySoWaiver_salesOrderId_idx`(`salesOrderId`),
  INDEX `NoQtySoWaiver_approvedAt_idx`(`approvedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NoQtySoWaiver`
  ADD CONSTRAINT `NoQtySoWaiver_salesOrderId_fkey`
  FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NoQtySoWaiver`
  ADD CONSTRAINT `NoQtySoWaiver_approvedByUserId_fkey`
  FOREIGN KEY (`approvedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `NoQtySoWaiverLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `waiverId` INTEGER NOT NULL,
  `recoverySourceId` INTEGER NOT NULL,
  `itemId` INTEGER NOT NULL,
  `waivedQty` DECIMAL(18, 3) NOT NULL,
  `recoveryType` ENUM('PRODUCTION_SHORTFALL', 'QC_FINAL_REJECTION') NOT NULL,

  INDEX `NoQtySoWaiverLine_waiverId_idx`(`waiverId`),
  INDEX `NoQtySoWaiverLine_recoverySourceId_idx`(`recoverySourceId`),
  INDEX `NoQtySoWaiverLine_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NoQtySoWaiverLine`
  ADD CONSTRAINT `NoQtySoWaiverLine_waiverId_fkey`
  FOREIGN KEY (`waiverId`) REFERENCES `NoQtySoWaiver`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `NoQtySoWaiverLine`
  ADD CONSTRAINT `NoQtySoWaiverLine_recoverySourceId_fkey`
  FOREIGN KEY (`recoverySourceId`) REFERENCES `CarryForwardPending`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NoQtySoWaiverLine`
  ADD CONSTRAINT `NoQtySoWaiverLine_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 6) Close snapshot waiver link
-- ---------------------------------------------------------------------------
ALTER TABLE `NoQtySoCloseSnapshot`
  ADD COLUMN `waiverId` INTEGER NULL,
  ADD COLUMN `closeMode` VARCHAR(32) NULL;

CREATE UNIQUE INDEX `NoQtySoCloseSnapshot_waiverId_key` ON `NoQtySoCloseSnapshot`(`waiverId`);

ALTER TABLE `NoQtySoCloseSnapshot`
  ADD CONSTRAINT `NoQtySoCloseSnapshot_waiverId_fkey`
  FOREIGN KEY (`waiverId`) REFERENCES `NoQtySoWaiver`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE `NoQtySoCloseSnapshot` s
INNER JOIN `SalesOrder` so ON so.`id` = s.`salesOrderId`
SET s.`closeMode` = 'WAIVER'
WHERE so.`internalStatus` = 'CLOSED_WITH_WAIVER'
  AND s.`status` = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 7) Accepted FG disposition audit
-- ---------------------------------------------------------------------------
CREATE TABLE `NoQtyAcceptedFgDisposition` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `salesOrderId` INTEGER NOT NULL,
  `itemId` INTEGER NOT NULL,
  `qty` DECIMAL(18, 3) NOT NULL,
  `dispositionType` ENUM(
    'DISPATCH_BEFORE_CLOSE',
    'TRANSFER_TO_GENERAL_STOCK',
    'RETAIN_AS_CUSTOMER_SPECIFIC_STOCK',
    'SCRAP',
    'OTHER_APPROVED_DISPOSITION'
  ) NOT NULL,
  `stockTransactionId` INTEGER NULL,
  `approvedByUserId` INTEGER NULL,
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `NoQtyAcceptedFgDisposition_salesOrderId_itemId_idx`(`salesOrderId`, `itemId`),
  INDEX `NoQtyAcceptedFgDisposition_dispositionType_idx`(`dispositionType`),
  INDEX `NoQtyAcceptedFgDisposition_stockTransactionId_idx`(`stockTransactionId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NoQtyAcceptedFgDisposition`
  ADD CONSTRAINT `NoQtyAcceptedFgDisposition_salesOrderId_fkey`
  FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NoQtyAcceptedFgDisposition`
  ADD CONSTRAINT `NoQtyAcceptedFgDisposition_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NoQtyAcceptedFgDisposition`
  ADD CONSTRAINT `NoQtyAcceptedFgDisposition_stockTransactionId_fkey`
  FOREIGN KEY (`stockTransactionId`) REFERENCES `StockTransaction`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `NoQtyAcceptedFgDisposition`
  ADD CONSTRAINT `NoQtyAcceptedFgDisposition_approvedByUserId_fkey`
  FOREIGN KEY (`approvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
