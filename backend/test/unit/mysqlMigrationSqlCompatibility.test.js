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

  it("fg production standard migration creates unique FG+Machine and Restrict FKs", () => {
    const file = path.join(MIGRATIONS_DIR, "20260822150000_fg_production_standard", "migration.sql");
    assert.ok(fs.existsSync(file), "fg production standard migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /CREATE\s+TABLE\s+`FgProductionStandard`/i);
    assert.match(sql, /`cycleTimeSeconds`\s+DECIMAL\(18,\s*3\)\s+NOT\s+NULL/i);
    assert.match(sql, /`piecesPerCycle`\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+1/i);
    assert.match(sql, /`standardEfficiencyPercent`\s+DECIMAL\(5,\s*2\)\s+NOT\s+NULL\s+DEFAULT\s+95/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`FgProductionStandard_itemId_machineId_key`/i);
    assert.match(sql, /REFERENCES\s+`Item`\(`id`\)\s+ON\s+DELETE\s+RESTRICT/i);
    assert.match(sql, /REFERENCES\s+`Machine`\(`id`\)\s+ON\s+DELETE\s+RESTRICT/i);
    assert.doesNotMatch(sql, /CREATE\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /previewShift/i);
  });

  it("bom standard purging qty migration adds non-negative grams column with default 0", () => {
    const file = path.join(MIGRATIONS_DIR, "20260823100000_bom_standard_purging_qty_grams", "migration.sql");
    assert.ok(fs.existsSync(file), "bom standard purging qty migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /ALTER\s+TABLE\s+`Bom`/i);
    assert.match(
      sql,
      /ADD\s+COLUMN\s+`standardPurgingQtyGrams`\s+DECIMAL\(18,\s*4\)\s+NOT\s+NULL\s+DEFAULT\s+0/i,
    );
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  });

  it("work order planned setup count migration defaults existing rows to 1 without retroactive RM recalc", () => {
    const file = path.join(MIGRATIONS_DIR, "20260823110000_work_order_planned_setup_count", "migration.sql");
    assert.ok(fs.existsSync(file), "work order planned setup count migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /ALTER\s+TABLE\s+`WorkOrder`/i);
    assert.match(sql, /ADD\s+COLUMN\s+`plannedSetupCount`\s+INT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
    assert.match(sql, /ALTER\s+TABLE\s+`RegularSoPlanningSnapshot`/i);
    assert.match(sql, /ADD\s+COLUMN\s+`plannedSetupCount`\s+INT\s+NOT\s+NULL\s+DEFAULT\s+1/i);
    assert.doesNotMatch(sql, /UPDATE\s+/i);
    assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
  });

  it("production run allocation migration creates additive tables with MySQL backticks", () => {
    const file = path.join(MIGRATIONS_DIR, "20260823120000_wo_production_run_allocations", "migration.sql");
    assert.ok(fs.existsSync(file), "production run allocation migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /CREATE\s+TABLE\s+`WorkOrderProductionRunAllocation`/i);
    assert.match(sql, /CREATE\s+TABLE\s+`RegularSoPlanningRunAllocation`/i);
    assert.match(sql, /CREATE\s+TABLE\s+`RequirementSheetPlannedRunAllocation`/i);
    assert.match(sql, /CREATE\s+TABLE\s+`MachineMaterialState`/i);
    assert.doesNotMatch(sql, /CREATE\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+`WorkOrder`\s+.*plannedSetupCount/i);
    // MySQL identifier limit is 64 characters.
    const identifiers = [...sql.matchAll(/`([A-Za-z0-9_]+)`/g)].map((m) => m[1]);
    const tooLong = [...new Set(identifiers)].filter((name) => name.length > 64);
    assert.deepEqual(
      tooLong,
      [],
      `MySQL identifiers exceed 64 chars:\n${tooLong.map((n) => `${n.length} ${n}`).join("\n")}`,
    );
    assert.match(sql, /UNIQUE\s+INDEX\s+`RegSoRunAlloc_snap_fg_seq_key`/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`WoProdRunAlloc_wo_fg_seq_key`/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`RsPlanRunAlloc_rs_fg_seq_key`/i);
  });
});
