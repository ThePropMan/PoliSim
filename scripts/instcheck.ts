import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

for (const pid of ['socdem', 'liberal', 'statesoc', 'feudal', 'anarcom']) {
  const preset = IDEOLOGY_PRESETS.find(p => p.id === pid)!;
  const sim = Simulation.create({
    sizePreset: 'town', ideologyPreset: pid, population: 400, seed: 5,
    policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
  });
  sim.runDays(2400); // ~80 years compressed; elections every ~4y
  const g = sim.state.gov;
  const seats = sim.state.factions.filter(f => f.seats > 0).map(f => `${f.name}:${f.seats}`).join(', ');
  console.log(`\n=== ${pid} ===`);
  console.log(`regime=${g.regimeName} parl=${g.parliament.length} coalition=${g.coalition.length} caretaker=${g.caretaker} martialLaw=${g.martialLaw} leader=${g.leaderId ?? 'none'}`);
  console.log(`electoralSystem=${sim.state.policy.electoralSystem} suffrage=${sim.state.policy.suffrage} termLimits=${sim.state.policy.termLimits} judiciary=${sim.state.policy.judiciary} press=${sim.state.policy.pressFreedom}`);
  console.log(`seats: ${seats || 'none'}`);
  const inst = sim.state.events.filter(l => /coalition|parliament|coup|martial|succession|scandal|press|term limit|judiciary/i.test(l.text));
  console.log(`institution events (${inst.length}):`);
  for (const e of inst.slice(-8)) console.log(`  d${e.day} ${e.text}`);
}
