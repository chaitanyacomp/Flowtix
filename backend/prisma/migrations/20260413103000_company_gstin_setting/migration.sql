-- Step 2: Company GST details stabilization (GSTIN on AppSetting)
-- Backward-safe: nullable field; no validation or constraints added here.

ALTER TABLE `AppSetting` ADD COLUMN `companyGstin` VARCHAR(15) NULL;

