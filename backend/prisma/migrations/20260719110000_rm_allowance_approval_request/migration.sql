-- Planned Process Allowance Admin approval requests (above 5% through 10%).
-- No stock movement until Store issues after APPROVED.
-- Index/FK names shortened for MySQL 64-char identifier limit.

CREATE TABLE `RmAllowanceApprovalRequest` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `requestNo` VARCHAR(32) NULL,
    `workOrderId` INTEGER NOT NULL,
    `productionMaterialRequestId` INTEGER NOT NULL,
    `pmrLineId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `theoreticalBomQty` DECIMAL(18, 6) NOT NULL,
    `applicableBomQty` DECIMAL(18, 6) NOT NULL,
    `alreadyIssuedQty` DECIMAL(18, 6) NOT NULL,
    `addQty` DECIMAL(18, 6) NOT NULL,
    `allowancePct` DECIMAL(7, 4) NOT NULL,
    `issueQty` DECIMAL(18, 6) NOT NULL,
    `availableQtyAtRequest` DECIMAL(18, 6) NULL,
    `storeReason` VARCHAR(500) NOT NULL,
    `status` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ISSUED', 'CANCELLED', 'SUPERSEDED') NOT NULL DEFAULT 'PENDING_APPROVAL',
    `requestedByUserId` INTEGER NOT NULL,
    `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedByUserId` INTEGER NULL,
    `reviewedAt` DATETIME(3) NULL,
    `rejectionReason` VARCHAR(500) NULL,
    `materialIssueNoteId` INTEGER NULL,
    `issuedAt` DATETIME(3) NULL,
    `issuedByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `RmAllowanceApprovalRequest_requestNo_key`(`requestNo`),
    INDEX `RmAllwAppr_wo_status_idx`(`workOrderId`, `status`),
    INDEX `RmAllwAppr_pmr_status_idx`(`productionMaterialRequestId`, `status`),
    INDEX `RmAllwAppr_line_status_idx`(`pmrLineId`, `status`),
    INDEX `RmAllwAppr_item_idx`(`itemId`),
    INDEX `RmAllwAppr_status_reqAt_idx`(`status`, `requestedAt`),
    INDEX `RmAllwAppr_reqBy_idx`(`requestedByUserId`),
    INDEX `RmAllwAppr_revBy_idx`(`reviewedByUserId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_wo_fkey` FOREIGN KEY (`workOrderId`) REFERENCES `WorkOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_pmr_fkey` FOREIGN KEY (`productionMaterialRequestId`) REFERENCES `ProductionMaterialRequest`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_pmrLine_fkey` FOREIGN KEY (`pmrLineId`) REFERENCES `ProductionMaterialRequestLine`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_item_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_reqBy_fkey` FOREIGN KEY (`requestedByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_revBy_fkey` FOREIGN KEY (`reviewedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_issBy_fkey` FOREIGN KEY (`issuedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `RmAllowanceApprovalRequest` ADD CONSTRAINT `RmAllwAppr_min_fkey` FOREIGN KEY (`materialIssueNoteId`) REFERENCES `MaterialIssueNote`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
