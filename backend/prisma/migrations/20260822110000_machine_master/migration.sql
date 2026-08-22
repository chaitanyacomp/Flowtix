-- Step 1 — Machine Master (production equipment register). Soft-deactivate only.

CREATE TABLE `Machine` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `machineCode` VARCHAR(32) NOT NULL,
    `machineName` VARCHAR(120) NOT NULL,
    `machineType` ENUM('INJECTION_MOULDING', 'BLOW_MOULDING', 'EXTRUSION', 'ASSEMBLY', 'CNC', 'PRESS', 'PACKAGING', 'UTILITY', 'OTHER') NOT NULL,
    `make` VARCHAR(120) NULL,
    `model` VARCHAR(120) NULL,
    `serialNumber` VARCHAR(120) NULL,
    `departmentLocation` VARCHAR(120) NULL,
    `description` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Machine_machineCode_key`(`machineCode`),
    INDEX `Machine_isActive_machineName_idx`(`isActive`, `machineName`),
    INDEX `Machine_machineType_isActive_idx`(`machineType`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
