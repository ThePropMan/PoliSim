import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

const presetId = process.argv[2] ?? 'anarcho-communism';
const years = Number(process.argv[3] ?? 30);
const seed = Number(process.argv[4] ?? 12345);
const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
const sim = Simulation.create({
  sizePreset: 'town', ideologyPreset: preset.id, population: 400, seed,
  policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
});
const s = sim.state;

for (let y = 1; y <= years; y++) {
  sim.runDays(30);
  const st = s.stats.at(-1)!;
  console.log(`y${String(y).padStart(2)} pop=${String(s.agents.length).padStart(4)} happy=${st.happiness.toFixed(2)} food=${st.foodSecurity.toFixed(2)} unemp=${st.unemployment.toFixed(2)} gini=${st.gini.toFixed(2)}`);
}
const causes: Record<string, number> = {};
for (const e of s.events) {
  const m = e.text.match(/died of (\w+)/);
  if (m) causes[m[1]] = (causes[m[1]] ?? 0) + 1;
}
console.log('death causes:', causes);
console.log('last events:');
for (const e of s.events.slice(-15)) console.log(`  d${e.day}h${e.hour} [${e.kind}] ${e.text}`);
