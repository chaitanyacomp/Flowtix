-- Stock adjustment audit + full reversal linkage
ALTER TABLE `StockTransaction` ADD COLUMN `createdByUserId` INTEGER NULL;
ALTER TABLE `StockTransaction` ADD COLUMN `reversalOfId` INTEGER NULL;
ALTER TABLE `StockTransaction` ADD COLUMN `reversedAt` DATETIME(3) NULL;
ALTER TABLE `StockTransaction` ADD COLUMN `reversedByUserId` INTEGER NULL;

CREATE INDEX `StockTransaction_reversalOfId_idx` ON `StockTransaction`(`reversalOfId`);

ALTER TABLE `StockTransaction` ADD CONSTRAINT `StockTransaction_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StockTransaction` ADD CONSTRAINT `StockTransaction_reversedByUserId_fkey` FOREIGN KEY (`reversedByUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `StockTransaction` ADD CONSTRAINT `StockTransaction_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `StockTransaction`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
