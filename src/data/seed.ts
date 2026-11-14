/**
 * Realistic multi-factory baseline (F1–F4, 47 cells) built deterministically so every workspace,
 * chart and export works out of the box. Includes the ingested `CELL-A` CNC Cell 01 baseline passport.
 */
import { explodeBom } from '../engine/bom';
import { sampleDesResults } from '../engine/des';
import { computeModel } from '../engine/model';
import { autoMatch } from '../engine/mapping';
import { DEFAULT_DICTIONARY, SERVICE_KEYS, addServices, ZERO_SERVICES } from '../engine/settings';
import type {
  Asset,
  BomLine,
  CellPassport,
  ComplexityClass,
  Competence,
  FactoryId,
  FactoryUtilities,
  Fixture,
  HubState,
  MicroOp,
  PassportOperator,
  PassportRoute,
  ScheduleLine,
  ServiceVector,
  SkillRole,
  VaType,
} from '../engine/types';

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface AssetType extends ServiceVector {
  code: string;
  category: string;
  fp: number;
  oee: number;
  capex: number;
  install: number;
  cx: ComplexityClass;
  skill: string;
}

const AT = (code: string, category: string, fp: number, oee: number, capex: number, install: number, kw: number, air: number, ext: number, crane: number, cool: number, cx: ComplexityClass, skill: string): AssetType => ({
  code, category, fp, oee, capex, install, electricalKw: kw, airLpm: air, extractionM3h: ext, craneTonnes: crane, coolantLpm: cool, cx, skill,
});

export const ASSET_TYPES: Record<string, AssetType> = {
  VMC5: AT('VMC5', '5-Axis Machining Centre', 28, 78, 420000, 35000, 45, 400, 0, 1, 60, 'B', 'SK-CNC'),
  VMC3: AT('VMC3', '3-Axis Machining Centre', 18, 82, 180000, 15000, 25, 250, 0, 0.5, 40, 'C', 'SK-CNC'),
  LATHE: AT('LATHE', 'CNC Turning Centre', 14, 83, 210000, 15000, 30, 200, 0, 0.5, 40, 'C', 'SK-CNC'),
  GRIND: AT('GRIND', 'CNC Cylindrical Grinder', 16, 75, 350000, 25000, 22, 150, 600, 0.5, 80, 'A', 'SK-CNC'),
  CMM: AT('CMM', 'Co-ordinate Measuring Machine', 12, 90, 160000, 10000, 5, 100, 0, 0, 0, 'B', 'SK-CMM'),
  WASH: AT('WASH', 'Aqueous Parts Washer', 10, 92, 65000, 8000, 18, 50, 800, 0, 30, 'E', 'SK-GEN'),
  DEBURR: AT('DEBURR', 'Deburr Bench (LEV)', 6, 88, 12000, 1500, 2, 300, 1200, 0, 0, 'E', 'SK-GEN'),
  LASER: AT('LASER', 'Fibre Laser Cutter', 40, 80, 380000, 30000, 60, 600, 3000, 0, 20, 'B', 'SK-FAB'),
  BRAKE: AT('BRAKE', 'CNC Press Brake', 20, 82, 150000, 12000, 22, 0, 0, 2, 0, 'C', 'SK-FAB'),
  RWELD: AT('RWELD', 'Robotic Weld Cell', 35, 76, 290000, 30000, 55, 200, 4000, 3, 15, 'B', 'SK-WELD'),
  MWELD: AT('MWELD', 'Manual Weld Bay', 16, 70, 25000, 5000, 20, 100, 2500, 1, 0, 'D', 'SK-WELD'),
  FABT: AT('FABT', 'Fabrication Table & Jig', 12, 85, 15000, 2000, 3, 150, 500, 2, 0, 'D', 'SK-FAB'),
  SHOT: AT('SHOT', 'Shot Blast Cabinet', 22, 80, 120000, 15000, 30, 2500, 6000, 1, 0, 'D', 'SK-FIN'),
  PAINT: AT('PAINT', 'Spray Paint Booth', 60, 72, 240000, 40000, 40, 1500, 20000, 2, 0, 'C', 'SK-FIN'),
  OVEN: AT('OVEN', 'Curing Oven', 45, 85, 180000, 25000, 120, 0, 3000, 2, 0, 'D', 'SK-FIN'),
  ANOD: AT('ANOD', 'Anodise Tank Line', 80, 78, 520000, 60000, 150, 300, 12000, 2, 200, 'B', 'SK-CHEM'),
  PASS: AT('PASS', 'Passivation Tank Line', 50, 80, 260000, 30000, 60, 200, 6000, 1, 120, 'C', 'SK-CHEM'),
  ASSY: AT('ASSY', 'Assembly Station', 12, 88, 18000, 2000, 3, 200, 0, 0.5, 0, 'D', 'SK-ASSY'),
  TORQ: AT('TORQ', 'DC Torque Station', 6, 90, 45000, 3000, 2, 100, 0, 0, 0, 'C', 'SK-ASSY'),
  LEAK: AT('LEAK', 'Leak Test Station', 8, 90, 70000, 5000, 4, 300, 0, 0, 0, 'B', 'SK-TEST'),
  TEST: AT('TEST', 'End-of-Line Test Rig', 20, 85, 260000, 20000, 35, 400, 0, 1, 40, 'A', 'SK-TEST'),
};

export const SEED_SKILLS: SkillRole[] = [
  { roleId: 'R-MCH', skillId: 'SK-CNC', description: 'CNC Machinist', hourlyRateGbp: 24.5 },
  { roleId: 'R-INS', skillId: 'SK-CMM', description: 'Quality Inspector (CMM)', hourlyRateGbp: 26 },
  { roleId: 'R-GEN', skillId: 'SK-GEN', description: 'General Operative', hourlyRateGbp: 19 },
  { roleId: 'R-FAB', skillId: 'SK-FAB', description: 'Sheet Metal Fabricator', hourlyRateGbp: 23 },
  { roleId: 'R-WLD', skillId: 'SK-WELD', description: 'Coded Welder', hourlyRateGbp: 27 },
  { roleId: 'R-SFT', skillId: 'SK-FIN', description: 'Surface Finishing Operative', hourlyRateGbp: 21 },
  { roleId: 'R-CHM', skillId: 'SK-CHEM', description: 'Process Chemistry Technician', hourlyRateGbp: 25 },
  { roleId: 'R-FIT', skillId: 'SK-ASSY', description: 'Mechanical Fitter', hourlyRateGbp: 23.5 },
  { roleId: 'R-TST', skillId: 'SK-TEST', description: 'Test Technician', hourlyRateGbp: 27.5 },
];
const ROLE_FOR_SKILL: Record<string, string> = Object.fromEntries(SEED_SKILLS.map((s) => [s.skillId, s.roleId]));

// ---------------------------------------------------------------- BOM & Master Schedule
interface ProgrammeDef {
  code: string;
  name: string;
  l1: string;
  modules: [string, string, string]; // variant-specific A, variant-specific B? no: [module A (variant-specific), module B (shared), unused]
  l4Names: string[];
  rawMaterials: string[];
}

const L5_POOL: Record<string, string> = {
  'RM-AL6082-BAR': 'Aluminium 6082-T6 Bar',
  'RM-S355-PLATE': 'S355 Structural Steel Plate',
  'RM-EN24T-BAR': 'EN24T Alloy Steel Bar',
  'RM-SS316-BAR': 'Stainless 316 Bar',
  'RM-GJL250-CAST': 'Grey Iron Casting Blank GJL-250',
  'RM-S275-RHS': 'S275 Rectangular Hollow Section',
  'BO-BRG-6205': 'Bearing 6205-2RS (Bought-Out)',
  'BO-SEAL-KIT': 'Seal Kit (Bought-Out)',
  'BO-FAST-M12': 'Fastener Kit M12 Grade 8.8 (Bought-Out)',
  'BO-ORING-VITON': 'O-Ring Set Viton (Bought-Out)',
};

const PROGRAMMES: ProgrammeDef[] = [
  { code: 'ATL', name: 'ATLAS', l1: 'Electro-Mechanical Actuator', modules: ['Drive Module', 'Housing Module', ''], l4Names: ['Output Shaft', 'Ball-Screw Nut Housing', 'Motor Flange', 'Gear Blank', 'End Cap', 'Trunnion Mount', 'Bearing Housing', 'Rod End'], rawMaterials: ['RM-EN24T-BAR', 'RM-AL6082-BAR', 'BO-BRG-6205', 'BO-FAST-M12', 'BO-SEAL-KIT'] },
  { code: 'BOR', name: 'BOREAS', l1: 'Hydraulic Pump Skid', modules: ['Pump Module', 'Manifold Module', ''], l4Names: ['Valve Block', 'Pump Shaft', 'Port Plate', 'Piston', 'Manifold Body', 'Adaptor Flange', 'Cover Plate', 'Spool'], rawMaterials: ['RM-SS316-BAR', 'RM-AL6082-BAR', 'BO-ORING-VITON', 'BO-FAST-M12', 'RM-S355-PLATE'] },
  { code: 'CIR', name: 'CIRRUS', l1: 'Industrial Gearbox', modules: ['Input Stage', 'Output Stage', ''], l4Names: ['Input Pinion', 'Gear Case Half', 'Planet Carrier', 'Output Spindle', 'Bearing Cap', 'Coupling Hub', 'Spacer Sleeve', 'Inspection Cover'], rawMaterials: ['RM-GJL250-CAST', 'RM-EN24T-BAR', 'BO-BRG-6205', 'BO-SEAL-KIT', 'RM-S275-RHS'] },
];

const VARIANTS = ['100', '200'];

/** Build the 5-level BOM: per Programme two L1 Variants sharing a common L2 module. */
export function buildSeedBom(): { bom: BomLine[]; schedule: ScheduleLine[] } {
  const rng = mulberry32(7);
  const bom: BomLine[] = [];
  let n = 0;
  const id = () => `BL-${String(++n).padStart(4, '0')}`;
  for (const p of PROGRAMMES) {
    for (const v of VARIANTS) {
      const l1Id = `${p.code}-${v}`;
      const l1 = id();
      bom.push({ lineId: l1, parentLineId: null, partId: l1Id, description: `${p.name} ${p.l1} ${v}`, level: 1, programme: p.name, qtyPer: 1, scrapPct: 0.5, leadTimeDays: 5, makeBuy: 'Make', uom: 'EA' });
      p.modules.slice(0, 2).forEach((mod, mi) => {
        const shared = mi === 1;
        const modCode = mod.split(' ').map((w) => w[0]).join('');
        const l2Part = shared ? `${p.code}-${modCode}` : `${p.code}-${v}-${modCode}`;
        const l2 = id();
        bom.push({ lineId: l2, parentLineId: l1, partId: l2Part, description: `${p.name} ${mod}${shared ? ' (Common)' : ` ${v}`}`, level: 2, programme: p.name, qtyPer: 1, scrapPct: 1, leadTimeDays: 4 + Math.round(rng() * 4), makeBuy: 'Make', uom: 'EA' });
        (['W', 'C'] as const).forEach((kind, ki) => {
          const l3Part = `${l2Part}-${kind}`;
          const l3 = id();
          bom.push({ lineId: l3, parentLineId: l2, partId: l3Part, description: `${mod} ${kind === 'W' ? 'Weldment' : 'Coated Frame'}`, level: 3, programme: p.name, qtyPer: 1, scrapPct: kind === 'W' ? 2 : 1.5, leadTimeDays: 6 + Math.round(rng() * 8), makeBuy: 'Make', uom: 'EA' });
          for (let k = 0; k < 2; k++) {
            const nameIdx = mi * 4 + ki * 2 + k;
            const l4Part = `${l3Part}-${String(k + 1).padStart(2, '0')}`;
            const l4 = id();
            const qty = nameIdx % 3 === 0 ? 2 : 1;
            bom.push({ lineId: l4, parentLineId: l3, partId: l4Part, description: p.l4Names[nameIdx], level: 4, programme: p.name, qtyPer: qty, scrapPct: 2 + Math.round(rng() * 30) / 10, leadTimeDays: 8 + Math.round(rng() * 12), makeBuy: 'Make', uom: 'EA' });
            const rm = p.rawMaterials[(nameIdx + k) % 3 === 2 ? 4 : nameIdx % 2];
            bom.push({ lineId: id(), parentLineId: l4, partId: rm, description: L5_POOL[rm], level: 5, programme: p.name, qtyPer: rm.startsWith('RM') ? Math.round((0.6 + rng() * 2.4) * 10) / 10 : 1, scrapPct: rm.startsWith('RM') ? 5 : 0.5, leadTimeDays: rm.startsWith('RM') ? 21 + Math.round(rng() * 35) : 10 + Math.round(rng() * 20), makeBuy: 'Buy', uom: rm.startsWith('RM') ? 'KG' : 'EA' });
            if (nameIdx % 2 === 1) {
              const bo = p.rawMaterials[2 + (nameIdx % 2)];
              bom.push({ lineId: id(), parentLineId: l4, partId: bo, description: L5_POOL[bo], level: 5, programme: p.name, qtyPer: 1 + (nameIdx % 3), scrapPct: 0.5, leadTimeDays: 14 + Math.round(rng() * 21), makeBuy: 'Buy', uom: 'EA' });
            }
          }
        });
      });
    }
  }
  const schedule: ScheduleLine[] = [
    { partId: 'ATL-100', programme: 'ATLAS', annualVolume: 2200, quarterSplitPct: [25, 25, 25, 25], launchOverrides: {} },
    { partId: 'ATL-200', programme: 'ATLAS', annualVolume: 1100, quarterSplitPct: [20, 25, 30, 25], launchOverrides: {} },
    { partId: 'BOR-100', programme: 'BOREAS', annualVolume: 1600, quarterSplitPct: [25, 25, 25, 25], launchOverrides: {} },
    { partId: 'BOR-200', programme: 'BOREAS', annualVolume: 800, quarterSplitPct: [30, 25, 20, 25], launchOverrides: {} },
    { partId: 'CIR-100', programme: 'CIRRUS', annualVolume: 2600, quarterSplitPct: [22, 26, 26, 26], launchOverrides: {} },
    { partId: 'CIR-200', programme: 'CIRRUS', annualVolume: 1400, quarterSplitPct: [25, 25, 25, 25], launchOverrides: { Q1: 120, Q2: 260 } },
  ];
  return { bom, schedule };
}

// ---------------------------------------------------------------- Cells
interface CellDef {
  cellId: string;
  cellName: string;
  factory: FactoryId;
  /** [asset type code, qty]; first entry is the primary (pacing) asset. */
  assets: [string, number][];
  targetUtil: number;
  shifts: number;
  flavour: 'cnc' | 'fab' | 'weld' | 'fin' | 'chem' | 'assy' | 'test';
  labourBound?: boolean;
  toolingBound?: boolean;
}

const F1_NAMES = ['CNC Cell 01', 'CNC Cell 02', 'CNC Cell 03', 'CNC Cell 04', 'CNC Cell 05', 'CNC Cell 06', 'CNC Cell 07', 'CNC Cell 08', 'Turning Cell 01', 'Turning Cell 02', 'Grinding Cell 01', 'Grinding Cell 02'];
const F1_UTIL = [0.83, 0.72, 1.12, 0.66, 0.79, 0.74, 0.58, 0.91, 0.69, 0.81, 0.88, 0.52];

export function cellDefinitions(): CellDef[] {
  const defs: CellDef[] = [];
  F1_NAMES.forEach((name, i) => {
    const letter = String.fromCharCode(65 + i);
    const primary = i < 4 ? 'VMC5' : i < 8 ? 'VMC3' : i < 10 ? 'LATHE' : 'GRIND';
    defs.push({
      cellId: `CELL-${letter}`,
      cellName: name,
      factory: 'F1',
      assets: i === 0
        ? [['VMC5', 2], ['CMM', 1], ['DEBURR', 1], ['WASH', 1]]
        : [[primary, i % 3 === 2 ? 3 : 2], ['CMM', 1], ['DEBURR', 1], ...(i % 2 ? [['WASH', 1] as [string, number]] : [])],
      targetUtil: F1_UTIL[i],
      shifts: i === 10 ? 3 : 2,
      flavour: 'cnc',
      toolingBound: letter === 'F',
      labourBound: letter === 'H',
    });
  });
  const f2: [string, [string, number][], 'fab' | 'weld', number][] = [
    ['Robotic Weld Cell 01', [['RWELD', 2], ['FABT', 1]], 'weld', 0.77],
    ['Robotic Weld Cell 02', [['RWELD', 2], ['FABT', 1]], 'weld', 1.06],
    ['Robotic Weld Cell 03', [['RWELD', 1], ['FABT', 1]], 'weld', 0.84],
    ['Manual Weld Cell 01', [['MWELD', 3], ['FABT', 2]], 'weld', 0.71],
    ['Manual Weld Cell 02', [['MWELD', 3], ['FABT', 2]], 'weld', 0.63],
    ['Manual Weld Cell 03', [['MWELD', 2], ['FABT', 1]], 'weld', 0.9],
    ['Laser Profiling Cell 01', [['LASER', 1], ['DEBURR', 1]], 'fab', 0.68],
    ['Laser Profiling Cell 02', [['LASER', 1], ['DEBURR', 1]], 'fab', 0.55],
    ['Press Brake Cell 01', [['BRAKE', 2], ['FABT', 1]], 'fab', 0.74],
    ['Press Brake Cell 02', [['BRAKE', 1], ['FABT', 1]], 'fab', 0.61],
    ['Bracket Fabrication Cell', [['FABT', 3], ['MWELD', 1]], 'fab', 0.7],
    ['Heavy Fabrication Cell', [['FABT', 2], ['MWELD', 2]], 'fab', 0.48],
  ];
  f2.forEach(([name, assets, flavour, u], i) =>
    defs.push({ cellId: `F2-C${String(i + 1).padStart(2, '0')}`, cellName: name, factory: 'F2', assets, targetUtil: u, shifts: 2, flavour }),
  );
  const f3: [string, [string, number][], 'fin' | 'chem', number][] = [
    ['Shot Blast Cell 01', [['SHOT', 1], ['WASH', 1]], 'fin', 0.73],
    ['Shot Blast Cell 02', [['SHOT', 1], ['WASH', 1]], 'fin', 0.66],
    ['Paint Line 01', [['PAINT', 2], ['OVEN', 1]], 'fin', 0.8],
    ['Paint Line 02', [['PAINT', 1], ['OVEN', 1]], 'fin', 1.18],
    ['Paint Line 03', [['PAINT', 1], ['OVEN', 1]], 'fin', 0.57],
    ['Anodise Cell 01', [['ANOD', 1], ['WASH', 1]], 'chem', 0.69],
    ['Passivation Cell 01', [['PASS', 1], ['WASH', 1]], 'chem', 0.62],
    ['Powder Coat Cell 01', [['PAINT', 1], ['OVEN', 1]], 'fin', 0.87],
    ['Anodise Cell 02', [['ANOD', 1], ['WASH', 1]], 'chem', 0.51],
    ['Passivation Cell 02', [['PASS', 1], ['WASH', 1]], 'chem', 0.45],
    ['Wet Paint Touch-Up Cell', [['PAINT', 1]], 'fin', 0.4],
  ];
  f3.forEach(([name, assets, flavour, u], i) =>
    defs.push({ cellId: `F3-C${String(i + 1).padStart(2, '0')}`, cellName: name, factory: 'F3', assets, targetUtil: u, shifts: i === 3 ? 3 : 2, flavour }),
  );
  for (let i = 0; i < 12; i++) {
    const test = i >= 8;
    defs.push({
      cellId: `F4-C${String(i + 1).padStart(2, '0')}`,
      cellName: test ? `Test Cell ${String(i - 7).padStart(2, '0')}` : `Assembly Cell ${String(i + 1).padStart(2, '0')}`,
      factory: 'F4',
      assets: test ? [['TEST', 2], ['LEAK', 1]] : [['ASSY', 3], ['TORQ', 1], ['LEAK', 1]],
      targetUtil: test ? [0.82, 1.04, 0.74, 0.6][i - 8] : [0.71, 0.86, 0.79, 0.64, 0.75, 0.58, 0.67, 0.6][i],
      shifts: 2,
      flavour: test ? 'test' : 'assy',
      labourBound: i === 2,
    });
  }
  return defs;
}

interface OpTpl {
  desc: string;
  asset?: string; // type code
  role: 'primary' | 'secondary' | 'manual';
  va: VaType;
  skill?: string;
  optional?: boolean;
}

const TEMPLATES: Record<CellDef['flavour'], OpTpl[]> = {
  cnc: [
    { desc: 'Kit & stage material', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
    { desc: 'Load & clamp in fixture', role: 'manual', va: 'NVA', skill: 'SK-CNC' },
    { desc: 'OP10 Rough machine datum faces', role: 'primary', va: 'VA' },
    { desc: 'OP20 Semi-finish profile', role: 'primary', va: 'VA' },
    { desc: 'In-process probing', role: 'primary', va: 'ENVA', optional: true },
    { desc: 'OP30 Finish machine bores', role: 'primary', va: 'VA' },
    { desc: 'OP40 Drill & tap', role: 'primary', va: 'VA', optional: true },
    { desc: 'Tool change & offset check', role: 'primary', va: 'NVA', optional: true },
    { desc: 'Unload & blow-off', role: 'manual', va: 'NVA', skill: 'SK-CNC' },
    { desc: 'Manual deburr', asset: 'DEBURR', role: 'secondary', va: 'VA' },
    { desc: 'Aqueous wash', asset: 'WASH', role: 'secondary', va: 'ENVA', optional: true },
    { desc: 'CMM first-off / sample inspection', asset: 'CMM', role: 'secondary', va: 'ENVA' },
    { desc: 'Visual inspection & paperwork', role: 'manual', va: 'ENVA', skill: 'SK-CMM' },
    { desc: 'Mark, bag & tag', role: 'manual', va: 'NVA', skill: 'SK-GEN', optional: true },
    { desc: 'Move to despatch buffer', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
  fab: [
    { desc: 'Retrieve sheet / section', role: 'manual', va: 'NVA', skill: 'SK-FAB' },
    { desc: 'Profile / form', role: 'primary', va: 'VA' },
    { desc: 'Secondary form', role: 'primary', va: 'VA', optional: true },
    { desc: 'Edge deburr / dress', asset: 'DEBURR', role: 'secondary', va: 'VA', optional: true },
    { desc: 'Tack & square on table', asset: 'FABT', role: 'secondary', va: 'VA', optional: true },
    { desc: 'Weld brackets', asset: 'MWELD', role: 'secondary', va: 'VA', optional: true },
    { desc: 'Dimensional check', role: 'manual', va: 'ENVA', skill: 'SK-FAB' },
    { desc: 'Stillage & move to buffer', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
  weld: [
    { desc: 'Kit components to jig', role: 'manual', va: 'NVA', skill: 'SK-WELD' },
    { desc: 'Tack weld in jig', asset: 'FABT', role: 'secondary', va: 'VA' },
    { desc: 'Weld sequence A', role: 'primary', va: 'VA' },
    { desc: 'Weld sequence B', role: 'primary', va: 'VA' },
    { desc: 'Flip & re-clamp', role: 'primary', va: 'NVA', optional: true },
    { desc: 'Weld sequence C', role: 'primary', va: 'VA', optional: true },
    { desc: 'Cool-down dwell', role: 'primary', va: 'NVA', optional: true },
    { desc: 'Spatter clean & dress', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
    { desc: 'Visual weld inspection', role: 'manual', va: 'ENVA', skill: 'SK-WELD' },
    { desc: 'Dimensional check on table', asset: 'FABT', role: 'secondary', va: 'ENVA' },
    { desc: 'Move to despatch buffer', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
  fin: [
    { desc: 'Receive & jig hang', role: 'manual', va: 'NVA', skill: 'SK-FIN' },
    { desc: 'Pre-treatment wash', asset: 'WASH', role: 'secondary', va: 'ENVA', optional: true },
    { desc: 'Mask features', role: 'manual', va: 'NVA', skill: 'SK-FIN' },
    { desc: 'Primary process', role: 'primary', va: 'VA' },
    { desc: 'Second coat / pass', role: 'primary', va: 'VA', optional: true },
    { desc: 'Cure / flash-off', asset: 'OVEN', role: 'secondary', va: 'ENVA', optional: true },
    { desc: 'De-mask', role: 'manual', va: 'NVA', skill: 'SK-FIN' },
    { desc: 'DFT & adhesion check', role: 'manual', va: 'ENVA', skill: 'SK-FIN' },
    { desc: 'Pack & despatch to F4', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
  chem: [
    { desc: 'Receive & rack parts', role: 'manual', va: 'NVA', skill: 'SK-CHEM' },
    { desc: 'Degrease', asset: 'WASH', role: 'secondary', va: 'ENVA' },
    { desc: 'Etch / pickle', role: 'primary', va: 'VA' },
    { desc: 'Rinse', role: 'primary', va: 'ENVA', optional: true },
    { desc: 'Primary bath', role: 'primary', va: 'VA' },
    { desc: 'Seal', role: 'primary', va: 'VA', optional: true },
    { desc: 'Bath titration check', role: 'manual', va: 'ENVA', skill: 'SK-CHEM' },
    { desc: 'Unrack & inspect', role: 'manual', va: 'ENVA', skill: 'SK-CHEM' },
    { desc: 'Pack & despatch to F4', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
  assy: [
    { desc: 'Kit parts to station', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
    { desc: 'Sub-assemble bearings & seals', role: 'primary', va: 'VA' },
    { desc: 'Fit main components', role: 'primary', va: 'VA' },
    { desc: 'Fit fasteners', role: 'primary', va: 'VA', optional: true },
    { desc: 'Torque critical joints', asset: 'TORQ', role: 'secondary', va: 'VA' },
    { desc: 'Witness mark & record', role: 'manual', va: 'ENVA', skill: 'SK-ASSY' },
    { desc: 'Leak test', asset: 'LEAK', role: 'secondary', va: 'ENVA', optional: true },
    { desc: 'Final visual & label', role: 'manual', va: 'ENVA', skill: 'SK-ASSY' },
    { desc: 'Transfer to test', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
  test: [
    { desc: 'Load unit to rig', role: 'manual', va: 'NVA', skill: 'SK-TEST' },
    { desc: 'Connect services', role: 'manual', va: 'NVA', skill: 'SK-TEST' },
    { desc: 'Functional run-in', role: 'primary', va: 'VA' },
    { desc: 'Performance test', role: 'primary', va: 'VA' },
    { desc: 'Endurance soak', role: 'primary', va: 'ENVA', optional: true },
    { desc: 'Leak / proof test', asset: 'LEAK', role: 'secondary', va: 'ENVA' },
    { desc: 'Certificate of conformity', role: 'manual', va: 'ENVA', skill: 'SK-TEST' },
    { desc: 'Pack for despatch', role: 'manual', va: 'NVA', skill: 'SK-GEN' },
  ],
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Generate the full seeded HubState (F1–F4 baseline).
 */
export function buildSeedState(): HubState {
  const settings = { ...DEFAULT_DICTIONARY, complexityPct: { ...DEFAULT_DICTIONARY.complexityPct } };
  const { bom, schedule } = buildSeedBom();
  const explosion = explodeBom(bom, schedule);
  const rng = mulberry32(2024);
  const defs = cellDefinitions();

  // ---- Assign BOM Make parts to cells (variantId = partId so first-upload auto-match works)
  const parts = [...explosion.demandByPart.entries()].filter(([, d]) => d.makeBuy === 'Make');
  const L = (lvl: number) => parts.filter(([, d]) => d.level === lvl).map(([p]) => p);
  const assign = new Map<string, string[]>();
  const push = (cell: string, part: string) => assign.set(cell, [...(assign.get(cell) ?? []), part]);
  L(1).forEach((p, i) => push(`F4-C${String(9 + (i % 4)).padStart(2, '0')}`, p));
  L(2).forEach((p, i) => (i === 8 ? null : push(`F4-C${String(1 + (i % 8)).padStart(2, '0')}`, p))); // one L2 left unmapped
  const l3 = L(3);
  l3.filter((p) => p.endsWith('-W')).forEach((p, i) => push(`F2-C${String(1 + (i % 6)).padStart(2, '0')}`, p));
  l3.filter((p) => p.endsWith('-C')).forEach((p, i) => push(`F3-C${String(1 + (i % 9)).padStart(2, '0')}`, p));
  const l4 = L(4);
  let f1n = 0;
  let f2n = 0;
  l4.forEach((p, i) => {
    if (i === 17) return; // one L4 left unmapped for the audit
    if (i % 6 === 5) push(`F2-C${String(7 + (f2n++ % 6)).padStart(2, '0')}`, p);
    else if (i === 10 || i === 22) push(i === 10 ? 'F3-C10' : 'F3-C11', p);
    else push(`CELL-${String.fromCharCode(65 + (f1n++ % 12))}`, p);
  });
  // CELL-A pair-up: keep its baseline compact (3 housings) — already round-robin.

  const passports: CellPassport[] = [];
  const masterAssets: Asset[] = [];
  const masterFixtures: Fixture[] = [];
  const orphanCells = new Set(['CELL-K', 'F2-C12', 'F3-C05', 'F4-C06', 'CELL-D']);

  for (const def of defs) {
    const shiftPattern = { shiftsPerDay: def.shifts, hoursPerShift: 7.5, daysPerWeek: 5 };
    const avail = def.shifts * 7.5 * 60 * 5 * settings.weeksPerYear;
    const assetIds: Record<string, string> = {};
    const passportAssets = def.assets.map(([code, qty], k) => {
      const t = ASSET_TYPES[code];
      const assetId = `${def.cellId}-${code}-${String(k + 1).padStart(2, '0')}`;
      assetIds[code] = assetId;
      masterAssets.push({
        assetId,
        description: `${t.category}${qty > 1 ? ` ×${qty}` : ''}`,
        factory: def.factory,
        cellId: def.cellId,
        category: t.category,
        complexityClass: t.cx,
        shiftTier: Math.min(3, def.shifts) as 1 | 2 | 3,
        footprintM2: t.fp,
        oeePct: Math.round(t.oee + (rng() - 0.5) * 6),
        capexGbp: Math.round(t.capex * (0.9 + rng() * 0.2) / 1000) * 1000,
        installGbp: t.install,
        electricalKw: t.electricalKw,
        airLpm: t.airLpm,
        extractionM3h: t.extractionM3h,
        craneTonnes: t.craneTonnes,
        coolantLpm: t.coolantLpm,
      });
      return { assetId, qty };
    });
    const primaryCode = def.assets[0][0];
    const primary = masterAssets.find((a) => a.assetId === assetIds[primaryCode])!;
    const primaryQty = def.assets[0][1];
    const tpl = TEMPLATES[def.flavour];
    const routesParts = assign.get(def.cellId) ?? [];
    const demands = routesParts.map((p) => explosion.demandByPart.get(p)!.annual);
    const weights = routesParts.map(() => 0.75 + rng() * 0.5);
    const sumDW = demands.reduce((s, d, i) => s + d * weights[i], 0);
    const capPrimary = def.targetUtil * primaryQty * avail * (primary.oeePct / 100);
    const K = sumDW > 0 ? capPrimary / sumDW : 30;
    const batch = def.flavour === 'cnc' ? 20 : def.flavour === 'fin' || def.flavour === 'chem' ? 24 : 6;

    const fixtures: CellPassport['fixtures'] = [];
    const makeRoute = (partId: string | null, idx: number, loadPerUnit: number): PassportRoute => {
      const ops: MicroOp[] = [];
      const chosen = tpl.filter((o) => !o.optional || rng() < 0.65);
      const primaries = chosen.filter((o) => o.role === 'primary');
      const setupPerOp = def.flavour === 'cnc' ? 25 + Math.round(rng() * 35) : def.flavour === 'test' || def.flavour === 'assy' ? 5 : 15 + Math.round(rng() * 15);
      const setupLoad = (setupPerOp * primaries.length) / batch;
      const cycleBudget = Math.max(loadPerUnit - setupLoad, loadPerUnit * 0.5);
      const shares = primaries.map(() => 0.6 + rng());
      const shareSum = shares.reduce((a, b) => a + b, 0);
      let toolingId: string | undefined;
      if (def.flavour === 'cnc' || def.flavour === 'weld') {
        toolingId = `FX-${partId ?? `${def.cellId}-SPARE${idx}`}`;
        const qty = def.toolingBound && idx === 0 ? 1 : primaryQty;
        const dwell = def.toolingBound && idx === 0 ? 75 : 80 + Math.round(rng() * 10);
        const cost = Math.round((4 + rng() * 11) * 1000);
        masterFixtures.push({ toolingId, description: `${def.flavour === 'cnc' ? 'Machining fixture' : 'Weld jig'} — ${partId ?? 'spare'}`, linkedAsset: primary.assetId, qty, maxDwellPct: dwell, costGbp: cost });
        fixtures.push({ toolingId, qty });
      }
      let pi = 0;
      chosen.forEach((o, j) => {
        let cycle: number;
        let assetId: string | undefined;
        let labourMin: number | undefined;
        let skill = o.skill;
        let setup = 0;
        let tool: string | undefined;
        if (o.role === 'primary') {
          cycle = (cycleBudget * shares[pi++]) / shareSum;
          assetId = primary.assetId;
          setup = setupPerOp;
          skill = ASSET_TYPES[primaryCode].skill;
          labourMin = def.flavour === 'assy' || def.flavour === 'weld' && primaryCode === 'MWELD' ? cycle : cycle * (0.2 + rng() * 0.15);
          if (primaryCode === 'FABT') labourMin = cycle;
          tool = toolingId;
        } else if (o.role === 'secondary' && o.asset && assetIds[o.asset]) {
          const t = ASSET_TYPES[o.asset];
          const qty = def.assets.find(([c]) => c === o.asset)![1];
          cycle = loadPerUnit * (0.12 + rng() * 0.25) * (qty / primaryQty) * Math.min(1, t.oee / primary.oeePct);
          assetId = assetIds[o.asset];
          skill = t.skill;
          labourMin = cycle * (o.asset === 'FABT' || o.asset === 'DEBURR' || o.asset === 'MWELD' ? 1 : 0.4);
          setup = 5;
        } else if (o.role === 'secondary') {
          return; // asset type not present in this cell
        } else {
          cycle = 1 + rng() * Math.min(6, loadPerUnit * 0.08);
          labourMin = cycle;
        }
        ops.push({ opNo: (j + 1) * 10, description: o.desc, assetId, setupMin: setup, cycleMin: round1(cycle), labourMin: labourMin !== undefined ? round1(labourMin) : undefined, skillId: skill, toolingId: tool, vaType: o.va });
      });
      ops.forEach((op, k) => (op.opNo = (k + 1) * 10));
      const part = partId ? explosion.demandByPart.get(partId) : undefined;
      return {
        routeId: `RT-${partId ?? `${def.cellId}-SPARE${idx}`}`,
        variantId: partId ?? `${def.cellId}-LEGACY-SPARES`,
        productFamily: partId ? partId.split('-')[0] === 'ATL' ? 'ATLAS' : partId.startsWith('BOR') ? 'BOREAS' : 'CIRRUS' : 'Service Spares',
        description: part ? part.description : 'Legacy service spares (no current BOM demand)',
        batchSize: batch,
        ops,
      };
    };
    const routes = routesParts.map((p, i) => makeRoute(p, i, K * weights[i]));
    if (orphanCells.has(def.cellId) || !routes.length) routes.push(makeRoute(null, routes.length, K));

    // ---- Crew sizing from labour load
    const skillLoad: Record<string, number> = {};
    routes.forEach((r, i) => {
      const d = demands[i] ?? 0;
      for (const op of r.ops) if (op.skillId) skillLoad[op.skillId] = (skillLoad[op.skillId] ?? 0) + d * ((op.labourMin ?? op.cycleMin) + op.setupMin / r.batchSize);
    });
    const crew: PassportOperator[] = [];
    let opN = 0;
    for (const [skill, load] of Object.entries(skillLoad)) {
      const need = load / (avail * (settings.labourAvailabilityPct / 100));
      const target = def.labourBound && skill === ASSET_TYPES[primaryCode].skill ? 1.1 : 0.62 + rng() * 0.15;
      let heads = Math.max(1, Math.ceil(need / target));
      if (def.labourBound && skill === ASSET_TYPES[primaryCode].skill) heads = Math.max(1, Math.floor(need / 1.08));
      for (let h = 0; h < heads; h++) {
        const comp: Record<string, Competence> = { [skill]: (rng() < 0.3 ? 3 : 2) as Competence };
        crew.push({ operatorId: `${def.cellId}-OP${String(++opN).padStart(2, '0')}`, name: `Operator ${def.cellId.replace('CELL-', '')}${opN}`, roleId: ROLE_FOR_SKILL[skill] ?? 'R-GEN', competence: comp });
      }
      if (rng() < 0.6) crew.push({ operatorId: `${def.cellId}-OP${String(++opN).padStart(2, '0')}`, name: `Trainee ${def.cellId.replace('CELL-', '')}${opN}`, roleId: ROLE_FOR_SKILL[skill] ?? 'R-GEN', competence: { [skill]: 1 } });
    }
    // Cross-skilling (level 1 → visible in the matrix, not counted as productive)
    const allSkills = Object.keys(skillLoad);
    for (const c of crew) for (const s of allSkills) if (c.competence[s] === undefined && rng() < 0.25) c.competence[s] = (rng() < 0.5 ? 1 : 0) as Competence;

    // ---- Service allowance (Over-Utility flags on two cells)
    let svc: ServiceVector = { ...ZERO_SERVICES };
    for (const pa of passportAssets) svc = addServices(svc, masterAssets.find((a) => a.assetId === pa.assetId)!, pa.qty);
    const allowance: Partial<ServiceVector> = {};
    for (const k of SERVICE_KEYS) allowance[k] = Math.ceil(svc[k] * (k === 'craneTonnes' ? 1 : 1.1 + rng() * 0.3));
    if (def.cellId === 'F2-C03' || def.cellId === 'F3-C02') allowance.electricalKw = Math.floor(svc.electricalKw * 0.82);
    if (def.cellId === 'F3-C02') allowance.extractionM3h = Math.floor(svc.extractionM3h * 0.9);

    const passport: CellPassport = {
      passportId: `PP-${def.cellId}`,
      schemaVersion: '1.0',
      cellId: def.cellId,
      cellName: def.cellName,
      factory: def.factory,
      revision: def.cellId === 'CELL-A' ? 3 : 1 + Math.floor(rng() * 3),
      issuedAt: new Date(Date.UTC(2026, 6 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 27))).toISOString(),
      gateStatus: 'PASSED',
      shiftPattern,
      assets: passportAssets,
      fixtures,
      crew,
      routes,
      serviceAllowance: allowance,
    };
    if (def.cellId === 'CELL-A') {
      passport.cellName = 'CNC Cell 01';
      passport.gateNotes = 'Cell Design Passport baseline — Gate 3 (Design Freeze) passed';
    }
    passports.push(passport);
  }

  // ---- Deliberate audit exceptions
  const blocked = passports.find((p) => p.cellId === 'F3-C07')!;
  for (const c of blocked.crew) for (const k of Object.keys(c.competence)) if (k === 'SK-CHEM') c.competence[k] = 1;
  const gate = passports.find((p) => p.cellId === 'F2-C11')!;
  gate.gateStatus = 'BLOCKED';
  gate.gateNotes = 'Gate 2: LEV certification for weld fume extraction outstanding';
  const cond = passports.find((p) => p.cellId === 'F4-C07')!;
  cond.gateStatus = 'CONDITIONAL';
  cond.gateNotes = 'Gate 3: torque tool calibration certificates pending';
  // An asset referenced by a passport but absent from the master catalogue → CONDITIONAL gate.
  const missing = masterAssets.findIndex((a) => a.assetId === 'F2-C10-FABT-02');
  if (missing >= 0) masterAssets.splice(missing, 1);

  // ---- Mappings via first-upload auto-match
  const uniqueParts = new Map<string, BomLine>();
  for (const b of bom) if (!uniqueParts.has(b.partId)) uniqueParts.set(b.partId, b);
  const now = '2026-11-01T09:00:00.000Z';
  const mappings = autoMatch([...uniqueParts.values()], passports, [], now);

  // ---- Factory utilities & shared plant
  const ratios: Record<FactoryId, Record<keyof ServiceVector, number>> = {
    F1: { electricalKw: 0.74, airLpm: 0.68, extractionM3h: 0.55, craneTonnes: 0.5, coolantLpm: 0.71 },
    F2: { electricalKw: 0.91, airLpm: 0.77, extractionM3h: 1.08, craneTonnes: 0.6, coolantLpm: 0.5 },
    F3: { electricalKw: 0.82, airLpm: 0.88, extractionM3h: 0.93, craneTonnes: 0.4, coolantLpm: 0.66 },
    F4: { electricalKw: 0.61, airLpm: 0.72, extractionM3h: 0.3, craneTonnes: 0.5, coolantLpm: 0.45 },
  };
  const sharedPlant: Record<FactoryId, FactoryUtilities['sharedPlant']> = {
    F1: [
      { id: 'F1-SP-COMP', description: 'Central rotary-screw compressor 110 kW', kind: 'Compressor', load: { electricalKw: 110 }, capexGbp: 95000 },
      { id: 'F1-SP-CHIL', description: 'Coolant chiller & central swarf system', kind: 'Chiller', load: { electricalKw: 45 }, capexGbp: 140000 },
      { id: 'F1-SP-SUB', description: '11 kV / 1.6 MVA substation', kind: 'Substation', load: {}, capexGbp: 380000 },
    ],
    F2: [
      { id: 'F2-SP-COMP', description: 'Compressor house 75 kW', kind: 'Compressor', load: { electricalKw: 75 }, capexGbp: 70000 },
      { id: 'F2-SP-LEV', description: 'Central weld fume extraction plant', kind: 'Extraction', load: { electricalKw: 55 }, capexGbp: 210000 },
      { id: 'F2-SP-OHC', description: '10 t overhead travelling crane', kind: 'Overhead Crane', load: { electricalKw: 18 }, capexGbp: 160000 },
      { id: 'F2-SP-SUB', description: '11 kV / 2 MVA substation', kind: 'Substation', load: {}, capexGbp: 420000 },
    ],
    F3: [
      { id: 'F3-SP-COMP', description: 'Compressor house 90 kW', kind: 'Compressor', load: { electricalKw: 90 }, capexGbp: 82000 },
      { id: 'F3-SP-ETP', description: 'Effluent treatment & DI water plant', kind: 'Other', load: { electricalKw: 40, coolantLpm: 60 }, capexGbp: 310000 },
      { id: 'F3-SP-CHIL', description: 'Process chiller for tank lines', kind: 'Chiller', load: { electricalKw: 60 }, capexGbp: 120000 },
      { id: 'F3-SP-OHC', description: '5 t overhead crane (tank line hoists)', kind: 'Overhead Crane', load: { electricalKw: 12 }, capexGbp: 95000 },
    ],
    F4: [
      { id: 'F4-SP-COMP', description: 'Compressor 45 kW', kind: 'Compressor', load: { electricalKw: 45 }, capexGbp: 48000 },
      { id: 'F4-SP-OHC', description: '5 t overhead crane (test hall)', kind: 'Overhead Crane', load: { electricalKw: 10 }, capexGbp: 110000 },
      { id: 'F4-SP-SUB', description: '11 kV / 1 MVA substation', kind: 'Substation', load: {}, capexGbp: 290000 },
    ],
  };
  const assetById = new Map(masterAssets.map((a) => [a.assetId, a]));
  const utilities: FactoryUtilities[] = (['F1', 'F2', 'F3', 'F4'] as FactoryId[]).map((f) => {
    let d: ServiceVector = { ...ZERO_SERVICES };
    for (const p of passports.filter((x) => x.factory === f))
      for (const pa of p.assets) {
        const a = assetById.get(pa.assetId) ?? masterAssets.find((x) => x.cellId === p.cellId);
        if (a) d = addServices(d, a, pa.qty);
      }
    for (const s of sharedPlant[f]) d = addServices(d, s.load);
    const capacity = { ...ZERO_SERVICES };
    for (const k of SERVICE_KEYS) {
      const raw = d[k] / ratios[f][k];
      capacity[k] = k === 'craneTonnes' ? Math.max(5, Math.ceil(raw)) : Math.ceil(raw / 10) * 10;
    }
    return { factory: f, capacity, sharedPlant: sharedPlant[f] };
  });

  const state: HubState = {
    version: 1,
    settings,
    assets: masterAssets,
    fixtures: masterFixtures,
    skills: SEED_SKILLS,
    passports,
    bom,
    schedule,
    mappings,
    utilities,
    desResults: [],
    mappingProfiles: [
      { name: 'Standard Asset Register (default)', target: 'assets', columns: { assetId: 'Asset ID', description: 'Description', factory: 'Factory', cellId: 'Cell ID', category: 'Category', complexityClass: 'Complexity Class', shiftTier: 'Shift Tier', footprintM2: 'Footprint m²', oeePct: 'OEE %', capexGbp: 'CapEx Cost £', installGbp: 'Install Cost £', electricalKw: 'Electrical kW', airLpm: 'Compressed Air L/min', extractionM3h: 'Extraction m³/hr', craneTonnes: 'Crane Tonnes', coolantLpm: 'Coolant/Water' } },
    ],
    ingestLog: [{ at: now, kind: 'passport', message: `Baseline: ingested ${passports.length} Cell Passports across F1–F4; ${mappings.length} BOM parts auto-mapped` }],
    updatedAt: now,
  };
  // Baseline DES round-trip so the validation workspace shows AGREE / DISAGREE out of the box.
  state.desResults = sampleDesResults(computeModel(state), state);
  return state;
}
