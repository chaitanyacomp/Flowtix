-- Machine production-run allocations + material-state foundation.
-- Purging is profile-driven (plannedPurgeCount), NOT run-row count.
-- Additive only; does not alter historical WorkOrder.plannedSetupCount for existing rows.
-- Explicit short MySQL identifier maps (<=64 chars) required for InnoDB.

ALTER TABLE `RegularSoPlanningSnapshot`
  ADD COLUMN `plannedPurgeCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `productionRunCount` INT NOT NULL DEFAULT 0;

ALTER TABLE `WorkOrder`
  ADD COLUMN `plannedPurgeCount` INT NOT NULL DEFAULT 0,
  ADD COLUMN `productionRunCount` INT NOT NULL DEFAULT 0;

CREATE TABLE `RegularSoPlanningRunAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `snapshotId` INTEGER NOT NULL,
    `fgItemId` INTEGER NOT NULL,
    `runSequence` INTEGER NOT NULL,
    `machineId` INTEGER NOT NULL,
    `plannedQty` DECIMAL(18, 3) NOT NULL,
    `plannedDate` DATE NULL,
    `shiftId` INTEGER NULL,
    `purgingRequired` BOOLEAN NOT NULL DEFAULT false,
    `purgingDetectionStatus` ENUM('AUTO_REQUIRED', 'AUTO_NOT_REQUIRED', 'CONFIRMATION_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `purgingDetectionReason` VARCHAR(500) NULL,
    `previousProfileFingerprint` VARCHAR(64) NULL,
    `targetProfileFingerprint` VARCHAR(64) NULL,
    `purgingOverrideReason` VARCHAR(500) NULL,
    `purgingOverrideByUserId` INTEGER NULL,
    `purgingOverrideAt` DATETIME(3) NULL,
    `physicalSetupRequired` BOOLEAN NULL,
    `physicalSetupStatus` ENUM('CONFIRMATION_REQUIRED', 'CONFIRMED_REQUIRED', 'CONFIRMED_NOT_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `physicalSetupReason` VARCHAR(500) NULL,
    `physicalSetupOverrideReason` VARCHAR(500) NULL,
    `physicalSetupOverrideByUserId` INTEGER NULL,
    `physicalSetupOverrideAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RegSoRunAlloc_snap_fg_seq_key`(`snapshotId`, `fgItemId`, `runSequence`),
    INDEX `RegSoRunAlloc_snap_idx`(`snapshotId`),
    INDEX `RegSoRunAlloc_fg_idx`(`fgItemId`),
    INDEX `RegSoRunAlloc_machine_idx`(`machineId`),
    INDEX `RegSoRunAlloc_shift_idx`(`shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WorkOrderProductionRunAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workOrderId` INTEGER NOT NULL,
    `workOrderLineId` INTEGER NULL,
    `fgItemId` INTEGER NOT NULL,
    `runSequence` INTEGER NOT NULL,
    `machineId` INTEGER NOT NULL,
    `plannedQty` DECIMAL(18, 3) NOT NULL,
    `plannedDate` DATE NULL,
    `shiftId` INTEGER NULL,
    `cycleTimeSeconds` DECIMAL(18, 3) NULL,
    `piecesPerCycle` INTEGER NULL,
    `standardEfficiencyPercent` DECIMAL(5, 2) NULL,
    `purgingRequired` BOOLEAN NOT NULL DEFAULT false,
    `purgingDetectionStatus` ENUM('AUTO_REQUIRED', 'AUTO_NOT_REQUIRED', 'CONFIRMATION_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `purgingDetectionReason` VARCHAR(500) NULL,
    `previousProfileFingerprint` VARCHAR(64) NULL,
    `targetProfileFingerprint` VARCHAR(64) NULL,
    `purgingOverrideReason` VARCHAR(500) NULL,
    `purgingOverrideByUserId` INTEGER NULL,
    `purgingOverrideAt` DATETIME(3) NULL,
    `physicalSetupRequired` BOOLEAN NULL,
    `physicalSetupStatus` ENUM('CONFIRMATION_REQUIRED', 'CONFIRMED_REQUIRED', 'CONFIRMED_NOT_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `physicalSetupReason` VARCHAR(500) NULL,
    `physicalSetupOverrideReason` VARCHAR(500) NULL,
    `physicalSetupOverrideByUserId` INTEGER NULL,
    `physicalSetupOverrideAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WoProdRunAlloc_wo_fg_seq_key`(`workOrderId`, `fgItemId`, `runSequence`),
    INDEX `WoProdRunAlloc_wo_idx`(`workOrderId`),
    INDEX `WoProdRunAlloc_wol_idx`(`workOrderLineId`),
    INDEX `WoProdRunAlloc_fg_idx`(`fgItemId`),
    INDEX `WoProdRunAlloc_machine_idx`(`machineId`),
    INDEX `WoProdRunAlloc_shift_idx`(`shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `RequirementSheetPlannedRunAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requirementSheetId` INTEGER NOT NULL,
    `fgItemId` INTEGER NOT NULL,
    `runSequence` INTEGER NOT NULL,
    `machineId` INTEGER NOT NULL,
    `plannedQty` DECIMAL(18, 3) NOT NULL,
    `plannedDate` DATE NULL,
    `shiftId` INTEGER NULL,
    `purgingRequired` BOOLEAN NOT NULL DEFAULT false,
    `purgingDetectionStatus` ENUM('AUTO_REQUIRED', 'AUTO_NOT_REQUIRED', 'CONFIRMATION_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `purgingDetectionReason` VARCHAR(500) NULL,
    `previousProfileFingerprint` VARCHAR(64) NULL,
    `targetProfileFingerprint` VARCHAR(64) NULL,
    `purgingOverrideReason` VARCHAR(500) NULL,
    `purgingOverrideByUserId` INTEGER NULL,
    `purgingOverrideAt` DATETIME(3) NULL,
    `physicalSetupRequired` BOOLEAN NULL,
    `physicalSetupStatus` ENUM('CONFIRMATION_REQUIRED', 'CONFIRMED_REQUIRED', 'CONFIRMED_NOT_REQUIRED', 'OVERRIDDEN') NOT NULL DEFAULT 'CONFIRMATION_REQUIRED',
    `physicalSetupReason` VARCHAR(500) NULL,
    `physicalSetupOverrideReason` VARCHAR(500) NULL,
    `physicalSetupOverrideByUserId` INTEGER NULL,
    `physicalSetupOverrideAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RsPlanRunAlloc_rs_fg_seq_key`(`requirementSheetId`, `fgItemId`, `runSequence`),
    INDEX `RsPlanRunAlloc_rs_idx`(`requirementSheetId`),
    INDEX `RsPlanRunAlloc_fg_idx`(`fgItemId`),
    INDEX `RsPlanRunAlloc_machine_idx`(`machineId`),
    INDEX `RsPlanRunAlloc_shift_idx`(`shiftId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `MachineMaterialState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machineId` INTEGER NOT NULL,
    `currentProfileFingerprint` VARCHAR(64) NULL,
    `currentProfileJson` JSON NULL,
    `materialState` ENUM('RETAINED', 'CLEARED', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    `sourceWorkOrderId` INTEGER NULL,
    `sourceRunAllocationId` INTEGER NULL,
    `confirmedAt` DATETIME(3) NULL,
    `confirmedByUserId` INTEGER NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MachMatState_machineId_key`(`machineId`),
    INDEX `MachMatState_materialState_idx`(`materialState`),
    INDEX `MachMatState_sourceWo_idx`(`sourceWorkOrderId`),
    INDEX `MachMatState_confirmedBy_idx`(`confirmedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RegularSoPlanningRunAllocation`
  ADD CONSTRAINT `RegSoRunAlloc_snap_fkey`
    FOREIGN KEY (`snapshotId`) REFERENCES `RegularSoPlanningSnapshot`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RegSoRunAlloc_fg_fkey`
    FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RegSoRunAlloc_machine_fkey`
    FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RegSoRunAlloc_shift_fkey`
    FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `RegSoRunAlloc_purgeOvBy_fkey`
    FOREIGN KEY (`purgingOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `RegSoRunAlloc_setupOvBy_fkey`
    FOREIGN KEY (`physicalSetupOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `WorkOrderProductionRunAllocation`
  ADD CONSTRAINT `WoProdRunAlloc_wo_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `WoProdRunAlloc_wol_fkey`
    FOREIGN KEY (`workOrderLineId`) REFERENCES `WorkOrderLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `WoProdRunAlloc_fg_fkey`
    FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoProdRunAlloc_machine_fkey`
    FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `WoProdRunAlloc_shift_fkey`
    FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `WoProdRunAlloc_purgeOvBy_fkey`
    FOREIGN KEY (`purgingOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `WoProdRunAlloc_setupOvBy_fkey`
    FOREIGN KEY (`physicalSetupOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `RequirementSheetPlannedRunAllocation`
  ADD CONSTRAINT `RsPlanRunAlloc_rs_fkey`
    FOREIGN KEY (`requirementSheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `RsPlanRunAlloc_fg_fkey`
    FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RsPlanRunAlloc_machine_fkey`
    FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `RsPlanRunAlloc_shift_fkey`
    FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `RsPlanRunAlloc_purgeOvBy_fkey`
    FOREIGN KEY (`purgingOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `RsPlanRunAlloc_setupOvBy_fkey`
    FOREIGN KEY (`physicalSetupOverrideByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `MachineMaterialState`
  ADD CONSTRAINT `MachMatState_machine_fkey`
    FOREIGN KEY (`machineId`) REFERENCES `Machine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `MachMatState_sourceWo_fkey`
    FOREIGN KEY (`sourceWorkOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `MachMatState_confirmedBy_fkey`
    FOREIGN KEY (`confirmedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
