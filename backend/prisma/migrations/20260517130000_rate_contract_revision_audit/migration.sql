-- Rate contracts are billing-critical and must remain append-only for approved history.
ALTER TABLE `RateContractLine`
  MODIFY COLUMN `status` ENUM('APPROVED', 'SUPERSEDED', 'INACTIVE') NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN `revisedFromId` INT NULL,
  ADD COLUMN `createdByUserId` INT NULL,
  ADD COLUMN `deactivatedAt` DATETIME(3) NULL,
  ADD COLUMN `deactivatedByUserId` INT NULL,
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE INDEX `RateContractLine_revisedFromId_idx` ON `RateContractLine`(`revisedFromId`);
CREATE INDEX `RateContractLine_createdByUserId_idx` ON `RateContractLine`(`createdByUserId`);
CREATE INDEX `RateContractLine_deactivatedByUserId_idx` ON `RateContractLine`(`deactivatedByUserId`);

ALTER TABLE `RateContractLine`
  ADD CONSTRAINT `RateContractLine_revisedFromId_fkey`
    FOREIGN KEY (`revisedFromId`) REFERENCES `RateContractLine`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `RateContractLine_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `RateContractLine_deactivatedByUserId_fkey`
    FOREIGN KEY (`deactivatedByUserId`) REFERENCES `User`(`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
