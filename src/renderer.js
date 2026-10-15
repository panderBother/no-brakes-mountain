import * as THREE from 'three';
import { RoadStreamer, SCENE_THEMES } from './scene_chunks.js';

const UP = new THREE.Vector3(0, 1, 0);
const PALE = 0xe9ecdc;
const GREEN = 0xc7f53f;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function randomGenerator(seed = 1) {
  let value = Number(seed) || 379;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roadPosition(point, offset = 0, elevation = 0) {
  return new THREE.Vector3(
    point.x + Math.cos(point.yaw) * offset,
    point.y + elevation,
    point.z + Math.sin(point.yaw) * offset,
  );
}

function forward(point) {
  return new THREE.Vector3(Math.sin(point.yaw), 0, -Math.cos(point.yaw));
}

function triangleGeometry(vertices, colors) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function quad(vertices, a, b, c, d) {
  for (const p of [a, c, b, b, c, d]) vertices.push(p.x, p.y, p.z);
}

function box(group, dimensions, position, material, rotation) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  group.add(mesh);
  return mesh;
}

function material(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0.05, flatShading: true, ...extra });
}

/** Code-generated scenery: no model, image, texture, or remote asset requests. */
export class MountainRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.options = options;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    } catch {
      throw new Error('无法创建 3D 画面。请开启浏览器硬件加速，或换用支持 WebGL 的浏览器。');
    }
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1700);
    this.ambient = new THREE.HemisphereLight(0xcbdced, 0x354034, 2.0);
    this.scene.add(this.ambient);
    this.sunlight = new THREE.DirectionalLight(0xffeed7, 3.1);
    this.sunlight.position.set(-90, 130, -40);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(1024, 1024);
    this.sunlight.shadow.camera.left = -34;
    this.sunlight.shadow.camera.right = 34;
    this.sunlight.shadow.camera.top = 42;
    this.sunlight.shadow.camera.bottom = -32;
    this.sunlight.shadow.camera.near = 1;
    this.sunlight.shadow.camera.far = 220;
    this.sunlight.shadow.normalBias = 0.06;
    this.sunlight.shadow.bias = -0.00015;
    this.scene.add(this.sunlight);
    this.scene.add(this.sunlight.target);
    this.fill = new THREE.DirectionalLight(0x94b9bd, 0.65);
    this.fill.position.set(80, 30, 70);
    this.scene.add(this.fill);
    this.clock = 0;
    this.track = null;
    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);
    this.streamer = new RoadStreamer(this);
    this.car = this.createCar();
    this.scene.add(this.car);
    this.carShadow = new THREE.Mesh(new THREE.PlaneGeometry(3.25, 5.3), new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0.48 } },
      vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'varying vec2 vUv;uniform float opacity;void main(){float d=length((vUv-0.5)*vec2(2.0,2.0));float a=(1.0-smoothstep(0.35,0.98,d))*opacity;gl_FragColor=vec4(0.035,0.047,0.05,a);}',
      transparent: true, depthWrite: false,
    }));
    this.carShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.carShadow);
    this.tunnelLight = new THREE.PointLight(0xffdba4, 0, 25, 1.6);
    this.scene.add(this.tunnelLight);
    this.createEffects();
    this.createSky();
    this.cameraReady = false;
    this.previousStatus = null;
    this.quality = 'high';
    this.resize();
  }

  createSky() {
    this.skyMaterial = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color(0x537f77) }, bottom: { value: new THREE.Color(0xd1dec8) }, cloudAmount: { value: 0.3 } },
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: 'uniform vec3 top;uniform vec3 bottom;uniform float cloudAmount;varying vec3 vDirection;void main(){float h=smoothstep(-0.04,0.8,vDirection.y);vec3 c=mix(bottom,top,h);float wave=sin(vDirection.x*27.0+vDirection.z*16.0)*sin(vDirection.x*12.0-vDirection.z*8.0);float cloud=smoothstep(0.1,0.68,wave)*smoothstep(0.1,0.35,vDirection.y)*(1.0-smoothstep(0.45,0.8,vDirection.y));c=mix(c,bottom,cloud*cloudAmount);gl_FragColor=vec4(c,1.0);}',
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 16, 12), this.skyMaterial);
    this.sky.renderOrder = -5;
    this.scene.add(this.sky);
  }

  createCar() {
    const car = new THREE.Group();
    car.rotation.order = 'YXZ';
    const paint = material(GREEN, { metalness: 0.3, roughness: 0.36 });
    const carbon = material(0x151f21, { roughness: 0.53 });
    const rubber = material(0x111716, { roughness: 0.97 });
    const glass = material(0x193834, { roughness: 0.12, metalness: 0.65 });
    const decal = material(0xe8efd5, { roughness: 0.46 });
    const metal = material(0xd3d7cb, { roughness: 0.35, metalness: 0.8 });
    const lamp = material(0xfff5da, { emissive: 0xfff5da, emissiveIntensity: 3 });
    const tail = material(0xff4c3f, { emissive: 0xff2a19, emissiveIntensity: 1.8 });
    const shape = new THREE.Shape();
    shape.moveTo(-0.67, 1.65);
    shape.lineTo(0.67, 1.65);
    shape.lineTo(0.82, 1.24);
    shape.lineTo(0.86, -1.2);
    shape.lineTo(0.7, -1.58);
    shape.lineTo(-0.7, -1.58);
    shape.lineTo(-0.86, -1.2);
    shape.lineTo(-0.82, 1.24);
    shape.closePath();
    const bodyGeometry = new THREE.ExtrudeGeometry(shape, { depth: 0.36, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.09, bevelSegments: 1, steps: 1 });
    bodyGeometry.rotateX(-Math.PI / 2);
    const body = new THREE.Mesh(bodyGeometry, paint);
    body.position.y = 0.43;
    car.add(body);
    box(car, [1.75, 0.16, 3.15], [0, 0.3, 0.02], carbon);
    box(car, [1.75, 0.065, 0.34], [0, 0.34, -1.61], carbon);
    box(car, [0.92, 0.018, 0.46], [0, 0.885, -0.91], carbon);
    box(car, [0.18, 0.025, 0.65], [0, 0.895, -1.17], paint);
    const cabinVertices = [];
    const lo = [new THREE.Vector3(-0.66, 0.84, 0.7), new THREE.Vector3(0.66, 0.84, 0.7), new THREE.Vector3(-0.62, 0.84, -0.65), new THREE.Vector3(0.62, 0.84, -0.65)];
    const hi = [new THREE.Vector3(-0.48, 1.3, 0.38), new THREE.Vector3(0.48, 1.3, 0.38), new THREE.Vector3(-0.48, 1.3, -0.31), new THREE.Vector3(0.48, 1.3, -0.31)];
    quad(cabinVertices, lo[0], lo[1], hi[0], hi[1]);
    quad(cabinVertices, lo[2], lo[3], hi[2], hi[3]);
    quad(cabinVertices, lo[0], lo[2], hi[0], hi[2]);
    quad(cabinVertices, lo[1], lo[3], hi[1], hi[3]);
    const cabin = new THREE.Mesh(triangleGeometry(cabinVertices), glass);
    cabin.material.side = THREE.DoubleSide;
    car.add(cabin);
    box(car, [1.02, 0.065, 0.76], [0, 1.31, 0.025], paint);
    for (const side of [-1, 1]) {
      box(car, [0.09, 0.53, 0.07], [side * 0.58, 1.04, 0.14], carbon, [0, 0, -side * 0.14]);
      box(car, [0.22, 0.12, 0.24], [side * 0.91, 0.99, -0.3], paint);
      box(car, [0.1, 0.055, 0.11], [side * 0.82, 0.99, -0.3], carbon);
      box(car, [0.47, 0.075, 0.045], [side * 0.52, 0.68, -1.73], lamp);
      box(car, [0.49, 0.075, 0.045], [side * 0.51, 0.68, 1.66], tail);
      box(car, [0.07, 0.37, 0.12], [side * 0.57, 0.98, 1.23], carbon);
      box(car, [0.06, 0.2, 0.4], [side * 0.94, 1.16, 1.33], paint);
    }
    box(car, [1.89, 0.075, 0.43], [0, 1.19, 1.32], carbon, [-0.055, 0, 0]);
    box(car, [0.55, 0.14, 0.06], [0, 0.48, 1.7], carbon);
    for (const side of [-1, 1]) {
      box(car, [0.04, 0.12, 1.75], [side * 0.948, 0.48, -0.05], carbon);
      box(car, [0.018, 0.09, 0.47], [side * 0.934, 0.69, 0.01], decal, [0, 0, side * 0.04]);
      box(car, [0.09, 0.018, 1.08], [side * 0.54, 0.889, -1.01], carbon);
      box(car, [0.11, 0.06, 0.18], [side * 0.44, 0.35, 1.74], metal);
      for (let j = 0; j < 4; j++) box(car, [0.105, 0.016, 0.13], [side * 0.62, 0.89, 0.94 + j * 0.14], carbon);
    }
    this.wheels = [];
    const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.27, 16);
    const rimGeometry = new THREE.CylinderGeometry(0.22, 0.22, 0.283, 8);
    wheelGeometry.rotateZ(Math.PI / 2);
    rimGeometry.rotateZ(Math.PI / 2);
    for (const side of [-1, 1]) for (const z of [-1.07, 1.06]) {
      const wheel = new THREE.Group();
      wheel.position.set(side * 0.91, 0.38, z);
      wheel.add(new THREE.Mesh(wheelGeometry, rubber), new THREE.Mesh(rimGeometry, metal));
      for (let j = 0; j < 5; j++) {
        const angle = j / 5 * Math.PI * 2;
        box(wheel, [0.292, 0.035, 0.2], [0, Math.cos(angle) * 0.105, Math.sin(angle) * 0.105], carbon, [angle, 0, 0]);
      }
      const hub = box(wheel, [0.3, 0.08, 0.08], [0, 0, 0], carbon);
      hub.rotation.x = Math.PI / 4;
      car.add(wheel);
      this.wheels.push(wheel);
    }
    this.headlight = new THREE.SpotLight(0xedf3d7, 0, 75, 0.5, 0.6, 1.3);
    this.headlight.position.set(0, 0.74, -1.6);
    this.headlight.target.position.set(0, -0.1, -22);
    car.add(this.headlight, this.headlight.target);
    car.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return car;
  }

  clearTrack() {
    this.streamer.clear();
    if (this.weather) {
      this.trackGroup.remove(this.weather.mesh);
      this.weather.mesh.geometry.dispose();
      this.weather.mesh.material.dispose();
      this.weather = null;
    }
  }

  loadTrack(track) {
    if (!track?.sample || !track.length) throw new Error('赛道数据不完整，无法生成山路。');
    this.clearTrack();
    this.track = track;
    this.theme = track.level?.theme || 'forest';
    this.rng = randomGenerator(track.runSeed || track.level?.seed || track.level?.id || 1);
    this.cameraReady = false;
    this.previousStatus = null;
    this.fragments.forEach(f => { f.life = 0; });
    this.explosionLife = 0;
    this.smoke.children.forEach(ball => { ball.visible = false; });
    const dark = ['rain', 'final'].includes(this.theme);
    const snow = this.theme === 'snow';
    const theme = SCENE_THEMES[this.theme] || SCENE_THEMES.forest;
    this.scene.fog = new THREE.Fog(theme.fog, dark ? 55 : 115, dark ? 340 : 485);
    this.skyMaterial.uniforms.top.value.set(theme.top);
    this.skyMaterial.uniforms.bottom.value.set(theme.fog);
    this.skyMaterial.uniforms.cloudAmount.value = dark ? 0.72 : snow ? 0.22 : 0.38;
    this.sunlight.color.set(theme.sun);
    this.sunlight.intensity = dark ? 1.15 : snow ? 2.5 : 3.0;
    this.ambient.color.set(dark ? 0x829db7 : 0xcbdced);
    this.ambient.intensity = dark ? 1.55 : 2.05;
    this.fill.intensity = dark ? 0.35 : 0.5;
    this.renderer.toneMappingExposure = dark ? 1.07 : 1.02;
    this.streamer.load(track);
    this.buildWeather();
  }

  getStreamingStats() {
    return this.streamer.getStats();
  }

  buildWeather(kind = this.theme) {
    if (this.weather?.mesh.parent === this.trackGroup) {
      this.trackGroup.remove(this.weather.mesh);
      this.weather.mesh.geometry.dispose();
      this.weather.mesh.material.dispose();
    }
    this.weather = null;
    if (!['rain', 'snow', 'final'].includes(kind)) return;
    const rain = kind !== 'snow';
    const count = rain ? 480 : 320;
    const positions = new Float32Array(count * (rain ? 6 : 3));
    const seeds = [];
    for (let i = 0; i < count; i++) seeds.push({ x: (this.rng() - 0.5) * 52, y: this.rng() * 27, z: (this.rng() - 0.6) * 85, speed: rain ? 22 + this.rng() * 16 : 1.4 + this.rng() * 1.2 });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = rain ? new THREE.LineBasicMaterial({ color: 0xb3d2d0, transparent: true, opacity: 0.32, depthWrite: false }) : new THREE.PointsMaterial({ color: 0xe9f2eb, size: 0.1, transparent: true, opacity: 0.86, depthWrite: false });
    const mesh = rain ? new THREE.LineSegments(geometry, mat) : new THREE.Points(geometry, mat);
    mesh.frustumCulled = false;
    this.trackGroup.add(mesh);
    this.weather = { rain, seeds, mesh, positions };
  }

  createEffects() {
    this.fragments = Array.from({ length: 64 }, () => ({ life: 0, maxLife: 1, position: new THREE.Vector3(), velocity: new THREE.Vector3(), rotation: new THREE.Vector3(), size: 0.1 }));
    this.fragmentMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.15, 0), material(0xffc765, { emissive: 0x90451b, emissiveIntensity: 1.3 }), this.fragments.length);
    this.fragmentMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.fragmentMesh.frustumCulled = false;
    this.effectDummy = new THREE.Object3D();
    this.scene.add(this.fragmentMesh);
    this.smoke = new THREE.Group();
    const smokeMat = new THREE.MeshBasicMaterial({ color: 0x31453f, transparent: true, opacity: 0.64, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), smokeMat.clone());
      ball.visible = false;
      this.smoke.add(ball);
    }
    this.scene.add(this.smoke);
    this.explosionLife = 0;
    this.explosionMax = 2;
    this.effectOrigin = new THREE.Vector3();
    this.updateEffects(0);
  }

  triggerEffect(type, state = {}) {
    if (!this.track) return;
    const point = this.track.sample(clamp(state.s || 0, 0, this.track.length));
    const origin = roadPosition(point, state.offset || 0, (state.y || 0) + 0.6);
    const count = type === 'explosion' ? 52 : type === 'rail-break' ? 28 : 12;
    const strength = type === 'explosion' ? 9 : 5;
    for (let i = 0; i < count; i++) {
      const f = this.fragments[i];
      f.maxLife = type === 'explosion' ? 1.2 + Math.random() * 0.9 : 0.35 + Math.random() * 0.35;
      f.life = f.maxLife;
      f.position.copy(origin);
      f.velocity.set((Math.random() - 0.5) * strength * 2, Math.random() * strength + 1.5, (Math.random() - 0.5) * strength * 2);
      f.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      f.size = type === 'explosion' ? 0.9 + Math.random() * 1.6 : 0.3 + Math.random() * 0.7;
      this.fragmentMesh.setColorAt(i, new THREE.Color(type === 'rail-break' ? (i % 2 ? 0x71848d : 0xd2dbda) : i % 3 === 0 ? GREEN : i % 3 === 1 ? 0xff833d : 0xffdd91));
    }
    if (this.fragmentMesh.instanceColor) this.fragmentMesh.instanceColor.needsUpdate = true;
    if (type === 'explosion') {
      this.effectOrigin.copy(origin);
      this.explosionLife = this.explosionMax;
    }
  }

  updateEffects(dt) {
    for (let i = 0; i < this.fragments.length; i++) {
      const f = this.fragments[i];
      if (f.life > 0) {
        f.life = Math.max(0, f.life - dt);
        f.velocity.y -= dt * 12;
        f.position.addScaledVector(f.velocity, dt);
        f.rotation.x += dt * 3;
        f.rotation.z += dt * 4;
        this.effectDummy.position.copy(f.position);
        this.effectDummy.rotation.set(f.rotation.x, f.rotation.y, f.rotation.z);
        this.effectDummy.scale.setScalar(f.size * Math.min(1, f.life / 0.35));
      } else {
        this.effectDummy.position.set(0, -1000, 0);
        this.effectDummy.scale.setScalar(0);
      }
      this.effectDummy.updateMatrix();
      this.fragmentMesh.setMatrixAt(i, this.effectDummy.matrix);
    }
    this.fragmentMesh.instanceMatrix.needsUpdate = true;
    this.explosionLife = Math.max(0, this.explosionLife - dt);
    const elapsed = this.explosionMax - this.explosionLife;
    this.smoke.children.forEach((ball, i) => {
      ball.visible = this.explosionLife > 0;
      if (!ball.visible) return;
      const angle = i * 2.4;
      ball.position.copy(this.effectOrigin).add(new THREE.Vector3(Math.sin(angle) * elapsed * 1.5, elapsed * 2 + i * 0.08, Math.cos(angle) * elapsed * 1.5));
      ball.scale.setScalar(0.3 + elapsed * (0.6 + i * 0.045));
      ball.material.opacity = 0.52 * (this.explosionLife / this.explosionMax);
    });
  }

  render(state = {}, realDt = 1 / 60, options = {}) {
    if (!this.track) return;
    const dt = clamp(Number(realDt) || 0, 0, 0.1);
    const paused = state.status === 'paused';
    const simulationDt = paused ? 0 : dt;
    this.clock += simulationDt * (state.timeScale || 1);
    const menu = !!options.menu;
    const quality = options.quality || 'high';
    if (this.quality !== quality) {
      this.quality = quality;
      this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, quality === 'low' ? 1 : 1.75));
      this.resize();
    }
    const s = clamp(Number(state.s) || 0, 0, this.track.length);
    const direction = menu || Math.cos(state.heading || 0) >= 0 ? 1 : -1;
    this.streamer.update(s, quality, direction);
    const p = this.track.sample(s);
    const offset = Number(state.offset) || 0;
    const elevation = Number(state.y) || 0;
    const at = roadPosition(p, offset, elevation);
    const heading = Number(state.heading) || 0;
    this.car.position.copy(at);
    // Three.js +Y rotation sends local -Z toward -X; track yaw uses the opposite convention.
    const slopeSample = this.track.sample(Math.min(this.track.length, s + 3));
    const pitch = Math.atan2(slopeSample.y - p.y, Math.max(0.01, slopeSample.s - p.s));
    this.car.rotation.set(pitch * Math.cos(heading), -(p.yaw + heading), clamp(-Math.sin(heading) * 0.25, -0.17, 0.17));
    this.car.position.y += Math.sin(this.clock * 11) * (menu ? 0.004 : 0.01);
    this.car.visible = state.status !== 'failed' && this.explosionLife < 1.3;
    this.carShadow.position.copy(roadPosition(p, offset, 0.048));
    this.carShadow.rotation.z = -(p.yaw + heading);
    this.carShadow.material.uniforms.opacity.value = Math.max(0.05, 0.48 - Math.abs(elevation) * 0.12);
    this.carShadow.visible = this.car.visible && !p.gap;
    this.sunlight.position.copy(at).add(new THREE.Vector3(-48, 94, -36));
    this.sunlight.target.position.copy(at);
    this.sunlight.castShadow = quality !== 'low';
    this.renderer.shadowMap.enabled = quality !== 'low';
    this.tunnelLight.position.copy(at).add(new THREE.Vector3(0, 2.1, 0));
    this.tunnelLight.intensity = p.tunnel ? 13 : ['rain', 'final'].includes(this.theme) ? 3.5 : 0;
    const speed = Number(state.speed) || 0;
    for (let i = 0; i < this.wheels.length; i++) {
      if (state.status === 'running' && !menu) this.wheels[i].rotation.x -= simulationDt * speed / 3.6 / 0.36 * (state.timeScale || 1);
      this.wheels[i].rotation.y = i % 2 === 0 ? -(state.steering || 0) * 0.38 : 0;
    }
    this.headlight.intensity = p.tunnel || ['rain', 'final'].includes(this.theme) ? 82 : 0;
    if (state.status === 'failed' && this.previousStatus !== 'failed' && this.explosionLife === 0) this.triggerEffect('explosion', state);
    this.previousStatus = state.status;
    const facing = menu ? forward(this.track.sample(Math.min(this.track.length, s + 3)))
      : new THREE.Vector3(Math.sin(p.yaw + heading), 0, -Math.cos(p.yaw + heading));
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, Math.sin(p.yaw));
    let tunnelCamera = p.tunnel ? 1 : 0;
    for (const range of this.track.tunnelRanges || []) {
      const entry = clamp((s - (range.start - 25)) / 25, 0, 1);
      const exit = clamp((range.end + 20 - s) / 20, 0, 1);
      const blend = Math.min(entry, exit);
      tunnelCamera = Math.max(tunnelCamera, blend * blend * (3 - 2 * blend));
    }
    const behind = menu ? 11.5 : lerp(8.4 + clamp(speed / 85, 0, 2.4), 6.5, tunnelCamera);
    const desired = at.clone().addScaledVector(facing, -behind).addScaledVector(right, menu ? -6.5 : 0);
    desired.y += menu ? 6.4 : lerp(4.2 + clamp(speed / 170, 0, 1.2), 2.6, tunnelCamera);
    const ahead = this.track.sample(Math.min(this.track.length, s + (menu ? 10 : 14 + speed / 14)));
    const lookAt = menu ? roadPosition(ahead, -2.1, 0.4)
      : at.clone().addScaledVector(facing, 15 + speed / 24).add(new THREE.Vector3(0, 1.05, 0));
    if (!this.cameraReady || menu !== this.lastMenu) {
      this.camera.position.copy(desired);
      this.cameraTarget = lookAt.clone();
      this.cameraReady = true;
    } else {
      this.camera.position.lerp(desired, 1 - Math.exp(-dt * (menu ? 3 : 8)));
      this.cameraTarget.lerp(lookAt, 1 - Math.exp(-dt * 7));
    }
    this.lastMenu = menu;
    if (options.shake !== false && (state.hitFlash || this.explosionLife > 1.5)) {
      const power = this.explosionLife > 1.5 ? 0.2 : 0.075;
      this.camera.position.x += Math.sin(this.clock * 93) * power;
      this.camera.position.y += Math.sin(this.clock * 76) * power;
    }
    this.camera.fov = menu ? 57 : lerp(this.camera.fov, 59 + clamp(speed / 22, 0, 8), 1 - Math.exp(-dt * 2));
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.cameraTarget);
    this.sky.position.copy(this.camera.position);
    if (this.theme === 'final') {
      const wantsRain = !['snow', 'ice'].includes(p.surface);
      if (this.weather?.rain !== wantsRain) this.buildWeather(wantsRain ? 'rain' : 'snow');
    }
    if (this.weather) {
      const w = this.weather;
      w.mesh.visible = quality !== 'low' || !w.rain;
      w.mesh.position.copy(at);
      for (let i = 0; i < w.seeds.length; i++) {
        const seed = w.seeds[i];
        seed.y -= simulationDt * seed.speed * (menu ? 1 : state.timeScale || 1);
        if (seed.y < -2) seed.y += 29;
        const ix = i * (w.rain ? 6 : 3);
        w.positions[ix] = seed.x + (w.rain ? 0 : Math.sin(this.clock + i) * 0.45);
        w.positions[ix + 1] = seed.y;
        w.positions[ix + 2] = seed.z;
        if (w.rain) {
          w.positions[ix + 3] = seed.x - 0.11;
          w.positions[ix + 4] = seed.y + 0.8;
          w.positions[ix + 5] = seed.z;
        }
      }
      w.mesh.geometry.attributes.position.needsUpdate = true;
    }
    this.updateEffects(simulationDt);
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || globalThis.innerWidth || 1));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || globalThis.innerHeight || 1));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.streamer.dispose();
    if (this.weather) {
      this.trackGroup.remove(this.weather.mesh);
      this.weather.mesh.geometry.dispose();
      this.weather.mesh.material.dispose();
      this.weather = null;
    }
    const geometries = new Set();
    const materials = new Set();
    this.scene.traverse(object => {
      if (object.isInstancedMesh) object.dispose();
      if (object.isLight) object.shadow?.dispose();
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) for (const m of Array.isArray(object.material) ? object.material : [object.material]) materials.add(m);
    });
    geometries.forEach(g => g.dispose());
    materials.forEach(m => m.dispose());
    this.scene.clear();
    this.renderer.dispose();
  }
}
