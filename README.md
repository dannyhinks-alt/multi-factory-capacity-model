# Multi-Factory Master Capacity, Services & Simulation Hub (MVP)

An offline-first **React + TypeScript + Vite + Tailwind CSS** application, the **Multi-Factory Master Control Hub**. It brings together 40–50+ **Cell Design Passports** across factories **F1–F4**, and owns the **5-Level BOM**, the **Master Schedule** and the **BOM ↔ Cell Route** mapping. From these it rolls every cell's micro-routes up into simulation-ready **Cell Macro-Blocks**.

The whole application builds to a single self-contained file, `dist-offline/index.html`. It has no CDNs and makes no network calls, so you can open it straight from disk.

---

## Quick start

```bash
npm ci
npm run dev             # http://localhost:5173
npm test                # 85 unit tests (Vitest)
npm run build:offline   # → dist-offline/index.html (single file, zero external CDNs)
npm run samples         # regenerate example input files under samples/
```

Open `dist-offline/index.html` in any modern browser. The hub starts with a realistic baseline (described below), so every workspace, chart and export works straight away.

## The seven workspaces

| # | Workspace | Highlights |
|---|-----------|-----------|
| 1 | **Factory Control Hub** | `All Plants / F1–F4` filter. Shows Total CapEx £ (cells plus shared plant) and Footprint m² (8 m² fixed + 20% variable cell uplift, then 35% circulation). Also covers average utilisation, OEE, TEEP and PCE (VA / NVA / ENVA), a cell utilisation chart, the bottleneck, blocked and over-utility list, factory services RAG and the **Micro-vs-Macro Ingestion Audit**. |
| 2 | **5-Level BOM & Master Schedule** | Master Schedule editor (annual volume, Q1–Q4 split %, launch-rate overrides). Indented L1 → L5 tree with level pills, Programme filter, net/gross, quarterly gross, cumulative yield, critical-path lead time and **Cascade Bottleneck** flags. Also holds the **BOM ↔ Cell Route Linker** (auto-match, suggestions, manual override, stale detection) and the shared L5 raw material roll-up. |
| 3 | **Ingested Cells & Macro-Routing Explorer** | Collapsible F1–F4 accordions, search, and status filters (`All / Bottleneck / Gate Blocked / Over-Utility`). Toggles between **Macro-Route View** and **Micro-Route Drill-Down**. Shows Machine / Labour / Tooling constraint tags and resource utilisation. Includes the **What-If Shift/CapEx solver**, which can apply its result to the passport as a new revision. |
| 4 | **Facility & Cell Services Specifier** | 1-click **Cell Facilities & CapEx Spec Sheet** (`.csv` / `.png` / `.json`) covering kW, compressed air, extraction, crane tonnes, coolant/water, footprint and CapEx. Also a **factory-level services balance** (cell demand + shared plant vs installed capacity, RAG) with editable capacities and shared plant. |
| 5 | **Master Data & Workforce Matrix** | Batch multi-file **Cell Passport** drop-zone with a re-ingestion demo. Editable Asset, Fixture and Skill/Role catalogues, and the **0–3 competence matrix**. A SheetJS **Catalogue Importer** (fuzzy column matching, `.json` mapping profiles, *Merge/Upsert* vs *Replace Unreferenced*). The **Smart Legacy Workbook Importer**, and the Dictionary defaults. |
| 6 | **Plant Simulation / DES Export & Validation** | Flat **DES Routing & Schedule tables** (CSV / JSON / bundle) built from folded Macro-Operations. A source selector exports either the Live Baseline or any Workspace 7 scenario. DES result re-import with **AGREE / DISAGREE** flags and buffer-queue monitoring. |
| 7 | **Static Scenario Planner & Cause-Effect Studio (V1.1)** | Copy-on-write scenarios (Baseline vs Scenario A/B/C…), three structural comparison modes (Cell vs Cells, Asset vs Asset Load, Route vs Route), one-click stress-test presets, a side-by-side comparison matrix with delta badges, the **Key Effects & Possible Causes** diagnostic chain, report export (.csv / .json / print) and **Promote Scenario to Live Baseline**. See below. |

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

## Data safety

- **Autosave:** state saves to **IndexedDB** (`multi-factory-hub-v1`), with a `localStorage` fallback.
- **Snapshots:** the hub keeps **5 rolling auto-snapshots**, taken on significant changes (at most one a minute) and before any restore or reset. You can roll back from the *Snapshots* menu.
- **Backup:** *Backup* / *Restore* write and read a full-plant `.json` backup in one click.
- **Scenarios:** Workspace 7 scenarios are kept in their own IndexedDB store (`scenarios`, schema v2) and survive reloads. Promoting one snapshots the live state first.

## Project structure

```
src/engine/     types, bom, rollup, mapping, ingest, model (audit/KPIs/services),
                services (spec sheet), des, importer, legacy, whatif, scenario (Workspace 7),
                sheet (SheetJS), csv
src/data/       deterministic F1–F4 baseline
src/store/      IndexedDB/localStorage persistence + React context
src/components/ UI primitives, utilisation chart, ingestion audit panel
src/workspaces/ the seven workspaces
tests/          Vitest unit tests (engine, importers, persistence, terminology)
scripts/        sample-file generator
```

CI (`.github/workflows/ci.yml`) runs the type-check, the tests and the offline build. It then checks that `dist-offline/index.html` references no external assets. The built `dist-offline/index.html` is committed to the repository.
