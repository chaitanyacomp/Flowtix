-- Customer master: active flag + normalized delivery addresses (Tally bill-to / ship-to ready)

ALTER TABLE `Customer` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX `Customer_gst_idx` ON `Customer`(`gst`);
CREATE INDEX `Customer_isActive_idx` ON `Customer`(`isActive`);

CREATE TABLE `CustomerDeliveryAddress` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
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

    INDEX `CustomerDeliveryAddress_customerId_idx`(`customerId`),
    INDEX `CustomerDeliveryAddress_stateId_idx`(`stateId`),
    INDEX `CustomerDeliveryAddress_gst_idx`(`gst`),
    INDEX `CustomerDeliveryAddress_isDefault_idx`(`isDefault`),
    INDEX `CustomerDeliveryAddress_isActive_idx`(`isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `CustomerDeliveryAddress` ADD CONSTRAINT `CustomerDeliveryAddress_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `CustomerDeliveryAddress` ADD CONSTRAINT `CustomerDeliveryAddress_stateId_fkey` FOREIGN KEY (`stateId`) REFERENCES `State`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill one default delivery row from existing registered office address (no GST copy — avoids duplicate GSTIN).
INSERT INTO `CustomerDeliveryAddress` (
    `customerId`, `label`, `address`, `city`, `stateId`, `gst`, `contactPerson`, `phone`, `isDefault`, `isActive`, `createdAt`, `updatedAt`
)
SELECT
    c.`id`,
    'Primary',
    c.`address`,
    NULL,
    c.`stateId`,
    NULL,
    c.`contact`,
    c.`contact`,
    true,
    true,
    CURRENT_TIMESTAMP(3),
    CURRENT_TIMESTAMP(3)
FROM `Customer` c
WHERE c.`address` IS NOT NULL AND TRIM(c.`address`) <> '';
