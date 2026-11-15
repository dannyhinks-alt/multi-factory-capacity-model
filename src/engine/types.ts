/**
 * Core domain types for the Multi-Factory Master Control Hub.
 * British English throughout; no retail terminology (Variant / Programme / Assembly only).
 */

export type FactoryId = 'F1' | 'F2' | 'F3' | 'F4';
export const FACTORIES: FactoryId[] = ['F1', 'F2', 'F3', 'F4'];
export const FACTORY_NAMES: Record<FactoryId, string> = {
  F1: 'F1 Precision Machining',
  F2: 'F2 Fabrication & Welding',
  F3: 'F3 Surface Treatment & Finishing',
  F4: 'F4 Final Assembly & Test',
};

export type ComplexityClass = 'A' | 'B' | 'C' | 'D' | 'E';
export type VaType = 'VA' | 'NVA' | 'ENVA';
export type GateStatus = 'PASSED' | 'CONDITIONAL' | 'BLOCKED';
export type ConstraintKind = 'Machine' | 'Labour' | 'Tooling';
export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export const QUARTERS: Quarter[] = ['Q1', 'Q2', 'Q3', 'Q4'];

/** Utility / service demand vector shared by assets, cells and factories. */
export interface ServiceVector {
  electricalKw: number;
  airLpm: number;
  extractionM3h: number;
  craneTonnes: number;
  coolantLpm: number;
}

/** Master Asset catalogue entry. */
export interface Asset extends ServiceVector {
  assetId: string;
  description: string;
  factory: FactoryId;
  cellId: string;
  category: string;
  complexityClass: ComplexityClass;
  shiftTier: 1 | 2 | 3;
  footprintM2: number;
  oeePct: number;
  capexGbp: number;
  installGbp: number;
}

/** Master Fixture / Tooling catalogue entry. */
export interface Fixture {
  toolingId: string;
  description: string;
  linkedAsset: string;
  qty: number;
  maxDwellPct: number;
  costGbp: number;
}

/** Cross-factory Skill / Role catalogue entry. */
export interface SkillRole {
  roleId: string;
  skillId: string;
  description: string;
  hourlyRateGbp: number;
}

/** Competence scale: 0 none, 1 training, 2 competent (productive), 3 trainer. */
export type Competence = 0 | 1 | 2 | 3;

export interface PassportOperator {
  operatorId: string;
  name: string;
  roleId: string;
  competence: Record<string, Competence>;
}

/** Asset reference inside a passport; optional fields override the master catalogue. */
export interface PassportAsset extends Partial<ServiceVector> {
  assetId: string;
  qty: number;
  description?: string;
  category?: string;
  oeePct?: number;
  footprintM2?: number;
  capexGbp?: number;
  installGbp?: number;
  complexityClass?: ComplexityClass;
}

export interface PassportFixture {
  toolingId: string;
  qty?: number;
  maxDwellPct?: number;
  costGbp?: number;
  description?: string;
  linkedAsset?: string;
}

/** A single micro-operation from a Cell Passport route (up to 20 per route). */
export interface MicroOp {
  opNo: number;
  description: string;
  assetId?: string;
  setupMin: number;
  cycleMin: number;
  labourMin?: number;
  skillId?: string;
  toolingId?: string;
  vaType: VaType;
}

/** Product Family Route held by a Cell Passport. */
export interface PassportRoute {
  routeId: string;
  variantId: string;
  productFamily: string;
  description: string;
  batchSize: number;
  ops: MicroOp[];
  /** Scenario-only Effective OEE % override applied when folding (set from a Macro-Block override). */
  oeeOverridePct?: number;
}

export interface ShiftPattern {
  shiftsPerDay: number;
  hoursPerShift: number;
  daysPerWeek: number;
  weeksPerYear?: number;
}

/** A Cell Design Passport as ingested from `.json`. */
export interface CellPassport {
  passportId: string;
  schemaVersion: string;
  cellId: string;
  cellName: string;
  factory: FactoryId;
  revision: number;
  issuedAt: string;
  gateStatus: GateStatus;
  gateNotes?: string;
  shiftPattern: ShiftPattern;
  assets: PassportAsset[];
  fixtures: PassportFixture[];
  crew: PassportOperator[];
  routes: PassportRoute[];
  serviceAllowance?: Partial<ServiceVector>;
  /** Provenance: aliases / fuzzy resolutions applied when this passport was ingested. */
  ingestNotes?: PassportIngestNotes;
}

export type AliasDomain = 'cell' | 'part' | 'asset' | 'tooling';

/** Persistent alias: an incoming nickname mapped to its canonical (official) ID. */
export interface AliasEntry {
  domain: AliasDomain;
  alias: string;
  canonical: string;
  source: 'manual' | 'preview' | 'seed';
  createdAt: string;
  note?: string;
}

export interface AppliedAlias {
  domain: AliasDomain;
  from: string;
  to: string;
  /** Where the ID appeared in the passport (e.g. "cellId", "assets[0].assetId"). */
  field: string;
}

export interface PassportIngestNotes {
  ingestedAt: string;
  sourceFile?: string;
  aliasesApplied: AppliedAlias[];
}

export type BomLevel = 1 | 2 | 3 | 4 | 5;
export const BOM_LEVEL_NAMES: Record<BomLevel, string> = {
  1: 'L1 Top Assembly',
  2: 'L2 Sub-Assembly',
  3: 'L3 Component Assembly',
  4: 'L4 Manufactured Component',
  5: 'L5 Raw Material & Bought-Out',
};

/** One line of the 5-level BOM. A part ID may appear on many lines (shared parts). */
export interface BomLine {
  lineId: string;
  parentLineId: string | null;
  partId: string;
  description: string;
  level: BomLevel;
  programme: string;
  qtyPer: number;
  scrapPct: number;
  leadTimeDays: number;
  makeBuy: 'Make' | 'Buy';
  uom: string;
  /** Bought-in / material unit cost £ (L5 raw material & bought-out). Made parts roll up from children + conversion. */
  unitCostGbp?: number;
}

/** Master Schedule demand for a top-level (L1) Assembly Variant. */
export interface ScheduleLine {
  partId: string;
  programme: string;
  annualVolume: number;
  quarterSplitPct: [number, number, number, number];
  launchOverrides: Partial<Record<Quarter, number>>;
}

/** Persistent BOM ↔ Cell Route mapping. */
export interface RouteMapping {
  bomPartId: string;
  factory: FactoryId;
  cellId: string;
  routeId: string;
  variantId: string;
  source: 'auto' | 'manual' | 'legacy' | 'scenario';
  updatedAt: string;
  /** Share of the part's demand routed here (dual-source splits). Default 100%. */
  sharePct?: number;
}

/** Make-vs-Buy subcontract offload of a BOM part (scenario lever). */
export interface Subcontract {
  bomPartId: string;
  /** Share of the part's gross demand bought in rather than made. */
  pct: number;
  /** Bought-in unit piece-part price £. */
  piecePriceGbp: number;
  note?: string;
}

/** Direct override of a folded Macro-Block (applied by re-scaling its micro-ops before re-folding). */
export interface MacroOverride {
  setupMin?: number;
  cycleMin?: number;
  batchSize?: number;
  /** Effective OEE % override for this route's Macro-Block. */
  oeePct?: number;
}

/** One-off CapEx (£) or recurring cost (£/yr) adjustment recorded by a scenario operation. */
export interface CostAdjustment {
  id: string;
  label: string;
  kind: 'Relocation' | 'Replication' | 'Merge' | 'Decommission' | 'Tooling' | 'Overtime' | 'Other';
  capexGbp: number;
  opexGbpPerYear: number;
}

export interface SharedPlantItem {
  id: string;
  description: string;
  kind: 'Compressor' | 'Chiller' | 'Substation' | 'Overhead Crane' | 'Extraction' | 'Other';
  /** Parasitic load the shared plant itself consumes. */
  load: Partial<ServiceVector>;
  capexGbp: number;
}

export interface FactoryUtilities {
  factory: FactoryId;
  capacity: ServiceVector;
  /** Usable floor-space ceiling (m²) for the factory, compared against footprint incl. circulation. */
  floorAreaM2?: number;
  sharedPlant: SharedPlantItem[];
}

/** Result row re-imported from a Plant Simulation / DES run. */
export interface DesResult {
  cellId: string;
  routeId?: string;
  simUtilisationPct: number;
  simThroughput?: number;
  avgQueue?: number;
  maxQueue?: number;
}

export interface Dictionary {
  weeksPerYear: number;
  labourAvailabilityPct: number;
  complexityPct: Record<ComplexityClass, number>;
  fixtureFlagDwellPct: number;
  footprintFixedM2: number;
  footprintVariablePct: number;
  circulationPct: number;
  competenceThreshold: number;
  bottleneckPct: number;
  nearLimitPct: number;
  utilityAmberPct: number;
  desTolerancePct: number;
  desBufferLimit: number;
  /** Contribution margin per top Assembly £ — used for scenario payback. */
  contributionMarginGbp: number;
  /** Straight-line depreciation period (years) for unit conversion cost. */
  depreciationYears: number;
  /** Relocation rigging / transport allowance as % of asset CapEx (Workspace 7). */
  relocationRiggingPct: number;
  /** Fixed recommissioning £ per relocated or merged cell (Workspace 7). */
  recommissioningGbp: number;
  /** Buffers, WIP & Stores. */
  stores: StoresDictionary;
  /** Fixed Process drift tolerances. */
  drift: DriftTolerances;
  /** Siemens Plant Simulation shift-calendar defaults. */
  plantSim: PlantSimDefaults;
  /** Governance gate: only Reviewed / Approved scenarios may be promoted to Live Baseline. */
  requireApprovalForPromotion: boolean;
  /** Active Factory Switch (2–4 plants): inactive factories are excluded from KPIs, footprint, services and stores. */
  activeFactories: Record<FactoryId, boolean>;
  /** Road distance between plants (km), keyed `F1-F2` (lower ID first; symmetric). */
  interPlantKm: Record<string, number>;
  /** Material-flow, spaghetti and handling assumptions. */
  flow: FlowDictionary;
  /** Shared Work Centre queue-contention risk thresholds. */
  sharedWc: SharedWcRules;
}

export interface FlowDictionary {
  /** Parts carried per pallet / stillage move. */
  unitsPerPallet: number;
  /** Pick-up + set-down handling minutes per pallet move (internal). */
  handlingMinPerMove: number;
  /** Average internal travel speed of forklift / tugger incl. junctions (km/h). */
  internalSpeedKmh: number;
  /** Average road speed between plants (km/h). */
  truckSpeedKmh: number;
  /** Pallets per inter-plant truck load. */
  palletsPerTruck: number;
  /** Truck loading + unloading minutes per pallet. */
  truckHandlingMinPerPallet: number;
  /** Auto-grid spacing (m) between block centres when no floor-plan position has been placed. */
  autoGridAisleM: number;
}

export interface SharedWcRules {
  /** Feeding cells at or above this count → Queue Contention Risk. */
  feederThreshold: number;
  /** Static utilisation above this % → Queue Contention Risk. */
  utilisationRiskPct: number;
}

/** Optional 2D floor-plan image per factory (stored as a data URL, offline). */
export interface LayoutImage {
  dataUrl: string;
  name: string;
  widthPx: number;
  heightPx: number;
}

/** Floor-plan layout of one factory: optional calibrated image + placed block centres (metres). */
export interface FactoryLayout {
  image?: LayoutImage;
  /** Metres per image pixel from 2-point calibration (absent → auto-grid scale from floor area). */
  metresPerPx?: number;
  calibration?: { x1: number; y1: number; x2: number; y2: number; metres: number };
  /** Block centre positions in metres from the plan's top-left corner, keyed by cell / Shared Work Centre / store block ID. */
  positions: Record<string, { x: number; y: number }>;
}

export type StoreTier = 'RM' | 'KIT' | 'WIP' | 'FG';
export const STORE_TIER_NAMES: Record<StoreTier, string> = {
  RM: 'Raw Material & Bought-Out Stores (L5)',
  KIT: 'Kitting / Marshalling Zones (L2–L4)',
  WIP: 'Inter-Cell WIP Buffers / Line-Side Supermarkets',
  FG: 'Finished Goods & Despatch Staging (L1)',
};

export interface StoreTierRule {
  /** Target days of cover (RM / KIT / FG). WIP buffers are sized from batch, setup & OEE variability. */
  daysCover: number;
  /** Units held per storage location / stillage. */
  unitsPerLocation: number;
  /** Floor area per location incl. aisle share (m²). */
  m2PerLocation: number;
}

export interface StoresDictionary {
  tiers: Record<StoreTier, StoreTierRule>;
  /** Service-level z-score for WIP safety stock (1.65 ≈ 95%). */
  safetyZ: number;
  /** Coefficient of variation of OEE (%) driving WIP buffer safety stock. */
  oeeVariabilityCvPct: number;
  /** Conversion cost £ per work-content minute used to roll up made-part standard cost. */
  conversionGbpPerMin: number;
  /** Working days per week for daily demand. */
  workingDaysPerWeek: number;
}

/** Siemens Tecnomatix Plant Simulation statistics row (Station / Buffer / Drain). */
export interface TxStat {
  objectPath: string;
  kind: 'Station' | 'Buffer' | 'Drain';
  workingPct: number;
  blockingPct: number;
  waitingPct: number;
  throughput?: number;
}

export type SignOffStatus = 'Draft' | 'Reviewed' | 'Approved Baseline';

export type AuditAction =
  | 'Baseline created'
  | 'Baseline promotion'
  | 'Cell Passport re-ingestion'
  | 'Master Data import'
  | 'Legacy workbook import'
  | 'Baseline edit'
  | 'Sign-off'
  | 'Backup restore'
  | 'Reset to seed'
  | 'Snapshot rollback'
  | 'Fixed Process revision'
  | 'ECR pack issued';

export interface AuditEntry {
  id: string;
  at: string;
  action: AuditAction;
  actor: string;
  versionFrom: string;
  versionTo: string;
  status: SignOffStatus;
  details: string;
}

/** Baseline Change Governance: version, sign-off status and structured audit log. */
export interface Governance {
  major: number;
  minor: number;
  status: SignOffStatus;
  currentUser: string;
  auditLog: AuditEntry[];
}

export interface ColumnMappingProfile {
  name: string;
  target: ImportTarget;
  columns: Record<string, string>; // target field -> source column
}

export type ImportTarget = 'assets' | 'fixtures' | 'skills';

export interface IngestLogEntry {
  at: string;
  kind: 'passport' | 'master' | 'legacy' | 'des' | 'restore' | 'scenario';
  message: string;
}

export interface HubState {
  version: 1;
  settings: Dictionary;
  assets: Asset[];
  fixtures: Fixture[];
  skills: SkillRole[];
  passports: CellPassport[];
  bom: BomLine[];
  schedule: ScheduleLine[];
  mappings: RouteMapping[];
  utilities: FactoryUtilities[];
  desResults: DesResult[];
  mappingProfiles: ColumnMappingProfile[];
  ingestLog: IngestLogEntry[];
  updatedAt: string;
  /** Scenario levers (optional so Live Baseline data stays unchanged). */
  subcontracts?: Subcontract[];
  macroOverrides?: Record<string, MacroOverride>;
  costAdjustments?: CostAdjustment[];
  /** Governance & simulation statistics. */
  governance?: Governance;
  tecnomatixStats?: TxStat[];
  /** Locked Fixed Process Baseline reference layer. */
  fixedProcess?: FixedProcessBaseline;
  /** Persistent Alias Dictionary (nicknames → canonical IDs). */
  aliases?: AliasEntry[];
  /** Cell IDs designated as Shared Work Centres (fed by several cells, e.g. paint lines, anodise, CMM rooms). */
  sharedWorkCentres?: string[];
  /** Factory floor-plan layouts (image, scale calibration and block positions). */
  layouts?: Partial<Record<FactoryId, FactoryLayout>>;
}

// ---------------------------------------------------------------- Fixed Process governance

export interface DriftTolerances {
  /** |Δ cycle| within this % of standard → ALIGNED. */
  cycleTolerancePct: number;
  /** |Δ setup| within this % of standard → ALIGNED. */
  setupTolerancePct: number;
  /** |Δ| beyond this % → COMPLIANCE DEVIATION (between the two → MATURING DRIFT). */
  complianceTolerancePct: number;
}

export interface PlantSimDefaults {
  /** Shift start times (HH:MM) for Early / Late / Night. */
  shiftStarts: [string, string, string];
  breakMin: number;
}

/** One step of a formal Fixed Process Document (locked reference, never edited in place). */
export interface FixedProcessStep {
  docId: string;
  revision: string;
  effectiveDate: string;
  bomPartId: string;
  opNo: number;
  opDescription: string;
  stdSetupMin: number;
  stdCycleMin: number;
  /** Required competence level (0–3) of the operator performing the step. */
  requiredSkillLevel: number;
  toolingSpec: string;
  mandatory: boolean;
}

export interface FixedProcessDocMeta {
  docId: string;
  revision: string;
  effectiveDate: string;
  title: string;
  lockedAt: string;
  lockedBy: string;
}

export type DriftClass = 'ALIGNED' | 'MATURING DRIFT' | 'COMPLIANCE DEVIATION' | 'NEW LOCAL STEP';

/** Engineering justification attached to a working-design drift (for the ECR Release Pack). */
export interface DriftJustification {
  note: string;
  status: 'Proposed' | 'Approved' | 'Rejected';
  by: string;
  at: string;
}

export interface FixedProcessBaseline {
  docs: FixedProcessDocMeta[];
  steps: FixedProcessStep[];
  history: { docId: string; fromRev: string; toRev: string; at: string; by: string; summary: string }[];
  /** Keyed by drift key `cellId|routeId|bomPartId|opNo`. */
  justifications: Record<string, DriftJustification>;
}
