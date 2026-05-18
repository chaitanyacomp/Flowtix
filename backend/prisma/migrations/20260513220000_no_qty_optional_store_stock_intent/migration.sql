-- NO_QTY: dashboard / dispatch UX classification only (does not alter stock or dispatch calculations).
-- MySQL: use backticks (PostgreSQL-style "quoted" identifiers are invalid on MySQL).
ALTER TABLE `SalesOrderCycle` ADD COLUMN `noQtyTreatFgAsOptionalStoreStock` BOOLEAN NOT NULL DEFAULT FALSE;
