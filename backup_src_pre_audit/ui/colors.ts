import type { Simulation } from '../sim/simulation';
import type { Agent, Building, BuildingType, Job, SocialClass, Subculture } from '../sim/types';

export type ColorMode = 'job' | 'happiness' | 'econ' | 'auth' | 'trad' | 'faction' | 'wealth' | 'class' | 'subculture' | 'activity';
export type BuildingColorMode = 'type' | 'ownership';

export const JOB_COLORS: Record<Job, string> = {
  farmer: '#74b816',
  baker: '#e67700',
  miner: '#495057',
  lumberjack: '#8d5524',
  smith: '#c92a2a',
  crafter: '#a0785a',
  factory_worker: '#5c7cfa',
  tailor: '#ae3ec9',
  tavern_keeper: '#d9480f',
  merchant: '#f59f00',
  banker: '#2b8a3e',
  clerk: '#15aabf',
  builder: '#fab005',
  healer: '#e64980',
  teacher: '#339af0',
  scholar: '#4263eb',
  guard: '#364fc7',
  official: '#7048e8',
  priest: '#f08c00',
  artist: '#f06595',
  student: '#66d9e8',
  unemployed: '#adb5bd',
  child: '#fcc419',
  retired: '#ced4da',
};

export const ACTIVITY_COLORS: Record<Agent['activity'], string> = {
  sleep: '#495057',
  commute: '#868e96',
  work: '#40c057',
  leisure: '#4dabf7',
  school: '#fcc419',
  worship: '#f08c00',
  culture: '#f06595',
  queue: '#9c36b5',
  home: '#ced4da',
  protest: '#fa5252',
  jailed: '#212529',
  strike: '#e8590c',
  riot: '#c92a2a',
};

export const CLASS_COLORS: Record<SocialClass, string> = {
  underclass: '#e03131',
  working: '#4c6ef5',
  middle: '#37b24d',
  elite: '#f59f00',
};

export const SUBCULTURE_COLORS: Record<Subculture, string> = {
  mainstream: '#868e96',
  traditionalist: '#d9480f',
  bohemian: '#e64980',
  labor_militant: '#c92a2a',
  entrepreneur: '#2b8a3e',
  nationalist: '#5f3dc4',
  communitarian: '#0ca678',
};

export const BUILDING_COLORS: Record<BuildingType, string> = {
  house: '#ebe6dc',
  tenement: '#cfc8bc',
  manor: '#f3e5c8',
  farm: '#d8eac0',
  mill: '#e8dcc4',
  bakery: '#f2d8bf',
  lumber_camp: '#dcc6aa',
  mine: '#c5c9ce',
  workshop: '#d5c6b8',
  smithy: '#c9bdb6',
  tailor_shop: '#e6d3e8',
  factory: '#bfc6cf',
  warehouse: '#d4cfc7',
  market: '#f8e7a8',
  bank: '#d0e3d4',
  tavern: '#ebd1b7',
  theater: '#f2cfe0',
  clinic: '#f7d4e0',
  school: '#cfe2f7',
  university: '#c5d4f5',
  temple: '#f5e6c4',
  townhall: '#d9d0f2',
  guardhouse: '#b9c0e6',
  prison: '#b4b8bf',
  yard: '#f7e2c4',
  plaza: '#f1f1ef',
  monument: '#e3dfd5',
};

export const COLOR_MODE_LABELS: Record<ColorMode, string> = {
  job: 'Occupation',
  happiness: 'Happiness',
  econ: 'Economic belief',
  auth: 'Authority belief',
  trad: 'Tradition belief',
  faction: 'Political Faction',
  wealth: 'Wealth',
  class: 'Social Class',
  subculture: 'Subculture',
  activity: 'Activity',
};

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const rgbCache = new Map<string, [number, number, number]>();
export function rgb(hex: string) {
  let c = rgbCache.get(hex);
  if (!c) { c = hexToRgb(hex); rgbCache.set(hex, c); }
  return c;
}

function diverge(t: number, a: [number, number, number], b: [number, number, number]): [number, number, number] {
  const mid: [number, number, number] = [0.85, 0.85, 0.85];
  if (t < 0.5) { const k = t * 2; return [a[0] + (mid[0] - a[0]) * k, a[1] + (mid[1] - a[1]) * k, a[2] + (mid[2] - a[2]) * k]; }
  const k = (t - 0.5) * 2; return [mid[0] + (b[0] - mid[0]) * k, mid[1] + (b[1] - mid[1]) * k, mid[2] + (b[2] - mid[2]) * k];
}

const RED: [number, number, number] = [0.88, 0.19, 0.19];
const BLUE: [number, number, number] = [0.2, 0.36, 0.86];
const GREEN: [number, number, number] = [0.18, 0.62, 0.27];
const PURPLE: [number, number, number] = [0.45, 0.2, 0.7];
const YELLOW: [number, number, number] = [0.98, 0.72, 0.1];
const TEAL: [number, number, number] = [0.06, 0.65, 0.58];
const AMBER: [number, number, number] = [0.85, 0.45, 0.08];
const GOLD: [number, number, number] = [0.9, 0.66, 0.05];

export function agentColor(sim: Simulation, a: Agent, mode: ColorMode, wealthRank: (a: Agent) => number): [number, number, number] {
  switch (mode) {
    case 'job': return rgb(JOB_COLORS[a.job]);
    case 'activity': return rgb(ACTIVITY_COLORS[a.activity]);
    case 'happiness': return diverge(a.happiness, RED, GREEN);
    case 'econ': return diverge((a.beliefs.econ + 1) / 2, RED, BLUE);
    case 'auth': return diverge((a.beliefs.auth + 1) / 2, YELLOW, PURPLE);
    case 'trad': return diverge((a.beliefs.trad + 1) / 2, TEAL, AMBER);
    case 'faction': { const f = sim.faction(a.factionId); return f ? rgb(f.color) : [0.82, 0.82, 0.82]; }
    case 'class': return rgb(CLASS_COLORS[a.classIdentity]);
    case 'subculture': return rgb(SUBCULTURE_COLORS[a.subculture]);
    case 'wealth': { const r = wealthRank(a); return [0.75 + (GOLD[0] - 0.75) * r, 0.75 + (GOLD[1] - 0.75) * r, 0.75 + (GOLD[2] - 0.75) * r]; }
  }
}

export function legendFor(sim: Simulation, mode: ColorMode): { label: string; color: string }[] {
  switch (mode) {
    case 'job': return Object.entries(JOB_COLORS).map(([label, color]) => ({ label: label.replace('_', ' '), color }));
    case 'activity': return Object.entries(ACTIVITY_COLORS).filter(([k]) => k !== 'commute' && k !== 'riot').map(([label, color]) => ({ label, color }));
    case 'happiness': return [{ label: 'miserable', color: '#e03131' }, { label: 'neutral', color: '#d9d9d9' }, { label: 'content', color: '#2f9e44' }];
    case 'econ': return [{ label: 'collectivist (left)', color: '#e03131' }, { label: 'center', color: '#d9d9d9' }, { label: 'free-market (right)', color: '#3b5bdb' }];
    case 'auth': return [{ label: 'libertarian', color: '#fab005' }, { label: 'center', color: '#d9d9d9' }, { label: 'authoritarian', color: '#7048e8' }];
    case 'trad': return [{ label: 'progressive', color: '#0ca678' }, { label: 'center', color: '#d9d9d9' }, { label: 'traditionalist', color: '#d9480f' }];
    case 'faction': return [...sim.state.factions.map(f => ({ label: f.name, color: f.color })), { label: 'unaffiliated', color: '#d1d1d1' }];
    case 'class': return Object.entries(CLASS_COLORS).map(([label, color]) => ({ label, color }));
    case 'subculture': return Object.entries(SUBCULTURE_COLORS).map(([label, color]) => ({ label: label.replace('_', ' '), color }));
    case 'wealth': return [{ label: 'poorest', color: '#bfbfbf' }, { label: 'richest', color: '#e6a800' }];
  }
}

export function ownershipColor(sim: Simulation, b: Building): string {
  if (b.ownerKind === 'state') return '#f4c7c3';
  if (b.ownerKind === 'collective') return '#c6e9c9';
  if (b.ownerHouseholdId == null) return BUILDING_COLORS[b.type];
  const h = (b.ownerHouseholdId * 137.508) % 360;
  void sim;
  return `hsl(${h.toFixed(0)}, 55%, 72%)`;
}
