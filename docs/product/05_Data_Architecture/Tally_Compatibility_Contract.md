# Flowtix–TallyPrime Compatibility Contract

| Field | Value |
|---|---|
| Status | Proposed — Release-1 architecture gate |
| Effective date | 2026-07-15 |
| Owners | Product Architecture, Inventory, Commercial, Integration |
| Scope | TallyPrime master import, opening stock and accounting voucher export |

## 1. Ownership boundary

Flowtix is authoritative for Items used operationally, locations, operational inventory, opening-stock approval, planning, procurement, Work Orders, material movements, production, QA, dispatch, and operational sales/purchase documents. Tally is authoritative for accounting books, statutory accounting, GST returns, financial reporting, and accepted accounting vouchers. Flowtix must not become a parallel general ledger.

Data directions are deliberately asymmetric:

| Data | Direction | Authority after synchronization |
|---|---|---|
| Units, Items, parties, opening balances | Tally → staged review → Flowtix | Flowtix for subsequent operations |
| Locations/Godowns | Tally → explicit mapping → Flowtix Location | Flowtix location identity |
| Sales and purchase invoices | Flowtix → Tally | Flowtix operational document; Tally accounting voucher |
| Voucher acknowledgement/error | Tally → Flowtix | Tally response is authoritative |
| Receipts/payments, statutory returns | Tally only in Release-1 | Tally |

## 2. Current implementation capability matrix

| Area | Current capability | Release-1 status |
|---|---|---|
| Source | Tally master XML, UTF-8/UTF-16, maximum 15 MB | Partial |
| **XML parser (canonical)** | All master import parsing uses shared `tallyXmlListHelpers.js` + `parseTallyMastersXml.js` (LIST normalization, local-tag resolution, voucher-subtree skip) | Present |
| Units | Name and symbol/code; active units only | Partial; decimal places absent |
| Items | Name, inferred RM/FG type, base unit, HSN/SAC, GST rate, stock-group text for classification | Partial |
| Item matching | Normalized display name only | Unsafe for durable sync |
| Parties | Sundry Debtor/Creditor classification; name, GSTIN, address text, state, contact, phone, email via shared LIST helpers | Partial |
| Party matching | Customer by GSTIN/name; Supplier by name | Partial/ambiguous |
| Customer Delivery Location | On Customer ledger import: upsert one **Registered Office** (`CustomerDeliveryAddress`, type REGISTERED_OFFICE, default if none). Same GSTIN on Customer + Registered Office is allowed. Re-import must not duplicate. Invoice ship-to is **not** imported as permanent locations. | Present |
| Stock Groups / Godowns / Voucher Types | Collected by the canonical walker and mappable via shared helpers; **not** applied to ERP masters in the current import UI/workflow | Parsed; apply deferred |
| Preview | Create, update-empty-fields, skip, error, warnings, CSV download | Present |
| Apply | Row-by-row creates/updates with per-row error capture | Not atomic; no durable run |
| Inactive masters | Import queries do not enforce a no-reactivation/no-overwrite policy; party helper can reactivate child addresses | Non-compliant |
| External identity | No Tally GUID/alter-id/external-id persistence | Missing |
| Alternate units | Parser may treat Additional Unit as base fallback; no conversion factor | Missing/unsafe |
| Locations/Godowns | Location master exists; importer does not map Godowns into Locations yet | Missing apply |
| Opening stock | Manual draft/approve/reverse exists; default location posting | Import missing |
| Opening rate/value | Not stored on OpeningStockEntry | Missing |
| Location opening | OpeningStockEntry has no location; approval blocks more than one active opening per Item | Missing |
| Batch opening | Not parsed or stored | Deferred |
| BOM import | Not parsed | Correctly unsupported pending safe mapping |
| Sales invoice XML | Finalized Sales Bill mapped to Tally XML with GST validation | Partial |
| Purchase invoice XML | Finalized Purchase Bill mapped to Tally XML; currently single-GST-rate restriction | Partial |
| Export state | Marked exported when XML is generated/downloaded | Non-compliant |
| Tally response | No request/response persistence or acceptance acknowledgement | Missing |
| Other vouchers | No credit/debit notes, receipts, payments, or manufacturing journal integration | Unsupported |

## 2B. Master import preview (Release-1 UI)

Preview is the review gate before apply. Behaviour:

| Area | Behaviour |
|---|---|
| GSTIN validation | Shared `resolveImportGstin` / `gstinNormalize.js` for preview **and** apply. Whitespace/newlines/separators are stripped before the 15-character check. Valid GSTINs such as `27ALSKD1412A1Z5` must not be rejected. |
| Canonical pipeline | Preview and Confirm Import **must** use the same chain: `parseTallyMastersXml` → `mapLedgerToParty` → `resolveImportGstin` → preview row / apply upsert. Apply re-runs `buildPreviewPayload` from the stored XML (no separate mapper). |
| Runtime proof | Every preview response includes `runtime.pipelineId` (and module paths). Operators must confirm the UI shows the current pipeline id after backend restart. Endpoint-level fixture tests (`tallyMasterImportHttpPreview.test.js`) are mandatory — mapper unit tests alone are not sufficient. |
| Field warnings | Invalid fields emit structured messages: Master Type, Master Name, Field, Actual Value, Reason (and disposition when GSTIN is blanked). |
| Preview grid | Customers/Suppliers show Name, GSTIN, Contact Person, Phone, Email, Address, State, Action, Status. Items and Units show the mapped import values (not name-only). Preview always shows XML-mapped values even when Action is SKIP. |
| Summary counts | Display parsed counts for Customers, Suppliers, Items, Units, Stock Groups, Godowns, Voucher Types, and Warnings. |
| Deferred masters | Stock Groups / Godowns / Voucher Types may be parsed and counted. When present, show an **info** note: “Parsed successfully. Release-1 does not import these master types.” — never as errors. |
| CSV download | Includes the same mapped columns as the grid (plus Action / Status / Warning), not name-only. |
| Duplicate policy | “Skip” does not update an existing customer. “Update empty fields only” fills blank ERP fields only — a wrong non-empty Address like `TATA` will **not** be overwritten until cleared or the customer is reset. |

**Dev diagnostics:** set `TALLY_IMPORT_DEBUG=1` to log party-map diagnostics (GSTIN candidates, mailing lines, contact/phone selection, mapper module path) for ledgers matching TATA. Do not enable permanently in production.

## 2A. Parser architecture (canonical)

All Tally **master XML import** parsing in Flowtix **SHALL** use:

| Module | Role |
|---|---|
| `backend/src/services/tallyMasterImport/tallyXmlListHelpers.js` | Canonical LIST/array normalization, local-tag lookup, deep text/number find, master display name, tagged master walk |
| `backend/src/services/tallyMasterImport/parseTallyMastersXml.js` | UTF-8/UTF-16 decode, `fast-xml-parser` options, voucher-subtree ignore policy, master collection (LEDGER, STOCKITEM, UNIT, STOCKGROUP, GODOWN, VOUCHERTYPE) |
| Entity mappers (`mapLedgerToParty`, `mapStockItemToItem`, unit/stock-group/godown/voucher-type mappers) | Business mapping only — **no** duplicated XML tree walking |

Rules:

1. Support both single objects and arrays for every `*.LIST` node.
2. Normalize nested LIST structures with `getListBlocks` before field mapping.
3. Resolve tags by local name (namespace-agnostic); do not hardcode deep path strings per module.
4. Export builders (`salesBillTallyXml`, `purchaseBillTallyXml`) remain XML **writers** and are out of scope for this import parser contract.
5. New Tally import features must extend the shared helpers rather than copying traversal logic.

## 3. Release-1 supported contract

### 3.1 Item and Unit

Supported Item fields: Tally GUID/external identity, Name, Alias, Stock Group, optional Stock Category, Primary Unit, optional one Alternate Unit, conversion factor, HSN/SAC, GST rate, and active/inactive observation. Import never silently reactivates an inactive Flowtix Item.

`Item.primaryUnitId` is canonical. Every inventory, planning, BOM, issue, production and commercial quantity stored by Flowtix remains in Primary Unit. One Alternate Unit is display/input metadata only:

`primary quantity = alternate quantity × primary units per alternate unit`

The factor must be positive and deterministic. Conversion uses Decimal arithmetic and the Primary Unit precision; invalid, missing, zero, negative, or ambiguous factors are blocking errors. Existing `Item.unitId` becomes the primary-unit reference without changing historical quantity meaning.

Unit supports Name, Symbol/Code, decimal places, Tally GUID and active state. Compound units and multiple alternates are not Release-1.

### 3.2 Parties

Supported party fields: external identity, legal/display name, mailing name, address, state, country, pincode, GSTIN/UIN, GST registration type, PAN, phone/email/contact, and credit period. GSTIN is a strong match only when unique. GUID is preferred; name-only collisions are ambiguous and blocked.

### 3.3 Locations

Each imported Tally Godown must be explicitly mapped to one Flowtix Location or proposed as a new Location for approval. Godown quantities are never collapsed unless the user explicitly selects a consolidation target during preview. Mapping persists by Tally GUID when available.

### 3.4 Opening stock

Opening Qty, Rate and Value are parsed into durable staging rows. Alternate quantities are converted before posting. Each staged allocation identifies Item, Primary Unit quantity, Location, rate, value and source identity. Release-1 does not post batch allocations; a batch-bearing row is blocked and reported as deferred/unsupported.

Approval creates an auditable Opening Stock document and location-specific OPENING ledger rows atomically. The immutable source fingerprint and company/go-live key prevent a repeated import from duplicating inventory. Approved opening stock is never overwritten; correction uses the existing controlled reversal followed by a new approved document.

### 3.5 BOM

Tally BOM import remains disabled in Release-1 unless a source structure contains an unambiguous output item, output quantity, component Items, component quantities/units and stable identity. Even then it may create a Flowtix Draft revision only. It must never update an Approved or Inactive revision or bypass Flowtix approval.

## 4. Import workflow and duplicate policy

1. Upload a supported XML source. Excel is supported only after a governed column template is introduced; arbitrary Excel is not Release-1.
2. Create a durable import run and preserve source hash, company identity, filename, actor and parser version.
3. Parse into immutable staging rows.
4. Resolve external IDs, mappings and conversions.
5. Show Create / Update / Skip / Error and field-level differences.
6. Block ambiguous, inactive-target, missing Unit/Location and invalid-conversion rows.
7. Require confirmation and approval where inventory is affected.
8. Commit the selected run atomically; any unexpected write failure rolls back the run.
9. Persist counts, row results and detailed errors.
10. Rerun by source identity/fingerprint: unchanged rows Skip; accepted opening-stock rows cannot post twice.

Matching priority is external GUID → unique GSTIN (parties) → configured alias/external mapping → exact normalized name only when unique. Display name alone is never sufficient when multiple candidates or aliases exist.

Updates are allow-listed. Identity, primary unit after transactional use, inactive state, approved BOMs and approved opening stock cannot be overwritten by import.

## 5. Accounting export acknowledgement

Release-1 exports Sales Invoice and Purchase Invoice vouchers. Voucher type, party ledger, Item, GST/tax ledgers and Flowtix document number must be configured mappings—not guessed permanently from display labels.

Export lifecycle:

`READY → GENERATED → SENT/AWAITING_ACK → ACCEPTED | REJECTED`

Generating or downloading XML is not acceptance. Flowtix marks a document exported only after parsing a Tally response that confirms acceptance. Each attempt stores payload hash, request time, response time, Tally voucher/master identifiers, response/error text and attempt number. A uniqueness key on document, direction, voucher type and payload version prevents duplicate accepted export. Rejected attempts remain retryable after correction; accepted attempts require a controlled reversal/amendment process, not an export-flag reset.

Release-1 direct-file mode may generate a package, but its status is **Generated/Confirmation pending** until an authorized user imports the Tally response/confirmation. It must not claim “Exported to Tally.”

One finalized Sales Bill exports as one Sales voucher even with multiple dispatch allocations. Seller-charged transportation exports once through the configured freight ledger and applicable GST buckets; transporter-direct charges are excluded. Missing freight mapping or an unbalanced voucher blocks XML generation.

Sales Bill Tally export reads the finalized stored snapshot and never recalculates GST. `GST_BUCKET_SPLIT_V3` drafts calculate tax once per GST-rate bucket and allocate its currency amounts back to lines deterministically, keeping line, bucket, invoice, freight-ledger and voucher totals balanced. Earlier finalized calculation versions remain unchanged.

`GST_COMPONENT_BUCKET_V4` supersedes V3 for newly rebuilt drafts: intrastate CGST and SGST are independently rounded per GST-rate bucket at equal half-rates, while interstate IGST is independently rounded at the full rate. Tally continues to export only stored finalized snapshot values.

## 6. Required schema design

| Model/change | Purpose |
|---|---|
| Unit: `decimalPlaces`, `tallyGuid`, `tallyAlterId` | Precision and stable source identity |
| Item: alias, stock group/category, `alternateUnitId`, `primaryQtyPerAlternate`, Tally identity | Release-1 item compatibility |
| Customer/Supplier: mailing name, country, pincode, registration type, PAN, credit days, Tally identity | Party compatibility |
| Location: Tally Godown GUID/name mapping | Persistent Godown mapping |
| TallyImportRun / TallyImportRow | Durable source, preview, approval, error and rerun audit |
| OpeningStockDocument / line allocation | Location, quantity, rate/value, approval and source fingerprint |
| TallyExportAttempt | Payload hash, status, attempts, acknowledgement and error response |
| TallyMapping | Voucher, ledger, Item, tax ledger and Godown mapping |

All new fields are nullable except safe defaults. Existing Item `unitId` is backfilled/treated as Primary Unit. Existing operational quantities require no conversion migration. Existing approved OpeningStockEntry records are retained and represented as legacy documents; their ledger remains authoritative. Existing `isExported=true` records migrate to `LEGACY_GENERATED_UNCONFIRMED` unless independently reconciled with Tally.

## 7. Required implementation surfaces

Backend: Prisma schema/migrations; Tally parser/mappers/import service and route; Opening Stock service/route; Item, Unit, Customer, Supplier and Location routes; sales/purchase Tally export services/routes; new import-run, mapping and export-attempt services.

Frontend: Tally Master Import, Item Master, Unit Master, party masters, Location mapping, Opening Stock approval, Sales Bill and Purchase Bill export status/retry/history.

## 8. Release-1 acceptance tests

Required automated and UAT coverage: primary-only Item; one Alternate Unit; conversion and decimal rounding; invalid/missing conversion; missing Unit/Location; Item create/update/unchanged/ambiguous/inactive; HSN/GST; Customer/Supplier GSTIN and external-ID matching; location-wise opening quantity/rate/value; approval posting; duplicate source and safe rerun; BOM draft-only protection; Sales/Purchase invoice generation; duplicate-attempt prevention; acceptance acknowledgement; rejection/error persistence and retry.

## 9. Unsupported/deferred

Release-1 does not support batch/lot imports, manufacturing/expiry dates, multiple alternate units, compound units, price levels, cost centres/job costing, foreign currency, e-invoice/e-way bill, advanced Godown hierarchy, real-time JSON/API synchronization, receipts, supplier payments, credit/debit notes, stock/manufacturing journals, or automatic Tally BOM import. See FT-PD-100 for priority and dependencies.
