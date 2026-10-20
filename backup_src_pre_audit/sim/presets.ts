import { clamp } from './rng';
import type { Beliefs, Culture, Governance, PlanningStrategy, Policy } from './types';

export interface SizePreset { id: string; name: string; population: number; description: string }

export const SIZE_PRESETS: SizePreset[] = [
  { id: 'hamlet', name: 'Hamlet', population: 50, description: 'A handful of families. Intimate scale where every death and marriage reshapes town life.' },
  { id: 'village', name: 'Village', population: 150, description: 'A full rural community with farms, craft guilds, a market, and a parish temple.' },
  { id: 'town', name: 'Market Town', population: 400, description: 'A bustling multi-sector town with banks, factories, university, theater, and active factions.' },
  { id: 'city', name: 'Industrial City', population: 1200, description: 'Dense urban society with tenements, manors, mass labor movements, and complex supply chains.' },
];

export interface StrategyInfo {
  id: PlanningStrategy;
  name: string;
  description: string;
  weights: { food: number; raw: number; goods: number; tools: number; luxury: number; science: number; security: number };
}

export const PLANNING_STRATEGIES: Record<PlanningStrategy, StrategyInfo> = {
  balanced: {
    id: 'balanced',
    name: 'Balanced Gosplan',
    description: 'Proportional quotas across agriculture, industry, tools, and consumer goods.',
    weights: { food: 1.05, raw: 1.0, goods: 1.0, tools: 1.0, luxury: 0.7, science: 1.0, security: 1.0 },
  },
  five_year_industrial: {
    id: 'five_year_industrial',
    name: 'Five-Year Heavy Industry',
    description: 'Rapid industrialization: mines, smithies, and factories prioritized at the expense of consumer goods and luxury.',
    weights: { food: 0.92, raw: 1.45, goods: 0.75, tools: 1.55, luxury: 0.25, science: 1.15, security: 1.1 },
  },
  agrarian_sufficiency: {
    id: 'agrarian_sufficiency',
    name: 'Agrarian Self-Sufficiency',
    description: 'Farms, mills, and bakeries come first to guarantee full granaries and prevent famine.',
    weights: { food: 1.38, raw: 0.95, goods: 0.85, tools: 0.9, luxury: 0.45, science: 0.75, security: 0.9 },
  },
  consumer_plenty: {
    id: 'consumer_plenty',
    name: 'Consumer Socialism',
    description: 'Focus on everyday comfort, clothing, bakeries, taverns, and cultural life.',
    weights: { food: 1.1, raw: 0.9, goods: 1.35, tools: 0.85, luxury: 1.3, science: 1.0, security: 0.8 },
  },
  militarist_mobilization: {
    id: 'militarist_mobilization',
    name: 'War Communism / Mobilization',
    description: 'Heavy policing, strict rationing, forced industrial quotas, and austere consumer supply.',
    weights: { food: 0.9, raw: 1.3, goods: 0.65, tools: 1.35, luxury: 0.15, science: 0.8, security: 1.6 },
  },
  technocratic_science: {
    id: 'technocratic_science',
    name: 'Technocratic Cybernetics',
    description: 'Invests heavily in schools, universities, scholars, and precision tools to boost planning efficiency.',
    weights: { food: 1.0, raw: 1.05, goods: 1.0, tools: 1.35, luxury: 0.8, science: 1.6, security: 0.85 },
  },
};

export interface IdeologyPreset {
  id: string;
  name: string;
  tag: string;
  description: string;
  policy: Policy;
  culture: Culture;
}

const base: Policy = {
  ownership: 'private', allocation: 'market', governance: 'democracy',
  planningStrategy: 'balanced',
  taxRate: 0.2, welfare: 0.2, publicServices: 0.4, enforcement: 0.4, civilLiberty: 0.8,
  wageFloor: 0.2, inheritance: 0.85, corruption: 0.1, planningEfficiency: 0.6,
  ownerConcentration: 0.35, birthSupport: 0.25, electionYears: 4,
  interestRate: 0.04, moneyPrinting: 0.05, culturalSubsidy: 0.3, religiousFreedom: 0.85,
  electoralSystem: 'fptp', suffrage: 0.85, termLimits: 0, judiciary: 0.6,
  pressFreedom: 0.8, militaryPower: 0.3,
};

const makeCulture = (
  econ: number, auth: number, trad: number,
  collectivism: number, trust: number, religiosity: number, workEthic: number, artisticSpirit: number,
  beliefSpread = 0.42,
): Culture => ({
  collectivism, trust, religiosity, workEthic, artisticSpirit,
  socialMobility: 0.55, classConsciousness: 0.3, cohesion: 0.7, festivalDaysLeft: 0,
  beliefCenter: { econ, auth, trad }, beliefSpread, comfortNorm: -1,
});

export const IDEOLOGY_PRESETS: IdeologyPreset[] = [
  {
    id: 'liberal', name: 'Liberal Capitalism', tag: 'Free Market Republic',
    description: 'Private firms, commercial banking, low taxes, elected parliament, and high personal liberty.',
    policy: { ...base, taxRate: 0.16, welfare: 0.12, publicServices: 0.35, wageFloor: 0.15, ownerConcentration: 0.38, interestRate: 0.04, moneyPrinting: 0.04 },
    culture: makeCulture(0.35, -0.2, -0.05, 0.35, 0.58, 0.42, 0.68, 0.58, 0.44),
  },
  {
    id: 'socdem', name: 'Social Democracy', tag: 'Welfare State',
    description: 'Regulated market economy with progressive taxation, universal clinics & schools, strong unions, and cultural funding.',
    policy: { ...base, taxRate: 0.42, welfare: 0.62, publicServices: 0.75, wageFloor: 0.48, inheritance: 0.6, ownerConcentration: 0.25, culturalSubsidy: 0.65, interestRate: 0.03, electoralSystem: 'pr', suffrage: 1, judiciary: 0.75 },
    culture: makeCulture(-0.18, -0.15, -0.2, 0.58, 0.72, 0.32, 0.64, 0.72, 0.4),
  },
  {
    id: 'marketsoc', name: 'Market Socialism', tag: 'Worker Cooperatives',
    description: 'Farms, workshops, and factories are owned by their workers and trade competitively in an open market.',
    policy: { ...base, ownership: 'collective', taxRate: 0.28, welfare: 0.42, publicServices: 0.6, wageFloor: 0.4, inheritance: 0.45, ownerConcentration: 0.15, culturalSubsidy: 0.55, electoralSystem: 'pr', suffrage: 1 },
    culture: makeCulture(-0.38, -0.22, -0.15, 0.68, 0.68, 0.35, 0.65, 0.65, 0.4),
  },
  {
    id: 'statesoc', name: 'Central Planning', tag: 'Five-Year Plan State',
    description: 'State owns all industry and land. Gosplan sets output quotas and distributes rations; one-party rule.',
    policy: {
      ...base, ownership: 'state', allocation: 'planned', governance: 'autocracy',
      planningStrategy: 'five_year_industrial',
      taxRate: 0.5, welfare: 0.55, publicServices: 0.72, enforcement: 0.76, civilLiberty: 0.22,
      wageFloor: 0.8, inheritance: 0.15, corruption: 0.24, planningEfficiency: 0.62,
      religiousFreedom: 0.25, culturalSubsidy: 0.6, moneyPrinting: 0.08,
      suffrage: 0.4, judiciary: 0.1, pressFreedom: 0.1, militaryPower: 0.6,
    },
    culture: makeCulture(-0.55, 0.42, -0.1, 0.68, 0.52, 0.28, 0.72, 0.5, 0.38),
  },
  {
    id: 'anarcom', name: 'Anarcho-Communism', tag: 'Free Commune',
    description: 'Stateless federation of syndicates and neighborhood councils. Money is abolished; goods flow through common storehouses.',
    policy: {
      ...base, ownership: 'collective', allocation: 'commons', governance: 'council',
      planningStrategy: 'consumer_plenty',
      taxRate: 0, welfare: 0, publicServices: 0.6, enforcement: 0.05, civilLiberty: 0.98,
      wageFloor: 0, inheritance: 0, corruption: 0.03, culturalSubsidy: 0.7, religiousFreedom: 0.9, moneyPrinting: 0,
      suffrage: 1, judiciary: 0.5, pressFreedom: 0.9, militaryPower: 0.05,
    },
    culture: makeCulture(-0.68, -0.72, -0.35, 0.86, 0.78, 0.25, 0.68, 0.78, 0.36),
  },
  {
    id: 'ancap', name: 'Anarcho-Capitalism', tag: 'Stateless Market',
    description: 'No state, no taxes, no central bank. Private property, private credit, and voluntary contract govern all life.',
    policy: {
      ...base, governance: 'none', taxRate: 0, welfare: 0, publicServices: 0, enforcement: 0.08,
      civilLiberty: 0.95, wageFloor: 0, inheritance: 1, corruption: 0, ownerConcentration: 0.45,
      interestRate: 0.06, moneyPrinting: 0, culturalSubsidy: 0,
      pressFreedom: 0.85, militaryPower: 0.1, judiciary: 0.4,
    },
    culture: makeCulture(0.68, -0.68, 0.05, 0.22, 0.5, 0.45, 0.75, 0.5, 0.42),
  },
  {
    id: 'feudal', name: 'Feudal Monarchy', tag: 'Crown & Estates',
    description: 'Hereditary monarch, noble manors, high land concentration, powerful state church, and guild hierarchy.',
    policy: {
      ...base, governance: 'monarchy', taxRate: 0.34, welfare: 0.08, publicServices: 0.18,
      enforcement: 0.68, civilLiberty: 0.25, wageFloor: 0.08, inheritance: 1, corruption: 0.32,
      ownerConcentration: 0.82, birthSupport: 0.55, religiousFreedom: 0.35, culturalSubsidy: 0.35, interestRate: 0.05,
      suffrage: 0.25, judiciary: 0.25, pressFreedom: 0.2, militaryPower: 0.55,
    },
    culture: makeCulture(0.18, 0.52, 0.68, 0.52, 0.48, 0.82, 0.6, 0.45, 0.4),
  },
  {
    id: 'authcap', name: 'Authoritarian Capitalism', tag: 'Corporatist Directorate',
    description: 'State-backed private conglomerates, disciplined labor, strong police apparatus, and nationalist civic order.',
    policy: {
      ...base, governance: 'autocracy', taxRate: 0.22, welfare: 0.15, publicServices: 0.45,
      enforcement: 0.8, civilLiberty: 0.25, wageFloor: 0.15, corruption: 0.28, ownerConcentration: 0.55,
      birthSupport: 0.45, interestRate: 0.04, culturalSubsidy: 0.4, religiousFreedom: 0.55,
      suffrage: 0.35, judiciary: 0.12, pressFreedom: 0.15, militaryPower: 0.7,
    },
    culture: makeCulture(0.38, 0.5, 0.4, 0.48, 0.5, 0.6, 0.76, 0.42, 0.4),
  },
  {
    id: 'theocracy', name: 'Theocracy', tag: 'Holy Commonwealth',
    description: 'Clerical council rules by scripture: state faith, religious courts, charity through the temple, and strict public morals.',
    policy: {
      ...base, governance: 'autocracy', taxRate: 0.24, welfare: 0.3, publicServices: 0.4,
      enforcement: 0.66, civilLiberty: 0.28, wageFloor: 0.2, inheritance: 0.8, corruption: 0.18, ownerConcentration: 0.4,
      birthSupport: 0.75, religiousFreedom: 0.08, culturalSubsidy: 0.15, interestRate: 0.02,
      suffrage: 0.3, judiciary: 0.2, pressFreedom: 0.15, militaryPower: 0.35,
    },
    culture: makeCulture(0.02, 0.45, 0.78, 0.62, 0.62, 0.9, 0.66, 0.3, 0.36),
  },
  {
    id: 'technocracy', name: 'Technocracy', tag: 'Meritocratic Directorate',
    description: 'Appointed experts run a mixed economy: clean administration, elite schools, heavy public investment, limited franchise and a managed press.',
    policy: {
      ...base, governance: 'autocracy', taxRate: 0.32, welfare: 0.3, publicServices: 0.82,
      enforcement: 0.55, civilLiberty: 0.48, wageFloor: 0.3, inheritance: 0.55, corruption: 0.04, ownerConcentration: 0.35,
      planningEfficiency: 0.8, birthSupport: 0.3, culturalSubsidy: 0.45, religiousFreedom: 0.7, interestRate: 0.035,
      suffrage: 0.3, judiciary: 0.65, pressFreedom: 0.4, militaryPower: 0.3,
    },
    culture: makeCulture(0.1, 0.22, -0.3, 0.52, 0.66, 0.3, 0.8, 0.5, 0.36),
  },
  {
    id: 'minarchy', name: 'Libertarian Minarchy', tag: 'Night-Watchman State',
    description: 'A constitutional republic limited to courts, police and defence: minimal taxes, no welfare, strong property rights and civil liberties.',
    policy: {
      ...base, taxRate: 0.07, welfare: 0.02, publicServices: 0.15, enforcement: 0.35, civilLiberty: 0.95,
      wageFloor: 0, inheritance: 1, corruption: 0.05, ownerConcentration: 0.42, birthSupport: 0.05,
      interestRate: 0.05, moneyPrinting: 0.01, culturalSubsidy: 0.05, religiousFreedom: 0.95,
      suffrage: 0.9, termLimits: 2, judiciary: 0.88, pressFreedom: 0.92, militaryPower: 0.15,
    },
    culture: makeCulture(0.55, -0.45, 0.05, 0.28, 0.6, 0.4, 0.74, 0.55, 0.42),
  },
  {
    id: 'distributist', name: 'Distributism', tag: 'Commonwealth of Smallholders',
    description: 'Property spread widely among family farms, guild workshops and small shops; anti-monopoly laws, light welfare, parish and community life.',
    policy: {
      ...base, taxRate: 0.22, welfare: 0.25, publicServices: 0.45, enforcement: 0.4, civilLiberty: 0.75,
      wageFloor: 0.3, inheritance: 0.5, corruption: 0.08, ownerConcentration: 0.08, birthSupport: 0.5,
      interestRate: 0.02, culturalSubsidy: 0.4, religiousFreedom: 0.8,
      electoralSystem: 'runoff', suffrage: 1, judiciary: 0.65, pressFreedom: 0.75,
    },
    culture: makeCulture(-0.05, 0.05, 0.42, 0.62, 0.72, 0.62, 0.72, 0.5, 0.38),
  },
];

export function clonePolicy(p: Policy): Policy { return { ...p }; }
export function cloneCulture(c: Culture): Culture { return { ...c, beliefCenter: { ...c.beliefCenter } }; }

/** Infer where a set of policies sits on the belief axes. */
export function positionFromPolicy(p: Policy): Beliefs {
  const ownership = p.ownership === 'private' ? 0.65 : p.ownership === 'collective' ? -0.45 : -0.8;
  const alloc = p.allocation === 'market' ? 0.55 : p.allocation === 'planned' ? -0.7 : -0.9;
  const redistrib = p.taxRate * 0.8 + p.welfare * 0.6 + p.wageFloor * 0.4;
  const econ = clamp(0.42 * ownership + 0.38 * alloc - 0.55 * redistrib + 0.25, -1, 1);
  const gov: Record<Governance, number> = { none: -0.9, council: -0.65, democracy: -0.15, autocracy: 0.72, monarchy: 0.8 };
  const auth = clamp(0.5 * gov[p.governance] + 0.5 * (p.enforcement - p.civilLiberty), -1, 1);
  const trad = clamp(
    (p.governance === 'monarchy' ? 0.55 : 0) +
    (p.birthSupport - 0.25) * 0.5 +
    (p.inheritance - 0.5) * 0.35 -
    (p.religiousFreedom - 0.5) * 0.25 -
    (p.culturalSubsidy - 0.3) * 0.2,
    -1, 1,
  );
  return { econ, auth, trad };
}

/** What policies would a faction with this platform implement? Optionally keep the governance type. */
export function policyFromBeliefs(b: Beliefs, current: Policy, keepGovernance: boolean): Policy {
  const p = { ...current };
  const left = clamp(-b.econ, -1, 1);
  p.taxRate = clamp(0.24 + left * 0.24, 0, 0.7);
  p.welfare = clamp(0.32 + left * 0.36, 0, 1);
  p.publicServices = clamp(0.45 + left * 0.3 - b.trad * 0.08, 0, 1);
  p.wageFloor = clamp(0.25 + left * 0.32, 0, 1);
  p.inheritance = clamp(0.65 + b.econ * 0.4, 0, 1);
  p.enforcement = clamp(0.42 + b.auth * 0.45, 0.04, 1);
  p.civilLiberty = clamp(0.6 - b.auth * 0.55, 0.05, 1);
  p.birthSupport = clamp(0.25 + b.trad * 0.38, 0, 1);
  p.culturalSubsidy = clamp(0.35 - b.trad * 0.25 + left * 0.15, 0, 1);
  p.religiousFreedom = clamp(0.65 - Math.abs(b.auth) * 0.3, 0.1, 1);

  if (b.econ < -0.58) {
    p.ownership = b.auth > 0.05 ? 'state' : 'collective';
    p.allocation = b.auth > 0.05 ? 'planned' : b.econ < -0.78 && b.auth < -0.35 ? 'commons' : 'market';
  } else if (b.econ < -0.22) {
    p.ownership = 'collective';
    p.allocation = 'market';
  } else {
    p.ownership = 'private';
    p.allocation = 'market';
  }

  if (p.allocation === 'planned') {
    if (b.auth > 0.55) p.planningStrategy = 'militarist_mobilization';
    else if (b.trad < -0.35) p.planningStrategy = 'technocratic_science';
    else if (b.auth < 0) p.planningStrategy = 'consumer_plenty';
    else p.planningStrategy = 'five_year_industrial';
  }

  if (!keepGovernance) {
    if (b.auth > 0.38) p.governance = b.trad > 0.45 ? 'monarchy' : 'autocracy';
    else if (b.auth < -0.55) p.governance = b.econ < 0 ? 'council' : 'none';
    else p.governance = 'democracy';
  }
  if (p.governance === 'none' || p.governance === 'council') {
    p.taxRate = p.governance === 'none' ? 0 : p.taxRate * 0.25;
    p.enforcement = Math.min(p.enforcement, 0.15);
  }
  if (p.allocation === 'commons') { p.taxRate = 0; p.welfare = 0; p.moneyPrinting = 0; }
  if (p.governance === 'democracy') p.civilLiberty = Math.max(0.58, p.civilLiberty);
  return p;
}

export function regimeName(p: Policy): string {
  const g = p.governance, o = p.ownership, a = p.allocation;
  if (g === 'none') return a === 'commons' ? 'Free Commune' : 'Stateless Market';
  if (g === 'council') return a === 'commons' ? 'Anarchist Federation' : 'Syndicalist Council';
  if ((g === 'monarchy' || g === 'autocracy') && p.religiousFreedom < 0.15 && p.birthSupport > 0.55) return 'Holy Commonwealth';
  if (g === 'monarchy') return o === 'private' ? 'Kingdom' : 'Crown Commonwealth';
  if (g === 'autocracy') {
    if (o === 'state' || a === 'planned') return 'People\'s Republic';
    if (o === 'collective') return 'Revolutionary Junta';
    if (p.militaryPower > 0.85) return 'Military Junta';
    if (p.corruption < 0.3 && p.publicServices > 0.6 && p.judiciary > 0.45) return 'Technocratic Directorate';
    return 'Corporatist Directorate';
  }
  if (o === 'collective') return 'Cooperative Republic';
  if (o === 'state') return 'Democratic Socialist Republic';
  if (p.taxRate < 0.1 && p.welfare < 0.08) return 'Minimal State';
  if (p.ownerConcentration < 0.12) return 'Distributist Commonwealth';
  return p.welfare > 0.45 ? 'Social Democracy' : 'Liberal Republic';
}
