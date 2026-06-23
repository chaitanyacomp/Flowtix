-- P11 follow-up — FG Green Level source (MANUAL vs AUTOMATIC) and per-FG manual qty.
ALTER TABLE `AppSetting` ADD COLUMN `greenLevelSource` VARCHAR(16) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE `Item` ADD COLUMN `fgManualGreenLevelQty` DECIMAL(18, 3) NULL;
