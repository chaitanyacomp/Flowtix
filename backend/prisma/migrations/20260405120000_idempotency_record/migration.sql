-- Idempotency-Key storage for dispatch (and future critical POSTs).
CREATE TABLE `IdempotencyRecord` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `routeKey` VARCHAR(64) NOT NULL,
    `idempotencyKey` VARCHAR(255) NOT NULL,
    `requestBodyHash` VARCHAR(64) NOT NULL,
    `responseStatus` INTEGER NULL,
    `responseBody` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `IdempotencyRecord_userId_routeKey_idempotencyKey_key`(`userId`, `routeKey`, `idempotencyKey`),
    INDEX `IdempotencyRecord_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `IdempotencyRecord` ADD CONSTRAINT `IdempotencyRecord_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
