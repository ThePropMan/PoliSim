import { Simulation } from '../src/sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from '../src/sim/presets';

const p = IDEOLOGY_PRESETS[0];
const sim = Simulation.create({
  sizePreset: 'hamlet', ideologyPreset: p.id, population: 40, seed: 99,
  policy: clonePolicy(p.policy), culture: cloneCulture(p.culture),
});
const json = sim.serialize();

// v5 -> v6: strip institutional fields
const v5 = JSON.parse(json); v5.version = 5;
for (const k of ['electoralSystem', 'suffrage', 'termLimits', 'judiciary', 'pressFreedom', 'militaryPower']) delete v5.policy[k];
for (const k of ['coalition', 'parliament', 'caretaker', 'termsServed', 'martialLaw', 'scandal', 'pentUp']) delete v5.gov[k];
for (const f of v5.factions) { delete f.leaderId; delete f.treasury; delete f.seats; }
const s5 = Simulation.deserialize(JSON.stringify(v5));
s5.runDays(5);
console.log('v5→v6 ok, electoralSystem:', s5.state.policy.electoralSystem, 'suffrage:', s5.state.policy.suffrage, 'parl:', s5.state.gov.parliament.length, 'day =', s5.state.day);

// v3 -> v6: strip terrain
const v3 = JSON.parse(json); delete v3.terrain; v3.version = 3;
const s3 = Simulation.deserialize(JSON.stringify(v3));
console.log('v3→v6 ok, terrain size:', s3.state.terrain.size, 'water cells:', s3.state.terrain.water.filter(Boolean).length);

// v2 -> v6: strip terrain + v3 fields
const v2 = JSON.parse(json); delete v2.terrain; v2.version = 2;
delete v2.gov.lastRiot; delete v2.counters.crimes;
for (const f of v2.factions) { delete f.founding; delete f.lastPurge; }
const s2 = Simulation.deserialize(JSON.stringify(v2));
s2.runDays(5);
console.log('v2→v6 ok, ran 5 days, day =', s2.state.day, 'pop =', s2.state.agents.length);

// spatial index sanity
s2.runDays(1);
const plaza = s2.state.buildings.find(b => b.type === 'plaza')!;
const near = s2.agentsNear(plaza.pos, 15).length;
console.log('agentsNear(plaza,15):', near);
const heights = s2.state.terrain.height;
console.log('height range:', Math.min(...heights).toFixed(1), '..', Math.max(...heights).toFixed(1));
