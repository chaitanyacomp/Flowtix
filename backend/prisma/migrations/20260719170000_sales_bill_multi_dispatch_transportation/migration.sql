-- Multi-dispatch billing with quantity reservations and reproducible transportation GST snapshots.
ALTER TABLE `SalesBill`
  MODIFY `dispatchId` INTEGER NULL,
  ADD COLUMN `soId` INTEGER NULL,
  ADD COLUMN `goodsTaxableValue` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transportationAmount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transportationChargedBy` ENUM('OUR_COMPANY','TRANSPORTER_DIRECTLY') NOT NULL DEFAULT 'OUR_COMPANY',
  ADD COLUMN `transportationAllocationMethod` ENUM('PROPORTIONAL_TAXABLE_VALUE','NOT_APPLICABLE') NOT NULL DEFAULT 'PROPORTIONAL_TAXABLE_VALUE',
  ADD COLUMN `transportationTaxableValue` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transporterName` VARCHAR(256) NULL,
  ADD COLUMN `transportationReferenceNo` VARCHAR(128) NULL,
  ADD COLUMN `transportationRemarks` TEXT NULL,
  ADD COLUMN `roundOffAmount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `calculationVersion` VARCHAR(32) NOT NULL DEFAULT 'LEGACY_V1',
  ADD COLUMN `calculatedAt` DATETIME(3) NULL,
  ADD COLUMN `calculatedById` INTEGER NULL;

UPDATE `SalesBill` sb
JOIN `Dispatch` d ON d.`id` = sb.`dispatchId`
SET sb.`soId` = d.`soId`,
    sb.`goodsTaxableValue` = sb.`totalBasic`,
    sb.`calculatedAt` = COALESCE(sb.`finalizedAt`, sb.`updatedAt`)
WHERE sb.`dispatchId` IS NOT NULL;

CREATE INDEX `SalesBill_soId_idx` ON `SalesBill`(`soId`);
ALTER TABLE `SalesBill`
  ADD CONSTRAINT `SalesBill_soId_fkey` FOREIGN KEY (`soId`) REFERENCES `SalesOrder`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `SalesBillLine`
  ADD COLUMN `discountRate` DECIMAL(7,4) NOT NULL DEFAULT 0,
  ADD COLUMN `taxTreatmentSnapshot` VARCHAR(32) NOT NULL DEFAULT 'GOODS',
  ADD COLUMN `goodsTaxableAmount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transportationAllocation` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transportationCgstAmount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transportationSgstAmount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN `transportationIgstAmount` DECIMAL(18,2) NOT NULL DEFAULT 0;

UPDATE `SalesBillLine` SET `goodsTaxableAmount` = `basicAmount`;

CREATE TABLE `SalesBillDispatchAllocation` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `salesBillId` INTEGER NOT NULL,
  `salesBillLineId` INTEGER NOT NULL,
  `dispatchId` INTEGER NOT NULL,
  `allocatedQty` DECIMAL(18,3) NOT NULL,
  `createdById` INTEGER NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `finalizedAt` DATETIME(3) NULL,
  UNIQUE INDEX `SalesBillDispatchAllocation_salesBillId_dispatchId_key` (`salesBillId`, `dispatchId`),
  INDEX `SalesBillDispatchAllocation_dispatchId_idx` (`dispatchId`),
  INDEX `SalesBillDispatchAllocation_salesBillLineId_idx` (`salesBillLineId`),
  INDEX `SalesBillDispatchAllocation_salesBillId_finalizedAt_idx` (`salesBillId`, `finalizedAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `SalesBillDispatchAllocation_salesBillId_fkey` FOREIGN KEY (`salesBillId`) REFERENCES `SalesBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SalesBillDispatchAllocation_salesBillLineId_fkey` FOREIGN KEY (`salesBillLineId`) REFERENCES `SalesBillLine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SalesBillDispatchAllocation_dispatchId_fkey` FOREIGN KEY (`dispatchId`) REFERENCES `Dispatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Legacy bills gain allocation trace without changing their lines or historical totals.
INSERT INTO `SalesBillDispatchAllocation`
  (`salesBillId`, `salesBillLineId`, `dispatchId`, `allocatedQty`, `createdAt`, `updatedAt`, `finalizedAt`)
SELECT sb.`id`, sbl.`id`, sb.`dispatchId`, sbl.`qty`, sb.`createdAt`, sb.`updatedAt`,
       CASE WHEN sb.`status` = 'FINALIZED' THEN sb.`finalizedAt` ELSE NULL END
FROM `SalesBill` sb
JOIN `SalesBillLine` sbl ON sbl.`salesBillId` = sb.`id` AND sbl.`dispatchId` = sb.`dispatchId`
WHERE sb.`dispatchId` IS NOT NULL;
