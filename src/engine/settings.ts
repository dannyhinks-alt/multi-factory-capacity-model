import type { ComplexityClass, Dictionary, FactoryId, ServiceVector } from './types';
import { FACTORIES } from './types';

/**
 * Safe Dictionary defaults used by every calculation and by the Smart Legacy Workbook Importer.
 * 48 weeks/yr, 82% labour availability, Complexity A–E = 90/80/70/60/50%, Fixture flag 80%.
 */
export const DEFAULT_DICTIONARY: Dictionary = {
  weeksPerYear: 48,
  labourAvailabilityPct: 82,
  complexityPct: { A: 90, B: 80, C: 70, D: 60, E: 50 },
  fixtureFlagDwellPct: 80,
  footprintFixedM2: 8,
  footprintVariablePct: 20,
  circulationPct: 35,
  competenceThreshold: 2,
  bottleneckPct: 100,
  nearLimitPct: 85,
  utilityAmberPct: 85,
  desTolerancePct: 5,
  desBufferLimit: 25,
  contributionMarginGbp: 450,
  depreciationYears: 10,
  relocationRiggingPct: 5,
  recommissioningGbp: 15000,
  stores: {
    tiers: {
      RM: { daysCover: 10, unitsPerLocation: 40, m2PerLocation: 1.8 },
      KIT: { daysCover: 2, unitsPerLocation: 12, m2PerLocation: 2.5 },
      WIP: { daysCover: 0, unitsPerLocation: 20, m2PerLocation: 1.5 },
      FG: { daysCover: 3, unitsPerLocation: 2, m2PerLocation: 4 },
    },
    safetyZ: 1.65,
    oeeVariabilityCvPct: 15,
    conversionGbpPerMin: 1.2,
    workingDaysPerWeek: 5,
  },
  drift: { cycleTolerancePct: 5, setupTolerancePct: 10, complianceTolerancePct: 25 },
  plantSim: { shiftStarts: ['06:00', '14:00', '22:00'], breakMin: 30 },
  requireApprovalForPromotion: false,
  activeFactories: { F1: true, F2: true, F3: true, F4: true },
  interPlantKm: { 'F1-F2': 3.5, 'F1-F3': 12, 'F1-F4': 6, 'F2-F3': 9, 'F2-F4': 4.5, 'F3-F4': 8 },
  flow: { unitsPerPallet: 20, handlingMinPerMove: 4, internalSpeedKmh: 5, truckSpeedKmh: 40, palletsPerTruck: 22, truckHandlingMinPerPallet: 3, autoGridAisleM: 4 },
  sharedWc: { feederThreshold: 3, utilisationRiskPct: 75 },
  interPlantCostPerTruckGbp: 180,
  interPlantTransitDays: 1.0,
  milkRunsPerWeek: 5,
};

/** Factories switched on in the Dictionary (Active Factory Switch). Always returns at least one plant. */
export function activeFactoryList(settings: Dictionary): FactoryId[] {
  const on = FACTORIES.filter((f) => settings.activeFactories?.[f] !== false);
  return on.length ? on : [...FACTORIES];
}

/** True when a factory is active (missing setting → active). */
export const isFactoryActive = (settings: Dictionary, f: FactoryId) => activeFactoryList(settings).includes(f);

/** Inter-plant road distance (km), symmetric; 0 within a plant. */
export function interPlantKm(settings: Dictionary, a: FactoryId, b: FactoryId): number {
  if (a === b) return 0;
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  return Math.max(0, settings.interPlantKm?.[k] ?? 0);
}

export const COMPLEXITY_CLASSES: ComplexityClass[] = ['A', 'B', 'C', 'D', 'E'];

export const ZERO_SERVICES: ServiceVector = {
  electricalKw: 0,
  airLpm: 0,
  extractionM3h: 0,
  craneTonnes: 0,
  coolantLpm: 0,
};

export const SERVICE_KEYS: (keyof ServiceVector)[] = ['electricalKw', 'airLpm', 'extractionM3h', 'craneTonnes', 'coolantLpm'];

export const SERVICE_LABELS: Record<keyof ServiceVector, string> = {
  electricalKw: 'Electrical (kW)',
  airLpm: 'Compressed Air (L/min)',
  extractionM3h: 'Extraction (m³/hr)',
  craneTonnes: 'Crane (Tonnes)',
  coolantLpm: 'Coolant/Water (L/min)',
};

/**
 * Add two service vectors. Crane tonnage is a rating, so it takes the maximum rather than a sum.
 */
export function addServices(a: ServiceVector, b: Partial<ServiceVector>, qty = 1): ServiceVector {
  return {
    electricalKw: a.electricalKw + (b.electricalKw ?? 0) * qty,
    airLpm: a.airLpm + (b.airLpm ?? 0) * qty,
    extractionM3h: a.extractionM3h + (b.extractionM3h ?? 0) * qty,
    craneTonnes: Math.max(a.craneTonnes, b.craneTonnes ?? 0),
    coolantLpm: a.coolantLpm + (b.coolantLpm ?? 0) * qty,
  };
}
