-- Phase 2B: per-FG Keep/Waive recovery decisions on Requirement Sheets.

CREATE TABLE `NoQtyRsItemRecoveryDecision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requirementSheetId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'KEPT', 'WAIVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `productionShortfallQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `qcFinalRejectionQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `pendingRecoveryQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
    `reason` TEXT NULL,
    `decidedAt` DATETIME(3) NULL,
    `decidedByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `NoQtyRsItemRecoveryDecision_requirementSheetId_status_idx`(`requirementSheetId`, `status`),
    INDEX `NoQtyRsItemRecoveryDecision_itemId_idx`(`itemId`),
    INDEX `NoQtyRsItemRecoveryDecision_status_idx`(`status`),
    UNIQUE INDEX `NoQtyRsItemRecoveryDecision_requirementSheetId_itemId_key`(`requirementSheetId`, `itemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `NoQtyRsItemRecoveryDecisionLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `decisionId` INTEGER NOT NULL,
    `recoverySourceId` INTEGER NOT NULL,
    `recoveryType` ENUM('PRODUCTION_SHORTFALL', 'QC_FINAL_REJECTION') NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `effect` ENUM('KEEP', 'WAIVE') NOT NULL,
    `recoveryAllocationId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `NoQtyRsItemRecoveryDecisionLine_decisionId_idx`(`decisionId`),
    INDEX `NoQtyRsItemRecoveryDecisionLine_recoverySourceId_idx`(`recoverySourceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `NoQtyRsItemRecoveryDecision`
  ADD CONSTRAINT `NoQtyRsItemRecoveryDecision_requirementSheetId_fkey`
  FOREIGN KEY (`requirementSheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `NoQtyRsItemRecoveryDecision`
  ADD CONSTRAINT `NoQtyRsItemRecoveryDecision_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `NoQtyRsItemRecoveryDecision`
  ADD CONSTRAINT `NoQtyRsItemRecoveryDecision_decidedByUserId_fkey`
  FOREIGN KEY (`decidedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `NoQtyRsItemRecoveryDecisionLine`
  ADD CONSTRAINT `NoQtyRsItemRecoveryDecisionLine_decisionId_fkey`
  FOREIGN KEY (`decisionId`) REFERENCES `NoQtyRsItemRecoveryDecision`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `NoQtyRsItemRecoveryDecisionLine`
  ADD CONSTRAINT `NoQtyRsItemRecoveryDecisionLine_recoverySourceId_fkey`
  FOREIGN KEY (`recoverySourceId`) REFERENCES `CarryForwardPending`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
