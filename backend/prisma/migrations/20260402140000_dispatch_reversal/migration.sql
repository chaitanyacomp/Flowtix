-- Dispatch reversal: optional link to original row + reason; negative dispatchedQty on reversal rows.
ALTER TABLE `Dispatch` ADD COLUMN `reversalOfId` INTEGER NULL,
    ADD COLUMN `reversalReason` VARCHAR(191) NULL;

CREATE INDEX `Dispatch_reversalOfId_idx` ON `Dispatch`(`reversalOfId`);

ALTER TABLE `Dispatch` ADD CONSTRAINT `Dispatch_reversalOfId_fkey` FOREIGN KEY (`reversalOfId`) REFERENCES `Dispatch`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stock ledger type for reversal (restores FG to stock).
ALTER TABLE `StockTransaction` MODIFY COLUMN `transactionType` ENUM(
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'ADJUSTMENT',
    'DISPATCH_REVERSAL'
) NOT NULL;
