import type { Rng } from './rng';

const M = ['Aren', 'Bram', 'Cal', 'Dorin', 'Ezra', 'Finn', 'Gael', 'Hal', 'Ivo', 'Jory', 'Kai', 'Leof', 'Milo', 'Nael', 'Oren', 'Pell', 'Quin', 'Rafe', 'Silas', 'Tobin', 'Ulric', 'Vane', 'Wes', 'Yann', 'Zev', 'Anselm', 'Bastian', 'Cyrus', 'Dax', 'Emory'];
const F = ['Ada', 'Brin', 'Cora', 'Della', 'Elin', 'Faye', 'Greta', 'Hana', 'Isla', 'Juna', 'Kira', 'Lise', 'Mira', 'Nell', 'Opal', 'Pia', 'Rhea', 'Sade', 'Tess', 'Una', 'Vera', 'Wren', 'Yara', 'Zia', 'Astrid', 'Bea', 'Calla', 'Dina', 'Esme', 'Freya'];
const LAST_A = ['Ash', 'Black', 'Bright', 'Cold', 'Dun', 'East', 'Fair', 'Green', 'Hart', 'Iron', 'Long', 'Mill', 'North', 'Oak', 'Red', 'Stone', 'Thorn', 'West', 'White', 'Wood'];
const LAST_B = ['ford', 'well', 'field', 'wick', 'more', 'brook', 'ton', 'hill', 'wood', 'by', 'stead', 'gate', 'man', 'ley', 'ridge'];

export function firstName(rng: Rng, sex: 'M' | 'F') { return rng.pick(sex === 'M' ? M : F); }
export function surname(rng: Rng) { return rng.pick(LAST_A) + rng.pick(LAST_B); }

const ADJ = ['People\'s', 'Free', 'United', 'New', 'Workers\'', 'Patriotic', 'Radical', 'Popular', 'Liberty', 'Red', 'Green', 'Black', 'Golden', 'Iron', 'Common'];
const NOUN_LEFT = ['Commune', 'Collective', 'Front', 'Union', 'Soviet', 'Assembly', 'Brotherhood'];
const NOUN_RIGHT = ['League', 'Party', 'Alliance', 'Guild', 'Society', 'Order', 'Compact'];
const NOUN_AUTH = ['Vanguard', 'Order', 'Legion', 'Directorate', 'Guard'];
const NOUN_LIB = ['Circle', 'Movement', 'Network', 'Federation', 'Coalition'];

export function factionName(rng: Rng, econ: number, auth: number): string {
  const pool = auth > 0.4 ? NOUN_AUTH : auth < -0.4 ? NOUN_LIB : econ < 0 ? NOUN_LEFT : NOUN_RIGHT;
  return `${rng.pick(ADJ)} ${rng.pick(pool)}`;
}

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#469990', '#800000', '#808000', '#000075', '#bfef45', '#dcbeff', '#ffd8b1'];
export function factionColor(id: number) { return COLORS[id % COLORS.length]; }
