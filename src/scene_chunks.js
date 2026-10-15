import * as THREE from 'three';
import { railKey } from './rails.js';

const clamp = THREE.MathUtils.clamp;
const PALE = 0xe9ecdc;
const CHUNK = 96;
const FRONT = 576;
const BACK = 144;

export const SCENE_THEMES = {
  forest: { top: 0x597e88, fog: 0xc9d1ba, ground: 0x647653, soil: 0x3d4c37, stone: 0x798170, trees: [0x354f2d, 0x496039, 0x597345], ridge: 0x657d77, sun: 0xffe2a9 },
  sunset: { top: 0x6a6878, fog: 0xd8b391, ground: 0x7a7353, soil: 0x534c3a, stone: 0x95826e, trees: [0x43563a, 0x5a6941, 0x7b7550], ridge: 0x867a82, sun: 0xffae69 },
  cliff: { top: 0x64899c, fog: 0xb9cacc, ground: 0x73735e, soil: 0x505650, stone: 0x8e8f84, trees: [0x45513b, 0x5d6745], ridge: 0x6a838b, sun: 0xffecd4 },
  hairpin: { top: 0x7e8c94, fog: 0xd5c7a8, ground: 0x807b5b, soil: 0x5b5b49, stone: 0x938d7c, trees: [0x4b573d, 0x626945, 0x757b53], ridge: 0x859389, sun: 0xffd194 },
  rain: { top: 0x111e2d, fog: 0x435562, ground: 0x384845, soil: 0x243330, stone: 0x58686b, trees: [0x233b33, 0x2e453d], ridge: 0x293c4a, sun: 0x9cb7d8 },
  snow: { top: 0x5a809a, fog: 0xd0dce4, ground: 0xe5e8e4, soil: 0x8f9c9f, stone: 0xaab6bb, trees: [0x6f8881, 0x8ca09a, 0xcad4cd], ridge: 0x7f9bab, sun: 0xe0eeff },
  bridge: { top: 0x5b7784, fog: 0xb5c2be, ground: 0x687363, soil: 0x445650, stone: 0x86948b, trees: [0x374f3c, 0x546749], ridge: 0x6a7f86, sun: 0xffdfb8 },
  extreme: { top: 0x555f72, fog: 0xb1b5b5, ground: 0x6b7063, soil: 0x484e49, stone: 0x85898a, trees: [0x3d5142, 0x5d6651], ridge: 0x6f7e8c, sun: 0xdce1ee },
  final: { top: 0x1d293b, fog: 0x626e79, ground: 0x52605c, soil: 0x323e40, stone: 0x7b8992, trees: [0x33453f, 0x526159], ridge: 0x465868, sun: 0xa8b5d2 },
};

function rng(seed) {
  let n = seed >>> 0;
  return () => { n += 0x6d2b79f5; let x = n; x = Math.imul(x ^ x >>> 15, x | 1); x ^= x + Math.imul(x ^ x >>> 7, x | 61); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}

export function roadAt(p, offset = 0, elevation = 0) {
  return new THREE.Vector3(p.x + Math.cos(p.yaw) * offset, p.y + elevation, p.z + Math.sin(p.yaw) * offset);
}

function quad(vertices, a, b, c, d, colors, color) {
  for (const p of [a, c, b, b, c, d]) {
    vertices.push(p.x, p.y, p.z);
    if (colors) colors.push(color.r, color.g, color.b);
  }
}

function geometry(vertices, colors) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  const uv = [];
  for (let i = 0; i < vertices.length; i += 3) uv.push(vertices[i] * 0.13, vertices[i + 2] * 0.13);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function standard(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide, ...extra });
}

function makeNoiseTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(128, 128);
  const random = rng(90413);
  for (let i = 0; i < data.data.length; i += 4) {
    const value = 155 + Math.floor(random() * 75);
    data.data[i] = value; data.data[i + 1] = value; data.data[i + 2] = value; data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/** Owns a bounded visible corridor. Track points are CPU data; only nearby meshes exist. */
export class RoadStreamer {
  constructor(owner) {
    this.owner = owner;
    this.chunks = new Map();
    this.queue = [];
    this.hazards = new Map();
    this.disposedChunks = 0;
    this.maxChunks = Math.ceil((FRONT + BACK) / CHUNK) + 3;
    this.noise = makeNoiseTexture();
    this.sharedGeometry = {
      box: new THREE.BoxGeometry(1, 1, 1),
      trunk: new THREE.CylinderGeometry(0.15, 0.24, 1, 6),
      fir: new THREE.ConeGeometry(1, 1, 7),
      crown: new THREE.IcosahedronGeometry(1, 0),
      rock: new THREE.DodecahedronGeometry(1, 0),
      barrel: new THREE.CylinderGeometry(0.39, 0.41, 0.95, 14),
      ring: new THREE.CylinderGeometry(0.414, 0.414, 0.07, 14),
      grass: new THREE.ConeGeometry(0.4, 0.7, 3),
    };
  }

  clear() {
    for (const chunk of this.chunks.values()) this.releaseChunk(chunk);
    this.chunks.clear();
    this.queue = [];
    for (const entity of this.hazards.values()) this.releaseHazard(entity);
    this.hazards.clear();
    if (this.ridges) {
      this.owner.trackGroup.remove(this.ridges);
      this.ridges.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
      this.ridges = null;
    }
    for (const m of Object.values(this.materials || {})) m.dispose();
    this.materials = {};
    if (this.environment) { this.owner.scene.environment = null; this.environment.dispose(); this.environment = null; }
  }

  load(track) {
    this.clear();
    this.track = track;
    this.theme = track.level?.theme || 'forest';
    this.palette = SCENE_THEMES[this.theme] || SCENE_THEMES.forest;
    this.seed = track.runSeed || track.level?.seed || 1;
    this.roadSamples = track.points?.filter((_, i) => i % 8 === 0) || [];
    const dark = ['rain', 'final'].includes(this.theme);
    const p = this.palette;
    this.materials = {
      asphalt: standard(dark ? 0x252e34 : this.theme === 'snow' ? 0x58666e : 0x343936, { map: this.noise, roughness: dark ? 0.24 : 0.93, metalness: dark ? 0.26 : 0.03 }),
      wet: standard(0x283a43, { map: this.noise, roughness: 0.17, metalness: 0.42 }),
      snow: standard(0xcdd8df, { map: this.noise, roughness: 0.86 }),
      ice: standard(0x8baabf, { roughness: 0.12, metalness: 0.4 }),
      gravel: standard(p.stone, { map: this.noise }),
      terrain: standard(0xffffff, { vertexColors: true, flatShading: true }),
      line: standard(PALE, { emissive: PALE, emissiveIntensity: dark ? 0.08 : 0 }),
      yellow: standard(0xe7c872),
      steel: standard(0xa3adb0, { roughness: 0.36, metalness: 0.78 }),
      post: standard(0x646e73, { metalness: 0.58, roughness: 0.6 }),
      reflector: standard(0xffd69d, { emissive: 0xffbd65, emissiveIntensity: dark ? 1.8 : 0.35 }),
      bark: standard(0x645344, { flatShading: true }),
      foliage: standard(0xffffff, { flatShading: true }),
      rock: standard(p.stone, { flatShading: true }),
      grass: standard(p.ground, { flatShading: true }),
      concrete: standard(dark ? 0x566271 : 0x929791, { map: this.noise, roughness: 0.84 }),
      tunnel: standard(0x53606b, { map: this.noise, roughness: 0.73 }),
      lamp: standard(0xffdfaa, { emissive: 0xffc881, emissiveIntensity: 3.2 }),
      black: standard(0x192427),
      warning: standard(0xe4bd4f),
      barrel: standard(0xc96737, { metalness: 0.18, roughness: 0.55 }),
      water: standard(0x56878c, { roughness: 0.16, metalness: 0.38 }),
      green: standard(0xc7f53f),
    };
    this.makeEnvironment();
    this.buildRidges();
    // Immediate road guarantees the start and preview camera have a complete floor.
    for (let i = 0; i < 3 && i * CHUNK < track.length; i++) this.buildChunk(i);
    this.schedule(0);
    this.syncHazards(0);
  }

  makeEnvironment() {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    const top = new THREE.Color(this.palette.top).getStyle();
    const horizon = new THREE.Color(this.palette.fog).getStyle();
    const gradient = ctx.createLinearGradient(0, 0, 0, 128);
    gradient.addColorStop(0, top); gradient.addColorStop(0.48, horizon); gradient.addColorStop(0.53, horizon); gradient.addColorStop(1, '#24312a');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#fff4d2'; ctx.fillRect(45, 19, 7, 7);
    this.environment = new THREE.CanvasTexture(canvas);
    this.environment.mapping = THREE.EquirectangularReflectionMapping;
    this.environment.colorSpace = THREE.SRGBColorSpace;
    this.owner.scene.environment = this.environment;
    this.owner.scene.environmentIntensity = ['rain', 'final'].includes(this.theme) ? 0.4 : 0.55;
  }

  buildRidges() {
    this.ridges = new THREE.Group();
    const random = rng(this.seed + 8371);
    const snow = this.theme === 'snow';
    for (let layer = 2; layer >= 0; layer--) {
      const vertices = []; const colors = [];
      const segments = 96;
      const radius = 490 + layer * 180;
      const color = new THREE.Color(this.palette.ridge).lerp(new THREE.Color(this.palette.fog), 0.12 + layer * 0.2);
      const colorLow = color.clone().multiplyScalar(0.72);
      const peaks = [];
      for (let i = 0; i <= segments; i++) {
        const angle = (i % segments) / segments * Math.PI * 2;
        peaks.push(159 + layer * 35 + Math.sin(angle * 5 + layer) * 52 + Math.sin(angle * 13 + 0.6) * 33 + Math.sin(angle * 27 + layer * 1.7) * 22 + random() * 24);
      }
      peaks[segments] = peaks[0];
      for (let i = 0; i < segments; i++) {
        const a = i / segments * Math.PI * 2; const b = (i + 1) / segments * Math.PI * 2;
        const va = new THREE.Vector3(Math.cos(a) * radius, peaks[i], Math.sin(a) * radius);
        const vb = new THREE.Vector3(Math.cos(b) * radius, peaks[i + 1], Math.sin(b) * radius);
        const ba = new THREE.Vector3(va.x * 0.86, -75, va.z * 0.86);
        const bb = new THREE.Vector3(vb.x * 0.86, -75, vb.z * 0.86);
        const sa = ba.clone().lerp(va, snow ? 0.8 : 0.6); const sb = bb.clone().lerp(vb, snow ? 0.8 : 0.6);
        quad(vertices, ba, bb, sa, sb, colors, colorLow);
        quad(vertices, sa, sb, va, vb, colors, snow ? new THREE.Color(0xdae4e9).lerp(new THREE.Color(this.palette.fog), layer * 0.2) : color.clone().multiplyScalar(i % 3 === 0 ? 0.91 : 1));
      }
      this.ridges.add(new THREE.Mesh(geometry(vertices, colors), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })));
    }
    this.owner.trackGroup.add(this.ridges);
  }

  schedule(s, direction = 1) {
    const first = Math.max(0, Math.floor((s - (direction < 0 ? FRONT : BACK)) / CHUNK));
    const last = Math.min(Math.ceil(this.track.length / CHUNK) - 1, Math.floor((s + (direction < 0 ? BACK : FRONT)) / CHUNK));
    for (const [id, chunk] of this.chunks) if (id < first || id > last) { this.releaseChunk(chunk); this.chunks.delete(id); }
    this.queue = [];
    const current = Math.floor(Math.min(s, this.track.length - 0.001) / CHUNK);
    // Nearest forward sections win the budget; behind the car is filled afterwards.
    if (direction < 0) {
      for (let id = current; id >= first; id--) if (!this.chunks.has(id)) this.queue.push(id);
      for (let id = current + 1; id <= last; id++) if (!this.chunks.has(id)) this.queue.push(id);
    } else {
      for (let id = current; id <= last; id++) if (!this.chunks.has(id)) this.queue.push(id);
      for (let id = current - 1; id >= first; id--) if (!this.chunks.has(id)) this.queue.push(id);
    }
    this.desiredFirst = first; this.desiredLast = last;
  }

  update(s, quality = 'high', direction = 1) {
    this.schedule(s, direction);
    const current = Math.floor(Math.min(s, this.track.length - 0.001) / CHUNK);
    // A teleport/retry never draws a vehicle over an unbuilt road. These two
    // safety chunks are synchronous; the distant corridor stays incremental.
    for (const id of [Math.max(0, current - 1), current, current + 1]) {
      if (id * CHUNK < this.track.length && !this.chunks.has(id)) this.buildChunk(id);
    }
    this.queue = this.queue.filter(id => !this.chunks.has(id));
    const started = performance.now();
    let built = 0;
    while (this.queue.length && built < 2 && performance.now() - started < 5.5) { this.buildChunk(this.queue.shift()); built++; }
    if (this.ridges) this.ridges.position.copy(roadAt(this.track.sample(s), 0, -105));
    this.syncHazards(s);
    this.syncBrokenRails();
    this.quality = quality;
  }

  addMesh(chunk, vertices, mat, colors) {
    if (!vertices.length) return null;
    const g = geometry(vertices, colors); chunk.geometries.add(g);
    const mesh = new THREE.Mesh(g, this.materials[mat]);
    mesh.receiveShadow = ['asphalt', 'wet', 'snow', 'ice', 'terrain', 'gravel'].includes(mat);
    chunk.group.add(mesh); return mesh;
  }

  instances(chunk, kind, mat, transforms, shadows = false) {
    if (!transforms.length) return;
    const mesh = new THREE.InstancedMesh(this.sharedGeometry[kind], this.materials[mat], transforms.length);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i]; dummy.position.copy(t.position); dummy.rotation.set(...(t.rotation || [0, 0, 0])); dummy.scale.set(...(t.scale || [1, 1, 1])); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
      if (t.color) mesh.setColorAt(i, new THREE.Color(t.color));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (transforms.some(t => t.railKey)) {
      mesh.userData.railKeys = transforms.map(t => t.railKey);
      mesh.userData.hiddenRails = new Set();
      mesh.userData.railVersion = -1;
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.castShadow = shadows;
    chunk.instances.push(mesh); chunk.group.add(mesh);
  }

  nearestRoadDistance(at, s) {
    let result = Infinity;
    for (const p of this.roadSamples) {
      if (Math.abs(p.s - s) < 22) continue;
      result = Math.min(result, Math.hypot(at.x - p.x, at.z - p.z) - p.width * 0.5);
    }
    return result;
  }

  profile(s, side, distance) {
    const cliff = ['cliff', 'bridge', 'extreme', 'final'].includes(this.theme);
    let bridgeBlend = 0;
    for (const range of this.track.gapRanges || []) {
      const gapDistance = s < range.start ? range.start - s : s > range.end ? s - range.end : 0;
      // Shape both approaches continuously instead of dropping an entire bank
      // from uphill to ravine depth in one road segment.
      const t = clamp((170 - gapDistance) / 130, 0, 1);
      bridgeBlend = Math.max(bridgeBlend, t * t * (3 - 2 * t));
    }
    const normalRise = side > 0 ? (cliff ? 1.4 : this.theme === 'snow' ? 1.15 : 0.65) : cliff ? -1.7 : -0.38;
    let normalBankHeight = distance * normalRise;
    if (side > 0 && distance > 34) {
      // Close the hillside across the outer band: the ridge is near 34 m,
      // then falls into the valley instead of ending as a raised ribbon edge.
      const t = clamp((distance - 34) / 34, 0, 1);
      normalBankHeight = THREE.MathUtils.lerp(34 * normalRise, cliff ? -34 : -24, t * t * (3 - 2 * t));
    }
    const bankHeight = THREE.MathUtils.lerp(normalBankHeight, -1.15 * distance, bridgeBlend);
    return -0.08 + bankHeight * (0.85 + Math.sin(s / 71 + side) * 0.15) + Math.sin(s / 31 + distance * 0.11) * Math.min(2.7, distance * 0.1);
  }

  terrainHeight(chunk, point) {
    let nearest = null;
    let delta = Infinity;
    const v = chunk.terrainVertices;
    // Use the terrain that survived the adjacent-lane clearance guard. A
    // mathematical bank profile alone is not evidence that a face exists.
    for (let i = 0; i < v.length; i += 9) {
      const ax = v[i], az = v[i + 2], bx = v[i + 3], bz = v[i + 5], cx = v[i + 6], cz = v[i + 8];
      const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(denominator) < 1e-8) continue;
      const a = ((bz - cz) * (point.x - cx) + (cx - bx) * (point.z - cz)) / denominator;
      const b = ((cz - az) * (point.x - cx) + (ax - cx) * (point.z - cz)) / denominator;
      const c = 1 - a - b;
      if (a < -1e-5 || b < -1e-5 || c < -1e-5) continue;
      const height = a * v[i + 1] + b * v[i + 4] + c * v[i + 7];
      if (Math.abs(point.y - height) < delta) { nearest = height; delta = Math.abs(point.y - height); }
    }
    return nearest;
  }

  samples(start, end) {
    const distances = new Set([start, end]);
    for (let s = Math.ceil(start / 3) * 3; s < end; s += 3) distances.add(s);
    for (const range of [...(this.track.gapRanges || []), ...(this.track.tunnelRanges || [])]) for (const s of [range.start, range.end]) if (s > start && s < end) distances.add(s);
    return [...distances].sort((a, b) => a - b).map(s => this.track.sample(s));
  }

  buildChunk(id) {
    if (this.chunks.has(id)) return;
    const start = id * CHUNK; const end = Math.min(this.track.length, start + CHUNK);
    const random = rng(this.seed + Math.imul(id + 1, 7919));
    const chunk = { id, start, end, group: new THREE.Group(), geometries: new Set(), instances: [] };
    const samples = this.samples(start, end);
    const lists = { asphalt: [], wet: [], snow: [], ice: [], gravel: [], line: [], yellow: [], terrain: [], tunnel: [], water: [], concrete: [] };
    const terrainColors = [];
    const rail = [], posts = [], reflectors = [], lamps = [], warnings = [], warningBlack = [];
    const paletteGround = new THREE.Color(this.palette.ground); const soil = new THREE.Color(this.palette.soil);
    for (let i = 0; i < samples.length - 1; i++) {
      const a = samples[i], b = samples[i + 1], mid = this.track.sample((a.s + b.s) / 2);
      if (mid.gap) continue;
      const surface = mid.surface === 'wet' ? 'wet' : mid.surface === 'snow' ? 'snow' : mid.surface === 'ice' ? 'ice' : 'asphalt';
      quad(lists[surface], roadAt(a, -a.width / 2, 0.018), roadAt(a, a.width / 2, 0.018), roadAt(b, -b.width / 2, 0.018), roadAt(b, b.width / 2, 0.018));
      if (Math.floor(mid.s / 9) % 2 === 0) quad(lists.yellow, roadAt(a, -0.065, 0.037), roadAt(a, 0.065, 0.037), roadAt(b, -0.065, 0.037), roadAt(b, 0.065, 0.037));
      for (const side of [-1, 1]) {
        const edgeA = side * (a.width / 2 - 0.28), edgeB = side * (b.width / 2 - 0.28);
        quad(lists.line, roadAt(a, edgeA - 0.055, 0.039), roadAt(a, edgeA + 0.055, 0.039), roadAt(b, edgeB - 0.055, 0.039), roadAt(b, edgeB + 0.055, 0.039));
        quad(lists.gravel, roadAt(a, side * a.width / 2, -0.024), roadAt(a, side * (a.width / 2 + 0.46), -0.045), roadAt(b, side * b.width / 2, -0.024), roadAt(b, side * (b.width / 2 + 0.46), -0.045));
        if (!mid.tunnel) {
          const bands = [0.46, 4, 14, 34, 68];
          for (let k = 0; k < bands.length - 1; k++) {
            const inner = bands[k], outer = bands[k + 1];
            const va = roadAt(a, side * (a.width / 2 + inner), this.profile(a.s, side, inner - 0.46));
            const vb = roadAt(b, side * (b.width / 2 + inner), this.profile(b.s, side, inner - 0.46));
            const oa = roadAt(a, side * (a.width / 2 + outer), this.profile(a.s, side, outer - 0.46));
            const ob = roadAt(b, side * (b.width / 2 + outer), this.profile(b.s, side, outer - 0.46));
            if (k > 0 && (this.nearestRoadDistance(oa, a.s) < 3 || this.nearestRoadDistance(ob, b.s) < 3)) continue;
            const color = paletteGround.clone().lerp(soil, side > 0 ? 0.25 + random() * 0.22 : 0.1 + random() * 0.22);
            quad(lists.terrain, va, oa, vb, ob, terrainColors, color);
          }
        }
        const hasRail = mid.rails ? (side < 0 ? mid.rails.left : mid.rails.right) : true;
        if (hasRail && !mid.tunnel) {
          const pa = roadAt(a, side * (a.width / 2 + 0.13), 0.83); const pb = roadAt(b, side * (b.width / 2 + 0.13), 0.83);
          const v = pb.clone().sub(pa); const rotation = [Math.atan2(v.y, Math.hypot(v.x, v.z)), Math.atan2(-v.x, -v.z), 0];
          rail.push({ position: pa.clone().add(pb).multiplyScalar(0.5), rotation, scale: [0.13, 0.3, v.length() + 0.09], railKey: railKey(side < 0 ? 'left' : 'right', mid.s) });
          posts.push({ position: roadAt(a, side * (a.width / 2 + 0.13), 0.44), scale: [0.12, 0.88, 0.13], railKey: railKey(side < 0 ? 'left' : 'right', mid.s) });
          if (Math.floor(mid.s / 3) % 4 === 0) reflectors.push({ position: roadAt(a, side * (a.width / 2 + 0.02), 0.88), rotation: [0, -a.yaw, 0], scale: [0.09, 0.095, 0.18], railKey: railKey(side < 0 ? 'left' : 'right', mid.s) });
        }
      }
      if (mid.tunnel) {
        const arch = 12;
        for (let k = 0; k < arch; k++) {
          const ta = k / arch * Math.PI, tb = (k + 1) / arch * Math.PI;
          const cross = (p, angle) => roadAt(p, Math.cos(angle) * (p.width / 2 + 0.46), 0.08 + Math.sin(angle) * 5.1);
          quad(lists.tunnel, cross(a, ta), cross(a, tb), cross(b, ta), cross(b, tb));
        }
        if (Math.floor(mid.s / 3) % 3 === 0) for (const side of [-1, 1]) {
          lamps.push({ position: roadAt(mid, side * (mid.width / 2 - 0.36), 3.0), rotation: [0, -mid.yaw, 0], scale: [0.11, 0.085, 2.3] });
          warnings.push({ position: roadAt(mid, side * (mid.width / 2 + 0.07), 0.32), rotation: [0, -mid.yaw, 0], scale: [0.19, 0.64, 2.8] });
          warningBlack.push({ position: roadAt(mid, side * (mid.width / 2 - 0.035), 0.31), rotation: [0, -mid.yaw, -side * 0.45], scale: [0.032, 0.7, 0.42] });
        }
      }
      const nearGap = (this.track.gapRanges || []).some(r => mid.s > r.start - 50 && mid.s < r.end + 50);
      if (nearGap) {
        quad(lists.concrete, roadAt(a, -a.width / 2, -0.36), roadAt(a, a.width / 2, -0.36), roadAt(b, -b.width / 2, -0.36), roadAt(b, b.width / 2, -0.36));
        quad(lists.water, roadAt(a, -2.8, -44), roadAt(a, 2.8, -44), roadAt(b, -2.8, -44), roadAt(b, 2.8, -44));
      }
    }
    chunk.terrainVertices = lists.terrain;
    for (const [mat, vertices] of Object.entries(lists)) this.addMesh(chunk, vertices, mat, mat === 'terrain' ? terrainColors : null);
    this.instances(chunk, 'box', 'steel', rail);
    this.instances(chunk, 'box', 'post', posts);
    this.instances(chunk, 'box', 'reflector', reflectors);
    this.instances(chunk, 'box', 'lamp', lamps);
    this.instances(chunk, 'box', 'warning', warnings);
    this.instances(chunk, 'box', 'black', warningBlack);
    this.buildVegetation(chunk, random);
    this.buildSigns(chunk);
    this.buildStructures(chunk);
    this.owner.trackGroup.add(chunk.group);
    this.chunks.set(id, chunk);
  }

  buildVegetation(chunk, random) {
    const trunks = [], firs = [], crowns = [], rocks = [], grass = [];
    const sparse = ['cliff', 'bridge', 'extreme'].includes(this.theme);
    const snow = this.theme === 'snow';
    for (let s = Math.ceil(chunk.start / 6) * 6 + 2; s < chunk.end; s += 6) {
      const p = this.track.sample(s); if (p.gap || p.tunnel) continue;
      for (const side of [-1, 1]) {
        const nearBridge = (this.track.gapRanges || []).some(r => Math.abs(s - r.start) < 55 || Math.abs(s - r.end) < 55);
        if (nearBridge) continue;
        if (random() > (sparse ? 0.29 : 0.9)) continue;
        const distance = 4 + random() * 19;
        const pos = roadAt(p, side * (p.width / 2 + distance), this.profile(s, side, distance - 0.46));
        if (this.nearestRoadDistance(pos, s) < 3.7) continue;
        const groundHeight = this.terrainHeight(chunk, pos);
        if (groundHeight === null) continue;
        pos.y = groundHeight;
        const height = 4.6 + random() * 6.8;
        const width = 1.2 + random() * 1.3;
        trunks.push({ position: pos.clone().add(new THREE.Vector3(0, height * 0.31, 0)), scale: [0.7 + height * 0.11, height * 0.63, 0.7 + height * 0.11] });
        const color = this.palette.trees[Math.floor(random() * this.palette.trees.length)];
        if (snow || random() < 0.64) {
          firs.push({ position: pos.clone().add(new THREE.Vector3(0, height * 0.66, 0)), scale: [width, height * 0.7, width * (0.8 + random() * 0.3)], rotation: [0, random() * 6, 0], color });
          firs.push({ position: pos.clone().add(new THREE.Vector3(0, height * 0.44, 0)), scale: [width * 1.15, height * 0.4, width], rotation: [0, random() * 6, 0], color });
          if (snow) firs.push({ position: pos.clone().add(new THREE.Vector3(0, height * 0.78, 0)), scale: [width * 0.73, height * 0.5, width * 0.72], color: 0xdde5e6 });
        } else for (let j = 0; j < 3; j++) {
          crowns.push({ position: pos.clone().add(new THREE.Vector3(Math.sin(j * 2.1) * width * 0.38, height * (0.68 + j * 0.07), Math.cos(j * 2.1) * width * 0.38)), scale: [width, height * 0.2, width * 0.86], rotation: [0.15, random() * 6, 0], color });
        }
        const stoneDistance = 1.3 + random() * 4;
        const stone = roadAt(p, side * (p.width / 2 + stoneDistance), this.profile(s, side, stoneDistance - 0.46) + 0.2);
        const stoneHeight = this.terrainHeight(chunk, stone);
        if (stoneHeight !== null && this.nearestRoadDistance(stone, s) > 1.3 && random() < 0.55) {
          stone.y = stoneHeight + 0.2;
          rocks.push({ position: stone, scale: [0.6 + random() * 1.7, 0.3 + random() * 0.9, 0.55 + random() * 1.0], rotation: [0.2, random() * 6, 0.12] });
        }
        if (!snow && !sparse && random() < 0.6) {
          const tuft = roadAt(p, side * (p.width / 2 + 0.95), 0.14);
          const tuftHeight = this.terrainHeight(chunk, tuft);
          if (tuftHeight !== null) { tuft.y = tuftHeight + 0.18; grass.push({ position: tuft, scale: [0.5 + random(), 0.5, 0.6], color: side > 0 ? 0x8b9362 : 0x727c4f }); }
        }
      }
    }
    this.instances(chunk, 'trunk', 'bark', trunks, true);
    this.instances(chunk, 'fir', 'foliage', firs, true);
    this.instances(chunk, 'crown', 'foliage', crowns, true);
    this.instances(chunk, 'rock', 'rock', rocks, true);
    this.instances(chunk, 'grass', 'grass', grass);
  }

  buildSigns(chunk) {
    const signs = [], posts = [], arrows = [], lamps = [];
    for (let s = Math.ceil(chunk.start / 32) * 32; s < chunk.end && s < this.track.length - 16; s += 32) {
      const p = this.track.sample(s); if (p.gap || p.tunnel) continue;
      if (Math.abs(p.curvature || 0) > 0.006) {
        const side = p.curvature > 0 ? -1 : 1;
        const pos = roadAt(p, side * (p.width / 2 + 0.85), 1.7);
        signs.push({ position: pos, rotation: [0, -p.yaw, 0], scale: [1.3, 0.7, 0.085] });
        posts.push({ position: roadAt(p, side * (p.width / 2 + 0.85), 0.9), scale: [0.07, 1.8, 0.08] });
        const sign = p.curvature > 0 ? 1 : -1;
        for (let k = 0; k < 2; k++) arrows.push({ position: pos.clone().add(new THREE.Vector3(Math.cos(p.yaw) * sign * (k ? 0.11 : -0.11), k ? -0.13 : 0.13, Math.sin(p.yaw) * sign * (k ? 0.11 : -0.11))).add(new THREE.Vector3(-Math.sin(p.yaw) * 0.06, 0, Math.cos(p.yaw) * 0.06)), rotation: [0, -p.yaw, sign * (k ? -0.62 : 0.62)], scale: [0.49, 0.095, 0.03] });
      }
      if (['rain', 'final'].includes(this.theme) && Math.floor(s / 32) % 2 === 0) {
        const side = 1; const at = roadAt(p, side * (p.width / 2 + 1.0), 3.9);
        posts.push({ position: roadAt(p, side * (p.width / 2 + 1), 2), scale: [0.1, 4, 0.1] });
        lamps.push({ position: at, rotation: [0, -p.yaw, 0], scale: [0.48, 0.08, 0.86] });
      }
    }
    this.instances(chunk, 'box', 'warning', signs);
    this.instances(chunk, 'box', 'post', posts);
    this.instances(chunk, 'box', 'black', arrows);
    this.instances(chunk, 'box', 'lamp', lamps);
    for (const [s, finish] of [[1, false], [this.track.length - 4, true]]) if (s >= chunk.start && s < chunk.end) {
      const p = this.track.sample(s), beams = [], flags = [];
      for (const side of [-1, 1]) beams.push({ position: roadAt(p, side * (p.width / 2 + 0.6), 2.8), scale: [0.18, 5.6, 0.2] });
      beams.push({ position: roadAt(p, 0, 5.45), rotation: [0, -p.yaw, 0], scale: [p.width + 1.6, 0.32, 0.22] });
      if (finish) for (let col = 0; col < Math.ceil(p.width / 0.5); col++) for (let row = 0; row < 3; row++) flags.push({ position: roadAt(p, -p.width / 2 + col * 0.5 + 0.25, 0.048).add(new THREE.Vector3(Math.sin(p.yaw) * row * 0.5, 0, -Math.cos(p.yaw) * row * 0.5)), rotation: [0, -p.yaw, 0], scale: [0.5, 0.012, 0.5], color: (col + row) % 2 ? PALE : 0x1b2628 });
      this.instances(chunk, 'box', finish ? 'line' : 'green', beams);
      this.instances(chunk, 'box', 'foliage', flags);
    }
  }

  buildStructures(chunk) {
    const piers = [], warning = [], portal = [], portalColors = [];
    for (const range of this.track.gapRanges || []) for (const s of [range.start - 0.15, range.end + 0.15]) if (s >= chunk.start && s < chunk.end) {
      const p = this.track.sample(s);
      for (const side of [-1, 1]) {
        piers.push({ position: roadAt(p, side * (p.width / 2 - 0.7), -17), rotation: [0, -p.yaw, 0], scale: [1.2, 34, 1.8] });
        warning.push({ position: roadAt(p, side * (p.width / 2 + 0.15), 0.8), rotation: [0, -p.yaw, 0], scale: [0.35, 1.6, 0.4] });
      }
      piers.push({ position: roadAt(p, 0, -0.4), rotation: [0, -p.yaw, 0], scale: [p.width + 1, 0.8, 0.8] });
    }
    for (const range of this.track.tunnelRanges || []) for (const s of [range.start, range.end]) if (s >= chunk.start && s < chunk.end) {
      const p = this.track.sample(s);
      for (let k = 0; k < 20; k++) {
        const a = k / 20 * Math.PI, b = (k + 1) / 20 * Math.PI;
        const innerA = roadAt(p, Math.cos(a) * (p.width / 2 + 0.46), Math.sin(a) * 5.1);
        const innerB = roadAt(p, Math.cos(b) * (p.width / 2 + 0.46), Math.sin(b) * 5.1);
        const outerA = roadAt(p, Math.cos(a) * (p.width / 2 + 1.2), Math.sin(a) * 5.85);
        const outerB = roadAt(p, Math.cos(b) * (p.width / 2 + 1.2), Math.sin(b) * 5.85);
        quad(portal, innerA, innerB, outerA, outerB, portalColors, new THREE.Color(k % 2 ? 0x252b2f : 0xe7c052));
      }
    }
    this.instances(chunk, 'box', 'concrete', piers);
    this.instances(chunk, 'box', 'warning', warning);
    this.addMesh(chunk, portal, 'terrain', portalColors);
  }

  createHazard(h) {
    const group = new THREE.Group();
    const p = this.track.sample(h.s); group.position.copy(roadAt(p, h.offset || 0, 0.02)); group.rotation.y = -p.yaw;
    const mesh = (geo, mat, position, scale, rotation) => {
      const o = new THREE.Mesh(this.sharedGeometry[geo], this.materials[mat]); o.position.set(...position); if (scale) o.scale.set(...scale); if (rotation) o.rotation.set(...rotation); o.castShadow = true; group.add(o); return o;
    };
    if (h.type === 'rock') {
      const radius = h.radius || 0.65;
      mesh('rock', 'rock', [0, radius * 0.62, 0], [radius, radius * 0.8, radius * 0.84], [0.2, rng(this.seed + Math.round(h.s))() * 6, 0.18]);
    } else if (h.type === 'barrier') {
      const width = (h.radius || 1.2) * 2;
      mesh('box', 'concrete', [0, 0.35, 0], [width, 0.7, 0.62]);
      mesh('box', 'warning', [0, 0.74, 0], [width + 0.1, 0.14, 0.65]);
      const count = Math.max(1, Math.ceil((width - 0.4) / 0.48));
      const stripes = new THREE.InstancedMesh(this.sharedGeometry.box, this.materials.black, count);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        dummy.position.set(-width / 2 + 0.2 + i * 0.48, 0.39, 0.32);
        dummy.rotation.z = -0.45; dummy.scale.set(0.18, 0.52, 0.022); dummy.updateMatrix();
        stripes.setMatrixAt(i, dummy.matrix);
      }
      stripes.instanceMatrix.needsUpdate = true; stripes.castShadow = true; group.add(stripes);
    } else {
      mesh('barrel', 'barrel', [0, 0.475, 0]);
      for (const y of [0.18, 0.74]) mesh('ring', 'steel', [0, y, 0]);
      mesh('box', 'warning', [0, 0.47, 0.401], [0.3, 0.26, 0.02]);
    }
    this.owner.trackGroup.add(group); return group;
  }

  releaseHazard(entity) {
    this.owner.trackGroup.remove(entity);
    entity.traverse(object => { if (object.isInstancedMesh) object.dispose(); });
    entity.clear();
  }

  syncHazards(s) {
    const visible = new Set();
    for (const hazard of this.track.hazards || []) {
      if (hazard.hit || Math.abs(hazard.s - s) > FRONT) continue;
      visible.add(hazard.id);
      if (!this.hazards.has(hazard.id)) this.hazards.set(hazard.id, this.createHazard(hazard));
    }
    for (const [id, entity] of this.hazards) if (!visible.has(id)) { this.releaseHazard(entity); this.hazards.delete(id); }
    this.owner.hazardMeshes = this.hazards;
  }

  syncBrokenRails() {
    const broken = this.track.brokenRails;
    const matrix = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const chunk of this.chunks.values()) for (const mesh of chunk.instances) {
      const data = mesh.userData;
      if (!data.railKeys || data.railVersion === broken.size) continue;
      let dirty = false;
      for (let i = 0; i < data.railKeys.length; i++) {
        if (broken.has(data.railKeys[i]) && !data.hiddenRails.has(i)) {
          mesh.setMatrixAt(i, matrix); data.hiddenRails.add(i); dirty = true;
        }
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
      data.railVersion = broken.size;
    }
  }

  releaseChunk(chunk) {
    this.owner.trackGroup.remove(chunk.group);
    // Three.js separately owns each InstancedMesh's instance GPU buffers.
    for (const instance of chunk.instances) instance.dispose();
    for (const g of chunk.geometries) g.dispose();
    chunk.group.clear(); chunk.terrainVertices = null; this.disposedChunks++;
  }

  getStats() {
    const info = this.owner.renderer.info;
    const chunks = [...this.chunks.values()];
    return { chunkSize: CHUNK, behindDistance: BACK, aheadDistance: FRONT, loadedChunks: chunks.length, pendingChunks: this.queue.length,
      activeHazards: this.hazards.size, maxChunks: this.maxChunks, loadedRange: chunks.length ? [Math.min(...chunks.map(c => c.start)), Math.max(...chunks.map(c => c.end))] : [0, 0],
      disposedChunks: this.disposedChunks, geometries: info.memory.geometries, textures: info.memory.textures, materials: Object.keys(this.materials || {}).length,
      triangles: info.render.triangles, drawCalls: info.render.calls, instances: chunks.reduce((n, c) => n + c.instances.reduce((v, m) => v + m.count, 0), 0) };
  }

  dispose() {
    this.clear();
    for (const g of Object.values(this.sharedGeometry)) g.dispose();
    this.noise.dispose();
  }
}
