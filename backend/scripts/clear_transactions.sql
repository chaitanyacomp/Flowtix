USE erp;

SET FOREIGN_KEY_CHECKS = 0;

TRUNCATE TABLE activitylog;
TRUNCATE TABLE auditlog;
TRUNCATE TABLE idempotencyrecord;

TRUNCATE TABLE stocktransaction;
TRUNCATE TABLE stockadjustmentqcentry;

TRUNCATE TABLE qcreversal;
TRUNCATE TABLE qclegacyrejectedclassification;
TRUNCATE TABLE qcrejecteddisposition;
TRUNCATE TABLE qcentry;
TRUNCATE TABLE scraprecord;

TRUNCATE TABLE dispatch;

TRUNCATE TABLE salesbillline;
TRUNCATE TABLE salesbill;

TRUNCATE TABLE productionentry;

TRUNCATE TABLE workorderline;
TRUNCATE TABLE workorder;

TRUNCATE TABLE requirementsheetline;
TRUNCATE TABLE requirementsheet;

TRUNCATE TABLE salesorderline;
TRUNCATE TABLE salesordercycle;
TRUNCATE TABLE salesorder;

TRUNCATE TABLE quotationline;
TRUNCATE TABLE quotation;

TRUNCATE TABLE feasibility;

TRUNCATE TABLE enquiryline;
TRUNCATE TABLE enquiry;

TRUNCATE TABLE customerpoline;
TRUNCATE TABLE customerpo;

TRUNCATE TABLE customerreturn;

TRUNCATE TABLE purchasebillline;
TRUNCATE TABLE purchasebill;

TRUNCATE TABLE grnline;
TRUNCATE TABLE grn;

TRUNCATE TABLE rmpurchaseorderline;
TRUNCATE TABLE rmpurchaseorder;

TRUNCATE TABLE docsequence;

SET FOREIGN_KEY_CHECKS = 1;