import { clamp, lerp } from './rng';
import { householdWealth } from './stats';
import { isWorkingJob } from './behavior';
import { PLANNING_STRATEGIES } from './presets';
import { seasonalFarmFactor, seasonalHeatingNeed, seasonOf, weatherFarmFactor } from './environment';
import { siteQuality, terrainIndex } from './terrain';
import type { Simulation } from './simulation';
import type { Agent, Building, BuildingType, Good, Household, Job } from './types';
import { GOODS } from './types';

export const FARM_OUT = 4.6;
export const MILL_OUT = 5.4;
export const BAKERY_OUT = 5.8;
export const RAW_OUT = 3.8;
export const SMITH_OUT = 2.8;
export const WORKSHOP_OUT = 3.4;
export const FACTORY_OUT = 4.8;
export const TAILOR_OUT = 2.6;
export const TAVERN_OUT = 2.4;

export const GOODS_WANT = 0.36;
export const LUXURY_WANT = 0.14;
/** Goods burned per person per day at full winter cold (seasonalHeatingNeed = 1). */
export const HEATING_PER_CAPITA = 0.25;
/** Year-round average heating draw per person (winter 0.5 + autumn 0.15, each a quarter-year). */
const HEATING_AVG = HEATING_PER_CAPITA * (0.5 + 0.15) / 4;
const HOUSE_COST = 150;
const BUILD_RATE = 0.08;

const PUBLIC_JOBS: Job[] = ['healer', 'teacher', 'scholar', 'guard', 'official', 'clerk', 'builder'];

export const JOB_BUILDING: Partial<Record<Job, BuildingType>> = {
  farmer: 'farm',
  miner: 'mine',
  lumberjack: 'lumber_camp',
  smith: 'smithy',
  baker: 'bakery',
  crafter: 'workshop',
  factory_worker: 'factory',
  tailor: 'tailor_shop',
  tavern_keeper: 'tavern',
  merchant: 'market',
  banker: 'bank',
  clerk: 'warehouse',
  builder: 'yard',
  healer: 'clinic',
  teacher: 'school',
  scholar: 'university',
  guard: 'guardhouse',
  official: 'townhall',
  priest: 'temple',
  artist: 'theater',
};

/** Which good a productive building produces, and what input it consumes per unit of output. */
export const BUILDING_PRODUCTION: Partial<Record<BuildingType, { good: Good; rate: number; input?: Good; inputRatio?: number }>> = {
  farm: { good: 'food', rate: FARM_OUT },
  mill: { good: 'food', rate: MILL_OUT, input: 'food', inputRatio: 0.45 },
  bakery: { good: 'food', rate: BAKERY_OUT, input: 'food', inputRatio: 0.5 },
  mine: { good: 'raw', rate: RAW_OUT },
  lumber_camp: { good: 'raw', rate: RAW_OUT },
  smithy: { good: 'tools', rate: SMITH_OUT, input: 'raw', inputRatio: 0.55 },
  workshop: { good: 'goods', rate: WORKSHOP_OUT, input: 'raw', inputRatio: 0.4 },
  factory: { good: 'goods', rate: FACTORY_OUT, input: 'raw', inputRatio: 0.5 },
  tailor_shop: { good: 'luxury', rate: TAILOR_OUT, input: 'goods', inputRatio: 0.35 },
  tavern: { good: 'luxury', rate: TAVERN_OUT, input: 'food', inputRatio: 0.35 },
};

const BASE_PRICES: Record<Good, number> = { food: 2.0, raw: 1.6, goods: 3.2, tools: 4.5, luxury: 6.5 };

export const foodWeight = (a: Agent) => (a.age < 12 ? 0.6 : 1);
export const householdFoodNeed = (sim: Simulation, hh: Household) =>
  hh.members.reduce((s, id) => { const a = sim.agent(id); return s + (a ? foodWeight(a) : 0); }, 0);

export const agentCollectivism = (sim: Simulation, a: Agent) =>
  clamp(0.5 - 0.45 * a.beliefs.econ + 0.35 * (a.personality.A - 0.5) + 0.3 * (sim.state.culture.collectivism - 0.5));

const isStriking = (sim: Simulation, a: Agent) => {
  const f = sim.faction(a.factionId);
  return !!f && f.strikeToday && a.commitment > 0.25;
};

export function productivity(sim: Simulation, a: Agent, b?: Building): number {
  const p = sim.state.policy;
  const c = sim.state.culture;
  let motivation = 0.72 + 0.32 * a.personality.C + 0.18 * (c.workEthic - 0.5);
  const coll = agentCollectivism(sim, a);
  if (p.allocation === 'planned') {
    // Planned economy: high collectivism or fear of enforcement drives quota effort; otherwise "they pretend to pay us, we pretend to work"
    motivation *= 0.68 + 0.28 * coll + 0.12 * p.enforcement;
  } else if (p.allocation === 'commons') {
    motivation *= 0.58 + 0.52 * coll * (0.55 + 0.45 * c.trust);
  } else if (p.ownership === 'collective') {
    motivation *= 0.96 + 0.12 * coll;
  } else if (p.ownership === 'state') {
    motivation *= 0.84 + 0.12 * coll;
  }
  // Confiscatory taxation crushes effort: workers shirk, moonlight in the shadow
  // economy, or simply stop caring. Deadweight loss bites above ~45% and gets
  // severe toward 80%.
  if (p.taxRate > 0.45) motivation *= 1 - Math.min(0.5, (p.taxRate - 0.45) * 1.15);
  const morale = 0.7 + 0.38 * a.happiness;
  const toolBonus = b ? 0.78 + 0.42 * clamp(b.tools / Math.max(1, b.workers.length * 1.2)) : 1;
  return (0.55 + 0.5 * a.skill + 0.28 * a.education) * (0.55 + 0.45 * a.needs.health) * motivation * morale * toolBonus;
}

export function runEconomyDay(sim: Simulation) {
  const s = sim.state;
  for (const hh of s.households) hh.income = 0;
  for (const a of s.agents) a.income = 0;
  for (const g of GOODS) { s.market.produced[g] = 0; s.market.consumed[g] = 0; s.market.spoiled[g] = 0; }
  s.plan.strategy = s.policy.planningStrategy;

  assignJobs(sim);
  produce(sim);
  if (s.policy.allocation === 'market') {
    marketSupplyChainAndTrade(sim);
    payMarketIncomes(sim);
    runBankingAndDebt(sim);
  } else if (s.policy.allocation === 'planned') {
    plannedDistribution(sim);
  } else {
    commonsDistribution(sim);
  }
  governmentSpending(sim);
  collectRent(sim);
  consume(sim);
  housing(sim);
  antiTrust(sim);
  updateMacroMetrics(sim);

  if (s.policy.taxRate > 0.6 && s.day % 7 === 0 && sim.rng.chance(0.1)) {
    sim.log('A shadow economy thrives as crushing taxes drive trade underground.', 'economy');
  }

  if (s.day % 30 === 0 && s.day > 0) {
    s.harvest = clamp(sim.rng.normal(1, 0.13), 0.58, 1.32);
    if (s.harvest < 0.75) sim.log(`Poor harvest this year (${Math.round(s.harvest * 100)}% yield).`, 'economy');
    else if (s.harvest > 1.2) sim.log(`Bumper harvest this year (${Math.round(s.harvest * 100)}% yield).`, 'economy');
  }
}

/**
 * Anti-monopoly law (low `ownerConcentration`): a household holding more productive property
 * than the legal cap must sell the excess — preferably to a household working there — at a
 * price the buyer can afford. Money only changes hands, so totals are conserved.
 */
function antiTrust(sim: Simulation) {
  const s = sim.state, p = s.policy;
  if (p.ownership !== 'private' || p.ownerConcentration > 0.2 || s.day % 5 !== 0) return;
  const cap = 1 + Math.round(p.ownerConcentration * 10);
  const holdings = new Map<number, Building[]>();
  for (const b of s.buildings) {
    if (b.ownerKind !== 'private' || b.ownerHouseholdId == null || !BUILDING_PRODUCTION[b.type]) continue;
    const arr = holdings.get(b.ownerHouseholdId);
    if (arr) arr.push(b); else holdings.set(b.ownerHouseholdId, [b]);
  }
  for (const [ownerId, bs] of holdings) {
    if (bs.length <= cap) continue;
    const seller = sim.household(ownerId);
    const b = bs[sim.rng.int(0, bs.length - 1)];
    // Buyers must have savings to spare — nobody sells their food money to buy a workshop
    const solvent = (h: Household | undefined) => !!h && !holdings.has(h.id) && h.money > 90;
    const worker = b.workers.map(id => sim.agent(id)).find(a => a && a.householdId !== ownerId && solvent(sim.household(a.householdId)));
    const buyer = sim.household(worker?.householdId) ?? sim.rng.pick(s.households.filter(solvent));
    if (!seller || !buyer) continue;
    const price = Math.min((buyer.money - 60) * 0.5, 60 + b.cash);
    buyer.money -= price; seller.money += price;
    b.ownerHouseholdId = buyer.id;
    holdings.set(buyer.id, [b]);
    if (sim.rng.chance(0.25)) sim.log(`Anti-monopoly law: a ${b.type.replace('_', ' ')} was sold off to a smaller family business.`, 'economy');
  }
}

// ---------------------------------------------------------------- labor & jobs

function jobTargets(sim: Simulation): Record<Job, number> {
  const s = sim.state, p = s.policy, c = s.culture;
  const pop = s.agents.length;
  const kids = s.agents.filter(a => a.age >= 6 && a.age < 18).length;
  const foodNeed = s.agents.reduce((t, a) => t + foodWeight(a), 0);
  const strat = PLANNING_STRATEGIES[p.planningStrategy]?.weights ?? PLANNING_STRATEGIES.balanced.weights;
  const w = p.allocation === 'planned' ? strat : { food: 1, raw: 1, goods: 1, tools: 1, luxury: 1, science: 1, security: 1 };

  const govOfficials = { none: 0, council: pop / 130, democracy: pop / 75, autocracy: pop / 45, monarchy: pop / 55 }[p.governance];
  const sites = s.buildings.filter(b => !b.complete).length;

  let foodWorkers = Math.ceil((foodNeed * 1.15 * w.food) / (FARM_OUT * s.harvest * seasonalFarmFactor(s.day) * weatherFarmFactor(s.weather.kind) * 0.95));
  let rawWorkers = Math.ceil((pop * 0.18 * w.raw) / RAW_OUT);
  let goodsWorkers = Math.ceil((pop * (GOODS_WANT + HEATING_AVG * 1.5) * 1.15 * w.goods) / WORKSHOP_OUT);
  let toolWorkers = Math.max(1, Math.ceil((pop * 0.055 * w.tools) / SMITH_OUT));
  let luxWorkers = Math.max(1, Math.ceil((pop * LUXURY_WANT * w.luxury) / TAILOR_OUT));

  if (p.allocation === 'market') {
    const pr = s.market.prices;
    foodWorkers = Math.round(foodWorkers * clamp(pr.food / BASE_PRICES.food, 0.75, 1.4));
    rawWorkers = Math.round(rawWorkers * clamp(pr.raw / BASE_PRICES.raw, 0.7, 1.45));
    const demandBased = (s.market.demand.goods * 0.55) / (WORKSHOP_OUT * 0.9);
    goodsWorkers = Math.round(clamp(Math.max(goodsWorkers * 0.55, demandBased) * clamp(pr.goods / BASE_PRICES.goods, 0.7, 1.45), 2, pop * 0.26));
    toolWorkers = Math.max(1, Math.round(toolWorkers * clamp(pr.tools / BASE_PRICES.tools, 0.7, 1.5)));
    luxWorkers = Math.max(1, Math.round(luxWorkers * clamp(pr.luxury / BASE_PRICES.luxury, 0.6, 1.6)));
  } else if (p.allocation === 'planned') {
    // Planners compute targets with noise inversely proportional to planningEfficiency + clerk/scholar support
    const scholars = s.agents.filter(a => a.job === 'scholar' || a.job === 'clerk').length;
    const bonusEff = clamp(p.planningEfficiency + Math.min(0.2, scholars / Math.max(20, pop * 0.1)));
    const err = (1 - bonusEff) * 0.42;
    foodWorkers = Math.max(2, Math.round(foodWorkers * (1 + sim.rng.normal(-err * 0.25, err))));
    rawWorkers = Math.max(1, Math.round(rawWorkers * (1 + sim.rng.normal(0, err))));
    goodsWorkers = Math.max(1, Math.round(goodsWorkers * (1 + sim.rng.normal(-err * 0.2, err))));
  }

  const hasFactory = sim.buildingsOf('factory').length > 0;
  const hasBakery = sim.buildingsOf('bakery').length > 0;
  const hasUni = sim.buildingsOf('university').length > 0;
  const hasBank = sim.buildingsOf('bank').length > 0 && p.allocation === 'market';
  const hasTheater = sim.buildingsOf('theater').length > 0;
  const hasTemple = sim.buildingsOf('temple').length > 0;

  const bakerCount = hasBakery ? Math.min(Math.floor(foodWorkers * 0.2), sim.buildingsOf('bakery').length * 5) : 0;
  const farmerCount = Math.max(2, foodWorkers - bakerCount);
  const minerCount = Math.ceil(rawWorkers * 0.5);
  const lumberCount = Math.max(1, rawWorkers - minerCount);
  const factoryCount = hasFactory ? Math.min(Math.floor(goodsWorkers * 0.45), sim.buildingsOf('factory').length * 10) : 0;
  const crafterCount = Math.max(1, goodsWorkers - factoryCount);
  const tailorCount = Math.ceil(luxWorkers * 0.55);
  const tavernCount = Math.max(1, luxWorkers - tailorCount);

  const t: Record<Job, number> = {
    child: 0,
    student: hasUni ? Math.round((pop * p.publicServices * w.science) / 55) : 0,
    retired: 0,
    unemployed: 0,
    farmer: farmerCount,
    baker: bakerCount,
    miner: minerCount,
    lumberjack: lumberCount,
    smith: toolWorkers,
    crafter: crafterCount,
    factory_worker: factoryCount,
    tailor: tailorCount,
    tavern_keeper: tavernCount,
    merchant: p.allocation === 'market' ? Math.max(1, Math.round(pop / 65)) : 0,
    banker: hasBank ? Math.max(1, Math.round(pop / 110)) : 0,
    clerk: Math.max(1, Math.round((pop * (p.allocation === 'planned' ? 0.035 : 0.015)))),
    // In market societies private clinics & schools exist even without a state (fees, not salaries)
    healer: Math.round((pop * Math.max(p.publicServices, p.allocation === 'market' && sim.buildingsOf('clinic').length ? 0.35 : 0)) / 36),
    teacher: Math.round((kids * Math.max(p.publicServices, p.allocation === 'market' && sim.buildingsOf('school').length ? 0.3 : 0)) / 12),
    scholar: hasUni ? Math.round((pop * p.publicServices * w.science) / 85) : 0,
    guard: p.governance === 'none' ? 0 : Math.round((pop * p.enforcement * w.security) / 22),
    official: Math.round(govOfficials + (p.allocation === 'planned' ? pop / 42 : 0)),
    priest: hasTemple ? Math.max(1, Math.round((pop * c.religiosity * p.religiousFreedom) / 65)) : 0,
    artist: hasTheater ? Math.max(1, Math.round((pop * (c.artisticSpirit * 0.6 + p.culturalSubsidy * 0.6)) / 65)) : 0,
    builder: sites > 0 ? Math.min(10, 3 + Math.round(pop / 100)) * Math.min(2, sites) : 1,
  };

  if (p.allocation === 'market') {
    // Healers & teachers are funded by fees (service firms), not the treasury — a stateless
    // society still has private clinics/schools; guards/officials/etc. scale with finances
    const payroll = PUBLIC_JOBS.reduce((n, j) => n + ((j === 'builder' && p.ownership === 'private') || j === 'healer' || j === 'teacher' ? 0 : t[j]), 0) * Math.max(3, s.market.avgWage);
    const affordable = clamp((s.gov.treasury + 200) / Math.max(1, payroll * 7), 0.15, 1);
    for (const j of PUBLIC_JOBS) if (!(j === 'builder' && p.ownership === 'private') && j !== 'healer' && j !== 'teacher') t[j] = Math.floor(t[j] * affordable);
  }
  return t;
}

function releaseWorker(sim: Simulation, a: Agent) {
  const w = sim.building(a.workplaceId);
  if (w) w.workers = w.workers.filter(id => id !== a.id);
  a.workplaceId = null;
  if (a.job !== 'child' && a.job !== 'retired') a.job = 'unemployed';
}

function assignJobs(sim: Simulation) {
  const s = sim.state, p = s.policy, rng = sim.rng;
  for (const a of s.agents) {
    if (a.age >= 65 && a.job !== 'retired') { releaseWorker(sim, a); a.job = 'retired'; }
    else if (a.age >= 18 && a.job === 'child') a.job = 'unemployed';
    else if (a.age >= 23 && a.job === 'student') { releaseWorker(sim, a); a.job = 'unemployed'; }
    if (a.jailedUntil > s.day + 5 && a.workplaceId != null) releaseWorker(sim, a);
  }

  const targets = jobTargets(sim);
  const byJob = new Map<Job, Agent[]>();
  for (const a of s.agents) {
    const arr = byJob.get(a.job);
    if (arr) arr.push(a); else byJob.set(a.job, [a]);
  }
  const market = p.allocation === 'market';

  for (const [job, list] of byJob) {
    if (!isWorkingJob(job) && job !== 'student') continue;
    const tolerance = market ? Math.max(1, Math.ceil(targets[job] * 0.22)) : 0;
    const excess = list.length - targets[job] - tolerance;
    if (excess > 0) {
      list.sort((x, y) => x.skill - y.skill);
      for (const a of list.splice(0, excess)) { releaseWorker(sim, a); sim.remember(a, `Lost position as ${job}.`); }
    }
  }

  // Market layoffs when firms are broke or overstocked
  if (market) {
    for (const b of s.buildings) {
      if (!BUILDING_PRODUCTION[b.type] || b.workers.length < 2) continue;
      const broke = b.ownerKind === 'private' && b.cash < b.wage * b.workers.length * 0.25;
      const overstocked = b.stock > Math.max(8, b.output * 6.5);
      if ((broke || overstocked) && rng.chance(0.28)) {
        const a = sim.agent(b.workers[b.workers.length - 1]);
        if (a) { releaseWorker(sim, a); sim.remember(a, broke ? 'Laid off: employer insolvent.' : 'Laid off: unsold inventory.'); }
      }
    }
  }

  const candidates = s.agents.filter(a =>
    a.job === 'unemployed' && a.jailedUntil <= s.day && a.age >= 18 && a.age < 65 &&
    !(p.allocation === 'commons' && agentCollectivism(sim, a) < 0.28 && a.personality.C < 0.42),
  );
  rng.shuffle(candidates);

  // Enroll young bright adults in university if slots open
  const uni = sim.buildingsOf('university')[0];
  let studentsHave = byJob.get('student')?.length ?? 0;
  if (uni && studentsHave < targets.student) {
    const young = candidates.filter(a => a.age >= 18 && a.age < 23 && a.education > 0.35).sort((x, y) => y.personality.O + y.education - (x.personality.O + x.education));
    for (const a of young) {
      if (studentsHave >= targets.student) break;
      const idx = candidates.indexOf(a);
      if (idx >= 0) candidates.splice(idx, 1);
      a.job = 'student'; a.workplaceId = uni.id; uni.workers.push(a.id);
      studentsHave++;
    }
  }

  const order: Job[] = [
    'farmer', 'baker', 'healer', 'miner', 'lumberjack', 'smith',
    'crafter', 'factory_worker', 'guard', 'official', 'clerk', 'teacher', 'scholar',
    'merchant', 'banker', 'tailor', 'tavern_keeper', 'priest', 'artist', 'builder',
  ];
  const counts = new Map<Job, number>();
  for (const a of s.agents) counts.set(a.job, (counts.get(a.job) ?? 0) + 1);
  const ruling = s.gov.rulingFactionId;

  // Fill vacancies by relative shortfall rather than strict priority, so low-priority trades
  // (priests, artists, builders) still get people when labour is tight — essentials count double
  const blocked = new Set<Job>();
  while (candidates.length) {
    let job: Job | undefined, bestFill = Infinity;
    for (const j of order) {
      if (blocked.has(j) || targets[j] <= 0) continue;
      const h = counts.get(j) ?? 0;
      if (h >= targets[j]) continue;
      const fill = (h / targets[j]) * (j === 'farmer' || j === 'baker' || j === 'healer' ? 0.5 : 1);
      if (fill < bestFill) { bestFill = fill; job = j; }
    }
    if (!job) break;
    {
      let idx = 0;
      if (job === 'healer' || job === 'teacher' || job === 'scholar' || job === 'banker') {
        idx = argmax(candidates, a => a.education * 1.2 + a.skill * 0.6);
      } else if (job === 'guard' && (p.governance === 'autocracy' || p.governance === 'monarchy')) {
        idx = argmax(candidates, a => a.beliefs.auth + (a.factionId === ruling ? 1 : 0));
      } else if (job === 'official' || job === 'clerk') {
        idx = argmax(candidates, a => a.skill + a.personality.C * 0.5 + (a.factionId === ruling && ruling != null ? 0.8 : 0));
      } else if (job === 'priest') {
        idx = argmax(candidates, a => a.religiosity + a.beliefs.trad * 0.4);
      } else if (job === 'artist') {
        idx = argmax(candidates, a => a.personality.O + (1 - a.beliefs.trad) * 0.3);
      }
      const a = candidates[idx];
      if (market && !rng.chance(0.78)) { candidates.splice(idx, 1); continue; }
      const b = findWorkplace(sim, job);
      if (!b) { blocked.add(job); continue; }
      candidates.splice(idx, 1);
      a.job = job; a.workplaceId = b.id; b.workers.push(a.id);
      counts.set(job, (counts.get(job) ?? 0) + 1);
    }
  }

  // Planned & commons economies guarantee employment by absorbing leftover workers into farms/workshops/factories
  if (!market) {
    for (const a of candidates) {
      const b = findWorkplace(sim, rng.chance(0.55) ? 'farmer' : rng.chance(0.5) ? 'crafter' : 'miner', 8, false);
      if (!b) break;
      a.job = b.type === 'farm' ? 'farmer' : b.type === 'mine' ? 'miner' : 'crafter';
      a.workplaceId = b.id; b.workers.push(a.id);
    }
  }
}

function argmax<T>(arr: T[], f: (x: T) => number) {
  let best = 0, bv = -Infinity;
  for (let i = 0; i < arr.length; i++) { const v = f(arr[i]); if (v > bv) { bv = v; best = i; } }
  return best;
}

function findWorkplace(sim: Simulation, job: Job, capOverride?: number, allowNew = true): Building | undefined {
  const type = JOB_BUILDING[job];
  if (!type) return undefined;
  const s = sim.state;
  const list = sim.buildingsOf(type);
  const isFirm = !!BUILDING_PRODUCTION[type];
  let best: Building | undefined;
  for (const b of list) {
    const cap = capOverride ?? (b.capacity || 6);
    if (b.workers.length >= cap) continue;
    if (isFirm && s.policy.allocation === 'market' && b.ownerKind === 'private' && b.cash < Math.max(3, b.wage) * 1.8 && b.workers.length > 0) continue;
    if (isFirm && s.policy.allocation === 'market' && b.stock > Math.max(6, b.output * 4.5)) continue;
    if (!best || b.workers.length < best.workers.length) best = b;
  }
  const expandable = type === 'farm' || type === 'workshop' || type === 'mine' || type === 'lumber_camp' || type === 'smithy' || type === 'bakery' || type === 'tailor_shop';
  if (!best && expandable && allowNew) {
    best = sim.addBuilding(type, sim.takeFreeCell(type));
    best.ownerKind = s.policy.ownership;
    best.tools = 5;
    best.inputStock = 12;
    if (s.policy.ownership === 'private') {
      const top = [...s.households].sort((a, b) => b.money - a.money).slice(0, 6).filter(h => h.money > 90);
      const investor = top.length ? sim.rng.pick(top) : undefined;
      if (investor) {
        investor.money -= 65; best.cash = 65; best.ownerHouseholdId = investor.id;
        sim.log(`A new ${type.replace('_', ' ')} opened, backed by the ${sim.agent(investor.members[0])?.name.split(' ')[1] ?? ''} family.`, 'economy');
      } else {
        s.buildings.pop(); sim.buildingMap.delete(best.id); sim.computeFreeCells(); sim.invalidateBuildings();
        return undefined;
      }
    } else {
      sim.log(`A new ${type.replace('_', ' ')} was established.`, 'economy');
    }
  }
  return best;
}

// ---------------------------------------------------------------- production & supply chains

function produce(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const scholars = s.agents.filter(a => (a.job === 'scholar' || a.job === 'clerk') && a.jailedUntil <= s.day).length;
  const techBonus = 1 + Math.min(0.28, scholars * 0.025);

  for (const b of s.buildings) {
    const spec = BUILDING_PRODUCTION[b.type];
    if (!spec) continue;
    let labor = 0;
    for (const id of b.workers) {
      const a = sim.agent(id);
      if (!a || a.jailedUntil > s.day || isStriking(sim, a)) continue;
      labor += productivity(sim, a, b);
    }
    let out = labor * spec.rate * techBonus;
    // Site suitability: a farm on fertile soil outproduces one on rock, a mine only
    // yields where ore remains, lumber camps need standing forest
    out *= siteQuality(s.terrain, b.type, b.pos);
    out *= 0.55 + 0.45 * (b.condition ?? 1); // dilapidated buildings underperform
    if (b.type === 'farm') out *= s.harvest * seasonalFarmFactor(s.day) * weatherFarmFactor(s.weather.kind);

    // Input bottleneck along the supply chain (raw materials -> workshops/smithies/factories; grain -> mills/bakeries)
    if (spec.input && spec.inputRatio && out > 0) {
      const needed = out * spec.inputRatio;
      let available = p.allocation === 'market' ? b.inputStock : s.store[spec.input];
      if (available < needed) {
        // Bottleneck! Output is throttled if upstream inputs are missing
        const ratio = clamp(available / Math.max(0.1, needed), 0.25, 1);
        out *= ratio;
      }
      const used = Math.min(available, out * spec.inputRatio);
      if (p.allocation === 'market') b.inputStock -= used;
      else s.store[spec.input] -= used;
      s.market.consumed[spec.input] += used;
    }

    // Tool wear & tear
    b.tools = Math.max(0, b.tools - b.workers.length * 0.04);

    b.output = out;
    b.quota = Math.max(1, b.workers.length * spec.rate * 0.85);
    s.market.produced[spec.good] += out;

    // Resource extraction depletes the land: mines exhaust ore, lumber camps thin forest
    const cell = terrainIndex(s.terrain, b.pos);
    if (cell >= 0) {
      if (b.type === 'mine') s.terrain.ore[cell] = Math.max(0, s.terrain.ore[cell] - out * 0.0011);
      else if (b.type === 'lumber_camp') s.terrain.forest[cell] = Math.max(0, s.terrain.forest[cell] - out * 0.0009);
    }

    if (p.allocation === 'market') {
      const decay = spec.good === 'food' ? 0.96 : 0.995;
      const before = b.stock;
      b.stock = b.stock * decay + out;
      s.market.spoiled[spec.good] += before * (1 - decay);
    } else {
      const eff = p.planningEfficiency;
      // Central planning coordination friction & occasional bureaucratic bottleneck
      const planCoord = p.allocation === 'planned'
        ? (spec.good === 'food' ? 0.76 + 0.24 * eff : 0.62 + 0.36 * eff) * (sim.rng.chance(0.025 * (1 - eff)) ? 0.45 : 1)
        : 0.94;
      s.store[spec.good] += out * planCoord;
      s.market.spoiled[spec.good] += out * (1 - planCoord);
    }
  }

  // Replenish tools in non-market economies from communal store
  if (p.allocation !== 'market') {
    for (const b of s.buildings) {
      if (!BUILDING_PRODUCTION[b.type]) continue;
      const wantTools = Math.max(0, b.workers.length * 1.2 - b.tools);
      const give = Math.min(wantTools, s.store.tools * 0.15);
      b.tools += give; s.store.tools -= give;
      s.market.consumed.tools += give;
    }
    const foodSpoil = s.store.food * 0.015;
    s.store.food -= foodSpoil;
    s.market.spoiled.food += foodSpoil;
  }
}

// ---------------------------------------------------------------- market trade, prices, credit & inflation

function marketSupplyChainAndTrade(sim: Simulation) {
  const s = sim.state, m = s.market, rng = sim.rng;
  const sellersByGood: Record<Good, Building[]> = { food: [], raw: [], goods: [], tools: [], luxury: [] };
  for (const b of s.buildings) {
    const spec = BUILDING_PRODUCTION[b.type];
    if (spec && b.complete) sellersByGood[spec.good].push(b);
  }
  for (const g of GOODS) {
    rng.shuffle(sellersByGood[g]);
    m.supply[g] = sellersByGood[g].reduce((t, b) => t + b.stock, 0);
    m.demand[g] = 0;
  }

  const buyFromFirms = (good: Good, qty: number, buyerMoney: number, spendCap = 1): { got: number; spent: number } => {
    const price = m.prices[good];
    const maxAfford = Math.max(0, buyerMoney * spendCap) / price;
    const target = Math.min(qty, maxAfford);
    let got = 0;
    for (const b of sellersByGood[good]) {
      if (got >= target) break;
      const take = Math.min(b.stock, target - got);
      if (take <= 0) continue;
      b.stock -= take;
      b.cash += take * price;
      got += take;
    }
    return { got, spent: got * price };
  };

  // 1. B2B Intermediate Trade: firms buy raw materials and replacement tools
  for (const b of rng.shuffle([...s.buildings])) {
    const spec = BUILDING_PRODUCTION[b.type];
    if (!spec || !b.complete || b.workers.length === 0) continue;
    if (spec.input) {
      const wantIn = Math.max(0, b.workers.length * spec.rate * (spec.inputRatio ?? 0.4) * 3 - b.inputStock);
      m.demand[spec.input] += wantIn;
      const { got, spent } = buyFromFirms(spec.input, wantIn, b.cash, 0.45);
      b.inputStock += got; b.cash -= spent;
    }
    const wantTools = Math.max(0, b.workers.length * 1.4 - b.tools);
    if (wantTools > 0.2) {
      m.demand.tools += wantTools;
      const { got, spent } = buyFromFirms('tools', wantTools, b.cash, 0.25);
      b.tools += got; b.cash -= spent;
      m.consumed.tools += got;
    }
  }

  // 2. Household Consumer Trade: food, everyday goods, and luxury.
  // Households deepen their food stores ahead of winter — pre-industrial families lived
  // off stocks, not daily purchases, so buffer targets swell through the harvest season.
  const season = seasonOf(s.day);
  const bufferDays = season === 'autumn' ? 4.5 : season === 'winter' ? 6 : season === 'spring' ? 3.5 : 3;
  const hhs = rng.shuffle([...s.households]);
  for (const hh of hhs) {
    const need = householdFoodNeed(sim, hh);
    const wantFood = Math.max(0, need * bufferDays - hh.food);
    m.demand.food += wantFood;
    // Households can't throw every coin at the granary — rent, debt, fuel and
    // tools compete, so price spikes translate into thinner food buffers.
    const fRes = buyFromFirms('food', wantFood, hh.money, 0.62);
    hh.food += fRes.got; hh.money -= fRes.spent;

    const wantGoods = Math.max(0, hh.members.length * GOODS_WANT * 3 - hh.goods);
    m.demand.goods += wantGoods;
    const gRes = buyFromFirms('goods', wantGoods, hh.money, 0.5);
    hh.goods += gRes.got; hh.money -= gRes.spent;

    const disposable = Math.max(0, hh.money - 35 * hh.members.length);
    const wantLux = Math.max(0, hh.members.length * LUXURY_WANT * 2 - hh.luxury) + (disposable * 0.14) / m.prices.luxury;
    m.demand.luxury += wantLux;
    if (disposable > 5) {
      const lRes = buyFromFirms('luxury', wantLux, disposable, 0.45);
      hh.luxury += lRes.got; hh.money -= lRes.spent;
    }

    // Wealthy households hire domestic services, home maintenance, and local artisans — recirculating capital to working households
    if (hh.money > 160 * hh.members.length) {
      const patronSpend = (hh.money - 160 * hh.members.length) * 0.035;
      hh.money -= patronSpend;
      const workingHhs = s.households.filter(x => x !== hh && x.money < 60 * x.members.length);
      if (workingHhs.length) {
        const per = patronSpend / workingHhs.length;
        for (const w of workingHhs) { w.money += per; w.income += per; }
      } else {
        s.gov.treasury += patronSpend;
      }
    }
  }

  // 3. Monetary inflation from money printing & price discovery.
  // The money stock must grow with the population or the economy strangles on deflation:
  // the state issues currency to keep per-capita supply roughly constant, scaled by how
  // willing it is to print.
  if (s.policy.governance !== 'none' && s.policy.governance !== 'council') {
    const supply = s.market.moneySupply || s.agents.length * 45;
    const target = s.agents.length * 50;
    const deficit = Math.max(0, target - supply);
    const printed = supply * s.policy.moneyPrinting * 0.0025 + deficit * (0.008 + s.policy.moneyPrinting * 0.12);
    s.gov.treasury += printed;
  }
  const moneyPerCap = (s.market.moneySupply || s.agents.length * 45) / Math.max(1, s.agents.length);
  const monetaryAnchor = clamp(moneyPerCap / 45, 0.5, 4.0);

  for (const g of GOODS) {
    const base = BASE_PRICES[g] * monetaryAnchor;
    const d = m.demand[g], sup = m.supply[g];
    const excess = clamp((d - sup) / Math.max(10, sup + d * 0.5), -0.35, 0.45);
    m.prices[g] = clamp(
      m.prices[g] * (1 + 0.018 * excess) + (base - m.prices[g]) * 0.035,
      BASE_PRICES[g] * 0.35,
      BASE_PRICES[g] * 6,
    );
  }

  m.foodPrice = m.prices.food;
  m.goodsPrice = m.prices.goods;
  m.foodDemand = m.demand.food;
  m.foodSupply = m.supply.food;
  m.goodsDemand = m.demand.goods;
  m.goodsSupply = m.supply.goods;

  informalEconomy(sim);
}

/** Safety valves in market societies: odd jobs, subsistence gardens, family support, and charity. */
function informalEconomy(sim: Simulation) {
  const s = sim.state;
  for (const a of s.agents) {
    if (a.job !== 'unemployed' || a.age < 16 || a.jailedUntil > s.day) continue;
    const hh = sim.household(a.householdId);
    if (hh) hh.food += 0.48 + 0.22 * a.personality.C;
  }
  for (const a of s.agents) {
    if (a.age < 65) continue;
    const hh = sim.household(a.householdId);
    if (!hh || hh.money > s.market.foodPrice * 3) continue;
    for (const cid of a.children) {
      const c = sim.agent(cid);
      const chh = sim.household(c?.householdId);
      if (!chh || chh === hh || chh.money < 30) continue;
      const gift = Math.min(chh.money * 0.1, s.market.foodPrice * 3);
      chh.money -= gift; hh.money += gift;
      break;
    }
  }
  const poor = s.households.filter(hh => hh.food < householdFoodNeed(sim, hh)).sort((x, y) => x.money - y.money);
  if (!poor.length) return;
  let pool = 0;
  for (const hh of s.households) {
    if (hh.money < 110 * Math.max(1, hh.members.length)) continue;
    const kindness = hh.members.reduce((t, id) => t + (sim.agent(id)?.personality.A ?? 0.5), 0) / hh.members.length;
    const gift = hh.money * 0.012 * kindness * (0.5 + s.culture.trust);
    hh.money -= gift; pool += gift;
  }
  // Alms soften hunger but don't erase it — capped per recipient so charity cushions
  // a bad week rather than fully underwriting a broken economy. Surplus alms go to
  // the temple/state coffers (money stays conserved).
  const per = pool / poor.length;
  const cap = s.market.prices.food * 0.7;
  let given = 0;
  for (const hh of poor) {
    const g = Math.min(per, householdFoodNeed(sim, hh) * cap);
    hh.money += g; given += g;
  }
  s.gov.treasury += pool - given;
}

function pay(sim: Simulation, a: Agent, gross: number) {
  const s = sim.state;
  // Progressive income tax: effective rate rises with pay relative to the average wage
  const progressivity = clamp(gross / Math.max(1, s.market.avgWage * 2), 0.35, 2.2);
  const statutory = s.policy.taxRate * (0.55 + 0.45 * progressivity);
  // Evasion: nobody fully complies at confiscatory rates. The dodged share rises
  // with the rate, weak enforcement and corruption — and stays with the worker
  // as unrecorded informal income, so the treasury sees a Laffer-style flattening.
  const evasion = clamp(Math.max(0, s.policy.taxRate - 0.45) * (0.35 + (1 - s.policy.enforcement) * 0.9 + s.policy.corruption * 0.5), 0, 0.6);
  const tax = gross * statutory * (1 - evasion);
  s.gov.treasury += tax;
  const net = gross - tax;
  const hh = sim.household(a.householdId);
  if (hh) { hh.money += net; hh.income += net; }
  a.income += net;
  return net;
}

function payMarketIncomes(sim: Simulation) {
  const s = sim.state, p = s.policy, m = s.market;
  const working = s.agents.filter(a => a.age >= 18 && a.age < 65);
  const unemployment = working.length ? working.filter(a => a.job === 'unemployed').length / working.length : 0;
  const subsistence = (m.prices.food * 2.1 + m.prices.goods * 0.55) * 1.25;
  const floor = p.wageFloor * subsistence;
  let wageSum = 0, wageN = 0;

  for (const b of s.buildings) {
    const spec = BUILDING_PRODUCTION[b.type];
    const isServiceFirm = b.type === 'market' || b.type === 'bank' || b.type === 'theater' || b.type === 'temple' || b.type === 'clinic' || b.type === 'school';
    if (!spec && !isServiceFirm) continue;
    const workers = b.workers.map(id => sim.agent(id)).filter((a): a is Agent => !!a);
    if (!workers.length) continue;

    // Service firms earn fees paid by wealthier households and commercial activity
    if (isServiceFirm) {
      const feeTarget = workers.length * Math.max(3.5, m.avgWage * 0.9);
      let collected = 0;
      const patrons = s.households.filter(h => h.money > 40);
      if (patrons.length) {
        const perPatron = feeTarget / patrons.length;
        for (const hh of patrons) {
          const take = Math.min(hh.money * 0.04, perPatron);
          hh.money -= take; collected += take;
        }
      }
      for (const a of workers) {
        if (a.jailedUntil > s.day) continue;
        const w = collected / workers.length;
        pay(sim, a, w);
        wageSum += w; wageN++;
      }
      continue;
    }

    const price = m.prices[spec!.good];
    const valuePer = (b.output * price) / workers.length;
    const present = workers.filter(a => a.jailedUntil <= s.day && !isStriking(sim, a));

    if (b.ownerKind === 'private') {
      const owner = sim.household(b.ownerHouseholdId);
      // Owners recapitalize their firm if working capital runs low so workers can be paid —
      // but under confiscatory profit taxes they may refuse to throw good money after bad.
      const payrollNeed = Math.max(floor, valuePer * 0.75) * present.length;
      const investStrike = p.taxRate > 0.55 && sim.rng.chance((p.taxRate - 0.55) * 1.8);
      if (b.cash < payrollNeed && !investStrike && owner && owner.money > payrollNeed * 1.5) {
        const inject = payrollNeed - b.cash + 15;
        owner.money -= inject; b.cash += inject;
      }
      const ownerShare = clamp(0.16 + unemployment * 0.7 - p.wageFloor * 0.15, 0.1, 0.42);
      // Nominal wage rigidity: wages chase the market rate instead of leaping to it,
      // so inflation spikes erode real pay (and deflation overpays) for several days.
      const targetWage = valuePer * (1 - ownerShare);
      b.wage = Math.max(floor, lerp(b.wage > 0 ? b.wage : targetWage, targetWage, 0.3));
      for (const a of present) {
        const g = Math.min(b.wage, Math.max(0, b.cash));
        b.cash -= g;
        pay(sim, a, g);
        wageSum += g; wageN++;
        if (g < b.wage * 0.5) a.grievance = clamp(a.grievance + 0.012);
      }
      const reserve = b.wage * workers.length * 2.2;
      const profit = b.cash - reserve;
      if (profit > 0 && owner) {
        const tax = profit * p.taxRate;
        s.gov.treasury += tax;
        owner.money += profit - tax; owner.income += profit - tax;
        b.cash -= profit;
      }
    } else if (b.ownerKind === 'collective') {
      const reserve = 6 * workers.length;
      const pool = Math.max(0, b.cash - reserve);
      const share = present.length ? pool / present.length : 0;
      b.wage = share;
      for (const a of present) { pay(sim, a, share); wageSum += share; wageN++; }
      b.cash -= pool;
    } else {
      s.gov.treasury += b.cash; b.cash = 0;
      const stateTarget = Math.max(floor, m.avgWage * (0.6 + 0.4 * (1 - p.wageFloor)) + valuePer * 0.4 * (1 - p.wageFloor));
      b.wage = lerp(b.wage > 0 ? b.wage : stateTarget, stateTarget, 0.25);
      for (const a of present) {
        const g = Math.min(b.wage, Math.max(0, s.gov.treasury));
        s.gov.treasury -= g; pay(sim, a, g); wageSum += g; wageN++;
      }
    }
  }
  if (wageN) m.avgWage = m.avgWage * 0.8 + (wageSum / wageN) * 0.2;
}

/** Commercial banking: credit for distressed households/firms, interest payments, and debt defaults. */
function runBankingAndDebt(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const banks = sim.buildingsOf('bank');
  const dailyRate = p.interestRate / 30;
  let totalDebt = 0;

  for (const hh of s.households) {
    // Distressed households borrow from banks to avoid starvation or eviction
    const needCash = householdFoodNeed(sim, hh) * s.market.prices.food * 1.5;
    if (banks.length > 0 && hh.money < needCash * 0.45 && hh.debt < 35 * hh.members.length) {
        const loan = Math.min(5, needCash * 0.45);
      hh.money += loan;
      hh.debt += loan;
    }
    if (hh.debt > 0) {
      const interest = hh.debt * dailyRate;
      hh.debt += interest;
      // Pay down debt out of surplus cash
      const paydown = Math.min(hh.debt, Math.max(0, hh.money - needCash * 0.8) * 0.35);
      hh.money -= paydown;
      hh.debt -= paydown;
      // Pay interest to bank owners
      const bankOwner = sim.household(banks[0]?.ownerHouseholdId);
      if (bankOwner && paydown > 0) {
        const ownerInterest = Math.min(paydown, interest);
        bankOwner.money += ownerInterest * (1 - p.taxRate);
        s.gov.treasury += ownerInterest * p.taxRate;
      }
      // Debt default / restructuring
      if (hh.debt > 65 * Math.max(1, hh.members.length) && hh.money < 4) {
        hh.debt *= 0.4;
        s.counters.defaults++;
        s.market.defaultCount++;
        for (const id of hh.members) {
          const a = sim.agent(id);
          if (a) { a.grievance = clamp(a.grievance + 0.1); sim.remember(a, 'Defaulted on household debt.'); }
        }
      }
      totalDebt += hh.debt;
    }
  }
  s.market.totalPrivateDebt = totalDebt;
}

// ---------------------------------------------------------------- planned economy

function eliteWeight(sim: Simulation, hh: Household) {
  const c = sim.state.policy.corruption;
  const ruling = sim.state.gov.rulingFactionId;
  const elite = hh.members.some(id => {
    const a = sim.agent(id);
    return a && (a.job === 'official' || a.job === 'scholar' || (ruling != null && a.factionId === ruling && a.commitment > 0.5));
  });
  return elite ? 1 + c * 2.8 : 1;
}

function plannedDistribution(sim: Simulation) {
  const s = sim.state, p = s.policy, pl = s.plan;
  const pop = Math.max(1, s.agents.length);
  const strat = PLANNING_STRATEGIES[p.planningStrategy]?.weights ?? PLANNING_STRATEGIES.balanced.weights;

  // Update Gosplan quotas & fulfillment metrics
  pl.planCycleDay = (pl.planCycleDay + 1) % 150;
  pl.fiveYearProgress = pl.planCycleDay / 150;
  const totalFoodNeed = s.households.reduce((t, hh) => t + householdFoodNeed(sim, hh), 0);
  pl.quotas = {
    food: totalFoodNeed * 1.08 * strat.food,
    raw: pop * 0.25 * strat.raw,
    goods: pop * (GOODS_WANT + HEATING_AVG) * 1.05 * strat.goods,
    tools: pop * 0.045 * strat.tools,
    luxury: pop * LUXURY_WANT * strat.luxury,
  };
  for (const g of GOODS) {
    const target = Math.max(0.5, pl.quotas[g]);
    pl.fulfilled[g] = lerp(pl.fulfilled[g], clamp(s.market.produced[g] / target, 0, 2), 0.2);
  }

  const hhs = s.households;
  const season = seasonOf(s.day);
  const rationDays = season === 'autumn' ? 3.2 : season === 'winter' ? 4 : 2.1;
  const weights = hhs.map(hh => householdFoodNeed(sim, hh) * eliteWeight(sim, hh));
  const totalW = weights.reduce((a, b) => a + b, 0) || 1;
  const foodPool = Math.min(s.store.food * 0.65, totalW * rationDays);
  const goodsPool = Math.min(s.store.goods * 0.55, totalW * GOODS_WANT * 2.1);
  const luxPool = Math.min(s.store.luxury * 0.45, totalW * LUXURY_WANT * 1.8);

  let unmetFood = 0, unmetGoods = 0;
  hhs.forEach((hh, i) => {
    const fWant = Math.max(0, householdFoodNeed(sim, hh) * rationDays * eliteWeight(sim, hh) - hh.food);
    const fGive = Math.min(fWant, (foodPool * weights[i]) / totalW);
    hh.food += fGive; s.store.food -= fGive; s.market.consumed.food += fGive;
    if (fGive < fWant * 0.85) unmetFood += fWant - fGive;

    const gWant = Math.max(0, hh.members.length * (GOODS_WANT * 2 + seasonalHeatingNeed(s.day) * HEATING_PER_CAPITA * 2) * eliteWeight(sim, hh) - hh.goods);
    const gGive = Math.min(gWant, (goodsPool * weights[i]) / totalW);
    hh.goods += gGive; s.store.goods -= gGive; s.market.consumed.goods += gGive;
    if (gGive < gWant * 0.85) unmetGoods += gWant - gGive;

    const lWant = Math.max(0, hh.members.length * LUXURY_WANT * 1.6 * eliteWeight(sim, hh) - hh.luxury);
    const lGive = Math.min(lWant, (luxPool * weights[i]) / totalW);
    hh.luxury += lGive; s.store.luxury -= lGive; s.market.consumed.luxury += lGive;
  });

  // Compute shortage severity, queue length, and shadow/black market activity
  pl.shortageSeverity.food = clamp(1 - s.store.food / Math.max(1, totalFoodNeed * 2.5));
  pl.shortageSeverity.raw = clamp(1 - s.store.raw / Math.max(1, pop * 0.8));
  pl.shortageSeverity.goods = clamp(1 - s.store.goods / Math.max(1, pop * GOODS_WANT * 3));
  pl.shortageSeverity.tools = clamp(1 - s.store.tools / Math.max(1, pop * 0.3));
  pl.shortageSeverity.luxury = clamp(1 - s.store.luxury / Math.max(1, pop * LUXURY_WANT * 3));

  const avgShortage = (pl.shortageSeverity.food * 0.45 + pl.shortageSeverity.goods * 0.35 + pl.shortageSeverity.luxury * 0.2);
  pl.rationLevel = clamp(1 - avgShortage * 0.7, 0.25, 1.2);
  pl.queueHours = clamp(avgShortage * 4.5 * (1.2 - p.planningEfficiency * 0.5), 0, 4);
  pl.blackMarketShare = clamp(avgShortage * (0.4 + p.corruption * 0.8) * (1.1 - p.enforcement * 0.5), 0, 0.65);

  // State wages & black market / state shop purchases
  const wage = 3.2;
  for (const a of s.agents) {
    if (!isWorkingJob(a.job) || a.jailedUntil > s.day) continue;
    const bonus = a.job === 'official' ? 1 + p.corruption * 2.5 : a.job === 'scholar' || a.job === 'factory_worker' ? 1.15 : 1;
    const hh = sim.household(a.householdId);
    // Wages come out of the state budget (which may run a deficit = monetary issue) — they are
    // not minted per worker; state shop sales below recycle the money back to the treasury
    if (hh) { hh.money += wage * bonus; hh.income += wage * bonus; s.gov.treasury -= wage * bonus; }
    a.income = wage * bonus;
  }
  // Monetary overhang: when households sit on cash they can't spend, the state raises shop
  // prices (and sells "commercial" goods at a premium) to soak it up
  const cashPerCap = hhs.reduce((t, hh) => t + Math.max(0, hh.money), 0) / pop;
  const shopMarkup = clamp(cashPerCap / 35, 1, 3.5);
  for (const hh of sim.rng.shuffle([...hhs])) {
    const spend = Math.max(0, hh.money - 10) * 0.16;
    const gp = 6 * shopMarkup, fp = 3 * shopMarkup;
    const g = Math.min(Math.max(0, s.store.goods - pop * 0.4) * 0.025, spend / gp);
    const f = Math.min(Math.max(0, s.store.food - pop * 2.5) * 0.025, (spend - g * gp) / fp);
    hh.goods += g; hh.food += f; s.store.goods -= g; s.store.food -= f;
    hh.money -= g * gp + f * fp; s.gov.treasury += g * gp + f * fp;
  }
  // Services, rents, transport and savings bonds also return cash to the state
  for (const hh of hhs) {
    const levy = Math.max(0, hh.money - 25 * hh.members.length) * 0.02;
    hh.money -= levy; s.gov.treasury += levy;
  }
  void unmetFood; void unmetGoods;
  s.market.avgWage = wage;
}

// ---------------------------------------------------------------- commons

function commonsDistribution(sim: Simulation) {
  const s = sim.state;
  const trust = s.culture.trust;
  const hhs = sim.rng.shuffle([...s.households]);
  const season = seasonOf(s.day);
  const stockTarget = season === 'autumn' ? 3.6 : season === 'winter' ? 4.5 : 2.2;
  const greed = (hh: Household) => {
    const adults = hh.members.map(id => sim.agent(id)!).filter(a => a && a.age >= 18);
    const c = adults.length ? adults.reduce((t, a) => t + agentCollectivism(sim, a), 0) / adults.length : 0.5;
    return 1 + (1 - c) * (1 - trust) * 1.25;
  };
  const wants = hhs.map(hh => ({
    hh,
    f: Math.max(0, householdFoodNeed(sim, hh) * stockTarget * greed(hh) - hh.food),
    g: Math.max(0, hh.members.length * (GOODS_WANT * 2 + seasonalHeatingNeed(s.day) * HEATING_PER_CAPITA * 2) * greed(hh) - hh.goods),
    l: Math.max(0, hh.members.length * LUXURY_WANT * 1.5 * greed(hh) - hh.luxury),
  }));
  const totalF = wants.reduce((t, w) => t + w.f, 0);
  const totalG = wants.reduce((t, w) => t + w.g, 0);
  const totalL = wants.reduce((t, w) => t + w.l, 0);
  const rf = totalF > 0 ? Math.min(1, (s.store.food * 0.72) / totalF) : 0;
  const rg = totalG > 0 ? Math.min(1, (s.store.goods * 0.65) / totalG) : 0;
  const rl = totalL > 0 ? Math.min(1, (s.store.luxury * 0.6) / totalL) : 0;
  for (const w of wants) {
    w.hh.food += w.f * rf; s.store.food -= w.f * rf; s.market.consumed.food += w.f * rf;
    w.hh.goods += w.g * rg; s.store.goods -= w.g * rg; s.market.consumed.goods += w.g * rg;
    w.hh.luxury += w.l * rl; s.store.luxury -= w.l * rl; s.market.consumed.luxury += w.l * rl;
  }
  // Mutual aid: neighbours share from personal stores when the common pool runs short —
  // how much flows depends on solidarity (collectivism × trust)
  const aid = clamp(trust * 0.5 + s.culture.collectivism * 0.4, 0, 0.8);
  if (aid > 0.05) {
    const hungry = hhs.filter(hh => hh.food < householdFoodNeed(sim, hh));
    const surplus = hhs.filter(hh => hh.food > householdFoodNeed(sim, hh) * 2.5);
    if (hungry.length && surplus.length) {
      let pool = 0;
      for (const d of surplus) { const give = (d.food - householdFoodNeed(sim, d) * 2) * 0.25 * aid; d.food -= give; pool += give; }
      const per = pool / hungry.length;
      for (const hh of hungry) hh.food += per;
    }
  }
  s.market.avgWage = 0;
}

// ---------------------------------------------------------------- government

function governmentSpending(sim: Simulation) {
  const s = sim.state, p = s.policy, g = s.gov;
  if (p.allocation === 'commons') return;
  const officials = s.agents.filter(a => a.job === 'official');
  if (p.corruption > 0 && g.treasury > 0 && officials.length) {
    const skim = g.treasury * p.corruption * 0.018;
    g.treasury -= skim;
    const leaderHh = (p.governance === 'autocracy' || p.governance === 'monarchy') ? sim.household(sim.agent(g.leaderId)?.householdId) : undefined;
    const leaderCut = leaderHh ? skim * 0.4 : 0;
    if (leaderHh) { leaderHh.money += leaderCut; leaderHh.income += leaderCut; }
    const share = (skim - leaderCut) / officials.length;
    for (const o of officials) { const hh = sim.household(o.householdId); if (hh) { hh.money += share; hh.income += share; } }
  }
  if (p.allocation !== 'market') return;

  const wage = Math.max(3, s.market.avgWage);
  for (const a of s.agents) {
    // In market societies healers & teachers earn fees at their firm, not a state salary
    const feePaid = p.allocation === 'market' && (a.job === 'healer' || a.job === 'teacher');
    const isPublic = (PUBLIC_JOBS.includes(a.job) && !feePaid) || (a.job === 'artist' && p.culturalSubsidy > 0.3) || (a.job === 'priest' && p.governance === 'monarchy');
    if (!isPublic || a.jailedUntil > s.day) continue;
    if (a.job === 'builder' && p.ownership === 'private') continue;
    const amount = Math.min(wage, Math.max(0, g.treasury));
    g.treasury -= amount;
    pay(sim, a, amount);
    if (amount < wage * 0.5) a.grievance = clamp(a.grievance + 0.01);
  }

  // Pensions
  if (p.governance !== 'none') {
    const pension = Math.max(1, s.market.avgWage) * (0.2 + 0.5 * p.welfare);
    for (const a of s.agents) {
      if (a.job !== 'retired' || g.treasury <= 0) continue;
      const amt = Math.min(pension, g.treasury);
      g.treasury -= amt;
      const hh = sim.household(a.householdId);
      if (hh) { hh.money += amt; hh.income += amt; }
      a.income = amt;
    }
  }

  // Welfare transfers to poor & unemployed households
  if (p.welfare > 0 && g.treasury > 0) {
    const perCap = s.households.map(hh => hh.income / Math.max(1, hh.members.length)).sort((a, b) => a - b);
    const median = perCap[Math.floor(perCap.length / 2)] ?? 0;
    const threshold = Math.max(median * 0.75, s.market.foodPrice * 1.25);
    const poor = s.households.filter(hh => hh.income / Math.max(1, hh.members.length) < threshold);
    const budget = Math.min(g.treasury * 0.16 * p.welfare, poor.length * threshold * 3);
    const members = poor.reduce((t, hh) => t + hh.members.length, 0);
    if (members > 0) {
      for (const hh of poor) { const amt = (budget * hh.members.length) / members; hh.money += amt; hh.income += amt; }
      g.treasury -= budget;
    }
  }

  // Property/wealth levy on large fortunes (cash + real estate value, paid from cash) — this is
  // what actually compresses inequality under high-tax regimes; negligible at low tax rates
  if (p.taxRate > 0.08) {
    const wealth = householdWealth(sim);
    const vals = s.households.map(hh => wealth.get(hh.id) ?? 0).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)] ?? 0;
    const levyBase = Math.max(250, median * 6);
    for (const hh of s.households) {
      const excess = Math.max(0, (wealth.get(hh.id) ?? 0) - levyBase);
      if (excess <= 0) continue;
      const levy = Math.min(Math.max(0, hh.money) * 0.5, excess * p.taxRate * 0.02);
      hh.money -= levy; s.gov.treasury += levy;
    }
  }

  // A hoarding treasury starves the economy: large surpluses are returned as tax rebates
  // and public works wages rather than sitting idle
  const reserveTarget = 300 + s.agents.length * 4;
  if (g.treasury > reserveTarget * 1.35 && s.households.length) {
    const dividend = (g.treasury - reserveTarget * 1.35) * 0.04;
    const per = dividend / s.households.length;
    for (const hh of s.households) { hh.money += per; hh.income += per; }
    g.treasury -= dividend;
  }

  // Surplus treasury procures food reserves
  if (g.treasury > reserveTarget) {
    let budget = (g.treasury - reserveTarget) * 0.05;
    for (const b of sim.buildingsOf('farm')) {
      if (budget <= 0) break;
      const take = Math.min(b.stock * 0.3, budget / s.market.foodPrice);
      b.stock -= take; s.store.food += take; b.cash += take * s.market.foodPrice;
      budget -= take * s.market.foodPrice; g.treasury -= take * s.market.foodPrice;
    }
  }
  if (s.store.food > 0) {
    for (const hh of s.households) {
      const need = householdFoodNeed(sim, hh);
      if (hh.food < need && s.store.food > 0) {
        const f = Math.min(need - hh.food, s.store.food, need * (0.3 + p.welfare));
        hh.food += f; s.store.food -= f;
      }
    }
  }
}

function collectRent(sim: Simulation) {
  const s = sim.state;
  if (s.policy.allocation !== 'market') return;
  const rentPer = s.market.foodPrice * 0.18;
  for (const hh of s.households) {
    const home = sim.building(hh.homeId);
    if (!home || home.ownerKind !== 'private' || home.ownerHouseholdId == null || home.ownerHouseholdId === hh.id) { hh.arrears = 0; continue; }
    const owner = sim.household(home.ownerHouseholdId);
    const mult = home.type === 'tenement' ? 0.7 : home.type === 'manor' ? 1.8 : 1.0;
    const rent = rentPer * hh.members.length * mult;
    if (hh.money >= rent) {
      hh.money -= rent; hh.arrears = Math.max(0, hh.arrears - 1);
      if (owner) { const tax = rent * s.policy.taxRate; owner.money += rent - tax; owner.income += rent - tax; s.gov.treasury += tax; }
    } else if (++hh.arrears > 14) {
      sim.moveIn(hh, null);
      hh.arrears = 0;
      for (const id of hh.members) { const a = sim.agent(id); if (a) { sim.remember(a, 'Evicted for unpaid rent.'); a.grievance = clamp(a.grievance + 0.18); } }
      sim.log(`The ${sim.agent(hh.members[0])?.name.split(' ')[1] ?? ''} household was evicted for unpaid rent.`, 'economy', hh.members[0]);
    }
  }
}

// ---------------------------------------------------------------- consumption & housing

function consume(sim: Simulation) {
  const s = sim.state;
  for (const hh of s.households) {
    const need = householdFoodNeed(sim, hh);
    const eat = Math.min(hh.food, need);
    hh.food -= eat;
    hh.food *= 0.985;
    s.market.consumed.food += eat;
    const sat = need > 0 ? eat / need : 1;

    // Cold seasons burn goods as fuel — heating comes before discretionary use, since a
    // freezing household sacrifices new clothes before firewood
    const cold = seasonalHeatingNeed(s.day);
    const fuelNeed = hh.members.length * cold * HEATING_PER_CAPITA;
    const burn = Math.min(hh.goods, fuelNeed);
    hh.goods -= burn;
    s.market.consumed.goods += burn;
    s.market.demand.goods += fuelNeed * 0.6;
    const warmth = fuelNeed > 0 ? burn / fuelNeed : 1;

    const goodsNeed = hh.members.length * GOODS_WANT;
    const use = Math.min(hh.goods, Math.max(goodsNeed, hh.goods * 0.28));
    hh.goods -= use;
    s.market.consumed.goods += use;

    const luxNeed = hh.members.length * LUXURY_WANT;
    const useLux = Math.min(hh.luxury, Math.max(luxNeed, hh.luxury * 0.25));
    hh.luxury -= useLux;
    s.market.consumed.luxury += useLux;
    const luxBonus = Math.min(0.22, (luxNeed > 0 ? useLux / luxNeed : 0) * 0.16);

    const variety = s.policy.allocation === 'planned' ? 0.55 + 0.4 * s.policy.planningEfficiency - s.plan.queueHours * 0.04 : 1;
    const home = sim.building(hh.homeId);
    const insulation = home ? (0.55 + 0.45 * (home.condition ?? 1)) : 0;
    const housingQuality = !home ? 0 : (home.type === 'manor' ? 0.32 : home.type === 'tenement' ? 0.18 : 0.25) * insulation;
    const comfort = clamp((Math.min(1, goodsNeed > 0 ? use / goodsNeed : 1) * 0.68 * variety + housingQuality + luxBonus) * (0.72 + 0.28 * warmth));

    for (const id of hh.members) {
      const a = sim.agent(id);
      if (!a) continue;
      a.needs.food = a.needs.food * 0.4 + sat * 0.6;
      a.hungerDays = sat < 0.5 ? a.hungerDays + 1 : Math.max(0, a.hungerDays - 2);
      a.needs.comfort = a.needs.comfort * 0.7 + comfort * 0.3;
      // Exposure: homelessness in the cold is dangerous
      // The very young and the old are the ones who die of cold
      const frail = a.age < 5 || a.age > 65 ? 1.6 : 1;
      if (!home && cold > 0) a.needs.health = clamp(a.needs.health - cold * 0.12 * (1 - warmth * 0.5) * frail);
      else if (warmth < 0.4 && cold > 0) a.needs.health = clamp(a.needs.health - cold * 0.03 * (1 - warmth) * frail);
    }
  }
}

const occupants = (sim: Simulation, b: Building) => b.residents.reduce((t, id) => t + (sim.household(id)?.members.length ?? 0), 0);

function housing(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const homes = [...sim.buildingsOf('house'), ...sim.buildingsOf('tenement'), ...sim.buildingsOf('manor')];
  const rent = (hh: Household) => s.market.foodPrice * 0.18 * hh.members.length;
  const canRent = (hh: Household) => p.allocation !== 'market' || hh.income >= rent(hh) || hh.money >= rent(hh) * 3;
  const homeless = s.households.filter(hh => hh.homeId == null);
  for (const hh of homeless) {
    const ok = canRent(hh);
    const options = homes.filter(b => occupants(sim, b) + hh.members.length <= b.capacity && (ok || b.ownerKind !== 'private' || b.ownerHouseholdId === hh.id));
    if (options.length) sim.moveIn(hh, options.reduce((a, b) => (occupants(sim, a) <= occupants(sim, b) ? a : b)));
  }
  // Tenant buyouts: a renting household with substantial savings can buy its home from the
  // landlord — the main path by which property ownership diffuses through the middle class
  if (p.allocation === 'market' && p.ownership === 'private') {
    for (const hh of s.households) {
      const home = sim.building(hh.homeId);
      if (!home || home.type === 'tenement' || home.ownerKind !== 'private' || home.ownerHouseholdId == null || home.ownerHouseholdId === hh.id) continue;
      const price = home.type === 'manor' ? 320 : 150;
      if (hh.money < price * 1.7 || !sim.rng.chance(0.005)) continue;
      const seller = sim.household(home.ownerHouseholdId);
      const paid = price + sim.rng.range(0, 50);
      hh.money -= paid;
      if (seller) { seller.money += paid; seller.income += paid; } else s.gov.treasury += paid;
      home.ownerHouseholdId = hh.id;
      for (const id of hh.members) { const a = sim.agent(id); if (a) sim.remember(a, 'We bought our home.'); }
      if (sim.rng.chance(0.4)) sim.log(`The ${sim.agent(hh.members[0])?.name.split(' ')[1] ?? ''} family bought their home.`, 'economy', hh.members[0]);
    }
  }

  const totalCap = homes.reduce((t, b) => t + b.capacity, 0);
  const people = s.agents.length;
  const stillHomeless = s.households.filter(hh => hh.homeId == null && canRent(hh)).length;
  const sites = s.buildings.filter(b => !b.complete);
  if (sites.length < 2 && ((stillHomeless > 0 && people > totalCap * 0.6) || people > totalCap * 0.85)) startConstruction(sim);

  const builders = s.agents.filter(a => a.job === 'builder' && a.jailedUntil <= s.day && !isStriking(sim, a));
  // No active site? Builders keep the town standing — repair the most dilapidated structure
  if (!sites.length && builders.length) {
    const worst = s.buildings.filter(b => b.complete && (b.condition ?? 1) < 0.85).sort((a, b) => a.condition - b.condition)[0];
    if (worst) worst.condition = Math.min(1, worst.condition + builders.length * 0.02);
  }
  if (sites.length && builders.length) {
    const site = sites[0];
    const work = builders.reduce((t, a) => t + productivity(sim, a, site), 0) * BUILD_RATE;
    site.progress = Math.min(1, site.progress + work);
    if (p.allocation === 'market' && p.ownership === 'private') {
      const wage = Math.max(3, s.market.avgWage);
      for (const a of builders) { const g = Math.min(wage, Math.max(0, site.cash)); site.cash -= g; pay(sim, a, g); }
    }
    if (site.progress >= 1) {
      site.complete = true;
      site.capacity = site.type === 'tenement' ? 14 : site.type === 'manor' ? 7 : 5;
      site.size.h = site.type === 'tenement' ? 6.8 : site.type === 'manor' ? 4.8 : 3.0;
      const funder = sim.household(site.ownerHouseholdId);
      if (funder) funder.money += site.cash; else s.gov.treasury += site.cash;
      site.cash = 0;
      sim.invalidateBuildings();
      sim.log(`A new ${site.type} was completed.`, 'economy');
    }
  }
}

function startConstruction(sim: Simulation) {
  const s = sim.state, p = s.policy;
  let owner: Household | undefined;
  const buildType: BuildingType = s.agents.length > 320 && sim.rng.chance(0.45) ? 'tenement' : 'house';
  if (p.allocation === 'commons') {
    if (s.store.raw < 15) return;
    s.store.raw -= 15;
  } else if (p.ownership === 'private' && p.allocation === 'market') {
    // Prefer a homeless household that can mostly pay for its own home (self-build + mortgage);
    // otherwise a random landlord investor — never automatically the single richest family.
    const selfBuilder = s.households
      .filter(hh => hh.homeId == null && hh.money > HOUSE_COST * 0.5)
      .sort((a, b) => b.money - a.money)[0];
    if (buildType === 'house' && selfBuilder) {
      const paid = Math.min(selfBuilder.money, HOUSE_COST * 0.85);
      selfBuilder.money -= paid;
      selfBuilder.debt += (HOUSE_COST - paid) * 1.25;
      owner = selfBuilder;
    } else {
      const investors = [...s.households].sort((a, b) => b.money - a.money).slice(0, 12).filter(h => h.money > HOUSE_COST * 1.4);
      owner = investors.length ? sim.rng.pick(investors) : undefined;
      if (!owner) return;
      owner.money -= HOUSE_COST;
    }
  } else {
    if (s.gov.treasury < HOUSE_COST) return;
    s.gov.treasury -= HOUSE_COST;
  }
  const site = sim.addBuilding(buildType, sim.takeFreeCell(buildType), false);
  site.capacity = 0; site.size.h = 0.4;
  site.ownerKind = owner ? 'private' : p.ownership === 'private' ? 'state' : p.ownership;
  site.ownerHouseholdId = owner?.id ?? null;
  site.cash = owner ? HOUSE_COST : 0;
}

function updateMacroMetrics(sim: Simulation) {
  const s = sim.state, m = s.market;
  const hhMoney = s.households.reduce((t, h) => t + h.money, 0);
  const firmMoney = s.buildings.reduce((t, b) => t + Math.max(0, b.cash), 0);
  m.moneySupply = hhMoney + firmMoney + Math.max(0, s.gov.treasury);

  const prevIndex = m.priceIndex || 1;
  const idx = (
    (m.prices.food / BASE_PRICES.food) * 0.4 +
    (m.prices.goods / BASE_PRICES.goods) * 0.28 +
    (m.prices.raw / BASE_PRICES.raw) * 0.12 +
    (m.prices.tools / BASE_PRICES.tools) * 0.1 +
    (m.prices.luxury / BASE_PRICES.luxury) * 0.1
  );
  m.priceIndex = lerp(prevIndex, idx, 0.15);
  const dailyInf = (m.priceIndex - prevIndex) / Math.max(0.2, prevIndex);
  m.inflationRate = lerp(m.inflationRate, clamp(dailyInf * 30, -0.5, 1.5), 0.08);
}
