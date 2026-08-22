-- Step 3 — Shift Master (production shift templates). Soft-deactivate only.
-- Times stored as HH:mm strings (time-of-day; no timezone conversion).

CREATE TABLE `Shift` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shiftCode` VARCHAR(32) NOT NULL,
    `shiftName` VARCHAR(120) NOT NULL,
    `startTime` VARCHAR(8) NOT NULL,
    `endTime` VARCHAR(8) NOT NULL,
    `plannedBreakMinutes` INTEGER NOT NULL DEFAULT 0,
    `remarks` VARCHAR(500) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Shift_shiftCode_key`(`shiftCode`),
    INDEX `Shift_isActive_shiftName_idx`(`isActive`, `shiftName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
