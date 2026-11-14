import type { ComplexityClass, Dictionary, ServiceVector } from './types';

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
};

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
