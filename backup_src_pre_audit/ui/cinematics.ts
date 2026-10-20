import type { Scene, SceneKind, SimEvent } from '../sim/types';

/**
 * Cinematic "skits": when a dramatic event fires, the simulation pauses and a short animated
 * vignette plays out the event on a 2D stage. Purely presentational — the sim never depends on it.
 */

export type SceneCategory = 'major' | 'unrest' | 'politics' | 'nature' | 'festivals';

export const SCENE_CATEGORIES: { id: SceneCategory; label: string; help: string }[] = [
  { id: 'major', label: 'Regime change', help: 'Revolutions, uprisings, coups, martial law, coronations' },
  { id: 'unrest', label: 'Unrest', help: 'Riots, crackdowns, strikes, rallies, purges' },
  { id: 'politics', label: 'Politics', help: 'Elections, party mergers & splits, political thaws' },
  { id: 'nature', label: 'Disasters', help: 'Storms, droughts, famine, plague' },
  { id: 'festivals', label: 'Festivals', help: 'Seasonal and civic celebrations' },
];

const CATEGORY: Record<SceneKind, SceneCategory> = {
  revolution: 'major', uprising: 'major', coup: 'major', martial: 'major', coronation: 'major',
  riot: 'unrest', crackdown: 'unrest', strike: 'unrest', rally: 'unrest', purge: 'unrest',
  election: 'politics', merger: 'politics', split: 'politics', reform: 'politics',
  storm: 'nature', drought: 'nature', famine: 'nature', plague: 'nature',
  festival: 'festivals',
};

const TITLES: Record<SceneKind, string> = {
  riot: 'Bread Riot', crackdown: 'Crackdown', strike: 'General Strike', rally: 'Rally in the Plaza',
  uprising: 'Uprising!', revolution: 'Revolution!', coup: 'Military Coup', martial: 'Martial Law',
  purge: 'The Purge', election: 'Election Night', merger: 'Parties Unite', split: 'The Party Splits',
  coronation: 'Coronation', reform: 'Political Thaw', storm: 'Storm', drought: 'Drought',
  festival: 'Festival', famine: 'Famine', plague: 'Plague',
};

/** Minimum sim-days between two scenes of the same kind (so frequent events don't spam). */
const COOLDOWN: Partial<Record<SceneKind, number>> = {
  rally: 25, strike: 20, crackdown: 12, riot: 12, purge: 20, festival: 60, storm: 25, drought: 40, merger: 15, split: 15, reform: 30,
};
/** Higher-priority scenes may interrupt a lower-priority one that is already playing. */
const PRIORITY: Partial<Record<SceneKind, number>> = { revolution: 5, coup: 5, uprising: 4, martial: 3, coronation: 3, election: 2 };

const DURATION = 6.5;
const STORE_KEY = 'polisim.cinematics';

// ---------------------------------------------------------------- drawing primitives

type Ctx = CanvasRenderingContext2D;
const rnd = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const seg = (p: number, a: number, b: number) => ease((p - a) / (b - a));

function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) return [120, 130, 145];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number) {
  const [r1, g1, b1] = hexRgb(a), [r2, g2, b2] = hexRgb(b);
  const k = clamp01(t);
  return `rgb(${Math.round(r1 + (r2 - r1) * k)},${Math.round(g1 + (g2 - g1) * k)},${Math.round(b1 + (b2 - b1) * k)})`;
}

function sky(ctx: Ctx, w: number, h: number, top: string, bottom: string) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function ground(ctx: Ctx, w: number, h: number, gy: number, color: string) {
  ctx.fillStyle = color; ctx.fillRect(0, gy, w, h - gy);
}

interface PersonOpts { phase?: number; arm?: number; fallen?: number; sign?: string; flag?: string; shield?: boolean; hat?: 'helmet' | 'crown' | 'cap' | 'beak'; lean?: number; alpha?: number; bowl?: boolean; torch?: boolean }

/** A capsule-bodied citizen matching the 3D world's minimal style. */
function person(ctx: Ctx, x: number, gy: number, s: number, color: string, o: PersonOpts = {}) {
  ctx.save();
  ctx.globalAlpha *= o.alpha ?? 1;
  ctx.translate(x, gy);
  if (o.fallen) ctx.rotate(-Math.PI / 2 * o.fallen);
  if (o.lean) ctx.rotate(o.lean);
  const ph = o.phase ?? 0;
  const swing = Math.sin(ph) * 0.35 * s;
  ctx.strokeStyle = '#3d4250'; ctx.lineWidth = s * 0.16; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-s * 0.1, -s * 0.55); ctx.lineTo(-s * 0.1 + swing, 0);
  ctx.moveTo(s * 0.1, -s * 0.55); ctx.lineTo(s * 0.1 - swing, 0); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.roundRect(-s * 0.24, -s * 1.25, s * 0.48, s * 0.78, s * 0.2); ctx.fill();
  // arms
  const arm = o.arm ?? 0;
  ctx.strokeStyle = color; ctx.lineWidth = s * 0.14;
  const ax = s * 0.22, ay = -s * 1.1;
  const hx = ax + s * 0.25 * (1 - arm), hy = ay + s * 0.45 * (1 - arm) - s * 0.55 * arm;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(hx, hy); ctx.moveTo(-ax, ay); ctx.lineTo(-ax - s * 0.2 - swing * 0.3, ay + s * 0.42); ctx.stroke();
  if (o.sign || o.flag) {
    ctx.strokeStyle = '#6b5a45'; ctx.lineWidth = s * 0.07;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx, hy - s * 0.9); ctx.stroke();
    ctx.fillStyle = o.sign ?? o.flag!;
    if (o.sign) ctx.fillRect(hx - s * 0.32, hy - s * 1.25, s * 0.64, s * 0.42);
    else {
      const wv = Math.sin(ph * 0.7) * s * 0.08;
      ctx.beginPath(); ctx.moveTo(hx, hy - s * 0.9); ctx.quadraticCurveTo(hx + s * 0.3, hy - s * 0.85 + wv, hx + s * 0.6, hy - s * 0.9);
      ctx.lineTo(hx + s * 0.6, hy - s * 0.55); ctx.quadraticCurveTo(hx + s * 0.3, hy - s * 0.5 + wv, hx, hy - s * 0.55); ctx.fill();
    }
  }
  if (o.torch) {
    ctx.fillStyle = '#ffb703';
    ctx.beginPath(); ctx.arc(hx, hy - s * 0.12, s * (0.14 + 0.04 * Math.sin(ph * 3)), 0, Math.PI * 2); ctx.fill();
  }
  if (o.bowl) { ctx.fillStyle = '#c9b79c'; ctx.beginPath(); ctx.ellipse(hx, hy, s * 0.16, s * 0.07, 0, 0, Math.PI * 2); ctx.fill(); }
  if (o.shield) { ctx.fillStyle = 'rgba(210,220,235,0.85)'; ctx.strokeStyle = '#2b3048'; ctx.lineWidth = s * 0.05; ctx.beginPath(); ctx.roundRect(-s * 0.55, -s * 1.3, s * 0.38, s * 1.0, s * 0.08); ctx.fill(); ctx.stroke(); }
  // head
  ctx.fillStyle = '#f6eee2';
  ctx.beginPath(); ctx.arc(0, -s * 1.48, s * 0.24, 0, Math.PI * 2); ctx.fill();
  if (o.hat === 'helmet') { ctx.fillStyle = '#2b3048'; ctx.beginPath(); ctx.arc(0, -s * 1.52, s * 0.26, Math.PI, 0); ctx.fill(); }
  else if (o.hat === 'cap') { ctx.fillStyle = '#495057'; ctx.fillRect(-s * 0.26, -s * 1.74, s * 0.52, s * 0.12); }
  else if (o.hat === 'beak') { ctx.fillStyle = '#212529'; ctx.beginPath(); ctx.moveTo(s * 0.15, -s * 1.5); ctx.lineTo(s * 0.55, -s * 1.38); ctx.lineTo(s * 0.15, -s * 1.38); ctx.fill(); }
  else if (o.hat === 'crown') crown(ctx, 0, -s * 1.7, s * 0.5);
  ctx.restore();
}

function crown(ctx: Ctx, x: number, y: number, w: number) {
  ctx.fillStyle = '#fcc419'; ctx.strokeStyle = '#e67700'; ctx.lineWidth = w * 0.06;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + w * 0.3); ctx.lineTo(x - w / 2, y - w * 0.1); ctx.lineTo(x - w / 4, y + w * 0.1); ctx.lineTo(x, y - w * 0.25);
  ctx.lineTo(x + w / 4, y + w * 0.1); ctx.lineTo(x + w / 2, y - w * 0.1); ctx.lineTo(x + w / 2, y + w * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
}

interface BuildingOpts { roof?: 'gable' | 'flat' | 'dome'; lit?: number; chimney?: boolean; columns?: boolean; broken?: number; door?: number }
function building(ctx: Ctx, x: number, gy: number, w: number, h: number, color: string, o: BuildingOpts = {}) {
  ctx.fillStyle = color;
  ctx.fillRect(x, gy - h, w, h);
  if (o.roof === 'gable') { ctx.fillStyle = mix(color, '#5c3d2e', 0.55); ctx.beginPath(); ctx.moveTo(x - w * 0.06, gy - h); ctx.lineTo(x + w / 2, gy - h - w * 0.35); ctx.lineTo(x + w * 1.06, gy - h); ctx.fill(); }
  else if (o.roof === 'dome') { ctx.fillStyle = mix(color, '#748ffc', 0.4); ctx.beginPath(); ctx.arc(x + w / 2, gy - h, w * 0.28, Math.PI, 0); ctx.fill(); }
  else { ctx.fillStyle = mix(color, '#000000', 0.15); ctx.fillRect(x - 3, gy - h - 5, w + 6, 5); }
  if (o.chimney) { ctx.fillStyle = '#6c6f78'; ctx.fillRect(x + w * 0.72, gy - h - w * 0.45, w * 0.12, w * 0.45); }
  if (o.columns) { ctx.fillStyle = 'rgba(255,255,255,0.55)'; for (let i = 0; i < 4; i++) ctx.fillRect(x + w * (0.12 + i * 0.22), gy - h * 0.62, w * 0.07, h * 0.62); }
  const cols = Math.max(2, Math.floor(w / 22)), rows = Math.max(1, Math.floor(h / 26));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const wx = x + (c + 0.5) * (w / cols) - 5, wy = gy - h + 10 + r * 24;
    if (wy > gy - 22) continue;
    const id = r * 17 + c * 31 + Math.round(x);
    const broken = (o.broken ?? 0) > rnd(id);
    ctx.fillStyle = broken ? '#1b1b1f' : rnd(id + 3) < (o.lit ?? 0) ? '#ffe8a3' : 'rgba(60,70,90,0.35)';
    ctx.fillRect(wx, wy, 10, 12);
  }
  if (o.door != null) { ctx.fillStyle = '#3b2f2a'; ctx.fillRect(x + w / 2 - 8, gy - 22, 16, 22); ctx.fillStyle = '#f8f9fa'; ctx.fillRect(x + w / 2 - 8, gy - 22, 16 * (1 - o.door), 22); }
}

function flag(ctx: Ctx, x: number, gy: number, poleH: number, color: string | undefined, raise: number, t: number) {
  ctx.strokeStyle = '#495057'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x, gy - poleH); ctx.stroke();
  if (!color || raise <= 0) return;
  const top = gy - poleH * (0.35 + 0.65 * raise) ;
  const wv = Math.sin(t * 4) * 4;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.quadraticCurveTo(x + 22, top - 4 + wv, x + 44, top + wv * 0.5);
  ctx.lineTo(x + 44, top + 26 + wv * 0.5); ctx.quadraticCurveTo(x + 22, top + 22 + wv, x, top + 26); ctx.fill();
}

/** Draws the civic hall and returns the y of its roof peak (where a flag pole stands). */
function townhall(ctx: Ctx, cx: number, gy: number, s: number, color = '#e9e4da'): number {
  s = Math.min(s, gy * 0.5); // keep the pediment and flag inside the stage on wide screens
  building(ctx, cx - s * 0.6, gy, s * 1.2, s * 0.62, color, { roof: 'flat', columns: true, door: 0 });
  ctx.fillStyle = mix(color, '#868e96', 0.3);
  ctx.beginPath(); ctx.moveTo(cx - s * 0.66, gy - s * 0.62); ctx.lineTo(cx, gy - s * 0.86); ctx.lineTo(cx + s * 0.66, gy - s * 0.62); ctx.fill();
  return gy - s * 0.86;
}

function burst(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ctx.beginPath(); ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 2.6, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function smoke(ctx: Ctx, x: number, y: number, t: number, n: number, color = 'rgba(80,80,90,0.35)', spread = 1) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const k = ((t * 0.35 + i / n) % 1);
    ctx.beginPath(); ctx.arc(x + Math.sin(i * 1.7 + t) * 10 * spread + k * 26 * spread, y - k * 90, 6 + k * 18, 0, Math.PI * 2); ctx.fill();
  }
}

function banner(ctx: Ctx, cx: number, y: number, text: string, color: string, font: number) {
  ctx.font = `800 ${font}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width + font * 1.2;
  ctx.fillStyle = color; ctx.fillRect(cx - w / 2, y - font, w, font * 1.45);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, y - font * 0.28);
  ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
}

function rain(ctx: Ctx, w: number, h: number, t: number, n: number, slant: number) {
  ctx.strokeStyle = 'rgba(200,215,235,0.55)'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (rnd(i) * w * 1.3 + t * 120 * slant) % (w * 1.3) - w * 0.15;
    const y = (rnd(i + 99) * h + t * 700) % h;
    ctx.moveTo(x, y); ctx.lineTo(x - slant * 8, y + 16);
  }
  ctx.stroke();
}

function crowd(ctx: Ctx, n: number, fn: (i: number) => { x: number; y: number; s: number; color: string; o?: PersonOpts }) {
  const items = Array.from({ length: n }, (_, i) => fn(i)).sort((a, b) => a.y - b.y);
  for (const it of items) person(ctx, it.x, it.y, it.s, it.color, it.o);
}

// ---------------------------------------------------------------- scenes

type Painter = (ctx: Ctx, w: number, h: number, t: number, p: number, sc: Scene) => void;

const SCENES: Record<SceneKind, Painter> = {
  riot(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#2d1f3d', '#f08c3c');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#5a4a42');
    for (let i = 0; i < 3; i++) building(ctx, w * (0.55 + i * 0.15), gy, w * 0.13, h * (0.38 + i * 0.05), '#d9c7b0', { roof: 'gable', lit: 0.5, broken: seg(p, 0.35, 0.9) * 0.8 });
    if (p > 0.5) smoke(ctx, w * 0.7, gy - h * 0.42, t, 10, 'rgba(40,30,30,0.4)', 1.5);
    const n = Math.min(24, Math.max(10, sc.n ?? 14));
    crowd(ctx, n, i => ({ x: w * (-0.05 + rnd(i) * 0.38 + seg(p, 0, 0.6) * 0.18) + Math.sin(t * 3 + i) * 4, y: gy + rnd(i + 7) * h * 0.12, s: h * 0.075, color: mix('#8d6e63', '#c0392b', rnd(i + 3)), o: { phase: t * 9 + i, arm: (Math.sin(t * 5 + i) + 1) / 2, torch: i % 4 === 0 } }));
    for (let k = 0; k < 6; k++) {
      const lt = ((t * 0.8 + k / 6) % 1);
      const sx = w * (0.25 + rnd(k) * 0.12), ex = w * (0.6 + rnd(k + 5) * 0.3);
      ctx.fillStyle = '#3d3d3d';
      ctx.beginPath(); ctx.arc(sx + (ex - sx) * lt, gy - h * 0.12 - Math.sin(lt * Math.PI) * h * 0.3 - lt * h * 0.15, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  },
  crackdown(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#151a2c', '#3a4466');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#3c3f4a');
    building(ctx, w * 0.05, gy, w * 0.2, h * 0.45, '#8a8f9c', { roof: 'flat', lit: 0.3 });
    building(ctx, w * 0.75, gy, w * 0.22, h * 0.5, '#8a8f9c', { roof: 'flat', lit: 0.2 });
    const flash = Math.sin(t * 12) > 0;
    ctx.fillStyle = flash ? 'rgba(255,40,60,0.12)' : 'rgba(40,90,255,0.12)'; ctx.fillRect(0, 0, w, h);
    const color = sc.color ?? '#e03131';
    const n = Math.min(18, Math.max(8, sc.n ?? 12));
    const retreat = seg(p, 0.45, 0.85);
    crowd(ctx, n, i => {
      const fallen = p > 0.55 && i % 5 === 0 ? seg(p, 0.55, 0.65) : 0;
      return { x: w * (0.12 + rnd(i) * 0.25 + seg(p, 0, 0.35) * 0.12 - retreat * (0.15 + rnd(i + 4) * 0.25)), y: gy + rnd(i + 2) * h * 0.1, s: h * 0.07, color, o: { phase: t * (p > 0.45 ? 14 : 7) + i, arm: p < 0.4 ? 1 : 0, fallen, sign: i % 3 === 0 && p < 0.5 ? color : undefined } };
    });
    crowd(ctx, 7, i => ({ x: w * (1.05 - seg(p, 0.05, 0.5) * 0.45 - (p > 0.5 ? retreat * 0.08 : 0)) + i * w * 0.02, y: gy + (i % 3) * h * 0.035, s: h * 0.08, color: '#2b3048', o: { phase: t * 6 + i, shield: true, hat: 'helmet' } }));
    if (p > 0.4) for (let k = 0; k < 5; k++) { ctx.fillStyle = `rgba(230,230,230,${0.35 * (1 - seg(p, 0.6, 1))})`; ctx.beginPath(); ctx.arc(w * (0.35 + k * 0.05), gy - h * 0.08, 12 + seg(p, 0.4, 1) * 50 * rnd(k), 0, Math.PI * 2); ctx.fill(); }
  },
  strike(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#a5b4c8', '#e6e9ef');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#9c9488');
    building(ctx, w * 0.45, gy, w * 0.42, h * 0.38, '#a7a29a', { roof: 'flat', lit: 0 });
    ctx.fillStyle = '#7b7d84'; ctx.fillRect(w * 0.78, gy - h * 0.72, w * 0.05, h * 0.34);
    smoke(ctx, w * 0.8, gy - h * 0.72, t, Math.round(10 * (1 - seg(p, 0.15, 0.55))), 'rgba(70,70,75,0.35)');
    const color = sc.color ?? '#e03131';
    crowd(ctx, 12, i => ({ x: w * (0.08 + i * 0.065), y: gy + (i % 2) * h * 0.04, s: h * 0.075, color: '#5c6f82', o: { phase: Math.sin(t * 2 + i) * 0.4, sign: i % 2 === 0 ? color : undefined, arm: 0.9 } }));
    if (p > 0.25) banner(ctx, w * 0.32, h * 0.22, 'ON STRIKE', color, h * 0.07 * (0.6 + 0.4 * seg(p, 0.25, 0.4)));
  },
  rally(ctx, w, h, t, _p, sc) {
    sky(ctx, w, h, '#74c0fc', '#e7f5ff');
    const gy = h * 0.82; ground(ctx, w, h, gy, '#d6cfc4');
    townhall(ctx, w * 0.5, gy - h * 0.1, w * 0.35);
    ctx.fillStyle = '#868e96'; ctx.fillRect(w * 0.44, gy - h * 0.18, w * 0.12, h * 0.08);
    person(ctx, w * 0.5, gy - h * 0.18, h * 0.08, sc.color ?? '#4263eb', { arm: (Math.sin(t * 6) + 1) / 2, phase: 0 });
    if (Math.sin(t * 3) > 0.3) { ctx.font = `900 ${h * 0.08}px Inter, sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText('!', w * 0.54, gy - h * 0.38); }
    const color = sc.color ?? '#4263eb';
    const n = Math.min(26, Math.max(10, sc.n ?? 16));
    crowd(ctx, n, i => ({ x: w * (0.08 + rnd(i) * 0.84), y: gy + h * (0.03 + rnd(i + 9) * 0.14), s: h * 0.07, color: mix(color, '#868e96', rnd(i + 2) * 0.4), o: { phase: t * 2 + i, arm: (Math.sin(t * 4 + i) + 1) / 2 * 0.8, flag: i % 4 === 0 ? color : undefined } }));
  },
  uprising(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#2b0f12', '#c2410c');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#4a3631');
    const roof = townhall(ctx, w * 0.72, gy, w * 0.36, '#cfc6b8');
    flag(ctx, w * 0.72, roof, h * 0.2, sc.color2 ?? '#495057', 1 - seg(p, 0.6, 0.9), t);
    if (p > 0.55) smoke(ctx, w * 0.65, gy - h * 0.3, t, 12, 'rgba(30,20,20,0.45)', 2);
    const color = sc.color ?? '#e03131';
    const n = Math.min(26, Math.max(12, Math.round((sc.n ?? 20) / 2)));
    crowd(ctx, n, i => ({ x: w * (-0.1 + rnd(i) * 0.35 + seg(p, 0, 0.7) * 0.32), y: gy + rnd(i + 4) * h * 0.12, s: h * 0.075, color, o: { phase: t * 12 + i, arm: 1, flag: i % 3 === 0 ? color : undefined, torch: i % 5 === 1 } }));
    for (let k = 0; k < 4; k++) if (((t * 1.7 + k * 0.37) % 1) < 0.08) burst(ctx, w * (0.4 + rnd(k + Math.floor(t)) * 0.4), gy - h * (0.1 + rnd(k) * 0.3), 8, '#ffd43b', 0.9);
  },
  revolution(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, mix('#1c2541', '#f7b267', seg(p, 0, 0.7)), mix('#3a506b', '#ffd6a5', seg(p, 0, 0.7)));
    const gy = h * 0.8; ground(ctx, w, h, gy, '#8d7f70');
    const roof = townhall(ctx, w * 0.5, gy, w * 0.4);
    const old = 1 - seg(p, 0.1, 0.4), neu = seg(p, 0.45, 0.75);
    flag(ctx, w * 0.5, roof, h * 0.22, old > 0 ? sc.color2 ?? '#495057' : sc.color, old > 0 ? old : neu, t);
    const color = sc.color ?? '#e03131';
    crowd(ctx, 22, i => ({ x: w * (0.05 + rnd(i) * 0.9), y: gy + h * (0.04 + rnd(i + 3) * 0.13) - (p > 0.6 ? Math.abs(Math.sin(t * 7 + i)) * h * 0.03 : 0), s: h * 0.07, color, o: { phase: t * 3 + i, arm: p > 0.6 ? 1 : 0.4, flag: i % 4 === 0 ? color : undefined } }));
    if (p > 0.6) for (let k = 0; k < 5; k++) { const lt = (t * 0.7 + k * 0.23) % 1; burst(ctx, w * (0.15 + rnd(k) * 0.7), h * (0.15 + rnd(k + 3) * 0.2), lt * 40, [color, '#ffd43b', '#fff'][k % 3], 1 - lt); }
  },
  coup(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#05070d', '#1d2433');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#2a2d33');
    const roof = townhall(ctx, w * 0.5, gy, w * 0.38, '#8f9299');
    flag(ctx, w * 0.5, roof, h * 0.2, seg(p, 0.55, 0.6) < 1 ? sc.color2 ?? '#adb5bd' : sc.color ?? '#495057', p < 0.55 ? 1 - seg(p, 0.35, 0.55) : seg(p, 0.6, 0.85), t);
    for (const side of [0, 1]) {
      const a = Math.sin(t * 0.9 + side * 2) * 0.5 + (side ? -0.4 : 0.4);
      ctx.save(); ctx.translate(w * (side ? 0.95 : 0.05), gy); ctx.rotate(-Math.PI / 2 + a);
      const g = ctx.createLinearGradient(0, 0, h, 0); g.addColorStop(0, 'rgba(255,250,210,0.35)'); g.addColorStop(1, 'rgba(255,250,210,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(h * 1.1, -h * 0.12); ctx.lineTo(h * 1.1, h * 0.12); ctx.fill(); ctx.restore();
    }
    const march = seg(p, 0, 0.6);
    crowd(ctx, 12, i => {
      const left = i < 6, k = i % 6;
      return { x: left ? w * (-0.1 + march * 0.3 + k * 0.035) : w * (1.1 - march * 0.3 - k * 0.035), y: gy + (k % 2) * h * 0.04, s: h * 0.075, color: '#4b5320', o: { phase: t * 8 + i, hat: 'helmet', arm: 0.3 } };
    });
    const tx = w * (-0.25 + seg(p, 0.15, 0.7) * 0.45);
    ctx.fillStyle = '#3f4a26'; ctx.beginPath(); ctx.roundRect(tx, gy - h * 0.09, w * 0.16, h * 0.07, 6); ctx.fill();
    ctx.beginPath(); ctx.roundRect(tx + w * 0.04, gy - h * 0.14, w * 0.07, h * 0.05, 5); ctx.fill();
    ctx.fillRect(tx + w * 0.1, gy - h * 0.125, w * 0.09, h * 0.012);
    ctx.fillStyle = '#1d1f15'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(tx + w * (0.02 + k * 0.03), gy - h * 0.02, h * 0.018, 0, Math.PI * 2); ctx.fill(); }
  },
  martial(ctx, w, h, t, p) {
    sky(ctx, w, h, '#070a12', '#1b2130');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#25282f');
    for (let i = 0; i < 5; i++) building(ctx, w * (0.02 + i * 0.2), gy, w * 0.17, h * (0.32 + rnd(i) * 0.15), '#4a4f5c', { roof: i % 2 ? 'gable' : 'flat', lit: Math.max(0, 0.5 - p * 0.8) });
    ctx.fillStyle = '#e9ecef'; ctx.fillRect(w * 0.43, gy - h * 0.3, w * 0.14, h * 0.13);
    ctx.fillStyle = '#c92a2a'; ctx.font = `900 ${h * 0.05}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.fillText('CURFEW', w * 0.5, gy - h * 0.21); ctx.textAlign = 'start';
    const sx = w * (0.5 + Math.sin(t * 0.8) * 0.4);
    const g = ctx.createRadialGradient(sx, gy, 0, sx, gy, h * 0.25); g.addColorStop(0, 'rgba(255,250,200,0.35)'); g.addColorStop(1, 'rgba(255,250,200,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, gy, h * 0.25, h * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    crowd(ctx, 3, i => ({ x: ((t * 40 + i * 45) % (w + 100)) - 50, y: gy + h * 0.06, s: h * 0.08, color: '#2b3048', o: { phase: t * 7 + i * 2, hat: 'helmet' } }));
  },
  purge(ctx, w, h, _t, p, sc) {
    sky(ctx, w, h, '#3b0d11', '#6b1d24');
    const gy = h * 0.82; ground(ctx, w, h, gy, '#2a1416');
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; for (let i = 0; i < 6; i++) ctx.fillRect(w * (0.08 + i * 0.16), h * 0.1, w * 0.05, gy - h * 0.1);
    const color = sc.color ?? '#c92a2a';
    for (let i = 0; i < 7; i++) {
      const gone = (i % 2 === 1) ? seg(p, 0.2 + i * 0.06, 0.32 + i * 0.06) : 0;
      person(ctx, w * (0.14 + i * 0.12), gy + gone * h * 0.2, h * 0.11, mix(color, '#6c757d', gone), { alpha: 1 - gone, phase: 0 });
    }
    if (p > 0.72) {
      const k = seg(p, 0.72, 0.8);
      ctx.save(); ctx.translate(w * 0.5, h * 0.4); ctx.rotate(-0.15); ctx.scale(2 - k, 2 - k); ctx.globalAlpha = k;
      ctx.strokeStyle = '#ff6b6b'; ctx.lineWidth = 5; ctx.strokeRect(-w * 0.17, -h * 0.07, w * 0.34, h * 0.14);
      ctx.fillStyle = '#ff6b6b'; ctx.font = `900 ${h * 0.1}px Inter, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('PURGED', 0, 0);
      ctx.restore();
    }
  },
  election(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#a5d8ff', '#f1f3f5');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#dee2e6');
    const bars = sc.bars?.length ? sc.bars : [{ color: sc.color ?? '#4263eb', value: 0.5, label: '' }];
    const bx = w * 0.27;
    ctx.fillStyle = '#495057'; ctx.fillRect(bx - 30, gy - 60, 60, 60); ctx.fillStyle = '#212529'; ctx.fillRect(bx - 15, gy - 62, 30, 4);
    const voters = 9;
    for (let i = 0; i < voters; i++) {
      const lt = (t * 0.45 + i / voters) % 1;
      const x = w * 0.02 + lt * (bx - 40 - w * 0.02);
      const c = bars[i % bars.length].color;
      person(ctx, x, gy + h * 0.02, h * 0.07, c, { phase: t * 7 + i, arm: lt > 0.92 ? 1 : 0.2 });
      if (lt > 0.9) { ctx.fillStyle = '#fff'; ctx.fillRect(bx - 6, gy - 80 + (lt - 0.9) * 200, 12, 8); }
    }
    const chartX = w * 0.5, chartW = w * 0.45, maxV = Math.max(...bars.map(b => b.value), 0.01);
    const grow = seg(p, 0.35, 0.8);
    const bw = chartW / bars.length;
    bars.forEach((b, i) => {
      const bh = (b.value / maxV) * h * 0.5 * grow;
      ctx.fillStyle = b.color; ctx.fillRect(chartX + i * bw + 4, gy - bh, bw - 8, bh);
      ctx.fillStyle = '#212529'; ctx.font = `700 ${Math.max(10, h * 0.03)}px Inter, sans-serif`; ctx.textAlign = 'center';
      if (grow > 0.5) ctx.fillText(`${Math.round(b.value * 100)}%`, chartX + i * bw + bw / 2, gy - bh - 6);
      ctx.font = `500 ${Math.max(9, h * 0.024)}px Inter, sans-serif`; ctx.fillStyle = '#495057';
      ctx.fillText(b.label.split(' ').pop() ?? '', chartX + i * bw + bw / 2, gy + h * 0.05);
      ctx.textAlign = 'start';
    });
    if (p > 0.8) {
      const win = bars[0];
      crown(ctx, chartX + bw / 2, gy - h * 0.5 * grow - h * 0.08 - Math.sin(t * 5) * 4, h * 0.07);
      for (let k = 0; k < 30; k++) { ctx.fillStyle = k % 2 ? win.color : '#fff'; ctx.fillRect(w * rnd(k), ((t * 120 + rnd(k + 5) * h) % h), 5, 8); }
    }
  },
  merger(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#d0ebff', '#f8f9fa');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#e9ecef');
    const a = sc.color2 ?? '#adb5bd', b = sc.color ?? '#4263eb';
    const meet = seg(p, 0, 0.5), blend = seg(p, 0.5, 0.8);
    crowd(ctx, 16, i => {
      const left = i < 8, k = i % 8;
      const x = left ? w * (0.02 + k * 0.035 + meet * 0.18) : w * (0.98 - k * 0.035 - meet * 0.18);
      return { x, y: gy + (k % 3) * h * 0.035, s: h * 0.075, color: left ? mix(a, b, blend) : b, o: { phase: t * (p < 0.5 ? 8 : 2) + i, flag: k === 0 ? (left ? mix(a, b, blend) : b) : undefined, arm: p > 0.8 ? 1 : 0.2 } };
    });
    if (p > 0.5) for (let k = 0; k < 10; k++) { const a2 = t * 2 + k; ctx.fillStyle = '#fcc419'; ctx.beginPath(); ctx.arc(w * 0.5 + Math.cos(a2) * 40 * blend, h * 0.4 + Math.sin(a2) * 25 * blend, 3, 0, Math.PI * 2); ctx.fill(); }
  },
  split(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#ced4da', '#f1f3f5');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#dee2e6');
    const a = sc.color ?? '#4263eb', b = sc.color2 ?? '#e03131';
    const go = seg(p, 0.3, 0.75);
    if (p > 0.25) {
      ctx.strokeStyle = '#495057'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(w * 0.52, gy);
      for (let k = 1; k <= 6; k++) ctx.lineTo(w * 0.52 + (k % 2 ? 8 : -8), gy + (h - gy) * (k / 6) * seg(p, 0.25, 0.45));
      ctx.stroke();
    }
    crowd(ctx, 16, i => {
      const leaving = i % 3 === 0;
      return { x: w * (0.25 + rnd(i) * 0.3) + (leaving ? go * w * 0.35 : -go * w * 0.05), y: gy + rnd(i + 5) * h * 0.1, s: h * 0.075, color: leaving ? mix(a, b, go) : a, o: { phase: t * (leaving && p > 0.3 && p < 0.75 ? 9 : 1) + i, arm: leaving && p > 0.75 ? 1 : 0, flag: i === 3 ? mix(a, b, go) : i === 1 ? a : undefined } };
    });
  },
  coronation(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, '#5f3dc4', '#f3d9fa');
    const gy = h * 0.82; ground(ctx, w, h, gy, '#b197fc');
    ctx.fillStyle = '#c92a2a'; ctx.fillRect(w * 0.42, gy - 2, w * 0.16, h); // carpet
    ctx.fillStyle = '#e67700'; ctx.beginPath(); ctx.roundRect(w * 0.45, gy - h * 0.32, w * 0.1, h * 0.32, 8); ctx.fill();
    ctx.fillStyle = '#fcc419'; ctx.fillRect(w * 0.46, gy - h * 0.16, w * 0.08, h * 0.04);
    const walk = seg(p, 0, 0.35);
    person(ctx, w * 0.5, gy + h * 0.15 * (1 - walk) - (walk >= 1 ? h * 0.08 : 0), h * 0.1, sc.color ?? '#7048e8', { phase: walk < 1 ? t * 6 : 0, hat: p > 0.7 ? 'crown' : undefined });
    if (p > 0.35 && p <= 0.7) crown(ctx, w * 0.5, h * (0.0 + seg(p, 0.35, 0.7) * 0.36), h * 0.05);
    crowd(ctx, 10, i => ({ x: i < 5 ? w * (0.08 + i * 0.065) : w * (0.66 + (i - 5) * 0.065), y: gy + (i % 2) * h * 0.04, s: h * 0.07, color: '#9c8fb5', o: { lean: p > 0.7 ? (i < 5 ? 0.35 : -0.35) * seg(p, 0.7, 0.8) : 0 } }));
    if (p > 0.7) for (let k = 0; k < 18; k++) { ctx.fillStyle = '#fff3bf'; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 6 + k); ctx.beginPath(); ctx.arc(w * (0.35 + rnd(k) * 0.3), h * (0.1 + rnd(k + 2) * 0.4), 2.5, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
  },
  reform(ctx, w, h, t, p, sc) {
    sky(ctx, w, h, mix('#8fa3bf', '#74c0fc', p), mix('#dbe4ee', '#fff9db', p));
    const gy = h * 0.8; ground(ctx, w, h, gy, mix('#e7f5ff', '#b2f2bb', seg(p, 0.2, 0.9)));
    ctx.fillStyle = '#ffd43b'; ctx.beginPath(); ctx.arc(w * 0.85, h * (0.45 - p * 0.25), h * 0.07, 0, Math.PI * 2); ctx.fill();
    const roof = townhall(ctx, w * 0.3, gy, w * 0.32);
    ctx.fillStyle = `rgba(208,235,255,${0.75 * (1 - seg(p, 0.1, 0.7))})`; ctx.fillRect(w * 0.08, roof - 6, w * 0.44, gy - roof + 6);
    building(ctx, w * 0.62, gy, w * 0.22, h * 0.32, '#868e96', { roof: 'flat', door: seg(p, 0.25, 0.4) });
    crowd(ctx, 6, i => { const out = seg(p, 0.35 + i * 0.07, 0.6 + i * 0.07); return { x: w * 0.73 - out * w * (0.15 + i * 0.04), y: gy + (i % 2) * h * 0.03, s: h * 0.07, color: mix('#868e96', sc.color ?? '#40c057', out), o: { phase: t * 6 + i, alpha: out > 0 ? 1 : 0, arm: out > 0.9 ? 1 : 0 } }; });
  },
  storm(ctx, w, h, t, p) {
    const strike = [1.1, 2.9, 4.4].some(s => t > s && t < s + 0.12);
    sky(ctx, w, h, strike ? '#cfd8e3' : '#1f2630', strike ? '#e9eef5' : '#4a5566');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#3d4a3d');
    for (let i = 0; i < 6; i++) {
      const x = w * (0.05 + i * 0.09), sway = Math.sin(t * 3 + i) * 0.12;
      ctx.save(); ctx.translate(x, gy); ctx.rotate(sway); ctx.fillStyle = '#2f5d3a';
      ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(0, -h * 0.25); ctx.lineTo(18, 0); ctx.fill(); ctx.restore();
    }
    const hx = w * 0.62, hw = w * 0.2, hh = h * 0.24;
    ctx.fillStyle = '#c9b8a4'; ctx.fillRect(hx, gy - hh, hw, hh);
    const lift = seg(p, 0.55, 1);
    ctx.save(); ctx.translate(hx + hw / 2 + lift * w * 0.35, gy - hh - lift * h * 0.4); ctx.rotate(lift * 1.6);
    ctx.fillStyle = '#7a4b37'; ctx.beginPath(); ctx.moveTo(-hw * 0.56, 0); ctx.lineTo(0, -hw * 0.35); ctx.lineTo(hw * 0.56, 0); ctx.fill(); ctx.restore();
    rain(ctx, w, h, t, 220, 3);
    if (strike) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath();
      let x = w * (0.3 + rnd(Math.floor(t)) * 0.4), y = 0; ctx.moveTo(x, y);
      while (y < gy) { x += (rnd(y + t) - 0.5) * 50; y += 30; ctx.lineTo(x, y); }
      ctx.stroke();
    }
  },
  drought(ctx, w, h, t, p) {
    sky(ctx, w, h, '#f76707', '#ffe8cc');
    const gy = h * 0.72; ground(ctx, w, h, gy, mix('#a98467', '#d4a373', p));
    const r = h * (0.11 + 0.01 * Math.sin(t * 3));
    ctx.fillStyle = '#fff3bf'; ctx.beginPath(); ctx.arc(w * 0.78, h * 0.2, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,243,191,0.6)'; ctx.lineWidth = 3;
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2 + t * 0.3; ctx.beginPath(); ctx.moveTo(w * 0.78 + Math.cos(a) * r * 1.2, h * 0.2 + Math.sin(a) * r * 1.2); ctx.lineTo(w * 0.78 + Math.cos(a) * r * 1.7, h * 0.2 + Math.sin(a) * r * 1.7); ctx.stroke(); }
    ctx.strokeStyle = '#6f4e37'; ctx.lineWidth = 1.5;
    for (let k = 0; k < 14; k++) {
      const x = w * rnd(k), y = gy + (h - gy) * rnd(k + 3), len = seg(p, 0.1 + rnd(k) * 0.3, 0.9) * 50;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * 0.6, y + len * 0.2); ctx.lineTo(x + len, y - len * 0.1); ctx.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const x = w * (0.05 + i * 0.05), wilt = seg(p, 0.2, 0.9);
      ctx.strokeStyle = mix('#40c057', '#8c6d46', wilt); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, gy + 10); ctx.quadraticCurveTo(x, gy - 20, x + wilt * 16, gy - 26 + wilt * 18); ctx.stroke();
    }
    person(ctx, w * 0.62, gy + h * 0.12, h * 0.09, '#a07a52', { arm: 0.8 + Math.sin(t * 2) * 0.2, hat: 'cap' });
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 2;
    for (let k = 0; k < 5; k++) { ctx.beginPath(); for (let x = 0; x <= w; x += 20) ctx.lineTo(x, gy - 30 - k * 12 + Math.sin(x * 0.04 + t * 4 + k) * 3); ctx.stroke(); }
  },
  famine(ctx, w, h, t) {
    sky(ctx, w, h, '#868e96', '#ced4da');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#a39e93');
    for (let i = 0; i < 3; i++) {
      const x = w * (0.55 + i * 0.14);
      ctx.fillStyle = '#8b7765'; ctx.fillRect(x, gy - h * 0.16, w * 0.11, h * 0.16);
      ctx.fillStyle = i % 2 ? '#c4a484' : '#ddd3c4'; ctx.beginPath(); ctx.moveTo(x - 6, gy - h * 0.16); ctx.lineTo(x + w * 0.055, gy - h * 0.24); ctx.lineTo(x + w * 0.11 + 6, gy - h * 0.16); ctx.fill();
    }
    ctx.fillStyle = '#212529'; ctx.font = `800 ${h * 0.04}px Inter, sans-serif`; ctx.fillText('NO BREAD', w * 0.6, gy - h * 0.06);
    crowd(ctx, 9, i => ({ x: w * (0.04 + i * 0.055) + Math.sin(t * 0.8 + i) * 3, y: gy + (i % 2) * h * 0.03, s: h * 0.075, color: '#868e96', o: { phase: Math.sin(t + i) * 0.2, bowl: true, arm: 0.35, lean: 0.08 } }));
  },
  plague(ctx, w, h, t, p) {
    sky(ctx, w, h, '#495b3d', '#a9b98f');
    const gy = h * 0.8; ground(ctx, w, h, gy, '#5f6b4d');
    for (let i = 0; i < 4; i++) building(ctx, w * (0.05 + i * 0.24), gy, w * 0.18, h * (0.3 + rnd(i) * 0.12), '#a7a08f', { roof: 'gable', lit: 0.1 });
    crowd(ctx, 8, i => ({ x: w * (0.1 + i * 0.1) + (i % 3 === 0 ? 0 : Math.sin(t + i) * 6), y: gy + (i % 2) * h * 0.05, s: h * 0.075, color: '#7d8a6a', o: { fallen: i % 3 === 0 ? seg(p, 0.1 + i * 0.05, 0.3 + i * 0.05) : 0, phase: t * 2 + i, lean: i % 3 ? 0.15 : 0 } }));
    person(ctx, w * (1.05 - seg(p, 0, 1) * 0.6), gy + h * 0.09, h * 0.085, '#212529', { phase: t * 5, hat: 'beak' });
    for (let k = 0; k < 9; k++) { ctx.fillStyle = 'rgba(160,190,90,0.18)'; ctx.beginPath(); ctx.ellipse(((t * 30 + rnd(k) * w) % (w + 200)) - 100, gy - h * (0.05 + rnd(k + 2) * 0.3), 90, 26, 0, 0, Math.PI * 2); ctx.fill(); }
  },
  festival(ctx, w, h, t) {
    sky(ctx, w, h, '#1b1840', '#5f3dc4');
    const gy = h * 0.82; ground(ctx, w, h, gy, '#3b2f63');
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
    for (let r = 0; r < 2; r++) {
      ctx.beginPath(); ctx.moveTo(0, h * (0.25 + r * 0.12));
      ctx.quadraticCurveTo(w / 2, h * (0.4 + r * 0.12), w, h * (0.25 + r * 0.12)); ctx.stroke();
      for (let k = 0; k < 12; k++) {
        const u = (k + 0.5) / 12, y = h * (0.25 + r * 0.12) + Math.sin(u * Math.PI) * h * 0.075 + Math.sin(t * 2 + k) * 2;
        ctx.fillStyle = ['#ff6b6b', '#ffd43b', '#69db7c', '#74c0fc', '#da77f2'][(k + r) % 5];
        ctx.beginPath(); ctx.arc(w * u, y + 8, 6, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let k = 0; k < 4; k++) { const lt = (t * 0.6 + k * 0.27) % 1; burst(ctx, w * (0.15 + rnd(k) * 0.7), h * (0.12 + rnd(k + 1) * 0.12), lt * 45, ['#ffd43b', '#ff8787', '#63e6be', '#a5d8ff'][k], 1 - lt); }
    crowd(ctx, 14, i => ({ x: w * (0.06 + i * 0.065), y: gy + (i % 2) * h * 0.04 - Math.abs(Math.sin(t * 6 + i)) * h * 0.03, s: h * 0.07, color: ['#ff8787', '#ffd43b', '#69db7c', '#74c0fc', '#da77f2'][i % 5], o: { phase: t * 6 + i, arm: (Math.sin(t * 6 + i) + 1) / 2 } }));
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = `700 ${h * 0.05}px serif`;
    for (let k = 0; k < 5; k++) { const lt = (t * 0.4 + k / 5) % 1; ctx.globalAlpha = 1 - lt; ctx.fillText('♪', w * (0.2 + k * 0.15), gy - lt * h * 0.4); }
    ctx.globalAlpha = 1;
  },
};

// ---------------------------------------------------------------- controller

interface Prefs { enabled: boolean; categories: SceneCategory[] }

export class Cinematics {
  enabled = true;
  categories = new Set<SceneCategory>(['major', 'unrest', 'politics', 'nature']);
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private titleEl: HTMLElement;
  private textEl: HTMLElement;
  private barEl: HTMLElement;
  private current: { e: SimEvent; scene: Scene; start: number } | null = null;
  private raf = 0;
  private lastByKind = new Map<SceneKind, number>();
  private lastAnyDay = -999;

  constructor(private hooks: { pause: () => void; resume: () => void; onPrefsChange?: () => void }) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Prefs | null;
      if (saved) { this.enabled = saved.enabled; this.categories = new Set(saved.categories); }
    } catch { /* ignore corrupt prefs */ }
    this.root = document.createElement('div');
    this.root.className = 'cine hidden';
    this.root.innerHTML = `
      <div class="cine-stage">
        <canvas></canvas>
        <div class="cine-caption">
          <div class="cine-title"></div>
          <div class="cine-text"></div>
          <div class="cine-progress"><div></div></div>
          <div class="cine-actions">
            <button data-cine="skip" title="Space / Esc">Continue ▸</button>
            <button data-cine="off" class="ghost">Turn off scenes</button>
          </div>
        </div>
      </div>`;
    document.body.append(this.root);
    this.canvas = this.root.querySelector('canvas')!;
    this.titleEl = this.root.querySelector('.cine-title')!;
    this.textEl = this.root.querySelector('.cine-text')!;
    this.barEl = this.root.querySelector('.cine-progress > div')!;
    this.root.addEventListener('click', ev => {
      const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-cine]');
      if (b?.dataset.cine === 'off') { this.setEnabled(false); this.close(); }
      else if (b?.dataset.cine === 'skip' || ev.target === this.root) this.close();
    });
  }

  get playing() { return !!this.current; }

  setEnabled(on: boolean) { this.enabled = on; this.save(); }
  toggleCategory(c: SceneCategory, on: boolean) { if (on) this.categories.add(c); else this.categories.delete(c); this.save(); }
  private save() {
    localStorage.setItem(STORE_KEY, JSON.stringify({ enabled: this.enabled, categories: [...this.categories] } satisfies Prefs));
    this.hooks.onPrefsChange?.();
  }

  /** Called for every sim event; plays a scene if it qualifies. */
  offer(e: SimEvent) {
    const sc = e.scene;
    if (!sc || !this.enabled || !this.categories.has(CATEGORY[sc.kind])) return;
    const pr = PRIORITY[sc.kind] ?? 1;
    if (this.current) {
      if (pr <= (PRIORITY[this.current.scene.kind] ?? 1)) return;
    } else {
      if (pr < 3 && e.day - this.lastAnyDay < 2) return;
      if (e.day - (this.lastByKind.get(sc.kind) ?? -999) < (COOLDOWN[sc.kind] ?? 0)) return;
    }
    this.lastByKind.set(sc.kind, e.day);
    this.lastAnyDay = e.day;
    this.play(e, sc);
  }

  /** Preview a scene kind with sample data (from the Tools tab). */
  preview(kind: SceneKind) {
    const sample: Scene = { kind, color: '#e03131', color2: '#4263eb', n: 16,
      bars: [{ color: '#e03131', value: 0.42, label: 'Red Front' }, { color: '#4263eb', value: 0.33, label: 'Blue League' }, { color: '#40c057', value: 0.25, label: 'Green Union' }] };
    this.play({ day: 0, hour: 12, text: `Preview of the "${TITLES[kind]}" scene.`, kind: 'info' }, sample);
  }

  private play(e: SimEvent, scene: Scene) {
    const fresh = !this.current;
    this.current = { e, scene, start: performance.now() };
    this.titleEl.textContent = TITLES[scene.kind];
    this.textEl.textContent = e.text;
    this.root.dataset.kind = CATEGORY[scene.kind];
    this.root.classList.remove('hidden');
    if (fresh) this.hooks.pause();
    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      if (!this.current) return;
      const t = (now - this.current.start) / 1000;
      this.draw(t);
      if (t >= DURATION + 0.6) { this.close(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private draw(t: number) {
    const c = this.canvas, dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const p = Math.min(1, t / DURATION);
    ctx.save();
    SCENES[this.current!.scene.kind](ctx, w, h, t, p, this.current!.scene);
    ctx.restore();
    // letterbox bars + vignette
    const bar = h * 0.07 * seg(t, 0, 0.4);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
    const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.9);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, w, h);
    if (t < 0.35) { ctx.fillStyle = `rgba(0,0,0,${1 - t / 0.35})`; ctx.fillRect(0, 0, w, h); }
    this.barEl.style.width = `${p * 100}%`;
  }

  close() {
    if (!this.current) return;
    this.current = null;
    cancelAnimationFrame(this.raf);
    this.root.classList.add('hidden');
    this.hooks.resume();
  }
}

export const SCENE_KINDS = Object.keys(TITLES) as SceneKind[];
export const sceneTitle = (k: SceneKind) => TITLES[k];
export const sceneCategory = (k: SceneKind) => CATEGORY[k];
