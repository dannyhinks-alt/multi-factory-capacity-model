# Project: Multi-Factory Master Capacity, Services & Simulation Hub — Multi-Factory Master Control Hub v1.1

Release **1.1.0** (`package.json`, `src/engine/version.ts`). Present the complete integrated platform as *Multi-Factory Master Control Hub v1.1* — no incremental build tags or temporary sub-version labels in UI copy, tooltips, headers or docs. The Live Baseline's own data version (`vMAJOR.MINOR` governance badge) starts at v1.0 and is independent of the release number.

## 1. Core Objective
- **What to build:** an offline-first React + TypeScript + Vite + Tailwind CSS web application, the **Multi-Factory Master Control Hub**.
- **Scope:** it orchestrates **40–50+ Cell Design Passports** (`10–12+ cells per factory`) across a **2–4 plant network** (`F1`, `F2`, `F3`, `F4`).
- **Language:** British English throughout (`utilisation`, `despatch`, `analyse`, `programme`, `centre`, `£`).
- **Terminology:** zero retail terminology — use only `Variant`, `Programme` and `Assembly`.
- **Hover help:** every KPI card, readiness badge, leaderboard row and capacity bar carries a plain-English one-sentence explanation (`src/engine/glossary.ts`) of what the number means and why it matters.

## 2. Architecture Rationale & Three-Tier Digital Thread
1. **Architecture Rationale**
   - **Master Control Hub** (deterministic): owns BOM explosion, FPD governance, CapEx / utilities / space / stores / material flow and rapid scenario trade-offs.
   - **Cell Design Passports:** own each cell's micro-route detail.
   - **Siemens Plant Simulation:** receives the folded Macro-Blocks and WIP Buffers for time-based queue and stochastic OEE validation.
   - **Where it is shown:** a summary card on the System Map and in Phase 4, and a section in README.md.
2. **Master Data Catalogues** (`.xlsx` / `.csv` / `.json` via bundled SheetJS)
   - **Assets:** `Asset ID`, `Description`, `Factory`, `Cell ID`, `Category`, `Complexity Class`, `Shift Tier`, `Footprint m²`, `OEE %`, `CapEx Cost £`, `Install Cost £`, `Electrical kW`, `Compressed Air L/min`, `Extraction m³/hr`, `Crane Tonnes`, `Coolant/Water`.
   - **Fixtures/Tooling:** `Tooling ID`, `Description`, `Linked Asset`, `Qty`, `Max Dwell %`, `Cost £`.
   - **Skills/Roles:** `Role ID`, `Skill ID`, `Hourly Rate £/hr`.
   - **Import behaviour:** fuzzy column matching, reusable `.json` mapping profiles, and **Merge/Upsert** vs **Replace Unreferenced** modes.
   - **Master-data dropdowns** in the catalogue editors:

     | Catalogue | Control |
     |---|---|
     | Assets | *Factory*, *Cell ID / Shared WC* and *Complexity Class A–E* selects |
     | Fixtures | *Linked Asset* `<datalist>` |
     | Skills / Roles | *Skill ID* `<datalist>` |
     | Alias Dictionary | *Incoming Nickname* `<datalist>` filled with flagged unrecognised IDs |
3. **5-Level BOM ↔ Cell Passport Route Linker & Re-Ingestion**
   - **Ownership:** the hub owns the **5-Level BOM (`L1 → L5`)** and the **Master Schedule**.
   - **Mapping table:** a persistent **BOM ↔ Cell Route Mapping Table** (`BOM Part ID` → `Factory` + `Cell ID` + `Route/Variant ID`, optional dual-source `sharePct`).
   - **Matching:** automatic ID / name matching on first upload; saved mappings thereafter.
   - **Batch ingestion:** multi-file `.json` ingestion routes each cell's rolled-up metrics into its mapped `Factory → Cell → BOM` slot.
4. **Micro-to-Macro Roll-Up & Background Ingestion Audit**
   - **Macro-Block contents:** each route (up to 20 ops) folds into a **Cell Macro-Block** with:
     - `Rolled-Up Setup min`, `Rolled-Up Bottleneck Cycle min`
     - touch / walk-away minutes and `Total Route Lead Time` (Σ setup + batch × Σ (touch + walk-away))
     - `Effective Cell OEE %`
     - `Binding Capacity Cap [MIN of Machine, Competent Labour >= 2, Tooling Dwell]`
     - `Total Cell CapEx £`, `Total Cell Footprint m²` and `Cell Service Demands`
   - **Ingestion Audit:**
     - cells per factory; raw micro-ops vs Macro-Blocks, with a live per-factory **Micro-to-Macro compression ratio badge**
     - unmapped BOM nodes and unmapped cell routes
     - per-cell gate / constraint status
5. **Smart Legacy Workbook Importer**
   - An offline column-mapping wizard for legacy capacity / BOM Excel files.
   - Safe Dictionary defaults: `48` weeks/yr, `82%` labour availability, Complexity `90/80/70/60/50%`, Fixture flag `80%`.

## 3. Navigation (4 phases, 16 views; no sidebar)
- **Phase 1 · Control & Architecture:** Factory Control Hub, Interactive IDEF0 / Swimlane System Map, Logic & Data Integrity Check, Baseline Governance / Audit Log.
- **Phase 2 · Inputs & Master Data:** Fixed Process Baseline, Cell Passports, 5-Level BOM & Schedule, Assets & Workforce Skills (0–3, Alias Dictionary, Dictionary Defaults), Buffers & Stores.
- **Phase 3 · Design & Scenarios:** Cells & Macro-Routing Explorer, Factory Floor-Plan Layout, Facility & Cell Services, Static Scenario Planner.
- **Phase 4 · Validation & Outputs:** Siemens Tecnomatix Plant Simulation export / validation, Fixed Process ECR Release Pack, Cell Spec Sheets.
- **Header:**
  - **Global Quick-Find** (Cell IDs, BOM Part IDs, Assets, Shared Work Centres, Fixed Process Docs)
  - **Executive View / Full Engineering** toggle. Executive View shows the Control Hub, IDEF0 map, Scenario Planner and Phase 4 outputs. Jumping to an engineering-only view switches mode automatically.
  - **⬆ Smart Import** universal drop-zone, with detection confidence, reason and alternatives. Backups restore only after confirmation and a snapshot.
  - **Baseline version badge**
  - **🔗 Link Project File**
  - Backup / Restore / Snapshots / Reset
- **Dialogs and labels:**
  - No native `window.prompt()` / `window.alert()`: use inline inputs and non-blocking toasts.
  - Buttons name their phase, e.g. "→ Export to Siemens Plant Simulation (Phase 4)".

## 4. Phase 1 · Control & Architecture
1. **Model & FPD Readiness strip** (top of the Factory Control Hub)
   - **Contents:**
     - Active Factories count
     - Baseline Version & Sign-Off status
     - Storage Sync status
     - Logic Integrity score
     - a stacked RAG bar of Fixed Process Alignment (Aligned / Maturing Drift / Compliance Deviation / New Local Step), with the active locked FPD revisions
   - **Behaviour:** clicking any badge or segment jumps to that filtered view.
2. **Guided Next Actions strip**
   - **Drivers:** the Ingestion Audit, Fixed Process Drift and Logic Integrity engines.
   - **Items:**
     - unmapped BOM nodes, with 1-click **Auto-Match**
     - compliance deviations
     - gate-blocked cells and bottlenecks
     - Shared Work Centre queue risks
     - cells in inactive factories
     - double-owned assets
     - utility / space overruns and integrity errors
     - Needs Data Action cells
     - drifts awaiting justification and ECR-ready drifts
     - baseline sign-off
   - **Links:** jump buttons and deep links to sub-tabs.
3. **Factory Control Hub**
   - **Scope bar:** factory filter (active plants only) plus **Active / Inactive switches**.
   - **KPIs:**
     - Total CapEx (`£`)
     - Footprint (`m²`: `8 m²` fixed + `20%` variable cell uplift, `35%` circulation, plus stores)
     - Stores & WIP
     - Average Utilisation, OEE, TEEP, PCE (`VA / NVA / ENVA`)
     - Bottleneck / Blocked Cells
     - Material Handling h/yr
   - **"Where Parts Wait & Travel Most" strip** (also in Phase 3), three columns:
     - (a) Longest Process Dwell: top 3 cells / work centres by process + batch dwell hours, with WIP £
     - (b) Most Visited Cells & Work Centres: top 3 by batches per year, with pallets per year
     - (c) Longest Travel Corridors: top 3 by km per year
   - **Also on the page:** the Micro-vs-Macro Ingestion Audit, plus integrity and stores summaries.
4. **IDEF0 / Swimlane map**
   - **Inputs:** Fixed Process Docs, Cell Passports, BOM & Schedule, Assets/Skills, Stores.
   - **Controls:** Dictionary Defaults, Drift Tolerances, Baseline Gate.
   - **Swimlanes:** Engineering Authority; Cell & Asset Layer; Multi-Factory Network F1–F4; Decision & Siemens Plant Sim Proof.
   - **Outputs.**
   - **Behaviour:** a live status badge on every node, click-to-jump, a list view for accessibility, and the Architecture Rationale card.

## 5. Phase 2 · Inputs & Master Data
1. **Immutable Fixed Process Baseline & Live Drift Reconciliation**
   - **Locked reference layer:** `state.fixedProcess`, kept separate from Working Cell Routes and Scenarios.
   - **Import:** `.xlsx` / `.csv` / `.json` with Document ID, Revision, Effective Date, BOM Part ID, Op No, Op Description, Standard Setup/Cycle Min, Required Skill Level (0–3), Tooling/Fixture Spec, Mandatory Step.
   - **Seed documents:** `FPD-ATLAS/BOREAS/CIRRUS-001 Rev C`, with deliberate examples:

     | Class | Seeded example |
     |---|---|
     | ALIGNED | most steps |
     | MATURING DRIFT | CELL-A cycle; CELL-D skipped step; F2-C01 setup |
     | NEW LOCAL STEP | CELL-B |
     | COMPLIANCE DEVIATION | CELL-C missing mandatory MPI; F3-C07 Skill Level |

   - **Classification:** every working op, live or in a scenario, is classified using editable tolerances (cycle ±5%, setup ±10%, compliance ±25%).
   - **Drift view:** horizontal **variance bars** (working vs standard cycle / setup) and a **"Show only open / unapproved items"** toggle.
   - **Justifications:** drift justifications can be recorded inside scenarios and are carried over on promotion. The live locked layer stays authoritative.
   - **Revision Diff:** Rev N → Rev N+1 against both the locked baseline and the Working Factory Design, before locking (audited).
2. **Cell Passports & Alias Dictionary**
   - **Alias Dictionary:** a persistent `state.aliases` covering Cell, BOM Part / Variant, Master Asset and Master Tooling IDs.
   - **Near-duplicate detection:** case / punctuation differences, or ≤ 2 insertions / deletions / transpositions. Substitutions do not count, so sibling IDs stay distinct.
   - **Preview:** 0 mismatches means silent auto-ingest; otherwise **Map & Remember Alias** or *Keep as new*.
   - **Data quality:** a per-cell **Data Quality Score**, a **Needs Data Action** badge, and **⬇ Export Normalised Passport (.json)** (individually or in bulk).
3. **5-Level BOM & Master Schedule (`L1 → L5`)**
   - **Demand:** time-phased demand (`Q1–Q4` / annual + launch-rate overrides).
   - **Explosion:** net / gross explosion, cumulative scrap / yield, critical-path lead times, the shared `L5` roll-up and Cascade Bottlenecks.
   - **Route Linker:** included here.
4. **Assets & Workforce Skills**
   - **Catalogue manager** with the dropdowns above, and the `0–3` competence matrix (`>= 2` productive rule).
   - **Dictionary Defaults:**
     - relocation rigging % and recommissioning £; contribution margin; depreciation years
     - stores dictionary; drift tolerances; Plant Simulation shift starts / break
     - promotion governance gate
     - **Active Factory switches**
     - **editable F1–F4 inter-plant distances**
     - **material-flow assumptions**
     - **Shared Work Centre risk thresholds**
5. **Buffers, WIP & Stores**
   - **Four tiers:** Raw Material & Bought-Out Stores (L5), Kitting / Marshalling Zones (L2–L4), Inter-Cell WIP Buffers / Line-Side Supermarkets, Finished Goods & Despatch Staging (L1).
   - **WIP buffer sizing:** recommended buffer = batch + setup cover + z × CV(OEE) × demand rate × replenishment time.
   - **Outputs:** Days of Cover, locations / stillages, Stores Footprint (m²) and Working Capital Tied Up (£), using standard cost rolled up the BOM.

## 6. Phase 3 · Design & Scenarios
1. **Cells & Macro-Routing Explorer**
   - **Layout:** factory accordions with search / status filters, and Macro vs Micro route views.
   - **Constraint display:** binding constraint tags.
   - **Capacity comparison:** a **3-bar visual** (Machine Cap vs Competent Labour Skill ≥ 2 Cap vs Tooling Dwell Cap) against Required Demand.
   - **Verdict:** a **plain-English 1-line bottleneck verdict** on expanded cells.
   - **Shared Work Centre designation.**
   - **Solver:** the What-If Shift / CapEx solver.
2. **Shared Work Centre governance**
   - **Single ownership:** any Asset ID in more than one Cell Passport, or in both a passport and Shared Plant, is a Logic Integrity **error**, preventing double-counted CapEx, m² and utilities.
   - **Risk badge:** a Shared Work Centre serving **≥ 3 feeding cells**, or running **above 75% static utilisation**, gets an amber **"Queue Contention Risk — Verify in Plant Sim"** badge.
   - **Floor plan:** Shared Work Centres are draggable nodes on the floor-plan canvas, so Cell ↔ Shared Work Centre travel counts towards Spaghetti Intensity.
3. **Factory Floor-Plan Layout & Spaghetti Intensity**
   - **Plan image:** an optional 2D `.png` / `.jpg` / `.svg` plan per active factory, with **2-point metre scale calibration** and an auto-grid fallback.
   - **Blocks:** drag-and-drop scaled cell, Shared Work Centre and store footprint blocks.
   - **Flow overlay:** part-flow vectors derived from the 5-Level BOM and Cell Route mappings, drawn as weighted spaghetti lines.
   - **Metrics:**
     - **Intra-Factory Travel (km/yr)**
     - **Cross-Factory Transfers (units & pallets/yr)**
     - **Inter-Plant Distance (km/yr)**, using the editable F1–F4 distances
     - **Material Handling Hours/yr**
     - Spaghetti Intensity
   - **Surfaced in:** Scenario Comparison and the cause-effect diagnostics.
4. **Facility & Cell Services Specifier**
   - **Spec sheets:** a 1-click **Cell Facilities & CapEx Spec Sheet** (`.csv` / `.png` / `.json`).
   - **Services balance:** a **Factory-Level Services Balance** (cell demands + shared plant vs utility capacity per active factory, with Amber/Red flags).
5. **Static Scenario Planner & Cause-Effect Studio**
   - **Storage and promotion:** copy-on-write scenarios in the IndexedDB `scenarios` store (DB version 2). **Promote Scenario to Live Baseline** asks for confirmation and takes a snapshot first; the governance gate can require Reviewed / Approved status.
   - **Factory network:** **per-scenario Active Factory switches**.
   - **Cell vs Cells:** move / clone (with % dual-source) / merge / decommission. Space table: Cells + Circulation m², Stores & Buffers m², Total m² vs `floorAreaM2`. Relocation vs Replication CapEx (£).
   - **Asset vs Asset Load:** reassignment, Asset Load Heatmap (Q1–Q4 + annual; Baseline / Scenario / Δ) and the Binding Cap re-check.
   - **Route vs Route:** micro-op edits, op split across 2 machines, setup / cycle / batch / tooling, Macro-Block override (incl. Effective OEE %), quick Shift Pattern (1/2/3 shifts with crew), dual-source splits and Make-vs-Buy.
   - **Stress-test presets:**
     - SMED −50% setup / batch halving
     - 2→3 shifts / overtime / key Level-3 operator absence
     - +20% / +35% Programme surge; Q4→Q2 launch pull-forward
     - "Bad Week" (−8% OEE / +3% scrap)
     - Make-vs-Buy offload
   - **Comparison matrix:**
     - throughput, utilisation, bottlenecks, peak-quarter overloads
     - CapEx, incremental investment, unit conversion cost, payback
     - footprint, stores, working capital
     - FPD alignment
     - utility / space overruns
     - **intra-factory travel, cross-factory transfers, inter-plant distance, material handling, Shared Work Centre risks**
     - OEE, TEEP, PCE
   - **"Key Effects & Possible Causes":**
     - binding-constraint shifts and L2–L5 ripple; schedule changes; gates
     - utility / space triggers; cost
     - Stores, Process, **Flow** and **Factories** chains
   - **Exports:** `.csv` / `.json` / print-friendly HTML; send any scenario to Phase 4.

## 7. Phase 4 · Validation & Outputs
1. **Siemens Tecnomatix Plant Simulation preset**
   - **Export:** a 1-click export from the Live Baseline or any scenario, as `.xlsx` / `.csv` / `.json`, containing:
     - `Routing_DataTable`, outputting **both** `Bottleneck_Cycle_Min` (steady-state rate) **and** `Total_Route_LeadTime_Min` (Touch + Walk-Away batch transit delay)
     - `ProductionPlan_DataTable`
     - `ShiftCalendar_DataTable`
     - `Buffer_DataTable` (`Buffer_ID`, `Station_Path`, `Capacity_Units`, `Initial_WIP`, `Dwell_Time_Sec`)
   - **Statistics import:** `StatWorkingTime`, `StatBlockingTime`, `StatWaitingTime`, `StatThroughput` → `AGREE` / `DISAGREE`, plus buffer starvation / blocking causes.
2. **Generic DES export & validation:** flat routing / schedule tables (`CSV` / `JSON`) and DES result re-import with buffer queue monitoring.
3. **Fixed Process ECR Release Pack:** `.xlsx` (5 sheets) / `.csv` / a print-ready sign-off pack of approved drifts; can be issued and locked as the next revision.
4. **Cell Spec Sheets.**

## 8. Governance, Integrity & Active Factory Switch
- **Logic & Data Integrity Check (36 checks):**
  - BOM Nodes ↔ Cell Routes ↔ Micro/Macro Ops ↔ Buffers/Stores ↔ Facility Services ↔ Fixed Process
  - asset single ownership
  - cells / mappings in inactive factories
  - unknown Shared Work Centres
- **Baseline Change Governance:**
  - a version badge (`vMAJOR.MINOR`)
  - sign-off status (`Draft` / `Reviewed` / `Approved Baseline`) for the baseline and each scenario
  - a structured **Audit Log** of promotions, re-ingestions, imports, sign-offs, restores and resets
- **Active Factory Switch (2–4 plants):**
  - **Effect:** inactive factories are excluded from KPIs, footprint m², shared-plant CapEx, utility balances, stores roll-ups, material-flow totals and filter pills.
  - **Minimum:** at least 2 plants stay active.
  - **Flags:** cells and mappings still assigned to inactive factories are flagged in Logic Integrity and Guided Next Actions.

## 9. Data Safety & Offline Single-File Build
- **Persistence:** state, 5 rolling auto-snapshots, scenarios, the governance audit log, the Alias Dictionary, Shared Work Centres and floor-plan layouts persist in `IndexedDB` (`multi-factory-hub-v1`, schema v2), with a `localStorage` fallback and 1-click `.json` full-plant backup / restore.
- **Direct Local File Auto-Save:**
  - **Link Project File** uses `showSaveFilePicker` / `showOpenFilePicker` for a debounced disk auto-save.
  - Clear status: "Linked: filename.json · saved HH:MM:SS" vs "Browser storage only".
  - A `lastModified` conflict check pauses auto-save until the user overwrites or reloads.
  - Graceful fallback to IndexedDB + Backup/Restore when the API is blocked, e.g. by a corporate `file://` policy.
- **Uploads:** malformed or empty uploads show friendly inline messages, never uncaught exceptions.
- **Repository contents:** `README.md`, JSDoc on core calculation functions, and `.github/workflows/ci.yml`.
- **Offline build:**
  - Bundle everything locally with zero external CDNs or network calls: `npm run build:offline` → `dist-offline/index.html`.
  - Force-add `dist-offline/index.html` to Git.
