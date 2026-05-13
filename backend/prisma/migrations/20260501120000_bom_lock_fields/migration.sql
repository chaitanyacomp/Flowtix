-- AlterTable
ALTER TABLE `Bom` ADD COLUMN `isLocked` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `Bom` ADD COLUMN `lockedAt` DATETIME(3) NULL;

-- Backfill lockedAt so existing BOMs show as locked historically
UPDATE `Bom` SET `lockedAt` = `updatedAt` WHERE `lockedAt` IS NULL;
