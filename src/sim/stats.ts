import type { Simulation } from './simulation';
import { BUILDING_PRODUCTION } from './economy';
import { GOODS } from './types';
import { lerp } from './rng';

export function gini(values: number[]): number {
  const v = values.map(x => Math.max(0, x)).sort((a, b) => a - b);
  const n = v.length;
  const sum = v.reduce((a, b) => a + b, 0);
  if (n === 0 || sum === 0) return 0;
  let cum = 0;
  for (let i = 0; i < n; i++) cum += (i + 1) * v[i];
  return (2 * cum) / (n * sum) - (n + 1) / n;
}

/** Per-capita wealth of each household (net money + stocks + property value). */
export function householdWealth(sim: Simulation): Map<number, number> {
  const s = sim.state;
  const w = new Map<number, number>();
  const moneyWeight = s.policy.allocation === 'market' ? 1 : 0;
  for (const hh of s.households) {
    const netCash = (hh.money - hh.debt * 0.7) * moneyWeight;
    const goodsVal = (hh.food * s.market.prices.food * 0.5 + hh.goods * s.market.prices.goods + hh.luxury * s.market.prices.luxury) * (s.policy.allocation === 'market' ? 1 : 0.35);
    const baseEqualityFloor = s.policy.allocation !== 'market' ? hh.members.length * 10 * (1 - s.policy.corruption * 0.6) : 0;
    w.set(hh.id, Math.max(0, netCash + goodsVal + baseEqualityFloor));
  }
  for (const b of s.buildings) {
    if (b.ownerHouseholdId == null) continue;
    const isHome = b.type === 'house' || b.type === 'tenement' || b.type === 'manor';
    const val = b.type === 'manor' ? 320 : b.type === 'tenement' ? 260 : isHome ? 150 : BUILDING_PRODUCTION[b.type] || b.type === 'bank' ? 240 + Math.max(0, b.cash) : 0;
    w.set(b.ownerHouseholdId, (w.get(b.ownerHouseholdId) ?? 0) + val);
  }
  return w;
}

export function recordStats(sim: Simulation) {
  const s = sim.state;
  const agents = s.agents;
  const n = agents.length || 1;
  const adults = agents.filter(a => a.age >= 18);
  const working = agents.filter(a => a.age >= 18 && a.age < 65);
  const wealth = householdWealth(sim);
  const perCap: number[] = [];
  for (const hh of s.households) {
    const w = (wealth.get(hh.id) ?? 0) / Math.max(1, hh.members.length);
    for (let i = 0; i < hh.members.length; i++) perCap.push(w);
  }
  const meanEcon = adults.reduce((t, a) => t + a.beliefs.econ, 0) / Math.max(1, adults.length);
  const meanAuth = adults.reduce((t, a) => t + a.beliefs.auth, 0) / Math.max(1, adults.length);
  const meanTrad = adults.reduce((t, a) => t + a.beliefs.trad, 0) / Math.max(1, adults.length);
  const varE = adults.reduce((t, a) => t + (a.beliefs.econ - meanEcon) ** 2, 0) / Math.max(1, adults.length);
  const varA = adults.reduce((t, a) => t + (a.beliefs.auth - meanAuth) ** 2, 0) / Math.max(1, adults.length);
  const avgShortage = GOODS.reduce((t, g) => t + s.plan.shortageSeverity[g], 0) / GOODS.length;
  // Felt inequality is about incomes (per head, per household), not the property ledger: a
  // wealth Gini of 0.7 is normal even in egalitarian countries. Smoothed over ~a season.
  const incPerCap: number[] = [];
  for (const hh of s.households) {
    const v = Math.max(0, hh.income) / Math.max(1, hh.members.length);
    for (let i = 0; i < hh.members.length; i++) incPerCap.push(v);
  }
  const incToday = gini(incPerCap);
  s.gov.incomeGini = s.gov.incomeGini == null || s.day < 3 ? incToday : lerp(s.gov.incomeGini, incToday, 0.04);

  s.stats.push({
    day: s.day,
    pop: agents.length,
    happiness: agents.reduce((t, a) => t + a.happiness, 0) / n,
    gini: gini(perCap),
    incomeGini: s.gov.incomeGini,
    legitimacy: s.gov.legitimacy,
    foodSecurity: agents.reduce((t, a) => t + a.needs.food, 0) / n,
    unemployment: working.length ? working.filter(a => a.job === 'unemployed').length / working.length : 0,
    treasury: s.gov.treasury,
    avgWealth: perCap.reduce((a, b) => a + b, 0) / Math.max(1, perCap.length),
    crime: s.counters.crimes,
    factionStrength: s.factions.filter(f => f.id !== s.gov.rulingFactionId).reduce((t, f) => t + f.strength, 0) / Math.max(1, adults.length),
    births: s.counters.births,
    deaths: s.counters.deaths,
    econ: meanEcon,
    auth: meanAuth,
    trad: meanTrad,
    beliefSpread: Math.sqrt((varE + varA) / 2),
    inflation: s.market.inflationRate,
    priceIndex: s.market.priceIndex,
    totalDebt: s.market.totalPrivateDebt,
    shortage: avgShortage,
    cohesion: s.culture.cohesion,
  });
  if (s.stats.length > 3000) s.stats.splice(0, s.stats.length - 3000);
  s.counters = { births: 0, deaths: 0, crimes: 0, divorces: 0, defaults: 0 };
}
