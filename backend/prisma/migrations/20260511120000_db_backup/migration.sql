-- CreateTable
CREATE TABLE `DbBackup` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fileName` VARCHAR(255) NOT NULL,
    `filePath` VARCHAR(1024) NOT NULL,
    `fileSizeBytes` BIGINT NULL,
    `backupType` ENUM('MANUAL', 'PRE_RESTORE_AUTO') NOT NULL,
    `status` ENUM('CREATED', 'FAILED', 'RESTORED') NOT NULL,
    `createdByUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `restoredAt` DATETIME(3) NULL,
    `remarks` TEXT NULL,

    INDEX `DbBackup_createdAt_idx`(`createdAt`),
    INDEX `DbBackup_backupType_status_idx`(`backupType`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DbBackup` ADD CONSTRAINT `DbBackup_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
