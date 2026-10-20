# PoliSim simulation audit

**Scope.** I ran all 12 ideology presets on 4 seeds each, 50 simulated years, at Market Town size (48 runs, 2,400 society-years). I also ran 8 presets × 2 seeds at City (30 y) and Hamlet (50 y) size, plus the existing `scenario`, `lean` and `winners` scripts. Every run records more than 60 yearly metrics: demography, causes of death, the money stock by holder, prices, the job mix, all nine needs, grievance/fear/approval, belief means and SDs, the policy vector, regime, factions, every event (matched by category), and every election result against the electorate median.

Tools added for this:

- `scripts/audit.ts <preset> [years] [seeds] [size]` writes the raw data to `reports/data/<preset>-<size>.json`
- `scripts/analyze.ts [size] [traj|demo|econ|needs|pol|corr|log]` builds the cross-preset tables quoted below

The pre-audit source is preserved in `backup_src_pre_audit/`.

---

## Headline

The model doesn't fail by collapsing. It fails by **converging**. Many of the rule patches were tuned to make a particular script look right (parties "alternate", "left stays left", "autocracies only fall in crisis"), and together they produce societies that end up looking alike. The inequality, the job market and the population age structure come out wrong in the same way under every system.

| Outcome at y50 | Spread *between* presets | Spread *within* a preset (seed noise) |
|---|---|---|
| happiness | 0.06 | 0.06 |
| legitimacy | 0.07 | 0.06 |
| unemployment | 0.01 | 0.01 |

Which political system you pick explains no more of the variation in happiness or legitimacy than the random seed does.

---

## A. Demography (critical; it causes most other problems)

| Metric (town, mean of all years) | Sim | Plausible pre-modern to modern range |
|---|---|---|
| Children (<18) share | **40–46 %** | 25–40 % |
| Elders (65+) share | **1.6–2.2 %** | 5–18 % |
| Mean age | falls 27 → **23–25** | 28–40 |
| Population at y50 | **+75 % to +125 %** in *every* preset | depends on the system |
| Illness deaths vs old-age deaths | ≈ 1 : 1 (city: anarcom **3.5 : 1**) | old age should dominate |
| Hamlet extinctions | **4 of 16 runs reached pop = 0** | rare |

Root causes:

1. **Winter fuel starvation.** `consume()` burns `0.3 × members` goods per day for heating in winter. That is about the same as everyday goods demand (`GOODS_WANT = 0.36`). Labour targets never plan for heating, and fuel is drawn only *after* normal consumption. A per-age trace of socdem showed **80–90 % of households without fuel every winter**. Health in *all* age groups drops to about 0.6 each winter, and the 65+ cohort falls from 29 to 4 people within 10 years. This one mechanic accounts for the "illness" deaths, the missing elderly and the leader churn ("X now leads Y" every 1–3 years).
2. **Gompertz mortality is about 5× too steep.** `0.0004·e^(0.085·age)` gives an annual death risk of about 6 % at age 60 and 30 % at 80, before any frailty multiplier.
3. **No demographic transition.** Fertility depends on food, tradition, religiosity and subsidy, but not on education, comfort or women's work. The implied total fertility rate is about 4–5 everywhere, so every society booms in a Malthusian way. **Food security then falls from 1.0 to 0.6–0.7 in 9 of 12 presets by y35.** That decline comes from population growth, not from the political system.

## B. The labour market is inert

- Unemployment is **0.00–0.02 in every preset in every year**. Not one market-economy seed ever went above 5 %.
- There are 2.5–3.2 job slots per person, and the targets from `jobTargets()` add up to more than the working-age population, because the population is so young (see A).
- **The job fill order is a strict priority list**, so the low-priority jobs never get filled. **Priests are 0.00 % in every preset, theocracy included.** Builders are 0 % in 11 of 12 presets, and artists are almost nobody. Clergy is 0, so faith-based purpose and culture are dead everywhere, and religiosity drifts down even in a "Holy Commonwealth".
- All the unemployment-driven machinery (unemployment anger, crime, belief experience, pocketbook voting) never fires.

## C. Beliefs regress to the centre (an overfitting side effect)

| Preset | econ y1 → y50 |
|---|---|
| Anarcho-capitalism | 0.62 → **0.18** |
| Minarchy | 0.52 → **0.12** |
| Liberal | 0.38 → **0.06** |
| Anarcho-communism | −0.63 → **−0.24** |
| socdem / marketsoc / statesoc | stable |

Causes:

- `driftBeliefs` targets `0.8 × disposition` for econ and `0.75 ×` for auth and trad. Every adult is therefore pulled 20–25 % toward zero. Ad-hoc class, job and experience terms then push back, but not evenly: the left-pushing terms (working-class solidarity, miners and factory workers, the inequality "experience" term, public services) outweigh the right-pushing ones (property, merchants). As a result, left presets hold their position and right presets melt.
- A child's disposition is `0.5 × parents + 0.35 × culture centre`, so the weights sum to **0.85**, not 1. Each generation regresses 15 % toward zero. With two generations of turnover in 50 years (see A), that alone removes about 28 % of a society's lean.
- Belief **auth SD collapses** from 0.32 to 0.13–0.21 in every preset, and the overall spread shrinks in all 12. Societies homogenise.
- Subcultures saturate: feudal and theocracy end up **94–95 % "traditionalist"**.

## D. The policy ↔ belief mapping is miscalibrated, so presets dissolve into the same regime

- `positionFromPolicy` places market-economy policy **0.3–0.55 to the right** of the society that chose it. Socdem's own policy maps to econ **+0.24** while its people sit at −0.18. Distributism maps to +0.49 and theocracy to +0.48. Since `gov.position` is 36 % policy-position, every market government *looks* right-wing to its citizens. That skews alignment, approval and propaganda drift.
- `policyFromBeliefs` is absolute, not relative to existing institutions. **Social Democracy becomes "Liberal Republic" at its first election in 4 of 4 seeds (y4)**: tax goes 0.42 → 0.26 and welfare 0.62 → 0.36. **Minarchy becomes "Liberal Republic" in 4 of 4 seeds.** Every democracy converges on the same policy vector within one or two terms.
- The mapping can't express several presets at all. The statesoc centre maps to collective/market, not state/planned; technocracy maps to democracy; theocracy maps to monarchy. Any regime change that goes through this function flips the system's identity. That explains theocracy → "Kingdom" in 3 of 4 seeds and authcap → "Liberal Republic"/"Kingdom" flickers.
- **Central Planning → "Cooperative Republic" (democracy, market) in 4 of 4 seeds.** The outcome is deterministic, and afterwards the new ruling party wins **97 % of elections**.

## E. Wealth Gini is used with income-Gini thresholds

`stats.gini` is a *wealth* Gini that includes property: 150–320 per building. Values of 0.65–0.75 are normal for wealth even in Nordic countries. But every social threshold (bread riots `>0.5`, elite capture `>0.5`, relative deprivation `>0.3`, labour militancy `>0.5`, besieged-elite authoritarianism `>0.55`) is calibrated like an **income** Gini. Consequences:

- Bread riots happen in **every** private-property society, including Social Democracy (13.5 per seed) and Market Socialism (30 per seed).
- **Elite capture corrupts every private autocracy** in a one-way ratchet: authcap corruption 0.29 → 0.52, theocracy 0.19 → 0.40, technocracy 0.04 → 0.17, and authcap press freedom 0.15 → 0.00.
- Gini rises in every market society regardless of policy: socdem 0.67 ≈ technocracy 0.69 ≈ liberal 0.73. Across all samples, tax rate correlates with Gini at only r = −0.19.

## F. Money conservation is broken

- **Planned-economy wages are created from nothing.** `plannedDistribution` credits `3.2 × bonus` per worker per day to households without debiting the treasury. Statesoc's money stock grows **27×** in 50 years (city: 18×). After the inevitable transition to a market, the price index sits at about 4.8 and wages at about 15 (elsewhere about 4.5).
- **Party dues are minted:** `f.treasury += dues × 0.01` takes nothing from members. **Campaign spending is destroyed:** `f.treasury -= spend` pays no one.
- In the market presets the money stock grows 34–117 % while the price index rises 1.25–1.58×. That is acceptable, but the leaks above make it hard to audit.

## G. Politics: lock-in, spam and dead mechanics

| Symptom | Data |
|---|---|
| Incumbents almost always win | re-election 67–97 %; socdem 87.5 %, statesoc 97 % |
| Liberal and minarchy winners sit right of the median | mean gap +0.24 / +0.16; 19 of 48 and 22 of 48 elections > 0.3 off the median |
| Street concessions drive policy | every rally or strike by any faction ≥ 4 % of adults triggers a 25–60 % chance of a 10 % policy lerp toward *that faction's* platform, regardless of size. Every riot in a democracy adds an 18 % lerp toward the rioters. Marketsoc logs a concession roughly every 0.1 years. |
| Coups are common in "stable" autocracies | trigger `(1 − legit) × militaryPower ≥ 0.25`, so at legit 0.6 with mp 0.7 the risk is about 12 %/yr; coups also count as revolutions |
| Back-to-back revolutions | theocracy s1: revolutions at y40.6 *and* y41.1; no cooldown after a regime change |
| Party membership is absurd | **55–77 % of adults** are party members (real democracies: 2–15 %); ancap has 8 parties with 77 % membership and no state to contest |
| Dead mechanics | in 2,400 society-years: **0 purges, 0 splinters, 0 scandal exposés**; thaw 0–0.5 per seed |
| Technocracy is frozen | 0 revolutions, 0 meaningful events, grievance 0.02, fear 0.00 for 50 years despite a 0.46 gap between government and society |
| Ancap is frozen | `governance:'none'` has no exit path; the government sits 0.86 away from the society forever, and starvation is reported 45 times per seed |
| Legitimacy ≈ happiness ≈ food | r(happiness, legit) = 0.93, r(food, happiness) = 0.93. Legitimacy is close to a food gauge. |

## H. Needs that don't discriminate

At y50, across all presets:

- **safety 0.96–1.00**, even in ancap with 11 crimes per 1,000 per year
- **rest 0.94–0.95**
- **purpose 0.90–0.92**
- **comfort 0.30–0.40**

Four of the nine needs barely vary between systems, so the happiness function effectively runs on food, health and relative rank. Fear is about 0 even under autocracy (authcap 0.07, theocracy 0.01).

## I. Events and scenes are dominated by weather and festivals

Per 50 years: festival scenes ≈ **50**, because one fires every year whenever `culturalSubsidy > 0.35`, deterministically, adding +0.06 happiness and −0.04 grievance for everyone. Storms ≈ 26 and droughts ≈ 19. Political scenes (election, uprising, coup) are 0–12. The cinematic layer mostly shows the weather.

The player interventions are also badly scaled. In `scenario`, **a famine kills 70 % of the town** (feudal 421 → 104, statesoc 423 → 120). Meanwhile "crushing taxes" (70 % tax, 0.6 corruption, no welfare) leave legitimacy at 0.61 with no uprising in 15 years.

---

## Angles to fix (by priority)

1. **Heating and demography.** Draw fuel first from a smaller need (≈ 0.12 per person in winter) and include it in goods labour targets. Recalibrate Gompertz so death risk is about 1 % at 60 and about 4 % at 75, with life expectancy around 65–70. Add a demographic transition in which fertility falls with education, comfort and the healthcare level. Damp the Malthusian boom with a carrying-capacity term.
2. **Belief anchoring.** Use disposition weight 1.0 on every axis. Make child disposition weights sum to 1 (parents + culture). Keep the class terms, but they need to be close to zero-mean.
3. **Institutional path dependence.** Refit `positionFromPolicy` so each preset's policy maps near its own culture. Then express policy change *relative to a constitutional baseline* (`gov.baseline`): `target = baseline + map(platform) − map(baselineBeliefs)`. Revolutions reset the baseline. This keeps a social democracy socdem when a centre-left party wins, which is how welfare regimes persist in practice.
4. **Felt inequality.** Compute a per-capita *income* Gini (smoothed) and use it for riots, deprivation, militancy and elite capture. Keep the wealth Gini as a displayed stat.
5. **Money.** Pay planned wages from the treasury. Take party dues out of member households. Pay campaign spending out to households (canvassers, printers).
6. **Politics.** Scale concessions by the faction's share of adults and limit how often they can happen. Cap riot relief to welfare and wage-floor relief only. Raise the coup threshold, add a coup cooldown and count coups separately. Add a 3-year cooldown on revolutions after a regime change. Make joining a party harder and leaving easier.
7. **Labour.** Fill jobs proportionally to each job's relative deficit instead of by strict priority, so priests, builders and artists exist.
8. **Events.** Make festivals stochastic, tied to the harvest and cohesion. Rescale famine and plague so they hurt without wiping out the town.

Not attempted in this pass (noted for later): an exit path for ancap and technocracy governance, safety and fear calibration, purge and splinter triggers, and true frictional unemployment in markets.
