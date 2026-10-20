import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, SIZE_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';
import { regimePower } from '../src/sim/politics';

const years = Number(process.argv[2] ?? 30);
const size = SIZE_PRESETS.find(s => s.id === (process.argv[3] ?? 'town'))!;
const only = process.argv[4];
const seed = Number(process.argv[5] ?? 12345);

for (const preset of IDEOLOGY_PRESETS) {
  if (only && !only.split(',').includes(preset.id)) continue;
  const t0 = performance.now();
  const sim = Simulation.create({
    sizePreset: size.id, ideologyPreset: preset.id, population: size.population, seed,
    policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
  });
  const lines: string[] = [];
  for (let y = 1; y <= years; y++) {
    sim.runDays(30);
    if (y % Math.max(1, Math.floor(years / 6)) === 0 || y === years) {
      const st = sim.state.stats.at(-1)!;
      const opp = sim.state.factions.filter(f => f.id !== sim.state.gov.rulingFactionId).sort((a, b) => b.strength - a.strength)[0];
      lines.push(`  y${String(y).padStart(3)} pop=${String(st.pop).padStart(4)} happy=${st.happiness.toFixed(2)} food=${st.foodSecurity.toFixed(2)} gini=${st.gini.toFixed(2)} legit=${st.legitimacy.toFixed(2)} unemp=${st.unemployment.toFixed(2)} fac=${sim.state.factions.length} econ=${st.econ.toFixed(2)} auth=${st.auth.toFixed(2)} trad=${st.trad.toFixed(2)} spread=${st.beliefSpread.toFixed(2)} inf=${(st.inflation * 100).toFixed(0)}% debt=${Math.round(st.totalDebt)} short=${(st.shortage * 100).toFixed(0)}% regime=${sim.state.gov.regimeName} opp=${opp ? `${opp.members}m/${opp.anger.toFixed(2)}a` : '-'} pwr=${regimePower(sim).toFixed(0)}`);
    }
  }
  const ms = performance.now() - t0;
  const pol = sim.state.events.filter(e => e.kind === 'politics' || e.kind === 'unrest');
  console.log(`\n=== ${preset.name} (${size.name}, ${years}y, ${(ms / 1000).toFixed(1)}s) revolutions=${sim.state.gov.revolutions} elections=${sim.state.gov.elections}`);
  console.log(lines.join('\n'));
  console.log('  recent political events:');
  for (const e of pol.slice(-6)) console.log(`   [y${Math.floor(e.day / 30)}] ${e.text}`);
  Simulation.deserialize(sim.serialize());
}
