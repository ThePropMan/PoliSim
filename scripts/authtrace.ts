import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

const presetId = process.argv[2] ?? 'statesoc';
const seed = Number(process.argv[3] ?? 777);
const years = Number(process.argv[4] ?? 15);
const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
const sim = Simulation.create({
  sizePreset: 'town', ideologyPreset: presetId, population: 400, seed,
  policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
});
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
for (let half = 0; half < years * 2; half++) {
  sim.runDays(15);
  const s = sim.state, g = s.gov;
  const adults = sim.adults();
  const ruling = sim.faction(g.rulingFactionId);
  const members = ruling ? adults.filter(a => a.factionId === ruling.id) : [];
  const leader = sim.agent(g.leaderId);
  console.log(
    `y${(s.day / 30).toFixed(1).padStart(4)} citEcon=${mean(adults.map(a => a.beliefs.econ)).toFixed(2)} citAuth=${mean(adults.map(a => a.beliefs.auth)).toFixed(2)} ` +
    `rul=${(ruling?.name ?? '-').slice(0, 16).padEnd(16)} plat=${ruling?.platform.econ.toFixed(2)}/${ruling?.platform.auth.toFixed(2)} mem=${members.length} memEcon=${mean(members.map(a => a.beliefs.econ)).toFixed(2)} ` +
    `ldr=${leader?.beliefs.econ.toFixed(2)} gov=${g.position.econ.toFixed(2)} pol=${s.policy.governance}/${s.policy.ownership}/${s.policy.allocation} ` +
    `legit=${g.legitimacy.toFixed(2)} happy=${s.stats.at(-1)!.happiness.toFixed(2)} food=${s.stats.at(-1)!.foodSecurity.toFixed(2)} griev=${mean(adults.map(a => a.grievance)).toFixed(2)} fac=${s.factions.length}`,
  );
}
console.log('--- political events ---');
for (const e of sim.state.events.filter(e => e.kind === 'politics' || e.kind === 'unrest').slice(-40)) console.log(`d${e.day} ${e.text}`);
