import type { Simulation } from '../sim/simulation';
import { DAYS_PER_YEAR } from '../sim/simulation';
import { clamp } from '../sim/rng';
import type { WorldRenderer } from '../render/world';
import type { Agent, Beliefs, Building, EventKind, Faction, PlanningStrategy, Policy, SimEvent } from '../sim/types';
import { GOODS } from '../sim/types';
import { applyPolicyChange, describePlatform, regimePower } from '../sim/politics';
import { beliefDistance } from '../sim/society';
import { seasonLabel, WEATHER_LABELS } from '../sim/environment';
import { districtName } from '../sim/districts';
import { BUILDING_PRODUCTION } from '../sim/economy';
import { PLANNING_STRATEGIES } from '../sim/presets';
import { INTERVENTIONS } from '../sim/interventions';
import { householdWealth } from '../sim/stats';
import { Chart, num, pct } from './charts';
import { CLASS_COLORS, COLOR_MODE_LABELS, JOB_COLORS, SUBCULTURE_COLORS, legendFor, type BuildingColorMode, type ColorMode } from './colors';
import type { PoliticsMode } from '../render/terrain';
import { POLICY_FIELDS, renderFields } from './controls';
import { SCENE_CATEGORIES, SCENE_KINDS, sceneTitle, type Cinematics, type SceneCategory } from './cinematics';
import type { SceneKind } from '../sim/types';

import { ICONS } from './icons';

export const SPEEDS = [0, 0.25, 1, 4, 16, 64];
const SPEED_LABELS = ['Pause', '1×', '4×', '16×', '64×', '256×'];

type Tab = 'gov' | 'economy' | 'culture' | 'policy' | 'factions' | 'trends' | 'chronicle' | 'tools';
const TABS: Tab[] = ['gov', 'economy', 'culture', 'policy', 'factions', 'trends', 'chronicle', 'tools'];
const DRAWERS: Record<Tab, { icon: string; label: string; title: string; deck: string; key: string }> = {
  gov: { icon: ICONS.state, label: 'The State', title: 'The State', deck: 'Who governs, by what right, and how firmly they hold the town.', key: 'G' },
  economy: { icon: ICONS.economy, label: 'Economy', title: 'The Economy', deck: 'Prices, quotas, stores and the supply chain that feeds the town.', key: 'E' },
  culture: { icon: ICONS.society, label: 'Society', title: 'Society', deck: 'Classes, faiths, movements — and the citizens worth knowing.', key: 'S' },
  policy: { icon: ICONS.policy, label: 'Decrees', title: 'Decrees', deck: 'Rule by decree: changes apply at once. Structural changes expropriate or privatise property.', key: 'D' },
  factions: { icon: ICONS.parties, label: 'Parties', title: 'Parties & Factions', deck: 'Every organised current in town, where it stands, and how angry it is.', key: 'P' },
  trends: { icon: ICONS.trends, label: 'Trends', title: 'The Long View', deck: 'How the town has changed, year by year.', key: 'T' },
  chronicle: { icon: ICONS.chronicle, label: 'Chronicle', title: 'The Chronicle', deck: 'Every dispatch from the town, newest last.', key: 'L' },
  tools: { icon: ICONS.events, label: 'Events', title: 'Acts of God & State', deck: 'Intervene: trigger shocks, call elections, stage festivals.', key: 'X' },
};
/** Stories big enough to run as an "Extra" headline card. */
const EXTRA_RE = /^(Election:|REVOLUTION|UPRISING|MILITARY COUP|MARTIAL LAW|Bread riot|DISASTER|CRISIS|BOOM|An epidemic|The epidemic|A political thaw|The regime tightens|Suppressed dissent|Coalition government|The uprising was crushed|.* suspended future elections|.* purged |A newspaper exposé|.* split from|.* has died\. .* is crowned|Leader .* has died)/;
const MAJOR_RE = /^(REVOLUTION|MILITARY COUP|MARTIAL LAW|UPRISING|.* suspended future elections)/;

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const bar = (v: number, color: string) => `<div class="bar"><div style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${color}"></div></div>`;
const needColor = (v: number) => (v > 0.66 ? '#2f9e44' : v > 0.4 ? '#f08c00' : '#e03131');
const agentLink = (a: Agent | undefined) => (a ? `<span class="link" data-agent="${a.id}">${esc(a.name)}</span>` : '<span class="muted">—</span>');
const fmtTime = (day: number, hour: number) => `${seasonLabel(day)} · Y${Math.floor(day / DAYS_PER_YEAR)} D${(day % DAYS_PER_YEAR) + 1} · ${String(hour).padStart(2, '0')}:00`;

export interface HudCallbacks {
  onSpeed: (i: number) => void;
  onSave: () => void;
  onExport: () => void;
  onNew: () => void;
}

export class Hud {
  speedIndex = 2;
  private tab: Tab | null = null;
  private lastQuotes = new Map<string, string>();
  private extrasEl!: HTMLElement;
  private wireEl!: HTMLElement;
  private logFilter: EventKind | 'all' = 'all';
  private root: HTMLElement;
  private charts: Chart[] = [];
  private lastSlow = 0;
  private lastCharts = 0;
  private refreshPolicy: ((p: Policy) => void) | null = null;
  private label: HTMLDivElement;
  private logEl!: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private pointerDown = false;
  private onPointerUp = () => { setTimeout(() => (this.pointerDown = false), 50); };

  constructor(root: HTMLElement, private sim: Simulation, private world: WorldRenderer, private cb: HudCallbacks, private cine: Cinematics) {
    this.root = root;
    root.classList.remove('hidden');
    const quote = (id: string, k: string, title: string) =>
      `<div class="quote" id="q-${id}" title="${title}"><span class="k">${k}</span><span class="v"><span class="n"></span><span class="d"></span></span></div>`;
    root.innerHTML = `
      <header class="masthead">
        <div class="mast-brand"><div class="wordmark">Poli<i>Sim</i></div><div class="edition" id="date"></div></div>
        <div class="mast-head"><div class="regime" id="regime"></div><div class="deck" id="deck"></div></div>
        <div class="quotes">
          ${quote('pop', 'Population', 'Citizens alive today; change vs a year ago')}
          ${quote('happy', 'Wellbeing', 'Average citizen happiness')}
          ${quote('legit', 'Legitimacy', 'Public confidence in the regime — below ~40% revolts brew')}
          ${quote('gini', 'Inequality', 'Felt income inequality (Gini, 0 = equal). Wealth Gini is in the Trends drawer.')}
          ${quote('unemp', 'Jobless', 'Share of working-age adults without a job')}
          ${quote('inf', 'Prices', 'Annual inflation (markets) or daily queue time (planned economies)')}
        </div>
        <div class="press" id="speed" role="group" aria-label="Simulation speed"></div>
        <div class="mast-actions">
          <button id="save" title="Save to browser storage">${ICONS.save}<span class="lbl">Save</span></button>
          <button id="export" class="icon-btn" title="Download save file">${ICONS.export}</button>
          <button id="new" title="Back to the title page">${ICONS.menu}<span class="lbl">Menu</span></button>
        </div>
      </header>
      <nav class="dock sheet" aria-label="Drawers">
        ${TABS.map((t, i) => `${i === 5 ? '<div class="sep"></div>' : ''}<button data-tab="${t}" aria-label="${DRAWERS[t].label}">${DRAWERS[t].icon}<span class="tip">${DRAWERS[t].label}<kbd>${DRAWERS[t].key}</kbd></span>${t === 'chronicle' ? '<span class="badge hidden" id="chron-badge"></span>' : ''}</button>`).join('')}
      </nav>
      <aside class="drawer left sheet closed" id="drawer">
        <div class="drawer-head"><div class="titles"><h2 id="drawer-title"></h2><p id="drawer-deck"></p></div><button class="icon-btn" id="drawer-close" title="Close (Esc)">${ICONS.close}</button></div>
        <div class="drawer-body">
          <div id="tab-gov" class="hidden"></div>
          <div id="tab-economy" class="hidden"></div>
          <div id="tab-culture" class="hidden"></div>
          <div id="tab-policy" class="hidden"><div id="policy-fields"></div></div>
          <div id="tab-factions" class="hidden"></div>
          <div id="tab-trends" class="hidden"><div class="chart-grid" id="charts"></div></div>
          <div id="tab-chronicle" class="hidden"><div class="log" id="log"></div></div>
          <div id="tab-tools" class="hidden"></div>
        </div>
      </aside>
      <aside class="drawer right sheet closed" id="inspector"></aside>
      <details id="climate" class="sheet climate">
        <summary>The Political Climate <span id="clim-sum" class="muted"></span></summary>
        <div id="climate-body"></div>
      </details>
      <div class="extras" id="extras" aria-live="polite"></div>
      <div class="wire sheet" id="wire" title="Open the Chronicle"><span class="stamp info">Wire</span><span class="headline">The presses are warming up…</span><span class="when"></span></div>
      <div class="legend-card sheet hidden" id="legend-card"><div class="cap" id="legend-cap"></div><div id="legend" class="legend"></div></div>
      <div class="map-legend sheet hidden" id="map-legend"><span id="ml-lo"></span><div class="ml-bar" id="ml-bar"></div><span id="ml-hi"></span></div>
      <div class="lens sheet">
        <select id="color-mode" title="Colour citizens by…"></select>
        <select id="bmode" title="Colour buildings by…"><option value="type">Buildings: type</option><option value="ownership">Buildings: owner</option></select>
        <select id="pol-overlay" title="Political map overlay">
          <option value="off">Map: off</option>
          <option value="econ">Map: left–right</option>
          <option value="auth">Map: order–liberty</option>
          <option value="trad">Map: values</option>
          <option value="wealth">Map: wealth</option>
        </select>
        <button id="legend-toggle" title="Colour key">${ICONS.legend}</button>
        <button id="cine-toggle" title="Cinematic scenes for dramatic events (C)">${ICONS.scenes}</button>
        <button id="lite" title="Hide the paper and watch the town (H)">${ICONS.eye}</button>
      </div>`;
    this.label = document.createElement('div');
    this.label.className = 'agent-label hidden';
    document.body.append(this.label);

    const speed = this.q('#speed');
    SPEED_LABELS.forEach((l, i) => {
      const b = document.createElement('button');
      if (i === 0) b.innerHTML = ICONS.pause; else b.textContent = l;
      b.title = i === 0 ? 'Pause (Space)' : `Speed ${l} (key ${i})`;
      b.setAttribute('aria-label', i === 0 ? 'Pause' : `Speed ${l}`);
      b.onclick = () => this.setSpeed(i);
      speed.append(b);
    });
    this.q('#lite').onclick = () => this.toggleLite();
    this.q('#cine-toggle').onclick = () => this.toggleCinematics();
    this.q('#legend-toggle').onclick = () => { this.q('#legend-card').classList.toggle('hidden'); this.q('#legend-toggle').classList.toggle('on'); this.renderLegend(); };
    const cm = this.q<HTMLSelectElement>('#color-mode');
    for (const [k, v] of Object.entries(COLOR_MODE_LABELS)) { const o = document.createElement('option'); o.value = k; o.textContent = `People: ${v}`; cm.append(o); }
    cm.value = world.colorMode;
    cm.onchange = () => { world.colorMode = cm.value as ColorMode; this.renderLegend(); };
    const bm = this.q<HTMLSelectElement>('#bmode');
    bm.onchange = () => { world.buildingColorMode = bm.value as BuildingColorMode; };
    const po = this.q<HTMLSelectElement>('#pol-overlay');
    const POL_LEGEND: Record<string, [string, string, string, string]> = {
      econ: ['Left', 'Right', '#dfa79a', '#a9b9d6'],
      auth: ['Libertarian', 'Authoritarian', '#b7c99e', '#c4aacb'],
      trad: ['Progressive', 'Traditional', '#b9b0d6', '#dfbf8c'],
      wealth: ['Poor', 'Rich', '#d9a05b', '#7fa88a'],
    };
    po.onchange = () => {
      const m = po.value as PoliticsMode;
      world.setPoliticsMode(m);
      const legend = this.q('#map-legend');
      if (m === 'off') legend.classList.add('hidden');
      else {
        const [lo, hi, c1, c2] = POL_LEGEND[m];
        this.q('#ml-lo').textContent = lo;
        this.q('#ml-hi').textContent = hi;
        this.q<HTMLElement>('#ml-bar').style.background = `linear-gradient(90deg, ${c1}, #f0ece2, ${c2})`;
        legend.classList.remove('hidden');
      }
    };
    this.q('#save').onclick = () => cb.onSave();
    this.q('#export').onclick = () => cb.onExport();
    this.q('#new').onclick = () => cb.onNew();
    this.q('#drawer-close').onclick = () => this.setTab(null);
    this.wireEl = this.q('#wire');
    this.wireEl.onclick = () => this.setTab('chronicle');
    this.extrasEl = this.q('#extras');
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => (b.onclick = () => this.setTab(this.tab === b.dataset.tab ? null : b.dataset.tab as Tab)));

    root.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-agent],[data-building],[data-filter],[data-tool],[data-action],[data-strategy],[data-scene]');
      if (!t) return;
      if (t.dataset.scene) this.cine.preview(t.dataset.scene as SceneKind);
      else if (t.dataset.agent) this.selectAgent(Number(t.dataset.agent), true);
      else if (t.dataset.building) this.selectBuilding(Number(t.dataset.building), true);
      else if (t.dataset.filter) { this.logFilter = t.dataset.filter as EventKind | 'all'; this.renderLog(); }
      else if (t.dataset.tool) { INTERVENTIONS.find(x => x.id === t.dataset.tool)?.run(this.sim); }
      else if (t.dataset.strategy) {
        const strat = t.dataset.strategy as PlanningStrategy;
        this.sim.state.policy.planningStrategy = strat;
        this.sim.state.plan.strategy = strat;
        this.sim.log(`Gosplan directive updated to ${PLANNING_STRATEGIES[strat].name}.`, 'economy');
        this.renderEconomy();
      }
      else if (t.dataset.action === 'follow') { this.world.follow = !this.world.follow; this.renderInspector(); }
      else if (t.dataset.action === 'deselect') { this.world.selectedAgentId = null; this.world.selectedBuildingId = null; this.world.follow = false; this.renderInspector(); }
    });

    root.addEventListener('change', e => {
      const el = e.target as HTMLInputElement;
      if (el.dataset.cineMaster !== undefined) this.cine.setEnabled(el.checked);
      else if (el.dataset.cineCat) this.cine.toggleCategory(el.dataset.cineCat as SceneCategory, el.checked);
    });
    root.addEventListener('pointerdown', () => (this.pointerDown = true));
    window.addEventListener('pointerup', this.onPointerUp);

    this.logEl = this.q('#log');
    this.buildCharts();
    this.attach(sim);
    this.setTab(null);
    this.setSpeed(this.speedIndex);
  }

  /** Keyboard shortcut for a drawer (letters shown in the dock tooltips). */
  toggleDrawerByKey(key: string): boolean {
    const t = TABS.find(x => DRAWERS[x].key.toLowerCase() === key.toLowerCase());
    if (!t) return false;
    this.setTab(this.tab === t ? null : t);
    return true;
  }

  get drawerOpen() { return this.tab !== null; }

  private q<T extends HTMLElement = HTMLElement>(sel: string) { return this.root.querySelector(sel) as T; }

  attach(sim: Simulation) {
    this.unsubscribe?.();
    this.sim = sim;
    const listener = (e: SimEvent | { text: string; kind: EventKind }) => this.appendLog(e as SimEvent);
    sim.listeners.push(listener);
    this.unsubscribe = () => { sim.listeners = sim.listeners.filter(l => l !== listener); };
    this.refreshPolicy = renderFields(this.q('#policy-fields'), POLICY_FIELDS, sim.state.policy, (key, value) => this.decree(key, value));
    this.renderLog();
    this.renderLegend();
    this.renderTools();
    this.renderInspector();
    this.renderClimate();
  }

  private decree(key: keyof Policy, value: number | string) {
    const s = this.sim.state;
    const next = { ...s.policy, [key]: value } as Policy;
    if (typeof value === 'string') {
      this.sim.log(`Decree: ${String(key)} set to ${value}.`, 'politics');
      applyPolicyChange(this.sim, next);
    } else s.policy = next;
  }

  setSpeed(i: number) {
    this.speedIndex = i;
    this.q('#speed').querySelectorAll('button').forEach((b, j) => b.classList.toggle('active', j === i));
    this.cb.onSpeed(i);
  }

  toggleCinematics() { this.cine.setEnabled(!this.cine.enabled); }

  /** Sync the topbar toggle + Tools-tab checkboxes with the current scene preferences. */
  renderCinePrefs() {
    const btn = this.q('#cine-toggle');
    btn.classList.toggle('on', this.cine.enabled);
    btn.title = `Cinematic scenes are ${this.cine.enabled ? 'on' : 'off'} (C)`;
    const box = this.root.querySelector('#cine-prefs');
    if (!box) return;
    box.innerHTML = `
      <label><input type="checkbox" data-cine-master ${this.cine.enabled ? 'checked' : ''}> <b>Pause &amp; play scenes for dramatic events</b></label>
      ${SCENE_CATEGORIES.map(c => `<label style="padding-left:18px${this.cine.enabled ? '' : ';opacity:.5'}"><input type="checkbox" data-cine-cat="${c.id}" ${this.cine.categories.has(c.id) ? 'checked' : ''} ${this.cine.enabled ? '' : 'disabled'}> ${c.label} <span class="muted">— ${c.help}</span></label>`).join('')}`;
  }

  /** Collapse the side panels and bottom strip for an unobstructed view of the world. */
  toggleLite(force?: boolean) {
    const lite = force ?? !this.root.classList.contains('lite');
    this.root.classList.toggle('lite', lite);
    this.q('#lite').classList.toggle('on', lite);
  }

  setTab(t: Tab | null) {
    this.tab = t;
    this.root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
    for (const id of TABS) this.q(`#tab-${id}`).classList.toggle('hidden', id !== t);
    this.q('#drawer').classList.toggle('closed', t === null);
    if (t === null) return;
    this.q('#drawer-title').textContent = DRAWERS[t].title;
    this.q('#drawer-deck').textContent = DRAWERS[t].deck;
    if (t === 'chronicle') { this.q('#chron-badge').classList.add('hidden'); this.renderLog(); }
    if (t === 'trends') requestAnimationFrame(() => { for (const c of this.charts) c.draw(this.sim.state.stats); });
    this.renderTab();
  }

  selectAgent(id: number, focus = false) {
    this.world.selectedAgentId = id;
    this.world.selectedBuildingId = null;
    const a = this.sim.agent(id);
    if (a && focus) this.world.focusOn(a.pos.x, a.pos.z);
    this.renderInspector();
  }

  selectBuilding(id: number, focus = false) {
    this.world.selectedBuildingId = id;
    this.world.selectedAgentId = null;
    this.world.follow = false;
    const b = this.sim.building(id);
    if (b && focus) this.world.focusOn(b.pos.x, b.pos.z);
    this.renderInspector();
  }

  update(now: number) {
    this.updateLabel();
    if (now - this.lastSlow > 250 && !this.pointerDown) {
      this.lastSlow = now;
      this.renderTop();
      this.renderInspector();
      this.renderTab();
      this.renderClimate();
    }
    if (now - this.lastCharts > 1000) {
      this.lastCharts = now;
      if (this.tab === 'trends') for (const c of this.charts) c.draw(this.sim.state.stats);
      if (this.world.colorMode === 'faction') this.renderLegend();
    }
  }

  private updateLabel() {
    const a = this.sim.agent(this.world.selectedAgentId);
    const p = a ? this.world.screenPos(a.id) : null;
    if (!a || !p || !p.visible) { this.label.classList.add('hidden'); return; }
    this.label.classList.remove('hidden');
    this.label.textContent = `${a.name} · ${a.job.replace('_', ' ')} (${a.activity})`;
    this.label.style.left = `${p.x}px`;
    this.label.style.top = `${p.y - 6}px`;
  }

  private renderTop() {
    const s = this.sim.state;
    const st = s.stats.at(-1);
    const ago = s.stats.at(-Math.min(s.stats.length, DAYS_PER_YEAR + 1));
    const date = `Y${Math.floor(s.day / DAYS_PER_YEAR)} · ${seasonLabel(s.day)} ${(s.day % DAYS_PER_YEAR) + 1} · ${String(s.hour).padStart(2, '0')}:00 · ${WEATHER_LABELS[s.weather.kind]}`;
    const dateEl = this.q('#date');
    if (dateEl.textContent !== date) { dateEl.textContent = date; dateEl.title = date; }
    this.q('#regime').textContent = s.gov.regimeName;
    const ruling = this.sim.faction(s.gov.rulingFactionId);
    const leader = this.sim.agent(s.gov.leaderId);
    const deck = s.gov.martialLaw > 0 ? `Martial law — ${s.gov.martialLaw} days remain`
      : s.gov.caretaker ? 'A caretaker cabinet holds the reins'
        : ruling ? `<span class="dot" style="background:${ruling.color}"></span>${esc(ruling.name)}${leader ? `, under ${esc(leader.name)}` : ''}`
          : s.policy.governance === 'none' ? 'No state — the market and the neighbours decide'
            : s.policy.governance === 'council' ? 'Open councils govern by assembly' : 'No ruling party';
    const deckEl = this.q('#deck');
    if (deckEl.dataset.v !== deck) { deckEl.innerHTML = deck; deckEl.dataset.v = deck; }
    // Each quote: value, tone, and a year-on-year change (good/bad judged per indicator)
    const set = (id: string, text: string, tone: 'warn' | 'bad' | null, delta?: number, goodWhenUp = true, fmt = (v: number) => pct(Math.abs(v))) => {
      const el = this.q(`#q-${id}`);
      const n = el.querySelector('.n') as HTMLElement, d = el.querySelector('.d') as HTMLElement;
      if (n.textContent !== text) {
        if (this.lastQuotes.has(id)) { el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick'); }
        n.textContent = text; this.lastQuotes.set(id, text);
      }
      n.className = `n ${tone ?? ''}`;
      if (delta === undefined || Math.abs(delta) < 0.005) { d.className = 'd'; d.innerHTML = ''; return; }
      const good = (delta > 0) === goodWhenUp;
      d.className = `d ${delta > 0 ? 'up' : 'down'} ${good ? 'good' : 'bad'}`;
      d.innerHTML = `${ICONS.tri}${fmt(delta)}`;
    };
    set('pop', String(s.agents.length), null, st && ago ? st.pop - ago.pop : undefined, true, v => String(Math.abs(Math.round(v))));
    const happy = st?.happiness ?? 0;
    set('happy', st ? pct(happy) : '—', st ? (happy < 0.4 ? 'bad' : happy < 0.6 ? 'warn' : null) : null, st && ago ? st.happiness - ago.happiness : undefined);
    set('legit', pct(s.gov.legitimacy), s.gov.legitimacy < 0.35 ? 'bad' : s.gov.legitimacy < 0.55 ? 'warn' : null, st && ago ? st.legitimacy - ago.legitimacy : undefined);
    const ig = st?.incomeGini ?? 0;
    set('gini', st ? ig.toFixed(2) : '—', st ? (ig > 0.45 ? 'bad' : ig > 0.36 ? 'warn' : null) : null, st && ago ? ig - (ago.incomeGini ?? ig) : undefined, false, v => Math.abs(v).toFixed(2));
    const unemp = st?.unemployment ?? 0;
    set('unemp', st ? pct(unemp) : '—', st ? (unemp > 0.2 ? 'bad' : unemp > 0.08 ? 'warn' : null) : null, st && ago ? unemp - ago.unemployment : undefined, false);
    const inf = s.market.inflationRate;
    const market = s.policy.allocation === 'market';
    this.q('#q-inf .k').textContent = market ? 'Inflation' : s.policy.allocation === 'planned' ? 'Queues' : 'Stores';
    set('inf', market ? `${Math.round(inf * 100)}%` : s.policy.allocation === 'planned' ? `${s.plan.queueHours.toFixed(1)}h` : num(s.store.food),
      market ? (inf > 0.15 ? 'bad' : inf > 0.06 ? 'warn' : null) : s.policy.allocation === 'planned' ? (s.plan.queueHours > 1.5 ? 'bad' : s.plan.queueHours > 0.8 ? 'warn' : null) : null);
  }

  private renderLegend() {
    if (this.q('#legend-card').classList.contains('hidden')) return;
    this.q('#legend-cap').textContent = `Citizens by ${COLOR_MODE_LABELS[this.world.colorMode].toLowerCase()}`;
    this.q('#legend').innerHTML = legendFor(this.sim, this.world.colorMode).map(l => `<span style="--c:${l.color}">${esc(l.label)}</span>`).join('');
  }

  private buildCharts() {
    const el = this.q('#charts');
    const defs: ConstructorParameters<typeof Chart>[0][] = [
      { key: 'pop', label: 'Population', color: '#1d1b17', format: v => v.toFixed(0) },
      { key: 'happiness', label: 'Wellbeing', color: '#44662a', format: pct, min: 0, max: 1 },
      { key: 'legitimacy', label: 'Legitimacy', color: '#23457c', format: pct, min: 0, max: 1 },
      { key: 'foodSecurity', label: 'Food security', color: '#8c5a10', format: pct, min: 0, max: 1 },
      { key: s => s.incomeGini ?? 0, label: 'Income inequality', color: '#a8261d', format: v => v.toFixed(2), min: 0, max: 0.7 },
      { key: 'gini', label: 'Wealth inequality', color: '#7a2a20', format: v => v.toFixed(2), min: 0, max: 1 },
      { key: 'unemployment', label: 'Unemployment', color: '#655e51', format: pct, min: 0 },
      { key: 'priceIndex', label: 'Price index', color: '#8c5a10', format: v => v.toFixed(2), min: 0.4 },
      { key: 'beliefSpread', label: 'Belief diversity', color: '#44662a', format: v => v.toFixed(2), min: 0, max: 0.8 },
      { key: s => s.econ, label: 'Mean econ belief (L−/R+)', color: '#66386e', format: v => v.toFixed(2), min: -1, max: 1 },
    ];
    for (const d of defs) { const c = new Chart(d); this.charts.push(c); el.append(c.el); }
  }

  // ---------------------------------------------------------------- log

  private appendLog(e: SimEvent) {
    this.pressWire(e);
    if (this.tab !== 'chronicle') {
      if (e.kind === 'politics' || e.kind === 'unrest') this.q('#chron-badge').classList.remove('hidden');
      return; // the chronicle re-renders from state when opened
    }
    if (this.logFilter !== 'all' && e.kind !== this.logFilter) return;
    if ((e.kind === 'birth' || e.kind === 'death') && this.logFilter === 'all' && this.sim.state.agents.length > 150) return;
    const body = this.logEl.closest('.drawer-body') as HTMLElement;
    const atBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 40;
    this.logEl.insertAdjacentHTML('beforeend', this.logEntry(e, true));
    const entries = this.logEl.querySelectorAll('.entry');
    if (entries.length > 300) entries[0].remove();
    if (atBottom) body.scrollTop = body.scrollHeight;
  }

  private logEntry(e: SimEvent, fresh = false) {
    return `<div class="entry ${e.kind}${fresh ? ' new' : ''}" ${e.agentId != null ? `data-agent="${e.agentId}"` : ''}><span class="t">${e.kind} · Year ${Math.floor(e.day / DAYS_PER_YEAR)}, ${fmtTime(e.day, e.hour).split(' · ')[0]} day ${(e.day % DAYS_PER_YEAR) + 1}</span>${esc(e.text)}</div>`;
  }

  private renderLog() {
    const filters: (EventKind | 'all')[] = ['all', 'politics', 'unrest', 'economy', 'culture', 'crime', 'birth', 'death'];
    const big = this.sim.state.agents.length > 150;
    const events = this.sim.state.events.filter(e => (this.logFilter === 'all' ? !(big && (e.kind === 'birth' || e.kind === 'death')) : e.kind === this.logFilter));
    this.logEl.innerHTML = `<div class="log-filters">${filters.map(f => `<button data-filter="${f}" class="${f === this.logFilter ? 'active' : ''}">${f}</button>`).join('')}</div>` +
      (events.length ? events.slice(-200).map(e => this.logEntry(e)).join('') : '<div class="empty">Nothing on the wire in this section yet.</div>');
    const body = this.logEl.closest('.drawer-body') as HTMLElement | null;
    if (body) body.scrollTop = body.scrollHeight;
  }

  /** The wire ticker always shows the latest newsworthy dispatch; big stories also run as Extras. */
  private pressWire(e: SimEvent) {
    if (e.kind === 'birth' || e.kind === 'death' || (e.kind === 'crime' && this.sim.state.agents.length > 150)) return;
    // Routine party housekeeping (leadership shuffles, tiny groups folding) is chronicle-only
    if (e.kind === 'politics' && /now leads the|dissolved\.$/.test(e.text)) return;
    const when = `Y${Math.floor(e.day / DAYS_PER_YEAR)} · ${String(e.hour).padStart(2, '0')}:00`;
    const stamp = this.wireEl.querySelector('.stamp') as HTMLElement;
    const hl = this.wireEl.querySelector('.headline') as HTMLElement;
    stamp.className = `stamp ${e.kind}`; stamp.textContent = e.kind === 'info' ? 'Wire' : e.kind;
    hl.textContent = e.text; hl.classList.remove('fresh'); void hl.offsetWidth; hl.classList.add('fresh');
    (this.wireEl.querySelector('.when') as HTMLElement).textContent = when;
    if (EXTRA_RE.test(e.text) && !this.root.classList.contains('lite')) this.runExtra(e, when);
  }

  private runExtra(e: SimEvent, when: string) {
    const major = MAJOR_RE.test(e.text);
    const card = document.createElement('div');
    card.className = `extra sheet${major ? ' major' : ''}`;
    const life = major ? 11 : 7;
    const label = major ? 'Extra' : e.kind === 'info' ? 'Bulletin' : e.kind;
    card.innerHTML = `<div class="top"><span class="stamp ${major ? 'unrest' : e.kind}">${esc(label)}</span><span class="when">${when}</span></div><div class="hl">${esc(e.text)}</div><div class="life" style="animation-duration:${life}s"></div>`;
    card.onclick = () => { this.setTab('chronicle'); dismiss(); };
    const dismiss = () => { if (card.classList.contains('out')) return; card.classList.add('out'); setTimeout(() => card.remove(), 500); };
    this.extrasEl.prepend(card);
    const cards = this.extrasEl.querySelectorAll('.extra:not(.out)');
    for (let i = 3; i < cards.length; i++) (cards[i] as HTMLElement).classList.add('out'), setTimeout(() => cards[i].remove(), 500);
    setTimeout(dismiss, life * 1000);
  }

  // ---------------------------------------------------------------- left tabs

  private renderTab() {
    if (this.tab === null) return;
    if (this.tab === 'gov') this.renderGov();
    else if (this.tab === 'economy') this.renderEconomy();
    else if (this.tab === 'culture') this.renderCulture();
    else if (this.tab === 'factions') this.renderFactions();
    else if (this.tab === 'policy') this.refreshPolicy?.(this.sim.state.policy);
  }

  private beliefAxes(b: Beliefs, gov?: Beliefs, color = '#222') {
    const axis = (v: number, g: number | undefined, l: string, r: string, grad: string) => `
      <div class="belief-axis" style="background:${grad}">
        ${g !== undefined ? `<div class="gov" style="left:${((g + 1) / 2) * 100}%" title="Government position"></div>` : ''}
        <div class="dot" style="left:${((v + 1) / 2) * 100}%;background:${color}"></div>
      </div><div class="belief-labels"><span>${l}</span><span>${r}</span></div>`;
    return axis(b.econ, gov?.econ, 'Collectivist', 'Free market', 'linear-gradient(90deg,#dfa79a,#e9e2d0,#a9b9d6)') +
      axis(b.auth, gov?.auth, 'Libertarian', 'Authoritarian', 'linear-gradient(90deg,#b7c99e,#e9e2d0,#c4aacb)') +
      axis(b.trad, gov?.trad, 'Progressive', 'Traditional', 'linear-gradient(90deg,#b9b0d6,#e9e2d0,#dfbf8c)');
  }

  private renderGov() {
    const sim = this.sim, s = sim.state, g = s.gov, p = s.policy;
    const adults = sim.adults();
    const mean: Beliefs = {
      econ: adults.reduce((t, a) => t + a.beliefs.econ, 0) / Math.max(1, adults.length),
      auth: adults.reduce((t, a) => t + a.beliefs.auth, 0) / Math.max(1, adults.length),
      trad: adults.reduce((t, a) => t + a.beliefs.trad, 0) / Math.max(1, adults.length),
    };
    const ruling = sim.faction(g.rulingFactionId);
    const jobs = new Map<string, number>();
    for (const a of s.agents) jobs.set(a.job, (jobs.get(a.job) ?? 0) + 1);
    const homeless = s.households.filter(h => h.homeId == null).reduce((t, h) => t + h.members.length, 0);
    const jailed = s.agents.filter(a => a.jailedUntil > s.day).length;
    const longUnemp = s.agents.filter(a => a.unemployedDays > 20).length;
    const nextElection = p.governance === 'democracy' ? Math.max(0, Math.ceil((g.lastElection + p.electionYears * DAYS_PER_YEAR - s.day) / DAYS_PER_YEAR * 10) / 10) : null;
    const bCounts = new Map<string, number>();
    for (const b of s.buildings) bCounts.set(b.type, (bCounts.get(b.type) ?? 0) + 1);

    this.q('#tab-gov').innerHTML = `
      <h3>Government</h3>
      <div class="kv">
        <span class="k">Regime</span><span class="v"><b>${esc(g.regimeName)}</b></span>
        <span class="k">Governance</span><span class="v">${p.governance}</span>
        <span class="k">Ownership / Allocation</span><span class="v">${p.ownership} / ${p.allocation}</span>
        <span class="k">Leader</span><span class="v">${agentLink(sim.agent(g.leaderId))}</span>
        <span class="k">Ruling party</span><span class="v">${ruling ? `<span style="color:${ruling.color}">●</span> ${esc(ruling.name)}` : '<span class="muted">none</span>'}</span>
        ${g.coalition.length > 1 ? `<span class="k">Coalition</span><span class="v">${g.coalition.map(id => { const f = sim.faction(id); return f ? `<span style="color:${f.color}">●</span> ${esc(f.name)}` : ''; }).filter(Boolean).join(' + ')}</span>` : ''}
        ${g.caretaker ? `<span class="k">Status</span><span class="v" style="color:#e8590c">Caretaker government</span>` : ''}
        ${g.martialLaw > 0 ? `<span class="k">Status</span><span class="v" style="color:#c92a2a"><b>Martial law</b> — ${g.martialLaw}d left</span>` : ''}
        <span class="k">In power since</span><span class="v">Year ${Math.floor(g.since / DAYS_PER_YEAR)}${p.termLimits > 0 ? ` (term ${g.termsServed + 1}/${p.termLimits})` : ''}</span>
        ${nextElection !== null ? `<span class="k">Next election</span><span class="v">${nextElection} yrs · ${p.electoralSystem.toUpperCase()}</span>` : ''}
        ${g.parliament.length ? `<span class="k">Parliament</span><span class="v">${g.parliament.slice(0, 5).map(x => { const f = sim.faction(x.factionId); return f ? `<span style="color:${f.color}">●</span>${x.seats}` : ''; }).join(' ')}</span>` : ''}
        <span class="k">Elections / Revolutions</span><span class="v">${g.elections} / ${g.revolutions}</span>
        <span class="k">Regime security power</span><span class="v">${regimePower(sim).toFixed(0)}</span>
        <span class="k" title="Will the guards obey orders? Below ~45% they may refuse to fire on crowds">Security loyalty</span><span class="v" style="color:${g.securityLoyalty < 0.45 ? 'var(--danger)' : g.securityLoyalty < 0.6 ? 'var(--warn)' : 'inherit'}">${pct(g.securityLoyalty)}</span>
        <span class="k">State treasury</span><span class="v">${p.allocation === 'commons' ? '<span class="muted">abolished</span>' : num(g.treasury)}</span>
        <span class="k">Suffrage / Press</span><span class="v">${pct(p.suffrage)} · ${p.pressFreedom > 0.6 ? 'free press' : p.pressFreedom > 0.3 ? 'chilly press' : 'censored'}</span>
      </div>
      ${(() => {
        const total = g.parliament.reduce((t, x) => t + x.seats, 0);
        if (!total) return p.governance === 'democracy'
          ? '<h3>Parliament</h3><div class="muted" style="font-size:11px">No parliament seated yet — the first election will apportion seats.</div>'
          : '';
        const govSeats = g.parliament.filter(x => g.coalition.includes(x.factionId)).reduce((t, x) => t + x.seats, 0);
        const need = Math.floor(total / 2) + 1;
        return `<h3>Parliament — ${total} seats</h3>
          <div class="muted" style="font-size:11px">${g.caretaker ? 'No governing majority — caretaker cabinet.' : `Government holds <b>${govSeats}</b> · opposition ${total - govSeats} · majority needs ${need}.`} Bright dots sit in government, dimmed in opposition.</div>
          <canvas id="parl-chart" class="parl" style="height:170px"></canvas>
          <div class="legend">${g.parliament.filter(x => x.seats > 0).sort((a, b) => (sim.faction(a.factionId)?.platform.econ ?? 0) - (sim.faction(b.factionId)?.platform.econ ?? 0)).map(x => { const f = sim.faction(x.factionId); return f ? `<span style="--c:${f.color}${g.coalition.includes(f.id) ? '' : ';opacity:.45'}">${esc(f.name)} ${x.seats}${g.coalition.includes(f.id) ? '' : ' ◌'}</span>` : ''; }).join('')}</div>`;
      })()}
      <div style="margin-top:6px" class="muted">Legitimacy ${pct(g.legitimacy)}</div>${bar(g.legitimacy, '#3b5bdb')}
      <h3>Government vs. Citizenry</h3>
      <div class="muted" style="font-size:11px">Dot = mean citizen · bar = government · spread = ${s.culture.beliefSpread.toFixed(2)}</div>
      ${this.beliefAxes(mean, g.position, '#495057')}
      <h3>Demographics & Labor</h3>
      <div class="kv">
        <span class="k">Citizens / Households</span><span class="v">${s.agents.length} / ${s.households.length}</span>
        <span class="k">Children / Students / Retired</span><span class="v">${jobs.get('child') ?? 0} / ${jobs.get('student') ?? 0} / ${jobs.get('retired') ?? 0}</span>
        <span class="k">Unemployed (chronic &gt;20d)</span><span class="v">${jobs.get('unemployed') ?? 0} (${longUnemp})</span>
        <span class="k">Homeless / Imprisoned</span><span class="v">${homeless} / ${jailed}</span>
        <span class="k">Historical deaths</span><span class="v">${s.graveyard}</span>
      </div>
      <h3>Workforce Breakdown</h3>
      <div class="legend">${(Object.keys(JOB_COLORS) as (keyof typeof JOB_COLORS)[]).filter(j => j !== 'child' && j !== 'retired').map(j => `<span style="--c:${JOB_COLORS[j]}">${j.replace('_', ' ')} ${jobs.get(j) ?? 0}</span>`).join('')}</div>
      <h3>Town Architecture (${s.buildings.length})</h3>
      <div class="legend">${[...bCounts.entries()].map(([t, n]) => `<span style="--c:#868e96">${t.replace('_', ' ')} ${n}</span>`).join('')}</div>`;
    const pc = this.q('#parl-chart') as HTMLCanvasElement | null;
    if (pc) this.drawParliament(pc);
  }

  private renderEconomy() {
    const sim = this.sim, s = sim.state, p = s.policy, m = s.market, pl = s.plan;
    const stratInfo = PLANNING_STRATEGIES[p.planningStrategy] ?? PLANNING_STRATEGIES.balanced;
    const isMarket = p.allocation === 'market';
    const isPlanned = p.allocation === 'planned';

    const goodRows = GOODS.map(g => {
      const prod = m.produced[g].toFixed(1);
      const cons = m.consumed[g].toFixed(1);
      if (isMarket) {
        return `<tr>
          <td><b>${g}</b></td>
          <td>${m.prices[g].toFixed(2)}</td>
          <td>${prod}</td>
          <td>${cons}</td>
          <td>${m.supply[g].toFixed(0)}</td>
        </tr>`;
      }
      const q = pl.quotas[g].toFixed(0);
      const ful = Math.round(pl.fulfilled[g] * 100);
      return `<tr>
        <td><b>${g}</b></td>
        <td>${s.store[g].toFixed(0)}</td>
        <td>${prod} / ${q}</td>
        <td>${ful}%</td>
        <td>${pct(pl.shortageSeverity[g])}</td>
      </tr>`;
    }).join('');

    this.q('#tab-economy').innerHTML = `
      <h3>Allocation Mode: ${p.allocation.toUpperCase()}</h3>
      ${isMarket ? `
      <div class="kv">
        <span class="k">Price Index (CPI)</span><span class="v"><b>${m.priceIndex.toFixed(2)}</b></span>
        <span class="k">Annualized Inflation</span><span class="v" style="color:${m.inflationRate > 0.15 ? 'var(--danger)' : 'inherit'}"><b>${Math.round(m.inflationRate * 100)}%</b></span>
        <span class="k">Average Daily Wage</span><span class="v">${m.avgWage.toFixed(2)}</span>
        <span class="k">Money Supply (M2)</span><span class="v">${num(m.moneySupply)}</span>
        <span class="k">Private Household Debt</span><span class="v">${num(m.totalPrivateDebt)}</span>
        <span class="k">Interest Rate / Defaults</span><span class="v">${pct(p.interestRate)} / ${m.defaultCount}</span>
        <span class="k">Harvest Yield</span><span class="v">${pct(s.harvest)}</span>
      </div>
      <h3>Commodity Markets & Supply Chain</h3>
      <table class="econ-table">
        <thead><tr><th>Good</th><th>Price</th><th>Out/d</th><th>Use/d</th><th>Stock</th></tr></thead>
        <tbody>${goodRows}</tbody>
      </table>
      ` : isPlanned ? `
      <div class="kv">
        <span class="k">Active Gosplan Strategy</span><span class="v"><b>${esc(stratInfo.name)}</b></span>
        <span class="k">Five-Year Plan Progress</span><span class="v">${pct(pl.fiveYearProgress)}</span>
        <span class="k">Planning Efficiency</span><span class="v">${pct(p.planningEfficiency)}</span>
        <span class="k">Ration Fulfillment</span><span class="v">${pct(pl.rationLevel)}</span>
        <span class="k">Daily Queue Time</span><span class="v" style="color:${pl.queueHours > 1.5 ? 'var(--danger)' : 'inherit'}">${pl.queueHours.toFixed(1)} hrs/day</span>
        <span class="k">Shadow / Black Market</span><span class="v">${pct(pl.blackMarketShare)}</span>
        <span class="k">Harvest Yield</span><span class="v">${pct(s.harvest)}</span>
      </div>
      <div style="margin:6px 0" class="muted">Five-Year Plan Cycle</div>${bar(pl.fiveYearProgress, '#3b5bdb')}
      <h3>Switch Central Planning Strategy</h3>
      <div class="strategy-list">
        ${Object.values(PLANNING_STRATEGIES).map(st => `
          <div class="strategy-card ${st.id === p.planningStrategy ? 'selected' : ''}" data-strategy="${st.id}">
            <div><b>${esc(st.name)}</b></div>
            <div class="muted" style="font-size:11px">${esc(st.description)}</div>
          </div>
        `).join('')}
      </div>
      <h3>Gosplan Quotas & Storehouses</h3>
      <table class="econ-table">
        <thead><tr><th>Good</th><th>Store</th><th>Out/Quota</th><th>Fulfill</th><th>Shortage</th></tr></thead>
        <tbody>${goodRows}</tbody>
      </table>
      ` : `
      <div class="kv">
        <span class="k">Communal Food Store</span><span class="v">${num(s.store.food)}</span>
        <span class="k">Communal Raw Materials</span><span class="v">${num(s.store.raw)}</span>
        <span class="k">Communal Everyday Goods</span><span class="v">${num(s.store.goods)}</span>
        <span class="k">Communal Tools</span><span class="v">${num(s.store.tools)}</span>
        <span class="k">Communal Luxury</span><span class="v">${num(s.store.luxury)}</span>
        <span class="k">Social Trust</span><span class="v">${pct(s.culture.trust)}</span>
      </div>
      <h3>Commons Storehouse Flows</h3>
      <table class="econ-table">
        <thead><tr><th>Good</th><th>Store</th><th>Out/d</th><th>Fulfill</th><th>Shortage</th></tr></thead>
        <tbody>${goodRows}</tbody>
      </table>
      `}
      <h3>Supply Chain Architecture</h3>
      <div class="muted" style="font-size:11px;line-height:1.45">
        • <b>Mine &amp; Lumber Camp</b> → Raw Materials<br>
        • <b>Smithy</b> (uses Raw) → Tools (boosts all workplace productivity)<br>
        • <b>Workshop &amp; Factory</b> (uses Raw + Tools) → Everyday Goods<br>
        • <b>Farm → Mill → Bakery</b> → Food Supply<br>
        • <b>Tailor &amp; Tavern</b> (uses Goods/Food) → Luxury &amp; Comfort
      </div>`;
  }

  private renderCulture() {
    const s = this.state(), c = s.culture, p = s.policy;
    const classes = new Map<string, number>();
    const subs = new Map<string, number>();
    for (const a of s.agents) {
      if (a.age < 18) continue;
      classes.set(a.classIdentity, (classes.get(a.classIdentity) ?? 0) + 1);
      subs.set(a.subculture, (subs.get(a.subculture) ?? 0) + 1);
    }
    const adults = Math.max(1, this.sim.adults().length);

    this.q('#tab-culture').innerHTML = `
      <h3>Cultural Soul & Cohesion</h3>
      <div class="need-row"><span>Cohesion</span>${bar(c.cohesion, '#2f9e44')}<span>${pct(c.cohesion)}</span></div>
      <div class="need-row"><span>Trust</span>${bar(c.trust, '#3b5bdb')}<span>${pct(c.trust)}</span></div>
      <div class="need-row"><span>Collectivism</span>${bar(c.collectivism, '#e8590c')}<span>${pct(c.collectivism)}</span></div>
      <div class="need-row"><span>Religiosity</span>${bar(c.religiosity, '#f08c00')}<span>${pct(c.religiosity)}</span></div>
      <div class="need-row"><span>Work Ethic</span>${bar(c.workEthic, '#495057')}<span>${pct(c.workEthic)}</span></div>
      <div class="need-row"><span>Arts &amp; Media</span>${bar(c.artisticSpirit, '#e64980')}<span>${pct(c.artisticSpirit)}</span></div>
      <div class="need-row"><span>Mobility</span>${bar(c.socialMobility, '#0ca678')}<span>${pct(c.socialMobility)}</span></div>
      <div class="need-row"><span>Class Tension</span>${bar(c.classConsciousness, '#c92a2a')}<span>${pct(c.classConsciousness)}</span></div>
      <div class="kv" style="margin-top:6px">
        <span class="k">Ideological Diversity (SD)</span><span class="v"><b>${c.beliefSpread.toFixed(2)}</b></span>
        <span class="k">Religious Freedom</span><span class="v">${pct(p.religiousFreedom)}</span>
        <span class="k">Cultural Patronage</span><span class="v">${pct(p.culturalSubsidy)}</span>
        <span class="k">Festival Status</span><span class="v">${c.festivalDaysLeft > 0 ? `<span class="pill blue">Active (${c.festivalDaysLeft}d)</span>` : 'None'}</span>
      </div>
      <h3>Social Classes (Adults)</h3>
      ${(Object.keys(CLASS_COLORS) as (keyof typeof CLASS_COLORS)[]).map(cl => {
        const n = classes.get(cl) ?? 0;
        return `<div class="need-row"><span style="text-transform:capitalize">${cl}</span>${bar(n / adults, CLASS_COLORS[cl])}<span>${pct(n / adults)}</span></div>`;
      }).join('')}
      <h3>Subcultures &amp; Movements</h3>
      ${(Object.keys(SUBCULTURE_COLORS) as (keyof typeof SUBCULTURE_COLORS)[]).map(sc => {
        const n = subs.get(sc) ?? 0;
        return `<div class="need-row"><span style="text-transform:capitalize">${sc.replace('_', ' ')}</span>${bar(n / adults, SUBCULTURE_COLORS[sc])}<span>${pct(n / adults)}</span></div>`;
      }).join('')}${this.overviewHtml()}`;
  }

  private state() { return this.sim.state; }

  private renderFactions() {
    const sim = this.sim, s = sim.state;
    const el = this.q('#tab-factions');
    let canvas = el.querySelector('canvas');
    if (!canvas) {
      el.innerHTML = `<h3>Belief Compass</h3><div class="muted" style="font-size:11px">Each dot is an adult (x: economic left→right, y: authority). ◆ = government.</div><canvas class="compass" style="height:220px"></canvas><h3>Political Factions</h3><div id="faction-list"></div>`;
      canvas = el.querySelector('canvas')!;
    }
    this.drawBeliefMap(canvas);
    const list = [...s.factions].sort((a, b) => b.strength - a.strength);
    el.querySelector('#faction-list')!.innerHTML = list.length ? list.map(f => {
      const isRuling = f.id === s.gov.rulingFactionId;
      const drift = beliefDistance(f.platform, f.founding ?? f.platform);
      const driftLabel = drift < 0.15 ? 'faithful to founding platform' : drift < 0.45 ? 'moderately drifted' : drift < 0.8 ? 'heavily drifted' : 'unrecognisable from its founding';
      return `<div class="faction" style="--fc:${f.color}">
        <div class="name">${esc(f.name)}${isRuling ? '<span class="pill blue">ruling</span>' : ''}${f.underground ? '<span class="pill dark">underground</span>' : ''}${f.protestToday ? '<span class="pill red">protesting</span>' : ''}${f.strikeToday ? '<span class="pill red">on strike</span>' : ''}</div>
        <div class="meta">${describePlatform(f.platform)} · founded by ${agentLink(sim.agent(f.founderId))} · ${driftLabel}</div>
        ${drift >= 0.3 ? `<div class="meta">Founded as: ${describePlatform(f.founding ?? f.platform)}</div>` : ''}
        <div class="kv" style="margin-top:4px"><span class="k">Members</span><span class="v">${f.members}</span><span class="k">Strength</span><span class="v">${f.strength.toFixed(1)}</span>${f.leaderId !== f.founderId ? `<span class="k">Leader</span><span class="v">${agentLink(sim.agent(f.leaderId))}</span>` : ''}${f.seats > 0 ? `<span class="k">Seats</span><span class="v">${f.seats}</span>` : ''}${f.treasury > 5 ? `<span class="k">Party funds</span><span class="v">${num(f.treasury)}</span>` : ''}</div>
        <div class="muted" style="font-size:11px;margin-top:3px">Anger ${pct(f.anger)}</div>${bar(f.anger, '#e03131')}
      </div>`;
    }).join('') : '<div class="empty">No organised political groups yet.</div>';
  }

  private drawBeliefMap(c: HTMLCanvasElement) {
    const sim = this.sim, s = sim.state;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const X = (v: number) => ((v + 1) / 2) * (w - 16) + 8, Y = (v: number) => ((1 - v) / 2) * (h - 16) + 8;
    ctx.strokeStyle = '#d2c8b2'; ctx.beginPath(); ctx.moveTo(X(0), 0); ctx.lineTo(X(0), h); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
    ctx.fillStyle = '#655e51'; ctx.font = '10px "Public Sans Variable", sans-serif';
    ctx.fillText('auth', X(0) + 3, 10); ctx.fillText('lib', X(0) + 3, h - 3); ctx.fillText('left', 3, Y(0) - 3); ctx.fillText('right', w - 26, Y(0) - 3);
    for (const a of s.agents) {
      if (a.age < 18) continue;
      const f = sim.faction(a.factionId);
      ctx.fillStyle = f ? f.color : 'rgba(100,110,125,0.42)';
      ctx.globalAlpha = f ? 0.85 : 0.55;
      ctx.fillRect(X(a.beliefs.econ) - 1.5, Y(a.beliefs.auth) - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    for (const f of s.factions) {
      ctx.strokeStyle = f.color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(X(f.platform.econ), Y(f.platform.auth), 4 + Math.sqrt(f.members), 0, Math.PI * 2); ctx.stroke();
    }
    const g = s.gov.position;
    ctx.fillStyle = '#212529';
    ctx.save(); ctx.translate(X(g.econ), Y(g.auth)); ctx.rotate(Math.PI / 4); ctx.fillRect(-5, -5, 10, 10); ctx.restore();
  }

  /** Hemicycle seat chart: parties sorted left→right by economic platform, coalition
   *  dots bright, opposition dimmed, dashed tick marks the majority threshold. */
  private drawParliament(c: HTMLCanvasElement) {
    const sim = this.sim, g = sim.state.gov;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const rows = g.parliament
      .map(x => ({ f: sim.faction(x.factionId), seats: x.seats }))
      .filter((x): x is { f: Faction; seats: number } => !!x.f && x.seats > 0)
      .sort((a, b) => a.f.platform.econ - b.f.platform.econ);
    const total = rows.reduce((t, r) => t + r.seats, 0);
    if (!total) return;

    // Flattened seat order: seat i belongs to seatFaction[i]
    const seatFaction: Faction[] = [];
    for (const r of rows) for (let i = 0; i < r.seats; i++) seatFaction.push(r.f);

    const cx = w / 2, cy = h - 10;
    const rOuter = Math.min(w / 2 - 12, h - 30);
    const nRows = Math.max(1, Math.min(5, Math.round(total / 12)));
    const rInner = nRows === 1 ? rOuter : rOuter * 0.45;
    const rowGap = nRows === 1 ? 0 : (rOuter - rInner) / (nRows - 1);
    const rowR = Array.from({ length: nRows }, (_, i) => nRows === 1 ? rOuter : rInner + rowGap * i);

    // Seats per row proportional to arc length (radius), by largest remainder
    const wSum = rowR.reduce((t, r) => t + r, 0);
    const exact = rowR.map(r => total * r / wSum);
    const rowSeats = exact.map(Math.floor);
    let left = total - rowSeats.reduce((t, n) => t + n, 0);
    [...exact.map((e, i) => ({ i, rem: e - rowSeats[i] })).sort((a, b) => b.rem - a.rem)]
      .forEach(x => { if (left > 0) { rowSeats[x.i]++; left--; } });

    // Every slot in every row gets an evenly-spaced angle; sorting all slots by
    // angle and handing them to seat indices in order makes each party a
    // contiguous wedge across rows instead of wrapping row-by-row.
    const slots: { ang: number; x: number; y: number }[] = [];
    for (let i = 0; i < nRows; i++) {
      const n = rowSeats[i], r = rowR[i];
      for (let j = 0; j < n; j++) {
        const t = n === 1 ? 0.5 : j / (n - 1);
        const ang = Math.PI - t * Math.PI;
        slots.push({ ang, x: cx + Math.cos(ang) * r, y: cy - Math.sin(ang) * r });
      }
    }
    slots.sort((a, b) => b.ang - a.ang);

    const coalition = new Set(g.coalition);
    const minPitch = Math.min(...rowR.map((r, i) => Math.PI * r / Math.max(1, rowSeats[i])), rowGap || Infinity);
    const dotR = clamp(minPitch * 0.38, 1.6, 4.5);

    for (let idx = 0; idx < total; idx++) {
      const { x, y } = slots[idx];
      const f = seatFaction[idx];
      ctx.globalAlpha = coalition.has(f.id) ? 1 : 0.3;
      ctx.fillStyle = f.color;
      ctx.beginPath(); ctx.arc(x, y, dotR, 0, Math.PI * 2); ctx.fill();
    }

    // Majority threshold: the chamber's midpoint — a party needs seats from an
    // edge past this line to govern alone
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#adb5bd'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx, cy - rOuter - 8); ctx.lineTo(cx, cy + 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#868e96'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(`${Math.floor(total / 2) + 1}`, cx, cy - rOuter - 12);
    // Speaker dais
    ctx.fillStyle = '#adb5bd';
    ctx.fillRect(cx - 10, cy - 3, 20, 3);
  }

  /**
   * "Political climate" overlay: where public opinion sits on each axis, which way
   * it is moving (vs ~a year ago), and the top forces currently pulling it there.
   */
  private renderClimate() {
    const el = this.q('#climate-body');
    if (!el) return;
    const sim = this.sim, s = sim.state, g = s.gov;
    const mean = s.culture.beliefCenter;
    const now = s.stats.at(-1), past = s.stats.at(-Math.min(s.stats.length, 300));
    const span = now && past ? now.day - past.day : 0;
    const arrow = (v: number, neg: string, pos: string) =>
      span < 90 || Math.abs(v) < 0.02 ? 'steady' : v < 0 ? `◄ ${neg}` : `► ${pos}`;
    const axisRow = (label: string, v: number, gov: number, l: string, r: string, grad: string, trend: string) => `
      <div class="cl-axis">
        <div class="cl-head"><span class="k">${label}</span><span class="cl-trend">${trend}</span></div>
        <div class="belief-axis" style="background:${grad}"><div class="gov" style="left:${((gov + 1) / 2) * 100}%" title="Government position"></div><div class="dot" style="left:${((v + 1) / 2) * 100}%"></div></div>
        <div class="belief-labels"><span>${l}</span><span>${r}</span></div>
      </div>`;
    const drivers = this.climateDrivers();
    el.innerHTML =
      axisRow('Economy', mean.econ, g.position.econ, 'Left', 'Right', 'linear-gradient(90deg,#dfa79a,#e9e2d0,#a9b9d6)',
        arrow(now && past ? now.econ - past.econ : 0, 'drifting left', 'drifting right')) +
      axisRow('Authority', mean.auth, g.position.auth, 'Libertarian', 'Authoritarian', 'linear-gradient(90deg,#b7c99e,#e9e2d0,#c4aacb)',
        arrow(now && past ? now.auth - past.auth : 0, 'liberalising', 'hardening')) +
      axisRow('Values', mean.trad, g.position.trad, 'Progressive', 'Traditional', 'linear-gradient(90deg,#b9b0d6,#e9e2d0,#dfbf8c)',
        arrow(now && past ? now.trad - past.trad : 0, 'progressive shift', 'traditionalist turn')) +
      `<div class="cl-drivers"><b>What's moving it</b>${
        drivers.slice(0, 6).map(x => `<div class="drv"><span class="dir ${x.cls}">${x.icon}</span>${esc(x.text)}</div>`).join('')
        || '<div class="muted">No strong currents — the society is settled.</div>'
      }</div>`;
    const sum = this.q('#clim-sum');
    if (sum) {
      const t = (k: 'econ' | 'auth' | 'trad') => {
        const v = now && past ? now[k] - past[k] : 0;
        return span < 90 || Math.abs(v) < 0.02 ? '·' : v < 0 ? '◄' : '►';
      };
      sum.textContent = ` econ ${t('econ')} · auth ${t('auth')} · values ${t('trad')}`;
    }
  }

  /**
   * Mirrors the belief-drift and voting mechanics in society.ts/politics.ts as a
   * ranked list of human-readable forces — so the player can see *why* the society
   * sits where it does and which way it is heading.
   */
  private climateDrivers(): { w: number; icon: string; cls: string; text: string }[] {
    const sim = this.sim, s = sim.state, p = s.policy, c = s.culture, g = s.gov;
    const adults = sim.adults(), n = Math.max(1, adults.length);
    const st = s.stats.at(-1);
    const out: { w: number; icon: string; cls: string; text: string }[] = [];
    const push = (w: number, icon: string, cls: string, text: string) => { if (w > 0.04) out.push({ w, icon, cls, text }); };

    const gNow = st?.incomeGini ?? 0, unemp = st?.unemployment ?? 0;
    const crime = st ? st.crime / Math.max(1, st.pop) : 0;
    const food = st?.foodSecurity ?? 1;
    const rel = adults.reduce((t, a) => t + a.religiosity, 0) / n;
    const edu = adults.reduce((t, a) => t + a.education, 0) / n;

    // Economic pulls
    if (gNow > 0.34) push((gNow - 0.3) * 4, '↔', 'pol', 'High inequality — the poor pulled left, the propertied pushed right');
    if (unemp > 0.06) push(unemp * 3, '←', 'left', 'Joblessness — the unemployed radicalise left');
    if (food < 0.7) push((0.7 - food) * 2, '←', 'left', 'Hunger turns citizens against whoever holds power');
    if (p.welfare > 0.4) push((p.welfare - 0.35) * 0.8, '←', 'left', 'Visible welfare builds support for collective provision');
    if (p.taxRate > 0.4) push((p.taxRate - 0.35) * 1.6, '→', 'right', 'Heavy taxes — wealthier voters push right');
    if (p.ownership === 'private' && p.pressFreedom > 0.4 && gNow > 0.32) push(0.45, '→', 'right', 'Privately owned press nudges opinion toward its proprietors');
    if (c.classConsciousness > 0.3) push(c.classConsciousness * 0.6, '←', 'left', 'Working-class solidarity pulls opinion left');
    if (p.allocation === 'planned' && s.plan.queueHours > 0.6) push(Math.min(0.9, s.plan.queueHours / 4), '→', 'right', 'Queues and shortages breed disillusion with planning');
    if (p.allocation === 'commons' && unemp > 0.08) push(unemp * 3, '→', 'right', 'Free-rider resentment pulls toward market incentives');
    if (p.allocation === 'market' && s.market.inflationRate > 0.1) push(s.market.inflationRate * 2, '→', 'right', 'Inflation stings — blame lands on the economic order');

    // Reactionary currents (mirroring the drift terms in society.ts)
    const stPast = s.stats.at(-Math.min(s.stats.length, 240));
    const span = st && stPast ? st.day - stPast.day : 0;
    const econTrend = span > 60 && st && stPast ? st.econ - stPast.econ : 0;
    const tradTrend = span > 60 && st && stPast ? st.trad - stPast.trad : 0;
    const leftThreat = Math.max(0, -(g.position.econ + 0.1)) * 0.6 + Math.max(0, -econTrend) * 1.6;
    if (leftThreat > 0.06) push(leftThreat * 0.8, '→', 'right', 'Property owners dig in — they fear a leftward government');
    const street = (s.day - g.lastRiot < 120 ? 0.5 : 0)
      + s.factions.reduce((t, f) => t + (f.protestToday ? 0.12 : 0) + (f.strikeToday ? 0.1 : 0), 0);
    if (street > 0.1) push(Math.min(1, street), '▲', 'auth', 'Street unrest — the settled middle swings toward order');
    if (tradTrend < -0.02) push(-tradTrend * 5, '◆', 'trad', 'Rapid progressive change — a traditionalist backlash builds');
    const newcomers = adults.reduce((t, a) => t + ((a.newcomerUntil ?? 0) > s.day ? 1 : 0), 0) / n;
    if (newcomers > 0.04) push(newcomers * 2, '▲', 'auth', 'A wave of newcomers — natives turn defensive of custom');

    // Authority pulls
    if (crime > 0.006) push(crime * 40, '▲', 'auth', 'Disorder pushes citizens toward law-and-order');
    if (p.governance === 'none' && crime > 0.004) push(0.5, '▲', 'auth', 'Without state protection, citizens demand authority');
    if (p.civilLiberty < 0.45) push((0.45 - p.civilLiberty) * 1.2, '▲', 'auth', 'Censorship presses opinion toward the regime line');
    if (p.civilLiberty < 0.45 && edu > 0.5) push((edu - 0.45) * 1.2, '▼', 'lib', 'An educated middle class chafes at repression');
    const insecure = adults.reduce((t, a) => t + (a.unemployedDays > 10 ? 1 : 0), 0) / n;
    if (insecure > 0.06 && edu < 0.5) push(insecure * 3, '▲', 'auth', 'Insecurity and low education feed demand for a strong hand');
    if (gNow > 0.46 && c.socialMobility < 0.35) push(0.4, '▼', 'lib', 'A rigged order — the poor lose faith in the rules');
    if (c.religiosity > 0.5 && p.religiousFreedom > 0.4) push(0.25, '▲', 'auth', 'Clerical influence lends authority a sacred gloss');

    // Values pulls
    if (rel > 0.5) push((rel - 0.45) * 1.2, '◆', 'trad', 'Religious life pulls toward tradition');
    if (edu > 0.55) push((edu - 0.5) * 1.5, '◆', 'prog', 'Education pulls toward progressive values');
    if (crime > 0.008) push(crime * 20, '◆', 'trad', 'Disorder breeds traditionalist backlash');

    // The government itself: who holds power, and whether voters still tolerate it
    const ruling = s.factions.find(f => f.id === g.rulingFactionId);
    if (p.governance === 'democracy') {
      const cond = (x: NonNullable<typeof st>) => x.happiness * 0.5 + x.foodSecurity * 0.35 - x.unemployment * 0.35 - Math.max(0, x.inflation) * 0.3 - x.shortage * 0.25;
      const past = s.stats.at(-Math.min(s.stats.length, 240));
      const trend = st && past && st.day - past.day > 60 ? cond(st) - cond(past) : 0;
      if (trend < -0.03) push(-trend * 6, '▼', 'gov', 'Falling living standards — voters are turning on the incumbent');
      else if (trend > 0.03) push(trend * 6, '▲', 'gov', 'Improving conditions — voters still reward the government');
      else if (st && st.happiness > 0.55) push(0.3, '▲', 'gov', 'Times are tolerable — no anti-incumbent wave');
      if (ruling) {
        const share = ruling.members / n;
        if (share > 0.12) push(share * 3, '▲', 'gov', `Party loyalists give the ${ruling.name} a ballot floor (~${Math.round(share * 100)}% of adults)`);
        const rich = [...s.factions].sort((a, b) => b.treasury - a.treasury);
        if (rich.length > 1 && rich[0].treasury > Math.max(15, rich[1].treasury * 2)) push(0.35, '▲', 'gov', `Campaign money amplifies the ${rich[0].name}`);
      }
      const median = [...adults.map(a => a.beliefs.econ)].sort((x, y) => x - y)[n >> 1] ?? 0;
      const gap = median - g.position.econ;
      if (Math.abs(gap) > 0.25) push(Math.abs(gap) * 1.2, '↔', 'pol', `Government sits ${gap < 0 ? 'right' : 'left'} of the median voter — electoral pressure builds`);
      if (g.termsServed >= 2) push(Math.min(0.5, g.termsServed * 0.15), '▼', 'gov', `${g.termsServed} consecutive terms — incumbency fatigue`);
    } else {
      if (g.legitimacy < 0.5) push((0.5 - g.legitimacy) * 2, '▼', 'gov', 'Legitimacy is crumbling — the regime rules by fear, not consent');
      if (g.securityLoyalty < 0.55) push((0.55 - g.securityLoyalty) * 2, '▼', 'gov', 'The security apparatus is wavering');
      if (ruling && ruling.members / n > 0.15) push(ruling.members / n * 2, '▲', 'gov', `The ${ruling.name} patronage network holds the regime together`);
      if (p.civilLiberty < 0.35) push(0.3, '▲', 'gov', 'Censorship hides how deep discontent runs');
    }
    const thermo = c.beliefCenter.econ - g.position.econ;
    if (Math.abs(thermo) > 0.3) push(Math.abs(thermo) * 0.8, '↔', 'pol', `Public mood sits ${thermo < 0 ? 'left' : 'right'} of government policy — pressure to converge`);

    return out.sort((a, b) => b.w - a.w);
  }

  private renderTools() {
    this.q('#tab-tools').innerHTML = `
      <h3>Shocks &amp; Interventions</h3>
      <div class="tools">${INTERVENTIONS.map(t => `<button data-tool="${t.id}" title="${esc(t.help)}"><b>${esc(t.label)}</b><span>${esc(t.help)}</span></button>`).join('')}</div>
      <h3>Cinematic Scenes</h3>
      <div class="cine-prefs" id="cine-prefs"></div>
      <div class="muted" style="font-size:11.5px;margin:8px 0 4px">Preview a scene</div>
      <div class="scene-previews">${SCENE_KINDS.map(k => `<button data-scene="${k}">${sceneTitle(k).replace('!', '')}</button>`).join('')}</div>
      <h3>How to Read the Paper</h3>
      <div class="tips">
        <p>Click any citizen or building in the town to open their profile. Drag to orbit, right-drag to pan, scroll to zoom.</p>
        <p><kbd>Space</kbd> pauses · <kbd>1</kbd>–<kbd>5</kbd> set the pace · <kbd>F</kbd> follows the selected citizen · <kbd>Esc</kbd> closes whatever is open.</p>
        <p>Drawers have letters: <kbd>G</kbd> state, <kbd>E</kbd> economy, <kbd>S</kbd> society, <kbd>D</kbd> decrees, <kbd>P</kbd> parties, <kbd>T</kbd> trends, <kbd>L</kbd> chronicle, <kbd>X</kbd> events.</p>
        <p><kbd>H</kbd> folds the paper away so you can watch the town; <kbd>C</kbd> toggles cinematic scenes. Recolour the townsfolk by class, subculture or belief from the lens at the bottom right to watch society sort itself.</p>
      </div>`;
    this.renderCinePrefs();
  }

  // ---------------------------------------------------------------- inspector

  renderInspector() {
    const el = this.q('#inspector');
    const a = this.sim.agent(this.world.selectedAgentId);
    const b = this.sim.building(this.world.selectedBuildingId);
    const open = !!(a || b);
    el.classList.toggle('closed', !open);
    this.root.classList.toggle('inspecting', open);
    if (!open) return;
    // Keep the reader's scroll position across live refreshes
    const body = el.querySelector('.inspector') as HTMLElement | null;
    const key = a ? `a${a.id}` : `b${b!.id}`;
    const scroll = body && el.dataset.key === key ? body.scrollTop : 0;
    el.innerHTML = a ? this.agentHtml(a) : this.buildingHtml(b!);
    el.dataset.key = key;
    const nb = el.querySelector('.inspector') as HTMLElement | null;
    if (nb) nb.scrollTop = scroll;
  }

  private overviewHtml() {
    const sim = this.sim, s = sim.state;
    const adults = sim.adults();
    const w = householdWealth(sim);
    const richestHh = [...s.households].sort((x, y) => (w.get(y.id) ?? 0) - (w.get(x.id) ?? 0))[0];
    const angriest = [...adults].sort((x, y) => y.grievance - x.grievance)[0];
    const happiest = [...adults].sort((x, y) => y.happiness - x.happiness)[0];
    const eldest = [...s.agents].sort((x, y) => y.age - x.age)[0];
    const mostDevout = [...adults].sort((x, y) => y.religiosity - x.religiosity)[0];
    return `<h3>Who's Who</h3>
      <div class="empty">Click anyone or any building in the town to read their profile.</div>
      <div class="kv">
        <span class="k">Head of State</span><span class="v">${agentLink(sim.agent(s.gov.leaderId))}</span>
        <span class="k">Wealthiest Family</span><span class="v">${agentLink(sim.agent(richestHh?.members[0]))}</span>
        <span class="k">Most Grieved</span><span class="v">${agentLink(angriest)}</span>
        <span class="k">Happiest</span><span class="v">${agentLink(happiest)}</span>
        <span class="k">Most Devout</span><span class="v">${agentLink(mostDevout)}</span>
        <span class="k">Eldest Citizen</span><span class="v">${agentLink(eldest)}</span>
      </div>`;
  }

  private agentHtml(a: Agent) {
    const sim = this.sim, s = sim.state;
    const hh = sim.household(a.householdId);
    const home = sim.building(hh?.homeId);
    const work = sim.building(a.workplaceId);
    const f = sim.faction(a.factionId);
    const n = a.needs;
    const needs: [string, number][] = [
      ['Food', n.food], ['Health', n.health], ['Comfort', n.comfort], ['Purpose', n.purpose],
      ['Culture', n.culture], ['Social', n.social], ['Safety', n.safety], ['Freedom', n.freedom], ['Rest', n.rest],
    ];
    const P = a.personality;
    const pers: [string, number][] = [['Openness', P.O], ['Conscientious', P.C], ['Extraversion', P.E], ['Agreeable', P.A], ['Neuroticism', P.N]];
    const isLeader = s.gov.leaderId === a.id;
    const fam = hh ? hh.members.filter(id => id !== a.id).map(id => agentLink(sim.agent(id))).join(', ') : '';
    const status = a.jailedUntil > s.day ? `<span class="pill dark">jailed ${a.jailedUntil - s.day}d</span>` : '';
    return `
      <div class="profile-head">
        <div style="flex:1 1 auto;min-width:0">
          <h2>${esc(a.name)}${isLeader ? ' <span class="pill blue">leader</span>' : ''}${status}</h2>
          <div class="sub">${a.sex === 'M' ? 'Man' : 'Woman'}, ${Math.floor(a.age)} · <span style="color:${JOB_COLORS[a.job]}">●</span> ${a.job.replace('_', ' ')}, ${a.activity}</div>
        </div>
        <div class="acts"><button data-action="follow" class="icon-btn ${this.world.follow ? 'active' : ''}" title="Follow with the camera (F)">${ICONS.follow}</button><button data-action="deselect" class="icon-btn" title="Close (Esc)">${ICONS.close}</button></div>
      </div>
      <div class="inspector">
      <h3>Social Identity &amp; Household</h3>
      <div class="kv">
        <span class="k">Class / Subculture</span><span class="v"><b style="color:${CLASS_COLORS[a.classIdentity]}">${a.classIdentity}</b> · ${a.subculture.replace('_', ' ')}</span>
        <span class="k">Home</span><span class="v">${home ? `<span class="link" data-building="${home.id}">${home.type} #${home.id}</span> · ${districtName(sim, home.pos)}` : '<b style="color:var(--danger)">homeless</b>'}</span>
        <span class="k">Workplace</span><span class="v">${work ? `<span class="link" data-building="${work.id}">${work.type.replace('_', ' ')} #${work.id}</span>` : '—'}</span>
        <span class="k">Partner</span><span class="v">${agentLink(sim.agent(a.partnerId))}</span>
        <span class="k">Parents</span><span class="v">${a.parents.length ? a.parents.map(id => sim.agent(id) ? agentLink(sim.agent(id)) : '<span class="muted">deceased</span>').join(', ') : '—'}</span>
        <span class="k">Children</span><span class="v">${a.children.map(id => sim.agent(id)).filter(Boolean).map(c => agentLink(c)).join(', ') || '—'}</span>
        <span class="k">Household</span><span class="v">${fam || 'lives alone'}</span>
        ${s.policy.allocation !== 'commons' ? `<span class="k">Cash / Debt</span><span class="v">${num(hh?.money ?? 0)} / <span style="color:${(hh?.debt ?? 0) > 20 ? 'var(--danger)' : 'inherit'}">${num(hh?.debt ?? 0)}</span></span>` : ''}
        <span class="k">Food / Goods / Luxury</span><span class="v">${(hh?.food ?? 0).toFixed(1)} / ${(hh?.goods ?? 0).toFixed(1)} / ${(hh?.luxury ?? 0).toFixed(1)}</span>
        <span class="k">Daily income</span><span class="v">${a.income.toFixed(2)}</span>
        ${a.unemployedDays > 0 ? `<span class="k">Days unemployed</span><span class="v" style="color:var(--danger)">${a.unemployedDays}d</span>` : ''}
        <span class="k">Skill / Edu / Faith</span><span class="v">${pct(a.skill)} / ${pct(a.education)} / ${pct(a.religiosity)}</span>
      </div>
      <h3>Wellbeing &amp; Needs</h3>
      ${needs.map(([k, v]) => `<div class="need-row"><span>${k}</span>${bar(v, needColor(v))}<span>${pct(v)}</span></div>`).join('')}
      <div class="need-row" style="margin-top:6px"><span><b>Happiness</b></span>${bar(a.happiness, needColor(a.happiness))}<span>${pct(a.happiness)}</span></div>
      <h3>Politics &amp; Ideology</h3>
      <div class="need-row"><span>Approval</span>${bar(a.approval, '#3b5bdb')}<span>${pct(a.approval)}</span></div>
      <div class="need-row"><span>Grievance</span>${bar(a.grievance, '#e03131')}<span>${pct(a.grievance)}</span></div>
      <div class="need-row"><span>Fear</span>${bar(a.fear, '#495057')}<span>${pct(a.fear)}</span></div>
      <div class="kv" style="margin-top:4px"><span class="k">Faction</span><span class="v">${f ? `<span style="color:${f.color}">●</span> ${esc(f.name)} (${pct(a.commitment)})` : '—'}</span></div>
      <div class="muted" style="font-size:11px;margin-top:6px">${describePlatform(a.beliefs)} · bar = government</div>
      ${this.beliefAxes(a.beliefs, s.gov.position, f?.color ?? '#222')}
      <h3>Personality</h3>
      ${pers.map(([k, v]) => `<div class="need-row"><span>${k}</span>${bar(v, '#868e96')}<span>${pct(v)}</span></div>`).join('')}
      <h3>Friends (${a.friends.length})</h3>
      <div style="line-height:1.6">${a.friends.map(id => agentLink(sim.agent(id))).join(', ') || '<span class="muted">none</span>'}</div>
      <h3>Memories</h3>
      ${a.memory.length ? [...a.memory].reverse().map(m => `<div class="memory"><span class="t">Y${Math.floor(m.day / DAYS_PER_YEAR)}</span>${esc(m.text)}</div>`).join('') : '<div class="empty">Nothing notable yet.</div>'}
      </div>`;
  }

  private buildingHtml(b: Building) {
    const sim = this.sim;
    const owner = sim.household(b.ownerHouseholdId);
    const ownerText = b.ownerKind === 'private' ? (owner ? `${agentLink(sim.agent(owner.members[0]))} family` : 'private (unowned)') : b.ownerKind === 'state' ? 'the state' : 'worker collective';
    const workers = b.workers.map(id => sim.agent(id)).filter((x): x is Agent => !!x);
    const residents = b.residents.flatMap(id => sim.household(id)?.members ?? []).map(id => sim.agent(id)).filter((x): x is Agent => !!x);
    const spec = BUILDING_PRODUCTION[b.type];
    const isHome = b.type === 'house' || b.type === 'tenement' || b.type === 'manor';
    return `
      <div class="profile-head">
        <div style="flex:1 1 auto;min-width:0">
          <h2 style="text-transform:capitalize">The ${b.type.replace('_', ' ')}</h2>
          <div class="sub">No. ${b.id} · ${districtName(sim, b.pos)}${b.complete ? '' : ' · under construction'}</div>
        </div>
        <div class="acts"><button data-action="deselect" class="icon-btn" title="Close (Esc)">${ICONS.close}</button></div>
      </div>
      <div class="inspector">
      ${!b.complete ? `<div class="muted" style="margin-top:10px">Construction progress</div>${bar(b.progress, 'var(--ochre)')}` : ''}
      <div class="kv" style="margin-top:10px">
        <span class="k">Condition</span><span class="v">${pct(b.condition ?? 1)}</span>
        <span class="k">Owned by</span><span class="v">${ownerText}</span>
        ${spec ? `<span class="k">Produces</span><span class="v"><b>${spec.good}</b> (${b.output.toFixed(1)}/d)</span>` : ''}
        ${spec?.input ? `<span class="k">Input stock (${spec.input})</span><span class="v">${b.inputStock.toFixed(1)}</span>` : ''}
        ${spec ? `<span class="k">Tool condition</span><span class="v">${b.tools.toFixed(1)}</span>` : ''}
        ${spec && sim.state.policy.allocation === 'planned' ? `<span class="k">Gosplan quota</span><span class="v">${b.output.toFixed(1)} / ${b.quota.toFixed(1)}</span>` : ''}
        ${spec && sim.state.policy.allocation === 'market' ? `<span class="k">Inventory stock</span><span class="v">${b.stock.toFixed(1)}</span><span class="k">Firm cash</span><span class="v">${num(b.cash)}</span><span class="k">Daily wage</span><span class="v">${b.wage.toFixed(2)}</span>` : ''}
        ${isHome ? `<span class="k">Occupants</span><span class="v">${residents.length} / ${b.capacity}</span>` : ''}
      </div>
      ${workers.length ? `<h3>Staff / Workers (${workers.length}/${b.capacity || 6})</h3><div style="line-height:1.6">${workers.map(agentLink).join(', ')}</div>` : ''}
      ${residents.length ? `<h3>Residents (${residents.length})</h3><div style="line-height:1.6">${residents.map(agentLink).join(', ')}</div>` : ''}
      </div>`;
  }

  dispose() {
    this.unsubscribe?.();
    window.removeEventListener('pointerup', this.onPointerUp);
    this.label.remove();
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
  }
}
