import { IDEOLOGY_PRESETS, SIZE_PRESETS, clonePolicy, cloneCulture } from '../sim/presets';
import type { WorldConfig } from '../sim/types';
import { CULTURE_FIELDS, POLICY_FIELDS, flattenCulture, renderFields, unflattenCulture } from './controls';

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
    <div class="title-screen">
      <div class="title-bg-glow"></div>
      <div class="title-particles" id="title-particles"></div>
      <div class="setup-inner">
        <header class="hero-header">
          <div class="hero-badge">POLITICAL · ECONOMIC · SOCIAL SANDBOX</div>
          <h1 class="hero-title">POLI<span>SIM</span></h1>
          <p class="hero-subtitle">
            Architect a civilization from the ground up. Choose its property laws, economic allocation, governance, and cultural soul—then watch hundreds of autonomous citizens work, trade, worship, conspire, and revolt in a living 3D world.
          </p>
        </header>

        <div class="setup-section">
          <div class="section-header">
            <h3>1. Select World Scale</h3>
            <span class="section-hint">From an intimate rural hamlet to an industrial city</span>
          </div>
          <div class="cards size-grid" id="size-cards"></div>
        </div>

        <div class="setup-section">
          <div class="section-header">
            <h3>2. Choose Founding Ideology</h3>
            <span class="section-hint">Sets initial ownership, markets vs. Gosplan quotas, state structure, and cultural norms</span>
          </div>
          <div class="cards ideology-grid" id="ideology-cards"></div>
        </div>

        <details class="advanced" id="advanced">
          <summary>Fine-Tune Constitutional & Cultural Parameters</summary>
          <div class="grid-2">
            <div><h3>Institutions, Economy & Fiscal Policy</h3><div id="policy-fields"></div></div>
            <div>
              <h3>Culture, Faith & Starting Beliefs</h3><div id="culture-fields"></div>
              <h3>World Generation</h3>
              <div class="slider-row" title="Starting number of people"><label>Population</label><input id="pop" type="range" min="30" max="2000" step="10"><span class="val" id="pop-val"></span></div>
              <div class="slider-row" title="Random seed: same seed and settings give the same starting world"><label>World Seed</label><input id="seed" type="number" class="seed-input"></div>
            </div>
          </div>
        </details>

        <div class="setup-actions">
          <button class="primary launch-btn" id="start">Launch Civilization</button>
          ${opts.hasAutosave && opts.onResume ? '<button class="secondary-btn" id="resume">Resume Saved World</button>' : ''}
          <button class="secondary-btn" id="load">Load Save File…</button>
          <input type="file" id="file" accept=".json,application/json" class="hidden">
          <span class="launch-summary" id="summary"></span>
        </div>
      </div>
    </div>`;

  // Create subtle floating ambient particles in title screen
  const partContainer = root.querySelector('#title-particles')!;
  for (let i = 0; i < 18; i++) {
    const dot = document.createElement('span');
    dot.className = 'particle';
    dot.style.left = `${(i * 19 + 7) % 96}%`;
    dot.style.top = `${(i * 29 + 11) % 92}%`;
    dot.style.animationDelay = `${-(i * 1.3)}s`;
    dot.style.animationDuration = `${12 + (i % 7) * 2.5}s`;
    partContainer.append(dot);
  }

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
      c.className = 'card' + (s === size ? ' selected' : '');
      c.innerHTML = `<div class="card-top"><h4>${s.name}</h4><span class="tag">~${s.population} citizens</span></div><p>${s.description}</p>`;
      c.onclick = () => { size = s; population = s.population; renderCards(); syncWorld(); };
      sizeCards.append(c);
    }
    ideoCards.innerHTML = '';
    for (const p of IDEOLOGY_PRESETS) {
      const c = document.createElement('div');
      c.className = 'card' + (p === ideology ? ' selected' : '');
      c.innerHTML = `<div class="card-top"><h4>${p.name}</h4><span class="tag">${p.tag}</span></div><p>${p.description}</p>`;
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
    renderFields($('#policy-fields'), POLICY_FIELDS, policy, (k, v) => { (policy as unknown as Record<string, unknown>)[k as string] = v; }, { includeSetupOnly: true });
    renderFields($('#culture-fields'), CULTURE_FIELDS, culture, (k, v) => { (culture as unknown as Record<string, unknown>)[k as string] = v; });
  };

  const syncWorld = () => {
    popInput.value = String(population); popVal.textContent = String(population); seedInput.value = String(seed);
    $('#summary').textContent = `${size.name} (${population} citizens) · ${ideology.name}`;
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
