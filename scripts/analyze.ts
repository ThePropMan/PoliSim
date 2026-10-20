/**
 * Aggregates reports/data/*.json produced by scripts/audit.ts into cross-preset tables.
 * Usage: npx tsx scripts/analyze.ts [size=town] [section]
 */
import { readdirSync, readFileSync } from 'node:fs';

const size = process.argv[2] ?? 'town';
const section = process.argv[3];
const files = readdirSync('reports/data').filter(f => f.endsWith(`-${size}.json`));
const data = files.map(f => JSON.parse(readFileSync(`reports/data/${f}`, 'utf8')));
const mean = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
const sd = (v: number[]) => { const m = mean(v); return Math.sqrt(mean(v.map(x => (x - m) ** 2))); };
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '  - ').padStart(6);
const f0 = (x: number) => (Number.isFinite(x) ? x.toFixed(0) : '-').padStart(6);
const corr = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let n = 0, dx = 0, dy = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return n / Math.sqrt(dx * dy);
};
const show = (s: string) => !section || section === s;

if (show('traj')) {
  const keys = ['pop', 'happiness', 'legit', 'gini', 'unemp', 'food', 'econ', 'auth', 'trad', 'spread', 'meanAge'];
  for (const k of keys) {
    console.log(`\n## ${k} (mean over seeds; ±sd at y50)`);
    console.log('preset'.padEnd(14) + ['y1', 'y5', 'y10', 'y20', 'y35', 'y50', 'sd50'].map(x => x.padStart(6)).join(''));
    for (const d of data) {
      const at = (y: number) => mean(d.runs.map((r: any) => r.yearly[y - 1]?.[k]).filter((x: any) => x != null));
      const last = d.runs.map((r: any) => r.yearly.at(-1)[k]);
      console.log(d.preset.padEnd(14) + [1, 5, 10, 20, 35, 50].map(y => (k === 'pop' ? f0 : f2)(at(y))).join('') + (k === 'pop' ? f0 : f2)(sd(last)));
    }
  }
}

if (show('demo')) {
  console.log('\n## Demography (per 1000 pop per year, averaged over all years & seeds)');
  console.log('preset'.padEnd(14) + ['birth', 'death', 'crime', 'jailed%', 'hungry%', 'kids%', 'old%', 'homelH%'].map(x => x.padStart(8)).join(''));
  for (const d of data) {
    const ys = d.runs.flatMap((r: any) => r.yearly);
    console.log(d.preset.padEnd(14) + [
      mean(ys.map((y: any) => y.births / y.pop * 1000)), mean(ys.map((y: any) => y.deaths / y.pop * 1000)),
      mean(ys.map((y: any) => y.crime / y.pop * 1000)), mean(ys.map((y: any) => y.jailed / y.pop * 100)),
      mean(ys.map((y: any) => y.hungry / y.pop * 100)), mean(ys.map((y: any) => y.kids / y.pop * 100)),
      mean(ys.map((y: any) => y.elders / y.pop * 100)), mean(ys.map((y: any) => y.homelessHH / y.households * 100)),
    ].map(x => f2(x).padStart(8)).join(''));
  }
  console.log('\n## Deaths by cause (total over seeds)');
  for (const d of data) {
    const c: Record<string, number> = {};
    for (const r of d.runs) for (const [k, v] of Object.entries(r.causes)) c[k] = (c[k] ?? 0) + (v as number);
    console.log(d.preset.padEnd(14) + Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' '));
  }
}

if (show('econ')) {
  console.log('\n## Economy at y50 (mean over seeds)');
  console.log('preset'.padEnd(14) + ['money0', 'money50', 'growth', 'priceIx', 'infl', 'wage', 'treas', 'stDebt', 'prDebt', 'top10$', 'ownerHH%', 'slots/pop', 'short'].map(x => x.padStart(9)).join(''));
  for (const d of data) {
    const L = d.runs.map((r: any) => r.yearly.at(-1));
    console.log(d.preset.padEnd(14) + [
      mean(d.runs.map((r: any) => r.m0.total)), mean(L.map((y: any) => y.money.total)),
      mean(d.runs.map((r: any) => r.yearly.at(-1).money.total / r.m0.total)),
      mean(L.map((y: any) => y.priceIndex)), mean(L.map((y: any) => y.inflation)), mean(L.map((y: any) => y.wage)),
      mean(L.map((y: any) => y.treasury)), mean(L.map((y: any) => y.stateDebt)), mean(L.map((y: any) => y.privDebt)),
      mean(L.map((y: any) => y.top10MoneyShare)), mean(L.map((y: any) => y.ownerHH / y.households * 100)),
      mean(L.map((y: any) => y.jobSlots / y.pop)), mean(L.map((y: any) => y.shortage)),
    ].map(x => (Math.abs(x) > 100 ? f0(x) : f2(x)).padStart(9)).join(''));
  }
  console.log('\n## Job mix at y50 (% of pop, mean)');
  const jobs = ['unemployed', 'farmer', 'factory_worker', 'crafter', 'merchant', 'banker', 'guard', 'official', 'priest', 'healer', 'teacher', 'builder', 'student', 'retired', 'child'];
  console.log('preset'.padEnd(14) + jobs.map(j => j.slice(0, 7).padStart(8)).join(''));
  for (const d of data) {
    console.log(d.preset.padEnd(14) + jobs.map(j => f2(mean(d.runs.map((r: any) => (r.yearly.at(-1).jobs[j] ?? 0) / r.yearly.at(-1).pop * 100))).padStart(8)).join(''));
  }
  console.log('\n## Unemployment by year (mean of seeds), max yearly');
  for (const d of data) {
    const series = d.runs[0].yearly.map((_: any, i: number) => mean(d.runs.map((r: any) => r.yearly[i].unemp)));
    console.log(d.preset.padEnd(14) + `max=${f2(Math.max(...series))} mean=${f2(mean(series))} yrs>5%=${series.filter((x: number) => x > 0.05).length}`);
  }
}

if (show('needs')) {
  console.log('\n## Mean needs at y50');
  const ks = ['food', 'rest', 'social', 'comfort', 'safety', 'health', 'freedom', 'purpose', 'culture'];
  console.log('preset'.padEnd(14) + ks.map(k => k.slice(0, 6).padStart(7)).join('') + '   griev   fear  approv');
  for (const d of data) {
    const L = d.runs.map((r: any) => r.yearly.at(-1));
    console.log(d.preset.padEnd(14) + ks.map(k => f2(mean(L.map((y: any) => y.needs[k]))).padStart(7)).join('') + [mean(L.map((y: any) => y.grievance)), mean(L.map((y: any) => y.fear)), mean(L.map((y: any) => y.approval))].map(f2).join(''));
  }
}

if (show('pol')) {
  console.log('\n## Political events per seed (50y avg)');
  const ks = ['election', 'reelected', 'revolution', 'coup', 'riot', 'strike', 'protest', 'crackdown', 'martial', 'purge', 'split', 'merger', 'founded', 'dissolved', 'famine', 'scandal', 'caretaker', 'thaw', 'tighten'];
  console.log('preset'.padEnd(14) + ks.map(k => k.slice(0, 6).padStart(7)).join(''));
  for (const d of data) console.log(d.preset.padEnd(14) + ks.map(k => f2(mean(d.runs.map((r: any) => r.evCounts[k] ?? 0))).padStart(7)).join(''));
  console.log('\n## Scenes per seed');
  for (const d of data) {
    const c: Record<string, number> = {};
    for (const r of d.runs) for (const [k, v] of Object.entries(r.scenes)) c[k] = (c[k] ?? 0) + (v as number) / d.runs.length;
    console.log(d.preset.padEnd(14) + Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v.toFixed(1)}`).join(' '));
  }
  console.log('\n## Regime trajectories');
  for (const d of data) for (const r of d.runs) console.log(`${d.preset.padEnd(14)}s${r.seed} rev=${r.revolutions} ` + r.regimeHistory.map((x: any) => `y${(x.day / 30).toFixed(0)}:${x.name}`).join(' → '));
  console.log('\n## Elections: winner econ vs electorate median');
  for (const d of data) {
    const el = d.runs.flatMap((r: any) => r.elections);
    if (!el.length) continue;
    const gap = el.map((e: any) => e.winnerEcon - e.medianEcon);
    const re = d.runs.reduce((t: number, r: any) => t + (r.evCounts.reelected ?? 0), 0);
    console.log(d.preset.padEnd(14) + `n=${el.length} meanGap=${f2(mean(gap))} |gap|=${f2(mean(gap.map(Math.abs)))} >0.3=${gap.filter((g: number) => Math.abs(g) > 0.3).length} reelect%=${f2(re / el.length * 100)} rulingChanges/seed=${f2(mean(d.runs.map((r: any) => r.rulingChanges)))} meanShare=${f2(mean(el.map((e: any) => e.share).filter(Number.isFinite)))}`);
  }
  console.log('\n## Policy start→end (mean)');
  for (const d of data) {
    const s0 = d.runs.map((r: any) => r.yearly[0].policy), s1 = d.runs.map((r: any) => r.yearly.at(-1).policy);
    const k = ['tax', 'welfare', 'ps', 'enforcement', 'liberty', 'wageFloor', 'corruption', 'press'];
    console.log(d.preset.padEnd(14) + k.map(x => `${x}=${mean(s0.map((p: any) => p[x])).toFixed(2)}→${mean(s1.map((p: any) => p[x])).toFixed(2)}`).join(' ') + '  ' + s1.map((p: any) => `${p.gov}/${p.own}/${p.alloc}`).join(','));
  }
  console.log('\n## Ideology: society mean y1 → y50 and gov position y50; sd of econ');
  for (const d of data) {
    const L = d.runs.map((r: any) => r.yearly.at(-1)), F = d.runs.map((r: any) => r.yearly[0]);
    console.log(d.preset.padEnd(14) + `econ ${f2(mean(F.map((y: any) => y.econ)))}→${f2(mean(L.map((y: any) => y.econ)))} auth ${f2(mean(F.map((y: any) => y.auth)))}→${f2(mean(L.map((y: any) => y.auth)))} trad ${f2(mean(F.map((y: any) => y.trad)))}→${f2(mean(L.map((y: any) => y.trad)))} | gov e${f2(mean(L.map((y: any) => y.govPos.econ)))} a${f2(mean(L.map((y: any) => y.govPos.auth)))} t${f2(mean(L.map((y: any) => y.govPos.trad)))} | sdE ${f2(mean(F.map((y: any) => y.econSd)))}→${f2(mean(L.map((y: any) => y.econSd)))} sdA ${f2(mean(F.map((y: any) => y.authSd)))}→${f2(mean(L.map((y: any) => y.authSd)))} | govGap ${f2(mean(L.map((y: any) => y.govGap)))} factions=${f2(mean(L.map((y: any) => y.factions)))} member%=${f2(mean(L.map((y: any) => y.factionMembership * 100)))}`);
  }
  console.log('\n## Subcultures & classes at y50 (% adults)');
  for (const d of data) {
    const L = d.runs.map((r: any) => r.yearly.at(-1));
    const agg = (k: string) => { const c: Record<string, number> = {}; for (const y of L) { const tot = Object.values(y[k] as Record<string, number>).reduce((a, b) => a + b, 0); for (const [x, v] of Object.entries(y[k] as Record<string, number>)) c[x] = (c[x] ?? 0) + v / tot * 100 / L.length; } return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([x, v]) => `${x}:${v.toFixed(0)}`).join(' '); };
    console.log(d.preset.padEnd(14) + agg('classes') + ' | ' + agg('subcultures'));
  }
}

if (show('corr')) {
  console.log('\n## Correlations across all preset×seed×year samples');
  const ys = data.flatMap(d => d.runs.flatMap((r: any) => r.yearly));
  const pick = (k: string) => ys.map((y: any) => k.includes('.') ? y[k.split('.')[0]][k.split('.')[1]] : y[k]);
  const pairs: [string, string][] = [['happiness', 'legit'], ['gini', 'happiness'], ['gini', 'legit'], ['gini', 'crime'], ['unemp', 'happiness'], ['food', 'happiness'], ['gini', 'grievance'], ['fear', 'grievance'], ['policy.tax', 'gini'], ['policy.welfare', 'gini'], ['policy.liberty', 'happiness'], ['needs.freedom', 'happiness'], ['pop', 'gini'], ['meanAge', 'trad'], ['policy.enforcement', 'crime']];
  for (const [a, b] of pairs) console.log(`  ${a.padEnd(20)} ~ ${b.padEnd(12)} r=${f2(corr(pick(a), pick(b)))}`);
  console.log('\n## Between-preset spread of y50 outcomes (sd across preset means) — low = convergence');
  for (const k of ['happiness', 'legit', 'gini', 'pop', 'econ', 'auth', 'trad', 'unemp']) {
    const pm = data.map(d => mean(d.runs.map((r: any) => r.yearly.at(-1)[k])));
    const within = mean(data.map(d => sd(d.runs.map((r: any) => r.yearly.at(-1)[k]))));
    console.log(`  ${k.padEnd(10)} between-sd=${f2(sd(pm))} within-sd=${f2(within)} range=${f2(Math.min(...pm))}..${f2(Math.max(...pm))}`);
  }
}

if (show('log')) {
  for (const d of data) { console.log(`\n### ${d.preset} seed${d.runs[0].seed} (last political events)`); for (const l of d.runs[0].politicalLog.slice(-25)) console.log('  ' + l); }
}
