import { clamp } from './rng';
import { surname } from './names';
import type { Simulation } from './simulation';
import { handleLeaderDeath } from './politics';
import { seedEpidemic, startCurrent } from './society';

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
    id: 'plague', label: 'Plague', help: 'Seed a virulent outbreak that spreads between households, friends and workplaces.',
    run: sim => {
      const pop = sim.state.agents.length;
      const n = seedEpidemic(sim, Math.max(3, Math.round(pop * 0.08)), 1.6);
      if (!n) { sim.log('The plague finds no one to infect.', 'death'); return; }
      sim.log(`DISASTER: A virulent ${sim.state.epidemic!.name} breaks out — ${n} people infected so far.`, 'death', undefined, { kind: 'plague', n });
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
    id: 'embargo', label: 'Trade Embargo', help: 'Foreign traders boycott the town: imported goods and tools dry up.',
    run: sim => {
      const s = sim.state;
      s.store.goods *= 0.35; s.store.tools *= 0.35; s.store.luxury *= 0.3;
      for (const b of s.buildings) if (b.type === 'market' || b.type === 'workshop' || b.type === 'smithy') b.stock *= 0.4;
      if (s.policy.allocation === 'market') { s.market.prices.goods *= 1.6; s.market.prices.tools *= 1.8; s.market.prices.luxury *= 2; }
      sim.log('CRISIS: Neighbouring towns declare a trade embargo. Manufactured goods become scarce.', 'economy', undefined, { kind: 'strike', n: 0 });
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
    id: 'immigrants', label: 'Immigrants', help: 'A band of newcomers (~8% of the population) arrives with a diverse spread of beliefs and subcultures.',
    run: sim => {
      const rng = sim.rng;
      const target = Math.min(30, Math.max(8, Math.round(sim.state.agents.length * 0.08)));
      let n = 0;
      while (n < target) {
        const hh = sim.addHousehold();
        const fam = surname(rng);
        const a = sim.createAgent({ age: rng.range(18, 40), sex: rng.chance(0.5) ? 'M' : 'F', householdId: hh.id, surname: fam });
        a.disposition = { econ: clamp(rng.normal(0, 0.55), -1, 1), auth: clamp(rng.normal(0, 0.55), -1, 1), trad: clamp(rng.normal(0, 0.55), -1, 1) };
        a.beliefs = { ...a.disposition };
        a.newcomerUntil = sim.state.day + 300; // counts as a newcomer for ~10 years
        hh.money = sim.state.policy.allocation === 'market' ? 25 : 0;
        hh.food = 4;
        n++;
        if (rng.chance(0.5) && n < target) {
          const b = sim.createAgent({ age: clamp(a.age + rng.normal(0, 3), 18, 60), sex: a.sex === 'M' ? 'F' : 'M', householdId: hh.id, surname: fam });
          b.disposition = { ...a.disposition };
          b.beliefs = { ...a.beliefs };
          b.newcomerUntil = a.newcomerUntil;
          a.partnerId = b.id; b.partnerId = a.id; n++;
        }
      }
      sim.log(`${n} immigrants have arrived looking for a new life.`, 'info');
    },
  },
  {
    id: 'leak', label: 'Scandal Leak', help: 'Documents exposing corruption leak — free presses erupt, censored ones whisper.',
    run: sim => {
      const s = sim.state, p = s.policy;
      s.gov.scandal = clamp(s.gov.scandal + 0.5);
      if (p.pressFreedom > 0.45) {
        s.gov.legitimacy = clamp(s.gov.legitimacy - 0.07);
        sim.log('SCANDAL: Leaked ledgers expose corruption at the top. The press runs wild.', 'politics', undefined, { kind: 'purge', n: 0 });
      } else {
        s.gov.pentUp = clamp(s.gov.pentUp + 0.12);
        sim.log('RUMOUR: Samizdat pamphlets describing elite corruption circulate quietly.', 'politics');
      }
    },
  },
  {
    id: 'assassin', label: 'Assassination', help: 'An assassin strikes at the leader. The attempt may succeed — or backfire.',
    run: sim => {
      const s = sim.state;
      const leader = s.gov.leaderId != null ? sim.agent(s.gov.leaderId) : undefined;
      if (!leader) { sim.log('There is no leader to target.', 'politics'); return; }
      if (sim.rng.chance(0.45)) {
        sim.log(`ASSASSINATION: ${leader.name} has been killed!`, 'politics', leader.id, { kind: 'coup' });
        handleLeaderDeath(sim, leader);
      } else {
        s.gov.legitimacy = clamp(s.gov.legitimacy + 0.05);
        s.gov.pentUp = clamp(s.gov.pentUp + (s.policy.civilLiberty < 0.4 ? 0.1 : 0.03));
        sim.log(`An assassin's blade narrowly misses ${leader.name}. Sympathy rallies behind the leader.`, 'politics', leader.id, { kind: 'crackdown', n: 0 });
      }
    },
  },
  {
    id: 'tract', label: 'Radical Manifesto', help: 'A fiery collectivist pamphlet circulates — public opinion lurches left.',
    run: sim => { startCurrent(sim, 'hoarding', 1.4); startCurrent(sim, 'strike_wave', 1.3); sim.log('A radical manifesto circulates through the workshops — the mood turns sharply against property.', 'politics'); },
  },
  {
    id: 'revival', label: 'Great Revival', help: 'A charismatic preacher sweeps the town — a tide of piety and tradition.',
    run: sim => { startCurrent(sim, 'preacher', 1.4); sim.log('A great revival sweeps the town — sermons pack the square and old certainties harden.', 'culture'); },
  },
  {
    id: 'panic', label: 'Order Panic', help: 'A crime scare has the town demanding a strong hand — opinion swings authoritarian.',
    run: sim => { startCurrent(sim, 'raiders', 1.5); startCurrent(sim, 'plot', 1.2); sim.log('A wave of outrage over lawlessness has the town demanding order at any price.', 'politics'); },
  },
  {
    id: 'awakening', label: 'Enlightenment Wave', help: 'New ideas from abroad challenge old certainties — opinion swings progressive and libertarian.',
    run: sim => { startCurrent(sim, 'new_ideas', 1.5); startCurrent(sim, 'pamphlet', 1.2); sim.log('A flood of new books and bold ideas arrives — the young question everything.', 'culture'); },
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
