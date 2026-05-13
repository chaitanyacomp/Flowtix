-- Company Profile branding: additive, nullable fields on AppSetting (singleton id=1).
-- Used for document branding (Quotation, Sales/Purchase Bills, future exports).
-- DOES NOT change GST math, Tally export, document numbering, or any calculation.

ALTER TABLE `AppSetting`
  ADD COLUMN `companyName` VARCHAR(160) NULL,
  ADD COLUMN `companyAddressLine1` VARCHAR(160) NULL,
  ADD COLUMN `companyAddressLine2` VARCHAR(160) NULL,
  ADD COLUMN `companyCity` VARCHAR(96) NULL,
  ADD COLUMN `companyPincode` VARCHAR(12) NULL,
  ADD COLUMN `companyPan` VARCHAR(10) NULL,
  ADD COLUMN `companyMobile` VARCHAR(32) NULL,
  ADD COLUMN `companyPhone` VARCHAR(32) NULL,
  ADD COLUMN `companyEmail` VARCHAR(160) NULL,
  ADD COLUMN `companyWebsite` VARCHAR(160) NULL,
  ADD COLUMN `companyLogoPath` VARCHAR(255) NULL,
  ADD COLUMN `companyLogoMime` VARCHAR(64) NULL,
  ADD COLUMN `companySignatoryName` VARCHAR(160) NULL,
  ADD COLUMN `companySignaturePath` VARCHAR(255) NULL,
  ADD COLUMN `companySignatureMime` VARCHAR(64) NULL;
