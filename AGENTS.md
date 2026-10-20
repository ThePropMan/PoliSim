# PoliSim

A browser-based society sandbox. Agents live, work, form families, organise into factions, vote, protest and revolt under configurable economic/political systems, rendered in a 3D white-space town.

## Stack
- TypeScript + Vite + Three.js (no UI framework; plain DOM for HUD)
- Simulation is pure TS with no DOM dependencies, so it also runs headless under `tsx`

## Commands
- `npm run dev` — dev server (Vite)
- `npm run build` — typecheck (`tsc --noEmit`) + production build
- `npm run typecheck`
- `npm run headless -- <years> <hamlet|village|town|city> [presetIds,comma,separated] [seed]` — run every ideology preset headless and print yearly stats + political events. Use this to verify balance after sim changes.
- `npm run scenario` — scripted stress tests (famines, crushing taxes, bad planners) to check that unrest/revolutions still emerge
- `npm run drift -- [years] [seed1,seed2,...] [presetIds,comma]` — multi-seed realism diagnostics: per-faction platform drift vs founding values, internal dispersion, gov-vs-base gap, riot/purge/splinter counts, gini & unemployment trends
- `npm run debug-econ -- <presetId>` — detailed money/jobs/deaths trace for one preset (checks money conservation)
- `npm run diag -- <presetId> [seed]` — structural health trace: job slots vs filled, owner-occupancy, gini/top-10% share, money per capita, price index, wages, treasury. Use to distinguish deflation/liquidity starvation from real capacity problems.
- `npm run elect -- <presetId> [seed]` — tracks ruling party, platform, tax/welfare, gini and unemployment per year plus election/riot events; use to verify party changes actually move policy.
- `npx tsx scripts/lean.ts [years] [seeds] [presetIds]` — society-wide mean econ belief per preset at y0/y10/y20/end. Use after touching belief drift: societies must NOT all converge on one point (left presets should stay left, right stay right; mild moderation of extremes is fine).
- `npx tsx scripts/parties.ts <presetId> [seed] [years]` — party-system health every 5 years: econ/auth histograms, where radicals sit, and each party's platform vs founding line, membership range and dispersion. Use after touching factions: democracies should keep distinct parties across the spectrum, not catch-all blobs at the centre.
- `npx tsx scripts/winners.ts [years] [seeds,csv] [presetIds,csv]` — who wins each election: winner platform vs electorate median, membership (auto-vote floor) and vote shares. Governments should track the median and alternate; a permanent winner 0.3+ from the median means lock-in is back.
- `npx tsx scripts/authtrace.ts <presetId> [seed] [years]` — half-yearly trace of citizen vs ruling-party vs leader beliefs, legitimacy, food, grievance; use to debug regime drift/collapse.

## Verification checklist
1. `npm run build` passes
2. `npm run headless -- 40 town` — no preset should collapse (population crash) under its default settings; money totals should be conserved
3. `npm run scenario` — provocations should produce protests/uprisings
4. In dev mode, `window.polisim = { sim, world, hud }` is exposed for browser debugging

## Architecture (src/)
- `sim/types.ts` — all serialisable state (WorldState is saved as JSON; bump `STATE_VERSION` in simulation.ts on breaking changes)
- `sim/simulation.ts` — `Simulation` class: world generation, indices, tick loop (4 ticks/hour, 30 days/year), lifecycle (death, inheritance), save/load
- `sim/behavior.ts` — hourly agent schedule (sleep/work/school/leisure/protest/jail) and movement
- `sim/economy.ts` — daily: labour market, production, market trading/prices/wages, planned rations, commons, taxes, welfare, pensions, rent/eviction, housing construction, informal economy & charity
- `sim/society.ts` — daily: needs, happiness, belief drift (experience, peers, propaganda), approval/grievance, crime, demographics (births, deaths, partnering)
- `sim/politics.ts` — factions (founding/joining), elections, council decisions, protests/strikes, crackdowns/concessions, uprisings, regime change, `applyPolicyChange` (handles expropriation/privatisation/money abolition)
- `sim/presets.ts` — world size + ideology presets, `policyFromBeliefs` / `positionFromPolicy` mappings
- `sim/interventions.ts` — player "events" (famine, plague, windfall, immigrants, resignation, snap election)
- `sim/terrain.ts` — deterministic heightfield/soil/ore/forest/water map from world seed; `siteQuality` & `terrainIndex` for siting. Also generates a meandering river (`river` polyline, carved channel + enriched banks) and bridge crossing points (`bridges`); `wadeFactor` slows movement in water except at bridges.
- `sim/environment.ts` — seasons (`seasonOf`/`seasonalFarmFactor`), weather machine (`updateEnvironmentDay`: transitions, storm damage, forest regrowth), `weatherProtestFactor`
- `sim/districts.ts` — named residential districts from housing clusters + mean wealth; also computes per-district adult beliefs (`lean`), a local opinion `pull` from dominant local economy/class/peripherality (`CAT_PULL` table), and `dominant` economy category. `districtMap` is cached per day; `districtAt`/`districtName` for lookups.
- `render/terrain.ts` — heightfield ground mesh, water plane, instanced trees/rocks (rebuilt on depletion), seasonal tints, worn-path trail canvas. Also: bridge deck meshes at `terrain.bridges` and a per-cell political gradient overlay (`paintPolitics`) driven by `districtMap` leans. (A painted-street texture was tried and removed — roads remain a movement/wade abstraction, not a pathing network.)
- `render/effects.ts` — weather particles (rain/snow)
- `render/world.ts` — Three.js scene, instanced agents, building meshes, picking, day/night
- `ui/hud.ts` — top bar, State/Policy/Factions/Tools tabs, inspector, charts, event log
- `ui/setup.ts`, `ui/controls.ts` — setup screen and reusable policy/culture sliders
- `ui/cinematics.ts` — toggleable event "skits": sim events carry an optional `scene` payload (`sim.log(text, kind, agentId, scene)`); main.ts pauses ticking (`cinePaused`) while a 2D canvas vignette plays. Per-kind cooldowns/priorities live there; prefs persist in localStorage.

## Design notes
- Money must be conserved in market economies (only explicit injections: regime transitions, windfall, new-firm seed cash). Leaks cause deflationary collapse — check with `debug-econ`.
- Belief axes: econ (-1 collectivist … +1 free market), auth (-1 libertarian … +1 authoritarian), trad (-1 progressive … +1 traditional).
- Keep the model even-handed: each system should have its own failure modes (markets: inequality/unemployment; planning: shortages/low variety/repression; commons: free-riding; stateless: crime/no public goods; autocracy: repression → revolt).
- Inequality is an active force, not a stat: gini scales relative-deprivation happiness loss, deprivation grievance, crime, left/right polarisation, strike militancy, bread riots (gini>0.5 + angry underclass), and elite capture (corruption + pro-capital policy drift). Faction platforms chase their members (and, under autocracy, the leader); governments track policy+platform+leader; deviant wings splinter or get purged.
- Environment is load-bearing: farm output = base × soil quality × seasonal factor × weather factor; mines/lumber deplete terrain (ore/forest regrow slowly); storms damage buildings (`condition` decays, builders repair); weather slows movement and suppresses protests/riots; foul weather sends agents home; winter adds heating-fuel needs and homeless exposure risk. Households stockpile food before winter — keep buffers ≥ a season or mass illness follows. In market societies healers/teachers are fee-paid service firms, NOT treasury-paid — they exist even in stateless worlds.
- Belief drift (society.ts `driftBeliefs`): disposition is the main anchor (weight 0.8); class/job terms are deliberately balanced so they polarise without biasing the whole society. Material experience is filtered by press freedom (censored citizens blame "saboteurs", not the system) and measured against adaptive expectations (`culture.comfortNorm`). Cohort imprinting stores only youth *experiences*, never the structural target — otherwise every society converges on one universal point. Children blend parents + current culture centre + temperament (+ indoctrination under closed regimes).
- Autocracies: ruling-party doctrine moves glacially and is anchored to its founding line; nomenklatura (leader, cadres, officials, guards) is pulled toward it. Regimes fall only in a crisis (legitimacy < 0.48, `securityLoyalty` < 0.45, or >15% of adults starving). Fear suppresses open protest (pressure goes into `pentUp`), but hunger overrides fear. Reformist leaders "thaw", hardliners tighten (`autocraticCourse`, yearly when legitimacy < 0.5).
- Party realism: ideological intensity (or strong grievance) drives joining/founding — contented moderates mostly don't join. Platforms are commitment²-weighted (activists set the line) and anchored to the founding identity; members take cues from their party (partisan sorting); friendships are homophilous. In a crisis, angry unaffiliated citizens add "street power" to the opposition.
- Elections: member ballot loyalty scales with actual fit (defection if the party drifts away); voters keep a `votedFor` party ID — losing parties retain a loyal floor so margins stay competitive; retrospective voting — pocketbook score (happiness/food/safety/unemployment/inflation/queues) plus a conditions *trend* from stats history (~8-month baseline) plus a capped cost-of-ruling drag rewards or punishes the whole governing coalition; electable opposition parties triangulate toward the median voter (Downs, resisted by radical-founded parties); campaign spending discounts perceived distance (cap 18%); small per-voter taste noise; under FPTP/runoff voters discount non-viable parties (capped) — viability counts seats (weakly), last votes, membership rolls, and street strength, so a hollow incumbent can fall out of the top two while a mass insurgency needs no seats to look viable — and seat shares get a winner's bonus (γ=1.55/1.15); under PR the median-seat party gets the first coalition mandate. Parliament uses largest-remainder apportionment (exactly 40) and the HUD hemicycle assigns seats to angle-sorted slots so parties form wedges.
- The "Political climate" overlay (bottom-centre, collapsible) explains the society's direction: per-axis position/trend vs ~1yr ago plus a ranked drivers list (`climateDrivers` in hud.ts) mirroring the drift/voting mechanics — keep it in sync when adding new belief forces.
- Parties: splinters (incl. elite splits in failing autocracies) and rare mergers (`checkMergers`: rate-limited via `gov.lastMerge`, same-side & similar-radicalism only; hard-liners refuse to be absorbed).
- Social currents (society.ts `CURRENT_DEFS`/`runCurrents`): occasional days-long opinion waves (scares, revivals, crazes, hard times) that tug beliefs on the econ/auth/trad axes and pulse grievance into susceptible agents — the main source of sudden public-opinion swings. `startCurrent` lets interventions trigger them. District-level politics: `driftBeliefs` adds the home district's `pull` + a local-conformity term, so neighbourhoods keep distinct political colours (visible via the Map overlay in the lens bar).
- Incumbency fatigue & exclusion: approval decays with years-since-`gov.since` (~1%/2y, capped) and committed opposition supporters keep a small permanent grievance floor — long-ruling regimes eventually face turnover pressure instead of infinite stability.
- Saves: `STATE_VERSION` lives in simulation.ts; `deserialize` must migrate older saves (fill new fields, e.g. terrain/weather/`lastRiot`) rather than reject them.
