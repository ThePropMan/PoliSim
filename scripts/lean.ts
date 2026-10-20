import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

// Society-wide ideological drift per preset: mean econ belief at y0 / y10 / y20 / y40, plus merger count.
const years = Number(process.argv[2] ?? 40);
const seeds = (process.argv[3] ?? '1,2').split(',').map(Number);
const ids = process.argv[4]?.split(',') ?? IDEOLOGY_PRESETS.map(p => p.id);
const mean = (xs: number[]) => xs.reduce((t, x) => t + x, 0) / Math.max(1, xs.length);
for (const id of ids) {
  const p = IDEOLOGY_PRESETS.find(x => x.id === id)!;
  const rows: string[] = [];
  for (const seed of seeds) {
    const sim = Simulation.create({ sizePreset: 'town', ideologyPreset: id, population: 400, seed, policy: clonePolicy(p.policy), culture: cloneCulture(p.culture) });
    const samples: string[] = [];
    const econ = () => mean(sim.adults().map(a => a.beliefs.econ)).toFixed(2);
    samples.push(econ());
    for (let y = 1; y <= years; y++) { sim.runDays(30); if (y === 10 || y === 20 || y === years) samples.push(econ()); }
    const merges = sim.state.events.filter(e => /joined the .* in /.test(e.text)).length;
    rows.push(`seed${seed}: ${samples.join(' → ')} merges(last450ev)=${merges} regime=${sim.state.gov.regimeName}`);
  }
  console.log(`${p.name.padEnd(26)} preset center=${p.culture.beliefCenter.econ.toFixed(2)}\n   ${rows.join('\n   ')}`);
}
