import type { Simulation } from './simulation';
import type { Activity, Agent, Building, Vec2 } from './types';

const SPEED = 9.5;

export function hash2(a: number, b: number): number {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function spotIn(b: Building, id: number, outside = false): Vec2 {
  const u = hash2(id, b.id) - 0.5, v = hash2(b.id, id * 7 + 3) - 0.5;
  if (outside) {
    const ang = (u + 0.5) * Math.PI * 2;
    const r = Math.max(b.size.w, b.size.d) * 0.5 + 0.8 + (v + 0.5) * 1.2;
    return { x: b.pos.x + Math.cos(ang) * r, z: b.pos.z + Math.sin(ang) * r };
  }
  return { x: b.pos.x + u * b.size.w * 0.85, z: b.pos.z + v * b.size.d * 0.85 };
}

const OPEN_TYPES = new Set(['farm', 'lumber_camp', 'mine', 'plaza', 'market', 'yard', 'monument']);

export function isWorkingJob(job: Agent['job']) {
  return job !== 'child' && job !== 'student' && job !== 'retired' && job !== 'unemployed';
}

export function updateAgentHour(sim: Simulation, a: Agent) {
  const s = sim.state;
  const h = s.hour;
  const hh = sim.household(a.householdId);
  const home = sim.building(hh?.homeId);
  const plaza = sim.buildingsOf('plaza')[0];
  const faction = sim.faction(a.factionId);
  const sleepStart = 22 + (a.id % 2), wake = 6 + (a.id % 2);
  let act: Activity = 'leisure';
  let b: Building | undefined;

  if (a.jailedUntil > s.day) {
    act = 'jailed';
    b = sim.buildingsOf('prison')[0] ?? sim.buildingsOf('guardhouse')[0] ?? plaza;
  } else if (h >= sleepStart || h < wake) {
    act = 'sleep';
    b = home ?? plaza;
  } else if (
    faction && a.age >= 16 && a.commitment > 0.25 &&
    ((faction.protestToday && h >= 16 && h <= 20) || (faction.strikeToday && h >= 8 && h <= 20))
  ) {
    act = faction.strikeToday && h < 16 ? 'strike' : 'protest';
    b = plaza;
  } else if (a.job === 'child') {
    const school = sim.buildingsOf('school')[0];
    if (a.age < 6) { act = 'home'; b = home ?? plaza; }
    else if (h >= 8 && h < 14 && school && school.workers.length > 0) { act = 'school'; b = school; }
  } else if (a.job === 'student') {
    const uni = sim.buildingsOf('university')[0] ?? sim.buildingsOf('school')[0];
    if (h >= 9 && h < 16 && uni) { act = 'school'; b = uni; }
  } else if (isWorkingJob(a.job) && h >= 8 && h < 17 && a.workplaceId != null) {
    act = 'work';
    b = sim.building(a.workplaceId);
  } else if (
    s.policy.allocation === 'planned' &&
    s.plan.queueHours > 0.5 &&
    h >= 17 && h < 17 + Math.ceil(s.plan.queueHours) &&
    hash2(a.id, s.day + h) < 0.45
  ) {
    // Ration queues in planned economies with shortages
    act = 'queue';
    b = sim.buildingsOf('warehouse')[0] ?? sim.buildingsOf('market')[0] ?? plaza;
  }

  if (act === 'leisure' || !b) {
    const roll = hash2(a.id, s.day * 3 + Math.floor(h / 3));
    const introvert = 1 - a.personality.E;
    // Foul weather keeps people indoors — storms and snow empty the streets
    const foul = s.weather.kind === 'storm' || s.weather.kind === 'snow' || s.weather.kind === 'rain';
    if (foul && roll < (s.weather.kind === 'storm' ? 0.75 : 0.45) && act !== 'protest' && act !== 'strike') {
      a.activity = act === 'leisure' || !b ? 'home' : act;
      a.target = home ? { x: home.pos.x, z: home.pos.z } : { x: plaza?.pos.x ?? 0, z: plaza?.pos.z ?? 0 };
      if (home) a.targetBuildingId = home.id;
      return;
    }
    const temples = sim.buildingsOf('temple');
    const theaters = sim.buildingsOf('theater');
    const taverns = sim.buildingsOf('tavern');
    const markets = sim.buildingsOf('market');

    if (s.culture.festivalDaysLeft > 0 && h >= 15 && h <= 21) {
      act = 'culture';
      b = plaza;
    } else if (temples.length > 0 && a.religiosity > 0.55 && (s.day % 7 === 0 || roll < 0.14 * a.religiosity) && h >= 17 && h <= 20) {
      act = 'worship';
      b = temples[a.id % temples.length];
    } else if (theaters.length > 0 && (a.personality.O > 0.55 || a.subculture === 'bohemian') && roll < 0.18 && h >= 18 && h <= 21) {
      act = 'culture';
      b = theaters[a.id % theaters.length];
    } else if (taverns.length > 0 && a.age >= 18 && roll > 0.72 && h >= 18 && h <= 22) {
      act = 'leisure';
      b = taverns[a.id % taverns.length];
    } else if ((a.needs.food < 0.5 || roll < 0.14) && markets.length) {
      act = 'leisure';
      b = markets[0];
    } else if (roll < 0.22 + 0.25 * a.personality.E) {
      act = 'leisure';
      b = plaza;
    } else if (roll < 0.65 && a.friends.length) {
      const f = sim.agent(a.friends[Math.floor(hash2(a.id + 11, s.day) * a.friends.length)]);
      b = sim.building(sim.household(f?.householdId)?.homeId) ?? plaza;
    } else {
      b = introvert > 0.45 ? home ?? plaza : plaza;
    }
    if (a.age < 6) b = home ?? plaza;
  }

  a.activity = act;
  if (b && a.targetBuildingId !== b.id) {
    a.targetBuildingId = b.id;
    const outside = !OPEN_TYPES.has(b.type) && (act === 'leisure' || act === 'worship' || act === 'culture' || act === 'queue' || act === 'protest' || act === 'strike' || act === 'jailed' || act === 'work');
    a.target = act === 'protest' || act === 'strike' ? tightSpot(b, a.id) : act === 'queue' ? queueSpot(b, a.id) : spotIn(b, a.id, outside);
  }
}

function tightSpot(b: Building, id: number): Vec2 {
  const u = hash2(id, 99) - 0.5, v = hash2(99, id) - 0.5;
  return { x: b.pos.x + u * 7, z: b.pos.z + v * 7 };
}

function queueSpot(b: Building, id: number): Vec2 {
  const idx = id % 18;
  return { x: b.pos.x - b.size.w * 0.4 + (idx % 9) * 0.9, z: b.pos.z + b.size.d * 0.65 + Math.floor(idx / 9) * 0.9 };
}

/** Bad weather slows travel — mud, snowdrifts, and storms cut walking speed. */
const WEATHER_SPEED: Record<string, number> = {
  clear: 1, cloudy: 0.95, rain: 0.72, storm: 0.42, drought: 0.92, snow: 0.55,
};

export function moveAgent(sim: Simulation, a: Agent) {
  const dx = a.target.x - a.pos.x, dz = a.target.z - a.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  const step = Math.min(d, SPEED * (WEATHER_SPEED[sim.state.weather.kind] ?? 1));
  a.pos.x += (dx / d) * step;
  a.pos.z += (dz / d) * step;
}
