-- QC rejection reason: stable catalog code + existing free-text description column.
ALTER TABLE `QcEntry` ADD COLUMN `rejectionReasonCode` VARCHAR(48) NULL;
CREATE INDEX `QcEntry_rejectionReasonCode_idx` ON `QcEntry`(`rejectionReasonCode`);
