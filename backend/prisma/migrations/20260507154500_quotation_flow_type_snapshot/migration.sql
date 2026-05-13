-- Capture enquiry flow identity on quotation.
-- Existing quotations default to REGULAR.

ALTER TABLE `Quotation`
  ADD COLUMN `flowTypeSnapshot` ENUM('REGULAR', 'NO_QTY') NOT NULL DEFAULT 'REGULAR';

CREATE INDEX `Quotation_flowTypeSnapshot_idx` ON `Quotation`(`flowTypeSnapshot`);

