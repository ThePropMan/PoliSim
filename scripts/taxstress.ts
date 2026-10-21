import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';
import type { Policy } from '../src/sim/types';

// Economic stress diagnostics: does confiscatory tax hurt? does inflation bite?
// does food security move below 1.0 under real stress?
function run(name: string, presetId: string, years: number, policy?: Partial<Policy>, seed = 11) {
  const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
  const sim = Simulation.create({ sizePreset: 'town', ideologyPreset: presetId, population: 400, seed, policy: { ...clonePolicy(preset.policy), ...policy }, culture: cloneCulture(preset.culture) });
  console.log(`\n### ${name}`);
  let minFood = 1, maxInf = 0;
  for (let y = 1; y <= years; y++) {
    sim.runDays(30);
    const st = sim.state.stats.at(-1)!;
    minFood = Math.min(minFood, st.foodSecurity);
    maxInf = Math.max(maxInf, st.inflation);
    console.log(`y${y} pop=${st.pop} happy=${st.happiness.toFixed(2)} food=${st.foodSecurity.toFixed(2)} unemp=${st.unemployment.toFixed(2)} infl=${st.inflation.toFixed(2)} gini=${st.gini.toFixed(2)} legit=${st.legitimacy.toFixed(2)} treas=${sim.state.gov.treasury.toFixed(0)} avgWage=${sim.state.market.avgWage.toFixed(1)} food$=${sim.state.market.prices.food.toFixed(1)}`);
  }
  console.log(`   minFood=${minFood.toFixed(2)} maxInflation=${maxInf.toFixed(2)}`);
  for (const e of sim.state.events.filter(e => e.kind === 'economy' || e.kind === 'unrest').slice(-8)) console.log(`   [y${Math.floor(e.day / 30)}] ${e.text}`);
}

run('Liberal baseline (tax 20%)', 'liberal', 10, { taxRate: 0.2 });
run('Liberal with confiscatory tax (80%)', 'liberal', 10, { taxRate: 0.8 });
run('Liberal with weak enforcement + confiscatory tax', 'liberal', 10, { taxRate: 0.8, enforcement: 0.2, corruption: 0.6 });
run('Liberal + monetary expansion', 'liberal', 10, { moneyPrinting: 0.5 });
run('Liberal + hyperinflationary printing', 'liberal', 10, { moneyPrinting: 1, welfare: 0.5 });
run('Social democracy at tax 65%', 'socdem', 10, { taxRate: 0.65 });
