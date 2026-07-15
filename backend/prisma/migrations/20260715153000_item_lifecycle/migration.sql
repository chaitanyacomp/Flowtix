-- Audit-safe Item lifecycle: referenced masters are deactivated, not deleted.
ALTER TABLE `Item` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true;
CREATE INDEX `Item_isActive_idx` ON `Item`(`isActive`);
