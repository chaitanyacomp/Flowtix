# FT ERP Product Documentation — Baseline Manifest v1.0.0

| Field | Value |
|-------|-------|
| **Manifest ID** | FT-PD-BASELINE-1.0.0 |
| **Baseline version** | 1.0.0 |
| **Release date** | 2026-05-29 |
| **Effective date** | 2026-05-29 |
| **Status** | Frozen baseline — Draft — Architecture Review corpus |
| **Owner** | FT ERP Product Architecture |

**Related:** [Release Notes](./RELEASE_NOTES_v1.0.0.md) · [Baseline Freeze](./BASELINE_FREEZE.md) · [Architecture Map](../Architecture_Map_and_Navigation_Guide.md)

---

## Baseline summary

| Metric | Count |
|--------|------:|
| **Release date** | 2026-05-29 |
| **Baseline version** | 1.0.0 |
| **Total markdown files** | 75 |
| **Registered document IDs (`FT-PD-*`)** | 59 |
| **Volume count (0–10)** | 11 |
| **Chapter / volume documents** | 58 |
| **Volume README count** | 11 |
| **Product README count** | 1 |
| **Release governance documents** | 4 |
| **Architecture Map** | FT-PD-999 v1.0.0 |
| **Constitution version** | FT-PD-012 v1.0.0 |
| **Glossary version** | FT-PD-013 v1.0.0 |
| **Design Principles version** | FT-PD-014 v1.0.0 |
| **Unique Business Rules referenced** | 684 |
| **Unique Guards (`GRD_*`)** | 87 |
| **Domain workflow State Machines** | 6 |
| **Cross-domain orchestration contract** | 1 (FT-PD-048) |
| **Domain specifications (workflows)** | 6 |
| **Broken internal links (validated)** | 0 |
| **Duplicate document IDs** | 0 |
| **Version drift (non-1.0.0 headers)** | 0 |

---

## Document ID registry

| ID range | Volume | Documents |
|----------|--------|-----------|
| FT-PD-000 | Volume 0 | Product Vision & Strategy |
| FT-PD-011 – 014 | Volume 1 | Introduction, Constitution, Glossary, Design Principles |
| FT-PD-020 – 025 | Volume 2 | Business Architecture (6 chapters) |
| FT-PD-030 – 035 | Volume 3 | Domain Specifications (6 chapters) |
| FT-PD-040 – 048 | Volume 4 | Workflow Engine (9 chapters) |
| FT-PD-050 – 055 | Volume 5 | Data Architecture (6 chapters) |
| FT-PD-060 – 065 | Volume 6 | UI & Experience Architecture (6 chapters) |
| FT-PD-070 – 074 | Volume 7 | Security & Governance (5 chapters) |
| FT-PD-080 – 084 | Volume 8 | Product Testing & Validation (5 chapters) |
| FT-PD-090 – 094 | Volume 9 | Deployment & Operations (5 chapters) |
| FT-PD-100 – 104 | Volume 10 | Product Lifecycle (5 chapters) |
| FT-PD-999 | Index | Architecture Map & Navigation Guide |

**Reserved:** FT-PD-001 – 010, FT-PD-015 – 019, FT-PD-049, FT-PD-056 – 059, FT-PD-075 – 079, FT-PD-095 – 099, FT-PD-105+ for future volumes and amendments.

---

## Volume manifest

| Vol | Folder | README | Chapter IDs |
|-----|--------|--------|-------------|
| 0 | [00_Product_Vision_and_Strategy](../00_Product_Vision_and_Strategy/) | Yes | FT-PD-000 |
| 1 | [01_Product_Foundation](../01_Product_Foundation/) | Yes | FT-PD-011 – 014 |
| 2 | [02_Business_Architecture](../02_Business_Architecture/) | Yes | FT-PD-020 – 025 |
| 3 | [03_Domain_Specifications](../03_Domain_Specifications/) | Yes | FT-PD-030 – 035 |
| 4 | [04_Workflow_Engine](../04_Workflow_Engine/) | Yes | FT-PD-040 – 048 |
| 5 | [05_Data_Architecture](../05_Data_Architecture/) | Yes | FT-PD-050 – 055 |
| 6 | [06_UI_and_Experience_Architecture](../06_UI_and_Experience_Architecture/) | Yes | FT-PD-060 – 065 |
| 7 | [07_Security_and_Governance_Architecture](../07_Security_and_Governance_Architecture/) | Yes | FT-PD-070 – 074 |
| 8 | [08_Product_Testing_and_Validation](../08_Product_Testing_and_Validation/) | Yes | FT-PD-080 – 084 |
| 9 | [09_Deployment_and_Operations_Architecture](../09_Deployment_and_Operations_Architecture/) | Yes | FT-PD-090 – 094 |
| 10 | [10_Product_Lifecycle_and_Continuous_Evolution](../10_Product_Lifecycle_and_Continuous_Evolution/) | Yes | FT-PD-100 – 104 |

---

## Workflow & State Machine inventory

| Type | Count | Documents |
|------|------:|-----------|
| **Domain State Machines** | 6 | FT-PD-042 (Commercial), 043 (Planning), 044 (Procurement), 045 (Manufacturing), 046 (QA), 047 (Dispatch & Billing) |
| **Guard Registry** | 1 authority | FT-PD-041 — 87 unique `GRD_*` Guard IDs |
| **Engine contract** | 1 | FT-PD-040 — Workflow Engine Overview & Pending Actions |
| **Cross-domain orchestration** | 1 | FT-PD-048 |
| **Domain workflow specifications** | 6 | FT-PD-030 – 035 (Volume 3) |

---

## Foundation document versions

| Document | ID | Version | Status |
|----------|-----|---------|--------|
| FT ERP Constitution | FT-PD-012 | 1.0.0 | Draft — Architecture Review |
| Glossary & Standard Terminology | FT-PD-013 | 1.0.0 | Draft — Architecture Review |
| Product Design Principles | FT-PD-014 | 1.0.0 | Draft — Architecture Review |
| Architecture Map & Navigation Guide | FT-PD-999 | 1.0.0 | Draft — Architecture Review |

---

## Release governance package

| File | Purpose |
|------|---------|
| [RELEASE_NOTES_v1.0.0.md](./RELEASE_NOTES_v1.0.0.md) | Release summary and highlights |
| [BASELINE_MANIFEST_v1.0.0.md](./BASELINE_MANIFEST_v1.0.0.md) | This manifest |
| [CHANGE_POLICY.md](./CHANGE_POLICY.md) | Versioning and amendment rules |
| [BASELINE_FREEZE.md](./BASELINE_FREEZE.md) | Freeze declaration |

---

## Validation checksums (automated audit 2026-05-29)

| Check | Result |
|-------|--------|
| All 59 registered IDs unique | Pass |
| All registered documents at v1.0.0 | Pass |
| Cross-volume navigation links | Pass (0 broken) |
| Approval Block present (58 chapter/volume docs) | Pass |
| Guard IDs preserved | Pass (87 unique) |

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [Release Notes v1.0.0](./RELEASE_NOTES_v1.0.0.md) |
| **Next** | [Change Policy](./CHANGE_POLICY.md) |
| **Product** | [Product Documentation Index](../README.md) |
