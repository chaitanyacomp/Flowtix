-- Allow multiple BOM revisions per FG; docNo shared across revisions (V1, V2, …).

CREATE INDEX `Bom_fgItemId_idx` ON `Bom`(`fgItemId`);
CREATE UNIQUE INDEX `Bom_fgItemId_revisionNo_key` ON `Bom`(`fgItemId`, `revisionNo`);

DROP INDEX `Bom_docNo_key` ON `Bom`;
DROP INDEX `Bom_fgItemId_key` ON `Bom`;
