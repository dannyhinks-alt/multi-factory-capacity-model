# Multi-Factory Master Control Hub v1.0

*Multi-Factory Master Capacity, Services & Simulation Hub — release 1.0.0.*

An offline-first **React + TypeScript + Vite + Tailwind CSS** application, the **Multi-Factory Master Control Hub**. It brings together 40–50+ **Cell Design Passports** across factories **F1–F4**, and owns the **5-Level BOM**, the **Master Schedule** and the **BOM ↔ Cell Route** mapping. From these it rolls every cell's micro-routes up into simulation-ready **Cell Macro-Blocks**.

The whole application builds to a single self-contained file, `dist-offline/index.html`. It has no CDNs and makes no network calls, so you can open it straight from disk.

---

## Quick start

```bash
npm ci
npm run dev             # http://localhost:5173
npm test                # 192 unit tests (Vitest)
npm run build:offline   # → dist-offline/index.html (single file, zero external CDNs)
npm run samples         # regenerate example input files under samples/
```

Open `dist-offline/index.html` in any modern browser. The hub starts with a realistic baseline (described below), so every workspace, chart and export works straight away.

## Navigation: four lifecycle phases

There is no sidebar any more. The top bar shows four phase tabs, and each phase has its own row of view pills:

| Phase | Views |
|---|---|
| **1 · Control & Architecture** | Factory Control Hub · **IDEF0 / Swimlane System Map** · Logic & Data Integrity · Baseline Governance |
| **2 · Inputs & Master Data** | **Fixed Process Baseline** · Cell Passports · 5-Level BOM & Schedule · Assets & Workforce Skills (incl. Dictionary Defaults) · Buffers & Stores |
| **3 · Design & Scenarios** | Cells & Macro-Routing · Facility & Cell Services · Static Scenario Planner |
| **4 · Validation & Outputs** | Siemens Plant Simulation (Tecnomatix) · **Fixed Process ECR Pack** · Spec Sheets |

The workspaces described below sit within these phases.

**Executive View / Full Engineering.**
- **Toggle:** a top-bar toggle switches between the two modes, and the choice is remembered.
- **Executive View:** shows only Factory Control Hub, IDEF0 / Swimlane Map, Static Scenario Planner, Siemens Plant Simulation, Fixed Process ECR Pack and Spec Sheets. Phase 2 is hidden.
- **Full Engineering:** shows all 15 views.
- **Switching:** jumping to an engineering-only view, for example from a Next Action, switches to Full Engineering automatically.

**⬆ Smart Import.** The header button opens a universal drop-zone. Drop any `.json`, `.xlsx` or `.csv` and `src/engine/smartimport.ts` detects what it is, shows a confidence, the reason and any alternatives, then opens the matching preview with the file already loaded:

| Detected | Opens |
|---|---|
| Cell Design Passports (single, array or bundle) | Cell Passports: ingestion preview showing add / update / skip-older-revision |
| Fixed Process Baseline / Revision | Fixed Process Baseline → Compare / Ingest revision diff |
| Master Assets / Fixtures / Skills | Catalogue Importer, with the target, worksheet and fuzzy mapping preset. A multi-sheet workbook offers the other sheets as alternatives |
| Legacy Capacity / BOM Workbook | Smart Legacy Workbook Importer |
| Siemens Plant Simulation Statistics | Tecnomatix preset → statistics validation |
| DES results | Generic DES validation |
| Full-Plant Backup | Restore, after confirmation and an automatic snapshot |

**Guided Next Actions.** A compact strip at the top of the Factory Control Hub ranks the most important actions (`src/engine/nextactions.ts`). It draws on the Ingestion Audit, Fixed Process Drift and Logic Integrity engines, plus capacity, utility and space checks:
- **Critical:** unmapped BOM nodes, compliance deviations, gate-blocked cells.
- **Warning:** bottlenecks, Red utilities, factories over their floor ceiling, integrity errors.
- **Information:** drifts awaiting justification, ECR-ready drifts, baseline sign-off.

Each action has an *Open →* jump. Unmapped BOM nodes also get **⚡ Auto-Match**:
- **ID matches first:** exact ID matches are always accepted.
- **Then name similarity:** the best name-similarity suggestion is accepted at 50% or more, but never a route that already serves another BOM part.

The baseline includes a newly ingested `F4-C08 / RT-CIR-200-IS` route whose BOM link has not been run yet, so Auto-Match has a real case to fix. `BOR-MM-W-02` still needs manual mapping.

## The seven workspaces

| # | Workspace | Highlights |
|---|-----------|-----------|
| 1 | **Factory Control Hub** | `All Plants / F1–F4` filter. Shows Total CapEx £ (cells plus shared plant) and Footprint m² (8 m² fixed + 20% variable cell uplift, then 35% circulation). Also covers average utilisation, OEE, TEEP and PCE (VA / NVA / ENVA), **Stores & WIP working capital** and footprint including stores, a cell utilisation chart, the bottleneck, blocked and over-utility list, factory services RAG and the **Micro-vs-Macro Ingestion Audit**, plus compact **Logic & Data Integrity** and **Buffers, WIP & Stores** summaries. |
| 2 | **5-Level BOM & Master Schedule** | Master Schedule editor (annual volume, Q1–Q4 split %, launch-rate overrides). Indented L1 → L5 tree with level pills, Programme filter, net/gross, quarterly gross, cumulative yield, critical-path lead time and **Cascade Bottleneck** flags. Also holds the **BOM ↔ Cell Route Linker** (auto-match, suggestions, manual override, stale detection) and the shared L5 raw material roll-up. |
| 3 | **Ingested Cells & Macro-Routing Explorer** | Collapsible F1–F4 accordions, search, and status filters (`All / Bottleneck / Gate Blocked / Over-Utility`). Toggles between **Macro-Route View** and **Micro-Route Drill-Down**. Shows Machine / Labour / Tooling constraint tags and resource utilisation. Includes the **What-If Shift/CapEx solver**, which can apply its result to the passport as a new revision. |
| 4 | **Facility & Cell Services Specifier** | 1-click **Cell Facilities & CapEx Spec Sheet** (`.csv` / `.png` / `.json`) covering kW, compressed air, extraction, crane tonnes, coolant/water, footprint and CapEx. Also a **factory-level services balance** (cell demand + shared plant vs installed capacity, RAG) with editable capacities and shared plant. The spec sheet sits under *Phase 4 · Spec Sheets*, and the **Buffers, WIP & Stores** panel (four tiers, every WIP buffer, space against each floor ceiling) under *Phase 2 · Buffers & Stores*. |
| 5 | **Master Data & Workforce Matrix** | Batch multi-file **Cell Passport** drop-zone with a re-ingestion demo. Editable Asset, Fixture and Skill/Role catalogues, and the **0–3 competence matrix**. A SheetJS **Catalogue Importer** (fuzzy column matching, `.json` mapping profiles, *Merge/Upsert* vs *Replace Unreferenced*). The **Smart Legacy Workbook Importer**, and the Dictionary defaults (including relocation and stores settings). It also holds the **Logic & Data Integrity** check and the **Baseline Governance & Audit Log**. |
| 6 | **Plant Simulation / DES Export & Validation** | Flat **DES Routing & Schedule tables** (CSV / JSON / bundle) built from folded Macro-Operations. A source selector exports either the Live Baseline or any Workspace 7 scenario. DES result re-import with **AGREE / DISAGREE** flags and buffer-queue monitoring. Includes a **Siemens Tecnomatix Plant Simulation** preset (see *Buffers, WIP & Stores · Tecnomatix preset · Governance* below). |
| 7 | **Static Scenario Planner & Cause-Effect Studio** | Copy-on-write scenarios (Baseline vs Scenario A/B/C…), three structural comparison modes (Cell vs Cells, Asset vs Asset Load, Route vs Route), one-click stress-test presets, a side-by-side comparison matrix with delta badges, the **Key Effects & Possible Causes** diagnostic chain, report export (.csv / .json / print) and **Promote Scenario to Live Baseline**. See below. |

## Three-tier digital thread

1. **Master Data Catalogues.** Assets (CapEx, install, OEE, kW, air, extraction, crane, coolant), Fixtures/Tooling (qty, max dwell %) and Skills/Roles (£/hr). These import from `.xlsx` / `.csv` / `.json` through the locally bundled SheetJS.
2. **5-Level BOM ↔ Cell Passport Route Linker.** The hub owns the BOM and the Master Schedule. Each Make part maps to `Factory + Cell + Route/Variant`:
   - **Auto-match.** On first upload, parts are matched by ID: an exact Variant ID match scores 1.0, a Route ID match 0.95, and auto-match needs at least 0.8. Name-similarity matches appear as suggestions only.
   - **Saved mappings.** Once saved, a mapping is never overwritten.
   - **Re-ingestion.** When passports are dropped in again, mappings refresh their factory. A mapping follows its Variant ID if it moves to another cell, and is reported *stale* if the route disappears.
3. **Micro-to-Macro Roll-Up & Audit.** Each route (up to 20 ops) folds into a macro-block, and each cell into a Cell Macro-Block. The Background Audit reconciles cells per factory, micro-ops vs macro-blocks, unmapped BOM nodes, orphan cell routes, stale mappings and gate status.

## Workspace 7: Static Scenario Planner & Cause-Effect Studio

**Isolation.**
- **Copy-on-write:** each scenario stores its own deep copy of the hub state, in the IndexedDB `scenarios` store (database `multi-factory-hub-v1`, schema version 2). Every edit clones the scenario's state before changing it.
- **Live is never touched:** the Live Baseline and its ingested Cell Passports never change until you press **Promote Scenario to Live Baseline**.
- **Promote:** asks for confirmation, saves an automatic IndexedDB snapshot of the current live state (restore it from ⟲ Snapshots), then replaces live with the scenario.
- **Clones and change log:** any scenario can be cloned, and each one keeps a change log.

**Cell vs Cells (topology & layout).**
- **Move:** relocates a cell. Relocation CapEx = Σ qty × (re-install £ + 5% rigging of CapEx) + £15k recommissioning.
- **Clone:** replicates a cell with new asset and tooling IDs and dual-sources a chosen share of its demand to the replica. Replication CapEx = new assets + install + tooling.
- **Merge:** moves routes, machines, crew and mappings into another cell. Relocation is charged at 50% within the same factory.
- **Decommission:** removes a cell. Its routes and demand can optionally transfer to another cell; otherwise its parts become unmapped.
- **Recalculation:** each factory's footprint (×1.20 + 8 m², then ×1.35) is compared against its floor-area ceiling. Utilities (kW, air, extraction, crane, coolant) are compared against the F1–F4 plant ceilings.

**Asset vs Asset load.**
- **Reassigning machines:** machine units can move between cells. Units of a category the receiving cell already has join that group as parallel machines; otherwise they form a new group.
- **Starvation:** ops that lose their machine get **zero capacity** (starved), so the cell's Binding Capacity Cap drops to 0.
- **Heatmap:** shows each machine group's quarterly and annual load as a % of available shift hours × OEE, with Baseline, Scenario and Δ views.
- **Affected cells:** a table re-checks MIN(Machine, Competent Labour ≥ 2, Tooling Dwell) for every cell whose cap, binding constraint or utilisation moved.

**Route vs Route.**
- **Micro-op edits:** setup, cycle, labour and asset can be edited per op. **Split op** shares a bottleneck op across two machines; each machine carries its own setup.
- **Batch and tooling:** batch size and tooling dwell / fixture sets can be changed per route.
- **Macro-Block override:** you can override the folded Macro-Block directly (setup, bottleneck cycle, batch). The micro-ops are re-scaled so that the instant re-fold reproduces the override.
- **Dual-source splits:** alternate BOM ↔ Cell Route assignments carry a `sharePct`, so a part's demand can be split by percentage across routes.
- **Make vs Buy:** subcontracting takes the bought-in share out of cell demand and costs it at the piece-part price.

**Stress-test presets.** Each preset can be applied to the active scenario or create a new one. Cell presets can be scoped to all cells, bottleneck & near-limit cells, or one factory.
- **SMED and batch:** SMED −50% setup; batch size halving.
- **Shifts and skills:** 2 → 3 shifts, with a matching shift crew recruited; +X% overtime at a 50% premium; key Level-3 operator absence, which tests the Skill ≥ 2 rule.
- **Programme surge and launch ramp:** +20% / +35% Programme surge; Q4 → Q2 launch pull-forward (annual volume unchanged, Q2 peak doubled).
- **"Bad Week":** −8 OEE points on every asset and +3 scrap points on every Make line.
- **Make-vs-Buy offload:** subcontracts just enough of the worst bottleneck's largest route to reach 85%. The note records the CapEx avoided, priced as the cheapest What-If fix.

**Comparison matrix.**

| Metric | Definition |
|---|---|
| Throughput | Σ L1 demand × MIN(1, 100% ÷ worst utilisation of any cell feeding that L1's L1–L5 sub-tree). A blocked cell gives zero |
| Utilisation, bottlenecks, gate-blocked cells, OEE, TEEP, PCE | as in Workspace 1 |
| Peak-quarter overloads | cells whose peak quarter is ≥ 100% |
| CapEx | installed asset + tooling + shared plant value, plus recorded one-off costs |
| Incremental investment | new machine units, netted by category across the plant (so moving a machine is not new spend), plus new fixture sets, new shared plant and one-off relocation, merge and decommission costs |
| Unit conversion cost | (direct labour + subcontract + recurring premiums + depreciation over 10 yrs) ÷ throughput |
| Payback | investment ÷ (Δ throughput × £450 contribution − Δ running cost) |
| Footprint, utility overruns, space overruns | from the per-factory ceilings above |

Contribution margin and depreciation years can be edited in the Dictionary.

**Key Effects & Possible Causes.** An automated diagnostic chain explains each change:
- **Throughput:** which cells now cap it.
- **Constraints:** binding-constraint shifts (e.g. *Machine → Labour (Skill ≥ 2)*), with the competent-head, machine-quantity, OEE, shift, setup and batch changes that caused them.
- **Bottlenecks:** cells becoming or ceasing to be bottlenecks, split into demand drivers (scrap ripple, dual-source shares, subcontracting) and capacity drivers.
- **BOM and schedule:** peak-quarter overloads; upstream L2–L5 scrap and shared L5 material ripple; schedule changes.
- **Plant limits:** F1–F4 utility RAG and floor-space threshold triggers; gate changes; starved machines; unmapped parts.
- **Cost:** investment, subcontract and labour drivers.

**Export.** The comparison report downloads as `.csv` or `.json`, or opens as a print-friendly HTML summary. **→ Export to DES** sends any scenario to Workspace 6.

## Buffers, WIP & Stores · Tecnomatix preset · Governance

### Buffers, WIP & Stores
The engine is in `src/engine/stores.ts`. It models four storage tiers across F1–F4, all driven by the exploded BOM, the route mappings and the folded Macro-Blocks:

| Tier | Contents | Located at | Sizing |
|---|---|---|---|
| **RM** | Raw Material & Bought-Out Stores (L5) | Goods-in of the consuming cell's factory | daily gross × days of cover (default 10) |
| **KIT** | Kitting / Marshalling Zones (L2–L4 Make parts) | Kitting zone of the producing cell | daily demand × days of cover (default 2); valued at component material cost |
| **WIP** | Inter-Cell WIP Buffers / Line-Side Supermarkets | Line-side at the consuming cell; cross-factory links flagged | Recommended size = **batch + setup cover + safety** (below) |
| **FG** | Finished Goods & Despatch Staging (L1) | Despatch staging | daily demand × days of cover (default 3) |

**Recommended WIP buffer size.**
- **Replenishment time** T = setup + batch × bottleneck cycle ÷ OEE.
- **Setup cover** = demand rate × setup minutes.
- **Safety** = z (1.65) × CV(OEE) (15%) × demand rate × T.
- **Initial WIP** = setup cover + safety.
- **Dwell time** = average WIP ÷ rate (Little's law).

**Per-item outputs.** Every item reports:
- **Days of Cover**
- **locations / stillages**: stock ÷ units per location
- **Stores Footprint m²**: locations × m² per location, aisles included
- **Working Capital Tied Up £**: stock × standard cost. Standard cost is the L5 unit cost, rolled up the BOM with qty per, plus route work content × £1.20/min conversion, grossed up for scrap.

**Where it shows up.**
- **Workspace 1:** a Stores & WIP tile, and footprint including stores.
- **Buffers & Stores view (Phase 2):** the space balance checks cells + circulation + stores against each factory's floor-area ceiling.
- **Workspace 7:** matrix rows for *Stores & buffer footprint* and *Working capital tied up*, the space-ceiling check, and a **Stores** cause-effect chain (tier deltas and resized buffers, e.g. batch halving shrinks WIP).

### Siemens Tecnomatix Plant Simulation preset (Workspace 6)
**Source.** Choose the source (Live Baseline or any Workspace 7 scenario). Then switch the preset to *Siemens Tecnomatix Plant Simulation*.

**Export.** Download all four DataTables as one `.xlsx`, or as `.csv` / `.json`:
- **`Routing_DataTable`:** MU, Station_Path (`.Models.Plant.<F>.<Cell>.Station`), batch, setup and processing seconds, Availability %, MTTR, station quantity, and the next buffer / station or the despatch Drain.
- **`ProductionPlan_DataTable`:** Source path, quarter, quantity, batches and interval in seconds.
- **`ShiftCalendar_DataTable`:** Early / Late / Night shifts from each passport's shift pattern.
- **`Buffer_DataTable`:** `Buffer_ID`, `Station_Path`, `Capacity_Units`, `Initial_WIP`, `Dwell_Time_Sec`, plus the upstream and downstream stations.

**Statistics import.** Import Station / Buffer / Drain statistics:
- **Columns:** `StatWorkingTime`, `StatBlockingTime`, `StatWaitingTime`, `StatThroughput`.
- **Formats:** CSV, TSV, semicolon-separated or JSON; values can be fractions or %.

**Validation rules.**
- **Stations:** AGREE when StatWorkingTime is within ± 5 pp of MIN(analytic utilisation, 100%).
- **Drain:** AGREE when StatThroughput is within ± 5% of analytic throughput.
- **Starvation and blocking:** waiting above 20% flags starvation; blocking above 10% flags blocking. Each flag lists causes such as the in-feed buffer and its upstream cell's utilisation, or a full out-feed buffer and the downstream cell.

### Logic & Data Integrity
The check is in `src/engine/integrity.ts`, shown under *Phase 1 · Logic & Data Integrity*, with a summary on the Factory Control Hub. It reconciles Fixed Process ↔ BOM Nodes ↔ Cell Routes ↔ Micro/Macro Ops ↔ Buffers/Stores ↔ Facility Services across 32 checks:
- **BOM:** circular BOM links, orphaned parent IDs, duplicate lines, level jumps, unscheduled L1s.
- **Routing:** unmapped Make nodes, mappings to missing cells or routes, Buy parts that are mapped, dual-source shares that don't sum to 100%, orphan routes.
- **Ops:** ops referencing missing machines or tooling, and macro overrides pointing at missing routes.
- **Master data:** catalogue gaps, operators with unknown roles, skills no operator holds, skills missing from the catalogue.
- **Stores:** buffers whose producer or consumer cell is missing, and L5 items with no unit cost.
- **Services:** utility or floor ceilings missing for services in demand, and machines with zero kW.

The baseline's deliberate exceptions show up as 1 error and 3 warnings.

### Baseline Change Governance
- **Version badge:** `Baseline vMAJOR.MINOR` with its sign-off status (**Draft → Reviewed → Approved Baseline**) appears in the header and links to the audit log.
- **Version rules:**

  | Event | Version | Sign-off |
  |---|---|---|
  | Cell Passport re-ingestion, Master Data import, legacy import, or a significant live edit | minor +1 | reset to Draft |
  | Scenario promotion, backup restore or reset | major +1 | — |
  | A promoted scenario that was Approved | — | becomes the Approved Baseline |
  | Sign-off | no change | changes as signed off |

- **Scenario sign-off:** scenarios have their own sign-off. Editing an approved scenario returns it to Draft.
- **Audit log:** the structured log records timestamp, action, actor, version from → to, status and details. It survives restores and resets, and exports as `.csv` or `.json`.

### Logic-link tightening in Workspace 7
- **Cell vs Cells space table:** shows *Cells + circulation m²*, *Stores & buffers m²* and *Total m² vs floor ceiling* per factory (`factorySpaceRows`). This is the same total as the Workspace 1 footprint tile and the Buffers & Stores space balance.
- **Effective OEE override:** the Route vs Route Macro-Block override takes an optional **Effective OEE %**. The route's machine load is re-expressed at each asset's OEE, so the macro-block cap and the cell's utilisation stay consistent.
- **Quick shift selector:** a **Shift Pattern** selector (1 / 2 / 3 shifts) recruits or releases a matching shift crew, so the Competent Labour ≥ 2 cap scales with the pattern.
- **Promotion gate:** the governance toggle in Dictionary Defaults, *Require Reviewed/Approved status before promoting Scenario to Live Baseline*, locks the promote button for Draft scenarios. The hub also refuses the promotion itself.

### Editable Dictionary defaults
Master Data → Dictionary Defaults now also exposes:
- **Relocation:** rigging % (default 5%) and recommissioning £ per cell (default £15,000). Both drive Workspace 7's relocation and merge CapEx.
- **Payback inputs:** contribution margin and depreciation years.
- **Stores dictionary:** days of cover, units and m² per location for each tier, the WIP z-score, OEE CV%, conversion £/min, and working days per week.

## Fixed Process governance · IDEF0 system map

### Interactive IDEF0 / Swimlane System Map (Phase 1)
The map is an SVG process and data-flow diagram, defined in `src/engine/systemmap.ts` and drawn by `src/components/SystemMap.tsx`.
- **Inputs (left):** Fixed Process Docs, Cell Passports, BOM & Master Schedule, Assets / Skills 0–3, Stores Dictionary.
- **Controls (top, dashed):** Dictionary Defaults, Drift Tolerances, Baseline Gate.
- **Swimlanes:**
  1. **Engineering Authority:** Fixed Process Baseline → Drift Reconciliation → ECR Release Pack → Baseline Governance.
  2. **Cell & Asset Layer:** Passport Ingestion → Micro → Macro Roll-Up ← Skills 0–3 / Assets & Tooling.
  3. **Multi-Factory Network F1–F4:** BOM Explosion → Route Linker → Buffers & Stores → Facility Services.
  4. **Decision & Siemens Plant Sim Proof:** Capacity → Scenario Planner → Tecnomatix DataTables → Plant Sim Validation.
- **Outputs (right):** Fixed Process Release / ECR, Approved Baseline, Cell Spec Sheets, Plant Simulation DataTables.

Every node carries a live status badge, for example *94% aligned*, *7 bottlenecks* or *v1.0 Approved Baseline*. Hovering a node highlights its flows, and clicking it opens its workspace. A list view gives the same information as a table.

### Fixed Process Baseline: locked reference layer (Phase 2)
`state.fixedProcess` holds the formal Fixed Process Documents. They are read-only and kept separate from the editable Working Cell Routes and Scenarios.
- **Fields:** Document ID, Revision (e.g. *Rev C*), Effective Date, BOM Part ID, Op No, Op Description, Standard Setup Min, Standard Cycle Min, Required Skill Level (0–3), Tooling/Fixture Spec, Mandatory Step.
- **Import:** `.xlsx`, `.csv` or `.json`, with fuzzy column mapping.
- **Changes:** the baseline changes only through *Compare / Ingest Updated Revision*.
- **Baseline data:** `FPD-ATLAS-001`, `FPD-BOREAS-001` and `FPD-CIRRUS-001` at Rev C, 674 steps covering all 67 mapped Make parts. Deliberate examples:

| Cell | Class | Why |
|---|---|---|
| CELL-A | MATURING DRIFT | Working cycle 10.7% faster than standard; 2 drifts already approved with justification |
| CELL-D | MATURING DRIFT | Non-mandatory interim check not performed |
| F2-C01 | MATURING DRIFT | Setup +17.6% |
| CELL-B | NEW LOCAL STEP | Working op not in the document |
| CELL-C | COMPLIANCE DEVIATION | Mandatory MPI crack detection missing |
| F3-C07 | COMPLIANCE DEVIATION | Skill Level 2 required, all operators at Level 1 |

### Live Drift Reconciliation
Each mapped working route, from the live design or any scenario, is paired with its Fixed Process steps by Op No, then by description similarity of 60% or more. Each step is then classified:

| Class | Rule |
|---|---|
| **ALIGNED** | Cycle within ±5% and setup within ±10% of standard |
| **MATURING DRIFT** | Cycle or setup beyond those tolerances but within the ±25% compliance limit; different tooling; or a non-mandatory step not performed |
| **COMPLIANCE DEVIATION** | A mandatory step missing; beyond ±25%; no operator in the cell at the Required Skill Level; or specified tooling not used |
| **NEW LOCAL STEP** | A working op with no counterpart in the document |

Each cell takes its worst class. Tolerances and the Plant Simulation shift starts and break are editable in Dictionary Defaults.

Drifts can be justified and set to *Proposed*, *Approved for ECR* or *Rejected*. Workspace 7 adds matrix rows for *Fixed Process alignment* and *compliance deviations*, plus a **Process** cause-effect chain. The integrity check adds four Fixed Process link checks.

### Compare / Ingest Updated Revision (Rev N → Rev N+1)
An incoming file is diffed against the locked baseline, giving the spec changes (added, changed and removed steps). It is also diffed against the **Working Factory Design**, showing:
- deviations that **fall back into alignment**
- ops that become **newly deviating** under the new spec
- ops that are **still drifting**
- **impacted cells**, with their status before and after

*Lock as Fixed Process Baseline* replaces the steps for the parts in the file. Unchanged parts of a re-issued document carry forward under the new revision. Justifications for resolved drifts are closed, and the change is audited as `Fixed Process revision`.

### New Fixed Process Release / ECR Pack (Phase 4)
One click compiles every **approved** working-design drift into the pack:
- **ECR summary:** a reference such as `ECR-YYYYMMDD-nnn`, plus the documents to re-issue, Rev C → Rev D.
- **Approved drifts:** each with its justification, approver, and setup and cycle deltas in minutes and %.
- **Proposed Rev N+1 step list:** revised, added and removed steps applied to the locked baseline.
- **Working macro-blocks.**
- **A sign-off block.**

It exports as `.xlsx` (5 sheets), as `.csv`, or as a print-ready HTML sign-off pack. *Issue & lock next revision* feeds the pack back through the revision diff, so the approved drifts fall back into alignment. Every export is audited as `ECR pack issued`.

## Alias Dictionary & "Needs Data Action" feedback loop

**Alias Dictionary.** `state.aliases` maps incoming nicknames to canonical IDs. It is edited in *Phase 2 → Assets & Workforce Skills → Alias Dictionary*, persisted in IndexedDB and included in Full-Plant JSON backups. It covers four domains:

| Domain | Example |
|---|---|
| Cell IDs | `Cell_A` → `CELL-A` |
| BOM Part / Variant IDs | `ATL100` → `ATL-100` |
| Master Asset IDs | `DMU-50-1` → `CELL-A-VMC5-01` |
| Master Tooling / Fixture IDs | `FIX-ATL-01` → `FX-ATL-100-DM-W-01` |

The baseline ships with 7 aliases.

**Alias-aware ingestion** (`src/engine/aliases.ts`). Cell Passport drops and Smart Import check every incoming ID, then apply the official IDs:
- **What is checked:** the cell ID, route Variant IDs, asset IDs, and tooling IDs, including those referenced by individual ops.
- **How it resolves:** an exact match first, then the Alias Dictionary.
- **What counts as a near-duplicate:**
  - **Normalised:** differs only in case or punctuation, e.g. `Cell_A` ≈ `CELL-A`.
  - **Typo:** up to 2 insertions, deletions or transpositions, e.g. `CEL-D` ≈ `CELL-D`.
  - **Not a typo:** pure substitutions, so sibling IDs such as `CELL-A` and `CELL-B`, or a genuinely new `CELL-M`, stay distinct.
- **0 mismatches:** the passport is ingested silently.
- **Any mismatch:** the preview lists each unrecognised ID or typo, where it appears and a suggested official ID. Click **Map & Remember Alias**, or *Keep as new* for genuinely new assets or tooling.
- **Provenance:** the aliases a passport relied on are recorded in its `ingestNotes`.
- **Safety:** without the preview, a typo such as `CEL-D` would have created a duplicate cell.

**Data Quality Score and "Needs Data Action".** Each cell scores 100 minus deductions:

| Issue | Deduction |
|---|---|
| Each alias relied on at ingestion | −5 |
| Fuzzy or manual BOM link | −5 |
| Asset or tooling missing from the catalogue | −10 |
| Op uses a machine the passport doesn't list | −10 |
| Asset with no service loads or no footprint | −5 each |
| OEE falling back to the Complexity default | −3 |
| Skill missing from the catalogue | −5 |
| Role missing from the catalogue | −3 |

Any "fix at source" item, or a score below 90%, flags the cell **Needs Data Action**. Each flagged cell gets a plain-English punch-list. The flags appear in:
- **Guided Next Actions:** with a quick fix to export all flagged passports.
- **Phase 2 · Cell Passports:** the Data Quality table.
- **Phase 3 · Cells & Macro-Routing:** a badge on the cell row and a card in the cell detail.

**⬇ Export Normalised Passport (.json).** Available per cell or in bulk for every flagged cell. It writes a clean Cell Design Passport with official IDs applied and hub-only provenance removed. A `normalisation` block lists each replaced alias and the open punch-list, so the cell owner can fix the inconsistency at source.

**Edge-to-edge polish:**
- **Phase-based button labels:** *→ Export to Siemens Plant Simulation (Phase 4)* and *Choose a scenario in Static Scenario Planner (Phase 3) →*.
- **No native browser dialogs:** `window.prompt()` and `window.alert()` are gone. Inline inputs handle scenario create, clone and rename, and mapping-profile names; non-blocking toast banners handle status messages.
- **Deeper Next Actions links:** they now open sub-tabs directly (Dictionary Defaults for drift tolerances, Catalogue Importer, Alias Dictionary, Live Drift).
- **Justifications inside scenarios:** with a scenario selected in *Fixed Process Baseline → Reconcile*, drift justifications are recorded inside that scenario. On promotion they are merged into the live baseline, while the live locked Fixed Process layer stays authoritative.

## Calculation rules

All core functions in `src/engine/` carry JSDoc comments.

| Quantity | Rule |
|---|---|
| Available minutes | shifts/day × hours/shift × 60 × days/week × weeks/yr (default **48**) |
| Quarter demand | launch-rate override if set, else annual volume × quarter split % |
| BOM explosion | child net = parent gross × qty per; gross = net ÷ (1 − scrap %); cumulative yield = Π(1 − scrap) up to L1 |
| Critical path | cumulative LT = own LT + max(child cumulative LT); flagged along the longest chain |
| Rolled-up setup | Σ setup min of the route's micro-ops |
| Bottleneck cycle | max over assets of (Σ cycle on asset ÷ asset qty) |
| Effective OEE | cycle-weighted asset OEE. Where OEE is missing, the complexity default applies: A–E = **90/80/70/60/50%** |
| **Machine cap** | qty × available min × OEE ÷ Σ(cycle + setup/batch) on that asset |
| **Competent Labour cap** | operators with competence **≥ 2** × available min × **82%** ÷ labour min per unit for that skill |
| **Tooling Dwell cap** | fixture qty × available min × max dwell % (default **80%**) ÷ Σ cycle using the fixture |
| **Binding Capacity Cap** | **MIN(Machine, Labour, Tooling)** per route. At cell level, utilisation is the highest resource load from the full BOM-driven route mix |
| Status | Bottleneck ≥ 100%, Near limit ≥ 85%, Idle when there is no BOM demand |
| Gate | BLOCKED when the passport says so, or when no competent operator holds a required skill. CONDITIONAL when the passport says so, an asset is missing from the master list, an op references an unknown asset, or a route has more than 20 ops |
| Cascade bottleneck | every ancestor of a BOM line mapped to a bottleneck or blocked cell |
| Footprint | cell = Σ asset m² × 1.20 + 8 m²; factory = Σ cell × 1.35 |
| TEEP | OEE × (available min ÷ calendar min) |
| PCE | VA ÷ (VA + NVA + ENVA) cycle minutes |
| Services balance | Σ cell services + shared plant parasitic loads vs capacity. Red > 100%, Amber ≥ 85%. Crane compares the heaviest lift with the crane rating |
| What-If solver | enumerates shifts (current → 3), +0–3 machines, +0–4 competent operators and +0–3 fixture sets. Ranks results by CapEx + 3 years of added labour |
| DES validation | AGREE when \|sim − analytic\| ≤ 5 pp; buffer alert when max queue > 25 |

You can edit every threshold in **Master Data → Dictionary Defaults**.

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

The importer also accepts common aliases (`cell_id`, `plant`, `operations`, `steps`, `setup`, `cycle`, …). It takes single passports, arrays, or `{ "passports": [...] }` bundles. A passport is upserted by Cell ID, and an older revision than the one already held is skipped.

## Baseline data

`src/data/seed.ts` builds the baseline deterministically. It contains:

- **Cells:** 47 cells: F1 Precision Machining (12), F2 Fabrication & Welding (12), F3 Surface Treatment (11) and F4 Final Assembly & Test (12).
- **CELL-A CNC Cell 01:** two 5-axis machining centres, a CMM, a deburr bench and a washer, 2 shifts, revision 3.
- **BOM:** 3 Programmes (ATLAS, BOREAS, CIRRUS), each with 2 L1 Variants and a common L2 module, giving a 162-line 5-level BOM.
- **Cases built in deliberately:** bottlenecks, a Labour-bound cell and a Tooling-bound cell, two gate-blocked cells and two over-utility cells. Also unmapped BOM nodes, orphan routes, a launch-rate ramp and Red/Amber utilities.
- **Sample DES results**, so the validation workspace shows output from the start.

The seeded CELL-A is a representative reconstruction of the Cell Design Passport baseline. To replace it with your actual passport, drop its `.json` file into **Master Data → Cell Passport Ingestion**. Your mappings will pick up the new values automatically.

The `samples/` folder holds ready-made inputs for each importer:

- passports, including CELL-A rev 4 and 3-shift updates
- `master-data.xlsx` and the master-list CSVs
- `legacy-capacity-bom.xlsx`
- `des-results.csv`
- `plantsim-statistics.csv`
- `passports/Cell_A_nicknames_rev5.json`: nicknames only, so it auto-ingests silently and CELL-A is flagged *Needs Data Action*
- `passports/CEL-D_typo_rev.json`: near-duplicate typos, so the preview offers *Map & Remember Alias*
- `fixed-process-rev-C.xlsx`, the locked Fixed Process Baseline
- `fixed-process-ATLAS-rev-D.csv`, an updated revision to try *Compare / Ingest*

## Data safety

- **Autosave:** state saves to **IndexedDB** (`multi-factory-hub-v1`), with a `localStorage` fallback.
- **Snapshots:** the hub keeps **5 rolling auto-snapshots**, taken on significant changes (at most one a minute) and before any restore or reset. You can roll back from the *Snapshots* menu.
- **Backup:** *Backup* / *Restore* write and read a full-plant `.json` backup in one click.
- **Governance:** the baseline version, sign-off status and structured audit log are part of the saved state and the full-plant backup.
- **Scenarios:** Workspace 7 scenarios are kept in their own IndexedDB store (`scenarios`, schema v2) and survive reloads. Promoting one snapshots the live state first.

## Project structure

```
src/engine/     types, bom, rollup, mapping, ingest, model (audit/KPIs/services),
                services (spec sheet), des, importer, legacy, whatif, scenario (Workspace 7),
                stores, tecnomatix, integrity, governance, fixedprocess, systemmap,
                smartimport, nextactions, navigation, aliases, version,
                sheet (SheetJS), csv
src/data/       deterministic F1–F4 baseline
src/store/      IndexedDB/localStorage persistence + React context
src/components/ UI primitives, utilisation chart, ingestion audit panel
src/workspaces/ the seven workspaces + FixedProcess and EcrRelease
tests/          Vitest unit tests (engine, importers, persistence, terminology, v1.0 release hardening)
scripts/        sample-file generator
```

CI (`.github/workflows/ci.yml`) runs the type-check, the tests and the offline build. It then checks that `dist-offline/index.html` references no external assets. The built `dist-offline/index.html` is committed to the repository.
