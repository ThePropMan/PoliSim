import type { Rng } from './rng';

const M = ['Aren', 'Bram', 'Cal', 'Dorin', 'Ezra', 'Finn', 'Gael', 'Hal', 'Ivo', 'Jory', 'Kai', 'Leof', 'Milo', 'Nael', 'Oren', 'Pell', 'Quin', 'Rafe', 'Silas', 'Tobin', 'Ulric', 'Vane', 'Wes', 'Yann', 'Zev', 'Anselm', 'Bastian', 'Cyrus', 'Dax', 'Emory'];
const F = ['Ada', 'Brin', 'Cora', 'Della', 'Elin', 'Faye', 'Greta', 'Hana', 'Isla', 'Juna', 'Kira', 'Lise', 'Mira', 'Nell', 'Opal', 'Pia', 'Rhea', 'Sade', 'Tess', 'Una', 'Vera', 'Wren', 'Yara', 'Zia', 'Astrid', 'Bea', 'Calla', 'Dina', 'Esme', 'Freya'];
const LAST_A = ['Ash', 'Black', 'Bright', 'Cold', 'Dun', 'East', 'Fair', 'Green', 'Hart', 'Iron', 'Long', 'Mill', 'North', 'Oak', 'Red', 'Stone', 'Thorn', 'West', 'White', 'Wood'];
const LAST_B = ['ford', 'well', 'field', 'wick', 'more', 'brook', 'ton', 'hill', 'wood', 'by', 'stead', 'gate', 'man', 'ley', 'ridge'];

export function firstName(rng: Rng, sex: 'M' | 'F') { return rng.pick(sex === 'M' ? M : F); }
export function surname(rng: Rng) { return rng.pick(LAST_A) + rng.pick(LAST_B); }

// ---------------------------------------------------------------- parties
// Names are generated from the faction's position on all three axes: the
// strongest pole picks the word pool, so a party's name actually signals its
// ideology ("Iron Legion" reads authoritarian, "Bread Union" reads left,
// "Hearth Covenant" reads traditional).

type Pole = 'left' | 'right' | 'auth' | 'lib' | 'trad' | 'prog' | 'centre';

const WORDS: Record<Pole, { adj: string[]; noun: string[]; ideals: string[] }> = {
  left: {
    adj: ['Workers\'', 'Labour', 'Red', 'Social', 'Common', 'People\'s', 'United', 'Bread'],
    noun: ['Union', 'Front', 'Commune', 'Collective', 'Alliance', 'Assembly', 'Cause', 'Federation'],
    ideals: ['Labour', 'Bread', 'the Workers', 'Justice', 'the Common Good', 'Equality'],
  },
  right: {
    adj: ['Free', 'Golden', 'Merchant', 'Enterprise', 'Prosperity', 'Liberal', 'Commercial'],
    noun: ['League', 'Guild', 'Compact', 'Society', 'Association', 'Circle', 'Party'],
    ideals: ['Prosperity', 'Commerce', 'Free Trade', 'Industry', 'Property'],
  },
  auth: {
    adj: ['Iron', 'Black', 'National', 'Patriotic', 'Imperial', 'Royal'],
    noun: ['Legion', 'Vanguard', 'Directorate', 'Guard', 'Order', 'Banner', 'Phalanx'],
    ideals: ['Order', 'the Nation', 'the Realm', 'Discipline', 'Unity'],
  },
  lib: {
    adj: ['Free', 'Open', 'Liberty', 'Civic', 'Mutual', 'Independent'],
    noun: ['Circle', 'Federation', 'Movement', 'Network', 'Coalition', 'Assembly'],
    ideals: ['Liberty', 'Rights', 'Freedom', 'Self-Rule', 'the Free Citizen'],
  },
  trad: {
    adj: ['Faithful', 'Old', 'Holy', 'Ancestral', 'Covenant', 'Hearth'],
    noun: ['Covenant', 'Faith', 'Path', 'Hearth', 'Banner', 'Communion', 'Fellowship'],
    ideals: ['Tradition', 'the Faith', 'the Old Ways', 'the Hearth', 'Virtue'],
  },
  prog: {
    adj: ['New', 'Radical', 'Reform', 'Bright', 'Tomorrow'],
    noun: ['Dawn', 'Movement', 'League', 'Coalition', 'Assembly', 'Current'],
    ideals: ['Reform', 'Renewal', 'the Future', 'Progress', 'a New Dawn'],
  },
  centre: {
    adj: ['United', 'Common', 'Moderate', 'National', 'Town', 'Civic'],
    noun: ['Alliance', 'Party', 'Bloc', 'Union', 'Compact', 'Convention'],
    ideals: ['Unity', 'Stability', 'the Town', 'Common Sense', 'the Middle Way'],
  },
};

export function factionName(rng: Rng, econ: number, auth: number, trad = 0): string {
  // Pick the strongest pole (auth counts a bit heavier — discipline defines a
  // movement's tone more than economics does); near-centre gets centre words
  const scores: [Pole, number][] = [
    ['left', -econ], ['right', econ],
    ['auth', auth * 1.15], ['lib', -auth * 1.15],
    ['trad', trad * 0.9], ['prog', -trad * 0.9],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const pole: Pole = scores[0][1] < 0.18 ? 'centre'
    : scores[1][1] > 0.15 && rng.chance(0.3) ? scores[1][0]   // sometimes use the runner-up pole
    : scores[0][0];
  const w = WORDS[pole];
  const roll = rng.next();
  if (roll < 0.12) {
    // "Alliance for Labour", "Movement for Order" — cause-forward names
    const noun = rng.pick(['Alliance', 'Movement', 'League', 'Front', 'Bloc', 'Coalition']);
    return `${noun} for ${rng.pick(w.ideals)}`;
  }
  if (roll < 0.24) {
    // "Thornford Compact", "Millgate Union" — toponymic names feel local
    return `${surname(rng)} ${rng.pick(w.noun)}`;
  }
  return `${rng.pick(w.adj)} ${rng.pick(w.noun)}`;
}

const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#469990', '#800000', '#808000', '#000075', '#bfef45', '#dcbeff', '#ffd8b1'];
export function factionColor(id: number) { return COLORS[id % COLORS.length]; }
