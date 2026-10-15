import { HazardStream, chooseRunSeed } from './hazards.js';

const specs = [
  ['山间公路', '没有热身。第一段山路，就要全神贯注。', 1800, 28, 150, 4.20, 0, 'forest', 0.060],
  ['连续 S 弯', '大幅变向之间，路障还在改变你的线路。', 2000, 28, 160, 4.50, 0, 'sunset', 0.070],
  ['悬崖公路', '宽路突然收窄，山谷不接受第二次修正。', 2200, 28, 172, 4.90, 0, 'cliff', 0.065],
  ['九曲发卡弯', '两次慢时间，九次急转，几乎没有喘息。', 2300, 27, 186, 5.40, 2, 'hairpin', 0.060],
  ['雨夜山路', '雨幕遮住远处，湿路让修正来得更迟。', 2450, 27, 202, 6.00, 2, 'rain', 0.060],
  ['雪山险道', '冰与雪交替出现，抓地力每一段都不同。', 2650, 27, 220, 6.70, 3, 'snow', 0.055],
  ['隧道与断桥', '穿过窄隧道，保住速度与落点。', 2850, 28, 240, 7.50, 3, 'bridge', 0.050],
  ['极限盘山路', '高速连续大弯，山路不会给你容错。', 3200, 26, 262, 8.40, 3, 'extreme', 0.050],
  ['最终死亡山道', '雨雪、狭道、断桥，以及失控般的加速。', 3500, 26, 286, 9.40, 4, 'final', 0.045],
];

export function idealTravelTime(length, startSpeed, acceleration) {
  return (Math.sqrt(startSpeed * startSpeed + 7.2 * acceleration * length) - startSpeed) / acceleration;
}

export const LEVELS = Object.freeze(specs.map((v, i) => {
  const idealTime = Math.ceil(idealTravelTime(v[2], v[4], v[5]));
  const bufferTime = Math.ceil(idealTime * v[8]);
  return Object.freeze({
    id: i + 1, name: v[0], subtitle: v[1], length: v[2], width: v[3],
    startSpeed: v[4], acceleration: v[5], charges: v[6], theme: v[7],
    idealTime, bufferTime, bufferRatio: v[8], timeLimit: idealTime + bufferTime,
    railBreakSpeed: 150, seed: 91473 + i * 7919,
  });
}));

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const inside = (s, ranges) => ranges.some(({ start, end }) => s >= start && s < end);

function baseYaw(level, s) {
  const u = Math.max(0, s - 30);
  const blend = smooth(Math.min(1, u / 90));
  // Large authored sweeps: 68–93 degree headings on each side of a bend.
  // Periods remain long enough for the faster end-of-run speeds.
  const shape = [
    [1.32, 500, 0.14, 1090], [1.38, 510, 0.16, 1030],
    [1.40, 550, 0.16, 1100], [1.65, 490, 0.10, 1080],
    [1.44, 540, 0.18, 1010], [1.45, 570, 0.16, 1110],
    [1.40, 590, 0.17, 1130], [1.62, 570, 0.18, 1060],
    [1.62, 640, 0.18, 1050],
  ][level.id - 1];
  return blend * (shape[0] * Math.sin(u * Math.PI * 2 / shape[1])
    + shape[2] * Math.sin(u * Math.PI * 2 / shape[3]));
}

function gapRangesFor(level) {
  return (level.id === 7 ? [[1150, 1158], [2110, 2118]]
    : level.id === 9 ? [[2430, 2439], [3070, 3078]] : [])
    .map(([start, end]) => ({ start, end }));
}

function tunnelRangesFor(level) {
  return (level.id === 7 ? [[520, 820], [1610, 1900]]
    : level.id === 9 ? [[2070, 2370]] : [])
    .map(([start, end]) => ({ start, end }));
}

function surfaceAt(level, s) {
  if (level.id === 5) return 'wet';
  if (level.id === 6) return Math.floor(s / 170) % 3 === 1 ? 'ice' : 'snow';
  if (level.id === 9) {
    if (s > 600 && s < 1300) return 'wet';
    if (s >= 1300 && s < 2000) return Math.floor(s / 120) % 3 === 0 ? 'ice' : 'snow';
  }
  return 'dry';
}

function cliffRangesFor(level) {
  const ranges = [];
  if (level.id === 3) {
    for (let start = 320; start < level.length - 160; start += 610) {
      ranges.push({ start, end: Math.min(level.length - 100, start + 340) });
    }
  } else if (level.id >= 8) {
    for (let start = 480; start < level.length - 180; start += 840) {
      ranges.push({ start, end: Math.min(level.length - 100, start + 300) });
    }
  }
  return ranges;
}

export function createTrack(levelOrId = 1, options = {}) {
  const level = typeof levelOrId === 'object' ? levelOrId : LEVELS.find(l => l.id === levelOrId);
  if (!level || !LEVELS.some(l => l.id === level.id)) throw new RangeError('Unknown level');
  const gapRanges = gapRangesFor(level);
  const tunnelRanges = tunnelRangesFor(level);
  const cliffRanges = cliffRangesFor(level);
  const bridgeRanges = gapRanges.map(({ start, end }) => ({ start: start - 65, end: end + 65 }));
  const widthRanges = [
    ...cliffRanges.map(range => ({ ...range, width: level.id === 3 ? 8.8 : 8.4 })),
    ...bridgeRanges.map(range => ({ ...range, width: 6.8 })),
    ...tunnelRanges.map(range => ({ ...range, width: level.id === 9 ? 5.8 : 6.0 })),
  ];
  function widthAt(s) {
    let width = level.width;
    for (const range of widthRanges) {
      // Tapers happen outside each feature, before tunnel walls begin.
      const blend = smooth(Math.min(
        clamp((s - range.start + 140) / 140, 0, 1),
        clamp((range.end + 140 - s) / 140, 0, 1),
      ));
      width = Math.min(width, lerp(level.width, range.width, blend));
    }
    return width;
  }
  const points = [];
  let x = 0;
  let z = 0;
  const count = Math.ceil(level.length / 3);
  const authoredYaw = [baseYaw(level, 0)];
  for (let i = 1; i <= count; i++) {
    const s = Math.min(i * 3, level.length);
    const previousS = (i - 1) * 3;
    const mid = (previousS + s) * 0.5;
    let curvatureFactor = 1;
    for (const { start, end } of gapRanges) {
      const entering = clamp((mid - (start - 165)) / 55, 0, 1);
      const exiting = clamp(((end + 165) - mid) / 55, 0, 1);
      curvatureFactor *= 1 - smooth(Math.min(entering, exiting));
    }
    // Flatten curvature itself instead of pulling the heading to an arbitrary
    // angle. That keeps bridge approaches within the driver's steering range.
    authoredYaw.push(authoredYaw[i - 1]
      + (baseYaw(level, s) - baseYaw(level, previousS)) * curvatureFactor);
  }
  function routeYaw(distance) {
    const s = clamp(distance, 0, level.length);
    const index = Math.min(count - 1, Math.floor(s / 3));
    const a = index * 3;
    const b = Math.min((index + 1) * 3, level.length);
    return lerp(authoredYaw[index], authoredYaw[index + 1], (s - a) / (b - a || 1));
  }
  for (let i = 0; i <= count; i++) {
    const s = Math.min(i * 3, level.length);
    const yaw = routeYaw(s);
    if (i > 0) {
      const previous = points[i - 1];
      const midYaw = routeYaw((previous.s + s) * 0.5);
      x += Math.sin(midYaw) * (s - previous.s);
      z -= Math.cos(midYaw) * (s - previous.s);
    }
    const y = 5 + 7 * Math.sin(s / 230) + s * (level.id === 6 ? 0.032 : 0.009)
      + 2 * Math.sin(s / 103);
    const gap = inside(s, gapRanges);
    const tunnel = inside(s, tunnelRanges);
    const cliff = inside(s, cliffRanges) && !tunnel && !inside(s, bridgeRanges);
    points.push({
      s, x, y, z, yaw,
      curvature: (routeYaw(Math.min(level.length, s + 0.2))
        - routeYaw(Math.max(0, s - 0.2)))
        / (s === 0 || s === level.length ? 0.2 : 0.4),
      width: widthAt(s), surface: surfaceAt(level, s),
      rails: { left: !gap && !cliff, right: !gap },
      gap, tunnel, cliff, bridge: inside(s, bridgeRanges),
    });
  }

  function sample(distance) {
    const s = clamp(distance, 0, level.length);
    const index = Math.min(points.length - 2, Math.floor(s / 3));
    const a = points[index];
    const b = points[index + 1];
    const t = (s - a.s) / (b.s - a.s || 1);
    const tunnel = inside(s, tunnelRanges);
    const gap = inside(s, gapRanges);
    const bridge = inside(s, bridgeRanges);
    const cliff = inside(s, cliffRanges) && !tunnel && !bridge;
    return { s, x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
      yaw: lerp(a.yaw, b.yaw, t), curvature: lerp(a.curvature, b.curvature, t),
      width: lerp(a.width, b.width, t), surface: surfaceAt(level, s),
      rails: { left: !gap && !cliff, right: !gap }, gap, tunnel, cliff, bridge };
  }
  const track = {
    level, length: level.length, points, sample, hazards: [],
    gapRanges, tunnelRanges, cliffRanges, bridgeRanges, brokenRails: new Set(),
    runSeed: chooseRunSeed(options.seed),
  };
  if (options.hazards !== false) {
    track.hazardStream = new HazardStream(track, track.runSeed);
    track.hazardStream.update(0, level.startSpeed);
  }
  return track;
}
