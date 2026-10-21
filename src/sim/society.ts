import { clamp, lerp } from './rng';
import { DAYS_PER_YEAR, pickSubculture, type Simulation } from './simulation';
import { householdWealth, gini } from './stats';
import { isWorkingJob } from './behavior';
import { seasonOf } from './environment';
import { districtAt } from './districts';
import type { Agent, Beliefs, Current, Faction, Household, SocialClass } from './types';

export const beliefDistance = (a: Beliefs, b: Beliefs) =>
  Math.sqrt((a.econ - b.econ) ** 2 + (a.auth - b.auth) ** 2 + (a.trad - b.trad) ** 2 * 0.6);

export function runSocietyDay(sim: Simulation) {
  const s = sim.state, p = s.policy, c = s.culture;
  const pop = Math.max(1, s.agents.length);
  const countJob = (j: Agent['job']) => s.agents.reduce((n, a) => n + (a.job === j && a.jailedUntil <= s.day ? 1 : 0), 0);
  const kids = s.agents.filter(a => a.age >= 6 && a.age < 18).length;
  const healthcare = clamp((countJob('healer') * 35) / pop);
  const schooling = kids ? clamp((countJob('teacher') * 12) / kids) : 0;
  const higherEd = clamp((countJob('scholar') * 70) / pop);
  const policing = clamp((countJob('guard') * 22) / pop);
  const clergy = clamp((countJob('priest') * 60) / pop);
  const arts = clamp((countJob('artist') * 60) / pop);

  // Relative wealth ranks & social classes
  const wealth = householdWealth(sim);
  const perCap = new Map<number, number>();
  for (const hh of s.households) perCap.set(hh.id, (wealth.get(hh.id) ?? 0) / Math.max(1, hh.members.length));
  const sorted = [...perCap.values()].sort((a, b) => a - b);
  const rankOf = (v: number) => {
    let lo = 0, hi = sorted.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < v) lo = m + 1; else hi = m; }
    let up = lo, top = sorted.length;
    while (up < top) { const m = (up + top) >> 1; if (sorted[m] <= v) up = m + 1; else top = m; }
    // Ties share the mid-rank, so in an equal society nobody is falsely "poorest"
    return sorted.length > 1 ? ((lo + up - 1) / 2) / (sorted.length - 1) : 0.5;
  };
  // Behaviour responds to felt (income) inequality; the wealth Gini is a ledger statistic
  const g = s.gov.incomeGini ?? gini(s.agents.map(a => perCap.get(a.householdId) ?? 0)) * 0.55;

  // Count property ownership per household
  const ownedProps = new Map<number, number>();
  for (const b of s.buildings) {
    if (b.ownerKind === 'private' && b.ownerHouseholdId != null && b.type !== 'house') {
      ownedProps.set(b.ownerHouseholdId, (ownedProps.get(b.ownerHouseholdId) ?? 0) + 1);
    }
  }

  const crimes = runCrime(sim, policing, g, rankOf, perCap);
  const crimeRate = crimes / pop;

  socialize(sim);
  updateCultureDay(sim, g, clergy, arts, higherEd);

  const able = s.agents.filter(a => a.age >= 18 && a.age < 65);
  const unemploymentRate = able.length ? able.filter(a => a.job === 'unemployed').length / able.length : 0;
  const freeRiders = p.allocation === 'commons' ? unemploymentRate : 0;
  const newcomerShare = s.agents.reduce((t, a) => t + ((a.newcomerUntil ?? 0) > s.day ? 1 : 0), 0) / pop;

  for (const a of [...s.agents]) {
    const prevAge = a.age;
    a.age += 1 / DAYS_PER_YEAR;
    const hh = sim.household(a.householdId);
    const homeless = !hh || hh.homeId == null;
    const rank = rankOf(perCap.get(a.householdId) ?? 0);
    const jailed = a.jailedUntil > s.day;
    const props = ownedProps.get(a.householdId) ?? 0;

    // Track unemployment duration & class identity
    if (a.job === 'unemployed' && a.age >= 18 && a.age < 65 && !jailed) {
      a.unemployedDays++;
      // Long-term unemployment erodes job skills
      if (a.unemployedDays > 25) a.skill = clamp(a.skill - 0.0005, 0.1, 1);
    } else {
      a.unemployedDays = Math.max(0, a.unemployedDays - 3);
      if (isWorkingJob(a.job)) a.skill = clamp(a.skill + 0.0003, 0.1, 1);
    }

    a.classIdentity = classifyAgent(a, rank, props, homeless);

    // Education & university
    if (a.age >= 6 && a.age < 18) a.education = clamp(a.education + schooling * 0.0032 + 0.0004);
    else if (a.job === 'student') {
      a.education = clamp(a.education + (0.004 + higherEd * 0.004));
      a.skill = clamp(a.skill + 0.0025);
    }
    if (prevAge < 18 && a.age >= 18) {
      a.skill = clamp(a.skill * 0.65 + a.education * 0.45);
      sim.remember(a, 'Came of age.');
    }

    // Health
    const targetHealth = clamp(1 - Math.max(0, a.age - 45) / 65);
    a.needs.health += (targetHealth - a.needs.health) * 0.04 * (0.3 + 0.7 * healthcare);
    if (a.hungerDays > 3) a.needs.health -= 0.014;
    if (a.unemployedDays > 45) a.needs.health -= 0.004; // despair / stress
    if (sim.rng.chance(0.003)) { a.needs.health -= 0.26 * (1 - healthcare * 0.65); sim.remember(a, 'Fell ill.'); }
    a.needs.health = clamp(a.needs.health);

    // Other needs: rest, social, safety, freedom, purpose, culture
    a.needs.rest = homeless ? 0.42 : jailed ? 0.48 : s.plan.queueHours > 1.5 && p.allocation === 'planned' ? 0.78 : 0.95;
    const inGroup = a.friends.length > 0 ? 0.15 : 0;
    const festivalBoost = c.festivalDaysLeft > 0 ? 0.15 : 0;
    a.needs.social = lerp(a.needs.social, clamp(Math.min(a.friends.length, 6) / 6 * 0.6 + (a.partnerId != null ? 0.25 : 0) + inGroup + festivalBoost), 0.12);
    a.needs.safety = lerp(a.needs.safety, clamp(1 - crimeRate * 24 - a.fear * 0.5 - (homeless ? 0.32 : 0) - (jailed ? 0.4 : 0)), 0.12);

    const libertyCare = clamp(0.55 - a.beliefs.auth * 0.48 + (a.personality.O - 0.5) * 0.3);
    // Low religious freedom bites the devout under secular states, but the secular under a state faith
    const stateFaith = s.gov.position.trad > 0.35 && p.religiousFreedom < 0.4;
    const religiousRestriction = (stateFaith ? a.religiosity < 0.35 : a.religiosity > 0.6) ? (1 - p.religiousFreedom) * 0.45 : 0;
    a.needs.freedom = clamp(1 - (1 - p.civilLiberty) * libertyCare - religiousRestriction - (jailed ? 0.5 : 0));

    // Purpose: meaningful work, study, family, or spiritual/artistic calling; crushed by chronic unemployment
    const workPurpose = isWorkingJob(a.job) || a.job === 'student' ? 0.75 + 0.2 * a.skill : a.job === 'retired' ? 0.72 : a.job === 'child' ? 0.85 : clamp(0.45 - a.unemployedDays * 0.008);
    const faithPurpose = a.religiosity * clergy * (stateFaith ? 1 : p.religiousFreedom) * 0.25;
    a.needs.purpose = lerp(a.needs.purpose, clamp(workPurpose + faithPurpose + (a.children.length ? 0.1 : 0)), 0.12);

    // Cultural & spiritual fulfillment
    const artSat = (arts * 0.55 + p.culturalSubsidy * 0.35 + (sim.buildingsOf('tavern').length ? 0.2 : 0)) + festivalBoost;
    const spiritSat = a.religiosity > 0.4 ? clergy * (stateFaith ? 1 : p.religiousFreedom) * 0.8 : 0.65;
    a.needs.culture = lerp(a.needs.culture, clamp(artSat * 0.6 + spiritSat * 0.4), 0.1);

    // Happiness — relative standing stings more the more unequal the society is
    const envy = (1 - a.personality.A) * 0.45 + 0.2;
    const relative = 0.5 + (rank - 0.5) * envy * (0.55 + 1.6 * g);
    const n = a.needs;
    let h = n.food * 0.24 + n.health * 0.1 + n.comfort * 0.13 + n.social * 0.12 + n.safety * 0.11 + n.freedom * 0.09 + n.purpose * 0.11 + n.culture * 0.06 + relative * 0.12;
    h *= (1 - 0.22 * (a.personality.N - 0.5)) * (0.55 + 0.45 * n.food);
    if (a.job === 'unemployed' && a.age >= 18 && a.age < 65) {
      h -= 0.08 + Math.min(0.18, a.unemployedDays * 0.003);
    }
    a.happiness = lerp(a.happiness, clamp(h), 0.15);

    if (a.age >= 15) {
      const ownsHome = !homeless && sim.building(hh!.homeId)?.ownerHouseholdId === a.householdId;
      driftBeliefs(sim, a, rank, props, crimeRate, g, freeRiders, unemploymentRate, ownsHome, newcomerShare);
    }
    if (s.day % 10 === 0 && a.age >= 18) a.subculture = pickSubculture(a.beliefs, a.personality, a.religiosity);

    // Approval & grievance
    const alignment = 1 - clamp(beliefDistance(a.beliefs, s.gov.position) / 1.25);
    const immobile = Math.max(0, 0.45 - c.socialMobility);
    const fairnessPenalty =
      (a.beliefs.econ < 0 ? g * (-a.beliefs.econ) * 1.0 : p.taxRate * a.beliefs.econ * 0.55 * rank) +
      p.corruption * 0.45 * (a.job === 'official' ? 0 : 1) +
      // "The game is rigged": even market supporters resent steep inequality when upward mobility is dead
      Math.max(0, g - 0.32) * immobile * (1 - rank) * 1.6;
    const delivered = clamp(0.35 + 0.65 * a.needs.food) * (0.85 + 0.15 * a.needs.safety) * (1 - Math.min(0.25, unemploymentRate * 0.45));
    let approval = (0.32 * alignment + 0.32 * a.happiness + 0.18 * clamp(1 - fairnessPenalty * 1.2) + 0.18 * a.needs.freedom) * delivered;
    if (p.governance === 'none' || p.governance === 'council') {
      approval = 0.5 * approval + 0.5 * (0.35 * alignment + 0.65 * a.happiness);
    }
    if (jailed) approval -= 0.32;
    // Negative partisanship: opposition loyalists rate the government poorly even in good times;
    // government partisans give it the benefit of the doubt. Decouples legitimacy from the food supply.
    const govSide = (id: number | null | undefined) => id != null && (id === s.gov.rulingFactionId || s.gov.coalition.includes(id));
    if (a.factionId != null) approval += govSide(a.factionId) ? 0.08 * a.commitment : -0.24 * a.commitment;
    else if (a.votedFor != null) approval += govSide(a.votedFor) ? 0.03 : -0.07;
    // Incumbency fatigue: a regime that has held power for a decade-plus wears out its
    // welcome even in good times — "time for a change" is a real political force
    approval -= Math.min(0.14, ((s.day - s.gov.since) / DAYS_PER_YEAR) * 0.005);
    a.approval = lerp(a.approval, clamp(approval), 0.08);

    let friendGrievance = 0;
    for (const fid of a.friends) friendGrievance += sim.agent(fid)?.grievance ?? 0;
    // Under censorship and informers, people hide dissent even from friends (preference falsification)
    if (a.friends.length) friendGrievance = (friendGrievance / a.friends.length - a.grievance) * 0.018 * (0.5 + 0.5 * p.pressFreedom);

    const deprivation = Math.max(0, g - 0.18) * 1.6 * (1 - rank) * (0.5 + 0.5 * (1 - a.personality.A)) * (Math.max(0, 0.4 - a.beliefs.econ) + immobile * 0.9);
    const unempAnger = a.unemployedDays > 10 ? Math.min(0.025, a.unemployedDays * 0.0005) : 0;
    const debtAnger = hh && hh.debt > 60 * hh.members.length ? 0.008 : 0;
    const queueAnger = p.allocation === 'planned' && s.plan.queueHours > 1.2 ? s.plan.queueHours * 0.004 : 0;

    a.grievance = clamp(
      a.grievance * 0.984 +
      friendGrievance +
      (0.56 - a.approval) * 0.032 +
      (a.hungerDays > 3 ? 0.022 : 0) +
      deprivation * 0.03 +
      unempAnger +
      debtAnger +
      queueAnger +
      // Confiscatory taxes grind on everyone who works for a wage
      (p.taxRate > 0.55 && isWorkingJob(a.job) ? (p.taxRate - 0.5) * 0.06 : 0) +
      // Inflation anger: eroding pay and savings feel like theft even when nominal wages lag
      (s.market.inflationRate > 0.12 ? Math.min(0.05, (s.market.inflationRate - 0.1) * 0.35) : 0) +
      (freeRiders > 0.14 && isWorkingJob(a.job) ? (freeRiders - 0.14) * 0.028 * a.personality.C : 0) +
      // Excluded identifiers never fully settle: committed opposition supporters nurse a
      // permanent low-grade grievance that feeds parties, protests — and someday uprisings
      (a.factionId != null && !govSide(a.factionId) ? 0.007 * a.commitment : a.votedFor != null && !govSide(a.votedFor) ? 0.003 : 0),
    );
    // Ambient fear: informers, censorship and police presence keep a floor under fear in
    // repressive states, felt most by those with something to hide (dissenters)
    const ambientFear = (1 - p.civilLiberty) * p.enforcement * 0.55 * (0.5 + 0.5 * (1 - p.pressFreedom)) * (0.6 + 0.8 * Math.min(1, a.grievance * 2));
    a.fear = clamp(Math.max(a.fear * 0.97, ambientFear));
  }

  runEpidemics(sim, healthcare);
  runCurrents(sim);
  runDemographics(sim, healthcare);
  s.gov.legitimacy = (() => {
    const adults = s.agents.filter(a => a.age >= 18);
    const mean = adults.length ? adults.reduce((t, a) => t + a.approval, 0) / adults.length : 0;
    // A caretaker cabinet governs without a mandate — authority bleeds steadily
    return clamp(mean - (s.gov.caretaker ? 0.07 : 0));
  })();
}

function classifyAgent(a: Agent, rank: number, props: number, homeless: boolean): SocialClass {
  // Owning a family farm/workshop makes you a proprietor, not elite —
  // elite means real capital: top-decile wealth (which already counts owned
  // buildings), multiple prosperous properties, finance, or senior state power
  const capitalist = props >= 2 && rank > 0.7;
  if (capitalist || rank > 0.88 || a.job === 'banker' || (a.job === 'official' && rank > 0.7)) return 'elite';
  if (homeless || a.unemployedDays > 25 || rank < 0.16) return 'underclass';
  if (props > 0 || rank > 0.58 || a.job === 'scholar' || a.job === 'healer' || a.job === 'teacher' || a.job === 'merchant' || a.job === 'clerk') return 'middle';
  return 'working';
}

/**
 * Realistic ideological dynamics that preserve pluralism and prevent everyone from converging to identical clones:
 * 1. Each person has an innate + upbringing `disposition` anchor.
 * 2. Each person's material life station (class, job, property, faith, personality) defines a distinct equilibrium target.
 * 3. Bounded-confidence peer interaction: similar friends gently converge, while encountering very different views produces differentiation/backlash.
 * 4. Regime experience: when the current system fails (shortages, inflation, unemployment, repression), citizens react against the regime's ideology.
 */
function driftBeliefs(
  sim: Simulation,
  a: Agent,
  rank: number,
  props: number,
  crimeRate: number,
  giniNow: number,
  freeRiders: number,
  unemploymentRate: number,
  ownsHome: boolean,
  newcomerShare: number,
) {
  const s = sim.state, p = s.policy, c = s.culture;
  const b = a.beliefs;
  const d = a.disposition;
  // How much citizens can learn about alternatives / blame the system rather than "saboteurs"
  const info = 0.35 + 0.65 * p.pressFreedom;
  // Hedonic adaptation: hardship is measured against what people are used to, not an absolute ideal
  const norm = c.comfortNorm >= 0 ? c.comfortNorm : a.needs.comfort;
  const comfortShock = Math.max(0, norm - a.needs.comfort);

  // 1. Equilibrium target for this specific person's disposition + social role
  // Identity (disposition) is the strongest anchor; material position shifts people around it.
  // The class terms below are balanced so they polarise without biasing the society as a whole.
  // (weight 1.0: any weight < 1 silently shrinks every citizen toward zero and dissolves a
  // society's founding lean within two generations)
  let targetEcon = d.econ + (rank - 0.5) * 0.45 + (a.personality.C - a.personality.A) * 0.2;
  // Property pulls right proportional to its scale: a capitalist defends the
  // whole order, a family farmer just wants to keep the farm
  if (props > 0) targetEcon += a.classIdentity === 'elite' ? 0.25 : 0.08;
  if (ownsHome) targetEcon += 0.08; // homeowners acquire a stake in property rights
  if (a.job === 'merchant' || a.job === 'banker') targetEcon += 0.25;
  else if (a.job === 'miner' || a.job === 'factory_worker' || a.job === 'lumberjack') targetEcon -= 0.2;
  else if (a.job === 'scholar' || a.job === 'artist') targetEcon -= 0.12;
  // Working-class solidarity (unions, neighbourhoods) scaled by class consciousness
  if (a.classIdentity === 'working' || a.classIdentity === 'underclass') targetEcon -= 0.1 * (0.5 + c.classConsciousness);

  // Material grievances under the current allocation system (filtered through what people can know)
  let experience = 0;
  if (p.allocation === 'market') {
    // Hunger radicalises in proportion to its depth; so does long joblessness
    if (a.needs.food < 0.65) experience -= 0.2 + (0.65 - a.needs.food) * 0.55;
    if (a.unemployedDays > 12) experience -= Math.min(0.3, a.unemployedDays * 0.012);
    // Inequality polarises: the bottom of an unequal society radicalises left (amplified by class
    // consciousness), while the propertied harden into market-and-order conservatism.
    if (giniNow > 0.34 && rank < 0.45) experience -= (giniNow - 0.3) * (0.45 - rank) * 3.0 * (0.6 + c.classConsciousness);
    if (rank > 0.6 && p.taxRate > 0.3) targetEcon += (p.taxRate - 0.25) * 0.5; // high earners resent heavy taxes
    // Once rates turn confiscatory the squeeze spreads down the ladder: wage earners
    // whose take-home shrinks blame the taxing state, not just the market order.
    if (p.taxRate > 0.5 && isWorkingJob(a.job)) experience += (p.taxRate - 0.45) * (0.25 + rank) * 0.9;
    if (s.market.inflationRate > 0.12) experience += 0.2;
    // Welfare dependence breeds support for the welfare state
    if (a.job === 'unemployed' && p.welfare > 0.35) experience -= (p.welfare - 0.3) * 0.3;
  } else if (p.allocation === 'planned') {
    // Shortages push citizens toward markets — but chronic scarcity people grew up with stings far
    // less than a sudden collapse, and queues only anger once they exceed an hour
    const shortagePain = comfortShock * 0.8 + (1 - a.needs.comfort) * 0.12 + Math.max(0, s.plan.queueHours - 1) * 0.1 + (1 - a.needs.food) * 0.5;
    if (a.job === 'official') targetEcon -= 0.28;
    else experience += shortagePain;
  } else {
    // Commons: conscientious workers resent free-riders and drift toward market incentives
    if (freeRiders > 0.1 && isWorkingJob(a.job)) experience += (freeRiders - 0.08) * 1.1 * a.personality.C;
    if (a.needs.comfort < 0.55) experience += 0.25 * (comfortShock > 0.05 ? 1 : 0.5);
  }
  targetEcon += experience * info;
  // Public goods that visibly work build support for the state that provides them
  if (p.publicServices > 0.5) targetEcon -= (p.publicServices - 0.45) * 0.2 * a.needs.health;
  // Thermostatic public opinion: when policy runs ahead of the public, the public pulls back
  targetEcon += (c.beliefCenter.econ - s.gov.position.econ) * 0.1 * info;
  // Media ownership: privately owned press in an unequal society leans toward its proprietors
  if (p.ownership === 'private' && p.pressFreedom > 0.4) targetEcon += Math.max(0, giniNow - 0.32) * 0.15 * p.pressFreedom;

  // Reactionary currents — forces that pull a society back toward order, property
  // and custom when the tide runs the other way. Public-opinion trends are read
  // from the stats record (~8 months back); street unrest is today's militancy.
  const stNow = s.stats.at(-1), stPast = s.stats.at(-Math.min(s.stats.length, 240));
  const trendSpan = stNow && stPast ? stNow.day - stPast.day : 0;
  const econTrend = trendSpan > 60 && stNow && stPast ? stNow.econ - stPast.econ : 0; // <0 = public moving left
  const tradTrend = trendSpan > 60 && stNow && stPast ? stNow.trad - stPast.trad : 0; // <0 = moving progressive
  const street = (s.day - s.gov.lastRiot < 120 ? 0.5 : 0)
    + s.factions.reduce((t, f) => t + (f.protestToday ? 0.12 : 0) + (f.strikeToday ? 0.1 : 0), 0);

  // Expropriation fear: a left-leaning government or a leftward-surging public
  // threatens property — owners dig in rightward in proportion to their stake,
  // and the merely rich fear redistribution too
  const leftThreat = Math.max(0, -(s.gov.position.econ + 0.1)) * 0.6 + Math.max(0, -econTrend) * 1.6;
  if (leftThreat > 0.02) {
    if (props > 0) targetEcon += Math.min(0.35, leftThreat * (0.1 + props * 0.05));
    else if (rank > 0.6) targetEcon += Math.min(0.15, leftThreat * 0.15);
  }
  // Street politics reads to the comfortable as left militancy
  if (street > 0.1 && rank > 0.3) targetEcon += Math.min(0.12, street * 0.07);

  // Regime loyalty: the nomenklatura (officials, guards, committed cadres) owes its position to the
  // regime's doctrine and is socialised into it
  const ruling = sim.faction(s.gov.rulingFactionId);
  const autocratic = p.governance === 'autocracy' || p.governance === 'monarchy';
  let loyalty = 0;
  if (autocratic && ruling) {
    if (a.id === s.gov.leaderId) loyalty = 0.55;
    else if (a.factionId === ruling.id) loyalty = 0.2 + a.commitment * 0.35;
    else if (a.job === 'official' || a.job === 'guard') loyalty = 0.25;
  }
  targetEcon = clamp(lerp(targetEcon, ruling?.founding.econ ?? targetEcon, loyalty), -0.98, 0.98);

  let targetAuth = d.auth + (a.personality.C - a.personality.O) * 0.25 + (a.religiosity - 0.5) * 0.2;
  if (a.job === 'guard' || a.job === 'official') targetAuth += 0.35;
  // Besieged elites demand order; the dispossessed in a rigid society lose faith in the rules
  if (giniNow > 0.42 && rank > 0.7) targetAuth += (giniNow - 0.34) * 0.6;
  if (giniNow > 0.46 && rank < 0.3 && s.culture.socialMobility < 0.35) targetAuth -= 0.15;
  if (a.job === 'artist' || a.job === 'scholar' || a.subculture === 'bohemian') targetAuth -= 0.3;
  // Security thermostat: insecurity breeds demand for order — but sustained safety
  // lets liberty feel affordable again, so the axis can swing back down
  targetAuth += Math.min(0.38, Math.max(0, 0.75 - a.needs.safety) * 0.9 + Math.max(0, crimeRate - 0.003) * 25);
  targetAuth -= Math.min(0.07, Math.max(0, a.needs.safety - 0.8) * (0.3 + a.personality.O * 0.4));
  if (p.governance === 'none' && crimeRate > 0.005) targetAuth += 0.32;
  if (a.jailedUntil > s.day) targetAuth -= 0.45;
  if (p.civilLiberty < 0.45 && a.fear < 0.45) targetAuth -= (0.5 - p.civilLiberty) * 0.55 * a.personality.O * info; // reactance against repression
  // Regime experience: a heavy-handed government that delivers earns consent for
  // its order; one that keeps cracking down while failing teaches its citizens to
  // resent the boot. Grows with tenure, swings both ways.
  const govAuth = s.gov.position.auth;
  if (govAuth > 0.15) {
    const tenure = Math.min(1, (s.day - s.gov.since) / (8 * DAYS_PER_YEAR));
    const delivered = 0.3 + 0.35 * a.needs.food + 0.35 * a.happiness;
    targetAuth += govAuth * (delivered - 0.55) * 0.32 * tenure;
  }
  // Youth counterculture: the young chafe against the regime they grew up under
  if (a.age < 26) targetAuth -= Math.sign(govAuth) * Math.min(0.1, Math.abs(govAuth) * 0.25);
  targetAuth += (c.beliefCenter.auth - s.gov.position.auth) * 0.08 * info;
  // Modernisation: under an authoritarian state, an educated middle class demands a say (Lipset).
  // Once they have it, this pressure is spent — it doesn't keep pushing a democracy libertarian.
  if ((a.classIdentity === 'middle' || a.education > 0.6) && s.gov.position.auth > 0.2) targetAuth -= (a.education - 0.4) * 0.25;
  // Authoritarian populism: less-educated, traditional, insecure citizens want a strong hand
  const insecure = a.unemployedDays > 10 || rank < 0.35 || crimeRate > 0.006;
  if (a.education < 0.45 && a.beliefs.trad > 0.15 && insecure) targetAuth += 0.22;
  // Democratic instability → appetite for a strong hand. A faltering democracy
  // (low legitimacy, jobs crisis, personal grievance) breeds voters willing to
  // trade liberty for order — without it the auth axis only ever drifts down in
  // prosperous democracies
  if (!autocratic && p.governance !== 'none') {
    targetAuth += Math.max(0, 0.52 - s.gov.legitimacy) * 0.35;             // failing government
    targetAuth += Math.max(0, unemploymentRate - 0.06) * 0.9;              // jobs crisis
    targetAuth += Math.min(0.18, a.grievance * 0.3 * (a.beliefs.trad > 0 ? 1.3 : 0.8)); // aggrieved → order appeal
    // Agenda-setting: a credible strong-hand opposition drags the whole Overton
    // window toward order, even for citizens who never join it
    const challenger = s.factions.reduce<Faction | null>((m, f) => f.id !== s.gov.rulingFactionId && f.strength > (m?.strength ?? 0) ? f : m, null);
    if (challenger && challenger.strength > 0.12 && challenger.platform.auth > b.auth + 0.12) {
      targetAuth += Math.min(0.14, (challenger.platform.auth - b.auth) * 0.06 * (challenger.strength * 4));
    }
  }

  let targetTrad = d.trad + (a.religiosity - 0.45) * 0.4 + (a.age > 50 ? 0.22 : a.age < 26 ? -0.18 : 0) - (a.education - 0.5) * 0.28;
  if (a.job === 'priest' || a.job === 'farmer') targetTrad += 0.25;
  if (a.job === 'artist' || a.job === 'scholar' || a.job === 'student') targetTrad -= 0.28;
  if (crimeRate > 0.008) targetTrad += 0.12; // disorder breeds law-and-order traditionalism
  if (a.children.length >= 2) targetTrad += 0.06; // parenthood nudges toward family values

  // Unrest backlash: riots and street militancy frighten everyone toward order —
  // the settled most of all, but even the poor don't like burning streets
  if (street > 0.1) targetAuth += Math.min(0.3, street * 0.2 * (0.35 + rank * 0.65));

  // Cultural backlash: when values shift progressive quickly, the religious, the old
  // and the less educated feel the country slipping away and dig in
  if (tradTrend < -0.02) {
    targetTrad += Math.min(0.3, -tradTrend * (a.religiosity * 1.1 + (a.age > 45 ? 0.45 : 0) + (a.education < 0.4 ? 0.3 : 0)));
  }

  // Newcomer pressure: a large recent inflow of outsiders makes natives defensive
  // of custom and order (newcomers assimilate over ~10 years)
  if (newcomerShare > 0.04 && (a.newcomerUntil ?? 0) <= s.day) {
    const defensive = Math.min(0.2, (newcomerShare - 0.04) * 1.8);
    targetTrad += defensive * (0.4 + a.religiosity * 0.5 + (a.age > 45 ? 0.2 : 0));
    targetAuth += defensive * a.personality.C * 0.7;
  }

  // Party identity: members take cues from their party's line (partisan sorting), so committed
  // supporters converge on — and reinforce — their party's distinct position
  const own = loyalty === 0 ? sim.faction(a.factionId) : undefined;
  const cue = own ? 0.35 * a.commitment : 0;
  targetEcon = clamp(lerp(targetEcon, own?.platform.econ ?? 0, cue), -0.98, 0.98);
  targetAuth = clamp(lerp(lerp(targetAuth, own?.platform.auth ?? 0, cue), ruling?.founding.auth ?? targetAuth, loyalty), -0.98, 0.98);
  targetTrad = clamp(lerp(lerp(targetTrad, own?.platform.trad ?? 0, cue), ruling?.founding.trad ?? targetTrad, loyalty * 0.6), -0.98, 0.98);

  // Neighbourhood politics: each district has its own colour — set by its industry,
  // class and distance from the civic core — and residents drift toward the local
  // consensus. A mill ward and a temple ward can sit side by side and pull apart.
  const homeB = sim.building(sim.household(a.householdId)?.homeId);
  const dd = homeB ? districtAt(sim, homeB.pos) : undefined;
  if (dd) {
    targetEcon += dd.pull.econ + (dd.lean.econ - b.econ) * 0.05;
    targetAuth += dd.pull.auth + (dd.lean.auth - b.auth) * 0.05;
    targetTrad += dd.pull.trad + (dd.lean.trad - b.trad) * 0.05;
  }

  // Social currents: passing panics, revivals and crazes tug the susceptible —
  // the open, the young — along their axis before they fade
  for (const cur of s.currents ?? []) {
    const susc = currentSusceptibility(a);
    if (susc <= 0) continue;
    targetEcon += cur.econ * susc;
    targetAuth += cur.auth * susc;
    targetTrad += cur.trad * susc;
    if (cur.grievance) a.grievance = clamp(a.grievance + cur.grievance * 0.02 * susc);
  }

  // Formative years: people aged 15–25 permanently absorb the shocks of their youth (hardship,
  // shortages, disorder, repression), so crisis cohorts carry distinct politics for life — a
  // childhood spent in famine leaves a durable mark. Only the experiences are imprinted — not the
  // structural pull — so societies don't converge on one point.
  if (a.age < 25) {
    const disorder = crimeRate > 0.008 || a.needs.safety < 0.6 ? 0.3 : 0;
    const repression = p.civilLiberty < 0.45 && a.fear < 0.45 ? -(0.5 - p.civilLiberty) * a.personality.O * info : 0;
    d.econ = clamp(d.econ + experience * info * 0.001, -1, 1);
    d.auth = clamp(d.auth + (disorder + repression) * 0.0009, -1, 1);
  }

  // Move gently toward personal equilibrium — adult convictions are sticky
  const rate = (a.age < 26 ? 0.016 : a.age > 55 ? 0.004 : 0.008) * (a.id === s.gov.leaderId ? 0.4 : 1);
  let de = (targetEcon - b.econ) * rate;
  let da = (targetAuth - b.auth) * rate;
  let dt = (targetTrad - b.trad) * rate;

  // 2. Bounded-confidence social influence (Hegselmann-Krause / Jager-Amblard model):
  // Friends with nearby beliefs pull you closer; exposure to distant beliefs causes differentiation so society forms distinct clusters instead of a single blob.
  if (a.friends.length) {
    let pe = 0, pa = 0, pt = 0;
    for (const id of a.friends) {
      const f = sim.agent(id);
      if (!f) continue;
      const dist = beliefDistance(b, f.beliefs);
      if (dist < 0.65) {
        pe += (f.beliefs.econ - b.econ) * 0.003;
        pa += (f.beliefs.auth - b.auth) * 0.003;
        pt += (f.beliefs.trad - b.trad) * 0.003;
      } else if (dist > 1.15) {
        pe -= (f.beliefs.econ - b.econ) * 0.0015;
        pa -= (f.beliefs.auth - b.auth) * 0.0015;
      }
    }
    de += pe / a.friends.length;
    da += pa / a.friends.length;
    dt += pt / a.friends.length;
  }

  // 3. State propaganda vs. regime failure backlash
  const regimeSuccess = (a.happiness - 0.58) - unemploymentRate * 0.35;
  const prop = (1 - p.civilLiberty) * 0.0025 * (a.fear * 0.6 + (1 - a.personality.O) * 0.4) + regimeSuccess * 0.004;
  de += (s.gov.position.econ - b.econ) * prop;
  da += (s.gov.position.auth - b.auth) * prop;
  dt += (s.gov.position.trad - b.trad) * prop;

  b.econ = clamp(b.econ + de, -1, 1);
  b.auth = clamp(b.auth + da, -1, 1);
  b.trad = clamp(b.trad + dt, -1, 1);
}

function updateCultureDay(sim: Simulation, giniNow: number, clergy: number, arts: number, higherEd: number) {
  const s = sim.state, c = s.culture, p = s.policy;
  const adults = sim.adults();
  if (!adults.length) return;

  if (c.festivalDaysLeft > 0) c.festivalDaysLeft--;
  // Annual harvest / civic festival if treasury or community spirit supports it
  // (stochastic: depends on community spirit, funding, faith and whether the harvest came in —
  // not a guaranteed yearly happiness pump)
  const fed = adults.reduce((t, a) => t + a.needs.food, 0) / adults.length;
  const festivalOdds = clamp(0.1 + c.cohesion * 0.3 + p.culturalSubsidy * 0.35 + c.religiosity * 0.15 + (p.allocation === 'commons' ? 0.15 : 0) - (fed < 0.75 ? 0.45 : 0));
  if (s.day % 30 === 15 && c.festivalDaysLeft === 0 && sim.rng.chance(festivalOdds)) {
    c.festivalDaysLeft = 3;
    for (const a of s.agents) { a.happiness = clamp(a.happiness + 0.06); a.grievance = Math.max(0, a.grievance - 0.04); }
    sim.log('The town celebrates a three-day seasonal festival in the plaza.', 'culture', undefined, { kind: 'festival' });
  }

  // Cultural traits evolve gradually from institutions and demographics
  const meanEcon = adults.reduce((t, a) => t + a.beliefs.econ, 0) / adults.length;
  const meanAuth = adults.reduce((t, a) => t + a.beliefs.auth, 0) / adults.length;
  const meanTrad = adults.reduce((t, a) => t + a.beliefs.trad, 0) / adults.length;
  c.beliefCenter = { econ: meanEcon, auth: meanAuth, trad: meanTrad };

  // Expectations adapt over ~8 years; the founding generation takes current conditions as normal
  const meanComfort = adults.reduce((t, a) => t + a.needs.comfort, 0) / adults.length;
  c.comfortNorm = c.comfortNorm < 0 || s.day < 20 ? meanComfort : lerp(c.comfortNorm, meanComfort, 0.004);

  const varE = adults.reduce((t, a) => t + (a.beliefs.econ - meanEcon) ** 2, 0) / adults.length;
  const varA = adults.reduce((t, a) => t + (a.beliefs.auth - meanAuth) ** 2, 0) / adults.length;
  c.beliefSpread = Math.sqrt((varE + varA) / 2);

  c.religiosity = lerp(c.religiosity, clamp(c.religiosity + (clergy * p.religiousFreedom - 0.35) * 0.01 - higherEd * 0.008), 0.05);
  c.artisticSpirit = lerp(c.artisticSpirit, clamp(0.3 + arts * 0.45 + p.culturalSubsidy * 0.3 + p.civilLiberty * 0.15), 0.05);
  c.classConsciousness = lerp(c.classConsciousness, clamp(giniNow * 1.5 + (p.ownership === 'private' ? 0.15 : -0.1)), 0.05);
  c.socialMobility = lerp(c.socialMobility, clamp(0.4 + p.publicServices * 0.4 + (1 - p.inheritance) * 0.25 - giniNow * 0.6), 0.05);
  c.cohesion = lerp(
    c.cohesion,
    clamp(0.5 + c.trust * 0.35 + (c.festivalDaysLeft > 0 ? 0.15 : 0) - c.beliefSpread * 0.35 - giniNow * 0.45),
    0.06,
  );
}

function socialize(sim: Simulation) {
  const rng = sim.rng;
  const groups: number[][] = [...sim.gatherings.values()];
  for (const b of sim.state.buildings) if (b.workers.length > 1) groups.push(b.workers);
  for (const g of groups) {
    const tries = Math.min(6, Math.floor(g.length / 2));
    for (let t = 0; t < tries; t++) {
      const x = sim.agent(rng.pick(g)), y = sim.agent(rng.pick(g));
      if (!x || !y || x === y || x.friends.includes(y.id) || x.friends.length >= 8 || y.friends.length >= 8) continue;
      const sameClass = x.classIdentity === y.classIdentity ? 0.15 : -0.05;
      const sameSub = x.subculture === y.subculture ? 0.15 : 0;
      // Homophily: people mostly befriend the like-minded (and fellow party members), which lets
      // ideological communities — including radical milieus — sustain themselves
      const sameParty = x.factionId != null && x.factionId === y.factionId ? 0.2 : 0;
      const compat = 1 - beliefDistance(x.beliefs, y.beliefs) / 1.5 + (x.personality.E + y.personality.E) * 0.15 + sameClass + sameSub + sameParty;
      if (rng.chance(0.22 * clamp(compat))) { x.friends.push(y.id); y.friends.push(x.id); }
    }
  }
  for (const a of sim.state.agents) {
    if (a.friends.length && rng.chance(0.004 * a.friends.length)) {
      const idx = rng.int(0, a.friends.length - 1);
      const f = sim.agent(a.friends[idx]);
      // Political falling-outs: friendships across a wide ideological gap are likelier to end
      if (f && beliefDistance(a.beliefs, f.beliefs) < 0.5 && rng.chance(0.6)) continue;
      a.friends.splice(idx, 1);
      if (f) f.friends = f.friends.filter(x => x !== a.id);
    }
  }
}

function runCrime(sim: Simulation, policing: number, giniNow: number, rankOf: (v: number) => number, perCap: Map<number, number>): number {
  const s = sim.state, p = s.policy, rng = sim.rng;
  let crimes = 0;
  const deterrence = clamp(policing * 0.7 + p.enforcement * 0.3);
  const households = s.households;
  for (const a of [...s.agents]) {
    if (a.age < 15 || a.jailedUntil > s.day) continue;
    const hh = sim.household(a.householdId);
    // Chronic unemployment, homelessness, hunger, unpaid debt — and relative deprivation in an
    // unequal society — sharply raise crime
    const unempFactor = a.unemployedDays > 8 ? Math.min(0.65, a.unemployedDays * 0.015) : 0;
    const relDeprivation = Math.max(0, giniNow - 0.2) * (1 - rankOf(perCap.get(a.householdId) ?? 0)) * 0.9;
    const desperation = (1 - a.needs.food) + unempFactor + relDeprivation + (hh && hh.homeId == null ? 0.28 : 0) + a.grievance * 0.22;
    const chance = 0.0042 * desperation * (1.2 - a.personality.A) * (1.3 - a.personality.C) * (1 - deterrence * 0.82);
    if (!rng.chance(chance)) continue;
    const victim = rng.pick(households);
    if (!victim || victim === hh) continue;
    crimes++;
    const loot = Math.min(victim.money * 0.2, 42);
    const food = Math.min(victim.food * 0.3, 4);
    victim.money -= loot; victim.food -= food;
    if (hh) { hh.money += loot; hh.food += food; }
    for (const id of victim.members) {
      const v = sim.agent(id);
      if (v) { v.needs.safety = clamp(v.needs.safety - 0.22); v.beliefs.auth = clamp(v.beliefs.auth + 0.018, -1, 1); }
    }
    const caught = rng.chance(0.12 + 0.62 * policing * p.enforcement);
    if (caught && p.governance !== 'none' && policing > 0) {
      a.jailedUntil = s.day + Math.round(4 + 14 * p.enforcement);
      sim.remember(a, 'Imprisoned for theft.');
      a.grievance = clamp(a.grievance + 0.1);
    } else if (caught && hh) {
      hh.money -= loot; victim.money += loot;
      sim.remember(a, 'Caught stealing by neighbours.');
    }
    if (rng.chance(0.018)) {
      const v = sim.agent(rng.pick(victim.members));
      if (v && v.age > 14) { sim.log(`${v.name} was killed during a robbery.`, 'crime', v.id); sim.killAgent(v, 'murdered'); }
    }
  }
  s.counters.crimes += crimes;
  return crimes;
}

// ---------------------------------------------------------------- social currents
// Passing moods, panics, revivals and crazes that tug public opinion along an axis
// for weeks, then fade — the sudden swings that keep a society from standing still.

interface CurrentDef {
  id: string;
  label: string;
  text: (sim: Simulation) => string;
  weight: number;
  /** Days before the same current can return. */
  cooldown: number;
  econ?: number;
  auth?: number;
  trad?: number;
  grievance?: number;
  days: [number, number];
  cond?: (sim: Simulation) => boolean;
}

const CURRENT_DEFS: CurrentDef[] = [
  { id: 'hoarding', label: 'speculator outrage', econ: -0.3, grievance: 0.25, days: [25, 45], cooldown: 240, weight: 2,
    cond: sim => sim.state.policy.allocation === 'market' && (sim.state.gov.incomeGini ?? 0) > 0.38,
    text: () => 'Rumours spread that grain speculators are hoarding while bread prices climb — anger at the merchants boils.' },
  { id: 'mill_disaster', label: 'industrial disaster', econ: -0.22, grievance: 0.2, days: [20, 40], cooldown: 300, weight: 1.4,
    cond: sim => sim.buildingsOf('factory').length + sim.buildingsOf('mine').length > 0,
    text: sim => (sim.buildingsOf('mine').length > 0 && sim.rng.chance(0.5)
      ? 'A mine collapse kills several workers — outrage spreads over the owners\' neglect.'
      : 'A workshop fire kills several workers — outrage spreads over the owners\' neglect.') },
  { id: 'caravan', label: 'merchant prosperity', econ: 0.26, days: [25, 45], cooldown: 200, weight: 1.6,
    cond: sim => sim.state.policy.ownership !== 'collective',
    text: () => 'A merchant caravan dazzles the market with exotic goods — everyone talks of trade and opportunity.' },
  { id: 'invention', label: 'workshop invention', econ: 0.2, trad: -0.1, days: [20, 40], cooldown: 280, weight: 1,
    text: () => 'A clever new device from the workshops has the town talking of progress and ingenuity.' },
  { id: 'raiders', label: 'bandit scare', auth: 0.3, grievance: 0.12, days: [25, 50], cooldown: 220, weight: 1.8,
    text: () => 'Bandits waylay travellers on the roads — frightened folk demand a strong hand.' },
  { id: 'plot', label: 'uncovered plot', auth: 0.26, grievance: 0.1, days: [20, 40], cooldown: 260, weight: 1.2,
    cond: sim => sim.state.policy.governance !== 'none',
    text: () => 'Word spreads that a conspiracy against the town was narrowly foiled — fear of chaos grips the streets.' },
  { id: 'pamphlet', label: 'underground pamphlet', auth: -0.28, days: [25, 50], cooldown: 200, weight: 1.8,
    cond: sim => sim.state.policy.governance !== 'none',
    text: () => 'A forbidden pamphlet passes hand to hand, lampooning the powers that be.' },
  { id: 'martyr', label: 'martyred dissident', auth: -0.32, grievance: 0.3, days: [30, 60], cooldown: 360, weight: 1.5,
    cond: sim => sim.state.policy.enforcement > 0.45,
    text: () => 'A dissident dies in custody — the name is whispered in every tavern.' },
  { id: 'preacher', label: 'revival preacher', trad: 0.3, days: [30, 60], cooldown: 220, weight: 2,
    cond: sim => sim.state.culture.religiosity > 0.3,
    text: () => 'A travelling preacher packs the square nightly — a tide of piety sweeps the town.' },
  { id: 'miracle', label: 'miracle tale', trad: 0.2, auth: 0.08, days: [20, 40], cooldown: 300, weight: 1,
    cond: sim => sim.state.culture.religiosity > 0.4,
    text: () => 'Tales of a miraculous sign at the shrine spread — the devout feel vindicated.' },
  { id: 'players', label: 'scandalous players', trad: -0.24, days: [20, 40], cooldown: 240, weight: 1.6,
    cond: sim => sim.state.policy.religiousFreedom > 0.3,
    text: () => 'Travelling players mock clergy and custom on the stage — the young delight, the elders fume.' },
  { id: 'new_ideas', label: 'ideas from abroad', trad: -0.28, auth: -0.12, days: [30, 55], cooldown: 280, weight: 1.4,
    text: () => 'Books, fashions and strange notions from abroad unsettle old certainties.' },
  { id: 'nativist', label: 'nativist mood', trad: 0.18, auth: 0.14, grievance: 0.1, days: [25, 50], cooldown: 260, weight: 1.2,
    cond: sim => sim.state.agents.filter(a => (a.newcomerUntil ?? 0) > sim.state.day).length / Math.max(1, sim.state.agents.length) > 0.03,
    text: () => 'Grumbling spreads about outsiders taking work and changing the town\'s ways.' },
  { id: 'strike_wave', label: 'union fever', econ: -0.18, auth: -0.08, grievance: 0.15, days: [25, 45], cooldown: 280, weight: 1.3,
    cond: sim => (sim.state.gov.incomeGini ?? 0) > 0.36,
    text: () => 'Word of organised workers in other towns has labourers talking of their own strength.' },
  { id: 'gold_fever', label: 'gold fever', econ: 0.16, grievance: -0.08, days: [15, 30], cooldown: 340, weight: 0.8,
    text: () => 'A rumour of easy fortunes in the hills has the young and restless dreaming.' },
  { id: 'downturn', label: 'hard times', grievance: 0.3, days: [30, 60], cooldown: 300, weight: 1.6,
    cond: sim => sim.state.policy.allocation === 'market',
    text: () => 'Orders dry up and wages stall — hard times bite across the town.' },
];

function runCurrents(sim: Simulation) {
  const s = sim.state;
  s.currents ??= [];
  s.currentCooldowns ??= {};
  for (const c of s.currents) c.daysLeft--;
  s.currents = s.currents.filter(c => c.daysLeft > 0);
  if (s.currents.length >= 3) return;
  const pop = Math.max(1, s.agents.length);
  if (!sim.rng.chance((1 / 32) * Math.min(2, pop / 300))) return;
  const pool = CURRENT_DEFS.filter(d => (s.currentCooldowns![d.id] ?? -9999) <= s.day && (!d.cond || d.cond(sim)));
  if (!pool.length) return;
  let r = sim.rng.next() * pool.reduce((t, d) => t + d.weight, 0);
  let def = pool[0];
  for (const d of pool) { r -= d.weight; if (r <= 0) { def = d; break; } }
  const cur = { id: def.id, label: def.label, econ: def.econ ?? 0, auth: def.auth ?? 0, trad: def.trad ?? 0, grievance: def.grievance ?? 0, daysLeft: sim.rng.int(def.days[0], def.days[1]) };
  s.currents.push(cur);
  s.currentCooldowns![def.id] = s.day + def.cooldown;
  if (cur.grievance) for (const a of s.agents) a.grievance = clamp(a.grievance + cur.grievance * 0.12 * currentSusceptibility(a));
  sim.log(def.text(sim), 'culture');
}

/** How much a social current moves a given citizen — the open and the young are swayed most. */
function currentSusceptibility(a: Agent): number {
  return Math.max(0, 0.35 + a.personality.O * 0.5 + (a.age < 25 ? 0.2 : a.age > 55 ? -0.12 : 0));
}

/** Force a current (used by interventions): a big one-day shove of public opinion. */
export function startCurrent(sim: Simulation, id: string, scale = 1) {
  const def = CURRENT_DEFS.find(d => d.id === id);
  if (!def) return;
  const s = sim.state;
  s.currents ??= [];
  const cur: Current = { id, label: def.label, econ: (def.econ ?? 0) * scale, auth: (def.auth ?? 0) * scale, trad: (def.trad ?? 0) * scale, grievance: (def.grievance ?? 0) * scale, daysLeft: sim.rng.int(def.days[0], def.days[1]) };
  const i = s.currents.findIndex(c => c.id === id);
  if (i >= 0) s.currents[i] = cur; else s.currents.push(cur);
}

// ---------------------------------------------------------------- epidemics

const FEVERS = ['grey fever', 'marsh ague', 'sweating sickness', 'river flux', 'winter cough', 'spotted fever', 'red rash'];

/** Begin an outbreak with `seeds` initial cases (also used by the Plague intervention). */
export function seedEpidemic(sim: Simulation, seeds: number, virulence: number) {
  const s = sim.state, rng = sim.rng;
  const pool = s.agents.filter(a => (a.sickUntil ?? 0) <= s.day && (a.immuneUntil ?? 0) <= s.day);
  if (!pool.length) return 0;
  if (!s.epidemic?.active) s.epidemic = { active: true, name: rng.pick(FEVERS), startDay: s.day, cases: 0, peak: 0, deaths: 0, virulence };
  else s.epidemic.virulence = Math.max(s.epidemic.virulence, virulence);
  let n = 0;
  for (const a of rng.shuffle(pool).slice(0, seeds)) { a.sickUntil = s.day + rng.int(6, 12); n++; }
  return n;
}

/**
 * Contagion that actually spreads: through households, friendships and workplaces. Outbreaks
 * emerge on their own — likelier in winter, in crowded homes, among the hungry and where
 * healers are scarce — and burn out as survivors become immune. Healthcare slows transmission
 * and blunts the illness; deaths come through the usual frailty channels.
 */
function runEpidemics(sim: Simulation, healthcare: number) {
  const s = sim.state, rng = sim.rng, day = s.day;
  const pop = Math.max(1, s.agents.length);
  if (!s.epidemic?.active) {
    const season = seasonOf(day);
    const seasonal = season === 'winter' ? 1 : season === 'autumn' ? 0.45 : 0.15;
    const hungry = s.agents.reduce((t, a) => t + (a.hungerDays > 3 ? 1 : 0), 0) / pop;
    const homeless = s.households.reduce((t, h) => t + (h.homeId == null ? h.members.length : 0), 0) / pop;
    const odds = 0.0016 * seasonal * (1 + hungry * 5 + homeless * 4) * (1 - healthcare * 0.6) * Math.min(2, pop / 300);
    if (pop >= 20 && rng.chance(odds)) {
      seedEpidemic(sim, rng.int(2, 4), 1);
      s.epidemic!.cases = 0;
    } else return;
  }
  const ep = s.epidemic!;
  const susceptible = (a: Agent) => (a.sickUntil ?? 0) <= day && (a.immuneUntil ?? 0) <= day;
  const sick = s.agents.filter(a => (a.sickUntil ?? 0) > day);
  const infect = (a: Agent | undefined, p: number) => {
    if (!a || !susceptible(a)) return;
    if (rng.chance(p * ep.virulence * (1 - healthcare * 0.55) * (1.35 - a.needs.health * 0.5))) {
      a.sickUntil = day + rng.int(6, 12);
      ep.cases++;
    }
  };
  for (const a of sick) {
    const hh = sim.household(a.householdId);
    for (const id of hh?.members ?? []) if (id !== a.id) infect(sim.agent(id), 0.16);
    for (const id of a.friends) infect(sim.agent(id), 0.035);
    const w = sim.building(a.workplaceId);
    if (w && w.workers.length > 1) infect(sim.agent(rng.pick(w.workers)), 0.06);
    a.needs.health = clamp(a.needs.health - 0.03 * (1 - healthcare * 0.5) * (a.age < 5 || a.age > 65 ? 1.6 : 1));
    a.happiness = clamp(a.happiness - 0.01);
  }
  for (const a of s.agents) if (a.sickUntil != null && a.sickUntil === day) { a.immuneUntil = day + rng.int(240, 420); sim.remember(a, `Recovered from the ${ep.name}.`); }
  const current = s.agents.reduce((t, a) => t + ((a.sickUntil ?? 0) > day ? 1 : 0), 0);
  if (current > ep.peak) {
    if (ep.peak < 5 && current >= 5) {
      sim.log(`An epidemic of ${ep.name} is spreading through the town — ${current} people are sick.`, 'death', undefined, { kind: 'plague', n: current });
      for (const a of s.agents) a.needs.safety = clamp(a.needs.safety - 0.08);
    }
    ep.peak = current;
  }
  if (current === 0) {
    ep.active = false;
    if (ep.peak >= 5) sim.log(`The epidemic of ${ep.name} has burned out after ${day - ep.startDay} days (${ep.peak} sick at its height).`, 'info');
  }
}

// ---------------------------------------------------------------- demographics

function runDemographics(sim: Simulation, healthcare: number) {
  const s = sim.state, p = s.policy, rng = sim.rng;
  for (const a of [...s.agents]) {
    // Gompertz calibrated to a pre-modern-to-early-modern town: ~0.5 %/yr at 50, ~1 % at 60,
    // ~5 % at 75, ~13 % at 85 (before frailty); life expectancy at birth ~65–70
    let hazard = 0.00008 * Math.exp(0.085 * a.age) + (a.age < 5 ? 0.028 * (1.2 - a.needs.health) : 0);
    hazard *= (1.6 - a.needs.health) * (1 - 0.35 * healthcare);
    const cause = a.age < 50 ? 'illness' : 'old age';
    if (a.hungerDays > 20 && rng.chance(0.02 + (a.age < 5 || a.age > 65 ? 0.02 : 0))) { die(sim, a, 'starvation'); continue; }
    if (a.needs.health < 0.12 && rng.chance(0.04)) { die(sim, a, 'illness'); continue; }
    if (rng.chance(hazard / DAYS_PER_YEAR)) die(sim, a, cause);
  }

  // Partnering
  const singles = s.agents.filter(a => a.age >= 18 && a.age < 52 && a.partnerId == null && a.jailedUntil <= s.day);
  for (const a of singles) {
    if (a.partnerId != null || !rng.chance(0.013 * (0.5 + a.personality.E))) continue;
    const pool = [...a.friends.map(id => sim.agent(id)!).filter(Boolean), ...Array.from({ length: 4 }, () => rng.pick(singles))];
    const mate = pool.find(m => m && m !== a && m.sex !== a.sex && m.partnerId == null && m.age >= 18 && Math.abs(m.age - a.age) < 12 && beliefDistance(a.beliefs, m.beliefs) < 1.35);
    if (!mate) continue;
    a.partnerId = mate.id; mate.partnerId = a.id;
    formHousehold(sim, a, mate);
    sim.remember(a, `Married ${mate.name}.`); sim.remember(mate, `Married ${a.name}.`);
  }

  // Divorce / separation under severe strain or ideological rift (less common in traditional/religious cultures)
  for (const a of s.agents) {
    if (a.partnerId == null || a.sex !== 'M') continue;
    const spouse = sim.agent(a.partnerId);
    if (!spouse) { a.partnerId = null; continue; }
    const rift = beliefDistance(a.beliefs, spouse.beliefs);
    const strain = (1 - a.happiness) + (1 - spouse.happiness) + (a.unemployedDays > 20 ? 0.25 : 0);
    const tradRestraint = clamp(0.7 - (a.beliefs.trad + spouse.beliefs.trad) * 0.25 - (a.religiosity + spouse.religiosity) * 0.2, 0.1, 1);
    if (rift > 1.35 && strain > 0.9 && rng.chance(0.002 * tradRestraint)) {
      a.partnerId = null; spouse.partnerId = null;
      formHousehold(sim, a);
      s.counters.divorces++;
      sim.remember(a, `Separated from ${spouse.name}.`);
      sim.remember(spouse, `Separated from ${a.name}.`);
    }
  }

  // Young adults leaving home
  for (const a of s.agents) {
    if (a.age < 22 || a.partnerId != null || !a.parents.length) continue;
    const hh = sim.household(a.householdId);
    if (hh && hh.members.some(id => a.parents.includes(id)) && rng.chance(0.004)) formHousehold(sim, a);
  }

  // Births
  const homeCap = s.buildings.reduce((t, b) => t + (b.complete && (b.type === 'house' || b.type === 'tenement' || b.type === 'manor') ? b.capacity : 0), 0);
  const crowding = s.agents.length / Math.max(1, homeCap);
  for (const mom of s.agents.filter(a => a.sex === 'F' && a.partnerId != null && a.age >= 18 && a.age < 44)) {
    const dad = sim.agent(mom.partnerId);
    if (!dad) continue;
    const kids = mom.children.length;
    const hh = sim.household(mom.householdId);
    let rate = 0.31 * clamp(mom.needs.food * 1.2) * (0.55 + 0.35 * (mom.beliefs.trad + 1) / 2 + 0.2 * mom.religiosity + 0.3 * p.birthSupport);
    // Demographic transition: schooling, reliable healthcare (children survive) and paid work
    // outside the home push desired family size down — the strongest regularity in demography
    const transition = clamp(1.25 - mom.education * 0.55 - healthcare * 0.3 - (isWorkingJob(mom.job) ? 0.12 : 0), 0.45, 1.2);
    rate *= transition;
    if (kids >= 2) rate *= 0.32;
    if (kids >= 3) rate *= 0.45;
    if (kids >= 5) rate *= 0.3;
    // Crowding: when homes are full, couples delay children
    rate *= clamp(1.2 - Math.max(0, crowding - 0.85) * 2, 0.35, 1);
    if (!hh || hh.homeId == null) rate *= 0.4;
    if (!rng.chance(rate / DAYS_PER_YEAR)) continue;
    const child = sim.createAgent({ age: 0, sex: rng.chance(0.5) ? 'M' : 'F', householdId: mom.householdId, parents: [mom, dad] });
    mom.children.push(child.id); dad.children.push(child.id);
    s.counters.births++;
    if (p.birthSupport > 0 && p.allocation === 'market' && hh) {
      const grant = Math.min(s.gov.treasury, 15 * p.birthSupport);
      hh.money += grant; s.gov.treasury -= grant;
    }
    sim.log(`${child.name} was born to ${mom.name} and ${dad.name}.`, 'birth', child.id);
  }
}

function die(sim: Simulation, a: Agent, cause: string) {
  if (cause === 'starvation' || sim.state.agents.length < 150 || sim.rng.chance(0.25)) {
    sim.log(`${a.name} died of ${cause} at age ${Math.floor(a.age)}.`, 'death', a.id);
  }
  sim.killAgent(a, cause);
}

function formHousehold(sim: Simulation, a: Agent, b?: Agent) {
  const leave = (x: Agent, to: Household) => {
    const old = sim.household(x.householdId);
    if (!old || old === to) return;
    const share = old.members.length > 1 ? 0.25 : 1;
    to.money += old.money * share; old.money -= old.money * share;
    to.food += old.food * share * 0.5; old.food -= old.food * share * 0.5;
    old.members = old.members.filter(id => id !== x.id);
    to.members.push(x.id);
    x.householdId = to.id;
    for (const cid of x.children) {
      const c = sim.agent(cid);
      if (c && c.age < 18 && c.householdId === old.id) {
        old.members = old.members.filter(id => id !== c.id);
        to.members.push(c.id);
        c.householdId = to.id;
      }
    }
    if (old.members.length === 0) {
      if (to.homeId == null && old.homeId != null) sim.moveIn(to, sim.building(old.homeId) ?? null);
      to.money += old.money; old.money = 0;
      for (const bb of sim.state.buildings) if (bb.ownerHouseholdId === old.id) bb.ownerHouseholdId = to.id;
      sim.dissolveHousehold(old);
    }
  };
  const ownsHousehold = (x: Agent) => { const h = sim.household(x.householdId); return !!h && !h.members.some(id => x.parents.includes(id)); };
  let target: Household;
  if (b && ownsHousehold(a)) target = sim.household(a.householdId)!;
  else if (b && ownsHousehold(b)) target = sim.household(b.householdId)!;
  else target = sim.addHousehold();
  leave(a, target);
  if (b) leave(b, target);
}
