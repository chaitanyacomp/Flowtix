-- Fix: QcRejectedDisposition.updatedAt had NOT NULL with no default.
-- This caused QC save failures on REWORK/HOLD/SCRAP because the insert omitted updatedAt.
-- Ensure the DB supplies a value on insert and auto-updates on update.

ALTER TABLE `QcRejectedDisposition`
  MODIFY `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3);

