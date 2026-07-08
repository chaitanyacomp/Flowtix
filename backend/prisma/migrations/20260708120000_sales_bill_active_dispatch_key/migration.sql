-- One active (DRAFT/FINALIZED) sales bill per dispatch; billing adjustment flag after dispatch reversal.
ALTER TABLE `SalesBill`
  ADD COLUMN `activeBillDispatchKey` INTEGER NULL,
  ADD COLUMN `billingAdjustmentRequired` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `billingAdjustmentRequiredAt` DATETIME(3) NULL,
  ADD COLUMN `billingAdjustmentReason` TEXT NULL;

UPDATE `SalesBill`
SET `activeBillDispatchKey` = `dispatchId`
WHERE `status` IN ('DRAFT', 'FINALIZED') AND `cancelledAt` IS NULL;

CREATE UNIQUE INDEX `SalesBill_activeBillDispatchKey_key` ON `SalesBill`(`activeBillDispatchKey`);
