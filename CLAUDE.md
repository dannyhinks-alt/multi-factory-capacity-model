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

## 3. Core Functional Workspaces (7 Focused Views)
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

## 4. Data Safety & Offline Single-File Build
- Persist state + rolling 5 auto-snapshots + Workspace 7 scenarios in `IndexedDB` (`multi-factory-hub-v1`, schema v2) with `localStorage` fallback and 1-click `.json` full-plant backup/restore.
- Include `README.md`, JSDoc comments on core calculation functions, and `.github/workflows/ci.yml`.
- Bundle everything locally with zero external CDNs (`npm run build:offline` → `dist-offline/index.html`) and force-add `dist-offline/index.html` to Git.
