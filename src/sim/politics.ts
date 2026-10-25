import { clamp, lerp } from './rng';
import { DAYS_PER_YEAR, type Simulation } from './simulation';
import { factionColor, factionName } from './names';
import { perceivedPosition, policyFromBeliefs, reformPolicy, regimeName } from './presets';
import { beliefDistance } from './society';
import { householdWealth } from './stats';
import { BUILDING_PRODUCTION } from './economy';
import { weatherProtestFactor } from './environment';
import type { Agent, Beliefs, Faction, Policy } from './types';

const NUMERIC: (keyof Policy)[] = [
  'taxRate', 'welfare', 'publicServices', 'enforcement', 'civilLiberty',
  'wageFloor', 'inheritance', 'corruption', 'planningEfficiency', 'birthSupport',
  'interestRate', 'moneyPrinting', 'culturalSubsidy', 'religiousFreedom',
];

export function lerpPolicy(from: Policy, to: Policy, t: number): Policy {
  const out = { ...from };
  for (const k of NUMERIC) (out[k] as number) = lerp(from[k] as number, to[k] as number, t);
  return out;
}

function newFaction(sim: Simulation, founder: Agent, platform: Beliefs, name?: string): Faction {
  const s = sim.state;
  const id = sim.nextId();
  let nm = name ?? factionName(sim.rng, platform.econ, platform.auth, platform.trad);
  // Party names must be unique — regenerate a few times, then append a roman numeral
  for (let i = 0; i < 6 && s.factions.some(f => f.name === nm); i++) nm = name ?? factionName(sim.rng, platform.econ, platform.auth, platform.trad);
  if (s.factions.some(f => f.name === nm)) {
    const romans = ['II', 'III', 'IV', 'V'];
    for (const r of romans) { if (!s.factions.some(f => f.name === `${nm} ${r}`)) { nm = `${nm} ${r}`; break; } }
  }
  const f: Faction = {
    id, name: nm, color: factionColor(s.factions.length + id),
    platform: { ...platform }, founding: { ...platform }, founderId: founder.id, leaderId: founder.id, foundedDay: s.day, lastPurge: -999,
    underground: s.policy.civilLiberty < 0.4 && s.gov.rulingFactionId != null,
    members: 1, strength: 0.5, anger: founder.grievance, protestDays: 0,
    strikeToday: false, protestToday: false, lastAction: s.day,
    treasury: 0, seats: 0,
  };
  s.factions.push(f);
  founder.factionId = id;
  founder.commitment = 0.8;
  return f;
}

export function createEstablishment(sim: Simulation) {
  const s = sim.state, p = s.policy;
  if (p.governance === 'none' || p.governance === 'council') { s.gov.rulingFactionId = null; s.gov.leaderId = null; return; }
  const adults = sim.adults();
  const leader = adults.reduce((best, a) => {
    const score = -beliefDistance(a.beliefs, s.gov.position) + a.personality.E * 0.3 + a.personality.C * 0.3 + (a.age > 30 ? 0.3 : 0);
    return !best || score > best.score ? { a, score } : best;
  }, null as { a: Agent; score: number } | null)?.a;
  if (!leader) return;
  const name = p.governance === 'monarchy'
    ? `House of ${leader.name.split(' ')[1]}`
    : p.governance === 'autocracy'
      ? factionName(sim.rng, s.gov.position.econ, 0.8, s.gov.position.trad)
      : factionName(sim.rng, s.gov.position.econ, 0, s.gov.position.trad);
  const f = newFaction(sim, leader, s.gov.position, name);
  f.underground = false;
  for (const a of adults) {
    if (a !== leader && beliefDistance(a.beliefs, s.gov.position) < 0.5 && sim.rng.chance(0.5)) { a.factionId = f.id; a.commitment = 0.5; }
  }
  if (p.governance === 'monarchy') for (const id of [leader.partnerId, ...leader.children]) { const r = sim.agent(id); if (r) { r.factionId = f.id; r.commitment = 0.9; } }
  s.gov.rulingFactionId = f.id;
  s.gov.leaderId = leader.id;
  sim.remember(leader, p.governance === 'monarchy' ? 'Crowned monarch.' : 'Became leader.');
}

export function handleLeaderDeath(sim: Simulation, dead: Agent) {
  const s = sim.state;
  const ruling = sim.faction(s.gov.rulingFactionId);
  let heir: Agent | undefined;
  if (s.policy.governance === 'monarchy') heir = dead.children.map(id => sim.agent(id)).filter((c): c is Agent => !!c && c.age >= 16).sort((a, b) => b.age - a.age)[0];
  if (!heir && ruling) heir = s.agents.filter(a => a.factionId === ruling.id && a.age >= 18 && a.id !== dead.id).sort((a, b) => b.commitment + b.personality.E * 0.2 - a.commitment - a.personality.E * 0.2)[0];
  s.gov.leaderId = heir?.id ?? null;
  if (heir) {
    sim.log(s.policy.governance === 'monarchy' ? `${dead.name} has died. ${heir.name} is crowned.` : `Leader ${dead.name} has died. ${heir.name} takes power.`, 'politics', heir.id,
      s.policy.governance === 'monarchy' ? { kind: 'coronation', color: ruling?.color } : undefined);
    sim.remember(heir, 'Took over leadership.');
    if (s.policy.governance === 'monarchy') s.gov.termsServed = 0;
  } else {
    sim.log(`Leader ${dead.name} has died with no successor.`, 'politics');
    // Succession crisis: rival factions scent opportunity; legitimacy wobbles
    if (s.policy.governance === 'monarchy' || s.policy.governance === 'autocracy') {
      s.gov.legitimacy = clamp(s.gov.legitimacy - 0.15);
      s.gov.pentUp = clamp(s.gov.pentUp + 0.15);
      sim.log(`The succession is disputed — factions manoeuvre for the throne.`, 'unrest');
    }
  }
}

function meanBeliefs(agents: Agent[]): Beliefs {
  const n = Math.max(1, agents.length);
  return {
    econ: agents.reduce((t, a) => t + a.beliefs.econ, 0) / n,
    auth: agents.reduce((t, a) => t + a.beliefs.auth, 0) / n,
    trad: agents.reduce((t, a) => t + a.beliefs.trad, 0) / n,
  };
}

export function runPoliticsDay(sim: Simulation) {
  const s = sim.state;
  for (const f of s.factions) { f.protestToday = false; f.strikeToday = false; }
  updateMembership(sim);
  foundFactions(sim);
  updateFactions(sim);
  partyPolitics(sim);
  checkSplinters(sim);
  checkMergers(sim);
  rulingDynamics(sim);
  securityApparatus(sim);
  autocraticCourse(sim);
  const g = s.policy.governance;
  // Elections are suspended while martial law is in force
  if (g === 'democracy' && s.gov.martialLaw <= 0 && s.day - s.gov.lastElection >= s.policy.electionYears * DAYS_PER_YEAR) holdElection(sim);
  if (g === 'council' && s.day % 10 === 0) councilDecides(sim);
  if (g === 'none') statelessDynamics(sim);
  pressAndDissent(sim);
  martialLawCheck(sim);
  militaryCoupCheck(sim);
  unrest(sim);
  breadRiots(sim);
  eliteCapture(sim);
  if (s.gov.martialLaw > 0) s.gov.martialLaw--;
  const ruling = sim.faction(s.gov.rulingFactionId);
  const leader = sim.agent(s.gov.leaderId);
  const polPos = perceivedPosition(s.policy, s.gov.baseline);
  // The state's ideological position follows enacted policy AND the ruling party's actual
  // platform, with the leader's personal convictions stamped on top — so when the base
  // (or the leader) drifts, the government visibly drifts with it.
  if (ruling) {
    const wl = leader ? 0.22 : 0;
    const wp = 0.42;
    const wPol = 1 - wp - wl;
    s.gov.position = {
      econ: polPos.econ * wPol + ruling.platform.econ * wp + (leader?.beliefs.econ ?? 0) * wl,
      auth: polPos.auth * wPol + ruling.platform.auth * wp + (leader?.beliefs.auth ?? 0) * wl,
      trad: polPos.trad * wPol + ruling.platform.trad * wp + (leader?.beliefs.trad ?? 0) * wl,
    };
  } else {
    s.gov.position = polPos;
  }
  s.gov.regimeName = regimeName(s.policy);
  if (s.gov.leaderId != null && !sim.agent(s.gov.leaderId)) s.gov.leaderId = null;
  if (s.gov.leaderId == null && ruling) {
    const heir = s.agents.filter(a => a.factionId === ruling.id && a.age >= 18).sort((a, b) => b.commitment - a.commitment)[0];
    if (heir) { s.gov.leaderId = heir.id; sim.log(`${heir.name} now leads the ${ruling.name}.`, 'politics', heir.id); }
  }
}

/** How strongly held someone's politics are: distance from the centre on their most extreme axis. */
const intensity = (a: Agent) => clamp(Math.max(Math.abs(a.beliefs.econ), Math.abs(a.beliefs.auth), Math.abs(a.beliefs.trad) * 0.8));

function updateMembership(sim: Simulation) {
  const s = sim.state, rng = sim.rng, p = s.policy;
  const ruling = s.gov.rulingFactionId;
  for (const a of s.agents) {
    if (a.age < 18) continue;
    const f = sim.faction(a.factionId);
    if (f) {
      const d = beliefDistance(a.beliefs, f.platform);
      const isRuling = f.id === ruling;
      // Moderates drift out of parties that no longer fit; true believers stay
      const careerist = isRuling && (p.governance === 'autocracy' || p.governance === 'monarchy');
      // (lapsing is common: real parties churn members; only the intense stay for decades)
      if (d > (careerist ? 1.05 : 0.85) || rng.chance(0.005 * (1.4 - intensity(a))) || (f.underground && a.fear > 0.6 && rng.chance(0.05)) || (isRuling && a.approval < 0.3 && rng.chance(0.05))) {
        a.factionId = null; a.commitment = 0;
        continue;
      }
      // Ideological intensity is the strongest predictor of activism (the curvilinear disparity law)
      a.commitment = clamp(0.15 + a.personality.E * 0.15 + intensity(a) * 0.45 + (isRuling ? a.approval * 0.3 : a.grievance * 0.45) - a.fear * 0.4 - d * 0.25);
    } else {
      let best: Faction | undefined, bd = 0.5 + a.grievance * 0.3;
      for (const x of s.factions) { const d = beliefDistance(a.beliefs, x.platform); if (d < bd) { bd = d; best = x; } }
      if (!best) continue;
      const isRuling = best.id === ruling;
      const motive = isRuling ? a.approval - 0.38 : (1 - a.approval) * 0.6 + a.grievance;
      // Most contented moderates vote but never join; strong convictions — or strong grievances — make people organise
      const drive = isRuling ? intensity(a) : Math.max(intensity(a), a.grievance);
      let chance = 0.006 * (0.5 + a.personality.E) * (0.25 + drive * 1.6) * clamp(motive + intensity(a) * 0.4) * (isRuling ? 1 : 1 + a.grievance * 1.8);
      if (best.underground) chance *= (0.3 + 0.7 * p.civilLiberty) * (1 - a.fear);
      if (rng.chance(chance)) { a.factionId = best.id; a.commitment = 0.4; sim.remember(a, `Joined the ${best.name}.`); }
    }
  }
}

function foundFactions(sim: Simulation) {
  const s = sim.state, rng = sim.rng, p = s.policy;
  if (s.factions.length >= 14) return;
  for (const a of s.agents) {
    if (a.age < 18 || a.factionId != null || a.jailedUntil > s.day) continue;
    // Founders are disproportionately people with intense convictions
    if (!rng.chance(0.0022 * (a.personality.E + a.personality.O) * (0.4 + intensity(a) * 1.5))) continue;
    const dist = beliefDistance(a.beliefs, s.gov.position);
    const engaged = a.grievance > 0.28 || (p.governance === 'democracy' && (dist > 0.55 || intensity(a) > 0.6)) || (dist > 0.75 && a.grievance > 0.14);
    if (!engaged) continue;
    // Past the soft cap of 10, only genuinely uncovered ideological ground earns a
    // slot — otherwise a crowded field of near-clones freezes out new positions
    const nearestPlatform = Math.min(...s.factions.map(f => beliefDistance(f.platform, a.beliefs)), Infinity);
    if (nearestPlatform < 0.45) continue;
    if (s.factions.length >= 10 && nearestPlatform < 0.65) continue;
    if (s.gov.rulingFactionId != null && rng.chance((1 - p.civilLiberty) * p.enforcement * 0.68)) {
      a.jailedUntil = s.day + 18;
      a.grievance = clamp(a.grievance + 0.22);
      sim.remember(a, 'Arrested for trying to organise a political group.');
      sim.log(`${a.name} was arrested for political organising.`, 'unrest', a.id);
      continue;
    }
    const f = newFaction(sim, a, a.beliefs);
    sim.remember(a, `Founded the ${f.name}.`);
    sim.log(`${a.name} founded the ${f.name}${f.underground ? ' (underground)' : ''}: ${describePlatform(f.platform)}.`, 'politics', a.id);
    if (s.factions.length >= 14) return;
  }
}

export function describePlatform(b: Beliefs): string {
  const e = b.econ < -0.5 ? 'communist' : b.econ < -0.15 ? 'socialist' : b.econ > 0.5 ? 'free-market' : b.econ > 0.15 ? 'pro-business' : 'centrist';
  const a = b.auth > 0.5 ? 'authoritarian' : b.auth > 0.15 ? 'law-and-order' : b.auth < -0.5 ? 'anarchist' : b.auth < -0.15 ? 'libertarian' : 'moderate';
  const t = b.trad > 0.4 ? ', traditionalist' : b.trad < -0.4 ? ', progressive' : '';
  return `${a} ${e}${t}`;
}

function updateFactions(sim: Simulation) {
  const s = sim.state;
  const adults = sim.adults();
  const medianOf = (k: 'econ' | 'auth' | 'trad') => {
    const v = adults.map(a => a.beliefs[k]).sort((x, y) => x - y);
    return v[v.length >> 1] ?? 0;
  };
  const median = { econ: medianOf('econ'), auth: medianOf('auth'), trad: medianOf('trad') };
  // The party line is written by its activists: weight each member by commitment², so the
  // committed (and typically more radical) core outweighs passive card-holders
  const tally = new Map<number, { n: number; str: number; anger: number; w: number; e: number; a: number; t: number }>();
  for (const a of s.agents) {
    if (a.factionId == null) continue;
    const x = tally.get(a.factionId) ?? { n: 0, str: 0, anger: 0, w: 0, e: 0, a: 0, t: 0 };
    const wt = 0.05 + a.commitment * a.commitment;
    x.n++; x.str += a.commitment; x.anger += a.grievance; x.w += wt;
    x.e += a.beliefs.econ * wt; x.a += a.beliefs.auth * wt; x.t += a.beliefs.trad * wt;
    tally.set(a.factionId, x);
  }
  for (const f of [...s.factions]) {
    const x = tally.get(f.id);
    f.members = x?.n ?? 0;
    f.strength = x?.str ?? 0;
    f.anger = x && x.n ? x.anger / x.n : 0;
    if (x && x.n) {
      // A ruling party under autocracy has doctrine and discipline: its line follows the rank and
      // file only glacially and is pulled back toward the founding ideology. Ordinary parties chase
      // their members.
      const doctrinal = f.id === s.gov.rulingFactionId && (s.policy.governance === 'autocracy' || s.policy.governance === 'monarchy');
      const r = doctrinal ? 0.004 : 0.02;
      f.platform.econ = lerp(f.platform.econ, x.e / x.w, r);
      f.platform.auth = lerp(f.platform.auth, x.a / x.w, r);
      f.platform.trad = lerp(f.platform.trad, x.t / x.w, r);
      // Every party has a founding identity it is slow to abandon (stronger under autocracy)
      const anchor = doctrinal ? 0.003 : 0.0015;
      f.platform.econ = lerp(f.platform.econ, f.founding.econ, anchor);
      f.platform.auth = lerp(f.platform.auth, f.founding.auth, anchor);
      f.platform.trad = lerp(f.platform.trad, f.founding.trad, anchor);
      // Electoral triangulation (Downs): opposition parties that can realistically win
      // moderate toward the median voter — enough to make contests real, not enough to
      // erase identity. Radical-founded parties resist; governing parties must own their
      // record, so they only ever chase their members.
      if (s.policy.governance === 'democracy' && !s.gov.coalition.includes(f.id)) {
        const share = x.n / Math.max(1, adults.length);
        const electable = f.seats > 2 || share > 0.06;
        const zeal = 1 - Math.min(0.55, Math.abs(f.founding.econ) * 0.4 + Math.abs(f.founding.auth) * 0.2);
        const pull = electable ? Math.min(0.35, share * 2.5) * zeal * 0.04 : 0;
        if (pull > 0) {
          f.platform.econ = lerp(f.platform.econ, median.econ, pull);
          f.platform.auth = lerp(f.platform.auth, median.auth, pull);
          f.platform.trad = lerp(f.platform.trad, median.trad, pull);
        }
      }
    }
    // New groups get a season to recruit before they fold
    if (f.id !== s.gov.rulingFactionId && f.members < 2 && s.day - f.foundedDay > 60) {
      s.factions.splice(s.factions.indexOf(f), 1);
      s.gov.treasury += f.treasury; // leftover party funds escheat rather than vanish
      for (const a of s.agents) if (a.factionId === f.id) a.factionId = null;
      sim.log(`The ${f.name} dissolved.`, 'politics');
    }
    f.underground = f.id !== s.gov.rulingFactionId && s.policy.civilLiberty < 0.4 && s.gov.rulingFactionId != null;
  }
}

// ---------------------------------------------------------------- governance

/** Who can vote? Suffrage < 1 excludes the poorest fraction of adults first (property franchise). */
function enfranchised(sim: Simulation, adults: Agent[]): Agent[] {
  const s = sim.state;
  if (s.policy.suffrage >= 0.99) return adults;
  const wealth = householdWealth(sim);
  const scored = adults.map(a => ({ a, w: wealth.get(a.householdId) ?? 0 }));
  scored.sort((x, y) => y.w - x.w);
  const n = Math.max(1, Math.floor(scored.length * s.policy.suffrage));
  return scored.slice(0, n).map(x => x.a);
}

const PARLIAMENT_SEATS = 40;

function allocateSeats(sim: Simulation, votes: Map<number, number>, turnout: number) {
  const s = sim.state;
  const total = Math.max(1, turnout);
  // Winner's bonus: FPTP magnifies the plurality into a seat majority (manufactured
  // majorities); runoff mildly; PR is strictly proportional.
  const gamma = s.policy.electoralSystem === 'fptp' ? 1.55 : s.policy.electoralSystem === 'runoff' ? 1.15 : 1;
  const quotas = [...votes.entries()].map(([factionId, v]) => ({ factionId, v, share: Math.pow(v / total, gamma), exact: 0 }));
  const shareSum = quotas.reduce((t, q) => t + q.share, 0);
  for (const q of quotas) q.exact = (q.share / shareSum) * PARLIAMENT_SEATS;
  const seats = quotas.map(q => Math.floor(q.exact));
  let remain = PARLIAMENT_SEATS - seats.reduce((t, x) => t + x, 0);
  const byRem = quotas
    .map((q, i) => ({ i, rem: q.exact - Math.floor(q.exact) }))
    .sort((a, b) => b.rem - a.rem || quotas[b.i].v - quotas[a.i].v);
  for (let k = 0; remain > 0 && k < byRem.length; k++, remain--) seats[byRem[k].i]++;
  s.gov.parliament = quotas
    .map((q, i) => ({ factionId: q.factionId, seats: seats[i] }))
    .filter(x => x.seats > 0)
    .sort((a, b) => b.seats - a.seats);
  for (const f of s.factions) f.seats = s.gov.parliament.find(x => x.factionId === f.id)?.seats ?? 0;
}

/**
 * Coalition formation (PR): the seat leader invites ideologically-nearest parties until it
 * controls a majority of parliament. If no majority bloc can be assembled, a caretaker
 * government rules — policy frozen, legitimacy decays — until the next election.
 */
function formCoalition(sim: Simulation): { coalition: Faction[]; caretaker: boolean } {
  const s = sim.state;
  const parl = s.gov.parliament;
  const entries = parl
    .map(x => ({ f: sim.faction(x.factionId)!, seats: x.seats }))
    .filter(x => x.f);
  if (!entries.length) return { coalition: [], caretaker: true };
  if (entries[0].seats > PARLIAMENT_SEATS / 2) return { coalition: [entries[0].f], caretaker: false };
  // The pivotal party — the one holding the median seat on the economic axis —
  // gets the first mandate to form a government; near-pivot parties follow if it
  // can't assemble a majority. A fragmented but compatible bloc can therefore
  // govern even when no single party is largest — the largest party doesn't
  // automatically lead.
  const total = entries.reduce((t, x) => t + x.seats, 0);
  const byEcon = [...entries].sort((a, b) => a.f.platform.econ - b.f.platform.econ);
  let acc = 0, pivot = entries[0];
  for (const x of byEcon) { acc += x.seats; if (acc > total / 2) { pivot = x; break; } }
  const order = [...entries].sort((a, b) => beliefDistance(a.f.platform, pivot.f.platform) - beliefDistance(b.f.platform, pivot.f.platform));
  for (const lead of order) {
    const coalition = [lead.f];
    let seats = lead.seats;
    const partners = entries
      .filter(x => x.f !== lead.f)
      .sort((a, b) => beliefDistance(a.f.platform, lead.f.platform) - beliefDistance(b.f.platform, lead.f.platform));
    for (const c of partners) {
      if (seats > PARLIAMENT_SEATS / 2) break;
      if (beliefDistance(c.f.platform, lead.f.platform) > 1.1) continue; // too far to govern together
      coalition.push(c.f);
      seats += c.seats;
    }
    if (seats > PARLIAMENT_SEATS / 2) return { coalition, caretaker: false };
  }
  return { coalition: [entries[0].f], caretaker: true };
}

function holdElection(sim: Simulation) {
  const s = sim.state, rng = sim.rng, p = s.policy;
  s.gov.lastElection = s.day;
  s.gov.elections++;
  const candidates = s.factions.filter(f => f.members >= 3 || f.id === s.gov.rulingFactionId);
  if (!candidates.length) return;

  // Party machines campaign: treasury buys turnout among sympathisers
  // (spending is paid out to households — printers, canvassers, venues — not destroyed)
  const campaignBoost = new Map<number, number>();
  for (const f of candidates) {
    const spend = Math.max(0, f.treasury * 0.6);
    f.treasury -= spend;
    if (s.households.length) { const per = spend / s.households.length; for (const hh of s.households) hh.money += per; }
    campaignBoost.set(f.id, spend / Math.max(50, sim.adults().length));
  }

  const adults = enfranchised(sim, sim.adults());
  const disenfranchised = sim.adults().length - adults.length;
  if (disenfranchised > 4 && rng.chance(0.3)) {
    const excluded = sim.adults().filter(a => !adults.includes(a));
    for (const a of excluded.slice(0, 20)) a.grievance = clamp(a.grievance + 0.05);
  }

  // Voters don't waste ballots on hopeless parties under winner-take-all rules
  // (Duverger's law): the contest collapses toward the two strongest projected
  // candidacies — last election's seats, or membership before the first poll,
  // with mass-membership insurgents counting as somewhat viable even seatless.
  // Everyone below second place takes a penalty proportional to the gap.
  // Viability is judged from last time's *votes* (party ID), not winner-inflated seats — under
  // FPTP the opposition's seat share is ~0 even when it is the obvious challenger. The leading
  // challenger is itself never penalised, so Duverger consolidates the opposition instead of
  // entrenching the incumbent.
  const projTotal = s.gov.parliament.reduce((t, x) => t + x.seats, 0);
  const pid = new Map<number, number>();
  for (const a of adults) if (a.votedFor != null) pid.set(a.votedFor, (pid.get(a.votedFor) ?? 0) + 1);
  // Sympathy: a party that is the closest option for a real bloc of voters looks
  // viable even before it has ever won votes — without this, viability derived
  // only from past results makes the top-2 permanent.
  const nearestCount = new Map<number, number>();
  for (const a of adults) {
    let nb = candidates[0], nd = Infinity;
    for (const c of candidates) { const dd = beliefDistance(a.beliefs, c.platform); if (dd < nd) { nd = dd; nb = c; } }
    nearestCount.set(nb.id, (nearestCount.get(nb.id) ?? 0) + 1);
  }
  // Viability = who looks like they can win. Past votes and seats count — but so do
  // organic strength (membership rolls, street power) and ideological demand
  // (sympathy). A hollow incumbent with no members left can't hide behind last
  // cycle's result; a mass insurgency doesn't need a seat to look like it could
  // take one.
  const viability = new Map<number, number>(candidates.map((c): [number, number] => [c.id, Math.max(
    projTotal > 0 ? (s.gov.parliament.find(x => x.factionId === c.id)?.seats ?? 0) / projTotal * 0.35 : 0,
    (pid.get(c.id) ?? 0) / Math.max(1, adults.length),
    ((nearestCount.get(c.id) ?? 0) / Math.max(1, adults.length)) * 0.8,
    (c.members / Math.max(1, adults.length)) * 0.9,
    (c.strength / Math.max(1, adults.length)) * 1.5)]));
  const shares = [...viability.values()].sort((a, b) => b - a);
  const secondShare = Math.max(0.03, shares[1] ?? 0);
  const strategic = p.electoralSystem === 'pr' ? 0 : p.electoralSystem === 'runoff' ? 1.6 : 3.2;

  // Retrospective voting context: the electorate judges incumbents on outcomes —
  // food, safety, jobs, inflation, queues — not just ideological proximity
  const unempRate = adults.filter(a => a.job === 'unemployed').length / Math.max(1, adults.length);
  const inflation = Math.max(0, s.market.inflationRate);
  const giniNow = s.stats.at(-1)?.gini ?? 0;
  const queueBurden = Math.min(1, s.plan.queueHours / 3);
  // "Are you better off than you were?" — voters also punish *declining* conditions
  // even when the absolute level remains tolerable
  const condIdx = (x: (typeof s.stats)[number]) => x.happiness * 0.5 + x.foodSecurity * 0.35 - x.unemployment * 0.35 - Math.max(0, x.inflation) * 0.3 - x.shortage * 0.25;
  const stNow = s.stats.at(-1), stPast = s.stats.at(-Math.min(s.stats.length, 240));
  const trend = stNow && stPast && stNow.day - stPast.day > 60 ? clamp((condIdx(stNow) - condIdx(stPast)) * 2.5, -0.5, 0.5) : 0;
  // Expectations adapt: voters credit incumbents for being better off than they've grown used
  // to (~4 years), not for a permanently high absolute level — otherwise good times entrench
  const window = s.stats.slice(-Math.min(s.stats.length, 4 * DAYS_PER_YEAR));
  const expectH = window.length ? window.reduce((t, x) => t + x.happiness, 0) / window.length : 0.6;

  const meanApproval = adults.reduce((t, a) => t + a.approval, 0) / Math.max(1, adults.length);
  const votes = new Map<number, number>();
  let turnout = 0;
  const voteOf = new Map<number, number>();
  for (const a of adults) {
    // Anger mobilises: aggrieved citizens turn out (usually against incumbents)
    if (a.jailedUntil > s.day || !rng.chance(0.46 + Math.abs(a.approval - 0.5) + a.personality.C * 0.2 + a.grievance * 0.18)) continue;
    // Pocketbook score: personal wellbeing plus shared economic conditions.
    // Bad times punish every party in government, even ideologically aligned ones.
    // The absolute-wellbeing and inequality terms keep chronic misery legible —
    // adaptive expectations alone normalise a permanently bad status quo to zero.
    const pocketbook = clamp(
      (a.happiness - expectH) * 0.9 + (a.happiness - 0.62) * 0.5
      + Math.min(0, a.needs.food - 0.7) * 0.8 + Math.min(0, a.needs.safety - 0.7) * 0.4
      + (a.job === 'unemployed' ? -0.3 : 0)
      - Math.max(0, giniNow - 0.5) * 0.35
      - inflation * 0.5 - unempRate * 0.25 - queueBurden * 0.25,
      -0.6, 0.6);
    let nearest = candidates[0], nearestD = Infinity;
    for (const c of candidates) { const dd = beliefDistance(a.beliefs, c.platform); if (dd < nearestD) { nearestD = dd; nearest = c; } }
    // A slice of every electorate votes sincerely for its true favourite rather
    // than tactically for a viable one — otherwise the top-2 penalty strangles
    // every insurgent before it can accumulate votes of its own. Sincerity only
    // binds when the favourite is genuinely close — nobody dies on a hill they
    // don't stand on.
    const sincere = nearestD < 0.6 && rng.chance(0.25);
    let best = candidates[0], bd = Infinity;
    for (const c of candidates) {
      const dist = beliefDistance(a.beliefs, c.platform);
      let d = dist;
      const govWeight = c.id === s.gov.rulingFactionId ? 1 : s.gov.coalition.includes(c.id) ? 0.6 : 0;
      if (govWeight) d -= (pocketbook * 0.5 + (a.approval - meanApproval) * 0.5 + (meanApproval - 0.6) * 0.25 + trend * 0.5) * govWeight;
      // Cost of ruling: the longer a party governs, the more voters tire of it (accumulated
      // scandals, broken promises, "time for a change")
      if (govWeight) d += Math.min(0.3, (s.day - s.gov.since) / 120 * 0.05) * govWeight;
      // Party loyalty is real but not blind: members of a party that has drifted
      // away from them defect at the ballot box even while remaining members
      if (a.factionId === c.id) d -= 0.32 * clamp(1 - d);
      // Partisan identification: voters stick with the party they backed last time,
      // unless it has since drifted far from them — losing parties keep a floor
      if (a.votedFor === c.id) d -= 0.14 * clamp(1.4 - dist);
      // Candidate quality: a compelling leader wins votes the platform alone wouldn't
      const cand = sim.agent(c.leaderId) ?? sim.agent(c.founderId);
      if (cand) d -= 0.1 * (cand.personality.E * 0.7 + cand.skill * 0.3);
      if (strategic && !(sincere && c.id === nearest.id)) d += Math.min(0.55, Math.max(0, secondShare - (viability.get(c.id) ?? 0)) * strategic);
      d += rng.normal(0, 0.055); // idiosyncratic candidate taste — margins stay human
      d *= 1 - Math.min(0.18, campaignBoost.get(c.id) ?? 0);
      // Floors win close races, not distant ones: loyalty, incumbency, charisma and
      // money can discount ideological distance by at most ~45% — a hollow legacy
      // party cannot buy a voter it no longer fits
      d = Math.max(d, dist * 0.55);
      if (d < bd) { bd = d; best = c; }
    }
    votes.set(best.id, (votes.get(best.id) ?? 0) + 1);
    voteOf.set(a.id, best.id);
    a.votedFor = best.id;
    turnout++;
  }
  if (!turnout) return;

  // Ballot stuffing: an entrenched incumbent under weak courts and high corruption
  // pads its count. The opposition notices — it feeds scandal and anger even when
  // the fraud "works"
  const incumbent = s.gov.rulingFactionId != null ? sim.faction(s.gov.rulingFactionId) : undefined;
  if (incumbent && candidates.some(c => c.id === incumbent.id) && p.corruption > 0.25 && p.judiciary < 0.55) {
    const fake = Math.round(turnout * p.corruption * (0.55 - p.judiciary) * 0.4 * (0.5 + rng.next() * 0.5));
    if (fake > 0) {
      votes.set(incumbent.id, (votes.get(incumbent.id) ?? 0) + fake);
      turnout += fake;
      s.gov.scandal = clamp(s.gov.scandal + p.corruption * 0.25);
      incumbent.anger = clamp(incumbent.anger + 0.1); // brazen theft stains even the thief
    }
  }

  let winner: Faction | undefined;
  let mandatePct = 0;
  let results = '';

  if (p.electoralSystem === 'runoff') {
    // Top two advance if no majority; voters realign to nearer of the pair
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [topId, topV] = sorted[0];
    if (topV > turnout / 2) {
      winner = sim.faction(topId);
      mandatePct = (topV / turnout) * 100;
    } else if (sorted.length > 1) {
      const [aId, bId] = [sorted[0][0], sorted[1][0]];
      const fa = sim.faction(aId)!, fb = sim.faction(bId)!;
      let av = 0, bv = 0;
      for (const aid of voteOf.keys()) {
        const ag = sim.agent(aid);
        if (!ag) continue;
        const da = beliefDistance(ag.beliefs, fa.platform), db = beliefDistance(ag.beliefs, fb.platform);
        if (da <= db) av++; else bv++;
      }
      winner = av >= bv ? fa : fb;
      mandatePct = (Math.max(av, bv) / Math.max(1, av + bv)) * 100;
      results = `runoff: ${fa.name} ${Math.round((av / Math.max(1, av + bv)) * 100)}% vs ${fb.name} ${Math.round((bv / Math.max(1, av + bv)) * 100)}%`;
      sim.log(`No majority — a runoff was held between the ${fa.name} and the ${fb.name}.`, 'politics');
    }
  }
  if (!winner) {
    const [winnerId, wv] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    winner = sim.faction(winnerId);
    mandatePct = (wv / turnout) * 100;
  }
  if (!winner) return;
  if (!results) results = [...votes.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => `${sim.faction(id)?.name} ${Math.round((v / turnout) * 100)}%`).join(', ');

  // Disputed count: knife-edge results breed "stolen election" cries — the loser
  // and their supporters stay angry, and the poison lingers into the next cycle
  const sorted0 = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  // Two-party races routinely finish within a few points, so the cry needs a real
  // knife-edge — and even then only sometimes lands — to stay meaningful.
  if (sorted0.length > 1 && (sorted0[0][1] - sorted0[1][1]) / turnout < 0.02 && rng.chance(0.6)) {
    const loser = sim.faction(sorted0[1][0]);
    if (loser && loser.id !== winner.id) {
      loser.anger = clamp(loser.anger + 0.2);
      s.gov.pentUp = clamp(s.gov.pentUp + 0.06);
      for (const a of s.agents) if (a.factionId === loser.id) a.grievance = clamp(a.grievance + 0.08);
      sim.log(`The ${loser.name} disputes the count — cries of a stolen election spread through its ranks.`, 'politics');
    }
  }

  allocateSeats(sim, votes, turnout);

  // Government formation: PR systems need a coalition when no party has a majority.
  // The coalition leader — whoever assembled the majority — is the real winner.
  let coalition: Faction[] = [winner];
  if (p.electoralSystem === 'pr') {
    const formed = formCoalition(sim);
    coalition = formed.coalition;
    s.gov.caretaker = formed.caretaker;
    s.gov.coalition = coalition.map(f => f.id);
    if (formed.caretaker) {
      sim.log(`Election: no party could form a majority. A caretaker government rules (${results}).`, 'politics');
    } else {
      if (coalition[0] && coalition[0].id !== winner.id) {
        winner = coalition[0];
        mandatePct = (votes.get(winner.id) ?? 0) / turnout * 100;
      }
      if (coalition.length > 1) {
        sim.log(`Coalition government formed: ${coalition.map(f => f.name).join(' + ')} (${results}).`, 'politics');
      }
    }
  } else {
    s.gov.caretaker = false;
    s.gov.coalition = [winner.id];
  }
  // A coalition governs with its combined vote share as its mandate
  const mandate = coalition.length > 1
    ? coalition.reduce((t, f) => t + (votes.get(f.id) ?? 0), 0) / turnout * 100
    : mandatePct;
  const pct = Math.round(mandate);

  // Term limits: a leader who has served the maximum steps aside; party picks a successor
  const leader = sim.agent(winner.leaderId) ?? sim.agent(winner.founderId);
  let newLeader = leader;
  if (p.termLimits > 0 && s.gov.termsServed >= p.termLimits && leader && s.gov.leaderId === leader.id) {
    const members = s.agents.filter(a => a.factionId === winner!.id && a.id !== leader.id && a.age >= 18)
      .sort((a, b) => b.commitment - a.commitment);
    newLeader = members[0] ?? leader;
    if (newLeader !== leader) {
      sim.log(`${leader.name} has reached the term limit and steps aside; ${newLeader.name} leads the ${winner.name}.`, 'politics', newLeader.id);
    }
    s.gov.termsServed = 0;
  }
  if (winner.id === s.gov.rulingFactionId && s.gov.leaderId === newLeader?.id) s.gov.termsServed++;
  else s.gov.termsServed = 0;

  const bars = [...votes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => {
    const f = sim.faction(id);
    return { color: f?.color ?? '#adb5bd', value: v / turnout, label: f?.name ?? '?' };
  });
  const scene = { kind: 'election' as const, color: winner.color, color2: sim.faction(s.gov.rulingFactionId)?.color, bars };
  if (winner.id === s.gov.rulingFactionId) sim.log(`Election: the ${winner.name} was re-elected (${results}).`, 'politics', undefined, scene);
  else {
    sim.log(`Election: the ${winner.name} won with ${pct}% (${results}). Policy will shift ${describePlatform(winner.platform)}.`, 'politics', undefined, scene);
    s.gov.rulingFactionId = winner.id;
    s.gov.leaderId = newLeader?.id ?? null;
    s.gov.since = s.day; // the incumbency clock (cost of ruling) restarts with the new government
  }
  for (const a of sim.adults()) if (voteOf.get(a.id) === winner.id) a.grievance *= 0.6;

  // Coalition policy = seat-weighted platform of governing parties
  const coalitionPlatform = coalition.length > 1
    ? meanBeliefs(coalition.flatMap(f => membersOf(sim, f)))
    : winner.platform;
  const target = reformPolicy(coalition.length > 1 ? coalitionPlatform : winner.platform, s.policy, s.gov.baseline, true);
  const next = lerpPolicy(s.policy, target, 0.55);
  // Structural property/allocation shifts in a democracy require a clear mandate (>45% vote share and strong ideological conviction)
  if (pct >= 45 && Math.abs(winner.platform.econ) > 0.35 && !s.gov.caretaker) {
    next.ownership = target.ownership;
    next.allocation = target.allocation;
  }
  applyPolicyChange(sim, next);

  // Autocratic self-coup: an authoritarian winner may suspend elections — unless an
  // independent judiciary blocks the decree
  if (winner.platform.auth > 0.58 && pct > 52 && rng.chance(0.32)) {
    if (rng.chance(p.judiciary * 0.8)) {
      sim.log(`The ${winner.name} tried to suspend elections, but the courts struck down the decree.`, 'politics');
      s.gov.scandal = clamp(s.gov.scandal + 0.3);
    } else {
      const q = { ...s.policy, governance: 'autocracy' as const, civilLiberty: Math.min(s.policy.civilLiberty, 0.3), enforcement: Math.max(s.policy.enforcement, 0.65) };
      applyPolicyChange(sim, q);
      sim.log(`The ${winner.name} suspended future elections. Democracy has ended.`, 'politics');
    }
  }
}

/**
 * Daily party upkeep: treasuries collect dues and donations, leaders are chosen
 * (or replaced) among committed members, and wealthy patrons tilt party funds.
 */
function partyPolitics(sim: Simulation) {
  const s = sim.state;
  const wealth = householdWealth(sim);
  const wealths = s.households.map(hh => wealth.get(hh.id) ?? 0).sort((a, b) => a - b);
  const p90 = wealths[Math.floor(wealths.length * 0.9)] ?? Infinity;

  for (const f of s.factions) {
    const members = membersOf(sim, f);
    // Dues: every member chips in (mass parties live on numbers), while patrons
    // above p90 still give much more — elite capture channel, but not decisive alone
    // Dues are real transfers out of member households (money is conserved)
    const market = s.policy.allocation === 'market';
    for (const a of members) {
      const w = wealth.get(a.householdId) ?? 0;
      const hh = sim.household(a.householdId);
      const due = (0.6 + 0.006 * Math.min(w, 300)) * (w > p90 ? 2.5 : 1) * a.commitment * 0.01;
      if (!hh || !market || hh.money < due * 20) continue;
      hh.money -= due; f.treasury += due;
    }
    // Party leadership: the founder stays until death/resignation, then the most committed
    // senior member takes over; platform visibly pivots toward the new leader
    const leader = sim.agent(f.leaderId);
    if (!leader || leader.factionId !== f.id) {
      const next = members.filter(a => a.age >= 18).sort((a, b) => b.commitment + b.personality.E * 0.3 - (a.commitment + a.personality.E * 0.3))[0];
      if (next) {
        f.leaderId = next.id;
        sim.remember(next, `Now leads the ${f.name}.`);
        if (f.id === s.gov.rulingFactionId) s.gov.leaderId = next.id;
        if (s.day - f.foundedDay > 60) sim.log(`${next.name} now leads the ${f.name}.`, 'politics', next.id);
      }
    }
  }
}

/**
 * Free press propagates corruption scandals (legitimacy hits, voters punish); censorship
 * suppresses scandal but dissent goes underground as pent-up anger that eventually bursts.
 */
function pressAndDissent(sim: Simulation) {
  const s = sim.state, p = s.policy, rng = sim.rng;
  // Scandal pressure builds from corruption + black markets
  const corrupt = p.corruption + (s.plan.blackMarketShare ?? 0) * 0.5;
  s.gov.scandal = clamp(s.gov.scandal + corrupt * 0.006 - 0.0008);

  if (s.gov.scandal > 0.45 && rng.chance(0.03 + s.gov.scandal * 0.04)) {
    if (p.pressFreedom > 0.45) {
      // Free media: scandal erupts, legitimacy takes a public hit, voters remember
      const hit = s.gov.scandal * (0.1 + p.pressFreedom * 0.12);
      s.gov.legitimacy = clamp(s.gov.legitimacy - hit);
      s.gov.scandal *= 0.4;
      const leader = sim.agent(s.gov.leaderId);
      if (leader) leader.approval = clamp(leader.approval - 0.2);
      sim.log(`A newspaper exposé reveals corruption in the ${s.gov.regimeName}. Public outrage grows.`, 'politics');
      for (const a of s.agents) if (a.approval > 0.4 && sim.rng.chance(0.12)) a.approval = clamp(a.approval - 0.08);
    } else {
      // Censored press: scandal suppressed, but whispers feed pent-up dissent
      s.gov.pentUp = clamp(s.gov.pentUp + s.gov.scandal * 0.25);
      s.gov.scandal *= 0.2;
    }
  }

  // Pent-up dissent vents in waves: when it crosses a threshold a large coordinated
  // protest erupts among underground factions — bigger than normal rallies
  if (s.gov.pentUp > 0.7) {
    const opp = s.factions.filter(f => f.id !== s.gov.rulingFactionId);
    for (const f of opp) {
      f.anger = clamp(f.anger + 0.25);
      f.strength *= 1.15;
    }
    if (rng.chance(0.08)) {
      s.gov.pentUp = 0;
      s.gov.legitimacy = clamp(s.gov.legitimacy - 0.08);
      sim.log('Suppressed dissent bursts into the open — coordinated protests sweep the town.', 'unrest');
      for (const a of s.agents) if (a.factionId && a.factionId !== s.gov.rulingFactionId) a.grievance = clamp(a.grievance + 0.15);
    }
  }
}

/** Martial law: a desperate authoritarian regime bans gatherings; it buys quiet at the cost of legitimacy. */
function martialLawCheck(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const autocratic = p.governance === 'autocracy' || p.governance === 'monarchy';
  if (!autocratic || s.gov.martialLaw > 0) return;
  const opp = s.factions.filter(f => f.id !== s.gov.rulingFactionId && f.anger > 0.55);
  const pressure = opp.reduce((t, f) => t + f.strength * f.anger, 0);
  if (s.gov.legitimacy < 0.32 && pressure > sim.adults().length * 0.12 && sim.rng.chance(0.05 + p.enforcement * 0.1)) {
    s.gov.martialLaw = sim.rng.int(15, 40);
    sim.log(`MARTIAL LAW DECLARED. Gatherings are banned; troops patrol the streets.`, 'unrest', undefined, { kind: 'martial' });
    for (const a of s.agents) { a.fear = clamp(a.fear + 0.25); a.grievance = clamp(a.grievance + 0.05); }
    s.gov.legitimacy = clamp(s.gov.legitimacy - 0.06);
  }
}

/**
 * Military coup: when the armed guards are autonomous (high militaryPower) and the regime
 * is weak or illegitimate, the guard commander seizes power — distinct from a popular
 * revolution: quick, bloody-lite, installs a junta/autocracy.
 */
function militaryCoupCheck(sim: Simulation) {
  const s = sim.state, p = s.policy;
  if (p.governance === 'none' || p.governance === 'council' || p.militaryPower < 0.35) return;
  if (s.gov.martialLaw > 0) return;
  const guards = s.agents.filter(a => a.job === 'guard' && a.jailedUntil <= s.day);
  if (guards.length < 4) return;
  // Coups need a genuinely failing government (or wavering guards), not mere mediocrity,
  // and juntas don't immediately coup each other
  if (s.day - (s.gov.lastRegimeChange ?? -9999) < 5 * DAYS_PER_YEAR) return;
  if (s.gov.legitimacy > 0.55 && s.gov.securityLoyalty > 0.55) return;
  const weakness = (1 - s.gov.legitimacy) * p.militaryPower;
  if (weakness < 0.3 || !sim.rng.chance(0.002 + weakness * 0.003)) return;

  const commander = guards.sort((a, b) => (b.skill + b.personality.E + b.personality.C) - (a.skill + a.personality.E + a.personality.C))[0];
  const oldLeader = sim.agent(s.gov.leaderId);
  const oldColor = sim.faction(s.gov.rulingFactionId)?.color;
  const junta = newFaction(sim, commander, { econ: 0.25, auth: 0.85, trad: 0.15 }, 'Military Junta');
  junta.underground = false;
  for (const g of guards) { g.factionId = junta.id; g.commitment = 0.8; }
  if (oldLeader && sim.rng.chance(0.4)) {
    oldLeader.jailedUntil = s.day + 60;
    sim.remember(oldLeader, 'Imprisoned after the military coup.');
  }
  const next = { ...p, governance: 'autocracy' as const, enforcement: Math.max(p.enforcement, 0.7), civilLiberty: Math.min(p.civilLiberty, 0.3) };
  applyPolicyChange(sim, next);
  s.gov.baseline = { policy: { ...s.policy }, beliefs: { ...junta.platform } };
  s.gov.lastRegimeChange = s.day;
  s.gov.rulingFactionId = junta.id;
  s.gov.leaderId = commander.id;
  s.gov.coalition = [junta.id];
  s.gov.caretaker = false;
  s.gov.since = s.day;
  s.gov.revolutions++;
  sim.log(`MILITARY COUP! ${commander.name} and the guards have seized power. A junta now rules.`, 'politics', commander.id, { kind: 'coup', color: junta.color, color2: oldColor, n: guards.length });
  for (const a of s.agents) { a.fear = clamp(a.fear + 0.3); a.approval *= 0.6; }
}

function councilDecides(sim: Simulation) {
  const s = sim.state;
  const adults = sim.adults();
  if (!adults.length) return;
  const mean: Beliefs = {
    econ: adults.reduce((t, a) => t + a.beliefs.econ, 0) / adults.length,
    auth: adults.reduce((t, a) => t + a.beliefs.auth, 0) / adults.length,
    trad: adults.reduce((t, a) => t + a.beliefs.trad, 0) / adults.length,
  };
  if (mean.auth > 0.22) {
    const next = { ...policyFromBeliefs(mean, s.policy, false), governance: 'democracy' as const };
    applyPolicyChange(sim, next);
    s.gov.baseline = { policy: { ...next }, beliefs: { ...mean } };
    sim.log('The open council voted to establish a formal state with elected leadership.', 'politics', undefined, { kind: 'reform' });
    return;
  }
  const target = reformPolicy(mean, s.policy, s.gov.baseline, true);
  const next = lerpPolicy(s.policy, target, 0.15);
  if (mean.econ > -0.18 && s.policy.allocation === 'commons') {
    next.allocation = 'market';
    sim.log('The council voted to reintroduce markets and money.', 'politics');
  }
  applyPolicyChange(sim, next);
}

function statelessDynamics(sim: Simulation) {
  const s = sim.state;
  const adults = sim.adults().length || 1;
  for (const f of s.factions) {
    if (f.strength / adults > 0.12 && f.anger > 0.35 && (f.platform.auth > 0.1 || f.platform.econ < -0.3)) {
      const next = policyFromBeliefs(f.platform, s.policy, false);
      if (next.governance === 'none' && next.allocation === s.policy.allocation) continue;
      sim.log(`With no state to oppose them, the ${f.name} reorganised society.`, 'politics');
      revolutionSucceeds(sim, f);
      return;
    }
  }
}

/**
 * Faction splintering: when a sizeable wing of a party's membership drifts far from the
 * party line, they can break away and form a new faction instead of silently conforming.
 * Ruling factions under autocracy don't split — they purge (handled in rulingDynamics).
 */
function checkSplinters(sim: Simulation) {
  const s = sim.state;
  if (s.factions.length >= 12) return;
  for (const f of [...s.factions]) {
    if (f.members < 6 || s.day - f.foundedDay < 60) continue;
    const members = membersOf(sim, f);
    const outliers = members.filter(a => beliefDistance(a.beliefs, f.platform) > 0.72 && a.id !== s.gov.leaderId);
    if (outliers.length < Math.max(3, f.members * 0.15)) continue;
    const isRuling = f.id === s.gov.rulingFactionId;
    const autocratic = s.policy.governance === 'autocracy' || s.policy.governance === 'monarchy';
    // Ruling parties under autocracy only split when the regime is visibly failing (elite defection)
    if (isRuling && autocratic && (s.gov.legitimacy > 0.5 || s.factions.length >= 9)) continue;
    const dispersion = members.reduce((t, a) => t + beliefDistance(a.beliefs, f.platform), 0) / Math.max(1, members.length);
    if (!sim.rng.chance((0.012 + dispersion * 0.02) * (isRuling ? 0.4 : 1))) continue;
    const founder = [...outliers].sort((a, b) => b.commitment + b.personality.E * 0.3 - (a.commitment + a.personality.E * 0.3))[0];
    const mean = meanBeliefs(outliers);
    const nf = newFaction(sim, founder, mean);
    for (const a of outliers) { a.factionId = nf.id; a.commitment = Math.max(a.commitment, 0.45); }
    if (isRuling && autocratic) s.gov.legitimacy = clamp(s.gov.legitimacy - 0.04);
    sim.log(isRuling && autocratic
      ? `Elite split! ${outliers.length} members of the ruling ${f.name} defected to form the ${nf.name} (${describePlatform(nf.platform)}).`
      : `A dissident wing of ${outliers.length} members split from the ${f.name} to form the ${nf.name} (${describePlatform(nf.platform)}).`,
    'politics', founder.id, { kind: 'split', color: f.color, color2: nf.color, n: outliers.length });
    for (const a of outliers) sim.remember(a, `Broke away to found the ${nf.name}.`);
    break;
  }
}

/**
 * Party mergers: ideologically close parties consolidate — faster when both are small, when a
 * winner-take-all election looms (Duverger's law), or when an opposition under a failing
 * dictatorship forms a united front. The larger party absorbs the smaller.
 */
function checkMergers(sim: Simulation) {
  const s = sim.state, p = s.policy;
  // Mergers are rare, deliberate events: at most one per ~1.5 years — but a field
  // crowded near the faction cap consolidates faster so new positions can emerge
  if (s.factions.length < 4 || s.day - (s.gov.lastMerge ?? -999) < 45) return;
  if (!sim.rng.chance(s.factions.length >= 8 ? 0.08 : 0.02)) return;
  const adults = Math.max(1, sim.adults().length);
  const fptpSoon = p.governance === 'democracy' && p.electoralSystem !== 'pr' &&
    s.gov.lastElection + p.electionYears * DAYS_PER_YEAR - s.day < DAYS_PER_YEAR;
  const autocratic = p.governance === 'autocracy' || p.governance === 'monarchy';
  const frontMood = autocratic && s.gov.legitimacy < 0.5;
  let best: { a: Faction; b: Faction; score: number } | null = null;
  for (let i = 0; i < s.factions.length; i++) {
    for (let j = i + 1; j < s.factions.length; j++) {
      const a = s.factions[i], b = s.factions[j];
      if (s.day - a.foundedDay < 90 || s.day - b.foundedDay < 90) continue;
      const ruling = a.id === s.gov.rulingFactionId || b.id === s.gov.rulingFactionId;
      if (ruling && autocratic) continue; // regimes co-opt individuals, not parties
      const front = frontMood && a.underground && b.underground;
      // Compatibility: same side of the economic axis and similar radicalism. Revolutionaries
      // don't fold into moderate parties (except tactically, in an anti-dictatorship front).
      const sameSide = Math.sign(a.platform.econ) === Math.sign(b.platform.econ) || Math.max(Math.abs(a.platform.econ), Math.abs(b.platform.econ)) < 0.2;
      const radicalGap = Math.abs(Math.abs(a.platform.econ) - Math.abs(b.platform.econ)) + Math.abs(Math.abs(a.platform.auth) - Math.abs(b.platform.auth)) * 0.6;
      if (!front && (!sameSide || radicalGap > 0.25)) continue;
      const dist = beliefDistance(a.platform, b.platform);
      // Only genuinely marginal parties are pushed to merge
      const small = Math.min(a.members, b.members) / adults < 0.03;
      let threshold = 0.2 + (small ? 0.06 : 0) + (fptpSoon && small ? 0.06 : 0);
      // A crowded field tolerates looser pairings between marginal same-side parties
      if (small && s.factions.length >= 9) threshold += 0.15;
      if (front) threshold += 0.25;
      if (dist > threshold) continue;
      const score = threshold - dist;
      if (!best || score > best.score) best = { a, b, score };
    }
  }
  if (!best || !sim.rng.chance(0.3 + best.score)) return;
  s.gov.lastMerge = s.day;
  const [big, small] = best.a.members >= best.b.members ? [best.a, best.b] : [best.b, best.a];
  const wBig = big.members / Math.max(1, big.members + small.members);
  big.platform = {
    econ: lerp(small.platform.econ, big.platform.econ, wBig),
    auth: lerp(small.platform.auth, big.platform.auth, wBig),
    trad: lerp(small.platform.trad, big.platform.trad, wBig),
  };
  big.treasury += small.treasury;
  big.seats += small.seats;
  big.anger = Math.max(big.anger, small.anger);
  const n = small.members;
  for (const a of s.agents) {
    if (a.factionId !== small.id) continue;
    // Hard-liners who don't fit the merged party walk away instead of being absorbed
    if (beliefDistance(a.beliefs, big.platform) > 0.6) { a.factionId = null; a.commitment = 0; sim.remember(a, `Refused to follow the ${small.name} into the ${big.name}.`); }
    else { a.factionId = big.id; sim.remember(a, `Our party merged into the ${big.name}.`); }
  }
  s.gov.coalition = [...new Set(s.gov.coalition.map(id => (id === small.id ? big.id : id)))];
  for (const x of s.gov.parliament) if (x.factionId === small.id) x.factionId = big.id;
  const merged = new Map<number, number>();
  for (const x of s.gov.parliament) merged.set(x.factionId, (merged.get(x.factionId) ?? 0) + x.seats);
  s.gov.parliament = [...merged].map(([factionId, seats]) => ({ factionId, seats })).sort((x, y) => y.seats - x.seats);
  if (s.gov.rulingFactionId === small.id) s.gov.rulingFactionId = big.id;
  s.factions.splice(s.factions.indexOf(small), 1);
  const why = frontMood && big.underground ? 'a united opposition front' : fptpSoon ? 'consolidation ahead of the election' : 'a merger';
  sim.log(`The ${small.name} (${n} members) joined the ${big.name} in ${why}.`, 'politics', big.leaderId, { kind: 'merger', color: big.color, color2: small.color, n: big.members + n });
}

/**
 * What happens when the governing party's rank & file drift away from enacted policy:
 * - Democracies bend policy toward the base continuously between elections.
 * - Autocrats/monarchs face a choice by temperament: reformist leaders quietly move
 *   policy toward the base; hardliners purge deviant members to hold the line.
 */
function rulingDynamics(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const ruling = sim.faction(s.gov.rulingFactionId);
  if (!ruling) return;
  const members = membersOf(sim, ruling);
  if (!members.length) return;
  const mean = meanBeliefs(members);
  const leader = sim.agent(s.gov.leaderId);
  const autocratic = p.governance === 'autocracy' || p.governance === 'monarchy';

  // A strong leader stamps their own convictions onto the party line
  if (autocratic && leader) {
    ruling.platform.econ = lerp(ruling.platform.econ, leader.beliefs.econ, 0.01);
    ruling.platform.auth = lerp(ruling.platform.auth, leader.beliefs.auth, 0.01);
    ruling.platform.trad = lerp(ruling.platform.trad, leader.beliefs.trad, 0.01);
  }

  const gap = beliefDistance(mean, perceivedPosition(p, s.gov.baseline));
  if (p.governance === 'democracy') {
    if (gap > 0.28) {
      const target = reformPolicy(mean, p, s.gov.baseline, true);
      applyPolicyChange(sim, lerpPolicy(p, target, 0.014));
    }
    return;
  }
  if (!autocratic || gap < 0.55) return;
  const hardliner = (leader?.beliefs.auth ?? p.enforcement) > 0.25 && p.enforcement > 0.4;
  if (hardliner) purgeRulingParty(sim, ruling, leader);
  else {
    // Reformers adjust numeric policy toward the base, but never abandon the regime's structure
    // (ownership/allocation) by stealth — that requires a revolution or a decisive leadership change.
    const target = reformPolicy(mean, p, s.gov.baseline, true);
    target.ownership = p.ownership; target.allocation = p.allocation;
    applyPolicyChange(sim, lerpPolicy(p, target, 0.004));
    if (s.day % 30 === 0 && sim.rng.chance(0.5)) sim.log(`The ruling circle quietly shifted policy toward its grassroots (${describePlatform(mean)}).`, 'politics');
  }
}

/**
 * The security apparatus decides whether autocracies survive: guards stay loyal when paid,
 * when their institution is privileged, and when the regime still looks viable. Disloyal guards
 * refuse to fire on crowds — the classic trigger of regime collapse.
 */
function securityApparatus(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const guards = s.agents.filter(a => a.job === 'guard' && a.jailedUntil <= s.day);
  if (!guards.length) { s.gov.securityLoyalty = lerp(s.gov.securityLoyalty, 0.5, 0.05); return; }
  const ruling = s.gov.rulingFactionId;
  const paid = p.allocation === 'commons' ? 0.5 : s.gov.treasury > guards.length * 5 ? 1 : 0.3;
  let sum = 0;
  for (const g of guards) {
    sum += clamp(
      0.3 + g.approval * 0.35 + (g.factionId === ruling && ruling != null ? 0.2 : 0) + paid * 0.15 +
      (g.factionId != null && g.factionId !== ruling ? -0.25 : 0) - g.grievance * 0.25 -
      (g.hungerDays > 3 ? 0.25 : 0), // starving soldiers don't defend the palace
    );
  }
  // Repressive regimes buy loyalty with privilege; a fresh regime has revolutionary élan
  const privilege = (p.governance === 'autocracy' || p.governance === 'monarchy') ? p.enforcement * 0.12 : 0;
  const fresh = Math.max(0, 1 - (s.day - s.gov.since) / (6 * DAYS_PER_YEAR)) * 0.12;
  s.gov.securityLoyalty = lerp(s.gov.securityLoyalty, clamp(sum / guards.length + privilege + fresh), 0.05);
}

/**
 * Autocrats facing decline choose a course every season: reformers "thaw" (amnesty, looser press,
 * small liberties — which can buy time or open the floodgates); hardliners tighten the screws.
 */
function autocraticCourse(sim: Simulation) {
  const s = sim.state, p = s.policy;
  if (p.governance !== 'autocracy' && p.governance !== 'monarchy') return;
  if (s.day - s.gov.lastCourse < DAYS_PER_YEAR || s.gov.legitimacy > 0.5) return;
  s.gov.lastCourse = s.day;
  const leader = sim.agent(s.gov.leaderId);
  const reformer = (leader?.beliefs.auth ?? 0.5) < 0.3 || (leader?.personality.O ?? 0) > 0.65;
  if (reformer) {
    let released = 0;
    for (const a of s.agents) if (a.jailedUntil > s.day) { a.jailedUntil = s.day; a.grievance *= 0.7; released++; }
    applyPolicyChange(sim, { ...p, civilLiberty: clamp(p.civilLiberty + 0.08), pressFreedom: clamp(p.pressFreedom + 0.08), enforcement: clamp(p.enforcement - 0.05) });
    for (const a of s.agents) a.fear *= 0.7;
    s.gov.legitimacy = clamp(s.gov.legitimacy + 0.04);
    sim.log(`A political thaw: ${leader?.name ?? 'the regime'} announces an amnesty${released ? ` freeing ${released} prisoners` : ''} and loosens censorship.`, 'politics', leader?.id, { kind: 'reform', color: sim.faction(s.gov.rulingFactionId)?.color, n: released });
  } else {
    applyPolicyChange(sim, { ...p, civilLiberty: clamp(p.civilLiberty - 0.06), pressFreedom: clamp(p.pressFreedom - 0.06), enforcement: clamp(p.enforcement + 0.06) });
    for (const a of s.agents) a.fear = clamp(a.fear + 0.12);
    sim.log(`The regime tightens its grip: new informer networks, censorship and curfews.`, 'unrest', leader?.id);
  }
}

function purgeRulingParty(sim: Simulation, ruling: Faction, leader: Agent | undefined) {
  const s = sim.state;
  if (s.day - (ruling.lastPurge ?? -999) < 40) return;
  const anchor = leader?.beliefs ?? ruling.platform;
  const deviants = membersOf(sim, ruling)
    .filter(a => a.id !== leader?.id && beliefDistance(a.beliefs, anchor) > 0.8)
    .sort((a, b) => beliefDistance(b.beliefs, anchor) - beliefDistance(a.beliefs, anchor));
  if (deviants.length < 2) return;
  ruling.lastPurge = s.day;
  const n = Math.max(1, Math.round(deviants.length * 0.35));
  let jailed = 0, executed = 0;
  for (const a of deviants.slice(0, n)) {
    a.factionId = null; a.commitment = 0;
    a.grievance = clamp(a.grievance + 0.35);
    a.fear = clamp(a.fear + 0.6);
    sim.remember(a, 'Expelled from the ruling party in a purge.');
    if (s.policy.enforcement > 0.55 && sim.rng.chance(0.4)) { a.jailedUntil = s.day + sim.rng.int(15, 45); jailed++; }
    else if (s.policy.enforcement > 0.8 && sim.rng.chance(0.12)) { sim.killAgent(a, 'executed in a party purge'); executed++; }
  }
  for (const a of membersOf(sim, ruling)) a.fear = clamp(a.fear + 0.15);
  s.gov.legitimacy = clamp(s.gov.legitimacy - 0.02);
  sim.log(`${leader?.name ?? 'The leadership'} purged ${n} dissident members of the ${ruling.name}${jailed ? `, ${jailed} jailed` : ''}${executed ? `, ${executed} executed` : ''}.`, 'unrest', leader?.id, { kind: 'purge', color: ruling.color, n });
}

// ---------------------------------------------------------------- unrest

/** Extreme inequality + an angry underclass produces spontaneous riots even without a faction to organise them. */
function breadRiots(sim: Simulation) {
  const s = sim.state, p = s.policy;
  if (p.governance === 'none' || p.ownership !== 'private') return;
  if (s.day - (s.gov.lastRiot ?? -999) < 16) return;
  const g = s.gov.incomeGini ?? 0;
  if (g < 0.34) return;
  const underclass = s.agents.filter(a => a.classIdentity === 'underclass' && a.age >= 15 && a.jailedUntil <= s.day);
  const share = underclass.length / Math.max(1, sim.adults().length);
  if (share < 0.06 || !underclass.length) return;
  const anger = underclass.reduce((t, a) => t + a.grievance, 0) / underclass.length;
  if (s.gov.martialLaw > 0) {
    // Martial law suppresses riots but anger goes underground
    for (const a of underclass) a.grievance = clamp(a.grievance + 0.008);
    return;
  }
  if (anger < 0.38 || !sim.rng.chance((anger - 0.3) * (g - 0.3) * share * 1.5 * weatherProtestFactor(s.weather.kind))) return;
  s.gov.lastRiot = s.day;

  const rioters = sim.rng.shuffle(underclass.filter(a => a.grievance > 0.28)).slice(0, Math.max(5, Math.round(underclass.length * (0.25 + anger * 0.4))));
  if (rioters.length < 4) return;
  const wealth = householdWealth(sim);
  const rich = [...s.households].sort((a, b) => (wealth.get(b.id) ?? 0) - (wealth.get(a.id) ?? 0)).slice(0, Math.max(2, s.households.length >> 3));
  for (const hh of rich) {
    const takeMoney = Math.min(Math.max(0, hh.money) * 0.12, 70);
    const takeFood = Math.min(hh.food * 0.25, 12);
    hh.money -= takeMoney; hh.food -= takeFood;
    for (const r of rioters) {
      const rh = sim.household(r.householdId);
      if (rh) { rh.money += takeMoney / rioters.length; rh.food += takeFood / rioters.length; }
    }
    for (const id of hh.members) {
      const a = sim.agent(id);
      if (a) { a.fear = clamp(a.fear + 0.2); a.needs.safety = clamp(a.needs.safety - 0.15); a.beliefs.auth = clamp(a.beliefs.auth + 0.02, -1, 1); a.beliefs.econ = clamp(a.beliefs.econ + 0.02, -1, 1); sim.remember(a, 'Our home was looted in a riot.'); }
    }
  }
  let arrested = 0, killed = 0;
  for (const r of rioters) { r.activity = 'riot'; sim.remember(r, 'Took part in a bread riot.'); }
  if (p.enforcement > 0.45) {
    for (const r of sim.rng.shuffle([...rioters]).slice(0, Math.round(rioters.length * p.enforcement * 0.3))) { r.jailedUntil = s.day + sim.rng.int(5, 20); arrested++; }
    if (p.enforcement > 0.75 && sim.rng.chance(0.3)) { for (const r of rioters.slice(0, 2)) { sim.killAgent(r, 'shot by guards during a riot'); killed++; } }
    for (const a of s.agents) a.fear = clamp(a.fear + 0.04);
  }
  // Catharsis: a riot vents pressure across the whole underclass — the same crowd doesn't
  // re-form the next day
  for (const a of underclass) a.grievance *= 0.5;
  s.gov.legitimacy = clamp(s.gov.legitimacy - 0.05);
  s.counters.crimes += rioters.length;
  sim.log(`Bread riot! ${rioters.length} hungry citizens looted wealthy homes${arrested ? `, ${arrested} arrested` : ''}${killed ? `, ${killed} shot by guards` : ''}.`, 'unrest', undefined, { kind: 'riot', n: rioters.length });
  // In a democracy the state answers riots with redistribution rather than only batons:
  // policy visibly bends toward what the rioters want
  // Relief is targeted (welfare, wage floor) — riots don't rewrite the whole platform
  if (p.governance === 'democracy' || p.governance === 'council') {
    applyPolicyChange(sim, { ...p, welfare: clamp(p.welfare + 0.03), wageFloor: clamp(p.wageFloor + 0.02), taxRate: clamp(p.taxRate + 0.01, 0, 0.7) });
    sim.log('The government announced emergency relief measures in response to the riots.', 'politics');
  }
}

/** Wealth buys influence: in private-property regimes, extreme inequality slowly corrupts the state. */
function eliteCapture(sim: Simulation) {
  const s = sim.state, p = s.policy;
  if (p.ownership !== 'private' || p.governance === 'none' || p.governance === 'council') return;
  const g = s.gov.incomeGini ?? 0;
  // Independent courts and a free press push back against capture; below the threshold, or
  // with strong checks, corruption slowly recedes instead of only ever ratcheting up
  // Corruption mean-reverts to an institutional equilibrium (the constitution's level), pushed
  // up by inequality and long unchecked tenure, pulled down by courts and a free press
  const checks = Math.max(0.1, 1 - 0.7 * p.judiciary - 0.3 * p.pressFreedom);
  const autocratic = p.governance === 'autocracy' || p.governance === 'monarchy';
  const tenureYears = (s.day - s.gov.since) / DAYS_PER_YEAR;
  const eq = clamp(
    (s.gov.baseline?.policy.corruption ?? 0.1) * (0.6 + 0.8 * checks)
    + Math.max(0, g - 0.33) * 1.2 * checks
    + (autocratic ? Math.min(0.15, tenureYears * 0.006) * checks : 0),
    0, 0.85);
  p.corruption = clamp(lerp(p.corruption, eq, 0.002), 0, 0.85);
  // Policy drifts toward the propertied: taxes & welfare erode, enforcement stiffens
  if (g > 0.45 && sim.rng.chance(0.02)) {
    applyPolicyChange(sim, lerpPolicy(p, { ...p, taxRate: Math.max(0.05, p.taxRate - 0.15), welfare: p.welfare * 0.7, enforcement: Math.min(1, p.enforcement + 0.15) }, 0.05));
  }
}

export function regimePower(sim: Simulation) {
  const s = sim.state, p = s.policy;
  const guards = s.agents.filter(a => a.job === 'guard' && a.jailedUntil <= s.day).length;
  const loyal = sim.faction(s.gov.rulingFactionId)?.strength ?? 0;
  // Only guards who will actually obey count; a young regime enjoys a consolidation bonus
  const obey = 0.25 + 0.75 * (s.gov.securityLoyalty ?? 0.75);
  const consolidation = 1 + Math.max(0, 1 - (s.day - s.gov.since) / (5 * DAYS_PER_YEAR)) * 0.5;
  return (guards * (1 + p.enforcement * 2) * obey + loyal * 0.7 + Math.max(0, s.gov.legitimacy - 0.45) * sim.adults().length * 0.4 + 2) * consolidation;
}

function unrest(sim: Simulation) {
  const s = sim.state, rng = sim.rng, p = s.policy;
  const adults = sim.adults().length || 1;
  if (p.governance === 'none') return;
  const power = regimePower(sim);
  // In a severe regime crisis, all angry opposition factions can coalesce behind the strongest rebel movement
  const oppFactions = s.factions.filter(f => f.id !== s.gov.rulingFactionId && f.anger > 0.45);
  // A subsistence crisis is a regime crisis whatever the propaganda says
  const starving = s.agents.filter(a => a.age >= 18 && a.hungerDays > 3).length / adults;
  // Street power: in a crisis, furious citizens who never joined a party pour in behind the
  // opposition — revolutions are made by crowds, not just card-carrying members
  const crowd = s.gov.legitimacy < 0.55 || starving > 0.08
    ? s.agents.filter(a => a.age >= 18 && a.factionId == null && a.grievance > 0.5 && a.jailedUntil <= s.day).length * (0.25 + starving)
    : 0;
  const coalitionStrength = oppFactions.reduce((t, f) => t + f.strength * (0.5 + f.anger), 0) + crowd;

  for (const f of [...s.factions]) {
    if (f.id === s.gov.rulingFactionId || s.day - f.lastAction < 8) continue;
    const share = f.members / adults;
    if (f.anger < 0.3 || share < 0.04) continue;
    // Martial law bans gatherings — strikes and rallies are impossible, but anger festers
    if (s.gov.martialLaw > 0) {
      for (const a of membersOf(sim, f)) a.grievance = clamp(a.grievance + 0.01);
      continue;
    }
    const isLeadRebel = oppFactions.length > 0 && oppFactions.every(o => f.strength >= o.strength);
    const effectivePower = isLeadRebel && s.gov.legitimacy < 0.56 ? Math.max(f.strength * (0.5 + f.anger), coalitionStrength * 0.85) : f.strength * (0.5 + f.anger);
    const ratio = effectivePower / power;
    const democratic = p.governance === 'democracy';
    // Autocracies fall in a genuine crisis: collapsing legitimacy, or a security apparatus that
    // will no longer shoot. Anger alone against loyal guards produces repression, not revolution.
    const crisis = democratic ? s.gov.legitimacy < 0.42 : s.gov.legitimacy < 0.55 || s.gov.securityLoyalty < 0.5 || starving > 0.12;
    // A regime that just took power gets a consolidation window before the next uprising
    const settled = s.day - (s.gov.lastRegimeChange ?? -9999) > 3 * DAYS_PER_YEAR;
    if (settled && ratio > 0.8 && f.anger > 0.48 && crisis && rng.chance(0.34)) {
      f.lastAction = s.day;
      attemptRevolution(sim, f, ratio);
      return;
    }
    // Labor militancy scales with inequality: even moderate unions strike for wage justice in
    // steeply unequal societies, while left factions strike sooner
    const giniNow = s.gov.incomeGini ?? 0;
    const militancy = (f.platform.econ < 0 ? 1 : 0.35) * (1 + Math.max(0, giniNow - 0.32) * 3);
    // Fear keeps people home: under repression open action is rare, and the pressure goes
    // underground instead (it resurfaces through pent-up dissent and uprisings)
    const fs = membersOf(sim, f);
    const fear = fs.reduce((t, a) => t + a.fear, 0) / Math.max(1, fs.length);
    // ...but hunger overrides fear: people with nothing left to lose take to the streets
    const hungry = fs.filter(a => a.hungerDays > 2).length / Math.max(1, fs.length);
    const daring = clamp(1 - fear * 1.1 + hungry * 1.2, 0.12, 1);
    if (daring < 0.5) s.gov.pentUp = clamp(s.gov.pentUp + f.anger * share * 0.02);
    if (f.anger > 0.45 && rng.chance(0.075 * f.anger * militancy * daring)) {
      f.strikeToday = true; f.lastAction = s.day;
      sim.log(`The ${f.name} called a general strike (${f.members} members).`, 'unrest', undefined, p.enforcement > 0.5 && p.civilLiberty < 0.5 ? undefined : { kind: 'strike', color: f.color, n: f.members });
      respond(sim, f, true);
      continue;
    }
    const freedom = 0.4 + 0.6 * p.civilLiberty;
    if (rng.chance(0.12 * f.anger * freedom * daring * weatherProtestFactor(s.weather.kind))) {
      f.protestToday = true; f.lastAction = s.day; f.protestDays++;
      sim.log(`The ${f.name} rallied ${Math.round(f.strength)} supporters in the plaza demanding ${describePlatform(f.platform)} policies.`, 'unrest', undefined, p.enforcement > 0.5 && p.civilLiberty < 0.5 ? undefined : { kind: 'rally', color: f.color, n: f.members });
      respond(sim, f, false);
    }
  }
}

function membersOf(sim: Simulation, f: Faction) { return sim.state.agents.filter(a => a.factionId === f.id); }

function respond(sim: Simulation, f: Faction, strike: boolean) {
  const s = sim.state, p = s.policy, rng = sim.rng;
  const members = membersOf(sim, f).filter(a => a.commitment > 0.25);
  if (p.enforcement > 0.5 && p.civilLiberty < 0.5) {
    const n = Math.max(1, Math.round(members.length * 0.15 * p.enforcement));
    const arrested = rng.shuffle(members).slice(0, n);
    for (const a of arrested) { a.jailedUntil = s.day + rng.int(10, 30); sim.remember(a, 'Arrested at a protest.'); }
    for (const a of members) {
      a.fear = clamp(a.fear + 0.25 * p.enforcement);
      a.grievance = clamp(a.grievance + 0.08);
      for (const fid of a.friends) { const fr = sim.agent(fid); if (fr) fr.grievance = clamp(fr.grievance + 0.03); }
    }
    let killed = 0;
    if (p.enforcement > 0.8 && rng.chance(0.3)) {
      for (const a of rng.shuffle([...members]).slice(0, rng.int(1, 3))) { sim.killAgent(a, 'killed by guards'); killed++; }
      for (const a of s.agents) a.grievance = clamp(a.grievance + 0.04);
    }
    // Arrested organisers leave the movement disorganised for weeks
    f.lastAction = s.day + Math.round(20 * p.enforcement * s.gov.securityLoyalty);
    sim.log(`Guards cracked down on the ${f.name}${strike ? ' strike' : ' rally'}: ${arrested.length} arrested${killed ? `, ${killed} killed` : ''}.`, 'unrest', undefined, { kind: 'crackdown', color: f.color, n: members.length });
  } else if (s.day - (s.gov.lastConcession ?? -999) > 45 && rng.chance(0.25 + p.civilLiberty * 0.35)) {
    // Governments bend in proportion to the movement's weight, and not every week
    const share = f.members / Math.max(1, sim.adults().length);
    const target = reformPolicy(f.platform, s.policy, s.gov.baseline, true);
    applyPolicyChange(sim, lerpPolicy(s.policy, target, clamp(share * 0.5, 0.01, 0.08)));
    s.gov.lastConcession = s.day;
    for (const a of members) a.grievance *= 0.85;
    sim.log(`The government made concessions to the ${f.name}.`, 'politics');
  }
}

function attemptRevolution(sim: Simulation, f: Faction, ratio: number) {
  const s = sim.state, rng = sim.rng, p = s.policy;
  const loyalty = s.gov.securityLoyalty ?? 0.75;
  const pSuccess = clamp(ratio / (1 + ratio) - 0.1 + (1 - s.gov.legitimacy) * 0.2 + (0.55 - loyalty) * 0.5, 0.05, 0.92);
  const members = membersOf(sim, f);
  // Preference falsification unravels: once the uprising starts, hidden sympathisers pour out
  if (s.gov.pentUp > 0.3) {
    for (const a of sim.adults()) if (a.factionId == null && a.grievance > 0.45 && rng.chance(s.gov.pentUp * 0.5)) { a.factionId = f.id; a.commitment = 0.5; members.push(a); }
    s.gov.pentUp *= 0.5;
  }
  const old = sim.faction(s.gov.rulingFactionId);
  sim.log(`UPRISING! The ${f.name} rose up against the ${s.gov.regimeName} with ${members.length} fighters.`, 'unrest', undefined, { kind: 'uprising', color: f.color, color2: old?.color, n: members.length });
  if (loyalty < 0.4) {
    const defectors = s.agents.filter(a => a.job === 'guard' && rng.chance(0.5 - loyalty));
    for (const g of defectors) { g.factionId = f.id; g.commitment = 0.6; }
    if (defectors.length) sim.log(`${defectors.length} guards refused to fire on the crowd and joined the ${f.name}.`, 'unrest');
  }
  f.protestToday = true;
  const casualties = rng.int(1, 2 + Math.round(members.length * 0.04 + p.enforcement * 3));
  const guards = s.agents.filter(a => a.job === 'guard');
  for (let i = 0; i < casualties; i++) {
    const pool = rng.chance(0.65) ? members : guards;
    const v = pool.length ? rng.pick(pool) : undefined;
    if (v && sim.agent(v.id)) sim.killAgent(v, 'killed in revolt');
  }
  if (rng.chance(pSuccess)) revolutionSucceeds(sim, f);
  else {
    const survivors = membersOf(sim, f);
    let executed = 0;
    for (const a of survivors) {
      if (a.commitment > 0.4 && rng.chance(0.5)) { a.jailedUntil = s.day + rng.int(20, 60); sim.remember(a, 'Imprisoned after the failed uprising.'); }
      if (p.enforcement > 0.7 && a.commitment > 0.6 && rng.chance(0.08)) { sim.killAgent(a, 'executed'); executed++; continue; }
      a.fear = clamp(a.fear + 0.5);
      a.commitment *= 0.5;
    }
    applyPolicyChange(sim, { ...s.policy, enforcement: clamp(p.enforcement + 0.08), civilLiberty: clamp(p.civilLiberty - 0.08) });
    sim.log(`The uprising was crushed.${executed ? ` ${executed} leaders were executed.` : ''} The regime tightens its grip.`, 'unrest', undefined, { kind: 'crackdown', color: f.color, n: survivors.length });
  }
}

function revolutionSucceeds(sim: Simulation, f: Faction) {
  const s = sim.state;
  const old = sim.faction(s.gov.rulingFactionId);
  const next = policyFromBeliefs(f.platform, s.policy, false);
  next.corruption = clamp(0.05 + Math.max(0, f.platform.auth) * 0.3);
  applyPolicyChange(sim, next);
  // A new constitutional settlement: future reforms are judged from here
  s.gov.baseline = { policy: { ...s.policy }, beliefs: { ...f.platform } };
  s.gov.lastRegimeChange = s.day;
  s.gov.revolutions++;
  s.gov.since = s.day;
  s.gov.lastElection = s.day;
  s.gov.termsServed = 0;
  s.gov.caretaker = false;
  s.gov.martialLaw = 0;
  s.gov.coalition = [];
  s.gov.parliament = [];
  s.gov.scandal = 0;
  s.gov.pentUp *= 0.4;
  s.gov.securityLoyalty = 0.75;
  s.gov.lastCourse = s.day;
  for (const of_ of s.factions) of_.seats = 0;
  s.gov.regimeName = regimeName(next);
  s.gov.rulingFactionId = next.governance === 'none' || next.governance === 'council' ? null : f.id;
  const leader = sim.agent(f.founderId) ?? membersOf(sim, f).sort((a, b) => b.commitment - a.commitment)[0];
  s.gov.leaderId = s.gov.rulingFactionId != null ? leader?.id ?? null : null;
  if (old) {
    old.underground = true;
    for (const a of membersOf(sim, old)) { a.grievance = clamp(a.grievance + 0.3); sim.remember(a, `Our regime was overthrown by the ${f.name}.`); }
  }
  for (const a of s.agents) {
    if (a.jailedUntil > s.day) a.jailedUntil = s.day;
    a.grievance *= a.factionId === f.id ? 0.2 : 0.6;
    a.fear *= 0.5;
  }
  if (old && next.governance === 'monarchy') old.name = old.name.replace('House of', 'Loyalists of');
  if (next.governance === 'monarchy' && leader) f.name = `House of ${leader.name.split(' ')[1]}`;
  sim.log(`REVOLUTION! The ${f.name} has taken power. A ${s.gov.regimeName} is proclaimed${leader && s.gov.leaderId ? ` under ${leader.name}` : ''}.`, 'politics', leader?.id, { kind: 'revolution', color: f.color, color2: old?.color, n: f.members });
}

/** Apply new policies including structural changes (ownership and allocation). */
export function applyPolicyChange(sim: Simulation, next: Policy) {
  const s = sim.state, rng = sim.rng;
  const prev = s.policy;
  if (next.ownership !== prev.ownership) {
    const workplaces = s.buildings.filter(b => BUILDING_PRODUCTION[b.type] || b.type === 'house' || b.type === 'tenement' || b.type === 'manor' || b.type === 'bank' || b.type === 'market');
    if (next.ownership === 'private') {
      const ruling = s.gov.rulingFactionId;
      const cronies = s.households.filter(hh => hh.members.some(id => sim.agent(id)?.factionId === ruling && ruling != null));
      const pool = cronies.length ? cronies : [...s.households].sort((a, b) => b.money - a.money).slice(0, Math.max(1, Math.round(s.households.length * 0.15)));
      for (const b of workplaces) {
        b.ownerKind = 'private';
        const isHome = b.type === 'house' || b.type === 'tenement' || b.type === 'manor';
        b.ownerHouseholdId = isHome ? b.residents[0] ?? rng.pick(pool)?.id ?? null : rng.pick(pool)?.id ?? null;
        if (!isHome) b.cash = Math.max(b.cash, 50);
      }
      sim.log('Property has been privatised.', 'economy');
    } else {
      const expropriated = new Set<number>();
      for (const b of workplaces) { if (b.ownerHouseholdId != null) expropriated.add(b.ownerHouseholdId); b.ownerKind = next.ownership; b.ownerHouseholdId = null; }
      for (const id of expropriated) for (const m of sim.household(id)?.members ?? []) {
        const a = sim.agent(m);
        if (a) { a.grievance = clamp(a.grievance + 0.4); a.beliefs.econ = clamp(a.beliefs.econ + 0.3, -1, 1); sim.remember(a, 'Our property was expropriated.'); }
      }
      if (expropriated.size) sim.log(`${expropriated.size} households had their property ${next.ownership === 'state' ? 'nationalised' : 'collectivised'}.`, 'economy');
    }
  }
  if (next.allocation !== prev.allocation) {
    if (prev.allocation === 'market') {
      for (const b of s.buildings) {
        const spec = BUILDING_PRODUCTION[b.type];
        if (spec) s.store[spec.good] += b.stock;
        b.stock = 0;
      }
    } else if (next.allocation === 'market') {
      const per = s.households.length || 1;
      const restored = prev.allocation === 'commons' ? s.gov.treasury * 0.8 : 0;
      s.gov.treasury -= restored;
      for (const hh of s.households) {
        const adults = hh.members.filter(id => (sim.agent(id)?.age ?? 0) >= 18).length;
        hh.food += s.store.food / per; hh.goods += s.store.goods / per;
        hh.money += restored / per + (prev.allocation === 'commons' ? 40 * adults : 20);
      }
      s.store.food = 0; s.store.goods = 0;
      for (const b of s.buildings) if (BUILDING_PRODUCTION[b.type]) b.cash = Math.max(b.cash, 50);
    }
    if (next.allocation === 'commons') {
      let total = 0;
      for (const hh of s.households) { total += hh.money; hh.money = 0; hh.debt = 0; }
      s.gov.treasury += total;
    }
    sim.log(`The economy now runs on ${next.allocation === 'market' ? 'markets' : next.allocation === 'planned' ? 'central planning' : 'a shared commons'}.`, 'economy');
  }
  if (next.governance !== prev.governance) {
    sim.log(`Governance changed from ${prev.governance} to ${next.governance}.`, 'politics');
    s.gov.termsServed = 0;
    if (next.governance === 'none' || next.governance === 'council') { s.gov.rulingFactionId = null; s.gov.leaderId = null; s.gov.coalition = []; s.gov.parliament = []; s.gov.caretaker = false; }
    else if (s.gov.rulingFactionId == null) {
      const pos = perceivedPosition(next, s.gov.baseline);
      const f = [...s.factions].sort((a, b) => beliefDistance(a.platform, pos) - b.strength * 0.02 - (beliefDistance(b.platform, pos) - a.strength * 0.02))[0];
      if (f) { s.gov.rulingFactionId = f.id; s.gov.leaderId = f.founderId; }
      else { s.policy = next; s.gov.position = pos; createEstablishment(sim); }
    }
    s.gov.lastElection = s.day;
  }
  s.policy = next;
  s.gov.regimeName = regimeName(next);
}
