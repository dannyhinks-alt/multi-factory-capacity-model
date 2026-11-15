# Multi-Factory Master Control Hub v1

*Multi-Factory Master Capacity, Services & Simulation Hub — release 1.0.0.*

The **Multi-Factory Master Control Hub** is an offline-first **React + TypeScript + Vite + Tailwind CSS** application. It brings together 40–50+ **Cell Design Passports** across a 2–4 plant network (**F1–F4**) and owns three things:
- the **5-Level BOM**
- the **Master Schedule**
- the **BOM ↔ Cell Route** mapping, including sequential multi-hop routes that cross factories

It folds every cell's micro-routes into simulation-ready **Cell Macro-Blocks**. From those it works out capacity, CapEx, utilities, stores, floor space, material flow and inter-plant logistics. The folded blocks and WIP buffers are then handed to Siemens Plant Simulation for time-based proof.

The whole application builds to one self-contained file, `dist-offline/index.html`. It uses no CDNs and makes no network calls, so you can open it straight from disk.

---

## Quick start

```bash
npm ci
npm run dev             # http://localhost:5173
npm test                # 241 unit tests (Vitest)
npm run build:offline   # → dist-offline/index.html (single file, zero external CDNs)
npm run samples         # regenerate example input files under samples/
```

Open `dist-offline/index.html` in any modern browser. The hub starts with a realistic F1–F4 baseline (see *Baseline data*), so every view, chart and export works straight away.

## Architecture rationale

| Layer | Owns | Why it lives there |
|---|---|---|
| **Cell Design Passports** | Micro-routes (up to 20 ops per route), machines, fixtures, crew and 0–3 competence, cell gate status | The people who design and run each cell own the detail. The hub ingests it and never re-keys it. |
| **Master Control Hub** (deterministic) | 5-Level BOM explosion and Master Schedule, multi-hop BOM ↔ Cell routing, Fixed Process (FPD) governance and drift, CapEx, footprint, utilities, stores, material flow and inter-plant logistics, rapid scenario trade-offs and cause-effect | Closed-form maths answers *how much, where, and at what cost* in milliseconds. Every figure traces back to its inputs, which makes it ideal for governance and for comparing dozens of options. |
| **Siemens Plant Simulation** (time-based) | Queues at Shared Work Centres, stochastic OEE (breakdowns / MTTR), buffer starvation and blocking, batch transit | Averages hide queues. Only an event-driven model shows how variability, batching and shared resources interact over time. |

**The hand-over.** Each Macro-Block carries:
- **`Bottleneck_Cycle_Min`**: the steady-state rate.
- **`Total_Route_LeadTime_Min`**: setup + touch + walk-away time for a whole batch.
- **`Routing_Step` / `Routing_Steps`**: the block's position in a multi-hop chain.

Recommended WIP Buffers travel with the blocks, including the hop buffers and inter-plant transit cover. Shared Work Centres tagged *Queue Contention Risk — Verify in Plant Sim* are where the simulation earns its keep.

The same rationale appears as a card on the IDEF0 System Map and in *Phase 4 · Siemens Plant Simulation*.

### Micro-to-Macro compression
- **Folding:** each passport route, of up to 20 micro-ops, folds into one **Macro-Block**.
- **Macro-Block contents:**
  - Rolled-Up Setup and Bottleneck Cycle
  - touch and walk-away minutes, and Total Route Lead Time
  - Effective OEE
  - Binding Capacity Cap = MIN(Machine, Competent Labour ≥ 2, Tooling Dwell)
  - CapEx, footprint and service loads
- **Compression ratio:** raw micro-ops ÷ Macro-Blocks, shown live per factory in the Ingestion Audit (seed: F1 12.6 : 1, F2 8.2 : 1, F3 7.4 : 1, F4 8.2 : 1).
- **Why it matters:** a higher ratio means a simpler, faster Plant Simulation model that keeps the capacity-relevant behaviour.

## Navigation and header tools

Four phase tabs run across the top bar, and each phase has a row of view pills. There are 16 views in all:

| Phase | Views |
|---|---|
| **1 · Control & Architecture** | Factory Control Hub · IDEF0 / Swimlane System Map · Logic & Data Integrity · Baseline Governance |
| **2 · Inputs & Master Data** | Fixed Process Baseline · Cell Passports · 5-Level BOM & Schedule · Assets & Workforce Skills (incl. Alias Dictionary and Dictionary Defaults) · Buffers & Stores |
| **3 · Design & Scenarios** | Cells & Macro-Routing · Factory Floor-Plan Layout · Facility & Cell Services · Static Scenario Planner |
| **4 · Validation & Outputs** | Siemens Plant Simulation (Tecnomatix) · Fixed Process ECR Pack · Spec Sheets |

**Header tools:**
- **Global Quick-Find.** Searches Cell IDs, BOM Part IDs, Master Assets, Shared Work Centres and Fixed Process Documents.
- **Executive View / Full Engineering.**
- **⬆ Smart Import.** A universal drop-zone with detection confidence, reason and alternatives.
- **Baseline badge** (`vMAJOR.MINOR` and sign-off).
- **🔗 Link Project File.**
- **⬇ Backup, ⬆ Restore, ⟲ Snapshots and Reset baseline.**

Every KPI card, readiness badge, leaderboard row and capacity bar has a plain-English, one-sentence hover explanation, marked with an ⓘ. They all come from `src/engine/glossary.ts`.

## Phase 1 · Control & Architecture

- **Model & FPD Readiness strip.** Shows:
  - Active Factories
  - Baseline version and sign-off
  - Storage sync
  - Logic Integrity (*n/37 checks*)
  - a stacked RAG bar of Fixed Process alignment, with the locked FPD revisions

  Every badge and segment jumps to the matching filtered view.
- **Guided Next Actions:**
  - unmapped BOM nodes, with ⚡ Auto-Match
  - compliance deviations
  - gate-blocked cells and bottlenecks
  - Shared Work Centre queue risks
  - cells in inactive factories
  - assets owned twice
  - utility and space overruns
  - integrity errors
  - Needs Data Action cells
  - drifts awaiting justification and ECR-ready drifts
  - baseline sign-off
- **Factory Control Hub.**
  - **Scope bar:** the factory filter (active plants only) plus the **Active / Inactive switches**.
  - **KPIs:**
    - Total CapEx £
    - Footprint m² (8 m² fixed + 20% per cell, 35% circulation, plus stores)
    - Stores & WIP
    - average utilisation, OEE, TEEP, PCE
    - bottleneck and blocked cells
    - **Inter-plant logistics £/yr**
    - material handling h/yr
  - **"Where Parts Wait & Travel Most":** a three-column leaderboard (longest process dwell, most-visited cells and work centres, longest travel corridors). It also appears in Phase 3.
  - **Micro-vs-Macro Ingestion Audit,** with per-factory compression badges.
- **IDEF0 / Swimlane System Map.**
  - Inputs, Controls, four swimlanes and Outputs.
  - A live status badge on every node, click-to-jump, and a list view.
  - The Architecture Rationale card.
- **Logic & Data Integrity.** 37 checks, covering:
  - Fixed Process ↔ BOM ↔ Cell Routes (including **dual-source shares per routing step** and **multi-hop sequence gaps or repeated hops**)
  - Routes ↔ Ops ↔ Master Data & Skills
  - **Asset Ownership & Factories**: an Asset ID in more than one passport, or in a passport and Shared Plant, is an error; cells or mappings in an inactive factory; unknown Shared Work Centres
  - Buffers / Stores and Facility Services
- **Baseline Change Governance.**
  - **Version and sign-off:** `vMAJOR.MINOR` (the seed baseline is v1.0, *Approved Baseline*), with Draft → Reviewed → Approved Baseline.
  - **Version bumps:** minor for re-ingestions, imports and live edits (including every Quick-Editor change); major for promotions, restores and resets.
  - **Audit log:** a structured log that exports as `.csv` or `.json`.
  - **Promotion gate:** optional, requiring Reviewed / Approved before a promotion.

## Phase 2 · Inputs & Master Data

### Fixed Process Baseline
- **Locked reference:** `state.fixedProcess` holds the read-only Fixed Process Documents (`FPD-ATLAS/BOREAS/CIRRUS-001 Rev C`, 684 steps covering every mapped Make part and every hop of a multi-hop part).
- **Drift classes:** ALIGNED / MATURING DRIFT / COMPLIANCE DEVIATION / NEW LOCAL STEP, using editable tolerances (cycle ±5%, setup ±10%, compliance ±25%).
- **Multi-hop parts:** each hop is checked against the document steps it performs. A step missing from the whole chain is reported once, at Step 1.
  - **Convention:** Op Nos run sequentially across the process, e.g. 10–90 machining, 210–260 anodise, 310–340 finish grind.
- **Drift view:** variance bars, a *Show only open / unapproved items* toggle, and justifications. Justifications recorded in scenarios are carried over on promotion.
- **Revision Diff:** Rev N → Rev N+1, and the ECR Release Pack.

### Cell Passports, Alias Dictionary & Data Quality
- **Batch ingestion:** `.json` passports, as single files, arrays or bundles.
- **Alias Dictionary:** cell, part, asset and tooling nicknames.
- **Near-duplicate detection:** case and punctuation differences, or ≤ 2 insertions, deletions or transpositions; substitutions don't count.
- **Data quality:** a per-cell Data Quality Score, a *Needs Data Action* badge, and **⬇ Export Normalised Passport (.json)**.

### 5-Level BOM & Master Schedule with the multi-hop Route Linker
- **Master Schedule:** annual volume, Q1–Q4 split and launch-rate overrides.
- **BOM tree:** L1 → L5 with net and gross demand, cumulative yield, Cascade Bottlenecks and the shared L5 roll-up.
- **Lead time:** cumulative lead time now includes **cross-factory transit days**, marked `+n⇄` in the tree.
- **BOM ↔ Cell Route Linker.** Each Make part maps to `Factory + Cell + Route/Variant` and can carry:
  - **parallel dual-source splits** (`sharePct`, summing to 100% within a step)
  - **sequential hops** (`seq` = 1, 2, 3…), for one part number travelling through several cells and factories in order

  The linker supports **+ Add hop**, editing each hop's factory, cell and route, reordering (↑ ↓), removing hops (✕) and a *Multi-hop* filter. Each multi-hop part shows its chain, e.g. `S1 F1/CELL-E ⇄ F1→F3 S2 F3/F3-C09 ⇄ F3→F1 S3 F1/CELL-L → parent BOM tier`.

### Assets & Workforce Skills
- **Master-data dropdowns:**
  - Assets: *Factory*, *Cell ID / Shared WC* and *Complexity A–E*
  - Fixtures: *Linked Asset*
  - Skills / Roles: *Skill ID*
  - Alias Dictionary: *Incoming Nickname* (the flagged unrecognised IDs)
- **Competence matrix:** the 0–3 scale, with ≥ 2 counted as productive.
- **Catalogue and legacy importers.**
- **Dictionary Defaults:**
  - capacity thresholds and footprint
  - drift tolerances
  - stores
  - Plant Simulation shift calendar
  - Active Factory switches
  - inter-plant distances
  - material-flow assumptions
  - Shared Work Centre risk thresholds
  - the promotion gate
  - **inter-plant logistics:** `interPlantCostPerTruckGbp` (£180), `interPlantTransitDays` (1.0 day) and `milkRunsPerWeek` (5)

### Buffers, WIP & Stores
Four tiers are modelled: RM (L5), Kitting (L2–L4), Inter-Cell WIP Buffers / Line-Side Supermarkets, and FG & Despatch (L1).
- **Where buffers sit:** WIP buffers follow the routing chains:
  - each child part's **last step** → its parent's **Step 1**
  - **Step k → Step k+1** of every multi-hop part (*hop buffers*)
- **Sizing:**

  | Component | Rule |
  |---|---|
  | Base buffer | batch + setup cover + z × CV(OEE) × rate × replenishment time |
  | Cross-factory cover (`producerFactory ≠ consumerFactory`) | + **transit & milk-run cover** = daily demand × (transit days + milk-run interval), where interval = working days per week ÷ milk runs per week |
  | Average WIP (cross-factory) | + daily demand × (transit + interval ÷ 2) |

- **Outputs:** Days of Cover, locations, Stores m² and Working Capital £.

## Phase 3 · Design & Scenarios

### Cells & Macro-Routing Explorer
- **Layout:** factory accordions, filters, Macro vs Micro route views and binding-constraint tags.
- **Expanded cell:**
  - **3-bar capacity comparison:** Machine vs Competent Labour ≥ 2 vs Tooling Dwell, against Required Demand.
  - **One-line plain-English bottleneck verdict.**
  - **Shared Work Centre designation**, with its queue-contention badge.
  - **✎ Edit Cell / Route:** the live Quick-Editor drawer (below).
  - **Data Quality card** and the **What-If Shift / CapEx solver**.

### Live Cell & Route Quick-Editor
The **✎ Edit Cell / Route** drawer edits the Live Baseline directly.
- **Cell fields:** shift count (1/2/3), gate status (with notes) and the Shared Work Centre toggle.
- **Route fields:** batch size, rolled-up setup minutes and bottleneck cycle minutes.
- **Consistency:** setup and cycle targets re-scale every micro-op proportionally, so the Micro-Route Drill-Down and the folded Macro-Block stay in step.
- **Governance:** every applied change is written to the audit log as a `Baseline edit` (minor version bump) and resets an Approved baseline to Draft. Unchanged submissions write nothing. The logic lives in `src/engine/quickedit.ts`.

### Shared Work Centre governance
- **Designation:** a Shared Work Centre is a cell fed by several others, held in `state.sharedWorkCentres`. The seed designates `F2-C02`, `F3-C03`, `F3-C04` and `F3-C06`.
- **Feeders:** derived from part-flow vectors, including multi-hop steps.
- **Risk badge:** a work centre with **≥ 3 feeding cells** or **> 75% static utilisation** is tagged **"Queue Contention Risk — Verify in Plant Sim"**. Both thresholds are editable.
- **Ownership:** single-ownership asset governance prevents CapEx, m² and utilities being counted twice.
- **Floor plan:** Shared Work Centres are draggable nodes on the canvas, so Cell ↔ Shared Work Centre travel counts towards spaghetti intensity.

### Factory Floor-Plan Layout, Spaghetti Intensity & Inter-Plant Logistics
- **Plan and blocks:**
  - an optional `.png` / `.jpg` / `.svg` plan per active factory, with 2-point metre calibration, or the auto-grid
  - drag-and-drop cell, Shared Work Centre and store blocks (Goods-In, Kitting, WIP Supermarket, Despatch, Dock)
- **Part-flow vectors**, from the BOM and the routing chains:

  | Kind | From → To |
  |---|---|
  | `material` | Goods-In → Step-1 cell |
  | `hop` | Step k → Step k+1 |
  | `handover` | last step → parent's Step 1 |
  | `despatch` | L1 last step → Despatch |

  Each kind is drawn as weighted spaghetti lines.
- **Exact per-plant dock-leg attribution.** A cross-factory move is credited exactly:
  - the **origin factory** gets its *Origin Cell → Despatch Dock* rectilinear leg (km/yr, pallet moves, handling hours)
  - the **destination factory** gets its *Receiving Dock → Destination Cell / Work Centre* leg
  - the road leg sits between them
- **Inter-plant logistics.** Every directed lane runs `milkRunsPerWeek` milk runs:
  - trucks/yr = runs/yr × ⌈pallets per run ÷ pallets per truck⌉
  - road km/yr = trucks × km × 2
  - **logistics £/yr = trucks × `interPlantCostPerTruckGbp`**, paid by the origin plant

  A *Milk-run lanes* table lists pallets, trucks and £ per lane.
- **KPIs:** Intra-Factory Travel (km/yr), Cross-Factory Transfers (units and pallets/yr), Inter-Plant Distance (km/yr), Inter-Plant Logistics (£/yr), Material Handling Hours/yr and Spaghetti Intensity (km/yr per 1,000 m²).

### Facility & Cell Services
- 1-click Cell Facilities & CapEx Spec Sheets.
- A Factory-Level Services Balance for active factories.

### Static Scenario Planner & Cause-Effect Studio
- **Copy-on-write scenarios** with *Promote to Live Baseline* (confirmation, snapshot, optional governance gate).
- **Per-scenario Active Factory switches.**
- **Cell vs Cells:** move, clone (with % dual-source), merge or decommission, with space and utility ceilings.
- **Asset vs Asset Load:** reassignment and the load heatmap.
- **Route vs Route:**
  - micro-op edits and op splits
  - Macro-Block override (incl. Effective OEE) and shift pattern
  - **dual-source splits within a routing step** (other hops are untouched)
  - Make-vs-Buy
- **Stress-test presets.**
- **Comparison matrix:**
  - throughput, utilisation, bottlenecks, peak overloads
  - CapEx, investment, unit conversion cost (now including logistics), payback
  - footprint, stores, working capital
  - FPD alignment
  - utility and space overruns
  - intra-factory travel, cross-factory transfers, inter-plant distance, **inter-plant logistics cost**, material handling
  - Shared Work Centre risks
  - OEE, TEEP, PCE
- **Key Effects & Possible Causes:**
  - constraint shifts, BOM and schedule ripple, gates, utility and space
  - Stores, Process and **Factories** chains
  - a **Flow** chain covering travel, corridors, cross-factory pallets, **logistics £/yr and milk-run lanes opened or closed**

## Phase 4 · Validation & Outputs

### Siemens Tecnomatix Plant Simulation DataTables
1-click `.xlsx` / `.csv` / `.json` exports from the Live Baseline or any scenario:

| DataTable | Contents |
|---|---|
| `Routing_DataTable` | MU, `Station_Path`, batch, setup / processing seconds, **`Bottleneck_Cycle_Min`**, **`Total_Route_LeadTime_Min`**, **`Routing_Step` / `Routing_Steps`**, availability, MTTR, station quantity, binding constraint, and the next buffer / station along the routing chain (hop buffer → next step, last step → parent's Step 1, L1 → Drain) |
| `ProductionPlan_DataTable` | source, quarter, quantity, batches, inter-arrival |
| `ShiftCalendar_DataTable` | shift starts and break from the Dictionary |
| `Buffer_DataTable` | `Buffer_ID`, `Station_Path`, `Capacity_Units`, `Initial_WIP`, `Dwell_Time_Sec` — including hop buffers and cross-factory transit cover |

**Statistics re-import.** `StatWorkingTime`, `StatBlockingTime`, `StatWaitingTime` and `StatThroughput` give **AGREE / DISAGREE**, plus starvation and blocking causes. The generic DES routing table shows the same step, lead-time and Shared Work Centre columns.

### Fixed Process ECR Release Pack · Spec Sheets
- **ECR Release Pack:** the approved drifts with deltas, the proposed Rev N+1 steps and the working Macro-Blocks. It exports as `.xlsx` (5 sheets), `.csv` or a print-ready pack, and can be *issued & locked* as the next revision.
- **Cell Spec Sheets.**

## Calculation rules

| Quantity | Rule |
|---|---|
| Available minutes | shifts/day × hours/shift × 60 × days/week × weeks/yr (default **48**) |
| BOM explosion | child net = parent gross × qty per; gross = net ÷ (1 − scrap %); cumulative yield = Π(1 − scrap) |
| BOM cumulative lead time | own lead time + **transit days × (factory changes within the routing chain + a hand-over to a parent in another factory)** + the longest child chain |
| Route demand | part gross demand × in-house share × dual-source share **within the step**; every sequential step carries the full demand |
| Bottleneck cycle | max over assets of (Σ cycle on asset ÷ asset qty) |
| Touch / walk-away | touch = labour min (manual op: cycle); walk-away = max(0, cycle − touch) |
| Total route lead time | Σ setup + batch × Σ (touch + walk-away) |
| Machine / Labour / Tooling cap | qty × available min × OEE ÷ load; competent heads (≥ 2) × available min × 82% ÷ labour load; fixtures × available min × max dwell % ÷ cycle |
| **Binding Capacity Cap** | **MIN(Machine, Labour, Tooling)**; for a cell's demand mix, each cap = demand ÷ (highest utilisation of that resource type) |
| Footprint | cell = Σ asset m² × 1.20 + 8 m²; factory = Σ cell × 1.35; total = factory + stores |
| Compression ratio | raw micro-ops ÷ Macro-Blocks per factory |
| Shared Work Centre risk | feeding cells ≥ 3 **or** static utilisation > 75% |
| Travel | pallets × rectilinear aisle metres × 2; cross-factory legs credited exactly to the origin and destination plants |
| Logistics | trucks = milk runs × ⌈pallets per run ÷ pallets per truck⌉; £ = trucks × £ per truck; road km = trucks × km × 2 |
| Transit buffer cover | daily demand × (transit days + working days per week ÷ milk runs per week) |
| Unit conversion cost | (labour + subcontract + recurring adjustments + depreciation + **inter-plant logistics**) ÷ throughput |
| DES validation | AGREE when \|sim − analytic\| ≤ 5 pp; buffer alert when max queue > 25 |

## Baseline data

`src/data/seed.ts` builds the baseline deterministically:
- **Cells:** 47 cells across F1–F4. CELL-A is CNC Cell 01.
- **BOM:** a 162-line 5-level BOM: 3 Programmes × 2 Variants with common L2 modules.
- **Mappings:** 67 mapped Make parts.
- **One sequential multi-hop part (out-and-back):** `CELL-E` (F1 machining) → `F3-C09` (F3 hard anodise) → `CELL-L` (F1 finish grind) → parent. Each hop route carries the part's own Variant ID.
- **Shared Work Centres:** four, three of them at queue-contention risk.
- **Deliberate cases:** bottlenecks, gate-blocked cells, unmapped nodes, orphan routes and the Fixed Process drift examples.
- **Clean governance audit log:** a single *Baseline created* entry (v1.0, Approved Baseline).

`samples/` holds ready-made inputs for every importer.

## Data safety

- **Autosave:** IndexedDB (`multi-factory-hub-v1`, schema v2), with a localStorage fallback.
- **Snapshots:** 5 rolling auto-snapshots.
- **Backups:** 1-click full-plant `.json` backups (`appVersion: "1.0.0"`), including governance, aliases, Shared Work Centres, layouts and routing chains.
- **Direct Local File Auto-Save.** *🔗 Link Project File* uses `showSaveFilePicker` / `showOpenFilePicker`:
  - **Saving:** a debounced write, about 1.5 s after each change.
  - **Status:** *Linked: filename.json · saved HH:MM:SS* or *Browser storage only*.
  - **Conflict check:** a `lastModified` check pauses auto-save until you choose *Overwrite* or *Reload*.
  - **Fallback:** where file access is blocked (e.g. by a corporate `file://` policy), the hub stays on IndexedDB with Backup / Restore.
- **Uploads:** malformed or empty uploads give friendly inline messages.

## For the software team

**Data flow.** `HubState` (persisted) → `computeModel(state)` (pure). The model pipeline runs in this order:
1. `explodeBom` (with transit lead time)
2. `demandByRoute` (routing chains)
3. `rollUpCell` → Cell Macro-Blocks
4. cascade flags
5. Ingestion Audit
6. `servicesBalance`
7. `computeStores` (chain-aware buffers, transit cover)
8. `computeFlows` (vectors, exact dock legs, milk-run lanes)

Every view reads `model`. Scenarios run the same pipeline on copy-on-write clones.

**Conventions:**
- **Engine purity:** engine modules in `src/engine/` are pure and deterministic, with JSDoc on every calculation, and are unit-tested in `tests/`.
- **Audited writes:** live edits that change the baseline go through `recordAudit` / `markEdited`; the Quick-Editor always audits.
- **Routing chains:** read routing through `chainsByPart` / `primaryOf` / `shareOf` (`src/engine/mapping.ts`) — never assume one mapping per part. Edit it through `setHop` / `addHop` / `moveHop` / `removeHop`.
- **Wording:** British English and Variant / Programme / Assembly only. A terminology test enforces this.
- **Versions:** no incremental build tags in code or docs; a release-identity test enforces this.

**Project structure:**

```
src/engine/     types, settings, version, bom, rollup, mapping (incl. multi-hop chains), ingest,
                model, flow (geometry, vectors, dock legs, lanes, leaderboards), sharedwc, verdict,
                quickedit, quickfind, glossary, stores, services, des, tecnomatix, importer, legacy,
                whatif, scenario, integrity, governance, fixedprocess, systemmap, smartimport,
                nextactions, navigation, aliases, sheet (SheetJS), csv
src/data/       deterministic F1–F4 baseline
src/store/      IndexedDB/localStorage persistence, project-file auto-save, React context
src/components/ UI primitives, readiness strip, leaderboards, Quick-Find, project file,
                active-factory switches, architecture card, audit, integrity, governance, system map
src/workspaces/ phase views
tests/          Vitest suites (engine, importers, persistence, flow & governance, routing & logistics,
                release hardening, terminology)
scripts/        sample-file generator
```

CI (`.github/workflows/ci.yml`) runs the type-check, the tests and the offline build. It then checks that `dist-offline/index.html` references no external assets. The built `dist-offline/index.html` is committed to the repository.
