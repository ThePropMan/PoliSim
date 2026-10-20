import type { Culture, Policy } from '../sim/types';
import { PLANNING_STRATEGIES } from '../sim/presets';

type SliderField<T> = { kind: 'slider'; key: keyof T; label: string; min: number; max: number; step: number; help: string; fmt?: (v: number) => string; setupOnly?: boolean };
type SelectField<T> = { kind: 'select'; key: keyof T; label: string; options: { value: string; label: string }[]; help: string };
type Field<T> = SliderField<T> | SelectField<T>;

const pctFmt = (v: number) => `${Math.round(v * 100)}%`;

export const POLICY_FIELDS: Field<Policy>[] = [
  { kind: 'select', key: 'governance', label: 'Governance', help: 'Who holds political power and how it changes hands.', options: [
    { value: 'none', label: 'None (stateless)' }, { value: 'council', label: 'Open council' }, { value: 'democracy', label: 'Elected democracy' },
    { value: 'autocracy', label: 'One-party / autocracy' }, { value: 'monarchy', label: 'Hereditary monarchy' }] },
  { kind: 'select', key: 'ownership', label: 'Ownership', help: 'Who owns farms, workshops, factories, and housing.', options: [
    { value: 'private', label: 'Private' }, { value: 'collective', label: 'Worker collectives' }, { value: 'state', label: 'State' }] },
  { kind: 'select', key: 'allocation', label: 'Allocation', help: 'How goods reach people: prices, rations, or a shared commons.', options: [
    { value: 'market', label: 'Market (prices & wages)' }, { value: 'planned', label: 'Central plan (rations)' }, { value: 'commons', label: 'Commons (take what you need)' }] },
  { kind: 'select', key: 'planningStrategy', label: 'Gosplan strategy', help: 'Production priorities when running a centrally planned economy.', options:
    Object.values(PLANNING_STRATEGIES).map(s => ({ value: s.id, label: s.name })) },
  { kind: 'slider', key: 'taxRate', label: 'Tax rate', min: 0, max: 0.8, step: 0.01, help: 'Share of incomes, profits and rents taken by the state.', fmt: pctFmt },
  { kind: 'slider', key: 'welfare', label: 'Welfare & pensions', min: 0, max: 1, step: 0.01, help: 'How much of the treasury is redistributed to poor & elderly households.', fmt: pctFmt },
  { kind: 'slider', key: 'publicServices', label: 'Public services', min: 0, max: 1, step: 0.01, help: 'Staffing of clinics, schools, and universities (health, education, skills).', fmt: pctFmt },
  { kind: 'slider', key: 'enforcement', label: 'Policing', min: 0, max: 1, step: 0.01, help: 'Number and harshness of guards. Deters crime, crushes dissent.', fmt: pctFmt },
  { kind: 'slider', key: 'civilLiberty', label: 'Civil liberties', min: 0, max: 1, step: 0.01, help: 'Freedom of speech and assembly. Low values push opposition underground.', fmt: pctFmt },
  { kind: 'slider', key: 'wageFloor', label: 'Wage floor', min: 0, max: 1, step: 0.01, help: 'Minimum wage (markets) or wage equality (state firms).', fmt: pctFmt },
  { kind: 'slider', key: 'interestRate', label: 'Interest rate', min: 0, max: 0.25, step: 0.01, help: 'Annual interest rate on private bank loans and household debt.', fmt: pctFmt },
  { kind: 'slider', key: 'moneyPrinting', label: 'Money printing', min: 0, max: 0.5, step: 0.01, help: 'State seigniorage / money creation. Funds the treasury but drives inflation.', fmt: pctFmt },
  { kind: 'slider', key: 'inheritance', label: 'Inheritance', min: 0, max: 1, step: 0.01, help: 'Share of an estate passed to heirs rather than the treasury.', fmt: pctFmt },
  { kind: 'slider', key: 'corruption', label: 'Corruption', min: 0, max: 1, step: 0.01, help: 'Officials skim the treasury, take larger rations, and fuel black markets.', fmt: pctFmt },
  { kind: 'slider', key: 'planningEfficiency', label: 'Planning efficiency', min: 0, max: 1, step: 0.01, help: 'How accurately planners match production to need (planned economies).', fmt: pctFmt },
  { kind: 'slider', key: 'culturalSubsidy', label: 'Cultural patronage', min: 0, max: 1, step: 0.01, help: 'Public funding for theaters, artists, and seasonal festivals.', fmt: pctFmt },
  { kind: 'slider', key: 'religiousFreedom', label: 'Religious freedom', min: 0, max: 1, step: 0.01, help: 'Freedom of worship and clergy activity.', fmt: pctFmt },
  { kind: 'slider', key: 'birthSupport', label: 'Family support', min: 0, max: 1, step: 0.01, help: 'Child grants and cultural encouragement for families.', fmt: pctFmt },
  { kind: 'slider', key: 'electionYears', label: 'Election interval', min: 1, max: 10, step: 1, help: 'Years between elections (democracy only).', fmt: v => `${v}y` },
  { kind: 'select', key: 'electoralSystem', label: 'Electoral system', help: 'How votes translate into power: first-past-the-post, proportional representation, or two-round runoff.', options: [
    { value: 'fptp', label: 'First-past-the-post' }, { value: 'pr', label: 'Proportional (coalitions)' }, { value: 'runoff', label: 'Two-round runoff' }] },
  { kind: 'slider', key: 'suffrage', label: 'Suffrage', min: 0.1, max: 1, step: 0.01, help: 'Share of adults who can vote — the poorest are excluded first (property franchise).', fmt: pctFmt },
  { kind: 'slider', key: 'termLimits', label: 'Term limits', min: 0, max: 5, step: 1, help: 'Max consecutive terms a leader may serve (0 = unlimited).', fmt: v => v === 0 ? 'none' : `${v}` },
  { kind: 'slider', key: 'judiciary', label: 'Judiciary independence', min: 0, max: 1, step: 0.01, help: 'Independent courts block unconstitutional seizures and soften purges.', fmt: pctFmt },
  { kind: 'slider', key: 'pressFreedom', label: 'Press freedom', min: 0, max: 1, step: 0.01, help: 'Free media propagates corruption scandals; censorship builds hidden dissent that bursts later.', fmt: pctFmt },
  { kind: 'slider', key: 'militaryPower', label: 'Military autonomy', min: 0, max: 1, step: 0.01, help: 'How independent and powerful the armed guards are — high values invite coups when the regime weakens.', fmt: pctFmt },
  { kind: 'slider', key: 'ownerConcentration', label: 'Wealth concentration', min: 0, max: 1, step: 0.01, help: 'Initial concentration of property in few hands (private ownership).', fmt: pctFmt, setupOnly: true },
];

type CultureFlat = {
  collectivism: number; trust: number; religiosity: number; workEthic: number; artisticSpirit: number;
  econ: number; auth: number; trad: number; beliefSpread: number;
};

export const CULTURE_FIELDS: Field<CultureFlat>[] = [
  { kind: 'slider', key: 'econ', label: 'Economic center', min: -1, max: 1, step: 0.01, help: 'Average starting belief: -1 collectivist, +1 free-market.', fmt: v => v.toFixed(2) },
  { kind: 'slider', key: 'auth', label: 'Authority center', min: -1, max: 1, step: 0.01, help: 'Average starting belief: -1 libertarian, +1 authoritarian.', fmt: v => v.toFixed(2) },
  { kind: 'slider', key: 'trad', label: 'Tradition center', min: -1, max: 1, step: 0.01, help: 'Average starting belief: -1 progressive, +1 traditional.', fmt: v => v.toFixed(2) },
  { kind: 'slider', key: 'beliefSpread', label: 'Ideological diversity', min: 0.15, max: 0.85, step: 0.01, help: 'How spread out starting beliefs are across the population.', fmt: v => v.toFixed(2) },
  { kind: 'slider', key: 'collectivism', label: 'Collectivism', min: 0, max: 1, step: 0.01, help: 'Cultural willingness to share and work for the group.', fmt: pctFmt },
  { kind: 'slider', key: 'trust', label: 'Social trust', min: 0, max: 1, step: 0.01, help: 'Trust between strangers. Reduces hoarding and free-riding.', fmt: pctFmt },
  { kind: 'slider', key: 'religiosity', label: 'Religiosity', min: 0, max: 1, step: 0.01, help: 'Strength of faith, temple attendance, and traditional family norms.', fmt: pctFmt },
  { kind: 'slider', key: 'workEthic', label: 'Work ethic', min: 0, max: 1, step: 0.01, help: 'Cultural pride in diligence and craftsmanship.', fmt: pctFmt },
  { kind: 'slider', key: 'artisticSpirit', label: 'Artistic spirit', min: 0, max: 1, step: 0.01, help: 'Appreciation for theater, music, and bohemian expression.', fmt: pctFmt },
];

export function renderFields<T extends object>(container: HTMLElement, fields: Field<T>[], obj: T, onChange: (key: keyof T, value: number | string) => void, opts: { includeSetupOnly?: boolean } = {}) {
  container.innerHTML = '';
  const inputs = new Map<keyof T, { input: HTMLInputElement | HTMLSelectElement; val?: HTMLSpanElement; field: Field<T> }>();
  for (const f of fields) {
    if (f.kind === 'slider' && f.setupOnly && !opts.includeSetupOnly) continue;
    const row = document.createElement('div');
    row.title = f.help;
    const label = document.createElement('label');
    label.textContent = f.label;
    if (f.kind === 'slider') {
      row.className = 'slider-row';
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(f.min); input.max = String(f.max); input.step = String(f.step);
      input.value = String(obj[f.key]);
      const val = document.createElement('span');
      val.className = 'val';
      val.textContent = (f.fmt ?? String)(Number(obj[f.key]));
      input.addEventListener('input', () => { const v = Number(input.value); val.textContent = (f.fmt ?? String)(v); onChange(f.key, v); });
      row.append(label, input, val);
      inputs.set(f.key, { input, val, field: f });
    } else {
      row.className = 'select-row';
      const sel = document.createElement('select');
      for (const o of f.options) { const op = document.createElement('option'); op.value = o.value; op.textContent = o.label; sel.append(op); }
      sel.value = String(obj[f.key]);
      sel.addEventListener('change', () => onChange(f.key, sel.value));
      row.append(label, sel);
      inputs.set(f.key, { input: sel, field: f });
    }
    container.append(row);
  }
  return (next: T) => {
    for (const [key, { input, val, field }] of inputs) {
      if (document.activeElement === input) continue;
      const v = next[key];
      if (String(input.value) !== String(v)) input.value = String(v);
      if (val && field.kind === 'slider') val.textContent = (field.fmt ?? String)(Number(v));
    }
  };
}

export function flattenCulture(c: Culture): CultureFlat {
  return {
    collectivism: c.collectivism, trust: c.trust, religiosity: c.religiosity,
    workEthic: c.workEthic, artisticSpirit: c.artisticSpirit,
    econ: c.beliefCenter.econ, auth: c.beliefCenter.auth, trad: c.beliefCenter.trad, beliefSpread: c.beliefSpread,
  };
}

export function unflattenCulture(f: CultureFlat): Culture {
  return {
    collectivism: f.collectivism, trust: f.trust, religiosity: f.religiosity,
    workEthic: f.workEthic, artisticSpirit: f.artisticSpirit,
    socialMobility: 0.55, classConsciousness: 0.3, cohesion: 0.7, festivalDaysLeft: 0,
    beliefCenter: { econ: f.econ, auth: f.auth, trad: f.trad }, beliefSpread: f.beliefSpread, comfortNorm: -1,
  };
}
