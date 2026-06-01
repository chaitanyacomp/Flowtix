ALTER TABLE `MaterialRequirement`
  ADD COLUMN `fgItemId` INT NULL,
  ADD COLUMN `plannedProductionQty` DECIMAL(18,3) NULL;

CREATE INDEX `MaterialRequirement_fgItemId_idx` ON `MaterialRequirement`(`fgItemId`);

ALTER TABLE `MaterialRequirement`
  ADD CONSTRAINT `MaterialRequirement_fgItemId_fkey`
  FOREIGN KEY (`fgItemId`) REFERENCES `Item`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
