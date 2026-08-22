/**
 * Regression: Prisma migrations must use MySQL identifier quoting (backticks),
 * not PostgreSQL-style double-quoted identifiers / ADD COLUMN IF NOT EXISTS.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIGRATIONS_DIR = path.join(__dirname, "../../prisma/migrations");

function listMigrationSqlFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs
    .readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(MIGRATIONS_DIR, d.name, "migration.sql"))
    .filter((p) => fs.existsSync(p));
}

/** Strip SQL line `--` and block `/* ... *\/` comments for pattern scans. */
function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

describe("MySQL Prisma migration SQL compatibility", () => {
  it("lists at least one migration.sql under prisma/migrations", () => {
    const files = listMigrationSqlFiles();
    assert.ok(files.length > 0, "expected migration.sql files");
  });

  it("rejects PostgreSQL-style double-quoted ALTER TABLE / ADD COLUMN identifiers", () => {
    const offenders = [];
    for (const file of listMigrationSqlFiles()) {
      const raw = fs.readFileSync(file, "utf8");
      const sql = stripSqlComments(raw);
      // e.g. ALTER TABLE "AppSetting" or ADD COLUMN "foo"
      if (/\bALTER\s+TABLE\s+"/i.test(sql) || /\bADD\s+COLUMN\s+"/i.test(sql)) {
        offenders.push(path.relative(MIGRATIONS_DIR, file).replace(/\\/g, "/"));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `PostgreSQL-style quoted identifiers in MySQL migrations:\n${offenders.join("\n")}`,
    );
  });

  it("rejects ADD COLUMN IF NOT EXISTS (not portable on this MySQL deployment)", () => {
    const offenders = [];
    for (const file of listMigrationSqlFiles()) {
      const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
      if (/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(sql)) {
        offenders.push(path.relative(MIGRATIONS_DIR, file).replace(/\\/g, "/"));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `ADD COLUMN IF NOT EXISTS found in:\n${offenders.join("\n")}`,
    );
  });

  it("tally transportation ledger migration uses backtick MySQL syntax", () => {
    const file = path.join(
      MIGRATIONS_DIR,
      "20260720150000_tally_transportation_ledger_setting",
      "migration.sql",
    );
    assert.ok(fs.existsSync(file), "tally transportation migration.sql missing");
    const sql = fs.readFileSync(file, "utf8");
    assert.match(sql, /ALTER\s+TABLE\s+`AppSetting`/i);
    assert.match(sql, /ADD\s+COLUMN\s+`tallyTransportationLedger`\s+VARCHAR\(160\)\s+NULL/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  });

  it("shift master migration creates Shift with MySQL backticks and HH:mm columns", () => {
    const file = path.join(MIGRATIONS_DIR, "20260822140000_shift_master", "migration.sql");
    assert.ok(fs.existsSync(file), "shift master migration.sql missing");
    const raw = fs.readFileSync(file, "utf8");
    const sql = stripSqlComments(raw);
    assert.match(sql, /CREATE\s+TABLE\s+`Shift`/i);
    assert.match(sql, /`shiftCode`\s+VARCHAR\(32\)\s+NOT\s+NULL/i);
    assert.match(sql, /`startTime`\s+VARCHAR\(8\)\s+NOT\s+NULL/i);
    assert.match(sql, /`endTime`\s+VARCHAR\(8\)\s+NOT\s+NULL/i);
    assert.match(sql, /`plannedBreakMinutes`\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`Shift_shiftCode_key`/i);
    assert.doesNotMatch(sql, /CREATE\s+TABLE\s+"/i);
    // Time-of-day stored as VARCHAR, not MySQL TIME/TIMESTAMP column types.
    assert.doesNotMatch(sql, /`startTime`\s+TIME\b/i);
    assert.doesNotMatch(sql, /`endTime`\s+TIME\b/i);
    assert.doesNotMatch(sql, /`startTime`\s+TIMESTAMP\b/i);
    assert.doesNotMatch(sql, /`endTime`\s+TIMESTAMP\b/i);
  });
});
