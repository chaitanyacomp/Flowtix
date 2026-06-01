-- Phase 2: SalesBill invoice-grade commercial snapshots (Bill To / Ship To / POS)
-- Backward compatible: defaults to empty string; existing bills unchanged.

ALTER TABLE `SalesBill`
  ADD COLUMN `billToAddressSnapshot` TEXT NOT NULL DEFAULT (''),
  ADD COLUMN `billToGstinSnapshot` VARCHAR(15) NOT NULL DEFAULT '',
  ADD COLUMN `shipToLabelSnapshot` VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN `shipToAddressSnapshot` TEXT NOT NULL DEFAULT (''),
  ADD COLUMN `shipToGstinSnapshot` VARCHAR(15) NOT NULL DEFAULT '',
  ADD COLUMN `shipToStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN `shipToStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '',
  ADD COLUMN `posStateNameSnapshot` VARCHAR(128) NOT NULL DEFAULT '',
  ADD COLUMN `posStateCodeSnapshot` VARCHAR(2) NOT NULL DEFAULT '',
  ADD COLUMN `posSourceSnapshot` VARCHAR(32) NOT NULL DEFAULT '';
