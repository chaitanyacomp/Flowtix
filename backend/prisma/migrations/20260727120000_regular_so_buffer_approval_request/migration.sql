-- REGULAR_SO Prepare WO production buffer Admin approval (above 5% through 10%).
-- Index/FK names shortened for MySQL 64-char identifier limit.

CREATE TABLE `RegularSoBufferApprovalRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestNo` VARCHAR(32) NULL,
    `salesOrderId` INTEGER NOT NULL,
    `fgItemId` INTEGER NULL,
    `bufferPercent` DECIMAL(18, 2) NOT NULL,
    `plannedProductionQty` DECIMAL(18, 3) NOT NULL,
    `storeReason` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `requestedByUserId` INTEGER NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedByUserId` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `adminRemarks` VARCHAR(500) NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RegularSoBufferApprovalRequest_requestNo_key`(`requestNo`),
    INDEX `RegSoBufAppr_so_status_idx`(`salesOrderId`, `status`),
    INDEX `RegSoBufAppr_status_reqAt_idx`(`status`, `requestedAt`),
    INDEX `RegSoBufAppr_reqBy_idx`(`requestedByUserId`),
    INDEX `RegSoBufAppr_revBy_idx`(`reviewedByUserId`),
    INDEX `RegSoBufAppr_fg_idx`(`fgItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RegularSoBufferApprovalRequest` ADD CONSTRAINT `RegSoBufAppr_so_fkey` FOREIGN KEY (`salesOrderId`) REFERENCES `SalesOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `RegularSoBufferApprovalRequest` ADD CONSTRAINT `RegSoBufAppr_fg_fkey` FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RegularSoBufferApprovalRequest` ADD CONSTRAINT `RegSoBufAppr_reqBy_fkey` FOREIGN KEY (`requestedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RegularSoBufferApprovalRequest` ADD CONSTRAINT `RegSoBufAppr_revBy_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
