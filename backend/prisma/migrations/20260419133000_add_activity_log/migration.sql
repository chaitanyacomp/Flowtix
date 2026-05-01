-- CreateTable
CREATE TABLE `ActivityLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `userId` INTEGER NULL,
    `userNameSnapshot` VARCHAR(256) NULL,
    `module` VARCHAR(64) NOT NULL,
    `entityType` VARCHAR(64) NOT NULL,
    `entityId` INTEGER NULL,
    `docNo` VARCHAR(64) NULL,
    `action` VARCHAR(64) NOT NULL,
    `subAction` VARCHAR(64) NULL,
    `message` VARCHAR(512) NOT NULL,
    `reason` TEXT NULL,
    `metadataJson` JSON NULL,
    `createdByRole` VARCHAR(32) NULL,

    INDEX `ActivityLog_module_createdAt_idx`(`module`, `createdAt`),
    INDEX `ActivityLog_entityType_entityId_idx`(`entityType`, `entityId`),
    INDEX `ActivityLog_docNo_idx`(`docNo`),
    INDEX `ActivityLog_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ActivityLog` ADD CONSTRAINT `ActivityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
