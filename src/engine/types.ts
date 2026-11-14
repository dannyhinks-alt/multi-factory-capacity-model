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
  source: 'auto' | 'manual' | 'legacy';
  updatedAt: string;
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
}

export interface ColumnMappingProfile {
  name: string;
  target: ImportTarget;
  columns: Record<string, string>; // target field -> source column
}

export type ImportTarget = 'assets' | 'fixtures' | 'skills';

export interface IngestLogEntry {
  at: string;
  kind: 'passport' | 'master' | 'legacy' | 'des' | 'restore';
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
}
