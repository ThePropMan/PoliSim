import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';
import { beliefDistance } from '../src/sim/society';

// Party-system diagnostics: platform spread, where radicals are, and whether they organise.
const presetId = process.argv[2] ?? 'liberal';
const seed = Number(process.argv[3] ?? 1);
const years = Number(process.argv[4] ?? 30);
const p = IDEOLOGY_PRESETS.find(x => x.id === presetId)!;
const sim = Simulation.create({ sizePreset: 'town', ideologyPreset: presetId, population: 400, seed, policy: clonePolicy(p.policy), culture: cloneCulture(p.culture) });
const hist = (xs: number[]) => {
  const bins = Array(10).fill(0);
  for (const x of xs) bins[Math.min(9, Math.floor((x + 1) * 5))]++;
  return bins.map(n => String(n).padStart(3)).join(' ');
};
for (let y = 5; y <= years; y += 5) {
  sim.runDays(150);
  const s = sim.state, adults = sim.adults();
  const radL = adults.filter(a => a.beliefs.econ < -0.5), radR = adults.filter(a => a.beliefs.econ > 0.5);
  const radAuth = adults.filter(a => Math.abs(a.beliefs.auth) > 0.5);
  const inFac = (xs: typeof adults) => xs.filter(a => a.factionId != null).length;
  const facOf = (xs: typeof adults) => {
    const m = new Map<string, number>();
    for (const a of xs) { const f = sim.faction(a.factionId); if (f) m.set(f.name, (m.get(f.name) ?? 0) + 1); }
    return [...m].map(([n, c]) => `${n}:${c}`).join(', ');
  };
  console.log(`\n== y${y} adults=${adults.length} spreadE=${s.culture.beliefSpread.toFixed(2)} ruling=${sim.faction(s.gov.rulingFactionId)?.name}`);
  console.log(`  econ hist [-1..1]: ${hist(adults.map(a => a.beliefs.econ))}`);
  console.log(`  auth hist [-1..1]: ${hist(adults.map(a => a.beliefs.auth))}`);
  console.log(`  radical left=${radL.length} (in party ${inFac(radL)}: ${facOf(radL)})  radical right=${radR.length} (in party ${inFac(radR)}: ${facOf(radR)})  |auth|>.5=${radAuth.length}`);
  for (const f of [...s.factions].sort((a, b) => a.platform.econ - b.platform.econ)) {
    const ms = adults.filter(a => a.factionId === f.id);
    const disp = ms.reduce((t, a) => t + beliefDistance(a.beliefs, f.platform), 0) / Math.max(1, ms.length);
    const memE = ms.map(a => a.beliefs.econ);
    console.log(`  ${f.name.padEnd(22)} econ=${f.platform.econ.toFixed(2).padStart(5)} auth=${f.platform.auth.toFixed(2).padStart(5)} founded=${f.founding.econ.toFixed(2).padStart(5)} m=${String(ms.length).padStart(3)} disp=${disp.toFixed(2)} memRange=[${Math.min(...memE).toFixed(2)},${Math.max(...memE).toFixed(2)}] anger=${f.anger.toFixed(2)}`);
  }
}
const ev = sim.state.events.filter(e => /founded the|dissolved|split from|joined the .* in /.test(e.text));
console.log(`\nlast party lifecycle events (${ev.length}):`);
for (const e of ev.slice(-15)) console.log(`  d${e.day} ${e.text}`);
