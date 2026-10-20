import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

// Who wins democratic elections? Prints each result line plus the winner's share,
// membership count (auto-vote floor) and the electorate's mean/median position.
const years = Number(process.argv[2] ?? 40);
const seeds = (process.argv[3] ?? '1,2').split(',').map(Number);
const ids = process.argv[4]?.split(',') ?? ['liberal', 'socdem', 'marketsoc', 'minarchy', 'distributist'];
for (const id of ids) {
  const p = IDEOLOGY_PRESETS.find(x => x.id === id)!;
  let left = 0, right = 0, center = 0;
  const lines: string[] = [];
  for (const seed of seeds) {
    const sim = Simulation.create({ sizePreset: 'town', ideologyPreset: id, population: 400, seed, policy: clonePolicy(p.policy), culture: cloneCulture(p.culture) });
    const wins: string[] = [];
    sim.listeners.push(e => {
      if (!e.text.startsWith('Election:')) return;
      const s = sim.state;
      const name = /the (.+?) (?:won|was re-elected)/.exec(e.text)?.[1];
      const f = s.factions.find(x => x.name === name);
      if (!f) return;
      const voters = sim.adults();
      const median = [...voters.map(a => a.beliefs.econ)].sort((a, b) => a - b)[voters.length >> 1];
      const e2 = f.platform.econ;
      if (e2 < -0.15) left++; else if (e2 > 0.15) right++; else center++;
      const res = /\((.+)\)$/.exec(e.text)?.[1] ?? '';
      wins.push(`y${Math.floor(s.day / 30)} ${f.name}@${e2.toFixed(2)} m${f.members} [${res}] med${median.toFixed(2)}`);
    });
    sim.runDays(years * 30);
    lines.push(`  seed${seed}: ${wins.join(' | ')}`);
  }
  console.log(`${p.name} — winners: left=${left} center=${center} right=${right}`);
  for (const l of lines) console.log(l);
}
