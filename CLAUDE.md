# Project: Multi-Factory Master Capacity, Services & Simulation Hub (MVP)

## 1. Core Objective
Build an offline-first React + TypeScript + Vite + Tailwind CSS web application (**Multi-Factory Master Control Hub**) that orchestrates **40–50+ Cell Design Passports** (`10–12+ cells per factory` across **`F1`, `F2`, `F3`, `F4`**). Use **British English** throughout (`utilisation`, `despatch`, `analyse`, `programme`, `centre`, `£`) and zero retail terminology (`Variant` / `Programme` / `Assembly` only).

## 2. Three-Tier Digital Thread & BOM-to-Route Mapping Architecture
1. **Master Data Catalogues (`.xlsx` / `.csv` / `.json` Importer via bundled SheetJS):**
   - Ingest standardized offline master lists for **Assets** (`Asset ID`, `Description`, `Factory`, `Cell ID`, `Category`, `Complexity Class`, `Shift Tier`, `Footprint m²`, `OEE %`, `CapEx Cost £`, `Install Cost £`, `Electrical kW`, `Compressed Air L/min`, `Extraction m³/hr`, `Crane Tonnes`, `Coolant/Water`), **Fixtures/Tooling** (`Tooling ID`, `Description`, `Linked Asset`, `Qty`, `Max Dwell %`, `Cost £`), and **Skills/Roles** (`Role ID`, `Skill ID`, `Hourly Rate £/hr`).
   - Support fuzzy column matching, reusable `.json` mapping profiles, and safe **Merge/Upsert** vs **Replace Unreferenced** modes.
2. **5-Level BOM ↔ Cell Passport Route Linker & Re-Ingestion Engine:**
   - Because individual Cell Passports hold **Product Family Routes** rather than a multi-level BOM, the Master Hub owns the **5-Level BOM (`L1 → L5`)** and **Master Schedule**.
   - Provide a persistent **BOM ↔ Cell Route Mapping Table** (`BOM Part ID` → `Factory F1–F4` + `Cell ID` + `Passport Route/Variant ID`) with automatic ID/name matching on first upload and saved mappings thereafter.
   - Support **batch multi-file `.json` ingestion** (`40–50+ Cell Passports`): whenever updated Cell Passports are dropped in, the engine automatically routes each cell's rolled-up metrics into its mapped `Factory → Cell → BOM` slot without manual re-entry.
3. **Micro-to-Macro Roll-Up & Background Ingestion Audit:**
   - **Macro-Route Fold-Up:** Fold each cell's detailed micro-route (up to 20 ops per route) into a clean simulation-ready **Cell Macro-Block** (`Rolled-Up Setup min`, `Rolled-Up Bottleneck Cycle min`, `Effective Cell OEE %`, `Binding Capacity Cap [MIN of Machine, Competent Labour >= 2, Tooling Dwell]`, `Total Cell CapEx £`, `Total Cell Footprint m²`, and `Cell Service Demands`).
   - **Background Ingestion Audit Panel:** Live reconciliation showing `Total Cells Ingested (per Factory)`, `Raw Micro-Ops Ingested` vs `Rolled-Up Macro-Blocks`, `Unmapped BOM Nodes` (BOM parts missing a Cell Route link), `Unmapped Cell Routes` (orphan passport routes with zero BOM demand), and per-cell Gate/Constraint status.
4. **Smart Legacy Workbook Importer:**
   - Offline column-mapping wizard for legacy capacity/BOM Excel files with safe Dictionary defaults (`48` weeks/yr, `82%` labour availability, Complexity `90/80/70/60/50%`, Fixture flag `80%`).

## 3. Core Functional Workspaces (7 Focused Views — organised under the 4 phases in §5)
1. **Factory Control Hub (Executive Dashboard):**
   - Factory filter (`All Plants` / `F1` / `F2` / `F3` / `F4`), Total CapEx (`£`), Footprint (`m²` including `8 m²` fixed + `20%` variable cell uplift & `35%` factory circulation), Average Utilisation, OEE, TEEP, PCE (`VA / NVA / ENVA`), Bottleneck/Blocked Cells, and the **Micro-vs-Macro Ingestion Audit**.
2. **5-Level BOM & Master Schedule (`L1 → L5`):**
   - Full **5-Level BOM** (`L1 Top Assembly` → `L2` → `L3` → `L4` → `L5 Raw Material & Bought-Out`) linked directly to time-phased **Master Schedule** demand (`Q1–Q4` / annual volume + launch-rate overrides) and the **BOM ↔ Cell Route Linker**.
   - Explodes net/gross demand, cumulative scrap/yield, and critical-path lead times across all 5 tiers, rolling up shared `L5` raw materials and highlighting Cascade Bottlenecks.
3. **Ingested Cells & Macro-Routing Explorer (40–50+ Cells):**
   - Collapsible **Factory Accordions (`F1`–`F4`, `10–12+ cells` each)** with search/status filters (`All / Bottleneck / Gate Blocked / Over-Utility`), toggleable **Macro-Route View (Rolled-Up)** vs. **Micro-Route Drill-Down**, binding constraint tags (`Machine` / `Labour` / `Tooling`), and live What-If Shift/CapEx solver.
4. **Facility & Cell Services Specifier (`kW`, `Air`, `Extraction`, `Cranes`, `CapEx`):**
   - **Cell-Level Service Spec Output:** Select any cell to generate and export a 1-click **Cell Facilities & CapEx Spec Sheet (`.csv` / `.png` / `.json`)** summing electrical load (`kW`), compressed air, extraction, crane rating, footprint, and asset/tooling CapEx.
   - **Factory-Level Services Balance:** Rolls up all cell service demands plus **Factory-Level Shared Plant** (central compressors, chillers, substations, overhead cranes) against available utility capacity per factory (`F1–F4`), flagging utility overloads in Amber/Red.
5. **Master Data & Workforce Matrix:**
   - Central catalogue manager for Master Assets (with CapEx & utility loads), Master Fixtures, and cross-factory Skills/Roles (`0–3` competence scale, `>= 2` productive rule).
6. **Plant Simulation / DES Export & Validation:**
   - Exports a clean, flat **Plant Simulation / DES Routing & Schedule Table (`CSV` / `JSON`)** using the folded **Macro-Operations** (collapsing thousands of micro-steps into clean simulation blocks), plus DES result re-import (`AGREE` vs. `DISAGREE` flags and buffer queue monitoring).

7. **Static Scenario Planner & Cause-Effect Studio (V1.1):**
   - **Non-destructive scenario engine (copy-on-write):** clone the Live Baseline (or any scenario) into named scenarios (Baseline vs Scenario A/B/C…) stored in the IndexedDB `scenarios` store (DB version 2). Live ingested Cell Passports are never mutated; **Promote Scenario to Live Baseline** asks for confirmation and takes an automatic IndexedDB snapshot first.
   - **Cell vs. Cells (Topology & Layout):** move, clone (replicate with % dual-source), merge or decommission cells across `F1–F4`; footprint (`8 m²` fixed + `20%` + `35%` circulation) vs per-factory floor-area ceilings, utility demand vs plant ceilings, and **Relocation vs Replication CapEx (£)**.
   - **Asset vs. Asset Load:** reassign machines between cells (same-category units join as parallel machines; ops left without their machine are starved), **Asset Load Heatmap** (% of available shift hours, Q1–Q4 + annual, Baseline / Scenario / Δ) and Binding Capacity Cap re-check.
   - **Route vs. Route:** edit micro-ops, split a bottleneck op across 2 machines, trim setup/cycle, batch size, tooling dwell/sets, override folded Macro-Blocks directly (micro-ops re-scaled so the re-fold matches), alternate BOM ↔ Cell Route assignments with **% dual-source splits** and Make-vs-Buy subcontracting.
   - **One-click stress-test presets:** SMED −50% setup / batch halving; 2→3 shifts, overtime, key Level-3 operator absence (Skill ≥ 2 rule); +20% / +35% Programme surge, Q4→Q2 launch pull-forward; "Bad Week" −8% OEE / +3% scrap; Make-vs-Buy subcontract offload (CapEx avoided vs piece-part £).
   - **Side-by-side comparison matrix** (Throughput, Utilisation %, Bottleneck count, Peak-quarter overloads, CapEx £, Incremental investment, Unit Conversion Cost £, Payback years, Footprint m², Utility & space overruns, OEE, TEEP, PCE) with delta badges, plus the automated **"Key Effects & Possible Causes"** diagnostic chain (binding-constraint shifts, L2–L5 scrap/material ripple, schedule changes, F1–F4 utility/space threshold triggers, gate changes, cost drivers).
   - Export the comparison report (`.csv` / `.json` / print-friendly HTML) and send any scenario straight into Workspace 6 (DES Export) via its source selector.

## 4. V1.2 Extensions: Buffers, WIP & Stores · Tecnomatix Preset · Governance
1. **Buffers, WIP & Stores Engine** (linked to BOM, Cells, Footprint & Scenarios):
   - 4 storage tiers across `F1–F4`: **Raw Material & Bought-Out Stores (L5)**, **Kitting/Marshalling Zones (L2–L4)**, **Inter-Cell WIP Buffers / Line-Side Supermarkets**, **Finished Goods & Despatch Staging (L1)**.
   - Recommended inter-cell WIP buffer = batch + setup cover + OEE-variability safety (z × CV(OEE) × demand rate × replenishment time); plus **Days of Cover**, storage locations/stillages, **Stores Footprint (m²)** and **Working Capital Tied Up (£)** (standard cost rolled up the BOM: L5 unit cost + route work content × conversion £/min).
   - Rolled into Workspace 1 (Stores & WIP tile, footprint incl. stores), Workspace 4 (Buffers, WIP & Stores panel; space = cells + circulation + stores vs floor ceiling) and Workspace 7 (matrix rows + `Stores` cause-effect chain).
2. **Siemens Tecnomatix Plant Simulation preset (Workspace 6):** 1-click `Routing_DataTable`, `ProductionPlan_DataTable`, `ShiftCalendar_DataTable`, `Buffer_DataTable` (`Buffer_ID`, `Station_Path`, `Capacity_Units`, `Initial_WIP`, `Dwell_Time_Sec`) as `.xlsx` / `.csv` / `.json` from the Live Baseline or any Workspace 7 scenario; import Station/Buffer/Drain statistics (`StatWorkingTime`, `StatBlockingTime`, `StatWaitingTime`, `StatThroughput`) → `AGREE` / `DISAGREE` plus buffer starvation / blocking causes.
3. **Logic Integrity, Governance & Editable Dictionary:**
   - Relocation rigging % and per-cell recommissioning £ editable in Master Data → Dictionary Defaults (with contribution margin, depreciation years and the stores dictionary).
   - Live **Logic & Data Integrity Check**: BOM Nodes ↔ Cell Routes ↔ Micro/Macro Ops ↔ Buffers/Stores ↔ Facility Services (orphaned IDs, unmapped nodes, circular BOM links, missing skill/utility links).
   - **Baseline Change Governance:** version badge (`vMAJOR.MINOR`), sign-off status (`Draft` / `Reviewed` / `Approved Baseline`) for the baseline and each scenario, and a structured **Audit Log** of baseline promotions, Cell Passport re-ingestions, Master Data / legacy imports, sign-offs, restores and resets.

## 5. V1.3 Extensions: Fixed Process Governance · IDEF0 System Map · 4-Phase Navigation
1. **Simplified 4-Phase Top Navigation** (no sidebar; phase tabs + view pills):
   - **Phase 1 · Control & Architecture:** Factory Control Hub, Interactive IDEF0 / Swimlane System Map, Logic & Data Integrity Check, Baseline Governance / Audit Log.
   - **Phase 2 · Inputs & Master Data:** Fixed Process Baseline, Cell Passports, 5-Level BOM & Schedule, Assets & Workforce Skills (0–3, Dictionary), Buffers & Stores.
   - **Phase 3 · Design & Scenarios:** Cells & Macro-Routing Explorer, Facility & Cell Services, Static Scenario Planner.
   - **Phase 4 · Validation & Outputs:** Siemens Tecnomatix Plant Simulation export/validation, Fixed Process ECR Release Pack, Cell Spec Sheets.
   - **IDEF0 / Swimlane map:** Inputs (Fixed Process Docs, Cell Passports, BOM & Schedule, Assets/Skills, Stores), Controls (Dictionary Defaults, Drift Tolerances, Baseline Gate), 4 swimlanes (Engineering Authority, Cell & Asset Layer, Multi-Factory Network F1–F4, Decision & Siemens Plant Sim Proof) and Outputs — live status badge on every node, click-to-jump, list view for accessibility.
2. **Immutable Fixed Process Baseline & Live Drift Reconciliation:**
   - Locked reference layer (`state.fixedProcess`) separate from Working Cell Routes and Scenarios; `.xlsx` / `.csv` / `.json` import with Document ID, Revision (e.g. `Rev C`), Effective Date, BOM Part ID, Op No, Op Description, Standard Setup/Cycle Min, Required Skill Level (0–3), Tooling/Fixture Spec, Mandatory Step.
   - Seeded `FPD-ATLAS/BOREAS/CIRRUS-001 Rev C` covering every mapped Make part, with deliberate ALIGNED, MATURING DRIFT (CELL-A cycle, CELL-D skipped step, F2-C01 setup), NEW LOCAL STEP (CELL-B) and COMPLIANCE DEVIATION (CELL-C missing mandatory MPI, F3-C07 Skill Level) examples.
   - Every working op (live or scenario) classified ALIGNED / MATURING DRIFT / COMPLIANCE DEVIATION / NEW LOCAL STEP using editable drift tolerances (cycle ±5%, setup ±10%, compliance ±25%); Plant Simulation shift starts / break are editable Dictionary defaults.
3. **Revision Diff & ECR Release Pack:**
   - Compare / Ingest Updated Fixed Process Revision diffs Rev N → Rev N+1 against the locked baseline and the Working Factory Design (deviations falling back into alignment, newly deviating ops, impacted cells) before locking (audited `Fixed Process revision`).
   - 1-click New Fixed Process Release / ECR Pack (`.xlsx` 5 sheets / `.csv` / print-ready sign-off pack) of approved, justified drifts with cycle/setup deltas, proposed Rev N+1 steps and working macro-blocks; can be issued & locked as the next revision.

## 6. V1.4: UX Simplification, Guided Action Strip & Logic-Link Tightening
1. **Universal Smart File Drop-Zone** (header **⬆ Smart Import**): drop any `.json` / `.xlsx` / `.csv`; the hub detects Cell Design Passports, Fixed Process Baseline / Revision, Master Assets / Fixtures / Skills, Legacy Capacity/BOM Workbook, Siemens Plant Simulation Statistics, DES results or a Full-Plant Backup (with confidence, reason and alternatives) and jumps into the matching import / diff preview with the file pre-loaded (backups restore after confirmation and snapshot).
2. **Guided Next Actions strip** at the top of Phase 1 (Factory Control Hub), driven by the Ingestion Audit, Fixed Process Drift and Logic Integrity engines (unmapped BOM nodes with 1-click **Auto-Match**, compliance deviations, gate-blocked cells, bottlenecks, utility / space overruns, integrity errors, drifts awaiting justification, ECR-ready drifts, baseline sign-off) with jump buttons.
   - **Executive View / Full Engineering** toggle in the top bar: Executive View shows Factory Control Hub, IDEF0 / Swimlane Map, Static Scenario Planner and Validation / ECR outputs; Full Engineering shows all 15 views. Jumping to an engineering-only view switches mode automatically.
3. **Logic-link & governance tightening:**
   - Workspace 7 (Cell vs Cells) factory space table shows Cells + Circulation m², Stores & Buffers m² and Total m² against each factory's `floorAreaM2` — the same basis as Workspace 1 and Buffers & Stores.
   - Route vs Route Macro-Block editor: optional **Effective OEE %** override and quick **Shift Pattern** (1/2/3 shifts, matching crew recruited/released).
   - Dictionary Defaults governance toggle: **Require Reviewed/Approved status before promoting Scenario to Live Baseline** (enforced in the UI and in the promotion itself).

## 7. V1.5: Alias Dictionary, "Needs Data Action" Passport Feedback Loop & Edge-to-Edge Polish
1. **Persistent Alias Dictionary** (`state.aliases`, Phase 2 → Assets & Workforce Skills → Alias Dictionary, included in Full-Plant JSON backups) mapping incoming nicknames to canonical IDs across 4 domains: Cell IDs (e.g. `Cell_A` → `CELL-A`), BOM Part / Variant IDs, Master Asset IDs and Master Tooling / Fixture IDs.
   - Cell Passport ingestion & Smart Import resolve aliases and detect near-duplicate typos (case/punctuation-only differences, or ≤ 2 insertions / deletions / transpositions — not substitutions, so sibling IDs such as CELL-A / CELL-B stay distinct). **0 mismatches → silent auto-ingest**; otherwise the preview offers **Map & Remember Alias** (or Keep as new) per unrecognised ID / typo.
   - Per-cell **Data Quality Score (%)** with a plain-English source punch-list; cells relying on aliases, fuzzy matches or missing catalogue / service fields get a **Needs Data Action** badge (Phase 1 Guided Next Actions, Phase 2 Cell Passports, Phase 3 Cells & Macro-Routing).
   - 1-click **⬇ Export Normalised Passport (.json)** per cell and bulk export of all flagged cells — canonical IDs applied plus a `normalisation` block (aliases replaced, open punch-list) for the cell owner to load back into the Cell Design Passport app.
2. **Edge-to-edge polish:** 4-phase button labels ("→ Export to Siemens Plant Simulation (Phase 4)", "Choose a scenario in Static Scenario Planner (Phase 3) →"); no native `window.prompt()` / `window.alert()` (inline inputs + non-blocking toast banners); Guided Next Actions deep-link sub-tabs (Dictionary Defaults, Catalogue Importer, Alias Dictionary, Live Drift); Fixed Process drift justifications can be recorded inside Scenarios and are carried over on promotion (the live locked layer stays authoritative).

## 8. Data Safety & Offline Single-File Build
- Persist state + rolling 5 auto-snapshots + Workspace 7 scenarios + governance audit log + Alias Dictionary in `IndexedDB` (`multi-factory-hub-v1`, schema v2) with `localStorage` fallback and 1-click `.json` full-plant backup/restore.
- Include `README.md`, JSDoc comments on core calculation functions, and `.github/workflows/ci.yml`.
- Bundle everything locally with zero external CDNs (`npm run build:offline` → `dist-offline/index.html`) and force-add `dist-offline/index.html` to Git.
