-- BOM header: FG weight-based manufacturing planning (centralized loss %).
ALTER TABLE `Bom`
ADD COLUMN `fgWeight` DECIMAL(18, 4) NULL,
ADD COLUMN `fgWeightUnitId` INTEGER NULL,
ADD COLUMN `outputQty` DECIMAL(18, 3) NOT NULL DEFAULT 1,
ADD COLUMN `processLossPercent` DECIMAL(18, 3) NOT NULL DEFAULT 0,
ADD COLUMN `qcLossPercent` DECIMAL(18, 3) NOT NULL DEFAULT 0;

ALTER TABLE `Bom`
ADD CONSTRAINT `Bom_fgWeightUnitId_fkey` FOREIGN KEY (`fgWeightUnitId`) REFERENCES `Unit`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX `Bom_fgWeightUnitId_idx` ON `Bom`(`fgWeightUnitId`);
