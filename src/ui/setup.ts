import { IDEOLOGY_PRESETS, SIZE_PRESETS, clonePolicy, cloneCulture } from '../sim/presets';
import type { WorldConfig } from '../sim/types';
import { CULTURE_FIELDS, POLICY_FIELDS, flattenCulture, renderFields, unflattenCulture } from './controls';
import { ICONS } from './icons';

export function showSetup(
  root: HTMLElement,
  opts: {
    onStart: (c: WorldConfig) => void;
    onPreview?: (c: WorldConfig) => void;
    onLoad: (json: string) => void;
    hasAutosave: boolean;
    onResume?: () => void;
  },
) {
  let size = SIZE_PRESETS[2];
  let ideology = IDEOLOGY_PRESETS[0];
  let policy = clonePolicy(ideology.policy);
  let culture = flattenCulture(ideology.culture);
  let population = size.population;
  let seed = Math.floor(Math.random() * 1e9);

  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="front">
      <div class="front-inner">
        <header class="front-mast">
          <div class="ears"><span>A society sandbox</span><span>Founding edition</span></div>
          <h1>Poli<i>Sim</i></h1>
          <div class="dateline"><span>Property</span><span>Markets &amp; plans</span><span>Parties &amp; parliaments</span><span>Riots &amp; revolutions</span></div>
        </header>

        <section class="lede">
          <h2>Write a constitution, found a town, and watch what its people make of it.</h2>
          <p>Choose who owns the land, whether prices or planners decide, and who gets a vote. Then hundreds of citizens work, marry, worship, organise, vote, strike and sometimes revolt. Every system has its own way of failing; this paper reports on all of them.</p>
        </section>

        <section class="front-section">
          <h3>The Settlement <small>How many founders</small></h3>
          <div class="sizes" id="size-cards"></div>
        </section>

        <section class="front-section">
          <h3>The Founding Charter <small>Ownership, allocation, government and culture</small></h3>
          <div class="charters" id="ideology-cards"></div>
          <div class="brief" id="brief"></div>
        </section>

        <details class="advanced" id="advanced">
          <summary>Amend the charter</summary>
          <div class="grid-2">
            <div><h3>Institutions, Economy &amp; Fiscal Policy</h3><div id="policy-fields"></div></div>
            <div>
              <h3>Culture, Faith &amp; Starting Beliefs</h3><div id="culture-fields"></div>
              <h3>World Generation</h3>
              <div class="slider-row" title="Starting number of people"><label>Population</label><input id="pop" type="range" min="30" max="2000" step="10"><span class="val" id="pop-val"></span></div>
              <div class="slider-row" title="Random seed: same seed and settings give the same starting world"><label>World seed</label><input id="seed" type="number" class="seed-input"></div>
            </div>
          </div>
        </details>

        <div class="setup-actions">
          <button class="primary launch-btn" id="start">Found the town ${ICONS.arrow}</button>
          ${opts.hasAutosave && opts.onResume ? '<button class="secondary-btn" id="resume">Resume saved town</button>' : ''}
          <button class="secondary-btn" id="load">Load a save file…</button>
          <input type="file" id="file" accept=".json,application/json" class="hidden">
          <span class="launch-summary" id="summary"></span>
        </div>
      </div>
    </div>
    <div class="window-caption">A live preview of the town your charter would build</div>`;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
  const sizeCards = $('#size-cards'), ideoCards = $('#ideology-cards');
  const popInput = $<HTMLInputElement>('#pop'), popVal = $('#pop-val'), seedInput = $<HTMLInputElement>('#seed');

  const currentConfig = (): WorldConfig => ({
    sizePreset: size.id, ideologyPreset: ideology.id, population, seed,
    policy: clonePolicy(policy), culture: unflattenCulture(culture),
  });

  const renderCards = () => {
    sizeCards.innerHTML = '';
    for (const s of SIZE_PRESETS) {
      const c = document.createElement('div');
      c.className = 'size-opt' + (s === size ? ' selected' : '');
      c.tabIndex = 0;
      c.innerHTML = `<div class="num">${s.population}</div><div class="nm">${s.name}</div><div class="ds">${s.description}</div>`;
      c.onclick = () => { size = s; population = s.population; renderCards(); syncWorld(); };
      c.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); c.click(); } };
      sizeCards.append(c);
    }
    ideoCards.innerHTML = '';
    for (const p of IDEOLOGY_PRESETS) {
      const c = document.createElement('div');
      c.className = 'charter' + (p === ideology ? ' selected' : '');
      c.tabIndex = 0;
      c.onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); c.click(); } };
      c.innerHTML = `<div class="nm">${p.name}</div><div class="tg">${p.tag}</div><div class="ds">${p.description}</div>`;
      c.onclick = () => {
        ideology = p;
        policy = clonePolicy(p.policy);
        culture = flattenCulture(cloneCulture(p.culture));
        renderCards(); renderAdvanced(); syncWorld();
        opts.onPreview?.(currentConfig());
      };
      ideoCards.append(c);
    }
  };

  const renderAdvanced = () => {
    renderFields($('#policy-fields'), POLICY_FIELDS, policy, (k, v) => { (policy as unknown as Record<string, unknown>)[k as string] = v; syncWorld(); }, { includeSetupOnly: true });
    renderFields($('#culture-fields'), CULTURE_FIELDS, culture, (k, v) => { (culture as unknown as Record<string, unknown>)[k as string] = v; });
  };

  const syncWorld = () => {
    popInput.value = String(population); popVal.textContent = String(population); seedInput.value = String(seed);
    $('#summary').textContent = `A ${size.name.toLowerCase()} of ${population} under ${ideology.name}`;
    const p = policy;
    const gov = { none: 'No state', council: 'Open councils', democracy: `Elected (${p.electoralSystem.toUpperCase()})`, autocracy: 'One-party rule', monarchy: 'Hereditary crown' }[p.governance];
    const pc = (v: number) => `${Math.round(v * 100)}%`;
    $('#brief').innerHTML = `<div class="nm">${ideology.name}</div><div class="muted" style="font-family:var(--serif);font-style:italic">${ideology.tag}</div>
      <div class="facts"><span>Government <b>${gov}</b></span><span>Property <b>${p.ownership}</b></span><span>Allocation <b>${p.allocation}</b></span>
      <span>Tax <b>${pc(p.taxRate)}</b></span><span>Welfare <b>${pc(p.welfare)}</b></span><span>Civil liberty <b>${pc(p.civilLiberty)}</b></span><span>Press <b>${pc(p.pressFreedom)}</b></span></div>`;
  };

  popInput.oninput = () => { population = Number(popInput.value); popVal.textContent = String(population); syncWorld(); };
  seedInput.onchange = () => { seed = Number(seedInput.value) || 1; };

  renderCards(); renderAdvanced(); syncWorld();

  $('#start').onclick = () => {
    root.classList.add('hidden');
    opts.onStart(currentConfig());
  };
  const resume = root.querySelector('#resume') as HTMLButtonElement | null;
  if (resume) resume.onclick = () => { root.classList.add('hidden'); opts.onResume!(); };
  const file = $<HTMLInputElement>('#file');
  $('#load').onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files?.[0];
    if (!f) return;
    const text = await f.text();
    root.classList.add('hidden');
    opts.onLoad(text);
  };
}
