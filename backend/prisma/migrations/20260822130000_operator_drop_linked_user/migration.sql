-- Drop unique ERP-user link from Operator Master.
-- One PRODUCTION ERP user may start/record shifts for many operators; operators are not uniquely tied to users.

ALTER TABLE `Operator` DROP FOREIGN KEY `Operator_linkedUserId_fkey`;

DROP INDEX `Operator_linkedUserId_key` ON `Operator`;

ALTER TABLE `Operator` DROP COLUMN `linkedUserId`;
