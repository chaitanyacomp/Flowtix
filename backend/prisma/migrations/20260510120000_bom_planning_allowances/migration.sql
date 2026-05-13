ALTER TABLE `BomLine`
ADD COLUMN `processLossPercent` DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN `qcAllowancePercent` DECIMAL(18,3) NOT NULL DEFAULT 0,
ADD COLUMN `notes` TEXT;

UPDATE `BomLine`
SET `processLossPercent` = `wastagePercent`
WHERE `processLossPercent` = 0 AND `wastagePercent` <> 0;
