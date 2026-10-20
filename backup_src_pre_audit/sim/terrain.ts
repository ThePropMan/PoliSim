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
export function genTerrain(rng: Rng): TerrainMap {
  const n = TERRAIN_SIZE;
  const h1 = noiseField(rng, n, 7);
  const h2 = noiseField(rng, n, 19);
  const s1 = noiseField(rng, n, 9);
  const s2 = noiseField(rng, n, 23);
  const oreN = noiseField(rng, n, 6);
  const forN = noiseField(rng, n, 8);
  const t: TerrainMap = { size: n, cellSize: TERRAIN_CELL, height: [], soil: [], ore: [], forest: [], water: [] };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const wx = (x + 0.5) * TERRAIN_CELL - TERRAIN_HALF;
      const wz = (y + 0.5) * TERRAIN_CELL - TERRAIN_HALF;
      const dist = Math.hypot(wx, wz);
      const height = h1[i] * 0.72 + h2[i] * 0.28; // 0..1
      // Flatten the town core so streets stay level; hills rise toward the edges
      const flat = clamp((dist - 70) / 160);
      t.height.push((height - 0.55) * 6 * flat);
      t.soil.push(clamp(s1[i] * 0.62 + s2[i] * 0.38 + 0.08));
      t.ore.push(clamp((oreN[i] - 0.6) / 0.4));
      t.forest.push(clamp((forN[i] - 0.5) / 0.5));
      // Water sits in low areas; suppressed near the town core so the plaza never floods
      const waterThresh = 0.1 + 0.13 * clamp((dist - 90) / 160);
      t.water.push(height < waterThresh ? 1 : 0);
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
