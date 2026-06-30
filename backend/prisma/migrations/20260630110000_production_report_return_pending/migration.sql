-- Mandatory Production Report before WO closure, plus Store-owned RM return pending queue.

CREATE TABLE `ProductionWorkOrderReport` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `workOrderId` INTEGER NOT NULL,
  `status` ENUM('CONFIRMED') NOT NULL DEFAULT 'CONFIRMED',
  `plannedQty` DECIMAL(18, 3) NOT NULL,
  `producedQty` DECIMAL(18, 3) NOT NULL,
  `remainingQty` DECIMAL(18, 3) NOT NULL,
  `remarks` TEXT NULL,
  `confirmedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmedByUserId` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `ProductionWorkOrderReport_workOrderId_key` (`workOrderId`),
  INDEX `ProductionWorkOrderReport_status_idx` (`status`),
  INDEX `ProductionWorkOrderReport_confirmedAt_idx` (`confirmedAt`),
  INDEX `ProductionWorkOrderReport_confirmedByUserId_idx` (`confirmedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionWorkOrderReportLine` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `productionReportId` INTEGER NOT NULL,
  `itemId` INTEGER NOT NULL,
  `rmIssuedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `rmConsumedQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `rmReturnQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `scrapWasteQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `varianceQty` DECIMAL(18, 3) NOT NULL DEFAULT 0,
  `remarks` TEXT NULL,

  UNIQUE INDEX `ProductionWorkOrderReportLine_report_item_key` (`productionReportId`, `itemId`),
  INDEX `ProductionWorkOrderReportLine_itemId_idx` (`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ProductionRmReturnPending` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `productionReportId` INTEGER NOT NULL,
  `workOrderId` INTEGER NOT NULL,
  `itemId` INTEGER NOT NULL,
  `requestedQty` DECIMAL(18, 3) NOT NULL,
  `status` ENUM('PENDING', 'RECEIVED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  `materialReturnNoteId` INTEGER NULL,
  `remarks` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `receivedAt` DATETIME(3) NULL,
  `receivedByUserId` INTEGER NULL,

  INDEX `ProductionRmReturnPending_productionReportId_idx` (`productionReportId`),
  INDEX `ProductionRmReturnPending_workOrderId_idx` (`workOrderId`),
  INDEX `ProductionRmReturnPending_itemId_idx` (`itemId`),
  INDEX `ProductionRmReturnPending_status_idx` (`status`),
  INDEX `ProductionRmReturnPending_materialReturnNoteId_idx` (`materialReturnNoteId`),
  INDEX `ProductionRmReturnPending_receivedByUserId_idx` (`receivedByUserId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ProductionWorkOrderReport`
  ADD CONSTRAINT `ProductionWorkOrderReport_workOrderId_fkey`
  FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductionWorkOrderReport`
  ADD CONSTRAINT `ProductionWorkOrderReport_confirmedByUserId_fkey`
  FOREIGN KEY (`confirmedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionWorkOrderReportLine`
  ADD CONSTRAINT `ProductionWorkOrderReportLine_productionReportId_fkey`
  FOREIGN KEY (`productionReportId`) REFERENCES `ProductionWorkOrderReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductionWorkOrderReportLine`
  ADD CONSTRAINT `ProductionWorkOrderReportLine_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductionRmReturnPending`
  ADD CONSTRAINT `ProductionRmReturnPending_productionReportId_fkey`
  FOREIGN KEY (`productionReportId`) REFERENCES `ProductionWorkOrderReport`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `ProductionRmReturnPending`
  ADD CONSTRAINT `ProductionRmReturnPending_workOrderId_fkey`
  FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductionRmReturnPending`
  ADD CONSTRAINT `ProductionRmReturnPending_itemId_fkey`
  FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `ProductionRmReturnPending`
  ADD CONSTRAINT `ProductionRmReturnPending_materialReturnNoteId_fkey`
  FOREIGN KEY (`materialReturnNoteId`) REFERENCES `MaterialReturnNote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `ProductionRmReturnPending`
  ADD CONSTRAINT `ProductionRmReturnPending_receivedByUserId_fkey`
  FOREIGN KEY (`receivedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
