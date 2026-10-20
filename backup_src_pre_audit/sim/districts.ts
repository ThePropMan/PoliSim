import type { Simulation } from './simulation';
import type { Vec2 } from './types';
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
}

export function districtKeyOf(pos: Vec2): number {
  return (Math.floor(pos.x / DISTRICT_SIZE) + 32) * 64 + Math.floor(pos.z / DISTRICT_SIZE) + 32;
}

/** Residential districts, recomputed at most once per day (cached per Simulation). */
const cache = new WeakMap<Simulation, { day: number; map: Map<number, DistrictInfo> }>();

export function districtMap(sim: Simulation): Map<number, DistrictInfo> {
  const s = sim.state;
  const hit = cache.get(sim);
  if (hit && hit.day === s.day) return hit.map;

  const wealth = householdWealth(sim);
  const sectors = new Map<number, { homes: number; wealth: number; x: number; z: number }>();
  for (const b of s.buildings) {
    if (b.type !== 'house' && b.type !== 'tenement' && b.type !== 'manor') continue;
    const key = districtKeyOf(b.pos);
    const d = sectors.get(key) ?? { homes: 0, wealth: 0, x: 0, z: 0 };
    d.homes++;
    const w = b.residents.reduce((t, id) => t + (wealth.get(id) ?? 0), 0) / Math.max(1, b.residents.length);
    d.wealth += w;
    d.x += b.pos.x; d.z += b.pos.z;
    sectors.set(key, d);
  }
  const vals = [...sectors.values()].map(d => d.wealth / d.homes).sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length / 2)] ?? 0;

  const map = new Map<number, DistrictInfo>();
  for (const [key, d] of sectors) {
    const cx = d.x / d.homes, cz = d.z / d.homes;
    const meanW = d.wealth / d.homes;
    const dist = Math.hypot(cx, cz);
    let name: string;
    if (dist < DISTRICT_SIZE * 0.75) {
      name = meanW > med * 1.5 ? 'Palace Quarter' : meanW < med * 0.6 ? 'Old Town' : 'Market Quarter';
    } else {
      const angle = (Math.atan2(cz, cx) * 180) / Math.PI; // -180..180
      const card = CARDINALS[Math.round(((angle + 180 + 360) % 360) / 45) % 8];
      const tier = meanW > med * 1.5 ? RICH_NAMES : meanW < med * 0.6 ? POOR_NAMES : MID_NAMES;
      name = `${card} ${tier[Math.abs(key) % tier.length]}`;
    }
    map.set(key, { key, name, homes: d.homes, wealth: meanW, centroid: { x: cx, z: cz } });
  }
  cache.set(sim, { day: s.day, map });
  return map;
}

export function districtName(sim: Simulation, pos: Vec2): string {
  return districtMap(sim).get(districtKeyOf(pos))?.name ?? 'the outskirts';
}
