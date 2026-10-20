import { Rng, clamp, lerp } from './rng';
import { firstName, surname } from './names';
import { positionFromPolicy, regimeName, clonePolicy, cloneCulture } from './presets';
import type {
  Agent, Beliefs, Building, BuildingType, EventKind, Good, Household, Personality, Scene, SimEvent, Subculture, Vec2, WorldConfig, WorldState,
} from './types';
import { DAYS_PER_YEAR as DAYS_PER_YEAR_CONST } from './types';
import { runEconomyDay, BUILDING_PRODUCTION } from './economy';
import { runSocietyDay } from './society';
import { runPoliticsDay, createEstablishment, handleLeaderDeath } from './politics';
import { updateAgentHour, moveAgent } from './behavior';
import { recordStats } from './stats';
import { genTerrain, isWater, siteQuality } from './terrain';
import { updateEnvironmentDay } from './environment';

export const TICKS_PER_HOUR = 4;
export const DAYS_PER_YEAR = DAYS_PER_YEAR_CONST;
export const CELL = 9.5;
export const STATE_VERSION = 8;

/** Per-version upgraders: key = version being migrated FROM. Fill new fields with
 *  deterministic defaults so old saves keep loading. */
const MIGRATIONS: Record<number, (s: any) => void> = {
  2: s => {
    s.gov.lastRiot ??= -999;
    s.counters.crimes ??= 0;
    for (const f of s.factions ?? []) { f.founding ??= { ...f.platform }; f.lastPurge ??= -999; }
  },
  3: s => { s.terrain = genTerrain(new Rng(((s.config?.seed ?? 1) >>> 0) ^ 0x51ed2b)); },
  4: s => {
    s.weather = { kind: 'clear', daysLeft: 3 };
    for (const b of s.buildings) b.condition ??= 1;
  },
  5: s => {
    // Institutions: constitution defaults inferred from existing policy; parliament & party fields
    s.policy.electoralSystem ??= 'fptp';
    s.policy.suffrage ??= s.policy.governance === 'democracy' ? 0.85 : 0.3;
    s.policy.termLimits ??= 0;
    s.policy.judiciary ??= 0.5;
    s.policy.pressFreedom ??= Math.max(0.05, s.policy.civilLiberty);
    s.policy.militaryPower ??= 0.3;
    s.gov.coalition ??= s.gov.rulingFactionId != null ? [s.gov.rulingFactionId] : [];
    s.gov.parliament ??= [];
    s.gov.caretaker ??= false;
    s.gov.termsServed ??= 0;
    s.gov.martialLaw ??= 0;
    s.gov.scandal ??= 0;
    s.gov.pentUp ??= 0;
    for (const f of s.factions ?? []) {
      f.leaderId ??= f.founderId;
      f.treasury ??= 0;
      f.seats ??= 0;
    }
  },
  6: s => {
    // Authoritarian realism: adaptive expectations, security loyalty, thaw/tighten cadence
    s.culture.comfortNorm ??= -1;
    s.gov.securityLoyalty ??= 0.75;
    s.gov.lastCourse ??= s.day ?? 0;
  },
  7: s => { s.gov.lastMerge ??= -999; },
};

export const BUILDING_SPECS: Record<BuildingType, { w: number; d: number; h: number; cap: number }> = {
  house: { w: 4.2, d: 4.2, h: 3.0, cap: 5 },
  tenement: { w: 5.8, d: 5.8, h: 6.8, cap: 14 },
  manor: { w: 6.8, d: 6.2, h: 4.8, cap: 7 },
  farm: { w: 8.2, d: 8.2, h: 0.35, cap: 6 },
  mill: { w: 4.8, d: 4.8, h: 6.2, cap: 5 },
  bakery: { w: 5.2, d: 4.8, h: 3.6, cap: 5 },
  lumber_camp: { w: 7.4, d: 7.0, h: 2.4, cap: 6 },
  mine: { w: 7.2, d: 7.2, h: 3.2, cap: 7 },
  workshop: { w: 6.0, d: 5.2, h: 3.8, cap: 6 },
  smithy: { w: 5.6, d: 5.2, h: 4.0, cap: 6 },
  tailor_shop: { w: 5.2, d: 4.8, h: 3.6, cap: 5 },
  factory: { w: 7.6, d: 6.8, h: 5.8, cap: 12 },
  warehouse: { w: 6.8, d: 5.8, h: 4.0, cap: 4 },
  market: { w: 7.6, d: 7.6, h: 2.2, cap: 6 },
  bank: { w: 6.2, d: 5.8, h: 5.4, cap: 5 },
  tavern: { w: 5.8, d: 5.4, h: 3.8, cap: 5 },
  theater: { w: 7.0, d: 6.4, h: 5.2, cap: 6 },
  clinic: { w: 6.2, d: 5.4, h: 4.2, cap: 6 },
  school: { w: 6.8, d: 5.4, h: 3.8, cap: 6 },
  university: { w: 7.6, d: 6.6, h: 6.0, cap: 6 },
  temple: { w: 6.4, d: 7.4, h: 7.2, cap: 5 },
  townhall: { w: 7.6, d: 7.4, h: 8.2, cap: 8 },
  guardhouse: { w: 5.6, d: 5.6, h: 5.2, cap: 8 },
  prison: { w: 6.6, d: 6.6, h: 4.4, cap: 12 },
  yard: { w: 7.0, d: 7.0, h: 1.2, cap: 8 },
  plaza: { w: 8.4, d: 8.4, h: 0.18, cap: 0 },
  monument: { w: 5.2, d: 5.2, h: 7.5, cap: 0 },
};

const zeroGoods = (): Record<Good, number> => ({ food: 0, raw: 0, goods: 0, tools: 0, luxury: 0 });

export class Simulation {
  state: WorldState;
  rng: Rng;
  agentMap = new Map<number, Agent>();
  householdMap = new Map<number, Household>();
  buildingMap = new Map<number, Building>();
  freeCells: Vec2[] = [];
  /** building id -> agent ids gathered there during evening leisure (for socialising). */
  gatherings = new Map<number, number[]>();
  listeners: ((e: SimEvent) => void)[] = [];
  private typeCache: Map<BuildingType, Building[]> | null = null;
  /** Uniform grid: cell key -> agent ids. Rebuilt each hour for proximity queries. */
  private spatialGrid = new Map<number, number[]>();
  private static SPATIAL_CELL = 12;

  constructor(state: WorldState) {
    this.state = state;
    this.rng = new Rng(state.rngState);
    this.reindex();
    this.computeFreeCells();
  }

  // ---------- construction ----------

  static create(config: WorldConfig): Simulation {
    const policy = clonePolicy(config.policy);
    const culture = cloneCulture(config.culture);
    const pop = config.population;
    const basePrices: Record<Good, number> = { food: 2.0, raw: 1.6, goods: 3.2, tools: 4.5, luxury: 6.5 };
    const state: WorldState = {
      version: STATE_VERSION,
      config: { ...config, policy: clonePolicy(policy), culture: cloneCulture(culture) },
      tick: 0, day: 0, hour: 6,
      agents: [], households: [], buildings: [], factions: [],
      gov: {
        regimeName: regimeName(policy), position: positionFromPolicy(policy), leaderId: null, rulingFactionId: null,
        treasury: 300 + pop * 4, stateDebt: 0, legitimacy: 0.65, since: 0, lastElection: 0, revolutions: 0, elections: 0, lastRiot: -999,
        coalition: [], parliament: [], caretaker: false, termsServed: 0, martialLaw: 0, scandal: 0, pentUp: 0,
        securityLoyalty: 0.8, lastCourse: 0, lastMerge: -999,
      },
      policy,
      culture: { ...culture, comfortNorm: -1 },
      market: {
        prices: { ...basePrices },
        demand: zeroGoods(),
        supply: zeroGoods(),
        produced: zeroGoods(),
        consumed: zeroGoods(),
        spoiled: zeroGoods(),
        foodPrice: 2.0, goodsPrice: 3.2,
        foodDemand: 0, foodSupply: 0, goodsDemand: 0, goodsSupply: 0,
        avgWage: 5.0,
        priceIndex: 1.0,
        inflationRate: 0,
        moneySupply: 0,
        totalPrivateDebt: 0,
        defaultCount: 0,
      },
      plan: {
        strategy: policy.planningStrategy,
        quotas: { food: pop * 1.1, raw: pop * 0.4, goods: pop * 0.4, tools: pop * 0.12, luxury: pop * 0.08 },
        fulfilled: { food: 1, raw: 1, goods: 1, tools: 1, luxury: 1 },
        shortageSeverity: zeroGoods(),
        queueHours: 0,
        blackMarketShare: 0,
        planCycleDay: 0,
        fiveYearProgress: 0,
        rationLevel: 1.0,
      },
      store: { food: pop * 7, raw: pop * 3, goods: pop * 2.5, tools: pop * 1.2, luxury: pop * 0.6 },
      harvest: 1,
      // Dedicated stream so terrain generation doesn't perturb the simulation RNG
      terrain: genTerrain(new Rng(((config.seed >>> 0) || 1) ^ 0x51ed2b)),
      weather: { kind: 'clear', daysLeft: 3 },
      stats: [], events: [],
      counters: { births: 0, deaths: 0, crimes: 0, divorces: 0, defaults: 0 },
      nextId: 1,
      rngState: config.seed >>> 0 || 1,
      graveyard: 0,
    };
    const sim = new Simulation(state);
    sim.generateWorld();
    createEstablishment(sim);
    sim.log(`${state.gov.regimeName} founded with ${state.agents.length} citizens across ${state.buildings.length} structures.`, 'politics');
    runEconomyDay(sim);
    recordStats(sim);
    return sim;
  }

  nextId() { return this.state.nextId++; }

  reindex() {
    this.agentMap.clear(); this.householdMap.clear(); this.buildingMap.clear();
    for (const a of this.state.agents) this.agentMap.set(a.id, a);
    for (const h of this.state.households) this.householdMap.set(h.id, h);
    for (const b of this.state.buildings) this.buildingMap.set(b.id, b);
    this.invalidateBuildings();
  }

  private gridCells(radiusCells: number): Vec2[] {
    const cells: Vec2[] = [];
    for (let i = -radiusCells; i <= radiusCells; i++)
      for (let j = -radiusCells; j <= radiusCells; j++) cells.push({ x: i * CELL, z: j * CELL });
    return cells.sort((a, b) => Math.hypot(a.x, a.z * 1.04) - Math.hypot(b.x, b.z * 1.04));
  }

  computeFreeCells() {
    const used = new Set(this.state.buildings.map(b => `${b.pos.x},${b.pos.z}`));
    const maxR = Math.max(5, ...this.state.buildings.map(b => Math.max(Math.abs(b.pos.x), Math.abs(b.pos.z)) / CELL)) + 4;
    this.freeCells = this.gridCells(Math.ceil(maxR)).filter(c => !used.has(`${c.x},${c.z}`) && !isWater(this.state.terrain, c));
  }

  /**
   * Pick a free cell suited to the building type — farms want fertile soil, mines want
   * ore, lumber camps want forest. Cells are pre-sorted nearest-first; quality trades
   * off against proximity.
   */
  takeFreeCell(type?: BuildingType): Vec2 {
    if (this.freeCells.length === 0) this.computeFreeCells();
    if (!type) return this.freeCells.shift()!;
    let bestI = 0, bv = -Infinity;
    const scan = Math.min(this.freeCells.length, 150);
    for (let i = 0; i < scan; i++) {
      const q = siteQuality(this.state.terrain, type, this.freeCells[i]) - (i / scan) * 0.15 + this.rng.next() * 0.06;
      if (q > bv) { bv = q; bestI = i; }
    }
    return this.freeCells.splice(bestI, 1)[0];
  }

  /** Choose the index of the best cell for `type` among `cells[start..]`, swapping it to `start`. */
  private pickSiteCell(type: BuildingType, cells: Vec2[], start: number): number {
    let best = start, bv = -Infinity;
    for (let i = start; i < cells.length; i++) {
      const q = siteQuality(this.state.terrain, type, cells[i]) - ((i - start) / Math.max(1, cells.length - start)) * 0.25 + this.rng.next() * 0.05;
      if (q > bv) { bv = q; best = i; }
    }
    [cells[start], cells[best]] = [cells[best], cells[start]];
    return start;
  }

  addBuilding(type: BuildingType, pos: Vec2, complete = true): Building {
    const s = BUILDING_SPECS[type];
    const b: Building = {
      id: this.nextId(), type, pos: { ...pos }, size: { w: s.w, d: s.d, h: s.h }, capacity: s.cap,
      ownerKind: this.state.policy.ownership, ownerHouseholdId: null, cash: 0, debt: 0,
      stock: 0, inputStock: 10, tools: 4,
      workers: [], residents: [], complete, progress: complete ? 1 : 0, condition: 1, wage: 0, output: 0, quota: 0,
    };
    this.state.buildings.push(b);
    this.buildingMap.set(b.id, b);
    this.invalidateBuildings();
    return b;
  }

  private generateWorld() {
    const { population } = this.state.config;
    const policy = this.state.policy;
    const rng = this.rng;

    // Core civic & cultural ring
    const civic: BuildingType[] = ['plaza', 'townhall', 'market', 'temple', 'clinic', 'school', 'tavern', 'guardhouse', 'warehouse', 'yard'];
    if (policy.allocation === 'market') civic.push('bank');
    if (population >= 120) civic.push('theater', 'bakery', 'smithy', 'tailor_shop', 'mill');
    if (population >= 300) civic.push('university', 'prison', 'monument');
    else if (policy.enforcement > 0.65) civic.push('prison', 'monument');

    // Residential mix: manors for elites, tenements for dense/working districts, houses for most families
    const nManors = policy.ownership === 'private' ? Math.max(1, Math.round((population / 90) * (0.4 + policy.ownerConcentration))) : 0;
    const nTenements = population >= 250 ? Math.max(2, Math.round(population / 95)) : population >= 120 ? 1 : 0;
    const remainingPop = Math.max(10, population - nManors * 5 - nTenements * 12);
    const nHouses = Math.ceil(remainingPop / 4.0) + 3;

    // Productive sectors
    const nFarms = Math.max(3, Math.ceil((population * 0.2) / 5.5));
    const nMills = Math.max(1, Math.floor(nFarms / 4));
    const nBakeries = Math.max(1, Math.floor(population / 140));
    const nLumber = Math.max(1, Math.ceil(population / 160));
    const nMines = Math.max(1, Math.ceil(population / 180));
    const nWorkshops = Math.max(2, Math.ceil((population * 0.08) / 5.5));
    const nSmithies = Math.max(1, Math.ceil(population / 170));
    const nTailors = Math.max(1, Math.ceil(population / 170));
    const nFactories = population >= 140 ? Math.max(1, Math.floor(population / 180)) : 0;

    const innerTypes: BuildingType[] = [
      ...Array(nManors).fill('manor'),
      ...Array(nTenements).fill('tenement'),
      ...Array(nHouses).fill('house'),
      ...Array(nWorkshops).fill('workshop'),
      ...Array(nSmithies).fill('smithy'),
      ...Array(nTailors).fill('tailor_shop'),
      ...Array(nBakeries).fill('bakery'),
      ...Array(nFactories).fill('factory'),
    ];
    const outerTypes: BuildingType[] = [
      ...Array(nFarms).fill('farm'),
      ...Array(nMills).fill('mill'),
      ...Array(nLumber).fill('lumber_camp'),
      ...Array(nMines).fill('mine'),
    ];

    const reserve = Math.ceil(nHouses * 0.45);
    const totalNeeded = civic.length + innerTypes.length + outerTypes.length + reserve;
    const radius = Math.ceil(Math.sqrt(totalNeeded) / 2) + 3;
    const cells = this.gridCells(radius).filter(c => !isWater(this.state.terrain, c));

    let ci = 0;
    for (const t of civic) this.addBuilding(t, cells[ci++]);

    const midCount = innerTypes.length + reserve;
    const midCells = cells.slice(ci, ci + midCount);
    ci += midCount;
    const shuffledInner = rng.shuffle([...innerTypes]);
    for (let i = 0; i < shuffledInner.length; i++) this.addBuilding(shuffledInner[i], midCells[i]);

    const shuffledOuter = rng.shuffle([...outerTypes]);
    // Resource buildings seek out good sites: farms cluster on fertile soil, mines on
    // ore deposits, lumber camps in the woods — geography shapes the town's edge
    for (const t of shuffledOuter) this.addBuilding(t, cells[this.pickSiteCell(t, cells, ci++)]);
    this.computeFreeCells();

    // Generate population & households
    const residential = this.state.buildings.filter(b => b.type === 'manor' || b.type === 'house' || b.type === 'tenement');
    let hi = 0;
    while (this.state.agents.length < population) {
      const hh = this.addHousehold();
      const roll = rng.next();
      const fam = surname(rng);
      const make = (age: number, sex: 'M' | 'F', parents: Agent[] = []) =>
        this.createAgent({ age, sex, householdId: hh.id, surname: fam, parents });
      if (roll < 0.6) {
        const a = make(rng.range(21, 50), 'M');
        const b = make(clamp(a.age + rng.normal(0, 3), 19, 58), 'F');
        // Partner assortative alignment on beliefs so spouses aren't completely opposite
        b.disposition.econ = clamp(a.disposition.econ * 0.55 + b.disposition.econ * 0.45, -1, 1);
        b.disposition.trad = clamp(a.disposition.trad * 0.6 + b.disposition.trad * 0.4, -1, 1);
        b.beliefs = { ...b.disposition };
        a.partnerId = b.id; b.partnerId = a.id;
        const kids = rng.int(0, 3);
        for (let k = 0; k < kids && this.state.agents.length < population; k++) {
          const age = rng.range(0, Math.min(17, b.age - 18));
          const c = make(age, rng.chance(0.5) ? 'M' : 'F', [a, b]);
          a.children.push(c.id); b.children.push(c.id);
        }
      } else if (roll < 0.84) {
        make(rng.range(18, 46), rng.chance(0.5) ? 'M' : 'F');
      } else {
        const a = make(rng.range(58, 76), 'M');
        if (rng.chance(0.62)) {
          const b = make(clamp(a.age + rng.normal(-2, 3), 55, 82), 'F');
          a.partnerId = b.id; b.partnerId = a.id;
        }
      }
      const occupancy = (b: Building) => b.residents.reduce((t, id) => t + (this.household(id)?.members.length ?? 0), 0);
      let home = residential[hi % residential.length];
      for (let k = 0; k < residential.length && occupancy(home) + hh.members.length > home.capacity; k++) {
        home = residential[++hi % residential.length];
      }
      hi++;
      this.moveIn(hh, home);
    }

    // Initial wealth & stocks
    const conc = policy.ownerConcentration;
    for (const hh of this.state.households) {
      const adults = hh.members.filter(id => this.agent(id)!.age >= 18).length;
      hh.money = policy.allocation === 'commons' ? 0 : Math.max(8, 45 * adults * Math.exp(rng.normal(0, 0.38 + conc * 0.55)));
      hh.food = hh.members.length * 4.5;
      hh.goods = hh.members.length * 1.8;
      hh.luxury = hh.members.length * 0.4;
    }
    this.assignInitialOwnership();
  }

  private assignInitialOwnership() {
    const policy = this.state.policy;
    const rng = this.rng;
    const productiveTypes = new Set<BuildingType>([
      'farm', 'mill', 'bakery', 'lumber_camp', 'mine', 'workshop', 'smithy', 'tailor_shop', 'factory', 'market', 'bank', 'tavern', 'theater',
    ]);
    const workplaces = this.state.buildings.filter(b => productiveTypes.has(b.type));
    const homes = this.state.buildings.filter(b => b.type === 'house' || b.type === 'tenement' || b.type === 'manor');
    for (const b of this.state.buildings) {
      b.ownerKind = policy.ownership;
      if (productiveTypes.has(b.type)) {
        b.cash = policy.allocation === 'market' ? 85 : 0;
        b.stock = 12;
        b.inputStock = 18;
        b.tools = 6;
      }
    }
    if (policy.ownership !== 'private') return;
    const conc = policy.ownerConcentration;
    const byWealth = [...this.state.households].sort((a, b) => b.money - a.money);
    const nOwners = Math.max(2, Math.round(workplaces.length * (1 - conc * 0.78) * 0.75));
    const owners = byWealth.slice(0, nOwners);
    workplaces.forEach((w, i) => {
      w.ownerHouseholdId = owners[i % owners.length].id;
      w.cash = 90;
    });
    for (const o of owners) {
      o.money += 130 * (1 + conc);
      for (const id of o.members) {
        const a = this.agent(id);
        if (a && a.age >= 18) {
          a.classIdentity = 'elite';
          // Property owners naturally anchor slightly more pro-property/market
          a.disposition.econ = clamp(a.disposition.econ + 0.25, -1, 1);
          a.beliefs.econ = clamp(a.beliefs.econ + 0.2, -1, 1);
        }
      }
    }
    // Move elite families into manors if available
    const manors = this.state.buildings.filter(b => b.type === 'manor');
    manors.forEach((m, idx) => {
      const eliteHh = owners[idx];
      if (eliteHh) {
        this.moveIn(eliteHh, m);
        m.ownerHouseholdId = eliteHh.id;
      }
    });
    for (const h of homes) {
      if (h.ownerHouseholdId != null) continue;
      if (h.type === 'tenement') {
        h.ownerHouseholdId = rng.pick(owners).id;
      } else if (h.residents.length && !rng.chance(conc * 0.85)) {
        h.ownerHouseholdId = h.residents[0];
      } else {
        h.ownerHouseholdId = rng.pick(owners).id;
      }
    }
  }

  addHousehold(): Household {
    const hh: Household = { id: this.nextId(), members: [], money: 0, debt: 0, food: 0, goods: 0, luxury: 0, homeId: null, income: 0, arrears: 0 };
    this.state.households.push(hh);
    this.householdMap.set(hh.id, hh);
    return hh;
  }

  moveIn(hh: Household, house: Building | null) {
    if (hh.homeId != null) {
      const old = this.building(hh.homeId);
      if (old) old.residents = old.residents.filter(id => id !== hh.id);
    }
    hh.homeId = house ? house.id : null;
    if (house && !house.residents.includes(hh.id)) house.residents.push(hh.id);
  }

  createAgent(o: { age: number; sex: 'M' | 'F'; householdId: number; surname?: string; parents?: Agent[] }): Agent {
    const rng = this.rng;
    const c = this.state.culture;
    const parents = o.parents ?? [];
    const inheritP = (k: keyof Personality) => parents.length
      ? clamp((parents.reduce((s, p) => s + p.personality[k], 0) / parents.length) * 0.55 + 0.45 * rng.normal(0.5, 0.22))
      : clamp(rng.normal(0.5, 0.22));
    const personality: Personality = {
      O: inheritP('O'),
      C: clamp(inheritP('C') + (c.workEthic - 0.5) * 0.12),
      E: inheritP('E'),
      A: clamp(inheritP('A') + (c.collectivism - 0.5) * 0.12),
      N: inheritP('N'),
    };

    // Psychological roots of ideology (Jost / Haidt empirical correlations):
    // High Openness -> progressive (-trad) & libertarian (-auth)
    // High Conscientiousness -> order/tradition (+trad, +auth) & individual merit (+econ)
    // High Agreeableness -> egalitarian/collectivist (-econ)
    // High Neuroticism -> safety-seeking (+auth)
    const psychEcon = (personality.C - 0.5) * 0.45 - (personality.A - 0.5) * 0.55;
    const psychAuth = (personality.C - 0.5) * 0.35 + (personality.N - 0.5) * 0.25 - (personality.O - 0.5) * 0.45;
    const psychTrad = (personality.C - 0.5) * 0.45 - (personality.O - 0.5) * 0.55;

    const spread = Math.max(0.36, c.beliefSpread);
    const disposition: Beliefs = parents.length
      ? {
        // Children inherit from parents, absorb the surrounding culture, and add their own temperament
        // plus generational novelty. The culture term keeps a society's centre from regressing to zero.
        econ: clamp((parents.reduce((s, p) => s + p.beliefs.econ, 0) / parents.length) * 0.5 + c.beliefCenter.econ * 0.35 + psychEcon * 0.35 + rng.normal(0, spread * 0.75), -1, 1),
        auth: clamp((parents.reduce((s, p) => s + p.beliefs.auth, 0) / parents.length) * 0.5 + c.beliefCenter.auth * 0.35 + psychAuth * 0.35 + rng.normal(0, spread * 0.75), -1, 1),
        trad: clamp((parents.reduce((s, p) => s + p.beliefs.trad, 0) / parents.length) * 0.5 + c.beliefCenter.trad * 0.35 + psychTrad * 0.35 + rng.normal(0, spread * 0.75), -1, 1),
      }
      : {
        econ: clamp(c.beliefCenter.econ + psychEcon * 0.45 + rng.normal(0, spread), -1, 1),
        auth: clamp(c.beliefCenter.auth + psychAuth * 0.45 + rng.normal(0, spread), -1, 1),
        trad: clamp(c.beliefCenter.trad + psychTrad * 0.45 + rng.normal(0, spread), -1, 1),
      };

    // Regime socialisation: under closed regimes, schools, youth leagues and state media imprint the
    // official ideology on children born into the system (weaker where civic life is free).
    if (parents.length) {
      const indoctrination = (1 - this.state.policy.civilLiberty) * (1 - this.state.policy.pressFreedom) * 0.4;
      const g = this.state.gov.position;
      disposition.econ = clamp(lerp(disposition.econ, g.econ, indoctrination), -1, 1);
      disposition.auth = clamp(lerp(disposition.auth, g.auth, indoctrination), -1, 1);
      disposition.trad = clamp(lerp(disposition.trad, g.trad, indoctrination), -1, 1);
    }
    const beliefs: Beliefs = { ...disposition };
    const religiosity = clamp(
      (parents.length ? parents.reduce((s, p) => s + p.religiosity, 0) / parents.length * 0.6 + c.religiosity * 0.4 : c.religiosity) +
      disposition.trad * 0.25 + rng.normal(0, 0.18),
    );

    const last = o.surname ?? (parents[0] ? parents[0].name.split(' ')[1] : surname(rng));
    const hh = this.household(o.householdId);
    const home = hh?.homeId != null ? this.building(hh.homeId) : null;
    const pos = home ? { x: home.pos.x + rng.range(-2, 2), z: home.pos.z + rng.range(-2, 2) } : { x: rng.range(-5, 5), z: rng.range(-5, 5) };
    const edu = o.age >= 18 ? clamp(rng.normal(0.48, 0.22)) : o.age >= 6 ? clamp((o.age - 6) / 16 * 0.5) : 0;
    const a: Agent = {
      id: this.nextId(), name: `${firstName(rng, o.sex)} ${last}`, sex: o.sex, age: o.age,
      personality, disposition, beliefs,
      needs: {
        food: 1, rest: 1, social: 0.75, comfort: 0.7, safety: 0.85,
        health: clamp(1 - Math.max(0, o.age - 50) / 60), freedom: 0.8,
        purpose: 0.75, culture: 0.7,
      },
      happiness: 0.68, approval: 0.62, grievance: 0, fear: 0,
      skill: clamp(rng.normal(0.5, 0.18), 0.1, 1),
      education: edu,
      religiosity,
      classIdentity: 'working',
      subculture: pickSubculture(beliefs, personality, religiosity),
      job: o.age < 18 ? 'child' : o.age >= 65 ? 'retired' : 'unemployed',
      workplaceId: null, householdId: o.householdId, partnerId: null,
      parents: parents.map(p => p.id), children: [], friends: [],
      factionId: null, commitment: 0,
      activity: 'home', pos, target: { ...pos }, targetBuildingId: home?.id ?? null,
      jailedUntil: -1, hungerDays: 0, unemployedDays: 0, income: 0, memory: [],
    };
    this.state.agents.push(a);
    this.agentMap.set(a.id, a);
    hh?.members.push(a.id);
    return a;
  }

  // ---------- lookup helpers ----------

  agent(id: number | null | undefined) { return id == null ? undefined : this.agentMap.get(id); }
  household(id: number | null | undefined) { return id == null ? undefined : this.householdMap.get(id); }
  building(id: number | null | undefined) { return id == null ? undefined : this.buildingMap.get(id); }
  faction(id: number | null | undefined) { return id == null ? undefined : this.state.factions.find(f => f.id === id); }
  invalidateBuildings() { this.typeCache = null; }
  buildingsOf(type: BuildingType): Building[] {
    if (!this.typeCache) {
      this.typeCache = new Map();
      for (const b of this.state.buildings) {
        if (!b.complete) continue;
        const arr = this.typeCache.get(b.type);
        if (arr) arr.push(b); else this.typeCache.set(b.type, [b]);
      }
    }
    return this.typeCache.get(type) ?? [];
  }
  adults() { return this.state.agents.filter(a => a.age >= 18); }
  year() { return Math.floor(this.state.day / DAYS_PER_YEAR); }

  private spatialKey(x: number, z: number) {
    return (Math.floor(x / Simulation.SPATIAL_CELL) + 512) * 2048 + Math.floor(z / Simulation.SPATIAL_CELL) + 512;
  }

  private rebuildSpatial() {
    this.spatialGrid.clear();
    for (const a of this.state.agents) {
      const k = this.spatialKey(a.pos.x, a.pos.z);
      const arr = this.spatialGrid.get(k);
      if (arr) arr.push(a.id); else this.spatialGrid.set(k, [a.id]);
    }
  }

  /** Agents whose position lies within `radius` of `pos` (uses the hourly spatial index). */
  agentsNear(pos: Vec2, radius: number): Agent[] {
    const out: Agent[] = [];
    const c = Simulation.SPATIAL_CELL;
    const x0 = Math.floor((pos.x - radius) / c), x1 = Math.floor((pos.x + radius) / c);
    const z0 = Math.floor((pos.z - radius) / c), z1 = Math.floor((pos.z + radius) / c);
    const r2 = radius * radius;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      const arr = this.spatialGrid.get((x + 512) * 2048 + z + 512);
      if (!arr) continue;
      for (const id of arr) {
        const a = this.agentMap.get(id);
        if (a && (a.pos.x - pos.x) ** 2 + (a.pos.z - pos.z) ** 2 <= r2) out.push(a);
      }
    }
    return out;
  }

  log(text: string, kind: EventKind = 'info', agentId?: number, scene?: Scene) {
    const e: SimEvent = { day: this.state.day, hour: this.state.hour, text, kind, agentId };
    if (scene) e.scene = scene;
    this.state.events.push(e);
    if (this.state.events.length > 450) this.state.events.splice(0, this.state.events.length - 450);
    for (const l of this.listeners) l(e);
  }

  remember(a: Agent, text: string) {
    a.memory.push({ day: this.state.day, text });
    if (a.memory.length > 12) a.memory.shift();
  }

  // ---------- agent lifecycle ----------

  killAgent(a: Agent, cause: string) {
    const s = this.state;
    a.causeOfDeath = cause;
    s.counters.deaths++;
    s.graveyard++;
    const hh = this.household(a.householdId);
    if (a.workplaceId != null) { const w = this.building(a.workplaceId); if (w) w.workers = w.workers.filter(id => id !== a.id); }
    if (a.partnerId != null) {
      const p = this.agent(a.partnerId);
      if (p) {
        p.partnerId = null;
        this.remember(p, `Lost partner ${a.name} (${cause}).`);
        p.grievance = clamp(p.grievance + (cause === 'starvation' || cause.includes('killed') || cause === 'executed' ? 0.32 : 0.04));
      }
    }
    for (const cid of a.children) {
      const c = this.agent(cid);
      if (c) {
        this.remember(c, `Parent ${a.name} died (${cause}).`);
        if (cause === 'starvation' || cause.includes('killed') || cause === 'executed') c.grievance = clamp(c.grievance + 0.28);
      }
    }
    for (const fid of a.friends) { const f = this.agent(fid); if (f) f.friends = f.friends.filter(x => x !== a.id); }
    s.agents.splice(s.agents.indexOf(a), 1);
    this.agentMap.delete(a.id);
    if (s.gov.leaderId === a.id) handleLeaderDeath(this, a);
    if (hh) {
      hh.members = hh.members.filter(id => id !== a.id);
      if (hh.members.length === 0) this.dissolveHousehold(hh, a);
    }
  }

  dissolveHousehold(hh: Household, deceased?: Agent) {
    const s = this.state;
    const heirIds = new Set<number>();
    for (const cid of deceased?.children ?? []) { const c = this.agent(cid); if (c) heirIds.add(c.householdId); }
    const heirs = [...heirIds].map(id => this.household(id)).filter((h): h is Household => !!h && h !== hh);
    const inherit = s.policy.inheritance;
    const netEstate = Math.max(0, hh.money - hh.debt);
    const passed = netEstate * inherit;
    if (heirs.length) heirs.slice(0, 3).forEach(h => (h.money += passed / Math.min(3, heirs.length)));
    s.gov.treasury += netEstate - (heirs.length ? passed : 0);
    s.store.food += hh.food; s.store.goods += hh.goods; s.store.luxury += hh.luxury;
    for (const b of s.buildings) {
      if (b.ownerHouseholdId !== hh.id) continue;
      const heir = heirs.length && this.rng.chance(inherit) ? heirs[0] : null;
      if (heir) b.ownerHouseholdId = heir.id;
      else if (s.policy.ownership === 'private') {
        // Unclaimed property is auctioned off rather than gifted to the richest household:
        // the state takes a cut, and any household that can pay may buy — slowing concentration
        const price = b.type === 'manor' ? 160 : b.type === 'tenement' ? 130 : BUILDING_PRODUCTION[b.type] ? 110 : 60;
        const bidders = s.households.filter(h => h !== hh && h.money > price);
        const buyer = bidders.length ? this.rng.pick(bidders) : undefined;
        if (buyer) { buyer.money -= price; s.gov.treasury += price; b.ownerHouseholdId = buyer.id; }
        else { b.ownerHouseholdId = null; b.ownerKind = 'state'; }
      } else { b.ownerHouseholdId = null; b.ownerKind = s.policy.ownership; }
    }
    this.moveIn(hh, null);
    s.households.splice(s.households.indexOf(hh), 1);
    this.householdMap.delete(hh.id);
  }

  // ---------- main loop ----------

  tick() {
    const s = this.state;
    s.tick++;
    const newHour = s.tick % TICKS_PER_HOUR === 0;
    if (newHour) {
      this.invalidateBuildings();
      s.hour++;
      if (s.hour >= 24) {
        s.hour = 0;
        s.day++;
        this.runDay();
      }
      if (s.hour === 19) this.snapshotGatherings();
      this.rebuildSpatial();
      for (const a of s.agents) updateAgentHour(this, a);
    }
    for (const a of s.agents) moveAgent(this, a);
    s.rngState = this.rng.state;
  }

  runDays(n: number) {
    const ticks = n * 24 * TICKS_PER_HOUR;
    for (let i = 0; i < ticks; i++) this.tick();
  }

  private snapshotGatherings() {
    this.gatherings.clear();
    for (const a of this.state.agents) {
      if ((a.activity === 'leisure' || a.activity === 'worship' || a.activity === 'culture' || a.activity === 'protest' || a.activity === 'queue') && a.targetBuildingId != null) {
        const arr = this.gatherings.get(a.targetBuildingId);
        if (arr) arr.push(a.id); else this.gatherings.set(a.targetBuildingId, [a.id]);
      }
    }
  }

  private runDay() {
    updateEnvironmentDay(this);
    runEconomyDay(this);
    runSocietyDay(this);
    runPoliticsDay(this);
    recordStats(this);
  }

  serialize(): string {
    this.state.rngState = this.rng.state;
    return JSON.stringify(this.state);
  }

  static deserialize(json: string): Simulation {
    const state = JSON.parse(json) as WorldState;
    if (state.version > STATE_VERSION) throw new Error(`Save is from a newer schema (v${state.version} > v${STATE_VERSION}). Update the app.`);
    while (state.version < STATE_VERSION) {
      const migrate = MIGRATIONS[state.version];
      if (!migrate) throw new Error(`No migration for save version ${state.version}. Start a new world.`);
      migrate(state);
      state.version++;
    }
    return new Simulation(state);
  }
}

export function pickSubculture(b: Beliefs, p: Personality, religiosity: number): Subculture {
  if (religiosity > 0.72 && b.trad > 0.25) return 'traditionalist';
  if (p.O > 0.68 && b.trad < -0.2) return 'bohemian';
  if (b.econ < -0.42 && b.auth < 0.25) return b.auth < -0.35 ? 'communitarian' : 'labor_militant';
  if (b.econ > 0.38 && p.C > 0.55) return 'entrepreneur';
  if (b.auth > 0.42 && b.trad > 0.2) return 'nationalist';
  return 'mainstream';
}
