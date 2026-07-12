-- Phase 2 — Extend WastageType master (code, category, description)
-- Preserves existing rows and ProductionWorkOrderReportWastageDetail FKs.

ALTER TABLE `WastageType`
  ADD COLUMN `code` VARCHAR(32) NULL,
  ADD COLUMN `category` ENUM('PROCESS', 'SETUP', 'QUALITY', 'MACHINE', 'MATERIAL', 'TRIAL', 'BREAKDOWN', 'MISC') NOT NULL DEFAULT 'MISC',
  ADD COLUMN `description` VARCHAR(500) NULL;

CREATE UNIQUE INDEX `WastageType_code_key` ON `WastageType`(`code`);
CREATE INDEX `WastageType_category_isActive_idx` ON `WastageType`(`category`, `isActive`);

-- Backfill categories for seeded defaults.
UPDATE `WastageType` SET `category` = 'PROCESS' WHERE `name` IN ('Purging', 'Runner / Sprue', 'Spillage');
UPDATE `WastageType` SET `category` = 'SETUP' WHERE `name` IN ('Machine Setting', 'Colour Change');
UPDATE `WastageType` SET `category` = 'MATERIAL' WHERE `name` IN ('Material Handling', 'Moisture Loss');
UPDATE `WastageType` SET `category` = 'TRIAL' WHERE `name` = 'Trial Production';
UPDATE `WastageType` SET `category` = 'BREAKDOWN' WHERE `name` = 'Machine Breakdown';
UPDATE `WastageType` SET `category` = 'QUALITY' WHERE `name` = 'QC Rejection';
UPDATE `WastageType` SET `category` = 'MISC' WHERE `name` = 'Other';
