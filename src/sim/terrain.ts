import { Rng, clamp } from './rng';
import type { TerrainMap, Vec2 } from './types';

export const TERRAIN_SIZE = 72;
export const TERRAIN_CELL = 8; // world units per terrain cell
/** World-space half-extent covered by the terrain field. */
export const TERRAIN_HALF = (TERRAIN_SIZE * TERRAIN_CELL) / 2; // 288

/**
 * Smooth value-noise field in [0,1]: a low-res random lattice resampled with
 * smoothstep bilinear interpolation. Two octaves give natural-looking blobs.
 */
function noiseField(rng: Rng, size: number, cells: number): number[] {
  const lat = new Array((cells + 1) * (cells + 1));
  for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
  const out = new Array(size * size);
  const step = size / cells;
  const sm = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.min(cells - 1e-6, x / step), gy = Math.min(cells - 1e-6, y / step);
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const tx = sm(gx - x0), ty = sm(gy - y0);
      const i00 = y0 * (cells + 1) + x0;
      const a = lat[i00] + (lat[i00 + 1] - lat[i00]) * tx;
      const b = lat[i00 + cells + 1] + (lat[i00 + cells + 2] - lat[i00 + cells + 1]) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  }
  return out;
}

/**
 * Generate the terrain for a new world. Deterministic: call with a dedicated Rng
 * (seed XORed so terrain doesn't consume the main simulation stream).
 */
/** Distance from point p to a polyline; also returns param t of nearest segment end. */
function distToPolyline(p: Vec2, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz || 1;
    const u = clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / len2);
    const dx = p.x - (a.x + abx * u), dz = p.z - (a.z + abz * u);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

export function genTerrain(rng: Rng): TerrainMap {
  const n = TERRAIN_SIZE;
  const h1 = noiseField(rng, n, 7);
  const h2 = noiseField(rng, n, 19);
  const h3 = noiseField(rng, n, 33);   // fine detail
  const ridgeN = noiseField(rng, n, 5); // large-scale ridge/valley structure
  const s1 = noiseField(rng, n, 9);
  const s2 = noiseField(rng, n, 23);
  const oreN = noiseField(rng, n, 6);
  const forN = noiseField(rng, n, 8);
  // Some worlds are flat farmland, others genuinely hilly — relief varies per seed
  const relief = rng.range(0.7, 1.65);

  // --- river: a meandering channel entering and leaving the map -----------------
  const river: Vec2[] = [];
  if (rng.chance(0.85)) {
    const a0 = rng.range(0, Math.PI * 2);
    const a1 = a0 + Math.PI + rng.range(-1.15, 1.15); // roughly opposite bank
    const R = TERRAIN_HALF - 4;
    const sx = Math.cos(a0) * R, sz = Math.sin(a0) * R;
    const ex = Math.cos(a1) * R, ez = Math.sin(a1) * R;
    const chordLen = Math.hypot(ex - sx, ez - sz) || 1;
    const nx = -(ez - sz) / chordLen, nz = (ex - sx) / chordLen; // unit normal to chord
    const phase = rng.range(0, Math.PI * 2);
    const bend = rng.range(-55, 55); // overall bow so the river skirts the centre
    const segs = 48;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs;
      let x = sx + (ex - sx) * u, z = sz + (ez - sz) * u;
      const meander = Math.sin(u * Math.PI * 2.4 + phase) * 24 + bend * Math.sin(u * Math.PI);
      x += nx * meander; z += nz * meander;
      const dc = Math.hypot(x, z);
      if (dc < 36) { const k = 36 / dc; x *= k; z *= k; } // never flood the plaza
      river.push({ x, z });
    }
  }

  const t: TerrainMap = { size: n, cellSize: TERRAIN_CELL, height: [], soil: [], ore: [], forest: [], water: [], river, bridges: [] };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const wx = (x + 0.5) * TERRAIN_CELL - TERRAIN_HALF;
      const wz = (y + 0.5) * TERRAIN_CELL - TERRAIN_HALF;
      const dist = Math.hypot(wx, wz);
      const height = h1[i] * 0.58 + h2[i] * 0.28 + h3[i] * 0.14; // 0..1
      // Flatten the town core so streets stay level; hills rise toward the edges
      const flat = clamp((dist - 70) / 160);
      const ridge = Math.abs(ridgeN[i] - 0.5) * 2; // 0 at valley line, 1 at ridge line
      let h = (height - 0.55) * 6 * flat * relief + ridge * ridge * 5 * flat * flat * relief;
      let water = height < 0.1 + 0.13 * clamp((dist - 90) / 160) ? 1 : 0;
      let soil = clamp(s1[i] * 0.62 + s2[i] * 0.38 + 0.08);
      // River channel: carve the bed, enrich the banks (alluvial soil)
      if (river.length > 1) {
        const d = distToPolyline({ x: wx, z: wz }, river);
        const half = 5.2 + Math.sin(wx * 0.05 + wz * 0.03) * 1.8;
        if (d < half) { water = 1; h = Math.min(h, -1.05 - (1 - d / half) * 0.5); }
        else if (d < half + 14) soil = clamp(soil + (1 - (d - half) / 14) * 0.35);
      }
      t.height.push(h);
      t.soil.push(soil);
      t.ore.push(clamp((oreN[i] - 0.6) / 0.4));
      t.forest.push(clamp((forN[i] - 0.5) / 0.5));
      t.water.push(water);
    }
  }

  // --- bridges: a few crossing points where streets would naturally meet the river
  if (river.length > 1) {
    const picks = river
      .filter(p => { const d = Math.hypot(p.x, p.z); return d > 38 && d < 150; })
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    for (const p of picks) {
      if (t.bridges!.length >= 3) break;
      if (t.bridges!.every(q => Math.hypot(q.x - p.x, q.z - p.z) > 55)) t.bridges!.push({ ...p });
    }
  }
  return t;
}

export function terrainIndex(t: TerrainMap, pos: Vec2): number {
  const x = Math.floor((pos.x + TERRAIN_HALF) / t.cellSize);
  const y = Math.floor((pos.z + TERRAIN_HALF) / t.cellSize);
  if (x < 0 || y < 0 || x >= t.size || y >= t.size) return -1;
  return y * t.size + x;
}

/** Nearest-cell field lookup; `field` is one of the TerrainMap number arrays. */
export function terrainAt(t: TerrainMap, field: keyof Pick<TerrainMap, 'height' | 'soil' | 'ore' | 'forest' | 'water'>, pos: Vec2): number {
  const i = terrainIndex(t, pos);
  return i < 0 ? 0 : t[field][i];
}

/** Smooth (bilinear) ground height for rendering agent/building Y positions. */
export function groundHeight(t: TerrainMap, pos: Vec2): number {
  const gx = (pos.x + TERRAIN_HALF) / t.cellSize - 0.5;
  const gy = (pos.z + TERRAIN_HALF) / t.cellSize - 0.5;
  const x0 = clamp(Math.floor(gx), 0, t.size - 2), y0 = clamp(Math.floor(gy), 0, t.size - 2);
  const tx = clamp(gx - x0), ty = clamp(gy - y0);
  const i = y0 * t.size + x0;
  const a = t.height[i] + (t.height[i + 1] - t.height[i]) * tx;
  const b = t.height[i + t.size] + (t.height[i + t.size + 1] - t.height[i + t.size]) * tx;
  return a + (b - a) * ty;
}

export function isWater(t: TerrainMap, pos: Vec2): boolean {
  return terrainAt(t, 'water', pos) > 0;
}

/** Wading across water is slow; bridges restore full speed. */
export function wadeFactor(t: TerrainMap, pos: Vec2): number {
  if (!isWater(t, pos)) return 1;
  for (const b of t.bridges ?? []) if (Math.hypot(b.x - pos.x, b.z - pos.z) < 8) return 1;
  return 0.45;
}

/** Suitability of a cell for a productive building: farms want soil, mines want ore, lumber wants forest. */
export function siteQuality(t: TerrainMap, type: string, pos: Vec2): number {
  if (isWater(t, pos)) return 0;
  switch (type) {
    // centred near 1.0 so siting creates variance, not a systemic yield haircut
    case 'farm': return 0.72 + 0.6 * terrainAt(t, 'soil', pos);
    case 'mine': return terrainAt(t, 'ore', pos) > 0.02 ? 0.7 + 0.55 * terrainAt(t, 'ore', pos) : 0.35;
    case 'lumber_camp': return terrainAt(t, 'forest', pos) > 0.02 ? 0.7 + 0.5 * terrainAt(t, 'forest', pos) : 0.35;
    default: return 1;
  }
}
