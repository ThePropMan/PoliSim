import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

const presetId = process.argv[2] ?? 'liberal';
const seed = Number(process.argv[3] ?? 777);
const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
const sim = Simulation.create({
  sizePreset: 'town', ideologyPreset: presetId, population: 400, seed,
  policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
});

for (let y = 0; y < 40; y++) {
  sim.runDays(30);
  const s = sim.state;
  const ruler = s.factions.find(f => f.id === s.gov.rulingFactionId);
  if ((y + 1) % 4 === 0 || y === 0) {
    console.log(
      `y${y + 1} ruler=${(ruler?.name ?? 'none').slice(0, 28)} econ=${ruler?.platform.econ.toFixed(2)} ` +
      `tax=${s.policy.taxRate.toFixed(2)} welfare=${s.policy.welfare.toFixed(2)} ` +
      `gini=${s.stats.at(-1)!.gini.toFixed(2)} unemp=${s.stats.at(-1)!.unemployment.toFixed(2)}`
    );
  }
}
console.log('--- election/riot/concession events ---');
for (const e of sim.state.events.filter(l => /Election|riot|concession|reform/i.test(l.text)).slice(-20)) {
  console.log('d' + e.day, e.text);
}
