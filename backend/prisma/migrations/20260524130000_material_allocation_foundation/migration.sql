-- CreateTable
CREATE TABLE `MaterialAllocation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `allocationNo` VARCHAR(32) NULL,
  `rmItemId` INTEGER NOT NULL,
  `salesOrderId` INTEGER NULL,
  `workOrderId` INTEGER NULL,
  `workOrderLineId` INTEGER NULL,
  `productionMaterialRequestId` INTEGER NULL,
  `sourceLocationId` INTEGER NULL,
  `qtyAllocated` DECIMAL(18, 3) NOT NULL,
  `qtyIssued` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE', 'PARTIALLY_ISSUED', 'ISSUED', 'RELEASED', 'CANCELLED') NOT NULL,
  `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
  `allocationType` ENUM('PMR_CREATED', 'MANUAL', 'SYSTEM_MIGRATED') NOT NULL,
  `remarks` TEXT NULL,
  `createdByUserId` INTEGER NULL,
  `releasedByUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,

  UNIQUE INDEX `MaterialAllocation_allocationNo_key`(`allocationNo`),
  INDEX `MaterialAllocation_rmItemId_status_idx`(`rmItemId`, `status`),
  INDEX `MaterialAllocation_salesOrderId_idx`(`salesOrderId`),
  INDEX `MaterialAllocation_workOrderId_idx`(`workOrderId`),
  INDEX `MaterialAllocation_workOrderLineId_idx`(`workOrderLineId`),
  INDEX `MaterialAllocation_productionMaterialRequestId_idx`(`productionMaterialRequestId`),
  INDEX `MaterialAllocation_sourceLocationId_idx`(`sourceLocationId`),
  INDEX `MaterialAllocation_status_idx`(`status`),
  INDEX `MaterialAllocation_createdByUserId_idx`(`createdByUserId`),
  INDEX `MaterialAllocation_releasedByUserId_idx`(`releasedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_rmItemId_fkey` FOREIGN KEY (`rmItemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_salesOrderId_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_workOrderId_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_workOrderLineId_fkey` FOREIGN KEY (`workOrderLineId`) REFERENCES `WorkOrderLine`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_productionMaterialRequestId_fkey` FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_sourceLocationId_fkey` FOREIGN KEY (`sourceLocationId`) REFERENCES `Location`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MaterialAllocation` ADD CONSTRAINT `MaterialAllocation_releasedByUserId_fkey` FOREIGN KEY (`releasedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
