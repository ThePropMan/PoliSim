import type { Simulation } from './simulation';
import type { Beliefs, BuildingType, Vec2 } from './types';
import { householdWealth } from './stats';

/** Neighbourhood sectors: ~66-unit squares around the civic core. */
const DISTRICT_SIZE = 66;

const CARDINALS = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
const RICH_NAMES = ['Heights', 'Park', 'Terrace'];
const MID_NAMES = ['Field', 'Gate', 'Cross'];
const POOR_NAMES = ['Row', 'Bottom', 'End'];

export interface DistrictInfo {
  key: number;
  name: string;
  homes: number;
  /** Mean household wealth in the district. */
  wealth: number;
  centroid: Vec2;
  /** Adults living here. */
  adults: number;
  /** Mean adult beliefs — the district's political colour. */
  lean: Beliefs;
  /** Local opinion pull applied to residents' drift targets (industry, class, peripherality). */
  pull: Beliefs;
  /** Dominant local economy: 'agrarian' | 'industrial' | 'commerce' | 'learned' | 'clerical' | 'civic' | 'residential'. */
  dominant: string;
}

export function districtKeyOf(pos: Vec2): number {
  return (Math.floor(pos.x / DISTRICT_SIZE) + 32) * 64 + Math.floor(pos.z / DISTRICT_SIZE) + 32;
}

const ECON_CAT: Partial<Record<BuildingType, string>> = {
  farm: 'agrarian', mill: 'agrarian',
  mine: 'industrial', factory: 'industrial', workshop: 'industrial', lumber_camp: 'industrial', smithy: 'industrial', warehouse: 'industrial', yard: 'industrial',
  market: 'commerce', bank: 'commerce', tavern: 'commerce', tailor_shop: 'commerce', bakery: 'commerce',
  school: 'learned', university: 'learned', theater: 'learned', clinic: 'learned',
  temple: 'clerical',
  townhall: 'civic', plaza: 'civic', guardhouse: 'civic', prison: 'civic', monument: 'civic',
};

/** Opinion pull attached to each local economy — where you live shapes what you believe. */
const CAT_PULL: Record<string, Partial<Beliefs>> = {
  industrial: { econ: -0.07, auth: 0.02, trad: 0.02 },   // union towns lean labour
  agrarian: { econ: -0.02, auth: 0.03, trad: 0.09 },    // the countryside keeps custom
  commerce: { econ: 0.08, auth: 0, trad: -0.02 },       // market quarters like open trade
  learned: { econ: -0.02, auth: -0.05, trad: -0.09 },   // universities radicalise
  clerical: { econ: 0, auth: 0.04, trad: 0.1 },         // temple districts stay devout
  civic: { econ: 0, auth: 0.03, trad: 0 },
  residential: {},
};

/** Residential districts, recomputed at most once per day (cached per Simulation). */
const cache = new WeakMap<Simulation, { day: number; map: Map<number, DistrictInfo> }>();

export function districtMap(sim: Simulation): Map<number, DistrictInfo> {
  const s = sim.state;
  const hit = cache.get(sim);
  if (hit && hit.day === s.day) return hit.map;

  const wealth = householdWealth(sim);
  const sectors = new Map<number, { homes: number; wealth: number; x: number; z: number; econ: number; auth: number; trad: number; adults: number; cats: Map<string, number> }>();
  const sector = (pos: Vec2) => {
    const key = districtKeyOf(pos);
    const d = sectors.get(key) ?? { homes: 0, wealth: 0, x: 0, z: 0, econ: 0, auth: 0, trad: 0, adults: 0, cats: new Map() };
    sectors.set(key, d);
    return { key, d };
  };

  for (const b of s.buildings) {
    if (b.type === 'house' || b.type === 'tenement' || b.type === 'manor') {
      const { d } = sector(b.pos);
      d.homes++;
      const w = b.residents.reduce((t, id) => t + (wealth.get(id) ?? 0), 0) / Math.max(1, b.residents.length);
      d.wealth += w;
      d.x += b.pos.x; d.z += b.pos.z;
      for (const hid of b.residents) {
        const hh = sim.household(hid);
        for (const aid of hh?.members ?? []) {
          const a = sim.agent(aid);
          if (!a || a.age < 18) continue;
          d.econ += a.beliefs.econ; d.auth += a.beliefs.auth; d.trad += a.beliefs.trad; d.adults++;
        }
      }
    } else {
      const cat = ECON_CAT[b.type];
      if (cat) {
        // Economic anchors colour the district they stand in — and, half as much, its neighbours
        const { d } = sector(b.pos);
        d.cats.set(cat, (d.cats.get(cat) ?? 0) + 1);
      }
    }
  }
  const vals = [...sectors.values()].map(d => d.wealth / Math.max(1, d.homes)).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)] ?? 0;

  const map = new Map<number, DistrictInfo>();
  for (const [key, d] of sectors) {
    if (d.homes === 0 && d.adults === 0) continue; // skip non-residential sectors
    const cx = d.x / d.homes, cz = d.z / d.homes;
    const meanW = d.wealth / d.homes;
    const dist = Math.hypot(cx, cz);
    const lean: Beliefs = d.adults
      ? { econ: d.econ / d.adults, auth: d.auth / d.adults, trad: d.trad / d.adults }
      : { econ: 0, auth: 0, trad: 0 };
    let dominant = 'residential', top = 1;
    for (const [cat, n] of d.cats) if (n > top) { top = n; dominant = cat; }

    const pull: Beliefs = { ...(CAT_PULL[dominant] ?? { econ: 0, auth: 0, trad: 0 }) } as Beliefs;
    pull.econ ??= 0; pull.auth ??= 0; pull.trad ??= 0;
    if (meanW > med * 1.5) { pull.econ += 0.06; pull.auth += 0.03; }       // rich quarters defend the order
    else if (meanW < med * 0.6) { pull.econ -= 0.06; }                    // poor quarters radicalise
    if (dist > 140) { pull.trad += 0.04; pull.auth -= 0.03; }             // the frontier minds its own business

    let name: string;
    if (dist < DISTRICT_SIZE * 0.75) {
      name = meanW > med * 1.5 ? 'Palace Quarter' : meanW < med * 0.6 ? 'Old Town' : 'Market Quarter';
    } else {
      const angle = (Math.atan2(cz, cx) * 180) / Math.PI; // -180..180
      const card = CARDINALS[Math.round(((angle + 180 + 360) % 360) / 45) % 8];
      const tier = meanW > med * 1.5 ? RICH_NAMES : meanW < med * 0.6 ? POOR_NAMES : MID_NAMES;
      name = `${card} ${tier[Math.abs(key) % tier.length]}`;
    }
    map.set(key, { key, name, homes: d.homes, wealth: meanW, centroid: { x: cx, z: cz }, adults: d.adults, lean, pull, dominant });
  }
  cache.set(sim, { day: s.day, map });
  return map;
}

export function districtName(sim: Simulation, pos: Vec2): string {
  return districtMap(sim).get(districtKeyOf(pos))?.name ?? 'the outskirts';
}

/** The district a world position falls in (undefined on unbuilt ground). */
export function districtAt(sim: Simulation, pos: Vec2): DistrictInfo | undefined {
  return districtMap(sim).get(districtKeyOf(pos));
}
