-- Add flow identity selector at Enquiry stage.
-- Existing enquiries default to REGULAR.

ALTER TABLE `Enquiry`
  ADD COLUMN `flowType` ENUM('REGULAR', 'NO_QTY') NOT NULL DEFAULT 'REGULAR';

CREATE INDEX `Enquiry_flowType_idx` ON `Enquiry`(`flowType`);

