-- QC rejected-material workflow: disposition tracking + SUPERVISOR role + QcEntry.rejectedRoute

ALTER TABLE `User`
  MODIFY `role` ENUM('ADMIN', 'SALES', 'STORE', 'PRODUCTION', 'QC', 'SUPERVISOR') NOT NULL;

ALTER TABLE `QcEntry`
  ADD COLUMN `rejectedRoute` ENUM('REWORK', 'HOLD', 'SCRAP', 'USABLE') NULL;

CREATE TABLE `QcRejectedDisposition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sourceQcEntryId` INTEGER NOT NULL,
    `workOrderId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `remainingQty` DECIMAL(18, 3) NOT NULL,
    `phase` ENUM('FIRST_QC', 'RECHECK') NOT NULL DEFAULT 'FIRST_QC',
    `status` ENUM(
      'REWORK_PENDING_SUPERVISOR',
      'REWORK_READY_FOR_QC',
      'HOLD',
      'SCRAP',
      'CLOSED'
    ) NOT NULL,
    `remarks` TEXT NULL,
    `createdByUserId` INTEGER NULL,
    `supervisorApprovedByUserId` INTEGER NULL,
    `supervisorApprovedAt` DATETIME(3) NULL,
    `supervisorDeniedAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `voidedAt` DATETIME(3) NULL,
    `parentDispositionId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `QcRejectedDisposition_sourceQcEntryId_idx`(`sourceQcEntryId`),
    INDEX `QcRejectedDisposition_workOrderId_idx`(`workOrderId`),
    INDEX `QcRejectedDisposition_itemId_idx`(`itemId`),
    INDEX `QcRejectedDisposition_status_idx`(`status`),
    INDEX `QcRejectedDisposition_voidedAt_idx`(`voidedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `QcRejectedDisposition`
  ADD CONSTRAINT `QcRejectedDisposition_sourceQcEntryId_fkey`
    FOREIGN KEY (`sourceQcEntryId`) REFERENCES `QcEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `QcRejectedDisposition_workOrderId_fkey`
    FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `QcRejectedDisposition_itemId_fkey`
    FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `QcRejectedDisposition_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `QcRejectedDisposition_supervisorApprovedByUserId_fkey`
    FOREIGN KEY (`supervisorApprovedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `QcRejectedDisposition_parentDispositionId_fkey`
    FOREIGN KEY (`parentDispositionId`) REFERENCES `QcRejectedDisposition`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
