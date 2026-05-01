-- Customer: state for GST / Tally readiness (gst + address already exist)
ALTER TABLE `Customer` ADD COLUMN `state` VARCHAR(128) NULL;
