import { steeringRate } from './controls.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
let seedSerial = 0;

export function chooseRunSeed(seed) {
  if (seed !== undefined && seed !== null) {
    if (Number.isFinite(Number(seed))) return Number(seed) >>> 0;
    let hash = 2166136261;
    for (const letter of String(seed)) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
    return hash >>> 0;
  }
  seedSerial = (seedSerial + 0x9e3779b9) >>> 0;
  const random = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint32Array(1))[0]
    : Math.floor(Math.random() * 4294967296);
  return (random ^ seedSerial) >>> 0;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ state >>> 15, 1 | state);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Groups appear at the far edge of a rolling window, never beside the car.
// Retired records are removed, bounding physics and renderer work.
export class HazardStream {
  constructor(track, seed) {
    this.track = track;
    this.seed = seed;
    this.random = randomGenerator(seed ^ Math.imul(track.level.id, 7919));
    this.nextS = 110 + this.random() * 25;
    this.groups = [];
    // Small CPU history preserves layout/hit state when a driver turns around.
    // Only the directional window participates in physics and rendering.
    this.records = [];
    this.allGroups = [];
    this.groupSerial = 0;
    this.generatedCount = 0;
    this.retiredCount = 0;
    this.previousPassage = 0;
    this.ahead = 380;
  }

  update(distance, speed, direction = 1) {
    const s = clamp(Number(distance) || 0, 0, this.track.length);
    this.ahead = clamp(340 + (Number(speed) || 0) * 0.45, 380, 500);
    const boundary = Math.min(this.track.length - 70, s + this.ahead);
    while (this.nextS <= boundary) {
      const groupS = this.nextS;
      const surface = this.track.sample(groupS).surface;
      const spacing = surface === 'ice' ? 90 : surface === 'snow' ? 78 : surface === 'wet' ? 66 : 52;
      this.nextS += spacing + this.random() * 28;
      if (this._protected(groupS)) continue;
      this._createGroup(groupS, s);
    }
    const lower = s - (direction < 0 ? this.ahead : 80);
    const upper = s + (direction < 0 ? 80 : this.ahead);
    const keep = this.records.filter(hazard => hazard.s >= lower && hazard.s <= upper);
    const keepIds = new Set(keep.map(h => h.id));
    this.retiredCount += this.track.hazards.filter(h => !keepIds.has(h.id)).length;
    this.track.hazards.splice(0, this.track.hazards.length, ...keep);
    this.groups = this.allGroups.filter(group => group.s + group.span >= lower && group.s <= upper);
    return this.track.hazards;
  }

  _protected(s) {
    if (this.track.gapRanges.some(range => s > range.start - 180 && s < range.end + 220)) return true;
    return this.track.tunnelRanges.some(range => Math.abs(s - range.start) < 65
      || Math.abs(s - range.end) < 55);
  }

  _createGroup(s, spawnedAtS) {
    const road = this.track.sample(s);
    const width = Math.min(road.width, this.track.sample(s + 10).width);
    const half = width * 0.5;
    const narrow = width < 9;
    const veryNarrow = width < 7;
    const passageWidth = veryNarrow ? 3.8 : narrow ? 3.6 : 4.2;
    const passageLimit = Math.min(veryNarrow ? 0.5 : narrow ? 1.8 : 7.2,
      Math.max(0, half - passageWidth * 0.5 - 0.25));
    let safePassage = (this.random() * 2 - 1) * passageLimit;
    const baseShift = road.surface === 'ice' ? 2.6 : road.surface === 'snow' ? 3.6 : road.surface === 'wet' ? 4.2 : 5;
    let correctionRoom = 1;
    // At extreme speed a bend already consumes most steering authority. Keep
    // the safe corridor steadier there instead of requesting an impossible swerve.
    for (const delta of [-36, -18, 0, 18, 36]) {
      const p = this.track.sample(s + delta);
      const v = Math.sqrt(this.track.level.startSpeed ** 2 + 7.2 * this.track.level.acceleration * p.s);
      const demand = Math.abs(p.curvature) * v / 3.6
        / Math.max(0.7, 1 - Math.abs(p.curvature) * Math.min(p.width / 2, 7.2));
      correctionRoom = Math.min(correctionRoom, 1 - demand / steeringRate(v, p.surface));
    }
    const maxShift = baseShift * clamp(correctionRoom / 0.35, 0.12, 1);
    safePassage = clamp(clamp(safePassage, this.previousPassage - maxShift, this.previousPassage + maxShift), -passageLimit, passageLimit);
    this.previousPassage = safePassage;
    const groupId = `L${this.track.level.id}-${this.seed}-${this.groupSerial++}`;
    const group = { id: groupId, s, span: 10, safePassage, passageWidth, width };
    const lower = safePassage - passageWidth * 0.5;
    const upper = safePassage + passageWidth * 0.5;
    const candidates = [];
    for (const [edge, boundary, sign] of [[-half + 0.25, lower, -1], [upper, half - 0.25, 1]]) {
      const available = boundary - edge;
      if (available < 0.95) continue;
      const type = available > 2.65 && this.random() < 0.78 ? 'barrier'
        : this.random() < (this.track.level.id > 2 ? 0.30 : 0.12) ? 'rock' : 'barrel';
      const radius = type === 'barrier' ? Math.min(3.4, (available - 0.16) * 0.5) : type === 'rock' ? 0.64 : 0.42;
      if (available < radius * 2 + 0.08) continue;
      const jitter = this.random() * Math.min(0.3, Math.max(0, available - radius * 2 - 0.08));
      const offset = sign < 0 ? boundary - radius - 0.04 - jitter : edge + radius + 0.04 + jitter;
      candidates.push({ offset, type, radius });
      if (!narrow && available > 4.7 && this.random() < 0.62) {
        const otherOffset = sign < 0 ? edge + 0.65 : boundary - 0.65;
        if (Math.abs(otherOffset - offset) > radius + 0.7) {
          candidates.push({ offset: otherOffset, type: 'barrel', radius: 0.42 });
        }
      }
    }
    if (!candidates.length) {
      const side = safePassage >= 0 ? -1 : 1;
      candidates.push({ offset: side * (half - 0.42 - 0.08), type: 'barrel', radius: 0.42 });
    }
    for (let i = 0; i < candidates.length; i++) {
      const obstacle = candidates[i];
      this.records.push({
        ...obstacle, id: `${groupId}-${i}`, groupId,
        s: s + (i > 1 ? 7 : 0), hit: false, safePassage,
        passageWidth, spawnedAtS,
      });
      this.generatedCount += 1;
    }
    this.allGroups.push(group);
  }

  get diagnostics() {
    return { active: this.track.hazards.length, generated: this.generatedCount,
      retired: this.retiredCount, ahead: this.ahead, behind: 80, nextS: this.nextS };
  }
}
