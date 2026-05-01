-- RM PO lifecycle (RmPoStatus) + GRN reversal metadata + remarks.
-- Convert RmPurchaseOrder.status from SimpleStatus to RmPoStatus.
-- Init had single-item RmPurchaseOrder + Grn.receivedQty only; line tables were never created in SQL migrations.

CREATE TABLE IF NOT EXISTS `RmPurchaseOrderLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rmPoId` INTEGER NOT NULL,
    `itemId` INTEGER NOT NULL,
    `qty` DECIMAL(18, 3) NOT NULL,
    `rate` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    INDEX `RmPurchaseOrderLine_rmPoId_idx`(`rmPoId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `RmPurchaseOrderLine_rmPoId_fkey` FOREIGN KEY (`rmPoId`) REFERENCES `RmPurchaseOrder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `RmPurchaseOrderLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `GrnLine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `grnId` INTEGER NOT NULL,
    `rmPoLineId` INTEGER NOT NULL,
    `receivedQty` DECIMAL(18, 3) NOT NULL,
    INDEX `GrnLine_grnId_idx`(`grnId`),
    INDEX `GrnLine_rmPoLineId_idx`(`rmPoLineId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `GrnLine_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `Grn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT `GrnLine_rmPoLineId_fkey` FOREIGN KEY (`rmPoLineId`) REFERENCES `RmPurchaseOrderLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `RmPurchaseOrderLine` (`rmPoId`, `itemId`, `qty`, `rate`)
SELECT po.`id`, po.`itemId`, po.`qty`, 0
FROM `RmPurchaseOrder` po
WHERE NOT EXISTS (SELECT 1 FROM `RmPurchaseOrderLine` l WHERE l.`rmPoId` = po.`id`);

INSERT INTO `GrnLine` (`grnId`, `rmPoLineId`, `receivedQty`)
SELECT g.`id`, l.`id`, g.`receivedQty`
FROM `Grn` g
INNER JOIN `RmPurchaseOrderLine` l ON l.`rmPoId` = g.`rmPoId`
WHERE NOT EXISTS (SELECT 1 FROM `GrnLine` gl WHERE gl.`grnId` = g.`id`);

ALTER TABLE `Grn` ADD COLUMN `reversedAt` DATETIME(3) NULL,
                   ADD COLUMN `reversalReason` TEXT NULL;

CREATE INDEX `Grn_reversedAt_idx` ON `Grn`(`reversedAt`);

ALTER TABLE `RmPurchaseOrder` ADD COLUMN `remarks` TEXT NULL;

ALTER TABLE `RmPurchaseOrder` MODIFY COLUMN `status` VARCHAR(32) NOT NULL DEFAULT 'PENDING';

UPDATE `RmPurchaseOrder` SET `status` = 'CANCELLED' WHERE `status` IN ('REJECTED');
UPDATE `RmPurchaseOrder` SET `status` = 'PENDING' WHERE `status` IN ('IN_PROGRESS');

UPDATE `RmPurchaseOrder` po
SET `status` = 'PARTIAL'
WHERE po.`status` = 'PENDING'
  AND EXISTS (
    SELECT 1 FROM `Grn` g
    WHERE g.`rmPoId` = po.`id` AND g.`reversedAt` IS NULL
  );

UPDATE `RmPurchaseOrder` po
SET `status` = 'COMPLETED'
WHERE po.`status` IN ('PENDING', 'PARTIAL')
  AND EXISTS (SELECT 1 FROM `RmPurchaseOrderLine` l0 WHERE l0.`rmPoId` = po.`id`)
  AND NOT EXISTS (
    SELECT 1 FROM `RmPurchaseOrderLine` l
    WHERE l.`rmPoId` = po.`id`
      AND CAST(l.`qty` AS DECIMAL(18, 3)) > COALESCE(
        (
          SELECT SUM(CAST(gl.`receivedQty` AS DECIMAL(18, 3)))
          FROM `Grn` g
          INNER JOIN `GrnLine` gl ON gl.`grnId` = g.`id`
          WHERE g.`rmPoId` = po.`id` AND g.`reversedAt` IS NULL AND gl.`rmPoLineId` = l.`id`
        ),
        0
      ) + 0.000001
  )
  AND EXISTS (SELECT 1 FROM `Grn` g WHERE g.`rmPoId` = po.`id` AND g.`reversedAt` IS NULL);

ALTER TABLE `RmPurchaseOrder` MODIFY COLUMN `status` ENUM('PENDING', 'PARTIAL', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING';
