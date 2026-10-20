/** Diagnostic: what drives the gini/unemployment ratchet? Job capacity vs labor supply, money per capita, property concentration. */
import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';
import { householdWealth } from '../src/sim/stats';

const presetId = process.argv[2] ?? 'liberal';
const preset = IDEOLOGY_PRESETS.find(p => p.id === presetId)!;
const sim = Simulation.create({
  sizePreset: 'town', ideologyPreset: presetId, population: 400, seed: 12345,
  policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture),
});

for (let y = 1; y <= 40; y++) {
  sim.runDays(30);
  if (y % 5 !== 0 && y !== 40) continue;
  const s = sim.state;
  const workingAge = s.agents.filter(a => a.age >= 18 && a.age < 65).length;
  const unemp = s.agents.filter(a => a.job === 'unemployed' && a.age >= 18 && a.age < 65).length;
  const jobSlots = s.buildings.filter(b => b.workers.length >= 0 && !['house', 'tenement', 'manor', 'plaza', 'monument', 'prison'].includes(b.type)).reduce((t, b) => t + b.capacity, 0);
  const filled = s.buildings.reduce((t, b) => t + b.workers.length, 0);
  const wealth = householdWealth(sim);
  const vals = [...wealth.values()].sort((a, b) => a - b);
  const top10 = vals.slice(-Math.ceil(vals.length * 0.1)).reduce((a, b) => a + b, 0) / Math.max(1, vals.reduce((a, b) => a + b, 0));
  const homes = s.buildings.filter(b => ['house', 'tenement', 'manor'].includes(b.type));
  const ownerOcc = s.households.filter(hh => hh.homeId != null && s.buildings.find(b => b.id === hh.homeId)?.ownerHouseholdId === hh.id).length;
  const moneyPc = s.market.moneySupply / Math.max(1, s.agents.length);
  const st = s.stats.at(-1)!;
  console.log(`y${String(y).padStart(2)} pop=${s.agents.length} hh=${s.households.length} workAge=${workingAge} unemp=${unemp} slots=${jobSlots} filled=${filled} bldg=${s.buildings.length} homes=${homes.length} ownerOcc=${ownerOcc} gini=${st.gini.toFixed(2)} top10%=${(top10 * 100).toFixed(0)}% moneyPc=${moneyPc.toFixed(1)} priceIdx=${s.market.priceIndex.toFixed(2)} avgWage=${s.market.avgWage.toFixed(1)} foodP=${s.market.prices.food.toFixed(2)} treasury=${Math.round(s.gov.treasury)}`);
}
