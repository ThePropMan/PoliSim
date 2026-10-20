import * as THREE from 'three';
import { type Simulation } from '../sim/simulation';
import { TERRAIN_HALF, terrainAt } from '../sim/terrain';
import { districtKeyOf, districtMap } from '../sim/districts';
import type { Season } from '../sim/environment';

const TREES_MAX = 1400;
const ROCKS_MAX = 500;
const TRAIL_RES = 256;
const POL_RES = 96;

export type PoliticsMode = 'off' | 'econ' | 'auth' | 'trad' | 'wealth';

/** Overlay palettes — matched to the Political Climate panel gradients. */
const POL_COLORS: Record<Exclude<PoliticsMode, 'off' | 'wealth'>, [string, string]> = {
  econ: ['#dfa79a', '#a9b9d6'],  // left .. right
  auth: ['#b7c99e', '#c4aacb'],  // libertarian .. authoritarian
  trad: ['#b9b0d6', '#dfbf8c'],  // progressive .. traditional
};

const SEASON_TINT: Record<Season, string> = {
  spring: '#f4f6ee', summer: '#eef2e2', autumn: '#f5efdf', winter: '#f4f6f9',
};
const TREE_TINT: Record<Season, string> = {
  spring: '#5d7a45', summer: '#4d7040', autumn: '#a2763a', winter: '#8a8478',
};

/**
 * Heightfield ground, ponds, instanced trees/rocks, and a "worn paths" layer where
 * persistent foot traffic darkens the earth. Reads the sim's TerrainMap directly.
 */
export class TerrainRenderer {
  group = new THREE.Group();
  private ground!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private water!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private trees!: THREE.InstancedMesh;
  private rocks!: THREE.InstancedMesh;
  private vegSig = -1;
  private trailCanvas = document.createElement('canvas');
  private trailCtx!: CanvasRenderingContext2D;
  private trailTex!: THREE.CanvasTexture;
  private trailDecay = 0;
  private polCanvas = document.createElement('canvas');
  private polCtx!: CanvasRenderingContext2D;
  private polTex!: THREE.CanvasTexture;
  private polMesh!: THREE.Mesh;
  private polDay = -1;
  politicsMode: PoliticsMode = 'off';
  private bridges = new THREE.Group();
  private seasonTint = new THREE.Color('#ffffff');
  private seasonTreeTint = new THREE.Color('#5d7a45');

  constructor(private sim: Simulation, scene: THREE.Scene) {
    this.buildGround();
    this.buildWater();
    this.buildVegetation();
    this.buildPolitics();
    this.buildBridges();
    this.buildTrails();
    scene.add(this.group);
  }

  setSimulation(sim: Simulation) {
    this.sim = sim;
    this.vegSig = -1;
    this.polDay = -1;
    this.trailCtx.clearRect(0, 0, TRAIL_RES, TRAIL_RES);
    this.trailTex.needsUpdate = true;
    this.buildGround();
    this.buildVegetation();
    this.buildBridges();
  }

  private buildGround() {
    const t = this.sim.state.terrain;
    const ext = TERRAIN_HALF * 2;
    const seg = TERRAIN_HALF * 0.75; // ~4 units per vertex
    const geo = new THREE.PlaneGeometry(ext, ext, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = bilinearHeight(t, x, z);
      pos.setY(i, h);
      const w = terrainAt(t, 'water', { x, z });
      if (w > 0) c.set('#c3ccd2'); // bed under the water plane
      else {
        const hh = Math.max(-1, Math.min(1, h / 3));
        c.set('#f4f3ee').lerp(new THREE.Color('#e3e1d8'), Math.max(0, hh) * 0.85)
          .lerp(new THREE.Color('#dfe4da'), Math.max(0, -hh) * 0.5);
      }
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    if (this.ground) { this.group.remove(this.ground); this.ground.geometry.dispose(); this.ground.material.dispose(); }
    this.ground = new THREE.Mesh(geo, mat);
    this.ground.receiveShadow = true;
    this.group.add(this.ground);
  }

  private buildWater() {
    const ext = TERRAIN_HALF * 2;
    const geo = new THREE.PlaneGeometry(ext, ext);
    geo.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#8fb9cf', transparent: true, opacity: 0.66, depthWrite: false }));
    this.water.position.y = -0.62;
    this.water.renderOrder = 1;
    this.group.add(this.water);
  }

  private scatter(cell: number, i: number, salt: number): [number, number] {
    // Deterministic per-cell jitter so trees don't jump when the layer rebuilds
    const n = this.sim.state.terrain.size;
    const cx = (cell % n + 0.5) * this.sim.state.terrain.cellSize - TERRAIN_HALF;
    const cz = (Math.floor(cell / n) + 0.5) * this.sim.state.terrain.cellSize - TERRAIN_HALF;
    const h = (x: number) => { const s = Math.sin(x * 127.1 + cell * 311.7 + salt * 74.7) * 43758.5; return s - Math.floor(s); };
    return [cx + (h(i * 2 + 1) - 0.5) * 6.5, cz + (h(i * 2 + 2) - 0.5) * 6.5];
  }

  private buildVegetation() {
    const t = this.sim.state.terrain;
    if (this.trees) { this.group.remove(this.trees); this.trees.dispose(); }
    if (this.rocks) { this.group.remove(this.rocks); this.rocks.dispose(); }

    const treeGeo = new THREE.ConeGeometry(1.15, 3.4, 7);
    treeGeo.translate(0, 1.7, 0);
    this.trees = new THREE.InstancedMesh(treeGeo, new THREE.MeshLambertMaterial({ color: '#587a44' }), TREES_MAX);
    const rockGeo = new THREE.DodecahedronGeometry(0.9);
    this.rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: '#9aa0a6' }), ROCKS_MAX);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    let ti = 0, ri = 0;
    for (let i = 0; i < t.forest.length && (ti < TREES_MAX || ri < ROCKS_MAX); i++) {
      const f = t.forest[i];
      if (f > 0.3 && ti < TREES_MAX) {
        const nTrees = Math.min(TREES_MAX - ti, Math.round(1 + f * 2.2));
        for (let k = 0; k < nTrees; k++) {
          const [x, z] = this.scatter(i, k, 1);
          p.set(x, bilinearHeight(t, x, z), z);
          const sz = 0.7 + f * 0.7 + ((i * 31 + k * 17) % 10) / 30;
          sc.setScalar(sz);
          m.compose(p, q, sc);
          this.trees.setMatrixAt(ti++, m);
        }
      }
      const o = t.ore[i];
      if (o > 0.35 && ri < ROCKS_MAX) {
        const [x, z] = this.scatter(i, 0, 9);
        p.set(x, bilinearHeight(t, x, z) + 0.3, z);
        sc.setScalar(0.7 + o);
        m.compose(p, q, sc);
        this.rocks.setMatrixAt(ri++, m);
      }
    }
    this.trees.count = ti;
    this.trees.castShadow = true;
    this.rocks.count = ri;
    this.rocks.castShadow = true;
    this.group.add(this.trees, this.rocks);
  }

  // ---------------------------------------------------------------- bridges, politics

  /** Wooden bridge decks where streets meet the river. */
  private buildBridges() {
    this.bridges.clear();
    const t = this.sim.state.terrain;
    const river = t.river ?? [];
    for (const bp of t.bridges ?? []) {
      // Local river direction from the nearest polyline segment
      let ni = 0, nd = Infinity;
      for (let i = 0; i < river.length; i++) {
        const d = Math.hypot(river[i].x - bp.x, river[i].z - bp.z);
        if (d < nd) { nd = d; ni = i; }
      }
      const a = river[Math.max(0, ni - 1)], b = river[Math.min(river.length - 1, ni + 1)];
      const ang = Math.atan2(b.z - a.z, b.x - a.x);
      const g = new THREE.Group();
      const deck = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 4.6), new THREE.MeshLambertMaterial({ color: '#a98c68' }));
      deck.castShadow = deck.receiveShadow = true;
      g.add(deck);
      for (const side of [-1, 1]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(19, 0.9, 0.4), new THREE.MeshLambertMaterial({ color: '#8d7355' }));
        rail.position.set(0, 0.55, side * 2.15);
        g.add(rail);
      }
      for (const end of [-8, 8]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.6, 4.4), new THREE.MeshLambertMaterial({ color: '#8d7355' }));
        post.position.set(end, -0.3, 0);
        g.add(post);
      }
      g.position.set(bp.x, 0.05, bp.z);
      g.rotation.y = -ang + Math.PI / 2; // deck spans across the river
      this.bridges.add(g);
    }
    if (!this.bridges.parent) this.group.add(this.bridges);
  }

  /** Political gradient overlay: one canvas pixel per patch of ground, coloured by district lean. */
  private paintPolitics() {
    const ctx = this.polCtx;
    ctx.clearRect(0, 0, POL_RES, POL_RES);
    const mode = this.politicsMode;
    if (mode === 'off') { this.polMesh.visible = false; this.polDay = this.sim.state.day; return; }
    const dm = districtMap(this.sim);
    const ws = [...dm.values()].map(d => d.wealth).sort((a, b) => a - b);
    const med = ws[Math.floor(ws.length / 2)] ?? 1;
    const k = POL_RES / (TERRAIN_HALF * 2);
    for (let py = 0; py < POL_RES; py++) {
      for (let pxx = 0; pxx < POL_RES; pxx++) {
        const wx = (pxx + 0.5) / k - TERRAIN_HALF, wz = (py + 0.5) / k - TERRAIN_HALF;
        const d = dm.get(districtKeyOf({ x: wx, z: wz }));
        if (!d || d.homes === 0) continue;
        let v: number, lo: string, hi: string;
        if (mode === 'wealth') {
          v = Math.max(-1, Math.min(1, (d.wealth / Math.max(1e-6, med) - 1) * 1.4));
          lo = '#d9a05b'; hi = '#7fa88a';
        } else {
          v = Math.max(-1, Math.min(1, d.lean[mode]));
          [lo, hi] = POL_COLORS[mode];
        }
        const alpha = Math.min(0.6, 0.16 + Math.abs(v) * 0.55);
        ctx.fillStyle = v < 0 ? lo : hi;
        ctx.globalAlpha = alpha;
        ctx.fillRect(pxx, py, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    this.polTex.needsUpdate = true;
    this.polMesh.visible = true;
    this.polDay = this.sim.state.day;
  }

  private buildPolitics() {
    this.polCanvas.width = this.polCanvas.height = POL_RES;
    this.polCtx = this.polCanvas.getContext('2d')!;
    this.polTex = new THREE.CanvasTexture(this.polCanvas);
    this.polTex.minFilter = THREE.LinearFilter;
    this.polTex.magFilter = THREE.LinearFilter;
    const ext = TERRAIN_HALF * 2;
    const geo = new THREE.PlaneGeometry(ext, ext);
    geo.rotateX(-Math.PI / 2);
    this.polMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.polTex, transparent: true, opacity: 0.75, depthWrite: false }));
    this.polMesh.position.y = 0.2;
    this.polMesh.renderOrder = 3;
    this.polMesh.visible = false;
    this.group.add(this.polMesh);
  }

  setPoliticsMode(mode: PoliticsMode) {
    this.politicsMode = mode;
    this.polDay = -1;
    this.paintPolitics();
  }

  private buildTrails() {
    this.trailCanvas.width = this.trailCanvas.height = TRAIL_RES;
    this.trailCtx = this.trailCanvas.getContext('2d')!;
    this.trailTex = new THREE.CanvasTexture(this.trailCanvas);
    const ext = TERRAIN_HALF * 2;
    const geo = new THREE.PlaneGeometry(ext, ext);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: this.trailTex, transparent: true, opacity: 0.5, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 0.14;
    mesh.renderOrder = 2;
    this.group.add(mesh);
  }

  /** Called every render frame: footsteps accumulate, trails fade slowly. */
  private trackTrails(dt: number) {
    const ctx = this.trailCtx;
    const k = TRAIL_RES / (TERRAIN_HALF * 2);
    ctx.fillStyle = 'rgba(96,88,74,0.05)';
    for (const a of this.sim.state.agents) {
      if (a.activity === 'sleep' || a.activity === 'home' || a.activity === 'jailed') continue;
      ctx.fillRect((a.pos.x + TERRAIN_HALF) * k - 0.6, (a.pos.z + TERRAIN_HALF) * k - 0.6, 1.2, 1.2);
    }
    this.trailDecay += dt;
    if (this.trailDecay > 2.5) {
      this.trailDecay = 0;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.02)';
      ctx.fillRect(0, 0, TRAIL_RES, TRAIL_RES);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.trailTex.needsUpdate = true;
  }

  update(dt: number, season: Season) {
    this.seasonTint.lerp(new THREE.Color(SEASON_TINT[season]), Math.min(1, dt * 1.5));
    this.ground.material.color.copy(this.seasonTint);
    this.seasonTreeTint.lerp(new THREE.Color(TREE_TINT[season]), Math.min(1, dt * 1.5));
    (this.trees.material as THREE.MeshLambertMaterial).color.copy(this.seasonTreeTint);
    this.trackTrails(dt);
    if (this.politicsMode !== 'off' && this.sim.state.day !== this.polDay) this.paintPolitics();
    // Rebuild vegetation only when total cover changes meaningfully (depletion/regrowth)
    const t = this.sim.state.terrain;
    let sig = 0;
    for (let i = 0; i < t.forest.length; i += 3) sig += t.forest[i] + t.ore[i];
    const sigI = Math.round(sig * 2);
    if (sigI !== this.vegSig) { this.vegSig = sigI; this.buildVegetation(); }
  }
}

/** Bilinear height sample (local copy so renderer doesn't depend on sim internals shape). */
export function bilinearHeight(t: { size: number; cellSize: number; height: number[] }, x: number, z: number): number {
  const gx = (x + TERRAIN_HALF) / t.cellSize - 0.5;
  const gy = (z + TERRAIN_HALF) / t.cellSize - 0.5;
  const n = t.size;
  const x0 = Math.max(0, Math.min(n - 2, Math.floor(gx)));
  const y0 = Math.max(0, Math.min(n - 2, Math.floor(gy)));
  const tx = Math.max(0, Math.min(1, gx - x0)), ty = Math.max(0, Math.min(1, gy - y0));
  const i = y0 * n + x0;
  const a = t.height[i] + (t.height[i + 1] - t.height[i]) * tx;
  const b = t.height[i + n] + (t.height[i + n + 1] - t.height[i + n]) * tx;
  return a + (b - a) * ty;
}
