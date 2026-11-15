# Multi-Factory Master Control Hub v1.1

*Multi-Factory Master Capacity, Services & Simulation Hub — release 1.1.0.*

An offline-first **React + TypeScript + Vite + Tailwind CSS** application. The **Multi-Factory Master Control Hub** brings together 40–50+ **Cell Design Passports** across a 2–4 plant network (**F1–F4**). It owns the **5-Level BOM**, the **Master Schedule** and the **BOM ↔ Cell Route** mapping. It folds every cell's micro-routes into simulation-ready **Cell Macro-Blocks**, and turns them into capacity, CapEx, utilities, stores, floor-space and material-flow decisions.

The whole application builds to one self-contained file, `dist-offline/index.html`. It uses no CDNs and makes no network calls, so you can open it straight from disk.

---

## Quick start

```bash
npm ci
npm run dev             # http://localhost:5173
npm test                # 223 unit tests (Vitest)
npm run build:offline   # → dist-offline/index.html (single file, zero external CDNs)
npm run samples         # regenerate example input files under samples/
```

Open `dist-offline/index.html` in any modern browser. The hub starts with a realistic F1–F4 baseline (see *Baseline data*), so every view, chart and export works straight away.

## Architecture rationale: Master Control Hub vs Cell Passports vs Siemens Plant Simulation

| Layer | Owns | Why it lives there |
|---|---|---|
| **Cell Design Passports** | Micro-routes (up to 20 ops per route), machines, fixtures, crew and 0–3 competence, cell gate status | The people who design and run each cell own the detail. The hub ingests it and never re-keys it. |
| **Master Control Hub** (deterministic) | 5-Level BOM explosion and Master Schedule, Fixed Process (FPD) governance and drift, CapEx, footprint, utilities, stores, material flow, rapid scenario trade-offs and cause-effect | Closed-form maths answers *how much, where, and at what cost* in milliseconds. Every figure traces back to its inputs, which makes it ideal for governance and for comparing dozens of options. |
| **Siemens Plant Simulation** (time-based) | Queues at Shared Work Centres, stochastic OEE (breakdowns / MTTR), buffer starvation and blocking, batch transit | Averages hide queues. Only an event-driven model shows how variability, batching and shared resources interact over time. |

**The hand-over.** Each Macro-Block carries **`Bottleneck_Cycle_Min`** (the steady-state rate) and **`Total_Route_LeadTime_Min`** (setup + touch + walk-away for a whole batch). Recommended WIP Buffers travel with them. Shared Work Centres tagged *Queue Contention Risk — Verify in Plant Sim* are where the simulation earns its keep.

The same rationale appears as a card on the IDEF0 System Map and in *Phase 4 · Siemens Plant Simulation*.

## Navigation and header tools

Four phase tabs run across the top bar, and each phase has a row of view pills. There are 16 views in all:

| Phase | Views |
|---|---|
| **1 · Control & Architecture** | Factory Control Hub · IDEF0 / Swimlane System Map · Logic & Data Integrity · Baseline Governance |
| **2 · Inputs & Master Data** | Fixed Process Baseline · Cell Passports · 5-Level BOM & Schedule · Assets & Workforce Skills (incl. Alias Dictionary and Dictionary Defaults) · Buffers & Stores |
| **3 · Design & Scenarios** | Cells & Macro-Routing · Factory Floor-Plan Layout · Facility & Cell Services · Static Scenario Planner |
| **4 · Validation & Outputs** | Siemens Plant Simulation (Tecnomatix) · Fixed Process ECR Pack · Spec Sheets |

**Header tools:**
- **Global Quick-Find.** Searches Cell IDs, BOM Part IDs, Master Assets, Shared Work Centres and Fixed Process Documents. Use the arrow keys and Enter to jump to a result.
- **Executive View / Full Engineering.**
  - *Executive View* shows the Factory Control Hub, the IDEF0 map, the Static Scenario Planner and the Phase 4 outputs.
  - *Full Engineering* shows all 16 views.
  - Jumping to an engineering-only view switches mode automatically.
- **⬆ Smart Import.** Drop any `.json`, `.xlsx` or `.csv` file. The hub detects the file type, with a confidence score, the reason and any alternatives. Recognised types are:
  - Cell Passports
  - a Fixed Process Baseline or Revision
  - Master Assets / Fixtures / Skills
  - a Legacy Capacity / BOM Workbook
  - Plant Simulation statistics
  - DES results
  - a Full-Plant Backup

  It then opens the matching preview with the file already loaded. Empty or malformed files get a friendly inline message.
- **Baseline badge.** Shows `vMAJOR.MINOR` and the sign-off status, and links to the audit log.
- **🔗 Link Project File.** Direct local file auto-save; see *Data safety*.
- **⬇ Backup, ⬆ Restore, ⟲ Snapshots and Reset baseline.**

Every KPI card, readiness badge, leaderboard row and capacity bar has a plain-English, one-sentence hover explanation, marked with an ⓘ. They all come from `src/engine/glossary.ts`.

## Phase 1 · Control & Architecture

### Factory Control Hub
- **Model & FPD Readiness strip.** Sits at the top and shows:
  - Active Factories (*n of 4*)
  - Baseline version and sign-off status
  - Storage sync (*Linked: file.json · saved HH:MM:SS* or *Browser storage only*)
  - Logic Integrity score (*n/36 checks*)
  - a stacked RAG bar of Fixed Process alignment (Aligned / Maturing Drift / Compliance Deviation / New Local Step), with the locked FPD revisions

  Clicking any badge or bar segment jumps straight to the matching view. A drift segment opens the Fixed Process drift list filtered to that class.
- **Guided Next Actions.** Ranks the most important things to do next, using the Ingestion Audit, Fixed Process Drift and Logic Integrity engines plus capacity, utility and space checks.
  - **Critical:**
    - unmapped BOM nodes, with **⚡ Auto-Match**
    - compliance deviations
    - gate-blocked cells
    - cells left in an inactive factory
    - assets owned twice
  - **Warning:**
    - bottlenecks
    - Shared Work Centres with a queue-contention risk
    - Red utilities
    - factories over their floor-space ceiling
    - integrity errors
    - cells needing data action
  - **Information:** drifts awaiting justification, ECR-ready drifts, baseline sign-off.
- **Scope bar.** The `All Plants / F1–F4` filter pills list active factories only. Next to them are the **Active / Inactive switches** for F1–F4.
- **KPIs:**
  - Total CapEx £ (cells + shared plant)
  - Footprint m² (8 m² fixed + 20% variable per cell, 35% circulation, plus stores)
  - Stores & WIP working capital
  - average utilisation, OEE, TEEP, PCE (VA / NVA / ENVA)
  - bottleneck and blocked cells
  - material handling hours per year
- **"Where Parts Wait & Travel Most".** A three-column leaderboard:
  - *Longest Process Dwell* (top 3 by process + queue hours per batch, with WIP £)
  - *Most Visited Cells & Work Centres* (top 3 by batches per year and pallets per year)
  - *Longest Travel Corridors* (top 3 by km per year)

  The same strip appears in *Phase 3 · Cells & Macro-Routing* and the floor-plan view.
- **Other panels:**
  - cell utilisation chart and footprint build-up
  - PCE split and factory services status
  - the exception list
  - the **Micro-vs-Macro Ingestion Audit**, with a live per-factory compression-ratio badge (*F1 12.9 : 1*)
  - Logic Integrity and Buffers & Stores summaries

### IDEF0 / Swimlane System Map
An SVG process and data-flow map, built by `src/engine/systemmap.ts` and drawn by `src/components/SystemMap.tsx`:
- **Inputs:** Fixed Process Docs, Cell Passports, BOM & Schedule, Assets / Skills 0–3, Stores Dictionary.
- **Controls:** Dictionary Defaults, Drift Tolerances, Baseline Gate.
- **Swimlanes:**
  1. Engineering Authority
  2. Cell & Asset Layer
  3. Multi-Factory Network F1–F4
  4. Decision & Siemens Plant Sim Proof
- **Outputs:** shown on the right of the map.

Every node carries a live status badge and jumps to its view when clicked. A list view gives the same information for accessibility. The Architecture Rationale card sits underneath.

### Logic & Data Integrity
`src/engine/integrity.ts` runs 36 checks across the digital thread:

| Link | Checks |
|---|---|
| Fixed Process | orphaned FPD parts, unregistered documents, duplicate Op Nos, mapped parts without an FPD |
| BOM | circular links, orphan parents, duplicate lines, level jumps, unscheduled L1s, orphan schedule lines |
| BOM ↔ Cell Routes | unmapped Make nodes, stale mappings, mappings for unknown parts, mapped Buy parts, dual-source shares ≠ 100%, orphan routes |
| Routes ↔ Ops | empty or > 20-op routes, ops on machines or tooling missing from the cell, overrides on missing routes |
| Ops ↔ Master Data & Skills | catalogue gaps, unknown roles, skills with no operator, skills missing from the catalogue |
| **Asset Ownership & Factories** | **single ownership:** an Asset ID in more than one Cell Passport, or in both a passport and Shared Plant, is an error because it would double-count CapEx, m² and utilities. Also: cells or mappings still assigned to an inactive factory; Shared Work Centre designations for unknown cells |
| Buffers / Stores | buffers with a missing producer or consumer, L5 items without a unit cost, kitting demand for unmapped parts |
| Facility Services | missing utility or floor ceilings for active factories, machines with zero kW |

The score is the share of checks with no findings. The baseline's deliberate exceptions show up as 1 error and 3 warnings.

### Baseline Change Governance
- **Version rules:**

  | Event | Version | Sign-off |
  |---|---|---|
  | Cell Passport re-ingestion, Master Data / legacy import, or a significant live edit | minor +1 | resets to Draft |
  | Scenario promotion, backup restore, project-file load or reset | major +1 | Draft, or **Approved Baseline** when the promoted scenario was approved |
  | Sign-off | no change | changes as signed off (Draft → Reviewed → Approved Baseline) |

- **Audit log:** records timestamp, action, actor, version from → to, status and details. It survives restores and resets, and exports as `.csv` or `.json`.
- **Promotion gate:** the optional Dictionary setting *Require Reviewed/Approved status before promoting Scenario to Live Baseline* is enforced in the UI and in the promotion itself.

## Phase 2 · Inputs & Master Data

### Fixed Process Baseline (locked reference layer)
`state.fixedProcess` holds the formal Fixed Process Documents. They are read-only and kept separate from the Working Cell Routes and Scenarios.
- **Fields:** Document ID, Revision, Effective Date, BOM Part ID, Op No, Op Description, Standard Setup and Cycle Min, Required Skill Level (0–3), Tooling/Fixture Spec, Mandatory Step.
- **Import:** `.xlsx`, `.csv` or `.json`, with fuzzy column mapping.
- **Seed documents:** `FPD-ATLAS/BOREAS/CIRRUS-001 Rev C`, 674 steps covering all 67 mapped Make parts.

**Live Drift Reconciliation.** Every working op, from the live design or any scenario, is classified using tolerances you can edit in the Dictionary:

| Class | Rule |
|---|---|
| **ALIGNED** | cycle within ±5% and setup within ±10% of standard |
| **MATURING DRIFT** | beyond tolerance but within the ±25% compliance limit; different tooling; or a non-mandatory step not performed |
| **COMPLIANCE DEVIATION** | a mandatory step missing; beyond ±25%; no operator at the Required Skill Level; or the specified tooling not used |
| **NEW LOCAL STEP** | a working op with no counterpart in the document |

- **Variance bars.** Each row shows horizontal bars comparing working setup and cycle against the standard. They are centred on zero, marked at the tolerance, and coloured green within tolerance, amber for maturing drift and red beyond the compliance limit.
- **Open items toggle.** *Show only open / unapproved items* hides drifts that already have an Approved or Rejected decision.
- **Justifications.** Drifts can be *Proposed*, *Approved for ECR* or *Rejected*. A justification recorded inside a scenario is carried over when that scenario is promoted.
- **Deliberate seed examples:**

  | Cell | Class | Example |
  |---|---|---|
  | CELL-A | MATURING DRIFT | faster cycle; 2 drifts already approved |
  | CELL-D | MATURING DRIFT | interim check skipped |
  | F2-C01 | MATURING DRIFT | setup above standard |
  | CELL-B | NEW LOCAL STEP | working op not in the document |
  | CELL-C | COMPLIANCE DEVIATION | mandatory MPI missing |
  | F3-C07 | COMPLIANCE DEVIATION | Skill Level unmet |

**Compare / Ingest Updated Revision.** Diffs Rev N → Rev N+1 against two references:
- **The locked baseline:** shows the spec step changes.
- **The Working Factory Design:** shows deviations falling back into alignment, newly deviating ops, ops still drifting, and impacted cells.

Locking the new revision is audited as `Fixed Process revision`.

### Cell Passports, Alias Dictionary & Data Quality
- **Batch ingestion.** Drop `.json` passports as single files, arrays or `{ passports: [...] }` bundles. Each passport is upserted by Cell ID, and an older revision is skipped. Updated passports route their rolled-up metrics into their mapped Factory → Cell → BOM slot automatically.
- **Alias Dictionary.** `state.aliases` maps incoming nicknames to canonical IDs across four domains: Cell IDs, BOM Part / Variant IDs, Master Asset IDs, and Master Tooling / Fixture IDs.
  - Matching is exact first, then by alias. Near-duplicates are also caught: case and punctuation differences, or up to 2 insertions, deletions or transpositions.
  - Substitutions are not treated as typos, so sibling IDs such as `CELL-A` and `CELL-B` stay distinct.
  - With **0 mismatches** a passport ingests silently. Otherwise the preview offers **Map & Remember Alias** or *Keep as new*.
- **Data Quality Score (%) and Needs Data Action.** Each cell gets a score with a plain-English punch-list. **⬇ Export Normalised Passport (.json)** writes the cell's passport with canonical IDs applied, plus a `normalisation` block, so the cell owner can fix issues at source.

### 5-Level BOM & Master Schedule
- **Master Schedule editor:** annual volume, Q1–Q4 split and launch-rate overrides.
- **BOM tree:** indented L1 → L5, with net and gross demand, quarterly gross, cumulative yield, critical-path lead time and **Cascade Bottleneck** flags.
- **Shared L5 roll-up:** raw material and bought-out parts used across the BOM.
- **BOM ↔ Cell Route Linker:** auto-match by ID (≥ 0.8), suggestions, manual override, dual-source `sharePct` and stale-mapping detection.

### Assets & Workforce Skills
- **Catalogues use master-data dropdowns:**

  | Catalogue | Dropdown or combo-box |
  |---|---|
  | Master Assets | *Factory*, *Cell ID / Shared WC* (cells of that factory, Shared Work Centres marked) and *Complexity Class A–E* (with the OEE default) |
  | Master Fixtures | *Linked Asset* combo-box (`<datalist>`) |
  | Skills / Roles | *Skill ID* combo-box (`<datalist>`) |
  | Alias Dictionary | *Incoming Nickname* combo-box, filled with the flagged unrecognised IDs in that domain |

- **Workforce competence matrix (0–3).** Only **≥ 2** counts as productive.
- **Catalogue Importer.** Fuzzy column matching, `.json` mapping profiles, *Merge/Upsert* vs *Replace Unreferenced*.
- **Smart Legacy Workbook Importer.**
- **Dictionary Defaults:**
  - 48 weeks per year, 82% labour availability, Complexity 90/80/70/60/50%, Fixture flag 80%
  - footprint and circulation; thresholds; payback inputs; relocation rigging and recommissioning
  - drift tolerances; Plant Simulation shift starts and break
  - the stores dictionary
  - the **Active Factory switches**
  - **inter-plant road distances** (F1–F4, symmetric)
  - **material-flow assumptions:** parts per pallet, handling minutes, internal and road speeds, pallets per truck, auto-grid aisle
  - **Shared Work Centre risk thresholds**
  - the promotion governance gate

### Buffers & Stores
`src/engine/stores.ts` models four storage tiers:

| Tier | What it holds | Sizing |
|---|---|---|
| **RM** | Raw Material & Bought-Out Stores (L5) | daily gross × days of cover |
| **KIT** | Kitting / Marshalling Zones (L2–L4) | daily demand × days of cover |
| **WIP** | Inter-Cell WIP Buffers / Line-Side Supermarkets | batch + setup cover + z × CV(OEE) × rate × replenishment time; dwell by Little's law |
| **FG** | Finished Goods & Despatch Staging (L1) | daily demand × days of cover |

Every item reports Days of Cover, locations / stillages, Stores Footprint m² and Working Capital Tied Up £. Standard cost is rolled up the BOM: the L5 unit cost plus route work content × £/min conversion. Plant totals cover active factories only.

## Phase 3 · Design & Scenarios

### Cells & Macro-Routing Explorer
- **Layout:** collapsible F1–F4 accordions, with search and status filters (`All / Bottleneck / Gate Blocked / Over-Utility`). A cell in an inactive factory carries a badge.
- **Route views:** switch between the *Macro-Route View (Rolled-Up)* and the *Micro-Route Drill-Down*. Machine / Labour / Tooling tags and resource utilisation are shown.
- **Expanded cell:**
  - **3-bar capacity comparison:** Machine Cap vs Competent Labour (Skill ≥ 2) Cap vs Tooling Dwell Cap, against the Required Demand marker. The tightest bar is the Binding Capacity Cap.
  - **One-line bottleneck verdict**, for example: *"Bottleneck: machine time on Spray Paint Booth limits the cell to 1,398 units/yr against 1,649 required — add a machine, a shift or shorter setups to close the gap."*
  - **Shared Work Centre designation**, with its queue-contention badge and feeding cells.
  - **Data Quality card** and the **What-If Shift / CapEx solver**.

### Shared Work Centres
A Shared Work Centre is a cell fed by several other cells, such as a paint line, anodise line, robotic weld cell or CMM room.
- **Where they are set:** `state.sharedWorkCentres`, designated in the Cells explorer. The seed designates `F2-C02`, `F3-C03`, `F3-C04` and `F3-C06`.
- **Feeding cells:** derived from the BOM. A cell feeds the work centre when it makes a child part of a part the work centre makes.
- **Risk badge:** a work centre with **≥ 3 feeding cells**, or running **above 75% static utilisation**, is tagged **"Queue Contention Risk — Verify in Plant Sim"** (amber). Both thresholds are editable.
- **Where it shows:** the badge appears in the Cells explorer, on the floor-plan canvas, in Guided Next Actions, as a Scenario Comparison row and in the cause-effect chain. Its routing rows are marked in the DES table.

### Factory Floor-Plan Layout & Spaghetti Intensity
- **Plan image (optional).** Upload a `.png`, `.jpg` or `.svg` plan per active factory. It is stored offline with the project and must be under 6 MB.
- **2-point calibration.** Click two points a known distance apart and enter the metres; the plan size follows. Without an image, or before calibration, the **auto-grid** sizes the plan from the blocks.
- **Blocks.** Scaled footprint blocks for every cell, every **Shared Work Centre** and the stores (Goods-In RM, Kitting, WIP Supermarket, Finished Goods & Despatch, Dock). Drag and drop them into place. Placed positions persist; unplaced blocks stay on the auto-grid (dashed outline).
- **Part-flow vectors** come from the 5-Level BOM and the Cell Route mappings:
  - Goods-In → the cell making each part that consumes bought material
  - child-part cell → parent-part cell, including Cell ↔ Shared Work Centre moves
  - L1 cell → Despatch

  Dual-source shares and subcontract offload scale every vector. Weighted spaghetti lines are drawn over the plan: thicker means more pallets per year, and purple means a cross-factory leg via the dock.
- **KPIs:**

  | KPI | Rule |
  |---|---|
  | Intra-Factory Travel (km/yr) | pallets × rectilinear aisle distance × 2 (loaded + empty return) |
  | Cross-Factory Transfers (units and pallets/yr) | flows whose producing and consuming cells are in different factories |
  | Inter-Plant Distance (km/yr) | truck trips (pallets ÷ pallets per truck) × road km × 2, using the editable F1–F4 distances |
  | Material Handling Hours/yr | pick-up / set-down per move + internal driving time + truck loading per pallet + road driving time |
  | Spaghetti Intensity | intra-factory km/yr per 1,000 m² of laid-out floor |

These figures also appear in Scenario Comparison (*Intra-factory travel*, *Cross-factory transfers*, *Inter-plant distance*, *Material handling*) and in the **Flow** cause-effect chain.

### Facility & Cell Services
- **Cell spec sheets:** a 1-click **Cell Facilities & CapEx Spec Sheet** (`.csv` / `.png` / `.json`), covering kW, air, extraction, crane, coolant, footprint and CapEx.
- **Factory-Level Services Balance:** cell demand + shared plant against installed capacity, for active factories, with Amber/Red flags.

### Static Scenario Planner & Cause-Effect Studio
- **Copy-on-write scenarios.** Scenarios are stored in IndexedDB (`scenarios` store, schema v2). Live Cell Passports are never changed until *Promote Scenario to Live Baseline*, which asks for confirmation and takes a snapshot first.
- **Factory network.** Per-scenario Active Factory switches let you test a 2-, 3- or 4-plant network.
- **Cell vs Cells:** move, clone (with % dual-source), merge or decommission cells.
  - The space table shows Cells + Circulation m², Stores & Buffers m² and Total m² against each `floorAreaM2`.
  - Utilities are checked against the plant ceilings.
  - Relocation vs Replication CapEx is reported.
- **Asset vs Asset Load:** reassign machines between cells. An Asset Load Heatmap (Q1–Q4 and annual; Baseline / Scenario / Δ) and a Binding Capacity Cap re-check follow.
- **Route vs Route:**
  - edit micro-ops, or split an op across two machines
  - change batch and tooling
  - override the folded Macro-Block (setup / cycle / batch / Effective OEE)
  - change the shift pattern (1/2/3 shifts, with matching crew)
  - set dual-source splits and Make-vs-Buy subcontracting
- **Stress-test presets:**
  - SMED −50% setup; batch halving
  - 2 → 3 shifts; overtime; key Level-3 operator absence
  - +20% / +35% Programme surge; Q4 → Q2 launch pull-forward
  - "Bad Week" (−8 OEE points / +3 scrap points)
  - Make-vs-Buy offload
- **Comparison matrix:**
  - throughput, fulfilment, utilisation, bottlenecks, peak-quarter overloads, gate-blocked cells
  - CapEx, incremental investment, unit conversion cost, payback
  - footprint, stores footprint, working capital
  - Fixed Process alignment and compliance deviations
  - utility and space overruns
  - **intra-factory travel, cross-factory transfers, inter-plant distance, material handling, Shared Work Centre queue risks**
  - OEE, TEEP, PCE
- **Key Effects & Possible Causes:**
  - throughput and binding-constraint shifts
  - BOM scrap and L5 ripple; schedule changes
  - gate changes; utility and space thresholds
  - Fixed Process drift; stores
  - **Flow** (travel, corridors, cross-factory pallets, Shared Work Centre risk)
  - **Factories** (switched-off plants and stranded cells)
- **Export.** The report downloads as `.csv` or `.json`, or opens as print-friendly HTML. Any scenario can go straight to the Siemens Plant Simulation export.

## Phase 4 · Validation & Outputs

### Siemens Tecnomatix Plant Simulation preset and DES export
**Export.** The 1-click DataTables export from the Live Baseline or any scenario, as `.xlsx`, `.csv` or `.json`:
- **`Routing_DataTable`:**
  - MU name, Station_Path, batch, setup and processing seconds
  - **`Bottleneck_Cycle_Min`** (steady-state throughput rate)
  - **`Total_Route_LeadTime_Min`** = Σ setup + batch × Σ (touch + walk-away) — the realistic batch transit delay
  - Availability %, MTTR, station quantity and binding constraint
  - next buffer / station, or the despatch Drain
- **`ProductionPlan_DataTable`:** source, quarter, quantity, batches and inter-arrival time.
- **`ShiftCalendar_DataTable`:** shift starts and break come from the Dictionary.
- **`Buffer_DataTable`:** `Buffer_ID`, `Station_Path`, `Capacity_Units`, `Initial_WIP`, `Dwell_Time_Sec`.

Touch time is the operator-attended minutes (labour minutes, or the full cycle for manual ops). Walk-away time is the unattended machine minutes beyond that. The generic DES routing table shows both times and marks Shared Work Centre rows.

**Validation.** Import Station / Buffer / Drain statistics (`StatWorkingTime`, `StatBlockingTime`, `StatWaitingTime`, `StatThroughput`) as CSV, TSV or JSON. The hub reports `AGREE` / `DISAGREE` against the analytic utilisation and throughput, and flags buffer starvation and blocking with their likely causes. Generic DES results can be re-imported for the same check, with buffer-queue alerts.

### Fixed Process ECR Release Pack
One click compiles every approved drift into the pack:
- the ECR reference and the documents to re-issue
- approved drifts with their setup and cycle deltas
- the proposed Rev N+1 step list
- the working Macro-Blocks
- a sign-off block

It exports as `.xlsx` (5 sheets), as `.csv`, or as a print-ready HTML pack, and can be *issued & locked* as the next revision.

### Spec Sheets
Cell Facilities & CapEx Spec Sheets, for any cell.

## Calculation rules

Every core engine function in `src/engine/` carries JSDoc.

| Quantity | Rule |
|---|---|
| Available minutes | shifts/day × hours/shift × 60 × days/week × weeks/yr (default **48**) |
| BOM explosion | child net = parent gross × qty per; gross = net ÷ (1 − scrap %); cumulative yield = Π(1 − scrap) |
| Rolled-up setup | Σ setup minutes of the route's micro-ops |
| Bottleneck cycle | max over assets of (Σ cycle on asset ÷ asset qty) |
| Touch / walk-away | touch = labour min (manual op: cycle); walk-away = max(0, cycle − touch) |
| Total route lead time | Σ setup + batch × Σ (touch + walk-away) |
| Effective OEE | cycle-weighted asset OEE; the Complexity default (A–E = 90/80/70/60/50%) where OEE is missing |
| Machine cap | qty × available min × OEE ÷ Σ(cycle + setup/batch) on that asset |
| Competent Labour cap | operators with competence **≥ 2** × available min × **82%** ÷ labour min per unit |
| Tooling Dwell cap | fixture qty × available min × max dwell % (default **80%**) ÷ Σ cycle using the fixture |
| **Binding Capacity Cap** | **MIN(Machine, Labour, Tooling)**. For a cell's demand mix, each constraint's cap = demand ÷ (highest utilisation of that resource type) |
| Footprint | cell = Σ asset m² × 1.20 + 8 m²; factory = Σ cell × 1.35; total = factory + stores |
| TEEP / PCE | OEE × (available ÷ calendar min) / VA ÷ (VA + NVA + ENVA) |
| Services balance | Σ cell services + shared plant parasitic loads vs capacity; Red > 100%, Amber ≥ 85% |
| Compression ratio | raw micro-ops ÷ folded Macro-Blocks, per factory |
| Shared Work Centre risk | feeding cells ≥ 3 **or** static utilisation > 75% |
| Material flow | see *Factory Floor-Plan Layout & Spaghetti Intensity* |
| Process dwell (leaderboard) | demand-weighted route lead time per batch + inbound buffer dwell (Little's law); WIP £ = batch in process + inbound buffer stock |
| Throughput (scenarios) | Σ L1 demand × MIN(1, 100% ÷ worst utilisation of any cell feeding that L1) |
| DES validation | AGREE when \|sim − analytic\| ≤ 5 pp; buffer alert when max queue > 25 |

## Cell Passport `.json` format

```jsonc
{
  "passportId": "PP-CELL-A", "cellId": "CELL-A", "cellName": "CNC Cell 01", "factory": "F1",
  "revision": 3, "gateStatus": "PASSED",
  "shiftPattern": { "shiftsPerDay": 2, "hoursPerShift": 7.5, "daysPerWeek": 5 },
  "assets":   [{ "assetId": "CELL-A-VMC5-01", "qty": 2 }],             // optional overrides: oeePct, electricalKw, …
  "fixtures": [{ "toolingId": "FX-ATL-100-DM-W-01", "qty": 2 }],
  "crew":     [{ "operatorId": "CELL-A-OP01", "roleId": "R-MCH", "competence": { "SK-CNC": 3 } }],
  "routes": [{
    "routeId": "RT-ATL-100-DM-W-01", "variantId": "ATL-100-DM-W-01", "productFamily": "ATLAS",
    "description": "Output Shaft", "batchSize": 20,
    "ops": [{ "opNo": 10, "description": "OP10 Rough machine", "assetId": "CELL-A-VMC5-01",
              "setupMin": 40, "cycleMin": 4.2, "labourMin": 1.0, "skillId": "SK-CNC",
              "toolingId": "FX-ATL-100-DM-W-01", "vaType": "VA" }]
  }],
  "serviceAllowance": { "electricalKw": 130 }
}
```

The importer also accepts common field aliases (`cell_id`, `plant`, `operations`, `steps`, `setup`, `cycle`, …).

## Baseline data

`src/data/seed.ts` builds the baseline deterministically:

- **Cells:** 47 in total:
  - F1 Precision Machining: 12
  - F2 Fabrication & Welding: 12
  - F3 Surface Treatment & Finishing: 11
  - F4 Final Assembly & Test: 12
- **CELL-A CNC Cell 01:** two 5-axis machining centres, a CMM, a deburr bench and a washer, on 2 shifts.
- **Shared Work Centres:** four are designated (`F2-C02`, `F3-C03`, `F3-C04`, `F3-C06`). Three of them carry a queue-contention risk.
- **BOM:** 3 Programmes (ATLAS, BOREAS, CIRRUS), each with 2 L1 Variants and a common L2 module, giving a 162-line 5-level BOM.
- **Deliberate cases:**
  - bottlenecks, plus a Labour-bound and a Tooling-bound cell
  - gate-blocked and over-utility cells
  - unmapped BOM nodes and orphan routes
  - a launch ramp and Red/Amber utilities
  - an Alias Dictionary (7 aliases)
  - the Fixed Process drift examples
- **Sample DES results**, so the validation view shows output from the start.
- **Clean change log:** one baseline ingestion entry and one *Baseline created* audit entry (v1.0, Approved Baseline).

`samples/` holds ready-made inputs for every importer:
- passports, including nickname and typo examples
- `master-data.xlsx` and the master-list CSVs
- `legacy-capacity-bom.xlsx`
- `des-results.csv` and `plantsim-statistics.csv`
- `fixed-process-rev-C.xlsx` and `fixed-process-ATLAS-rev-D.csv`

## Data safety

- **Autosave:** state saves to **IndexedDB** (`multi-factory-hub-v1`, schema v2), with a `localStorage` fallback.
- **Snapshots:** **5 rolling auto-snapshots** are kept, taken on significant changes and before any restore, promotion or reset.
- **Direct Local File Auto-Save.** *🔗 Link Project File* uses the File System Access API (`showSaveFilePicker` / `showOpenFilePicker`):
  - **Format:** the linked `.json` uses the Full-Plant Backup format and is written about 1.5 s after each change.
  - **Status:** the top bar reads *Linked: filename.json · saved HH:MM:SS* or *Browser storage only*.
  - **Conflict check:** before each write the file's `lastModified` is compared with our own last write. If the file was changed on disk, auto-save pauses until you choose *Overwrite file* or *Reload from file*.
  - **After a reload:** the link is remembered and can be re-connected with one click.
  - **Fallback:** where the API is unavailable or blocked (for example by a corporate `file://` policy), the hub keeps working on IndexedDB with ⬇ Backup / ⬆ Restore.
- **Backups:** 1-click full-plant `.json` backups. They include governance, the Alias Dictionary, Shared Work Centres and floor-plan layouts.

## Project structure

```
src/engine/     types, settings, bom, rollup, mapping, ingest, model (audit/KPIs/services),
                flow (floor-plan geometry, part-flow vectors, spaghetti, leaderboards),
                sharedwc, verdict, quickfind, glossary, services (spec sheet), des, tecnomatix,
                importer, legacy, whatif, scenario, stores, integrity, governance,
                fixedprocess, systemmap, smartimport, nextactions, navigation, aliases,
                version, sheet (SheetJS), csv
src/data/       deterministic F1–F4 baseline
src/store/      IndexedDB/localStorage persistence, project-file auto-save, React context
src/components/ UI primitives, readiness strip, leaderboards, Quick-Find, project-file control,
                active-factory switches, architecture card, audit, integrity, governance, system map
src/workspaces/ phase views (Control Hub, BOM, Cells, Floor Plan, Services, Master Data,
                Fixed Process, Scenario Planner, Plant Simulation / DES, ECR, Spec Sheets)
tests/          Vitest unit tests (engine, importers, persistence, flow & governance,
                release hardening, terminology)
scripts/        sample-file generator
```

CI (`.github/workflows/ci.yml`) runs the type-check, the tests and the offline build, then checks that `dist-offline/index.html` references no external assets. The built `dist-offline/index.html` is committed to the repository.
