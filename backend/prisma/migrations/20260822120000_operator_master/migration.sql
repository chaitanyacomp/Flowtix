-- Step 2 — Operator Master (production operator register). Soft-deactivate only.

CREATE TABLE `Operator` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `operatorCode` VARCHAR(32) NOT NULL,
    `operatorName` VARCHAR(120) NOT NULL,
    `employeeNumber` VARCHAR(64) NULL,
    `department` VARCHAR(120) NULL,
    `designationSkill` VARCHAR(120) NULL,
    `linkedUserId` INTEGER NULL,
    `remarks` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Operator_operatorCode_key`(`operatorCode`),
    UNIQUE INDEX `Operator_employeeNumber_key`(`employeeNumber`),
    UNIQUE INDEX `Operator_linkedUserId_key`(`linkedUserId`),
    INDEX `Operator_isActive_operatorName_idx`(`isActive`, `operatorName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Operator` ADD CONSTRAINT `Operator_linkedUserId_fkey` FOREIGN KEY (`linkedUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
