-- Stock adjustment admin approval tracking:
-- - Store the approving admin user id on StockTransaction (approvedByUserId)

ALTER TABLE `StockTransaction`
  ADD COLUMN `approvedByUserId` INTEGER NULL;

CREATE INDEX `StockTransaction_approvedByUserId_idx` ON `StockTransaction`(`approvedByUserId`);

ALTER TABLE `StockTransaction`
  ADD CONSTRAINT `StockTransaction_approvedByUserId_fkey`
  FOREIGN KEY (`approvedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

