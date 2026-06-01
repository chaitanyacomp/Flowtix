ALTER TABLE `Bom`
  ADD COLUMN `normalizationMode` ENUM('PER_PIECE', 'LEGACY_BATCH') NOT NULL DEFAULT 'PER_PIECE' AFTER `status`;

UPDATE `Bom`
SET `normalizationMode` = 'LEGACY_BATCH';
