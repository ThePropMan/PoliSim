import { DAYS_PER_YEAR, type WeatherKind } from './types';
import type { Simulation } from './simulation';
import { clamp } from './rng';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_LEN = DAYS_PER_YEAR / SEASONS.length; // 7.5 days at 30 days/year

export function dayOfYear(day: number): number {
  return ((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
}

export function seasonOf(day: number): Season {
  return SEASONS[Math.min(3, Math.floor(dayOfYear(day) / SEASON_LEN))];
}

/** Progress through the current season in [0,1). */
export function seasonProgress(day: number): number {
  return (dayOfYear(day) % SEASON_LEN) / SEASON_LEN;
}

/** "Early"/"Mid"/"Late" prefix for display. */
export function seasonLabel(day: number): string {
  const p = seasonProgress(day);
  const part = p < 1 / 3 ? 'Early' : p < 2 / 3 ? 'Mid' : 'Late';
  const s = seasonOf(day);
  return `${part} ${s[0].toUpperCase()}${s.slice(1)}`;
}

/**
 * Farm yield multiplier across the year: modest in spring (planting),
 * peaks at autumn harvest, weakest in winter. Averages ~1.
 */
export function seasonalFarmFactor(day: number): number {
  switch (seasonOf(day)) {
    case 'spring': return 0.78 + 0.5 * seasonProgress(day);       // ramps up as crops grow
    case 'summer': return 1.15;
    case 'autumn': return 1.45 - 0.5 * seasonProgress(day);       // harvest front-loaded
    case 'winter': return 0.6;
  }
}

/** Extra household fuel/raw need in winter (heating). */
export function seasonalHeatingNeed(day: number): number {
  return seasonOf(day) === 'winter' ? 0.5 : seasonOf(day) === 'autumn' ? 0.15 : 0;
}

// ---------------------------------------------------------------- weather

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm', drought: 'Drought', snow: 'Snow',
};

/** Weighted weather transitions by season: [kind, weight]. */
const WEATHER_TABLE: Record<Season, [WeatherKind, number][]> = {
  spring: [['clear', 38], ['cloudy', 22], ['rain', 30], ['storm', 5], ['drought', 5]],
  summer: [['clear', 52], ['cloudy', 14], ['rain', 16], ['storm', 8], ['drought', 10]],
  autumn: [['clear', 34], ['cloudy', 26], ['rain', 28], ['storm', 7], ['drought', 5]],
  winter: [['clear', 36], ['cloudy', 24], ['snow', 30], ['storm', 8], ['rain', 2]],
};

/** How weather scales farm output today. */
export function weatherFarmFactor(w: WeatherKind): number {
  return { clear: 1.02, cloudy: 1.0, rain: 1.12, storm: 0.65, drought: 0.45, snow: 0.55 }[w];
}

/** How weather suppresses (or inflames) mass gatherings — protests, riots. */
export function weatherProtestFactor(w: WeatherKind): number {
  return { clear: 1, cloudy: 0.92, rain: 0.5, storm: 0.12, snow: 0.42, drought: 1.06 }[w];
}

/** Daily environment update: weather transitions, storm damage, forest regrowth. */
export function updateEnvironmentDay(sim: Simulation) {
  const s = sim.state, rng = sim.rng;
  const season = seasonOf(s.day);

  if (--s.weather.daysLeft <= 0) {
    const table = WEATHER_TABLE[season];
    const total = table.reduce((t, [, w]) => t + w, 0);
    let roll = rng.next() * total;
    let kind: WeatherKind = 'clear';
    for (const [k, w] of table) { roll -= w; if (roll <= 0) { kind = k; break; } }
    const prev = s.weather.kind;
    s.weather.kind = kind;
    s.weather.daysLeft = rng.int(2, kind === 'drought' ? 8 : 5);
    if (kind !== prev) {
      if (kind === 'storm') sim.log(`A storm is bearing down on the ${s.gov.regimeName}.`, 'info', undefined, { kind: 'storm' });
      else if (kind === 'drought') sim.log('A drought has settled over the region. Crops wither.', 'economy', undefined, { kind: 'drought' });
      else if (kind === 'snow' && prev !== 'snow') sim.log('The first snows have fallen.', 'info');
    }
  }

  if (s.weather.kind === 'storm') {
    // Each storm day may damage a few structures; builders repair them afterwards
    const damaged: typeof s.buildings = [];
    const n = rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const b = rng.pick(s.buildings.filter(b => b.complete));
      if (b && !damaged.includes(b)) { b.condition = clamp((b.condition ?? 1) - rng.range(0.08, 0.3), 0.3, 1); damaged.push(b); }
    }
    if (damaged.length) sim.log(`The storm damaged ${damaged.map(b => b.type.replace('_', ' ')).join(', ')}.`, 'info');
  }

  // Slow natural decay of all buildings; forest regrows slowly
  for (const b of s.buildings) if (b.complete && rng.chance(0.5)) b.condition = Math.max(0.35, (b.condition ?? 1) - 0.002);
  const t = s.terrain;
  for (let i = 0; i < t.forest.length; i++) if (t.forest[i] > 0 && t.forest[i] < 1) t.forest[i] = Math.min(1, t.forest[i] + 0.0006);
}
