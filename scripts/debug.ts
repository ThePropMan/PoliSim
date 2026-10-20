import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

const preset = IDEOLOGY_PRESETS.find(p => p.id === (process.argv[2] ?? 'liberal'))!;
const sim = Simulation.create({ sizePreset: 'town', ideologyPreset: preset.id, population: 400, seed: 12345, policy: clonePolicy(preset.policy), culture: cloneCulture(preset.culture) });
const causes = new Map<string, number>();
const orig = sim.killAgent.bind(sim);
sim.killAgent = (a, c) => { causes.set(c, (causes.get(c) ?? 0) + 1); orig(a, c); };
for (let m = 1; m <= 24; m++) {
  sim.runDays(15);
  const s = sim.state;
  const jobs = new Map<string, number>();
  for (const a of s.agents) jobs.set(a.job, (jobs.get(a.job) ?? 0) + 1);
  const money = s.households.map(h => h.money).sort((a, b) => a - b);
  const firmCash = s.buildings.filter(b => b.type === 'farm' || b.type === 'workshop').reduce((t, b) => t + b.cash, 0);
  const totalMoney = money.reduce((a, b) => a + b, 0) + firmCash + s.gov.treasury;
  const homeless = s.households.filter(h => h.homeId == null).length;
  console.log(`d${s.day} pop=${s.agents.length} hh=${s.households.length} homeless=${homeless} fp=${s.market.foodPrice.toFixed(2)} gp=${s.market.goodsPrice.toFixed(2)} wage=${s.market.avgWage.toFixed(2)} fD=${s.market.foodDemand.toFixed(0)} fS=${s.market.foodSupply.toFixed(0)} gD=${s.market.goodsDemand.toFixed(0)} gS=${s.market.goodsSupply.toFixed(0)}`);
  console.log(`   money median=${money[money.length >> 1]?.toFixed(0)} top=${money.at(-1)?.toFixed(0)} total=${totalMoney.toFixed(0)} firms=${firmCash.toFixed(0)} treas=${s.gov.treasury.toFixed(0)} jobs=${[...jobs].map(([k, v]) => k + ':' + v).join(' ')}`);
  console.log(`   deaths=${[...causes].map(([k, v]) => k + ':' + v).join(' ')} hungry=${s.agents.filter(a => a.hungerDays > 3).length}`);
}
