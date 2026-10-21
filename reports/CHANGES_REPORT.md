# PoliSim — Post-Audit Changes Report

This document records everything changed after the audit in `reports/SIM_AUDIT.md`,
and the verification evidence for each change. Diagnostics: 12 presets × 3 seeds ×
40 sim-years (`reports/data/*.json`, `reports/audit_*.log`), stress scenarios
(`npm run scenario`), belief-convergence trace (`reports/lean.log`), plus browser
smoke tests (`reports/shots/`).

## 1. Simulation fixes

### Economy (`src/sim/economy.ts`, `src/sim/stats.ts`, `src/sim/types.ts`)

- **Winter heating/fuel.** Households now draw fuel from goods stock by seasonal
  need; warmthless households suffer bounded cold-health loss concentrated in
  winter. Fixes mass elderly die-offs observed in the pre-fix traces.
- **Planned wages & treasury leaks.** Planned-economy wage payments no longer
  mint money into household accounts; treasury/enterprise flows were made
  conservative. Result: state-socialist total money went **15,382 → 12,082**
  over 40 years (pre-fix: 16,551 → 453,772 with price index 4.77).
- **Commons/market transitions.** `applyPolicyChange` conversions were audited so
  expropriation/collectivisation/privatisation moves value instead of creating it.
- **Job-fill order & hiring slack.** Market hiring now leaves realistic slack;
  unemployment is no longer structurally pinned at 0 in every system.
- **Gini.** Wealth Gini now uses per-capita household wealth; added smoothed
  `incomeGini` (felt inequality) which drives relative-deprivation effects.
  Post-fix ordering is ideologically coherent: statesoc ~0.05 < marketsoc ~0.29 <
  distributist ~0.60 < liberal ~0.71 < ancap ~0.75 < feudal ~0.81.

### Demographics & society (`src/sim/society.ts`)

- **Mortality hazard** re-curved: child/elderly risk moderated, health-driven
  deaths bounded.
- **Fertility transition**: birth rates respond to prosperity/healthcare; runs no
  longer produce implausibly high child shares.
- **Belief anchoring.** Disposition weight raised and structural pulls rebalanced
  so societies keep their character. Post-fix means over 40y (`reports/lean.log`):
  statesoc −0.55→−0.54, anarcom −0.68→−0.64, socdem −0.18→−0.19, liberal
  0.35→0.28, authcap 0.38→0.32. Only the two most extreme presets moderate
  (ancap 0.68→~0.43, minarchy 0.55→~0.36) — mild moderation of extremes, not
  convergence.
- **Child inheritance** blends parents + culture centre + temperament rather than
  copying the structural target.

### Politics (`src/sim/politics.ts`, `src/sim/presets.ts`)

- **`positionFromPolicy` rewritten** so a policy bundle maps to the position it
  actually implies (bounded institutional baseline). Preset cultural centres and
  policy positions now align.
- **Party money.** Dues and campaign spending capped — no more unlimited
  party-fund growth feeding the money supply.
- **Event-rate balance.** Concession spam rate-limited (`gov.lastConcession`),
  coup and revolution cooldown windows, faction membership stickiness, and
  narrower splinter conditions. In 36 preset×seed runs: 0 revolutions under
  default conditions (provocations in `npm run scenario` still produce strikes,
  crackdowns, underground parties and legitimacy collapse).
- **Elections.** Retrospective voting, loyalty floors and triangulation were
  preserved; democracies alternate ruling parties (`rulingΔ` 1–4 in 40y).

## 2. Event mechanics revisit (`src/sim/society.ts`, `src/sim/interventions.ts`, `src/ui/cinematics.ts`)

- **Contagious epidemics (new system).** Disease is now a spreading process, not
  a one-off damage roll: outbreaks emerge endogenously (winter × crowding ×
  hunger × low healthcare), transmit through households/friends/workplaces, and
  burn out via temporary immunity. Sick agents stay home (`behavior.ts`).
  New state: `Agent.sickUntil`, `Agent.immuneUntil`, `WorldState.epidemic`.
- **Plague intervention** now seeds a virulent outbreak through the epidemic
  system rather than applying flat health damage.
- **New interventions**: Trade Embargo (goods/tools scarcity + price shock),
  Scandal Leak (press-free → scandal/legitimacy hit; censored → pent-up dissent),
  Assassination (leader death → succession; or failed attempt → rally-round-flag).
- **Immigrants scale** with population (~8%, clamped 8–30) instead of a flat 20 —
  no longer doubles a hamlet overnight.
- **Cinematic cooldowns** tightened (crackdown 12→20d, riot 12→18d, storm 25→40d,
  drought 40→60d; cooldowns added for election/famine/plague/coup/revolution/
  martial) and the minimum gap between low-priority scenes raised 2→4 days.

## 3. UI redesign (`src/style.css`, `src/ui/hud.ts`, `src/ui/setup.ts`, `src/ui/icons.ts`, `src/main.ts`, `src/ui/cinematics.ts`)

- Full visual-system rewrite (~513 lines): editorial "broadsheet" direction —
  Newsreader serif display type + Public Sans UI, paper-tone palette, hairline
  rules, restrained accent colour.
- **Masthead**: brand mark, edition line (year/season/day/hour/weather with
  truncation), live stat strip (population, wellbeing, legitimacy, inequality,
  joblessness, inflation with trend arrows), speed control, save/export/menu.
- **Tabbed left drawer** (The State / Economy / Society / Decrees / Parties /
  Trends / Chronicle) instead of stacked panels — one focused view at a time.
- **Events tab** groups interventions by category; new events integrated.
- **Right inspector** as compact cards; event log floats top-right as styled
  cards with kind badges and timestamps.
- **Political climate** pill bottom-centre; **lens controls** widened so labels
  fit; parliament hemicycle and belief map restyled.
- Setup screen redesigned (see `reports/shots/setup.png`); HUD verified at
  1440×900 (`reports/shots/hud1.png`, `hud2.png`, `hud_state.png`) with zero
  console errors.

## 4. Verification results

| Check | Result |
|---|---|
| `npm run typecheck` / `npm run build` | pass |
| All 12 presets × 3 seeds, 40y | no collapses; money conserved or gently growing |
| statesoc money | 15.4k→12.1k (was →453.8k) |
| Belief means | presets hold their position; no universal convergence |
| Stress scenarios | famine crashes legitimacy→recovery; bad planning → strikes/crackdowns/underground parties |

---

# Round 2 — Map overhaul, spatial politics & dynamism

Second pass driven by the feedback: towns grew unbalanced, regimes never changed,
and the map was flat and featureless.

## 5. Map overhaul (`src/sim/terrain.ts`, `src/render/terrain.ts`, `src/sim/behavior.ts`)

- **Varied topology.** A third fine-noise octave, a ridge/valley field, and a
  per-seed relief factor (0.7–1.65) so some worlds are flat farmland and others
  genuinely hilly. Height range now ~−2.6…+6.0 (was ~±3 smooth noise).
- **Rivers.** Each world (85% of seeds) gets a meandering river polyline that
  enters and leaves the map, skirts the civic core (≥36u), carves a real channel
  into the heightfield, and deposits fertile alluvial soil along its banks.
- **Bridges.** Up to 3 crossing points are picked on the river at plausible street
  distances; rendered as wooden deck+rail meshes angled to the local river
  direction. `wadeFactor` slows agents crossing water to 0.45× — full speed on
  bridges, so crossings actually matter.
- **Roads.** Painted street textures were tried and **removed** after review —
  they rendered as visual noise. Roads remain an abstraction (adjacency siting
  + bridge crossing speed); agents still move point-to-point with `wadeFactor`.

## 6. Balanced city growth (`src/sim/simulation.ts`, `src/sim/economy.ts`)

- `takeFreeCell` now weighs **street adjacency** (orthogonal built neighbours)
  and **distance pull** per building type (`SITE_WEIGHTS`), not just terrain
  quality: tenements crowd the core, manors keep their distance, farms/mines/
  lumber still chase soil/ore/forest, industrial seeks the fringe. New districts
  grow as contiguous blocks rather than leapfrog scatter.
- Post-start housing construction passes its type to the siting logic (it
  previously used generic cells).

## 7. Spatial politics (`src/sim/districts.ts`, `src/sim/society.ts`, `src/render/terrain.ts`, `src/ui/hud.ts`)

- `districtMap` now computes per-district **adult belief lean** (econ/auth/trad),
  **dominant local economy** (agrarian/industrial/commerce/learned/clerical/civic),
  and an opinion **pull**: mill wards lean labour, market quarters lean right,
  temple/clerical districts traditional, university districts progressive,
  rich quarters defend the order, poor quarters radicalise, the far periphery
  grows traditional-libertarian.
- `driftBeliefs` applies the home district's pull plus a local-conformity term —
  neighbourhoods keep genuinely different political colours.
- **Map overlay lens** in the bottom lens bar (`Map: off/left–right/order–liberty/
  values/wealth`) renders a smoothed per-cell gradient over the terrain from
  district leans, with a labelled legend. Screenshots: `reports/shots/map_overhaul.png`,
  `map_politics.png`.

## 8. Dynamism — societies change now (`src/sim/society.ts`, `src/sim/politics.ts`)

- **Social currents.** `runCurrents` occasionally spawns a days-long opinion wave
  (~one per year at town scale, max 3 concurrent, per-id cooldowns): bandit
  scares and uncovered plots (authoritarian shove), forbidden pamphlets and
  martyred dissidents (libertarian), revival preachers and miracle tales
  (traditional), scandalous players and foreign ideas (progressive), hoarder
  outrage / mill disasters / union fever (left), merchant caravans and gold
  fever (right), and hard-times downturns (grievance). Susceptibility scales
  with openness and youth; grievance pulses instantly at spawn and drips daily.
- **Incumbency fatigue.** Approval decays ~1% per 2 years of continuous rule
  (cap 14pp) — long-ruling regimes wear out their welcome.
- **Auth-axis mobility.** The auth target previously only ratcheted upward
  (insecurity → order demand, nothing pushing back), so mean auth pinned near
  the disposition anchor. Now it swings both ways:
  - safety thermostat — sustained safety (`needs.safety > 0.8`) slowly
    re-opens tolerance for liberty (deliberately weak, ±0.07, so prosperity
    doesn't pin democracies libertarian);
  - regime experience — under an authoritarian-leaning government, approval of
    order grows when the regime delivers and reactance grows when it fails,
    weighted by tenure (~8y ramp);
  - youth counterculture — under-26s chafe against the incumbent's auth
    position, feeding generational turnover.
  - democratic instability → order demand: under non-autocratic government,
    low legitimacy, high unemployment, and personal grievance all pull auth
    up (aggrieved citizens start wanting a strong hand);
  - agenda-setting: a challenger faction with >12% strength and a platform
    markedly more authoritarian than a citizen drags that citizen's auth
    target up — the Overton window shifts before anyone formally joins;
  - unrest backlash now touches every class (scaled by rank) instead of
    only the settled middle.
  Trace (40y, town): authcap public auth oscillates 0.41→0.54→0.45 while the
  regime hardens to 0.63 — real divergence; liberal auth now swings both
  directions (−0.33→−0.17→−0.33 over 50y) rather than ratcheting lib-only;
  socdem keeps a lib centre but wobbles ±0.13 with conditions.
- **Exclusion grievance.** Committed opposition identifiers keep a small
  permanent grievance floor, feeding parties, protests and uprisings.
- **Loosened upheaval gates.** Crisis thresholds raised to legitimacy <0.42
  (democracies) / <0.55 or securityLoyalty <0.5 or >12% starving (hard regimes);
  uprising needs ratio >0.8, anger >0.48, chance 0.34; protest/strike rates
  raised ~20%; faster scandal accrual and eruption.
- **Result (4 presets × 3 seeds × 50y).** Before: 0 revolutions in every
  unprovoked run. After: revolutions in 6 of 12 runs — authcap → Kingdom once,
  statesoc → Democratic Socialist Republic in all three seeds (perestroika-like),
  feudal and liberal once each. Legitimacy now wanders 0.55–0.72 instead of
  pinning ~0.75. Regimes still don't fall under good conditions — the 3-year
  consolidation window and all other guardrails remain.

## 9. Elections audit & fixes (`src/sim/politics.ts`, `src/sim/society.ts`)

Audit found a solid core (Duverger viability, retrospective + pocketbook voting,
cost-of-ruling, partisan floors, seat apportionment, coalition formation) with
four real gaps:

- **Caretaker governments did nothing.** The comment claimed "policy frozen,
  legitimacy decays" — neither was implemented. Caretaker cabinets now bleed
  ~0.07 legitimacy/day from the legitimacy calc until a majority forms.
- **No candidate effect.** Leader quality (extraversion + skill) now shaves up
  to 0.1 off a party's effective distance — a charismatic candidate can beat a
  nearer platform.
- **No electoral fraud.** Incumbents under weak courts (`judiciary < 0.55`) and
  high corruption (>0.25) now stuff the ballot box: fake ballots inflate their
  count, feed scandal, and raise incumbent anger even when it works.
- **Knife-edge results had no consequences.** Margins under 4% now trigger a
  disputed-election event: the runner-up's faction gains anger, members gain
  grievance, `pentUp` rises — contested legitimacy that feeds the next cycle.
- **Elections ran during martial law.** Scheduled polls are now suspended while
  `gov.martialLaw > 0`.
- **Duverger lock-in.** Viability was computed from seats (FPTP-inflated) plus
  last votes (cast under the same strategic pressure) — a closed loop that kept
  the same top two alternating forever regardless of real support. Viability now
  also counts membership rolls (`members/adults × 0.9`) and street strength
  (`strength/adults × 1.5`), while seat share weighs less (0.6→0.35). A hollow
  incumbent can fall out of the top two; a mass insurgency needs no seats to
  look viable. Verified: challengers now rotate with membership, and a third
  party (Commercial League) broke through to govern at y20 in a seed-9 trace.

Verified (`npm run elect -- liberal 7`): d720 produced a 35%–33% result → the
loser disputed the count, Radical League actually governed four years, then
Golden Society returned at 47%. Alternation works end-to-end.

## 10. Economy realism pass (`src/sim/economy.ts`, `src/sim/society.ts`)

Audit of user-reported symptoms — 80% tax with no visible cost, inflation spikes
that don't hurt, food security pinned at 1.00 — found three root causes, all
fixed:

- **Instant wage indexation made inflation neutral.** Firm wages were recomputed
  daily as `output × price × (1 − ownerShare)`, tracking prices with zero lag,
  so a price spike cost nobody anything. Wages are now **nominally sticky**:
  `b.wage` lerps toward the market rate (α 0.3 private / 0.25 state), so spikes
  erode real pay for several days and deflation overpays. Inflation also feeds
  worker grievance directly above ~12%/mo. Verification: moneyPrinting=1 run
  drove food prices 2.3→3.9 (+70%) while wages lagged at +19%.
- **Taxes were a pure transfer.** No behavioural response at any rate — perfect
  compliance, full effort, unlimited recapitalisation. Now: (a) `productivity`
  applies a deadweight effort drag above 45% (∼40% output cut at 80%); (b)
  `pay()` computes statutory-then-evaded tax — evasion rises with the rate,
  weak enforcement and corruption (capped 60%), and the dodged share stays with
  the worker as informal income (money conserved, treasury sees a Laffer
  flattening — the 80%-tax/weak-enforcement run collected ~28% less than the
  enforced one); (c) owners facing >55% profit tax sometimes refuse to
  recapitalise (investment strike); (d) squeeze resentment now spreads below
  the top-40% earners at confiscatory rates, plus a working-agent grievance
  term above 55%; (e) a "shadow economy thrives" event logs while the black
  market is large.
- **Food security was structurally pinned at 1.00.** Households spent up to 85%
  of cash on food, charity fully covered the poor, and distress loans were
  unlimited conjured money — so the pantry metric only broke during total
  market stock-out. Now: food spend-cap 0.85 → 0.62 (rent/debt/fuel compete,
  so price spikes thin buffers); charity is capped at ~0.7× daily food value
  per recipient (cushions, doesn't underwrite); distress loans trimmed 8→5/day.
  Verified: healthy runs now breathe 0.86–1.00 (winter dips); the 80%-tax run
  bottomed at 0.65 with strikes and declining legitimacy; famine scenarios
  still crash to 0.22–0.38 and topple regimes.

Diagnostics: `scripts/taxstress.ts` (`npx tsx scripts/taxstress.ts`) compares
baseline / 80% tax / 80% tax + weak enforcement / monetary expansion /
hyperinflation / socdem-65% runs.

## 11. Varied acts of god (`src/sim/interventions.ts`)

New player-triggered opinion shocks, each wired to a different ideological axis:
**Radical Manifesto** (left), **Great Revival** (traditional), **Order Panic**
(authoritarian), **Enlightenment Wave** (progressive + libertarian). They push
opinion through `startCurrent` — real drift, not a stat edit.

## 11. Verification (round 2)

| Check | Result |
|---|---|
| `npm run typecheck` / `npm run build` | pass |
| 4 presets × 3 seeds × 50y | 6/12 runs saw regime change; no collapses |
| Currents | ~20 logged per 50y run, all axes represented |
| River/bridges | generate on ~85% of seeds (3 bridges typical); migration defaults keep old saves valid |
| Browser smoke | roads/bridges/overlay/legend verified; zero console errors; a stray nested `.legend-card` CSS block that swallowed the stylesheet tail was found and fixed |

Known limitations: the politics overlay is a soft daily gradient (not live);
district pulls are small (±0.05–0.1/day target shifts) so divergence takes years;
roads are a painted texture, not a pathing network — agents still move
point-to-point (wadeFactor only).
| Elections | alternation in every democratic preset |
| Browser | 0 console errors/warnings; sim runs at 256× |
| Save/load | `serialize`→`deserialize` round-trip: day, 1,553 agents, households, factions preserved; new `epidemic` field migrates cleanly |
| Endogenous epidemic | live sim produced a "marsh ague" outbreak: 1,868 cases, peak 675, burned out on its own |

## 5. Known limitations / further work

- **Unemployment still low** (0–2%) in most presets — labour slack exists now but
  chronic business-cycle unemployment is not yet modelled.
- **No revolutions in unprovoked 40y runs.** Default regimes are stable; upheaval
  requires stress. That is arguably realistic, but a late-game "decay" pressure
  could be added if more turnover is wanted.
- `audit.ts` seed labels printed `seedNaN` when invoked without a seeds arg —
  cosmetic script bug, not a sim issue (explicit seeds work).
- Epidemic deaths route through the health/mortality channel; there is no
  dedicated "died of plague" cause yet.
