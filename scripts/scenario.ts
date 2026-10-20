import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';
import { INTERVENTIONS } from '../src/sim/interventions';
import { regimePower } from '../src/sim/politics';
import type { Policy } from '../src/sim/types';

function run(name: string, presetId: string, years: number, modify: (sim: Simulation, year: number) => void, policy?: Partial<Policy>, seed = 7) {
  const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
  const sim = Simulation.create({ sizePreset: 'town', ideologyPreset: presetId, population: 400, seed, policy: { ...clonePolicy(preset.policy), ...policy }, culture: cloneCulture(preset.culture) });
  console.log(`\n### ${name}`);
  for (let y = 1; y <= years; y++) {
    modify(sim, y);
    sim.runDays(30);
    const st = sim.state.stats.at(-1)!;
    const opp = sim.state.factions.filter(f => f.id !== sim.state.gov.rulingFactionId).sort((a, b) => b.strength - a.strength)[0];
    console.log(`y${y} pop=${st.pop} happy=${st.happiness.toFixed(2)} food=${st.foodSecurity.toFixed(2)} legit=${st.legitimacy.toFixed(2)} power=${regimePower(sim).toFixed(0)} opp=${opp ? `${opp.members}m ${(opp.strength * (0.5 + opp.anger)).toFixed(0)}s ${opp.anger.toFixed(2)}a` : '-'} regime=${sim.state.gov.regimeName}`);
  }
  for (const e of sim.state.events.filter(e => e.kind === 'politics' || e.kind === 'unrest').slice(-12)) console.log(`   [y${Math.floor(e.day / 30)}] ${e.text}`);
}

const famine = INTERVENTIONS.find(i => i.id === 'famine')!.run;
run('Feudal + repeated famines', 'feudal', 15, (sim, y) => { if (y >= 3 && y <= 6) famine(sim); });
run('Authoritarian capitalism with crushing taxes', 'authcap', 15, () => {}, { taxRate: 0.7, welfare: 0, publicServices: 0.1, corruption: 0.6 });
run('Central planning, terrible planners', 'statesoc', 15, () => {}, { planningEfficiency: 0.1, corruption: 0.5 });
run('Liberal capitalism + famine', 'liberal', 12, (sim, y) => { if (y === 3 || y === 4) famine(sim); });
