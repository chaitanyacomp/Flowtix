-- NO_QTY dispatch: persist WO/production/QC FIFO attribution for finalize/reverse traceability.
-- Dispatch scope remains SO + FG + cycle; these rows are not a WO gate.

CREATE TABLE `DispatchFgTraceAllocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dispatchId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `cycleId` INTEGER NULL,
    `workOrderId` INTEGER NULL,
    `productionId` INTEGER NULL,
    `qcEntryId` INTEGER NULL,
    `allocatedQty` DECIMAL(18, 3) NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DispatchFgTraceAllocation_dispatchId_idx`(`dispatchId`),
    INDEX `DispatchFgTraceAllocation_itemId_idx`(`itemId`),
    INDEX `DispatchFgTraceAllocation_cycleId_idx`(`cycleId`),
    INDEX `DispatchFgTraceAllocation_workOrderId_idx`(`workOrderId`),
    INDEX `DispatchFgTraceAllocation_productionId_idx`(`productionId`),
    INDEX `DispatchFgTraceAllocation_qcEntryId_idx`(`qcEntryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DispatchFgTraceAllocation`
  ADD CONSTRAINT `DispatchFgTraceAllocation_dispatchId_fkey`
    FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `DispatchFgTraceAllocation_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `DispatchFgTraceAllocation_cycleId_fkey`
    FOREIGN KEY (`cycleId`) REFERENCES `SalesOrderCycle`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `DispatchFgTraceAllocation_workOrderId_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `DispatchFgTraceAllocation_productionId_fkey`
    FOREIGN KEY (`productionId`) REFERENCES `ProductionEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `DispatchFgTraceAllocation_qcEntryId_fkey`
    FOREIGN KEY (`qcEntryId`) REFERENCES `QcEntry`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
