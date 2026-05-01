-- Add enums for customer return module (follow-up):
-- 1) AuditLog.entityType: add CUSTOMER_RETURN
-- 2) StockTransaction.transactionType: add SCRAP
-- AuditLog was never created in init or prior migrations.

CREATE TABLE IF NOT EXISTS `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action` ENUM(
      'CREATE',
      'UPDATE',
      'DELETE',
      'APPROVE',
      'REJECT',
      'CANCEL',
      'REVERSE',
      'LOGIN',
      'LOGOUT',
      'LOGIN_FAILED',
      'BLOCKED_DELETE'
    ) NOT NULL,
    `entityType` ENUM(
      'ITEM',
      'CUSTOMER',
      'SUPPLIER',
      'BOM',
      'SALES_ORDER',
      'WORK_ORDER',
      'PRODUCTION_ENTRY',
      'QC_ENTRY',
      'DISPATCH',
      'STOCK_ADJUSTMENT',
      'USER',
      'SETTINGS',
      'USER_SESSION'
    ) NOT NULL,
    `entityId` VARCHAR(64) NULL,
    `actorUserId` INTEGER NULL,
    `actorRole` VARCHAR(32) NULL,
    `summary` VARCHAR(512) NOT NULL,
    `payload` JSON NULL,
    `reason` VARCHAR(512) NULL,
    `ipAddress` VARCHAR(45) NULL,
    `userAgent` VARCHAR(256) NULL,
    INDEX `AuditLog_entityType_entityId_createdAt_idx`(`entityType`, `entityId`, `createdAt`),
    INDEX `AuditLog_actorUserId_createdAt_idx`(`actorUserId`, `createdAt`),
    INDEX `AuditLog_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`),
    CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `AuditLog`
  MODIFY `entityType` ENUM(
    'ITEM',
    'CUSTOMER',
    'SUPPLIER',
    'BOM',
    'SALES_ORDER',
    'WORK_ORDER',
    'PRODUCTION_ENTRY',
    'QC_ENTRY',
    'DISPATCH',
    'STOCK_ADJUSTMENT',
    'CUSTOMER_RETURN',
    'USER',
    'SETTINGS',
    'USER_SESSION'
  ) NOT NULL;

ALTER TABLE `StockTransaction`
  MODIFY `transactionType` ENUM(
    'GRN',
    'ISSUE',
    'PRODUCTION',
    'QC',
    'DISPATCH',
    'SCRAP',
    'ADJUSTMENT',
    'DISPATCH_REVERSAL',
    'QC_REVERSAL',
    'CUSTOMER_RETURN'
  ) NOT NULL;
