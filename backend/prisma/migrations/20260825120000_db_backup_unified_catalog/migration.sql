-- Unify Admin UI + CLI backup catalog (Phase 1).
-- Additive / backward-compatible: existing MANUAL + PRE_RESTORE_AUTO rows remain valid.
-- Does not move or delete backup files on disk.

-- Expand backup source enum
ALTER TABLE `DbBackup`
  MODIFY COLUMN `backupType` ENUM(
    'MANUAL',
    'DEPLOYMENT',
    'AUTOMATIC',
    'PRE_RESTORE_AUTO'
  ) NOT NULL;

-- Allow CLI/system rows without an acting user
ALTER TABLE `DbBackup` DROP FOREIGN KEY `DbBackup_createdByUserId_fkey`;

ALTER TABLE `DbBackup`
  MODIFY COLUMN `createdByUserId` INTEGER NULL;

ALTER TABLE `DbBackup`
  ADD CONSTRAINT `DbBackup_createdByUserId_fkey`
  FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Validation metadata for successful (and failed) catalog rows
ALTER TABLE `DbBackup`
  ADD COLUMN `checksumSha256` VARCHAR(64) NULL AFTER `fileSizeBytes`,
  ADD COLUMN `userCount` INTEGER NULL AFTER `checksumSha256`,
  ADD COLUMN `activeAdminCount` INTEGER NULL AFTER `userCount`,
  ADD COLUMN `validationWarnings` VARCHAR(512) NULL AFTER `activeAdminCount`;
