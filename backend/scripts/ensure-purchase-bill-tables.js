/**
 * Idempotent DDL for PurchaseBill / PurchaseBillLine + Grn.billingStatus when
 * Prisma migrations were not applied (baseline). Safe to run multiple times.
 */
require("dotenv").config();
const mysql = require("mysql2/promise");

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND COLUMN_NAME = ? LIMIT 1",
    [table, column],
  );
  return rows.length > 0;
}

async function constraintExists(conn, table, name) {
  const [rows] = await conn.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND CONSTRAINT_NAME = ? LIMIT 1",
    [table, name],
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    "SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND LOWER(TABLE_NAME) = LOWER(?) AND INDEX_NAME = ? LIMIT 1",
    [table, indexName],
  );
  return rows.length > 0;
}

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const conn = await mysql.createConnection(url);

  try {
    if (!(await columnExists(conn, "Grn", "billingStatus"))) {
      await conn.query(
        "ALTER TABLE `Grn` ADD COLUMN `billingStatus` ENUM('PENDING','BILLED') NOT NULL DEFAULT 'PENDING'",
      );
      console.log("Added Grn.billingStatus");
    } else {
      console.log("Grn.billingStatus already present");
    }

    if (!(await indexExists(conn, "Grn", "Grn_billingStatus_idx"))) {
      try {
        await conn.query("CREATE INDEX `Grn_billingStatus_idx` ON `Grn`(`billingStatus`)");
        console.log("Added Grn_billingStatus_idx");
      } catch (e) {
        if (e.errno !== 1061) throw e;
        console.log("Grn_billingStatus_idx already exists");
      }
    } else {
      console.log("Grn_billingStatus_idx already present");
    }

    await conn.query(`
CREATE TABLE IF NOT EXISTS \`PurchaseBill\` (
    \`id\` INTEGER NOT NULL AUTO_INCREMENT,
    \`billNo\` VARCHAR(128) NULL,
    \`billDate\` DATE NOT NULL,
    \`dueDate\` DATE NULL,
    \`supplierId\` INTEGER NOT NULL,
    \`grnId\` INTEGER NOT NULL,
    \`remarks\` TEXT NULL,
    \`status\` ENUM('DRAFT', 'FINALIZED') NOT NULL DEFAULT 'DRAFT',
    \`totalBasic\` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    \`totalCgst\` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    \`totalSgst\` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    \`totalIgst\` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    \`totalTax\` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    \`netAmount\` DECIMAL(18, 2) NOT NULL DEFAULT 0,
    \`finalizedAt\` DATETIME(3) NULL,
    \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    \`updatedAt\` DATETIME(3) NOT NULL,
    UNIQUE INDEX \`PurchaseBill_grnId_key\`(\`grnId\`),
    INDEX \`PurchaseBill_supplierId_idx\`(\`supplierId\`),
    INDEX \`PurchaseBill_billDate_idx\`(\`billDate\`),
    INDEX \`PurchaseBill_status_idx\`(\`status\`),
    PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log("PurchaseBill table ensured (IF NOT EXISTS)");

    await conn.query(`
CREATE TABLE IF NOT EXISTS \`PurchaseBillLine\` (
    \`id\` INTEGER NOT NULL AUTO_INCREMENT,
    \`purchaseBillId\` INTEGER NOT NULL,
    \`itemId\` INTEGER NOT NULL,
    \`qty\` DECIMAL(18, 3) NOT NULL,
    \`unitSnapshot\` VARCHAR(64) NOT NULL,
    \`rate\` DECIMAL(18, 4) NOT NULL,
    \`basicAmount\` DECIMAL(18, 2) NOT NULL,
    \`gstRate\` DECIMAL(5, 2) NOT NULL,
    \`cgstAmount\` DECIMAL(18, 2) NOT NULL,
    \`sgstAmount\` DECIMAL(18, 2) NOT NULL,
    \`igstAmount\` DECIMAL(18, 2) NOT NULL,
    \`lineTotal\` DECIMAL(18, 2) NOT NULL,
    INDEX \`PurchaseBillLine_purchaseBillId_idx\`(\`purchaseBillId\`),
    INDEX \`PurchaseBillLine_itemId_idx\`(\`itemId\`),
    PRIMARY KEY (\`id\`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log("PurchaseBillLine table ensured (IF NOT EXISTS)");

    if (!(await constraintExists(conn, "PurchaseBill", "PurchaseBill_supplierId_fkey"))) {
      await conn.query(
        "ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE",
      );
      console.log("Added PurchaseBill_supplierId_fkey");
    }
    if (!(await constraintExists(conn, "PurchaseBill", "PurchaseBill_grnId_fkey"))) {
      await conn.query(
        "ALTER TABLE `PurchaseBill` ADD CONSTRAINT `PurchaseBill_grnId_fkey` FOREIGN KEY (`grnId`) REFERENCES `Grn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE",
      );
      console.log("Added PurchaseBill_grnId_fkey");
    }
    if (!(await constraintExists(conn, "PurchaseBillLine", "PurchaseBillLine_purchaseBillId_fkey"))) {
      await conn.query(
        "ALTER TABLE `PurchaseBillLine` ADD CONSTRAINT `PurchaseBillLine_purchaseBillId_fkey` FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON DELETE CASCADE ON UPDATE CASCADE",
      );
      console.log("Added PurchaseBillLine_purchaseBillId_fkey");
    }
    if (!(await constraintExists(conn, "PurchaseBillLine", "PurchaseBillLine_itemId_fkey"))) {
      await conn.query(
        "ALTER TABLE `PurchaseBillLine` ADD CONSTRAINT `PurchaseBillLine_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE",
      );
      console.log("Added PurchaseBillLine_itemId_fkey");
    }

    console.log("Done.");
  } finally {
    await conn.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
