-- Audit-safe cancellation metadata for MaterialRequirement.

ALTER TABLE `MaterialRequirement`
  ADD COLUMN `reversedAt` DATETIME(3) NULL,
  ADD COLUMN `reversedByUserId` INT NULL,
  ADD COLUMN `reversalReason` TEXT NULL,
  ADD INDEX `MaterialRequirement_reversedByUserId_idx`(`reversedByUserId`),
  ADD CONSTRAINT `MaterialRequirement_reversedByUserId_fkey`
    FOREIGN KEY (`reversedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
