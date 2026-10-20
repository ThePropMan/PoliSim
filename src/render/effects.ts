import * as THREE from 'three';
import type { Simulation } from '../sim/simulation';
import type { WeatherKind } from '../sim/types';

const PARTICLES = 900;
const AREA = 300;   // particles live in an AREA³-ish volume around the town centre
const TOP = 90;

/** Falling rain/snow particle field + a smoke column used by fires/riots. */
export class EffectsRenderer {
  private precip: THREE.Points;
  private precipVel: number;
  private posAttr: THREE.BufferAttribute;

  constructor(private sim: Simulation, scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLES * 3);
    for (let i = 0; i < PARTICLES; i++) {
      positions[i * 3] = (Math.random() - 0.5) * AREA;
      positions[i * 3 + 1] = Math.random() * TOP;
      positions[i * 3 + 2] = (Math.random() - 0.5) * AREA;
    }
    this.posAttr = new THREE.BufferAttribute(positions, 3);
    geo.setAttribute('position', this.posAttr);
    this.precip = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#93a7bb', size: 0.32, transparent: true, opacity: 0.6 }));
    this.precip.frustumCulled = false;
    this.precip.visible = false;
    this.precipVel = 60;
    scene.add(this.precip);
  }

  setSimulation(sim: Simulation) { this.sim = sim; }

  update(dt: number) {
    const w: WeatherKind = this.sim.state.weather.kind;
    const isRain = w === 'rain' || w === 'storm';
    const isSnow = w === 'snow';
    this.precip.visible = isRain || isSnow;
    if (!this.precip.visible) return;

    const mat = this.precip.material as THREE.PointsMaterial;
    if (isSnow) { mat.color.set('#f4f8fc'); mat.size = 0.5; mat.opacity = 0.75; this.precipVel = 9; }
    else { mat.color.set(w === 'storm' ? '#6d8299' : '#8ea5bd'); mat.size = 0.3; mat.opacity = w === 'storm' ? 0.8 : 0.55; this.precipVel = w === 'storm' ? 88 : 58; }

    const arr = this.posAttr.array as Float32Array;
    const drift = isSnow ? Math.sin(performance.now() / 900) * 1.6 : w === 'storm' ? 22 : 4;
    for (let i = 0; i < PARTICLES; i++) {
      arr[i * 3 + 1] -= this.precipVel * dt;
      arr[i * 3] += drift * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = TOP;
        arr[i * 3] = (Math.random() - 0.5) * AREA;
        arr[i * 3 + 2] = (Math.random() - 0.5) * AREA;
      }
    }
    this.posAttr.needsUpdate = true;
  }

  /** 0 = fine, 1 = worst — drives lighting dimming in the world renderer. */
  weatherGloom(): number {
    const w = this.sim.state.weather.kind;
    return { clear: 0, cloudy: 0.28, rain: 0.45, storm: 0.68, drought: 0.08, snow: 0.35 }[w];
  }
}
