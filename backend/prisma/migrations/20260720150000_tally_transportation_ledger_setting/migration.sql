-- Persist Sales Bill Tally transportation/freight ledger mapping (admin-configurable).
-- Env TALLY_TRANSPORTATION_LEDGER remains a fallback when this column is empty.

ALTER TABLE `AppSetting`
ADD COLUMN `tallyTransportationLedger` VARCHAR(160) NULL;
