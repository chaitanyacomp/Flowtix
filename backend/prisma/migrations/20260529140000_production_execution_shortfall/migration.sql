-- NO_QTY Production Execution shortfall resolution (P16-A1R2)

CREATE TABLE `WorkOrderProductionExecution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workOrderId` INTEGER NOT NULL,
    `executionStatus` ENUM('RUNNING', 'BLOCKED', 'COMPLETED') NOT NULL DEFAULT 'RUNNING',
    `blockReason` ENUM('MACHINE_BREAKDOWN', 'WAITING_FOR_RM', 'TOOL_MOULD_MAINTENANCE', 'QUALITY_CONCERN', 'EMERGENCY_PRIORITY_PRODUCTION', 'POWER_UTILITY_FAILURE', 'MANAGEMENT_HOLD', 'OTHER') NULL,
    `blockRemarks` TEXT NULL,
    `blockedAt` DATETIME(3) NULL,
    `blockedByUserId` INTEGER NULL,
    `resumedAt` DATETIME(3) NULL,
    `resumedByUserId` INTEGER NULL,
    `completedAt` DATETIME(3) NULL,
    `completedByUserId` INTEGER NULL,
    `lastResolutionType` ENUM('BLOCKED', 'CARRY_FORWARD', 'WAIVE_BALANCE') NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `WorkOrderProductionExecution_workOrderId_key`(`workOrderId`),
    INDEX `WorkOrderProductionExecution_executionStatus_idx`(`executionStatus`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionShortfallResolution` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `workOrderId` INTEGER NOT NULL,
    `workOrderLineId` INTEGER NULL,
    `plannedQty` DECIMAL(18, 3) NOT NULL,
    `producedQty` DECIMAL(18, 3) NOT NULL,
    `remainderQty` DECIMAL(18, 3) NOT NULL,
    `resolutionType` ENUM('BLOCKED', 'CARRY_FORWARD', 'WAIVE_BALANCE') NOT NULL,
    `resolutionReason` ENUM('MACHINE_BREAKDOWN', 'CAPACITY_CONSTRAINT', 'WAITING_FOR_RM', 'TOOL_MAINTENANCE', 'CUSTOMER_PRIORITY_CHANGE', 'MANAGEMENT_DECISION', 'QUALITY_CONCERN', 'OTHER') NULL,
    `blockReason` ENUM('MACHINE_BREAKDOWN', 'WAITING_FOR_RM', 'TOOL_MOULD_MAINTENANCE', 'QUALITY_CONCERN', 'EMERGENCY_PRIORITY_PRODUCTION', 'POWER_UTILITY_FAILURE', 'MANAGEMENT_HOLD', 'OTHER') NULL,
    `resolutionReasonOther` TEXT NULL,
    `remarks` TEXT NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProductionShortfallResolution_workOrderId_idx`(`workOrderId`),
    INDEX `ProductionShortfallResolution_workOrderLineId_idx`(`workOrderLineId`),
    INDEX `ProductionShortfallResolution_resolutionType_idx`(`resolutionType`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `CarryForwardPending` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `itemId` INTEGER NOT NULL,
    `salesOrderId` INTEGER NOT NULL,
    `sourceRequirementSheetId` INTEGER NULL,
    `sourceWorkOrderId` INTEGER NOT NULL,
    `cycleId` INTEGER NULL,
    `remainingQty` DECIMAL(18, 3) NOT NULL,
    `resolutionReason` ENUM('MACHINE_BREAKDOWN', 'CAPACITY_CONSTRAINT', 'WAITING_FOR_RM', 'TOOL_MAINTENANCE', 'CUSTOMER_PRIORITY_CHANGE', 'MANAGEMENT_DECISION', 'QUALITY_CONCERN', 'OTHER') NOT NULL,
    `resolutionReasonOther` TEXT NULL,
    `remarks` TEXT NULL,
    `status` ENUM('PENDING', 'CONSUMED') NOT NULL DEFAULT 'PENDING',
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `consumedAt` DATETIME(3) NULL,
    `targetRequirementSheetId` INTEGER NULL,
    `plannedNextRsHint` VARCHAR(128) NULL,
    `productionShortfallResolutionId` INTEGER NULL,

    UNIQUE INDEX `CarryForwardPending_productionShortfallResolutionId_key`(`productionShortfallResolutionId`),
    INDEX `CarryForwardPending_salesOrderId_status_idx`(`salesOrderId`, `status`),
    INDEX `CarryForwardPending_itemId_status_idx`(`itemId`, `status`),
    INDEX `CarryForwardPending_sourceWorkOrderId_idx`(`sourceWorkOrderId`),
    INDEX `CarryForwardPending_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `WorkOrderLine` ADD COLUMN `executionWaivedQty` DECIMAL(18, 3) NULL;

ALTER TABLE `WorkOrderProductionExecution` ADD CONSTRAINT `WorkOrderProductionExecution_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `WorkOrderProductionExecution` ADD CONSTRAINT `WorkOrderProductionExecution_blockedByUserId_fkey` FOREIGN KEY (`blockedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WorkOrderProductionExecution` ADD CONSTRAINT `WorkOrderProductionExecution_resumedByUserId_fkey` FOREIGN KEY (`resumedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `WorkOrderProductionExecution` ADD CONSTRAINT `WorkOrderProductionExecution_completedByUserId_fkey` FOREIGN KEY (`completedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionShortfallResolution` ADD CONSTRAINT `ProductionShortfallResolution_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ProductionShortfallResolution` ADD CONSTRAINT `ProductionShortfallResolution_workOrderLineId_fkey` FOREIGN KEY (`workOrderLineId`) REFERENCES `WorkOrderLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `ProductionShortfallResolution` ADD CONSTRAINT `ProductionShortfallResolution_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_sourceRequirementSheetId_fkey` FOREIGN KEY (`sourceRequirementSheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_sourceWorkOrderId_fkey` FOREIGN KEY (`sourceWorkOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_cycleId_fkey` FOREIGN KEY (`cycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_targetRequirementSheetId_fkey` FOREIGN KEY (`targetRequirementSheetId`) REFERENCES `RequirementSheet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `CarryForwardPending` ADD CONSTRAINT `CarryForwardPending_productionShortfallResolutionId_fkey` FOREIGN KEY (`productionShortfallResolutionId`) REFERENCES `ProductionShortfallResolution`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
