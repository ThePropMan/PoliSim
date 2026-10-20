import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Simulation } from '../sim/simulation';
import type { Agent, Building } from '../sim/types';
import { agentColor, BUILDING_COLORS, ownershipColor, type BuildingColorMode, type ColorMode } from '../ui/colors';
import { householdWealth } from '../sim/stats';
import { TerrainRenderer, bilinearHeight, type PoliticsMode } from './terrain';
import { EffectsRenderer } from './effects';
import { seasonOf } from '../sim/environment';

const MAX_AGENTS_INITIAL = 2048;

export type Pick = { kind: 'agent'; id: number } | { kind: 'building'; id: number } | null;

export class WorldRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  colorMode: ColorMode = 'job';
  buildingColorMode: BuildingColorMode = 'type';
  selectedAgentId: number | null = null;
  selectedBuildingId: number | null = null;
  follow = false;
  cinematicOrbit = false;

  private sim: Simulation;
  private agentMesh!: THREE.InstancedMesh;
  private capacity = 0;
  private indexToAgent: number[] = [];
  private display = new Map<number, { x: number; z: number }>();
  private buildingGroups = new Map<number, THREE.Group>();
  private buildingPickables: THREE.Object3D[] = [];
  private buildingSig = new Map<number, string>();
  private spinners: THREE.Object3D[] = [];
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private terrain: TerrainRenderer;
  private effects: EffectsRenderer;
  private selectionRing: THREE.Mesh;
  private buildingOutline: THREE.LineSegments;
  private linkLines: THREE.LineSegments;
  private plazaGlow: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private tmpMatrix = new THREE.Matrix4();
  private tmpColor = new THREE.Color();
  private tmpQuat = new THREE.Quaternion();
  private tmpScale = new THREE.Vector3();
  private tmpPos = new THREE.Vector3();
  private wealthRankCache = new Map<number, number>();
  private wealthDay = -1;

  // Shared geometries
  private boxGeo = new THREE.BoxGeometry(1, 1, 1);
  private pyrGeo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  private coneGeo = new THREE.ConeGeometry(0.5, 1, 12);
  private cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12);
  private sphereGeo = new THREE.SphereGeometry(0.5, 14, 10);

  constructor(private container: HTMLElement, sim: Simulation) {
    this.sim = sim;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(44, 1, 0.5, 2200);
    this.camera.position.set(78, 82, 102);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 650;
    this.controls.screenSpacePanning = false;

    this.scene.background = new THREE.Color('#f7f7f5');
    this.scene.fog = new THREE.Fog('#f7f7f5', 260, 750);
    this.hemi = new THREE.HemisphereLight('#ffffff', '#d9d6cf', 1.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 1.65);
    this.sun.position.set(60, 120, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -180; sc.right = 180; sc.top = 180; sc.bottom = -180; sc.far = 420;
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun);

    this.terrain = new TerrainRenderer(sim, this.scene);
    this.effects = new EffectsRenderer(sim, this.scene);

    this.selectionRing = new THREE.Mesh(new THREE.RingGeometry(0.75, 1.05, 32), new THREE.MeshBasicMaterial({ color: '#3b5bdb', side: THREE.DoubleSide }));
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.buildingOutline = new THREE.LineSegments(new THREE.EdgesGeometry(this.boxGeo), new THREE.LineBasicMaterial({ color: '#3b5bdb' }));
    this.buildingOutline.visible = false;
    this.scene.add(this.buildingOutline);

    this.linkLines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: '#3b5bdb', dashSize: 1, gapSize: 0.7, transparent: true, opacity: 0.7 }));
    this.scene.add(this.linkLines);

    this.plazaGlow = new THREE.Mesh(new THREE.CircleGeometry(7.5, 40), new THREE.MeshBasicMaterial({ color: '#fa5252', transparent: true, opacity: 0.0, depthWrite: false }));
    this.plazaGlow.rotation.x = -Math.PI / 2;
    this.plazaGlow.position.y = 0.15;
    this.scene.add(this.plazaGlow);

    this.allocateAgents(MAX_AGENTS_INITIAL);
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  setPoliticsMode(mode: PoliticsMode) { this.terrain.setPoliticsMode(mode); }
  get politicsMode() { return this.terrain.politicsMode; }

  setSimulation(sim: Simulation) {
    this.sim = sim;
    this.terrain.setSimulation(sim);
    this.effects.setSimulation(sim);
    for (const g of this.buildingGroups.values()) this.disposeGroup(g);
    this.buildingGroups.clear();
    this.buildingPickables = [];
    this.buildingSig.clear();
    this.spinners = [];
    this.display.clear();
    this.selectedAgentId = null;
    this.selectedBuildingId = null;
  }

  private disposeGroup(g: THREE.Group) {
    this.scene.remove(g);
    g.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const m = (obj as THREE.Mesh).material;
        if (Array.isArray(m)) m.forEach(x => x.dispose());
        else if (m) m.dispose();
      }
    });
  }

  private allocateAgents(n: number) {
    if (this.agentMesh) { this.scene.remove(this.agentMesh); this.agentMesh.dispose(); }
    const geo = new THREE.CapsuleGeometry(0.38, 0.85, 4, 10);
    geo.translate(0, 0.38 + 0.425, 0);
    const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.agentMesh = new THREE.InstancedMesh(geo, mat, n);
    this.agentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.agentMesh.castShadow = true;
    this.agentMesh.frustumCulled = false;
    this.agentMesh.setColorAt(0, new THREE.Color('#fff'));
    this.scene.add(this.agentMesh);
    this.capacity = n;
  }

  resize = () => {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  };

  private addPart(
    group: THREE.Group,
    geo: THREE.BufferGeometry,
    color: string,
    x: number, y: number, z: number,
    sx: number, sy: number, sz: number,
    buildingId: number,
    opts?: { rx?: number; ry?: number; rz?: number; transparent?: boolean; opacity?: number },
  ): THREE.Mesh {
    const mat = new THREE.MeshLambertMaterial({
      color,
      transparent: opts?.transparent ?? false,
      opacity: opts?.opacity ?? 1,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (opts?.rx) m.rotation.x = opts.rx;
    if (opts?.ry) m.rotation.y = opts.ry;
    if (opts?.rz) m.rotation.z = opts.rz;
    m.castShadow = sy > 0.35;
    m.receiveShadow = true;
    m.userData.buildingId = buildingId;
    group.add(m);
    return m;
  }

  private buildStylizedModel(b: Building, baseColor: string): THREE.Group {
    const g = new THREE.Group();
    g.position.set(b.pos.x, bilinearHeight(this.sim.state.terrain, b.pos.x, b.pos.z), b.pos.z);
    const id = b.id;
    const { w, d, h } = b.size;

    if (!b.complete) {
      const ch = Math.max(0.4, 3.2 * b.progress);
      this.addPart(g, this.boxGeo, baseColor, 0, ch / 2, 0, w, ch, d, id, { transparent: true, opacity: 0.5 });
      // Scaffolding posts
      for (const sx of [-w * 0.48, w * 0.48]) {
        for (const sz of [-d * 0.48, d * 0.48]) {
          this.addPart(g, this.boxGeo, '#b08968', sx, ch * 0.6, sz, 0.2, ch * 1.2, 0.2, id);
        }
      }
      return g;
    }

    switch (b.type) {
      case 'house': {
        this.addPart(g, this.boxGeo, baseColor, 0, h / 2, 0, w, h, d, id);
        this.addPart(g, this.pyrGeo, '#c9bba8', 0, h + 0.85, 0, w * 1.12, 1.7, d * 1.12, id);
        this.addPart(g, this.boxGeo, '#8d6e63', w * 0.25, h + 1.2, -d * 0.2, 0.45, 1.2, 0.45, id);
        break;
      }
      case 'tenement': {
        this.addPart(g, this.boxGeo, baseColor, 0, h / 2, 0, w, h, d, id);
        // Horizontal floor ledges & rooftop cornice
        this.addPart(g, this.boxGeo, '#a89f91', 0, h * 0.35, 0, w * 1.03, 0.2, d * 1.03, id);
        this.addPart(g, this.boxGeo, '#a89f91', 0, h * 0.7, 0, w * 1.03, 0.2, d * 1.03, id);
        this.addPart(g, this.boxGeo, '#8d8478', 0, h + 0.2, 0, w * 1.05, 0.4, d * 1.05, id);
        this.addPart(g, this.boxGeo, '#7f776c', w * 0.25, h + 0.75, -d * 0.2, 1.2, 0.9, 1.2, id);
        break;
      }
      case 'manor': {
        // Grand central hall + flanking wings + portico columns
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.5, 0, w * 0.65, h, d * 0.72, id);
        this.addPart(g, this.pyrGeo, '#8c6d53', 0, h + 0.9, 0, w * 0.72, 1.8, d * 0.8, id);
        this.addPart(g, this.boxGeo, baseColor, -w * 0.36, h * 0.38, 0, w * 0.3, h * 0.76, d * 0.62, id);
        this.addPart(g, this.boxGeo, baseColor, w * 0.36, h * 0.38, 0, w * 0.3, h * 0.76, d * 0.62, id);
        this.addPart(g, this.pyrGeo, '#8c6d53', -w * 0.36, h * 0.76 + 0.55, 0, w * 0.34, 1.1, d * 0.68, id);
        this.addPart(g, this.pyrGeo, '#8c6d53', w * 0.36, h * 0.76 + 0.55, 0, w * 0.34, 1.1, d * 0.68, id);
        break;
      }
      case 'farm': {
        this.addPart(g, this.boxGeo, baseColor, 0, 0.15, 0, w, 0.3, d, id);
        for (let r = -3; r <= 2; r++) {
          this.addPart(g, this.boxGeo, '#94b857', 0, 0.36, r * 1.05, w * 0.86, 0.18, 0.45, id);
        }
        // Small red barn in corner
        this.addPart(g, this.boxGeo, '#c97a63', -w * 0.28, 0.95, -d * 0.28, 2.0, 1.6, 1.8, id);
        this.addPart(g, this.pyrGeo, '#8d5b4c', -w * 0.28, 2.1, -d * 0.28, 2.2, 0.8, 2.0, id);
        break;
      }
      case 'mill': {
        this.addPart(g, this.cylGeo, baseColor, 0, h * 0.45, 0, w * 0.62, h * 0.9, d * 0.62, id);
        this.addPart(g, this.coneGeo, '#8d6e63', 0, h * 0.9 + 0.8, 0, w * 0.7, 1.6, d * 0.7, id);
        // Rotating windmill sails
        const hub = new THREE.Group();
        hub.position.set(0, h * 0.68, d * 0.36);
        this.addPart(hub, this.boxGeo, '#6d4c41', 0, 0, 0, 5.2, 0.32, 0.14, id);
        this.addPart(hub, this.boxGeo, '#6d4c41', 0, 0, 0, 0.32, 5.2, 0.14, id);
        g.add(hub);
        this.spinners.push(hub);
        break;
      }
      case 'bakery': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.45, 0, w, h * 0.9, d, id);
        this.addPart(g, this.pyrGeo, '#b57c56', 0, h * 0.9 + 0.65, 0, w * 1.08, 1.3, d * 1.08, id);
        this.addPart(g, this.cylGeo, '#9c5236', w * 0.28, h * 0.85, -d * 0.22, 0.9, h * 1.5, 0.9, id);
        break;
      }
      case 'lumber_camp': {
        this.addPart(g, this.boxGeo, '#e6dec8', 0, 0.12, 0, w, 0.24, d, id);
        this.addPart(g, this.boxGeo, baseColor, -w * 0.2, 1.2, -d * 0.18, w * 0.48, 2.2, d * 0.45, id);
        this.addPart(g, this.pyrGeo, '#7f5539', -w * 0.2, 2.75, -d * 0.18, w * 0.54, 1.0, d * 0.52, id);
        // Log stack & pine trees
        for (let i = 0; i < 3; i++) {
          this.addPart(g, this.cylGeo, '#8d5524', w * 0.22, 0.4 + i * 0.35, d * 0.18, 0.45, 2.4, 0.45, id, { rz: Math.PI / 2 });
        }
        this.addPart(g, this.coneGeo, '#4d7c43', w * 0.25, 2.0, -d * 0.25, 1.8, 3.2, 1.8, id);
        break;
      }
      case 'mine': {
        this.addPart(g, this.boxGeo, '#d6d4ce', 0, 0.15, 0, w, 0.3, d, id);
        // Rocky mound + headframe tower
        this.addPart(g, this.coneGeo, '#8d9299', -w * 0.18, 1.6, -d * 0.15, 3.6, 3.0, 3.4, id);
        this.addPart(g, this.boxGeo, '#495057', -w * 0.18, 0.9, d * 0.08, 1.4, 1.4, 1.2, id);
        this.addPart(g, this.boxGeo, '#6c584c', w * 0.22, 2.1, 0, 1.5, 4.0, 1.5, id);
        break;
      }
      case 'workshop':
      case 'smithy':
      case 'tailor_shop': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.45, 0, w, h * 0.9, d, id);
        // Sawtooth / shed roof + chimney for smithy
        this.addPart(g, this.pyrGeo, b.type === 'smithy' ? '#6c584c' : '#a99985', 0, h * 0.9 + 0.6, 0, w * 1.05, 1.2, d * 1.05, id);
        if (b.type === 'smithy') {
          this.addPart(g, this.cylGeo, '#495057', -w * 0.28, h * 0.95, -d * 0.22, 1.0, h * 1.5, 1.0, id);
        } else if (b.type === 'tailor_shop') {
          this.addPart(g, this.boxGeo, '#ae3ec9', 0, h * 0.35, d * 0.52, w * 0.7, 0.35, 0.8, id);
        }
        break;
      }
      case 'factory': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.45, 0, w, h * 0.9, d, id);
        // Sawtooth industrial bays + twin tall smokestacks
        for (let i = -1; i <= 1; i++) {
          this.addPart(g, this.pyrGeo, '#868e96', i * (w * 0.3), h * 0.9 + 0.55, 0, w * 0.32, 1.1, d * 0.95, id);
        }
        this.addPart(g, this.cylGeo, '#495057', -w * 0.3, h * 0.95, -d * 0.32, 0.85, h * 1.7, 0.85, id);
        this.addPart(g, this.cylGeo, '#495057', -w * 0.12, h * 0.85, -d * 0.32, 0.75, h * 1.5, 0.75, id);
        break;
      }
      case 'warehouse': {
        this.addPart(g, this.boxGeo, baseColor, -w * 0.12, h * 0.45, 0, w * 0.72, h * 0.9, d, id);
        this.addPart(g, this.cylGeo, '#b8b0a4', w * 0.28, h * 0.55, -d * 0.2, 1.6, h * 1.1, 1.6, id);
        this.addPart(g, this.cylGeo, '#b8b0a4', w * 0.28, h * 0.55, d * 0.2, 1.6, h * 1.1, 1.6, id);
        break;
      }
      case 'market': {
        this.addPart(g, this.boxGeo, '#ece7d5', 0, 0.12, 0, w, 0.24, d, id);
        const stallColors = ['#e03131', '#2f9e44', '#f59f00', '#3b5bdb'];
        let si = 0;
        for (const sx of [-w * 0.25, w * 0.25]) {
          for (const sz of [-d * 0.25, d * 0.25]) {
            this.addPart(g, this.boxGeo, '#c9b89c', sx, 0.7, sz, 2.2, 1.1, 1.8, id);
            this.addPart(g, this.pyrGeo, stallColors[si++ % 4], sx, 1.55, sz, 2.5, 0.75, 2.1, id);
          }
        }
        break;
      }
      case 'bank': {
        // Neoclassical temple-front bank with colonnade and pediment
        this.addPart(g, this.boxGeo, '#d8dfd8', 0, 0.3, 0, w * 1.04, 0.6, d * 1.04, id);
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.48, -d * 0.06, w * 0.88, h * 0.85, d * 0.82, id);
        for (let i = -1.5; i <= 1.5; i += 1) {
          this.addPart(g, this.cylGeo, '#f1f3f5', i * (w * 0.22), h * 0.45, d * 0.4, 0.42, h * 0.8, 0.42, id);
        }
        this.addPart(g, this.pyrGeo, '#adb5bd', 0, h * 0.9 + 0.65, 0, w * 0.98, 1.3, d * 0.98, id);
        break;
      }
      case 'tavern': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.35, 0, w, h * 0.7, d, id);
        this.addPart(g, this.boxGeo, '#dcc3a5', 0, h * 0.75, 0, w * 1.06, h * 0.35, d * 1.06, id);
        this.addPart(g, this.pyrGeo, '#7f4f24', 0, h + 0.75, 0, w * 1.12, 1.5, d * 1.12, id);
        break;
      }
      case 'theater': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.42, 0, w, h * 0.84, d, id);
        this.addPart(g, this.sphereGeo, '#d6a2bc', 0, h * 0.84, 0, w * 0.65, 2.4, d * 0.65, id);
        this.addPart(g, this.boxGeo, '#e64980', 0, h * 0.35, d * 0.52, w * 0.6, 0.4, 0.9, id);
        break;
      }
      case 'clinic': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.46, 0, w, h * 0.92, d, id);
        // Red cross emblem on roof
        this.addPart(g, this.boxGeo, '#e03131', 0, h * 0.95, 0, 2.2, 0.25, 0.7, id);
        this.addPart(g, this.boxGeo, '#e03131', 0, h * 0.95, 0, 0.7, 0.25, 2.2, id);
        break;
      }
      case 'school': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.45, 0, w, h * 0.9, d, id);
        this.addPart(g, this.pyrGeo, '#748ffc', 0, h * 0.9 + 0.55, 0, w * 1.06, 1.1, d * 1.06, id);
        this.addPart(g, this.boxGeo, baseColor, 0, h + 1.1, 0, 1.3, 1.4, 1.3, id);
        this.addPart(g, this.pyrGeo, '#4c6ef5', 0, h + 2.0, 0, 1.6, 0.8, 1.6, id);
        break;
      }
      case 'university': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.42, 0, w, h * 0.84, d, id);
        this.addPart(g, this.sphereGeo, '#5c7cfa', 0, h * 0.84, 0, 3.4, 3.0, 3.4, id);
        this.addPart(g, this.cylGeo, '#4263eb', 0, h + 1.6, 0, 0.3, 1.2, 0.3, id);
        break;
      }
      case 'temple': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.32, 0.5, w * 0.75, h * 0.64, d * 0.82, id);
        this.addPart(g, this.pyrGeo, '#c9a96e', 0, h * 0.64 + 0.7, 0.5, w * 0.82, 1.4, d * 0.88, id);
        // Tall bell tower & spire at front
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.55, -d * 0.28, 2.1, h * 1.1, 2.1, id);
        this.addPart(g, this.coneGeo, '#b08d57', 0, h * 1.1 + 1.6, -d * 0.28, 2.3, 3.2, 2.3, id);
        break;
      }
      case 'townhall': {
        this.addPart(g, this.boxGeo, '#dcd6eb', 0, 0.35, 0, w * 1.05, 0.7, d * 1.05, id);
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.36, 0, w * 0.9, h * 0.68, d * 0.88, id);
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.78, 0, 2.4, h * 0.55, 2.4, id);
        this.addPart(g, this.pyrGeo, '#7950f2', 0, h * 1.06 + 0.9, 0, 2.8, 1.8, 2.8, id);
        break;
      }
      case 'guardhouse': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.42, 0, w * 0.85, h * 0.84, d * 0.85, id);
        for (const sx of [-w * 0.38, w * 0.38]) {
          for (const sz of [-d * 0.38, d * 0.38]) {
            this.addPart(g, this.boxGeo, '#9aa5d6', sx, h * 0.55, sz, 1.3, h * 1.1, 1.3, id);
          }
        }
        break;
      }
      case 'prison': {
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.45, 0, w, h * 0.9, d, id);
        this.addPart(g, this.boxGeo, '#868e96', -w * 0.38, h * 0.65, -d * 0.38, 1.5, h * 1.3, 1.5, id);
        this.addPart(g, this.boxGeo, '#868e96', w * 0.38, h * 0.65, d * 0.38, 1.5, h * 1.3, 1.5, id);
        break;
      }
      case 'yard': {
        this.addPart(g, this.boxGeo, baseColor, 0, 0.15, 0, w, 0.3, d, id);
        // Construction crane
        this.addPart(g, this.boxGeo, '#f59f00', -w * 0.25, 2.6, -d * 0.25, 0.5, 5.2, 0.5, id);
        this.addPart(g, this.boxGeo, '#f59f00', 0.4, 5.0, -d * 0.25, 4.6, 0.35, 0.35, id);
        break;
      }
      case 'plaza': {
        this.addPart(g, this.boxGeo, baseColor, 0, 0.1, 0, w, 0.2, d, id);
        this.addPart(g, this.cylGeo, '#d0ebff', 0, 0.4, 0, 3.0, 0.5, 3.0, id);
        this.addPart(g, this.cylGeo, '#74c0fc', 0, 1.1, 0, 0.7, 1.4, 0.7, id);
        break;
      }
      case 'monument': {
        this.addPart(g, this.boxGeo, '#d8d2c5', 0, 0.45, 0, w * 0.75, 0.9, d * 0.75, id);
        this.addPart(g, this.boxGeo, baseColor, 0, 1.4, 0, w * 0.45, 1.2, d * 0.45, id);
        this.addPart(g, this.boxGeo, baseColor, 0, h * 0.55, 0, 1.3, h * 0.85, 1.3, id);
        this.addPart(g, this.pyrGeo, '#fab005', 0, h * 0.98 + 0.6, 0, 1.4, 1.2, 1.4, id);
        break;
      }
      default: {
        this.addPart(g, this.boxGeo, baseColor, 0, h / 2, 0, w, h, d, id);
      }
    }
    return g;
  }

  private syncBuildings() {
    const s = this.sim.state;
    const seen = new Set<number>();
    let changed = false;
    for (const b of s.buildings) {
      seen.add(b.id);
      const ownColor = this.buildingColorMode === 'ownership' && b.type !== 'plaza' && b.type !== 'monument';
      const color = ownColor ? ownershipColor(this.sim, b) : BUILDING_COLORS[b.type];
      const sig = `${b.type}|${b.complete}|${b.size.h}|${color}|${b.complete ? 1 : Math.round(b.progress * 10)}`;
      if (this.buildingSig.get(b.id) !== sig) {
        this.buildingSig.set(b.id, sig);
        const old = this.buildingGroups.get(b.id);
        if (old) this.disposeGroup(old);
        const grp = this.buildStylizedModel(b, color);
        this.scene.add(grp);
        this.buildingGroups.set(b.id, grp);
        changed = true;
      }
    }
    for (const [id, grp] of this.buildingGroups) {
      if (!seen.has(id)) {
        this.disposeGroup(grp);
        this.buildingGroups.delete(id);
        this.buildingSig.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.buildingPickables = [];
      for (const grp of this.buildingGroups.values()) {
        grp.traverse(obj => { if ((obj as THREE.Mesh).isMesh) this.buildingPickables.push(obj); });
      }
    }
  }

  private wealthRank = (a: Agent) => this.wealthRankCache.get(a.householdId) ?? 0;

  private updateWealthRanks() {
    if (this.wealthDay === this.sim.state.day) return;
    this.wealthDay = this.sim.state.day;
    const w = householdWealth(this.sim);
    const list = this.sim.state.households.map(hh => ({ id: hh.id, v: (w.get(hh.id) ?? 0) / Math.max(1, hh.members.length) })).sort((a, b) => a.v - b.v);
    this.wealthRankCache.clear();
    list.forEach((x, i) => this.wealthRankCache.set(x.id, list.length > 1 ? i / (list.length - 1) : 0.5));
  }

  render(dt: number) {
    const s = this.sim.state;
    this.syncBuildings();
    if (this.colorMode === 'wealth') this.updateWealthRanks();
    const agents = s.agents;
    if (agents.length > this.capacity) this.allocateAgents(Math.ceil(agents.length * 1.5));

    // Rotate windmill sails
    for (const sp of this.spinners) sp.rotation.z += dt * 1.2;

    const k = 1 - Math.exp(-dt * 10);
    const alive = new Set<number>();
    this.indexToAgent.length = agents.length;
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      alive.add(a.id);
      let d = this.display.get(a.id);
      if (!d) { d = { x: a.pos.x, z: a.pos.z }; this.display.set(a.id, d); }
      if (Math.abs(d.x - a.pos.x) + Math.abs(d.z - a.pos.z) > 40) { d.x = a.pos.x; d.z = a.pos.z; }
      d.x += (a.pos.x - d.x) * k; d.z += (a.pos.z - d.z) * k;
      const scale = a.age < 6 ? 0.5 : a.age < 14 ? 0.7 : a.age < 18 ? 0.85 : 1;
      this.tmpPos.set(d.x, bilinearHeight(this.sim.state.terrain, d.x, d.z), d.z);
      this.tmpScale.set(scale, scale, scale);
      this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
      this.agentMesh.setMatrixAt(i, this.tmpMatrix);
      const c = agentColor(this.sim, a, this.colorMode, this.wealthRank);
      this.tmpColor.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
      this.agentMesh.setColorAt(i, this.tmpColor);
      this.indexToAgent[i] = a.id;
    }
    if (this.display.size > agents.length + 50) for (const id of this.display.keys()) if (!alive.has(id)) this.display.delete(id);
    this.agentMesh.count = agents.length;
    this.agentMesh.instanceMatrix.needsUpdate = true;
    if (this.agentMesh.instanceColor) this.agentMesh.instanceColor.needsUpdate = true;

    this.updateSelection();
    this.updateLighting();
    this.terrain.update(dt, seasonOf(s.day));
    this.effects.update(dt);

    const protest = s.factions.some(f => f.protestToday || f.strikeToday);
    const festival = s.culture.festivalDaysLeft > 0;
    const plaza = this.sim.buildingsOf('plaza')[0];
    const mat = this.plazaGlow.material as THREE.MeshBasicMaterial;
    if (plaza) this.plazaGlow.position.set(plaza.pos.x, bilinearHeight(s.terrain, plaza.pos.x, plaza.pos.z) + 0.15, plaza.pos.z);
    if (protest) {
      mat.color.set('#fa5252');
      mat.opacity = 0.2 + 0.12 * Math.sin(performance.now() / 250);
    } else if (festival) {
      mat.color.set('#fab005');
      mat.opacity = 0.18 + 0.1 * Math.sin(performance.now() / 350);
    } else {
      mat.opacity = 0;
    }

    if (this.cinematicOrbit) {
      const ang = performance.now() * 0.00015;
      const rad = 88;
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(Math.cos(ang) * rad, 58 + Math.sin(ang * 2) * 8, Math.sin(ang) * rad);
    } else if (this.follow && this.selectedAgentId != null) {
      const d = this.display.get(this.selectedAgentId);
      if (d) {
        const target = this.controls.target;
        const dx = (d.x - target.x) * 0.08, dz = (d.z - target.z) * 0.08;
        target.x += dx; target.z += dz;
        this.camera.position.x += dx; this.camera.position.z += dz;
      }
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private updateSelection() {
    const a = this.sim.agent(this.selectedAgentId);
    const positions: number[] = [];
    if (a) {
      const d = this.display.get(a.id)!;
      if (d) {
        this.selectionRing.visible = true;
        this.selectionRing.position.set(d.x, bilinearHeight(this.sim.state.terrain, d.x, d.z) + 0.05, d.z);
        const pulse = 1 + 0.12 * Math.sin(performance.now() / 200);
        this.selectionRing.scale.setScalar(pulse);
        const addLink = (b: Building | undefined) => { if (b) positions.push(d.x, 0.3, d.z, b.pos.x, 0.3, b.pos.z); };
        addLink(this.sim.building(this.sim.household(a.householdId)?.homeId));
        addLink(this.sim.building(a.workplaceId));
      }
    } else this.selectionRing.visible = false;
    const geo = this.linkLines.geometry as THREE.BufferGeometry;
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.linkLines.computeLineDistances();
    this.linkLines.visible = positions.length > 0;

    const b = this.sim.building(this.selectedBuildingId);
    if (b) {
      const h = b.complete ? b.size.h : 3 * b.progress;
      this.buildingOutline.visible = true;
      this.buildingOutline.scale.set(b.size.w + 0.4, Math.max(0.4, h) + 0.4, b.size.d + 0.4);
      this.buildingOutline.position.set(b.pos.x, bilinearHeight(this.sim.state.terrain, b.pos.x, b.pos.z) + Math.max(0.4, h) / 2, b.pos.z);
    } else this.buildingOutline.visible = false;
  }

  private updateLighting() {
    if (this.cinematicOrbit) {
      this.sun.intensity = 1.65;
      this.hemi.intensity = 1.55;
      const bg = new THREE.Color('#f4f3ee');
      (this.scene.background as THREE.Color).copy(bg);
      (this.scene.fog as THREE.Fog).color.copy(bg);
      this.sun.position.set(75, 115, 55);
      return;
    }
    const s = this.sim.state;
    const t = s.hour + (s.tick % 4) / 4;
    const day = Math.max(0, Math.sin(((t - 6) / 24) * Math.PI * 2)) ** 0.6;
    const night = 1 - day;
    // Weather dims and greys the scene; storms get the gloomiest skies
    const gloom = this.effects.weatherGloom();
    this.sun.intensity = (0.28 + 1.45 * day) * (1 - gloom * 0.6);
    this.hemi.intensity = (0.92 + 0.68 * day) * (1 - gloom * 0.32);
    const bg = new THREE.Color('#f7f7f5').lerp(new THREE.Color('#c9d1e3'), night * 0.72).lerp(new THREE.Color('#9aa4b0'), gloom * 0.55);
    (this.scene.background as THREE.Color).copy(bg);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    (this.scene.fog as THREE.Fog).far = 750 - gloom * 260;
    const ang = ((t - 6) / 12) * Math.PI;
    this.sun.position.set(Math.cos(ang) * 120, 40 + Math.sin(Math.max(0.15, ang)) * 100, 50);
  }

  pick(clientX: number, clientY: number): Pick {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    this.agentMesh.computeBoundingSphere();
    const hitA = this.raycaster.intersectObject(this.agentMesh, false)[0];
    const hitB = this.raycaster.intersectObjects(this.buildingPickables, false)[0];
    if (hitA && hitA.instanceId != null && (!hitB || hitA.distance <= hitB.distance + 1)) {
      const id = this.indexToAgent[hitA.instanceId];
      if (id != null) return { kind: 'agent', id };
    }
    if (hitB && hitB.object.userData.buildingId != null) {
      return { kind: 'building', id: hitB.object.userData.buildingId as number };
    }
    return null;
  }

  focusOn(x: number, z: number) {
    const target = this.controls.target;
    const dx = x - target.x, dz = z - target.z;
    target.x += dx; target.z += dz;
    this.camera.position.x += dx; this.camera.position.z += dz;
  }

  screenPos(agentId: number): { x: number; y: number; visible: boolean } | null {
    const d = this.display.get(agentId);
    if (!d) return null;
    const v = new THREE.Vector3(d.x, 2.4, d.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, visible: v.z < 1 };
  }

  dispose() {
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
