# FT ERP Product Documentation — Change Policy

| Field | Value |
|-------|-------|
| **Policy ID** | FT-PD-POLICY-CHANGE |
| **Version** | 1.0.0 |
| **Status** | Effective with Baseline v1.0.0 |
| **Effective date** | 2026-05-29 |
| **Owner** | FT ERP Product Architecture |
| **Authority** | [FT ERP Constitution](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) (FT-PD-012) |

**Related:** [Baseline Freeze](./BASELINE_FREEZE.md) · [Volume 10, Ch. 2 — Feature Governance](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md) (FT-PD-101) · [Volume 10, Ch. 4 — Documentation Governance](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_04_Product_Knowledge_Management_Documentation_Governance_and_Organizational_Learning.md) (FT-PD-103)

---

## 1. Purpose

This policy defines how the FT ERP Product Documentation corpus evolves after the **Version 1.0.0 baseline freeze**. It ensures controlled change, traceability, and backward compatibility for document references.

---

## 2. Semantic versioning

Product documentation uses **MAJOR.MINOR.PATCH** semantic versioning per document and per baseline release.

### 2.1 Patch version (x.y.Z)

**When:** Editorial corrections that do **not** change architectural meaning.

Examples:

- Typographical fixes, link repairs, formatting normalization
- Glossary clarifications that do not alter definitions
- Navigation and cross-reference updates
- Approval Block or metadata presentation fixes

**Requirements:**

- Increment PATCH on affected documents only
- Change log entry required
- No Architecture Review board required for patch-only corpus releases
- Regression: link audit + rule/guard reference validation

### 2.2 Minor version (x.Y.z)

**When:** Additive or clarifying changes that **extend** architecture without breaking existing rules.

Examples:

- New optional fields or states with backward-compatible defaults
- New Guards that tighten (never loosen) existing transitions
- New domain rules that do not contradict existing rules
- New chapters within existing volumes
- New glossary terms (no definition changes to existing terms)

**Requirements:**

- Increment MINOR on affected documents
- Architecture Review required
- Volume cross-reference audit
- Volume 8 regression guardrail review for workflow-affected changes
- Update FT-PD-999 navigation guide if volume structure changes

### 2.3 Major version (X.y.z)

**When:** Breaking architectural change.

Examples:

- Constitution Article amendment
- Business Model semantics change
- Guard semantic change or removal
- State Machine transition removal or ownership change
- Glossary definition change that alters meaning of existing terms
- New volume or fundamental restructure

**Requirements:**

- Increment MAJOR on affected documents and baseline release if corpus-wide
- Architecture board approval mandatory
- Architectural Decision Record (ADR) per [FT-PD-101](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md)
- Full Volume 8 validation cycle
- Explicit migration notes and supersession records
- Customer and partner notification for material changes

---

## 3. Constitution amendment process

The [FT ERP Constitution](../01_Product_Foundation/Chapter_02_FT_ERP_Constitution.md) (FT-PD-012) is the highest operational authority.

| Step | Action |
|------|--------|
| 1 | **Proposal** — Documented change request with rationale, impact analysis, and affected volumes |
| 2 | **Architecture Review** — Board evaluates against Volume 0 strategic mandate |
| 3 | **ADR** — Record decision in governance register ([FT-PD-101](../10_Product_Lifecycle_and_Continuous_Evolution/Chapter_02_Feature_Governance_Change_Control_and_Architectural_Decision_Records.md)) |
| 4 | **Constitution version bump** — MAJOR or MINOR per §2 |
| 5 | **Cascade audit** — Identify all downstream volumes, rules, Guards, and tests requiring update |
| 6 | **Synchronized update** — Amend dependent documents in the same release train |
| 7 | **Validation** — Volume 8 protected-behavior and regression review |
| 8 | **Approval** — Constitution Approval Block signed; status advanced per governance |

**Rule:** No volume may contradict the Constitution. Tension with Volume 0 is resolved through Volume 0 revision first.

---

## 4. Rule lifecycle

Business Rules use prefixed identifiers (e.g. `BM-01`, `WFE-04`, `GRD-01`, `VAL-03`).

| Stage | Description |
|-------|-------------|
| **Proposed** | Draft rule in Architecture Review document — not yet referenced as authoritative |
| **Published** | Rule appears in an Approved or baseline-frozen document with stable ID |
| **Referenced** | Rule cited by Guards, tests, or downstream volumes — traceability required |
| **Deprecated** | Rule marked deprecated with replacement pointer — must remain in corpus until MAJOR removal |
| **Retired** | Removed only in MAJOR version with ADR and migration notes |

**Requirements:**

- One rule ID = one meaning across the corpus
- New rules require source volume authority (domain rule in Vol. 3, engine rule in Vol. 4, etc.)
- Rule reference audits must show zero undefined references before baseline promotion
- Renumbering rule IDs is prohibited — use deprecation and replacement

---

## 5. Guard lifecycle

Guards (`GRD_*`) are defined **exactly once** in [FT-PD-041 §9](../04_Workflow_Engine/Chapter_02_Transition_Guards_and_Cross_Domain_Dependency_Catalog.md).

| Stage | Description |
|-------|-------------|
| **Registered** | Guard ID added to FT-PD-041 registry with semantics, reasonCode, domain |
| **Attached** | Guard referenced in domain State Machine guard order (FT-PD-042 – 047) |
| **Protected** | Guard covered by Volume 8 regression catalog ([FT-PD-081](../08_Product_Testing_and_Validation/Chapter_02_Workflow_Regression_Guardrails_and_Protected_Behavior_Catalog.md)) |
| **Deprecated** | Guard marked inactive — transitions must not rely on deprecated Guard without ADR |
| **Retired** | Guard removed only in MAJOR release with State Machine and test updates |

**Requirements:**

- No duplicate Guard definitions in domain chapters
- Guard semantic changes require FT-PD-041 update + MINOR or MAJOR bump
- Implementation must not invent Guards outside the registry

---

## 6. Documentation review process

| Change type | Reviewer | Validation |
|-------------|----------|------------|
| PATCH | Documentation Steward | Link audit, spelling, formatting |
| MINOR | Product Architecture + domain owner | Cross-volume consistency, rule references |
| MAJOR | Architecture board + affected domain leads | Full regression, ADR, Constitution check |
| New volume/chapter | Architecture board | FT-PD-999 update, manifest update, ID assignment |
| Glossary amendment | Product Architecture | Terminology impact across Volumes 2–10 |
| Guard/State Machine | Workflow Engineering Lead | FT-PD-041/042–047 sync, PBL catalog |

**Review checklist (all non-PATCH changes):**

- [ ] Constitution compliance verified
- [ ] Glossary terms used correctly
- [ ] Cross-references resolve (zero broken links)
- [ ] Document ID and version incremented
- [ ] Change log entry added
- [ ] Approval Block updated if roles change
- [ ] Volume 8 impact assessed

---

## 7. Backward compatibility requirements

| Artifact | Requirement |
|----------|-------------|
| **Document IDs (`FT-PD-*`)** | Never reused. Retired IDs remain in manifest with supersession note. |
| **Rule IDs** | Deprecated rules retain ID with pointer to replacement until MAJOR retirement. |
| **Guard IDs (`GRD_*`)** | Never reused for different semantics. |
| **Cross-references** | Existing links must resolve or redirect until MAJOR removal. |
| **External citations** | Implementation, training, and partner materials citing v1.0 IDs must be mappable to current version. |
| **Baseline manifest** | Each release updates [BASELINE_MANIFEST](./BASELINE_MANIFEST_v1.0.0.md) or successor. |

---

## 8. Change proposal requirement

After the [Baseline Freeze](./BASELINE_FREEZE.md), all **MINOR** and **MAJOR** documentation changes require a **documented change proposal** including:

1. Affected document IDs and version bumps
2. Constitutional and rule impact analysis
3. Guard and State Machine impact (if any)
4. Volume 8 test impact
5. Backward compatibility assessment
6. ADR reference (MAJOR only)

PATCH changes may proceed via Documentation Steward with change log entry only.

---

## Document navigation

| | Link |
|--|------|
| **Previous** | [Baseline Manifest v1.0.0](./BASELINE_MANIFEST_v1.0.0.md) |
| **Next** | [Baseline Freeze](./BASELINE_FREEZE.md) |
| **Product** | [Product Documentation Index](../README.md) |
