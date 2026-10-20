/**
 * Comprehensive audit run: one preset × several seeds, every data point the sim exposes.
 * Writes reports/data/<preset>.json (raw) and prints a compact summary.
 * Usage: npx tsx scripts/audit.ts <presetId> [years=40] [seeds=1,2,3] [size=town]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, SIZE_PRESETS, clonePolicy, cloneCulture, positionFromPolicy } from '../src/sim/presets';
import { beliefDistance } from '../src/sim/society';
import { DAYS_PER_YEAR } from '../src/sim/types';

const presetId = process.argv[2] ?? 'liberal';
const years = Number(process.argv[3] ?? 40);
const seeds = (process.argv[4] ?? '1,2,3').split(',').map(Number);
const size = SIZE_PRESETS.find(s => s.id === (process.argv[5] ?? 'town'))!;
const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;

const EVENT_PATTERNS: Record<string, RegExp> = {
  election: /^Election:/,
  reelected: /re-elected/,
  revolution: /revolution|overthrown|toppled|seized power/i,
  coup: /coup/i,
  riot: /riot/i,
  strike: /strike/i,
  protest: /protest|march|rally/i,
  crackdown: /crack(ed)? ?down|arrest|fired on|massacre/i,
  martial: /martial law/i,
  purge: /purg/i,
  split: /split from|splinter/i,
  merger: /merge/i,
  founded: /founded|formed the/i,
  dissolved: /dissolv|disband/i,
  famine: /famine|starv/i,
  plague: /plague|epidemic|outbreak/i,
  scandal: /scandal/i,
  concession: /concession|concede|reform/i,
  storm: /storm/i,
  caretaker: /caretaker|no majority|hung/i,
  thaw: /thaw/i,
  tighten: /tighten/i,
};

function moneyTotal(sim: Simulation) {
  const s = sim.state;
  const hh = s.households.reduce((t, h) => t + h.money, 0);
  const firms = s.buildings.reduce((t, b) => t + b.cash, 0);
  const fac = s.factions.reduce((t, f) => t + (f.treasury ?? 0), 0);
  return { hh, firms, treasury: s.gov.treasury, factions: fac, total: hh + firms + s.gov.treasury + fac };
}

function quantile(v: number[], q: number) { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; }

function runOne(seed: number) {
  const sim = Simulation.create({
    sizePreset: size.id, ideologyPreset: preset.id, population: size.population, seed,
    policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
  });
  const causes: Record<string, number> = {};
  const orig = sim.killAgent.bind(sim);
  sim.killAgent = (a, c) => { const k = c.replace(/ by .*/, ''); causes[k] = (causes[k] ?? 0) + 1; orig(a, c); };
  const evCounts: Record<string, number> = {};
  const evByKind: Record<string, number> = {};
  const scenes: Record<string, number> = {};
  const politicalLog: string[] = [];
  const regimeHistory: { day: number; name: string }[] = [{ day: 0, name: sim.state.gov.regimeName }];
  const rulingHistory: { day: number; id: number | null; econ: number | null }[] = [];
  const elections: { day: number; winnerEcon: number; medianEcon: number; meanEcon: number; share: number; text: string }[] = [];
  sim.listeners.push(e => {
    evByKind[e.kind] = (evByKind[e.kind] ?? 0) + 1;
    if (e.scene) scenes[e.scene.kind] = (scenes[e.scene.kind] ?? 0) + 1;
    for (const [k, re] of Object.entries(EVENT_PATTERNS)) if (re.test(e.text)) evCounts[k] = (evCounts[k] ?? 0) + 1;
    if (e.kind === 'politics' || e.kind === 'unrest') politicalLog.push(`y${(e.day / DAYS_PER_YEAR).toFixed(1)} ${e.text}`);
    if (e.text.startsWith('Election:')) {
      const name = /the (.+?) (?:won|was re-elected)/.exec(e.text)?.[1];
      const f = sim.state.factions.find(x => x.name === name);
      const ad = sim.adults().map(a => a.beliefs.econ);
      const share = Number(/(\d+)%/.exec(e.text)?.[1] ?? NaN) / 100;
      if (f) elections.push({ day: e.day, winnerEcon: f.platform.econ, medianEcon: quantile(ad, 0.5), meanEcon: ad.reduce((a, b) => a + b, 0) / ad.length, share, text: e.text });
    }
  });

  const m0 = moneyTotal(sim);
  const yearly: any[] = [];
  let lastRuling = sim.state.gov.rulingFactionId;
  let rulingChanges = 0;
  const t0 = performance.now();
  for (let y = 1; y <= years; y++) {
    let births = 0, deaths = 0, crime = 0;
    for (let d = 0; d < DAYS_PER_YEAR; d++) {
      sim.runDays(1);
      const st = sim.state.stats.at(-1)!;
      births += st.births; deaths += st.deaths; crime += st.crime;
      if (sim.state.gov.regimeName !== regimeHistory.at(-1)!.name) regimeHistory.push({ day: sim.state.day, name: sim.state.gov.regimeName });
      if (sim.state.gov.rulingFactionId !== lastRuling) {
        rulingChanges++; lastRuling = sim.state.gov.rulingFactionId;
        rulingHistory.push({ day: sim.state.day, id: lastRuling, econ: sim.faction(lastRuling)?.platform.econ ?? null });
      }
    }
    const s = sim.state;
    const st = s.stats.at(-1)!;
    const adults = sim.adults();
    const ages = s.agents.map(a => a.age);
    const jobs: Record<string, number> = {};
    for (const a of s.agents) jobs[a.job] = (jobs[a.job] ?? 0) + 1;
    const hhMoney = s.households.map(h => h.money).sort((a, b) => a - b);
    const top10 = hhMoney.slice(Math.floor(hhMoney.length * 0.9)).reduce((a, b) => a + b, 0) / Math.max(1e-9, hhMoney.reduce((a, b) => a + b, 0));
    const homeless = s.households.filter(h => h.homeId == null).length;
    const owners = new Set(s.buildings.filter(b => b.ownerHouseholdId != null).map(b => b.ownerHouseholdId));
    const factionMembers = adults.filter(a => a.factionId != null).length;
    const ruling = sim.faction(s.gov.rulingFactionId);
    const polPos = positionFromPolicy(s.policy);
    const meanB = { econ: st.econ, auth: st.auth, trad: st.trad };
    const money = moneyTotal(sim);
    const slots = s.buildings.filter(b => b.complete).reduce((t, b) => t + b.capacity, 0);
    yearly.push({
      y, pop: st.pop, adults: adults.length, births, deaths, crime,
      meanAge: ages.reduce((a, b) => a + b, 0) / Math.max(1, ages.length),
      kids: s.agents.filter(a => a.age < 18).length, elders: s.agents.filter(a => a.age >= 65).length,
      happiness: st.happiness, food: st.foodSecurity, gini: st.gini, legit: st.legitimacy, unemp: st.unemployment,
      econ: st.econ, auth: st.auth, trad: st.trad, spread: st.beliefSpread, inflation: st.inflation, priceIndex: st.priceIndex,
      treasury: s.gov.treasury, stateDebt: s.gov.stateDebt, privDebt: st.totalDebt, avgWealth: st.avgWealth, shortage: st.shortage, cohesion: st.cohesion,
      top10MoneyShare: top10, homelessHH: homeless, households: s.households.length, ownerHH: owners.size,
      factions: s.factions.length, factionMembership: factionMembers / Math.max(1, adults.length),
      rulingEcon: ruling?.platform.econ ?? null, rulingAuth: ruling?.platform.auth ?? null,
      govPos: { ...s.gov.position }, policyPos: polPos, govGap: beliefDistance(s.gov.position, meanB),
      policy: { tax: s.policy.taxRate, welfare: s.policy.welfare, ps: s.policy.publicServices, enforcement: s.policy.enforcement, liberty: s.policy.civilLiberty, wageFloor: s.policy.wageFloor, corruption: s.policy.corruption, own: s.policy.ownership, alloc: s.policy.allocation, gov: s.policy.governance, press: s.policy.pressFreedom },
      regime: s.gov.regimeName, securityLoyalty: s.gov.securityLoyalty, pentUp: s.gov.pentUp, scandal: s.gov.scandal,
      grievance: adults.reduce((t, a) => t + a.grievance, 0) / Math.max(1, adults.length),
      fear: adults.reduce((t, a) => t + a.fear, 0) / Math.max(1, adults.length),
      approval: adults.reduce((t, a) => t + a.approval, 0) / Math.max(1, adults.length),
      jailed: s.agents.filter(a => a.activity === 'jailed').length,
      hungry: s.agents.filter(a => a.hungerDays > 3).length,
      needs: Object.fromEntries(Object.keys(s.agents[0]?.needs ?? {}).map(k => [k, s.agents.reduce((t, a) => t + (a.needs as any)[k], 0) / Math.max(1, s.agents.length)])),
      prices: { ...s.market.prices }, wage: s.market.avgWage, moneySupply: s.market.moneySupply, money,
      jobs, buildings: s.buildings.length, jobSlots: slots,
      store: { ...s.store }, weather: s.weather.kind,
      econSd: Math.sqrt(adults.reduce((t, a) => t + (a.beliefs.econ - st.econ) ** 2, 0) / Math.max(1, adults.length)),
      authSd: Math.sqrt(adults.reduce((t, a) => t + (a.beliefs.auth - st.auth) ** 2, 0) / Math.max(1, adults.length)),
      tradSd: Math.sqrt(adults.reduce((t, a) => t + (a.beliefs.trad - st.trad) ** 2, 0) / Math.max(1, adults.length)),
      subcultures: adults.reduce((m: Record<string, number>, a) => (m[a.subculture] = (m[a.subculture] ?? 0) + 1, m), {}),
      classes: adults.reduce((m: Record<string, number>, a) => (m[a.classIdentity] = (m[a.classIdentity] ?? 0) + 1, m), {}),
      factionList: s.factions.map(f => ({ name: f.name, m: f.members, econ: +f.platform.econ.toFixed(2), auth: +f.platform.auth.toFixed(2), trad: +f.platform.trad.toFixed(2), drift: +beliefDistance(f.platform, f.founding).toFixed(2), anger: +f.anger.toFixed(2), ug: f.underground, seats: f.seats })),
    });
  }
  return {
    seed, ms: performance.now() - t0, m0, revolutions: sim.state.gov.revolutions, electionsHeld: sim.state.gov.elections,
    rulingChanges, regimeHistory, rulingHistory, elections, causes, evCounts, evByKind, scenes, yearly,
    politicalLog: politicalLog.slice(-60), politicalCount: politicalLog.length,
  };
}

const runs = seeds.map(runOne);
mkdirSync('reports/data', { recursive: true });
writeFileSync(`reports/data/${presetId}-${size.id}.json`, JSON.stringify({ preset: presetId, size: size.id, years, runs }, null, 0));
for (const r of runs) {
  const f = r.yearly.at(-1);
  console.log(`${presetId} seed${r.seed} ${(r.ms / 1000).toFixed(0)}s pop=${f.pop} happy=${f.happiness.toFixed(2)} gini=${f.gini.toFixed(2)} legit=${f.legit.toFixed(2)} unemp=${f.unemp.toFixed(2)} rev=${r.revolutions} el=${r.electionsHeld} rulingΔ=${r.rulingChanges} regime=${f.regime} money ${r.m0.total.toFixed(0)}→${f.money.total.toFixed(0)}`);
}
