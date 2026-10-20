import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource-variable/public-sans';
import './style.css';
import { Simulation } from './sim/simulation';
import { IDEOLOGY_PRESETS, clonePolicy, cloneCulture } from './sim/presets';
import { WorldRenderer } from './render/world';
import { Hud, SPEEDS } from './ui/hud';
import { showSetup } from './ui/setup';
import { Cinematics } from './ui/cinematics';
import type { WorldConfig } from './sim/types';

const SAVE_KEY = 'polisim.save.v2';
const viewport = document.getElementById('viewport')!;
const hudEl = document.getElementById('hud')!;
const setupEl = document.getElementById('setup')!;
const tooltip = document.getElementById('tooltip')!;

let sim: Simulation | null = null;
let world: WorldRenderer | null = null;
let hud: Hud | null = null;
let speedIndex = 2;
let tickAcc = 0;
let paused = false;
let inMenu = true;
/** Paused while a cinematic scene plays; independent of the chosen speed so it resumes after. */
let cinePaused = false;
const cine = new Cinematics({
  pause: () => { cinePaused = true; tickAcc = 0; },
  resume: () => { cinePaused = false; },
  onPrefsChange: () => hud?.renderCinePrefs(),
});

function toast(text: string) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), 2200);
}

function createPreviewSim(c?: WorldConfig): Simulation {
  const p = IDEOLOGY_PRESETS[0];
  return Simulation.create(c ?? {
    sizePreset: 'village', ideologyPreset: p.id, population: 140, seed: 4242,
    policy: clonePolicy(p.policy), culture: cloneCulture(p.culture),
  });
}

function begin(next: Simulation) {
  sim = next;
  paused = false;
  inMenu = false;
  if (!world) world = new WorldRenderer(viewport, sim);
  else world.setSimulation(sim);
  world.cinematicOrbit = false;
  world.camera.position.set(78, 82, 102);
  world.controls.target.set(0, 0, 0);

  cine.close();
  sim.listeners.push(e => { if (!inMenu) cine.offer(e); });
  if (!hud) {
    hud = new Hud(hudEl, sim, world, {
      onSpeed: i => { speedIndex = i; },
      onSave: save,
      onExport: exportSave,
      onNew: () => { paused = true; cine.close(); showMenu(); },
    }, cine);
  } else {
    hudEl.classList.remove('hidden');
    hud.attach(sim);
  }
  hud.setSpeed(speedIndex === 0 ? 2 : speedIndex);
  if (import.meta.env.DEV) Object.assign(window, { polisim: { sim, world, hud } });
}

function showMenu() {
  inMenu = true;
  hudEl.classList.add('hidden');
  if (!sim) {
    sim = createPreviewSim();
  }
  if (!world) world = new WorldRenderer(viewport, sim);
  world.cinematicOrbit = true;

  showSetup(setupEl, {
    hasAutosave: !!localStorage.getItem(SAVE_KEY),
    onStart: (c: WorldConfig) => begin(Simulation.create(c)),
    onPreview: (c: WorldConfig) => {
      if (!inMenu) return;
      sim = createPreviewSim({ ...c, population: Math.min(180, c.population) });
      world!.setSimulation(sim);
      world!.cinematicOrbit = true;
    },
    onResume: () => load(localStorage.getItem(SAVE_KEY)!),
    onLoad: load,
  });

  if (hud) {
    const back = document.createElement('button');
    back.className = 'secondary-btn';
    back.textContent = 'Return to Active World';
    back.onclick = () => {
      setupEl.classList.add('hidden');
      hudEl.classList.remove('hidden');
      world!.cinematicOrbit = false;
      inMenu = false;
      paused = false;
    };
    setupEl.querySelector('.setup-actions')?.append(back);
  }
}

function save() {
  if (!sim) return;
  try { localStorage.setItem(SAVE_KEY, sim.serialize()); toast('Saved to browser storage.'); }
  catch { toast('Save failed (storage full?). Try Export instead.'); }
}

function exportSave() {
  if (!sim) return;
  const blob = new Blob([sim.serialize()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `polisim-${sim.state.config.ideologyPreset}-y${sim.year()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function load(json: string) {
  try { begin(Simulation.deserialize(json)); toast('Save loaded.'); }
  catch (e) { toast(`Could not load save: ${(e as Error).message}`); showMenu(); }
}

// ---------------------------------------------------------------- main loop

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim && world) {
    if (inMenu) {
      // Gentle live diorama animation behind the title screen
      tickAcc += 0.35 * dt * 60;
      while (tickAcc >= 1) { sim.tick(); tickAcc -= 1; }
      world.render(dt);
    } else if (hud) {
      if (!paused && !cinePaused && speedIndex > 0) {
        tickAcc += SPEEDS[speedIndex] * dt * 60;
        const budgetEnd = performance.now() + 24;
        while (tickAcc >= 1) {
          sim.tick();
          tickAcc -= 1;
          if (cinePaused) { tickAcc = 0; break; } // a scene started mid-batch: freeze right here
          if (performance.now() > budgetEnd) { tickAcc = Math.min(tickAcc, SPEEDS[speedIndex]); break; }
        }
      }
      world.render(dt);
      hud.update(now);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- input

let downAt: { x: number; y: number } | null = null;
viewport.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY }; });
viewport.addEventListener('pointerup', e => {
  if (inMenu || !downAt || !world || !hud || e.button !== 0) return;
  const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
  downAt = null;
  if (moved > 5) return;
  const p = world.pick(e.clientX, e.clientY);
  if (p?.kind === 'agent') hud.selectAgent(p.id);
  else if (p?.kind === 'building') hud.selectBuilding(p.id);
  else { world.selectedAgentId = null; world.selectedBuildingId = null; world.follow = false; hud.renderInspector(); }
});

let lastHover = 0;
viewport.addEventListener('pointermove', e => {
  if (inMenu || !world || !sim || e.buttons) { tooltip.classList.add('hidden'); return; }
  const now = performance.now();
  if (now - lastHover < 70) return;
  lastHover = now;
  const p = world.pick(e.clientX, e.clientY);
  let html = '';
  if (p?.kind === 'agent') {
    const a = sim.agent(p.id);
    const f = sim.faction(a?.factionId);
    if (a) html = `<b>${a.name}</b>, ${Math.floor(a.age)} (${a.classIdentity})<br>${a.job.replace('_', ' ')} · ${a.activity}${f ? `<br><span style="color:${f.color}">●</span> ${f.name}` : ''}`;
  } else if (p?.kind === 'building') {
    const b = sim.building(p.id);
    if (b) {
      const isHome = b.type === 'house' || b.type === 'tenement' || b.type === 'manor';
      const people = isHome ? `${b.residents.reduce((t, id) => t + (sim!.household(id)?.members.length ?? 0), 0)} residents` : b.workers.length ? `${b.workers.length} staff` : '';
      html = `<b style="text-transform:capitalize">${b.type.replace('_', ' ')}</b>${b.complete ? '' : ' (building)'}${people ? `<br>${people}` : ''}`;
    }
  }
  if (!html) { tooltip.classList.add('hidden'); return; }
  tooltip.innerHTML = html;
  tooltip.classList.remove('hidden');
  tooltip.style.left = `${Math.min(window.innerWidth - 270, e.clientX + 14)}px`;
  tooltip.style.top = `${Math.min(window.innerHeight - 80, e.clientY + 14)}px`;
});
viewport.addEventListener('pointerleave', () => tooltip.classList.add('hidden'));

window.addEventListener('keydown', e => {
  if (cine.playing && (e.code === 'Space' || e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); cine.close(); return; }
  if (inMenu || !hud || !world || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); hud.setSpeed(speedIndex === 0 ? 2 : 0); }
  else if (e.key === 'c') hud.toggleCinematics();
  else if (e.key >= '1' && e.key <= '5') hud.setSpeed(Number(e.key));
  else if (e.key === 'Escape') {
    // Close the innermost thing first: a selection, then an open drawer
    if (world.selectedAgentId != null || world.selectedBuildingId != null) { world.selectedAgentId = null; world.selectedBuildingId = null; world.follow = false; hud.renderInspector(); }
    else if (hud.drawerOpen) hud.setTab(null);
  }
  else if (e.key === 'f') { world.follow = !world.follow; hud.renderInspector(); }
  else if (e.key === 'h') hud.toggleLite();
  else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) hud.toggleDrawerByKey(e.key);
});

setInterval(() => { if (sim && !paused && !inMenu) { try { localStorage.setItem(SAVE_KEY, sim.serialize()); } catch { /* storage full */ } } }, 60000);

showMenu();
