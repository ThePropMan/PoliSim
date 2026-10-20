export interface Vec2 { x: number; z: number }

/** Simulated days per year. Defined here (not simulation.ts) so leaf modules like
 *  environment.ts can use it without a circular import. */
export const DAYS_PER_YEAR = 30;

export type Good = 'food' | 'raw' | 'goods' | 'tools' | 'luxury';
export const GOODS: readonly Good[] = ['food', 'raw', 'goods', 'tools', 'luxury'];

export type Job =
  | 'child' | 'student' | 'retired' | 'unemployed'
  | 'farmer' | 'miner' | 'lumberjack'
  | 'crafter' | 'factory_worker' | 'smith' | 'baker' | 'tailor'
  | 'builder' | 'merchant' | 'banker' | 'clerk' | 'tavern_keeper'
  | 'healer' | 'teacher' | 'scholar' | 'guard' | 'official' | 'priest' | 'artist';

export type BuildingType =
  | 'house' | 'tenement' | 'manor'
  | 'farm' | 'mill' | 'bakery' | 'lumber_camp' | 'mine'
  | 'workshop' | 'smithy' | 'tailor_shop' | 'factory' | 'warehouse'
  | 'market' | 'bank' | 'tavern' | 'theater'
  | 'clinic' | 'school' | 'university' | 'temple'
  | 'townhall' | 'guardhouse' | 'prison' | 'yard' | 'plaza' | 'monument';

export type Activity =
  | 'sleep' | 'commute' | 'work' | 'leisure' | 'school' | 'worship' | 'culture'
  | 'queue' | 'protest' | 'jailed' | 'strike' | 'home' | 'riot';

export type Ownership = 'private' | 'collective' | 'state';
export type Allocation = 'market' | 'planned' | 'commons';
export type Governance = 'none' | 'council' | 'democracy' | 'autocracy' | 'monarchy';
export type ElectoralSystem = 'fptp' | 'pr' | 'runoff';

export type PlanningStrategy =
  | 'balanced'
  | 'five_year_industrial'
  | 'agrarian_sufficiency'
  | 'consumer_plenty'
  | 'militarist_mobilization'
  | 'technocratic_science';

export type WeatherKind = 'clear' | 'cloudy' | 'rain' | 'storm' | 'drought' | 'snow';

export type SocialClass = 'underclass' | 'working' | 'middle' | 'elite';
export type Subculture = 'mainstream' | 'traditionalist' | 'bohemian' | 'labor_militant' | 'entrepreneur' | 'nationalist' | 'communitarian';

/** Each axis in [-1, 1]. econ: -1 collectivist/left .. +1 free-market/right.
 *  auth: -1 libertarian .. +1 authoritarian. trad: -1 progressive .. +1 traditional. */
export interface Beliefs { econ: number; auth: number; trad: number }

/** Big Five, each in [0, 1]. */
export interface Personality { O: number; C: number; E: number; A: number; N: number }

/** Satisfaction levels in [0, 1], 1 = fully satisfied. */
export interface Needs {
  food: number; rest: number; social: number; comfort: number;
  safety: number; health: number; freedom: number;
  purpose: number; culture: number;
}

export interface Memory { day: number; text: string }

export interface Agent {
  id: number;
  name: string;
  sex: 'M' | 'F';
  age: number;
  personality: Personality;
  /** Innate temperament + upbringing anchor — prevents everyone from drifting into identical clones. */
  disposition: Beliefs;
  beliefs: Beliefs;
  needs: Needs;
  happiness: number;
  approval: number;
  grievance: number;
  fear: number;
  skill: number;
  education: number;
  religiosity: number;
  classIdentity: SocialClass;
  subculture: Subculture;
  job: Job;
  workplaceId: number | null;
  householdId: number;
  partnerId: number | null;
  parents: number[];
  children: number[];
  friends: number[];
  factionId: number | null;
  commitment: number;
  /** Party identification: the faction this voter backed last election — losers keep a floor. */
  votedFor?: number;
  activity: Activity;
  pos: Vec2;
  target: Vec2;
  targetBuildingId: number | null;
  jailedUntil: number;
  hungerDays: number;
  unemployedDays: number;
  income: number;
  memory: Memory[];
  /** Recent-arrival marker (immigrants): until this day natives may react defensively. */
  newcomerUntil?: number;
  causeOfDeath?: string;
}

export interface Household {
  id: number;
  members: number[];
  money: number;
  debt: number;
  food: number;
  goods: number;
  luxury: number;
  homeId: number | null;
  income: number;
  arrears: number;
}

export interface Building {
  id: number;
  type: BuildingType;
  pos: Vec2;
  size: { w: number; d: number; h: number };
  capacity: number;
  ownerKind: Ownership;
  ownerHouseholdId: number | null;
  cash: number;
  debt: number;
  stock: number;
  inputStock: number;
  tools: number;
  workers: number[];
  residents: number[];
  complete: boolean;
  progress: number;
  /** Structural condition 0..1; storms and time wear it down, builders repair it. */
  condition: number;
  wage: number;
  output: number;
  quota: number;
}

export interface Faction {
  id: number;
  name: string;
  color: string;
  platform: Beliefs;
  /** Platform at founding — used to measure how far the party has drifted from its roots. */
  founding: Beliefs;
  founderId: number;
  /** Current party leader (may differ from founder after elections/death). */
  leaderId: number;
  foundedDay: number;
  lastPurge: number;
  underground: boolean;
  members: number;
  strength: number;
  anger: number;
  protestDays: number;
  strikeToday: boolean;
  protestToday: boolean;
  lastAction: number;
  /** Party funds: member dues + wealthy patron donations; spent campaigning in elections. */
  treasury: number;
  /** Seats won in the last parliamentary election. */
  seats: number;
}

export interface Policy {
  ownership: Ownership;
  allocation: Allocation;
  governance: Governance;
  planningStrategy: PlanningStrategy;
  taxRate: number;
  welfare: number;
  publicServices: number;
  enforcement: number;
  civilLiberty: number;
  wageFloor: number;
  inheritance: number;
  corruption: number;
  planningEfficiency: number;
  ownerConcentration: number;
  birthSupport: number;
  electionYears: number;
  /** Constitutional order */
  electoralSystem: ElectoralSystem;
  /** Share of adults enfranchised (property franchise etc. — poorest excluded first). */
  suffrage: number;
  /** Max consecutive terms a leader may serve; 0 = unlimited. */
  termLimits: number;
  /** Independent courts: block unconstitutional seizures, soften purges. */
  judiciary: number;
  /** Free press spreads scandal; censorship suppresses it but dissent goes underground. */
  pressFreedom: number;
  /** Praetorianism: how autonomous/powerful the armed guards are as a political actor. */
  militaryPower: number;
  interestRate: number;
  moneyPrinting: number;
  culturalSubsidy: number;
  religiousFreedom: number;
}

export interface Culture {
  collectivism: number;
  trust: number;
  religiosity: number;
  workEthic: number;
  artisticSpirit: number;
  socialMobility: number;
  classConsciousness: number;
  cohesion: number;
  festivalDaysLeft: number;
  beliefCenter: Beliefs;
  beliefSpread: number;
  /** Adaptive material expectations: people judge comfort against what they've grown used to. */
  comfortNorm: number;
}

export interface Government {
  regimeName: string;
  position: Beliefs;
  leaderId: number | null;
  rulingFactionId: number | null;
  /** Factions sharing power in a coalition government (includes ruling party). */
  coalition: number[];
  /** Seat allocation from the last election: factionId -> seats. */
  parliament: { factionId: number; seats: number }[];
  /** No majority could form a government — interim regime, policy frozen. */
  caretaker: boolean;
  treasury: number;
  stateDebt: number;
  legitimacy: number;
  since: number;
  lastElection: number;
  revolutions: number;
  elections: number;
  lastRiot: number;
  /** Consecutive terms the current leader has held office. */
  termsServed: number;
  /** Days of martial law remaining (protests banned, production dampened). */
  martialLaw: number;
  /** Accumulated corruption scandal pressure; erupts when press is free. */
  scandal: number;
  /** Hidden dissent pressure built up under censorship; erupts in bigger explosions. */
  pentUp: number;
  /** Loyalty of the guards/security apparatus to the regime (0..1). Defection topples autocracies. */
  securityLoyalty: number;
  /** Day of the last autocratic thaw/tightening decision. */
  lastCourse: number;
  /** Day of the last party merger (mergers are rate-limited). */
  lastMerge: number;
}

export interface Market {
  prices: Record<Good, number>;
  demand: Record<Good, number>;
  supply: Record<Good, number>;
  produced: Record<Good, number>;
  consumed: Record<Good, number>;
  spoiled: Record<Good, number>;
  foodPrice: number;
  goodsPrice: number;
  foodDemand: number;
  foodSupply: number;
  goodsDemand: number;
  goodsSupply: number;
  avgWage: number;
  priceIndex: number;
  inflationRate: number;
  moneySupply: number;
  totalPrivateDebt: number;
  defaultCount: number;
}

export interface PlanState {
  strategy: PlanningStrategy;
  quotas: Record<Good, number>;
  fulfilled: Record<Good, number>;
  shortageSeverity: Record<Good, number>;
  queueHours: number;
  blackMarketShare: number;
  planCycleDay: number;
  fiveYearProgress: number;
  rationLevel: number;
}

export interface StatSample {
  day: number;
  pop: number;
  happiness: number;
  gini: number;
  legitimacy: number;
  foodSecurity: number;
  unemployment: number;
  treasury: number;
  avgWealth: number;
  crime: number;
  factionStrength: number;
  births: number;
  deaths: number;
  econ: number;
  auth: number;
  trad: number;
  beliefSpread: number;
  inflation: number;
  priceIndex: number;
  totalDebt: number;
  shortage: number;
  cohesion: number;
}

export type EventKind = 'info' | 'birth' | 'death' | 'politics' | 'unrest' | 'economy' | 'crime' | 'culture';

export type SceneKind =
  | 'riot' | 'crackdown' | 'strike' | 'rally' | 'uprising' | 'revolution' | 'coup' | 'martial'
  | 'purge' | 'election' | 'merger' | 'split' | 'coronation' | 'reform'
  | 'storm' | 'drought' | 'festival' | 'famine' | 'plague';

/** Optional cinematic payload attached to dramatic events (rendered by the HUD, ignored headless). */
export interface Scene {
  kind: SceneKind;
  /** Primary colour (protagonist faction / winner). */
  color?: string;
  /** Secondary colour (opponent / old regime). */
  color2?: string;
  /** Crowd size or casualty count hint. */
  n?: number;
  /** Vote shares etc. for chart-style scenes. */
  bars?: { color: string; value: number; label: string }[];
}

export interface SimEvent { day: number; hour: number; text: string; kind: EventKind; agentId?: number; scene?: Scene }

/** Coarse heightfield + resource overlay, generated from the world seed.
 *  All arrays are `size*size`, row-major; `cellSize` is world units per cell. */
export interface TerrainMap {
  size: number;
  cellSize: number;
  /** Height offset per cell in world units (negative = low ground). */
  height: number[];
  /** 0..1 farm fertility. */
  soil: number[];
  /** 0..1 ore deposit (depletes as mines work it). */
  ore: number[];
  /** 0..1 forest density (depletes/regrows as lumber camps work). */
  forest: number[];
  /** 1 = water (unbuildable), 0 = land. */
  water: number[];
}

export interface WorldConfig {
  sizePreset: string;
  ideologyPreset: string;
  population: number;
  seed: number;
  policy: Policy;
  culture: Culture;
}

export interface WorldState {
  version: number;
  config: WorldConfig;
  tick: number;
  day: number;
  hour: number;
  agents: Agent[];
  households: Household[];
  buildings: Building[];
  factions: Faction[];
  gov: Government;
  policy: Policy;
  culture: Culture;
  market: Market;
  plan: PlanState;
  store: Record<Good, number>;
  harvest: number;
  terrain: TerrainMap;
  weather: { kind: WeatherKind; daysLeft: number };
  stats: StatSample[];
  events: SimEvent[];
  counters: { births: number; deaths: number; crimes: number; divorces: number; defaults: number };
  nextId: number;
  rngState: number;
  graveyard: number;
}
