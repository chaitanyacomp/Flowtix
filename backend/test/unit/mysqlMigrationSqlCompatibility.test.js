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

  it("shift production lifecycle phase-1 migration uses MySQL backticks and short identifiers", () => {
    const file = path.join(
      MIGRATIONS_DIR,
      "20260824120000_shift_production_lifecycle_phase1",
      "migration.sql",
    );
    assert.ok(fs.existsSync(file), "shift production lifecycle phase-1 migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /CREATE\s+TABLE\s+`MachineShiftSession`/i);
    assert.match(sql, /CREATE\s+TABLE\s+`ShiftProductionReportAdjustmentRequest`/i);
    assert.match(sql, /CREATE\s+TABLE\s+`ShiftProductionReportAdjustmentLine`/i);
    assert.match(sql, /`proposedGrossOutputQty`\s+DECIMAL\(18,\s*3\)\s+NOT\s+NULL/i);
    assert.match(sql, /`decisionNote`\s+TEXT\s+NULL/i);
    assert.match(sql, /`appliedReportVersionId`\s+INTEGER\s+NULL/i);
    assert.match(sql, /`unresVerId`\s+INTEGER\s+GENERATED\s+ALWAYS\s+AS/i);
    assert.match(sql, /`openMachId`\s+INTEGER\s+GENERATED\s+ALWAYS\s+AS/i);
    assert.match(sql, /`openMachId`[\s\S]*?\bVIRTUAL\b/i);
    assert.match(sql, /`unresVerId`[\s\S]*?\bVIRTUAL\b/i);
    assert.doesNotMatch(sql, /`openMachId`[\s\S]*?\bSTORED\b/i);
    assert.doesNotMatch(sql, /`unresVerId`[\s\S]*?\bSTORED\b/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`uq_srpt_adj_unres`\(`unresVerId`\)/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`uniq_srpt_adj_app_ver`/i);
    assert.match(sql, /UNIQUE\s+INDEX\s+`uniq_srpt_adj_ln`/i);
    assert.match(sql, /CONSTRAINT\s+`srpt_adj_app_ver_fk`/i);
    assert.match(sql, /`handoverRemarks`\s+TEXT\s+NULL/i);
    assert.match(sql, /`declaredAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.doesNotMatch(sql, /`declaredAt`\s+DATETIME\(3\)\s+NOT\s+NULL\s+DEFAULT/i);
    assert.doesNotMatch(sql, /CREATE\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
    const identifiers = [...sql.matchAll(/`([A-Za-z0-9_]+)`/g)].map((m) => m[1]);
    const tooLong = [...new Set(identifiers)].filter((name) => name.length > 64);
    assert.deepEqual(
      tooLong,
      [],
      `MySQL identifiers exceed 64 chars:\n${tooLong.map((n) => `${n.length} ${n}`).join("\n")}`,
    );
  });

  it("shift session cancel migration recreates openMachId for OPEN only", () => {
    const file = path.join(
      MIGRATIONS_DIR,
      "20260825190000_shift_session_cancelled",
      "migration.sql",
    );
    assert.ok(fs.existsSync(file), "shift session cancelled migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /DROP\s+INDEX\s+`uq_mss_open`/i);
    assert.match(sql, /DROP\s+COLUMN\s+`openMachId`/i);
    assert.match(sql, /ENUM\('OPEN',\s*'SHIFT_OVER',\s*'CANCELLED'\)/i);
    assert.match(sql, /ADD\s+COLUMN\s+`cancellationReason`\s+TEXT\s+NULL/i);
    assert.match(
      sql,
      /`openMachId`\s+INTEGER\s+GENERATED\s+ALWAYS\s+AS\s*\(\s*IF\s*\(\s*`status`\s*=\s*'OPEN'/i,
    );
    assert.match(sql, /`openMachId`[\s\S]*?\bVIRTUAL\b/i);
    assert.doesNotMatch(sql, /`openMachId`[\s\S]*?\bSTORED\b/i);
    assert.match(sql, /CREATE\s+UNIQUE\s+INDEX\s+`uq_mss_open`\s+ON\s+`MachineShiftSession`\s*\(\s*`openMachId`\s*\)/i);
    assert.doesNotMatch(sql, /status`\s*<>\s*'SHIFT_OVER'/i);
  });

  it("production manager role migration extends UserRole enum additively", () => {
    const file = path.join(MIGRATIONS_DIR, "20260824130000_production_manager_role", "migration.sql");
    assert.ok(fs.existsSync(file), "production manager role migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /ALTER\s+TABLE\s+`User`/i);
    assert.match(sql, /MODIFY\s+COLUMN\s+`role`\s+ENUM\(/i);
    assert.match(sql, /'PRODUCTION_MANAGER'/i);
    assert.match(sql, /'ADMIN'/i);
    assert.match(sql, /'PRODUCTION'/i);
    assert.match(sql, /'QA'/i);
    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
    assert.doesNotMatch(sql, /DELETE\s+FROM/i);
  });

  it("Kg RM issue increment migration adds nullable columns and backfills Kg RM to 1", () => {
    const file = path.join(MIGRATIONS_DIR, "20260826120000_kg_rm_issue_increment", "migration.sql");
    assert.ok(fs.existsSync(file), "kg rm issue increment migration.sql missing");
    const sql = stripSqlComments(fs.readFileSync(file, "utf8"));
    assert.match(sql, /ALTER\s+TABLE\s+`Item`/i);
    assert.match(sql, /ADD\s+COLUMN\s+`issueIncrement`\s+DECIMAL\(18,\s*6\)\s+NULL/i);
    assert.match(sql, /SET\s+`i`\.`issueIncrement`\s*=\s*1/i);
    assert.match(sql, /`i`\.`itemType`\s*=\s*'RM'/i);
    assert.match(sql, /ALTER\s+TABLE\s+`ProductionMaterialRequestLine`/i);
    assert.match(sql, /`roundedIssueTargetQty`/i);
    assert.match(sql, /`productionRmQty`/i);
    assert.match(sql, /`purgingRmQty`/i);
    assert.match(sql, /ALTER\s+TABLE\s+`MaterialIssueLine`/i);
    assert.match(sql, /`plannedRequiredQtySnapshot`/i);
    assert.match(sql, /`roundingExcessQty`/i);
    assert.doesNotMatch(sql, /packSize/i);
    assert.doesNotMatch(sql, /DROP\s+COLUMN/i);
  });

  it("shift grace/handover/late-entry migration is MySQL-safe and does not stamp historical PE enteredAt", () => {
    const file = path.join(
      MIGRATIONS_DIR,
      "20260827160000_shift_grace_handover_late_entry",
      "migration.sql",
    );
    assert.ok(fs.existsSync(file), "shift grace handover late-entry migration.sql missing");
    const raw = fs.readFileSync(file, "utf8");
    const sql = stripSqlComments(raw);

    assert.doesNotMatch(sql, /ALTER\s+TABLE\s+"/i);
    assert.doesNotMatch(sql, /ADD\s+COLUMN\s+"/i);
    assert.doesNotMatch(sql, /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS/i);
    assert.doesNotMatch(sql, /CREATE\s+TABLE\s+"/i);

    const identifiers = [...sql.matchAll(/`([A-Za-z0-9_]+)`/g)].map((m) => m[1]);
    const tooLong = [...new Set(identifiers)].filter((name) => name.length > 64);
    assert.deepEqual(
      tooLong,
      [],
      `MySQL identifiers exceed 64 chars:\n${tooLong.map((n) => `${n.length} ${n}`).join("\n")}`,
    );

    assert.match(sql, /ALTER\s+TABLE\s+`AppSetting`/i);
    assert.match(sql, /ADD\s+COLUMN\s+`shiftGraceMinutes`\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+15/i);
    assert.match(sql, /UPDATE\s+`AppSetting`[\s\S]*`shiftGraceMinutes`\s*=\s*15/i);

    const dropIdx = sql.search(/DROP\s+INDEX\s+`uq_mss_open`/i);
    const dropCol = sql.search(/DROP\s+COLUMN\s+`openMachId`/i);
    const enumIdx = sql.search(
      /ENUM\('OPEN',\s*'SHIFT_OVER',\s*'CANCELLED',\s*'HANDOVER_PENDING'\)/i,
    );
    const addOpen = sql.search(/ADD\s+COLUMN\s+`openMachId`/i);
    const createUq = sql.search(
      /CREATE\s+UNIQUE\s+INDEX\s+`uq_mss_open`\s+ON\s+`MachineShiftSession`\s*\(\s*`openMachId`\s*\)/i,
    );
    assert.ok(dropIdx >= 0 && dropCol > dropIdx, "drop uq_mss_open before drop openMachId");
    assert.ok(enumIdx > dropCol, "expand ENUM after dropping openMachId");
    assert.ok(addOpen > enumIdx, "recreate openMachId after ENUM expand");
    assert.ok(createUq > addOpen, "recreate uq_mss_open after openMachId");
    assert.match(
      sql,
      /`openMachId`\s+INTEGER\s+GENERATED\s+ALWAYS\s+AS\s*\(\s*IF\s*\(\s*`status`\s*=\s*'OPEN'/i,
    );
    assert.match(sql, /`openMachId`[\s\S]*?\bVIRTUAL\b/i);
    assert.doesNotMatch(sql, /`openMachId`[\s\S]*?\bSTORED\b/i);
    assert.doesNotMatch(sql, /status`\s*<>\s*'SHIFT_OVER'/i);

    assert.match(sql, /ADD\s+COLUMN\s+`scheduledStartAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`scheduledEndAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`graceMinutesSnapshot`\s+INTEGER\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`overtimeApprovedUntil`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`overtimeApprovedAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`overtimeApprovedByUserId`\s+INTEGER\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`overtimeReason`\s+TEXT\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`liveProductionStoppedAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`timeEndDetectedAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`actualOperationalEndAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`previousSessionId`\s+INTEGER\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`startedOutsideWindow`\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i);
    assert.match(sql, /ADD\s+COLUMN\s+`startedOutsideWindowReason`\s+VARCHAR\(40\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`startedOutsideWindowRemarks`\s+TEXT\s+NULL/i);
    assert.match(sql, /CONSTRAINT\s+`mss_ot_by_user_fk`/i);
    assert.match(sql, /CONSTRAINT\s+`mss_prev_sess_fk`/i);
    assert.match(sql, /REFERENCES\s+`MachineShiftSession`\(`id`\)\s+ON\s+DELETE\s+SET\s+NULL/i);

    assert.match(sql, /INNER\s+JOIN\s+`Shift`/i);
    assert.match(sql, /DATE_FORMAT\s*\(\s*`s`\.`sessionDate`/i);
    assert.match(sql, /INTERVAL\s+330\s+MINUTE/i);
    assert.match(sql, /INTERVAL\s+1\s+DAY/i);
    assert.match(
      sql,
      /TIME_TO_SEC\s*\(\s*STR_TO_DATE\s*\(\s*`sh`\.`endTime`[\s\S]*<\s*TIME_TO_SEC\s*\(\s*STR_TO_DATE\s*\(\s*`sh`\.`startTime`/i,
    );
    assert.match(sql, /`s`\.`graceMinutesSnapshot`\s*=\s*15/i);
    assert.match(sql, /`s`\.`shiftId`\s+IS\s+NOT\s+NULL/i);
    assert.doesNotMatch(sql, /UPDATE\s+`MachineShiftSession`[\s\S]*`liveProductionStoppedAt`\s*=/i);
    assert.doesNotMatch(sql, /UPDATE\s+`MachineShiftSession`[\s\S]*`timeEndDetectedAt`\s*=/i);
    assert.doesNotMatch(sql, /UPDATE\s+`MachineShiftSession`[\s\S]*`actualOperationalEndAt`\s*=/i);

    const addEnteredAt = raw.match(/ADD\s+COLUMN\s+`enteredAt`[^;]*/i);
    assert.ok(addEnteredAt, "expected ADD COLUMN `enteredAt`");
    assert.match(addEnteredAt[0], /DATETIME\(3\)\s+NULL/i);
    assert.doesNotMatch(addEnteredAt[0], /DEFAULT/i);
    assert.doesNotMatch(addEnteredAt[0], /CURRENT_TIMESTAMP/i);

    const modifyEnteredAt = sql.match(
      /MODIFY\s+COLUMN\s+`enteredAt`\s+DATETIME\(3\)\s+NULL\s+DEFAULT\s+CURRENT_TIMESTAMP\(3\)/i,
    );
    assert.ok(modifyEnteredAt, "expected later MODIFY enteredAt DEFAULT CURRENT_TIMESTAMP(3)");
    const addEnteredAtIdx = sql.search(/ADD\s+COLUMN\s+`enteredAt`/i);
    const modifyEnteredAtIdx = sql.search(/MODIFY\s+COLUMN\s+`enteredAt`/i);
    assert.ok(addEnteredAtIdx >= 0 && modifyEnteredAtIdx > addEnteredAtIdx, "ADD enteredAt before MODIFY");

    assert.doesNotMatch(sql, /UPDATE\s+`ProductionEntry`/i);
    assert.doesNotMatch(sql, /SET\s+[\s\S]*`enteredAt`\s*=/i);
    assert.doesNotMatch(sql, /`actualProductionAt`\s*=/i);

    assert.match(sql, /ADD\s+COLUMN\s+`actualProductionAt`\s+DATETIME\(3\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`createdByUserId`\s+INTEGER\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`enteredOnBehalfOfOperatorId`\s+INTEGER\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`operatorUnavailable`\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i);
    assert.match(sql, /ADD\s+COLUMN\s+`lateEntryReason`\s+VARCHAR\(40\)\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`lateEntryRemarks`\s+TEXT\s+NULL/i);
    assert.match(sql, /ADD\s+COLUMN\s+`isLateManagerEntry`\s+BOOLEAN\s+NOT\s+NULL\s+DEFAULT\s+false/i);
    assert.match(
      sql,
      /INDEX\s+`Pe_shiftSess_lateMgr_idx`\s+ON\s+`ProductionEntry`\s*\(\s*`shiftSessionId`\s*,\s*`isLateManagerEntry`\s*\)/i,
    );
    assert.match(sql, /CONSTRAINT\s+`Pe_createdBy_fkey`/i);
    assert.match(sql, /CONSTRAINT\s+`Pe_enteredOnBehalf_fkey`/i);
    assert.match(sql, /REFERENCES\s+`Operator`\(`id`\)\s+ON\s+DELETE\s+SET\s+NULL/i);
  });
});
