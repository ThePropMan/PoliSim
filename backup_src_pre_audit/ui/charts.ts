import type { StatSample } from '../sim/types';

export interface ChartDef {
  key: keyof StatSample | ((s: StatSample) => number);
  label: string;
  color: string;
  format: (v: number) => string;
  min?: number;
  max?: number;
}

export class Chart {
  el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private valueEl: HTMLSpanElement;

  constructor(public def: ChartDef) {
    this.el = document.createElement('div');
    this.el.className = 'chart';
    this.canvas = document.createElement('canvas');
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = def.label;
    this.valueEl = document.createElement('span');
    this.valueEl.className = 'value';
    this.valueEl.style.color = def.color;
    this.el.append(this.canvas, label, this.valueEl);
  }

  draw(stats: StatSample[]) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const get = typeof this.def.key === 'function' ? this.def.key : (s: StatSample) => s[this.def.key as keyof StatSample] as number;
    if (stats.length < 2) return;
    // Downsample to width
    const n = stats.length;
    const step = Math.max(1, Math.floor(n / w));
    const vals: number[] = [];
    for (let i = 0; i < n; i += step) {
      let sum = 0, cnt = 0;
      for (let j = i; j < Math.min(n, i + step); j++) { sum += get(stats[j]); cnt++; }
      vals.push(sum / cnt);
    }
    let lo = this.def.min ?? Math.min(...vals), hi = this.def.max ?? Math.max(...vals);
    if (this.def.min === undefined) lo = Math.min(lo, 0);
    if (hi - lo < 1e-6) hi = lo + 1;
    const top = 16, bottom = 4;
    const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (h - top - bottom);
    ctx.beginPath();
    vals.forEach((v, i) => { const x = (i / Math.max(1, vals.length - 1)) * w; if (i) ctx.lineTo(x, y(v)); else ctx.moveTo(x, y(v)); });
    ctx.strokeStyle = this.def.color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.globalAlpha = 0.08; ctx.fillStyle = this.def.color; ctx.fill(); ctx.globalAlpha = 1;
    // Year ticks
    ctx.fillStyle = '#d0d0cc';
    const firstDay = stats[0].day, lastDay = stats[n - 1].day;
    const span = Math.max(1, lastDay - firstDay);
    const yearEvery = span > 30 * 60 ? 30 * 10 : span > 30 * 12 ? 30 * 5 : 30;
    for (let d = Math.ceil(firstDay / yearEvery) * yearEvery; d <= lastDay; d += yearEvery) {
      const x = ((d - firstDay) / span) * w;
      ctx.fillRect(x, h - 3, 1, 3);
    }
    this.valueEl.textContent = this.def.format(get(stats[n - 1]));
  }
}

export const pct = (v: number) => `${Math.round(v * 100)}%`;
export const num = (v: number) => (Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(0)}k` : Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(Math.abs(v) < 10 ? 2 : 0));
