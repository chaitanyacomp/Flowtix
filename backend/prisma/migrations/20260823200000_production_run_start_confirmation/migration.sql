-- Production-run start confirmation + actual purging consumption (PURGING_CONSUMPTION).
-- Stock posting reuses MaterialWastageNote / RM_WASTAGE + reason PURGING (no parallel ledger).
-- All MySQL identifiers explicitly mapped and <= 64 characters.

CREATE TABLE `WorkOrderProductionRunStartConfirmation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workOrderId` INTEGER NOT NULL,
    `runAllocationId` INTEGER NOT NULL,
    `machineId` INTEGER NOT NULL,
    `fgItemId` INTEGER NOT NULL,
    `workOrderLineId` INTEGER NULL,
    `bomId` INTEGER NULL,
    `bomRevisionLabel` VARCHAR(64) NULL,
    `status` ENUM('CONFIRMED', 'REVERSED') NOT NULL DEFAULT 'CONFIRMED',
    `plannedProfileFingerprint` VARCHAR(64) NULL,
    `targetProfileFingerprint` VARCHAR(64) NULL,
    `plannedPurgingRequired` BOOLEAN NOT NULL DEFAULT false,
    `plannedDetectionStatus` ENUM('AUTO_REQUIRED', 'AUTO_NOT_REQUIRED', 'CONFIRMATION_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `plannedDetectionReason` VARCHAR(500) NULL,
    `plannedPurgeQtyGrams` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `actualMaterialCondition` ENUM('SAME_MATERIAL_RETAINED', 'DIFFERENT_MATERIAL_RETAINED', 'MACHINE_CLEARED', 'UNKNOWN') NOT NULL,
    `actualSetupCondition` ENUM('SETUP_RETAINED', 'NEW_SETUP_COMPLETED') NOT NULL,
    `suggestedPurgingRequired` BOOLEAN NOT NULL,
    `suggestedPurgingReason` VARCHAR(500) NULL,
    `actualPurgingRequired` BOOLEAN NOT NULL,
    `purgeOverrideReason` VARCHAR(500) NULL,
    `purgeOverrideByUserId` INTEGER NULL,
    `purgeOverrideAt` DATETIME(3) NULL,
    `actualPurgeQtyGrams` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `purgeVarianceGrams` DECIMAL(18, 4) NOT NULL DEFAULT 0,
    `machineStateVersionBefore` INTEGER NULL,
    `machineStateVersionAfter` INTEGER NULL,
    `confirmedByUserId` INTEGER NOT NULL,
    `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `idempotencyKey` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WoRunStartConf_runAlloc_key`(`runAllocationId`),
    UNIQUE INDEX `WoRunStartConf_idem_key`(`idempotencyKey`),
    INDEX `WoRunStartConf_wo_idx`(`workOrderId`),
    INDEX `WoRunStartConf_machine_idx`(`machineId`),
    INDEX `WoRunStartConf_fg_idx`(`fgItemId`),
    INDEX `WoRunStartConf_status_idx`(`status`),
    INDEX `WoRunStartConf_confBy_idx`(`confirmedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkOrderProductionRunPurgeRmLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `startConfirmationId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `plannedQtyKg` DECIMAL(18, 6) NOT NULL DEFAULT 0,
    `actualQtyKg` DECIMAL(18, 6) NOT NULL,
    `fromLocationId` INTEGER NOT NULL,
    `materialWastageNoteId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `WoRunPurgeRm_mwn_key`(`materialWastageNoteId`),
    UNIQUE INDEX `WoRunPurgeRm_conf_item_key`(`startConfirmationId`, `itemId`),
    INDEX `WoRunPurgeRm_conf_idx`(`startConfirmationId`),
    INDEX `WoRunPurgeRm_item_idx`(`itemId`),
    INDEX `WoRunPurgeRm_fromLoc_idx`(`fromLocationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkOrderProductionRunStartConfirmation`
  ADD CONSTRAINT `WoRunStartConf_wo_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunStartConf_runAlloc_fkey`
    FOREIGN KEY (`runAllocationId`) REFERENCES `WorkOrderProductionRunAllocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunStartConf_machine_fkey`
    FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunStartConf_fg_fkey`
    FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunStartConf_confBy_fkey`
    FOREIGN KEY (`confirmedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunStartConf_purgeOvBy_fkey`
    FOREIGN KEY (`purgeOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WorkOrderProductionRunPurgeRmLine`
  ADD CONSTRAINT `WoRunPurgeRm_conf_fkey`
    FOREIGN KEY (`startConfirmationId`) REFERENCES `WorkOrderProductionRunStartConfirmation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunPurgeRm_item_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunPurgeRm_fromLoc_fkey`
    FOREIGN KEY (`fromLocationId`) REFERENCES `Location`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoRunPurgeRm_mwn_fkey`
    FOREIGN KEY (`materialWastageNoteId`) REFERENCES `MaterialWastageNote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Per-run production entry linkage (nullable for historical PE rows).
-- Soft-inactive planned runs cannot receive new production entries.
ALTER TABLE `WorkOrderProductionRunAllocation`
  ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `WoProdRunAlloc_isActive_idx` ON `WorkOrderProductionRunAllocation`(`isActive`);

ALTER TABLE `ProductionEntry`
  ADD COLUMN `runAllocationId` INTEGER NULL;

CREATE INDEX `Pe_runAlloc_idx` ON `ProductionEntry`(`runAllocationId`);

ALTER TABLE `ProductionEntry`
  ADD CONSTRAINT `Pe_runAlloc_fkey`
    FOREIGN KEY (`runAllocationId`) REFERENCES `WorkOrderProductionRunAllocation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
