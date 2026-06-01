-- Supplier master: active flag + normalized supply locations (Tally-compatible foundation)

ALTER TABLE `Supplier` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `Supplier_gst_idx` ON `Supplier`(`gst`);
CREATE INDEX `Supplier_isActive_idx` ON `Supplier`(`isActive`);

CREATE TABLE `SupplierLocation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `supplierId` INTEGER NOT NULL,
    `label` VARCHAR(128) NOT NULL,
    `address` TEXT NULL,
    `city` VARCHAR(128) NULL,
    `stateId` INTEGER NULL,
    `gst` VARCHAR(15) NULL,
    `contactPerson` VARCHAR(128) NULL,
    `phone` VARCHAR(32) NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `SupplierLocation_supplierId_idx`(`supplierId`),
    INDEX `SupplierLocation_stateId_idx`(`stateId`),
    INDEX `SupplierLocation_gst_idx`(`gst`),
    INDEX `SupplierLocation_isDefault_idx`(`isDefault`),
    INDEX `SupplierLocation_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `SupplierLocation` ADD CONSTRAINT `SupplierLocation_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `SupplierLocation` ADD CONSTRAINT `SupplierLocation_stateId_fkey` FOREIGN KEY (`stateId`) REFERENCES `State`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill one default supply location from existing registered office address (no GST copy — avoids duplicate GSTIN).
INSERT INTO `SupplierLocation` (
    `supplierId`, `label`, `address`, `city`, `stateId`, `gst`, `contactPerson`, `phone`, `isDefault`, `isActive`, `createdAt`, `updatedAt`
)
SELECT
    s.`id`,
    'Registered Office',
    s.`address`,
    NULL,
    s.`stateId`,
    NULL,
    s.`contact`,
    s.`contact`,
    true,
    true,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `Supplier` s
WHERE s.`address` IS NOT NULL AND TRIM(s.`address`) <> '';
