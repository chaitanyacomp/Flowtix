/**
 * Idempotent: adds Bom.isLocked / Bom.lockedAt if missing (e.g. DB migrated manually or drift).
 * Uses mysql2 only — does not require Prisma Client to be regenerated first.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  const conn = await mysql.createConnection(url);
  try {
    const [rows] = await conn.query(
      `SELECT COLUMN_NAME AS name FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'Bom'
         AND COLUMN_NAME IN ('isLocked','lockedAt')`,
    );
    const have = new Set(rows.map((r) => r.name));
    if (!have.has("isLocked")) {
      await conn.query("ALTER TABLE `Bom` ADD COLUMN `isLocked` BOOLEAN NOT NULL DEFAULT true");
      // eslint-disable-next-line no-console
      console.log("Added column Bom.isLocked");
    }
    if (!have.has("lockedAt")) {
      await conn.query("ALTER TABLE `Bom` ADD COLUMN `lockedAt` DATETIME(3) NULL");
      await conn.query("UPDATE `Bom` SET `lockedAt` = `updatedAt` WHERE `lockedAt` IS NULL");
      // eslint-disable-next-line no-console
      console.log("Added column Bom.lockedAt (backfilled from updatedAt)");
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
