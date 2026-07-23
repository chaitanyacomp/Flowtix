import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildAnalysingView,
  buildFailedView,
  buildImportingView,
  buildPreparingPreviewView,
  buildPreviewReadyView,
  buildUploadingView,
  estimateRemainingMs,
  isCurrentRequest,
  isProgressStalled,
  mapAnalysisDisplayPercent,
  mapImportBatchPercent,
  mapUploadPercent,
  previewReadyPercent,
  releaseBusy,
  stage1InputsLocked,
  stage2MappingEditable,
  startOverAllowed,
  tryAcquireBusy,
  ETA_MIN_PROCESSED,
  STALL_WARNING_MS,
} from "../../src/lib/tallyMasterImportProgress";

const PAGE = path.resolve(__dirname, "../../src/pages/TallyMasterImportPage.tsx");

describe("tallyMasterImportProgress — upload / analysis bands", () => {
  it("maps real upload bytes into 0–40% only", () => {
    expect(mapUploadPercent(0, 1000)).toBe(0);
    expect(mapUploadPercent(500, 1000)).toBe(20);
    expect(mapUploadPercent(1000, 1000)).toBe(40);
    expect(mapUploadPercent(1000, 1000)).toBeLessThan(previewReadyPercent());
  });

  it("increases processed count and percentage without reaching 100 before ready", () => {
    const p1 = mapAnalysisDisplayPercent({ processed: 1000, total: 4246 });
    const p2 = mapAnalysisDisplayPercent({ processed: 2150, total: 4246 });
    expect(p1).toBeGreaterThan(40);
    expect(p2).toBeGreaterThan(p1!);
    expect(p2).toBeLessThan(100);
    expect(mapAnalysisDisplayPercent({ serverPercent: 99 })).toBe(99);
    expect(buildPreviewReadyView("a.xml", 0).percent).toBe(100);
  });

  it("shows Processed X of Y · % in analysing detail", () => {
    const analysing = buildAnalysingView("Stock items.xml", {
      processed: 2150,
      total: 4246,
      elapsedMs: 78_000,
      etaLabel: "Estimated remaining: 1m 15s",
    });
    expect(analysing.indeterminate).toBe(false);
    expect(analysing.detail).toContain("Processed 2,150 of 4,246 stock items");
    expect(analysing.detail).toMatch(/·\s*63%/);
    expect(analysing.percent).toBe(63);
    expect(analysing.percent).toBeLessThan(100);
    expect(analysing.etaLabel).toContain("Estimated remaining");
  });

  it("never marks preview ready until explicit ready view", () => {
    expect(buildUploadingView("a.xml", 40, 0).percent).toBeLessThan(100);
    expect(buildPreparingPreviewView("a.xml", 0).percent).toBe(90);
    expect(buildPreviewReadyView("a.xml", 0).percent).toBe(100);
  });

  it("shows import batch progress text", () => {
    const v = buildImportingView("Stock items.xml", {
      elapsedMs: 5000,
      batchIndex: 3,
      batchTotal: 43,
      itemsProcessed: 300,
      itemsTotal: 4246,
    });
    expect(v.detail).toBe("Importing batch 3 of 43 — 300 of 4,246 items processed");
    expect(mapImportBatchPercent(3, 43)).toBeLessThan(100);
  });

  it("failed view clears measurable percent", () => {
    const v = buildFailedView("a.xml", "Preview failed", "XML truncated", 9000);
    expect(v.phase).toBe("failed");
    expect(v.percent).toBeNull();
  });
});

describe("tallyMasterImportProgress — ETA and stall", () => {
  it("ETA appears only after enough progress data", () => {
    const early = estimateRemainingMs({ processed: 10, total: 4246, elapsedMs: 5000 });
    expect(early.etaMs).toBeNull();
    expect(early.label).toBe("Estimating remaining time…");
    expect(ETA_MIN_PROCESSED).toBeGreaterThan(10);

    const ready = estimateRemainingMs({ processed: 2150, total: 4246, elapsedMs: 78_000 });
    expect(ready.etaMs).not.toBeNull();
    expect(ready.label).toMatch(/Estimated remaining:/);
  });

  it("stalled-progress warning after 30s without change", () => {
    expect(
      isProgressStalled({
        lastProgressAtMs: 0,
        nowMs: STALL_WARNING_MS - 1,
      }),
    ).toBe(false);
    expect(
      isProgressStalled({
        lastProgressAtMs: 0,
        nowMs: STALL_WARNING_MS,
      }),
    ).toBe(true);
  });

  it("elapsed timer wiring updates independently of poll interval", () => {
    const src = fs.readFileSync(PAGE, "utf8");
    expect(src).toContain("startElapsedTicker");
    expect(src).toContain("refreshProgressFromLatestOp");
    expect(src).toMatch(/setInterval\(\(\)\s*=>\s*\{\s*refreshProgressFromLatestOp\(\);\s*\},\s*1000\)/);
  });
});

describe("tallyMasterImportProgress — busy / lock guards", () => {
  it("double-click Preview acquire sends only one lock", () => {
    const busyRef = { current: false };
    expect(tryAcquireBusy(busyRef)).toBe(true);
    expect(tryAcquireBusy(busyRef)).toBe(false);
    releaseBusy(busyRef);
    expect(tryAcquireBusy(busyRef)).toBe(true);
  });

  it("double-click Confirm Import uses the same busy guard", () => {
    const busyRef = { current: false };
    expect(tryAcquireBusy(busyRef)).toBe(true);
    expect(tryAcquireBusy(busyRef)).toBe(false);
    releaseBusy(busyRef);
  });

  it("ignores stale responses after a newer request id", () => {
    let current = 1;
    expect(isCurrentRequest(1, current)).toBe(true);
    current = 2;
    expect(isCurrentRequest(1, current)).toBe(false);
  });

  it("locks Stage 1 during analysis and after successful preview", () => {
    expect(stage1InputsLocked(true, false)).toBe(true);
    expect(stage1InputsLocked(false, true)).toBe(true);
    expect(stage1InputsLocked(false, false)).toBe(false);
  });

  it("Stage 2 editable only when preview ready and not busy", () => {
    expect(stage2MappingEditable(true, false)).toBe(true);
    expect(stage2MappingEditable(true, true)).toBe(false);
  });

  it("Start Over available only when not processing", () => {
    expect(startOverAllowed(true)).toBe(false);
    expect(startOverAllowed(false)).toBe(true);
  });

  it("controls recover after failure (busy false, preview not locked)", () => {
    expect(stage1InputsLocked(false, false)).toBe(false);
    expect(startOverAllowed(false)).toBe(true);
  });
});

describe("TallyMasterImportPage lock wiring", () => {
  const src = fs.readFileSync(PAGE, "utf8");

  it("disables file input and options during analysis via stage1Locked", () => {
    expect(src).toContain('data-testid="tally-import-file-input"');
    expect(src).toContain("disabled={stage1Locked}");
  });

  it("uses tryAcquireBusy for Preview and Confirm, Start over gated", () => {
    expect(src).toContain("if (!tryAcquireBusy(busyRef)) return;");
    expect(src).toContain('data-testid="tally-import-start-over-btn"');
    expect(src).toContain('data-testid="tally-import-progress-overlay"');
  });

  it("ignores stale preview/apply responses via request id refs", () => {
    expect(src).toContain("previewRequestIdRef.current !== requestId");
    expect(src).toContain("applyRequestIdRef.current !== requestId");
  });

  it("locks confirm and mapping while applying", () => {
    expect(src).toContain("disabled={!stage2Editable}");
    expect(src).toContain('{applying ? "Importing…" : "Confirm import"}');
  });
});
