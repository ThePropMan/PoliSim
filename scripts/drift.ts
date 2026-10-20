/**
 * Multi-seed realism diagnostics: faction drift, gov-vs-base gap, inequality & unemployment effects.
 * Usage: npm run drift -- [years=40] [seeds=12345,777,2024] [presetIds,comma]
 */
import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, SIZE_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';
import { beliefDistance } from '../src/sim/society';
import type { Policy } from '../src/sim/types';

const years = Number(process.argv[2] ?? 40);
const seeds = (process.argv[3] ?? '12345,777,2024').split(',').map(Number);
const only = process.argv[4];
const size = SIZE_PRESETS.find(s => s.id === 'town')!;

function members(sim: Simulation, fid: number) { return sim.state.agents.filter(a => a.factionId === fid); }
function mean(agents: { beliefs: { econ: number; auth: number; trad: number } }[]) {
  const n = Math.max(1, agents.length);
  return {
    econ: agents.reduce((t, a) => t + a.beliefs.econ, 0) / n,
    auth: agents.reduce((t, a) => t + a.beliefs.auth, 0) / n,
    trad: agents.reduce((t, a) => t + a.beliefs.trad, 0) / n,
  };
}

function factionReport(sim: Simulation): string[] {
  const s = sim.state;
  const out: string[] = [];
  for (const f of [...s.factions].sort((a, b) => b.members - a.members)) {
    const m = members(sim, f.id);
    const disp = m.length ? m.reduce((t, a) => t + beliefDistance(a.beliefs, f.platform), 0) / m.length : 0;
    const drift = beliefDistance(f.platform, f.founding ?? f.platform);
    const baseGap = beliefDistance(mean(m), f.platform);
    const ruling = f.id === s.gov.rulingFactionId;
    out.push(`    ${f.name.padEnd(28)} m=${String(f.members).padStart(3)} drift=${drift.toFixed(2)} disp=${disp.toFixed(2)} basegap=${baseGap.toFixed(2)} anger=${f.anger.toFixed(2)}${ruling ? ' [RULING]' : ''}${f.underground ? ' [UG]' : ''}`);
  }
  const ruling = sim.faction(s.gov.rulingFactionId);
  if (ruling) {
    const gap = beliefDistance(mean(members(sim, ruling.id)), s.gov.position);
    out.push(`    gov-vs-base gap: ${gap.toFixed(2)}   gov position: econ=${s.gov.position.econ.toFixed(2)} auth=${s.gov.position.auth.toFixed(2)} trad=${s.gov.position.trad.toFixed(2)}`);
  }
  return out;
}

function run(presetId: string, seed: number, yrs: number, policyOverride?: Partial<Policy>) {
  const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
  const sim = Simulation.create({
    sizePreset: size.id, ideologyPreset: presetId, population: size.population, seed,
    policy: { ...clonePolicy(preset.policy), ...policyOverride }, culture: cloneCulture(preset.culture),
  });
  const snap = (label: string) => {
    const st = sim.state.stats.at(-1)!;
    const crimes = sim.state.events.filter(e => e.kind === 'crime').length;
    const riots = sim.state.events.filter(e => /riot/i.test(e.text)).length;
    const purges = sim.state.events.filter(e => /purg/i.test(e.text)).length;
    const splits = sim.state.events.filter(e => /split from/i.test(e.text)).length;
    return `  ${label} pop=${String(st.pop).padStart(4)} happy=${st.happiness.toFixed(2)} food=${st.foodSecurity.toFixed(2)} gini=${st.gini.toFixed(2)} legit=${st.legitimacy.toFixed(2)} unemp=${st.unemployment.toFixed(2)} spread=${st.beliefSpread.toFixed(2)} fac=${sim.state.factions.length} riots=${riots} purges=${purges} splits=${splits} crimes=${crimes} rev=${sim.state.gov.revolutions} regime=${sim.state.gov.regimeName}`;
  };
  const marks = [Math.floor(yrs * 0.25), Math.floor(yrs * 0.5), yrs];
  const lines: string[] = [];
  for (let y = 1; y <= yrs; y++) {
    sim.runDays(30);
    if (marks.includes(y)) lines.push(snap(`y${String(y).padStart(3)}`));
  }
  return { sim, lines };
}

console.log(`=== FACTION DRIFT / INEQUALITY / UNEMPLOYMENT — town, ${years}y, seeds [${seeds}] ===`);
for (const preset of IDEOLOGY_PRESETS) {
  if (only && !only.split(',').includes(preset.id)) continue;
  for (const seed of seeds) {
    const t0 = performance.now();
    const { sim, lines } = run(preset.id, seed, years);
    console.log(`\n--- ${preset.name} seed=${seed} (${((performance.now() - t0) / 1000).toFixed(1)}s) ---`);
    console.log(lines.join('\n'));
    console.log(factionReport(sim).join('\n'));
  }
}

// Targeted inequality stress: liberal capitalism tuned for extreme concentration should riot/revolt
console.log('\n=== INEQUALITY STRESS: liberal, ownerConcentration=0.8, tax=0.06, welfare=0 ===');
const { sim } = run('liberal', 99, 25, { ownerConcentration: 0.8, taxRate: 0.06, welfare: 0.02, wageFloor: 0.05, publicServices: 0.1 });
for (const e of sim.state.events.filter(e => e.kind === 'unrest' || /riot|purg|split|REVOLUTION|UPRISING/.test(e.text)).slice(-14)) {
  console.log(`   [y${Math.floor(e.day / 30)}] ${e.text}`);
}
const st = sim.state.stats.at(-1)!;
console.log(`  final: gini=${st.gini.toFixed(2)} unemp=${st.unemployment.toFixed(2)} legit=${st.legitimacy.toFixed(2)} rev=${sim.state.gov.revolutions} regime=${sim.state.gov.regimeName}`);
