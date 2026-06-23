-- P11: configurable FG Green Level history window (3 / 6 / 12 months).
ALTER TABLE `AppSetting` ADD COLUMN `greenLevelHistoryMonths` INTEGER NOT NULL DEFAULT 6;
