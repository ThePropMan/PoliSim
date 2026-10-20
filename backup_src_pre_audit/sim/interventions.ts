import { clamp } from './rng';
import { surname } from './names';
import type { Simulation } from './simulation';
import { handleLeaderDeath } from './politics';

export const INTERVENTIONS: { id: string; label: string; help: string; run: (sim: Simulation) => void }[] = [
  {
    id: 'famine', label: 'Famine', help: 'Crops fail for the rest of the year and stored food rots.',
    run: sim => {
      const s = sim.state;
      s.harvest = 0.28;
      s.store.food *= 0.2;
      for (const hh of s.households) hh.food *= 0.25;
      for (const b of s.buildings) if (b.type === 'farm' || b.type === 'mill' || b.type === 'bakery') b.stock *= 0.2;
      sim.log('DISASTER: Blight destroys the harvest. Famine looms.', 'economy', undefined, { kind: 'famine' });
    },
  },
  {
    id: 'drought', label: 'Drought', help: 'Weeks without rain: farm yields collapse until it breaks.',
    run: sim => {
      sim.state.weather = { kind: 'drought', daysLeft: sim.rng.int(15, 25) };
      sim.log('DISASTER: A drought has settled over the region. Crops wither.', 'economy', undefined, { kind: 'drought' });
    },
  },
  {
    id: 'storm', label: 'Storm', help: 'A violent storm damages buildings and keeps people indoors.',
    run: sim => {
      sim.state.weather = { kind: 'storm', daysLeft: sim.rng.int(2, 4) };
      sim.log('DISASTER: A violent storm strikes the town!', 'info', undefined, { kind: 'storm' });
    },
  },
  {
    id: 'plague', label: 'Plague', help: 'A disease sweeps through the population.',
    run: sim => {
      let sick = 0;
      for (const a of sim.state.agents) if (sim.rng.chance(0.45)) { a.needs.health = clamp(a.needs.health - 0.55); sick++; }
      sim.log(`DISASTER: Plague! ${sick} people fall ill.`, 'death', undefined, { kind: 'plague', n: sick });
    },
  },
  {
    id: 'credit_crunch', label: 'Financial Panic', help: 'Credit freezes, firm cash drops, and household debt spikes.',
    run: sim => {
      const s = sim.state;
      for (const b of s.buildings) b.cash *= 0.35;
      for (const hh of s.households) if (hh.money < 60) hh.debt += 45;
      sim.log('CRISIS: A banking panic freezes credit across town!', 'economy');
    },
  },
  {
    id: 'windfall', label: 'Mineral Boom', help: 'A rich mineral find: money and raw materials surge.',
    run: sim => {
      const s = sim.state;
      s.store.raw += s.agents.length * 4;
      if (s.policy.allocation === 'market') for (const hh of s.households) hh.money += 55;
      else { s.store.food += s.agents.length * 4; s.store.goods += s.agents.length * 3; }
      sim.log('BOOM: A rich mineral vein is struck! Raw materials and wealth flow into town.', 'economy');
    },
  },
  {
    id: 'festival', label: 'Grand Festival', help: 'Hold a 5-day cultural celebration that boosts happiness and social cohesion.',
    run: sim => {
      const s = sim.state;
      s.culture.festivalDaysLeft = 5;
      s.culture.cohesion = clamp(s.culture.cohesion + 0.12);
      for (const a of s.agents) { a.happiness = clamp(a.happiness + 0.1); a.grievance = Math.max(0, a.grievance - 0.06); }
      sim.log('CELEBRATION: A Grand Civic Festival fills the plaza with music and theatre.', 'culture', undefined, { kind: 'festival' });
    },
  },
  {
    id: 'immigrants', label: 'Immigrants', help: '20 newcomers arrive with a diverse spread of beliefs and subcultures.',
    run: sim => {
      const rng = sim.rng;
      let n = 0;
      while (n < 20) {
        const hh = sim.addHousehold();
        const fam = surname(rng);
        const a = sim.createAgent({ age: rng.range(18, 40), sex: rng.chance(0.5) ? 'M' : 'F', householdId: hh.id, surname: fam });
        a.disposition = { econ: clamp(rng.normal(0, 0.55), -1, 1), auth: clamp(rng.normal(0, 0.55), -1, 1), trad: clamp(rng.normal(0, 0.55), -1, 1) };
        a.beliefs = { ...a.disposition };
        a.newcomerUntil = sim.state.day + 300; // counts as a newcomer for ~10 years
        hh.money = sim.state.policy.allocation === 'market' ? 25 : 0;
        hh.food = 4;
        n++;
        if (rng.chance(0.5) && n < 20) {
          const b = sim.createAgent({ age: clamp(a.age + rng.normal(0, 3), 18, 60), sex: a.sex === 'M' ? 'F' : 'M', householdId: hh.id, surname: fam });
          b.disposition = { ...a.disposition };
          b.beliefs = { ...a.beliefs };
          b.newcomerUntil = a.newcomerUntil;
          a.partnerId = b.id; b.partnerId = a.id; n++;
        }
      }
      sim.log('20 immigrants have arrived looking for a new life.', 'info');
    },
  },
  {
    id: 'resign', label: 'Leader Resigns', help: 'The current leader steps down; succession follows the rules of the regime.',
    run: sim => {
      const leader = sim.agent(sim.state.gov.leaderId);
      if (!leader) { sim.log('There is no leader to resign.', 'politics'); return; }
      sim.log(`${leader.name} has stepped down.`, 'politics', leader.id);
      handleLeaderDeath(sim, leader);
      if (sim.state.gov.leaderId === leader.id) sim.state.gov.leaderId = null;
    },
  },
  {
    id: 'election', label: 'Snap Election', help: 'Call an election immediately (democracy only).',
    run: sim => {
      if (sim.state.policy.governance !== 'democracy') { sim.log('Elections only happen in a democracy.', 'politics'); return; }
      sim.state.gov.lastElection = -9999;
      sim.log('A snap election has been called for tomorrow.', 'politics');
    },
  },
];
