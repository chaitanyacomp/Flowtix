-- Add intermediate status so supervisor approval does NOT imply rework completion.

ALTER TABLE `QcRejectedDisposition`
  MODIFY `status` ENUM(
    'REWORK_PENDING_SUPERVISOR',
    'REWORK_APPROVED_PENDING_EXECUTION',
    'REWORK_READY_FOR_QC',
    'HOLD',
    'SCRAP',
    'CLOSED'
  ) NOT NULL;

