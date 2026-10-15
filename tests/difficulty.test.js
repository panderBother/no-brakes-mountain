import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, createTrack, idealTravelTime } from '../src/levels.js';
import { GameSimulation, steeringRate } from '../src/core.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = t => t * t * (3 - 2 * t);

// Acceptance driver uses only the same analog steering input as a player.
// These guide points verify existence of a route; they are never used by UI.
function passageAt(track, distance) {
  const ranges = [...track.tunnelRanges, ...track.bridgeRanges.map(range => ({ ...range, bridge: true }))];
  const anchors = track.hazardStream.groups
    .filter(group => !ranges.some(range => group.s >= range.start && group.s < range.end))
    .map(group => {
      return { start: group.s - 7, end: group.s + 7,
        offset: group.safePassage };
    });
  anchors.push(...ranges.map(range => ({ start: range.start, end: range.end + (range.bridge ? 90 : 10), offset: 0 })));
  anchors.sort((a, b) => a.start - b.start);
  let previous = { end: 0, offset: 0 };
  for (const anchor of anchors) {
    if (distance < anchor.start) {
      const t = smooth(clamp((distance - previous.end) / (anchor.start - previous.end || 1), 0, 1));
      return previous.offset + (anchor.offset - previous.offset) * t;
    }
    if (distance <= anchor.end) return anchor.offset;
    previous = anchor;
  }
  return previous.offset;
}

function referenceInput(game) {
  const state = game.state;
  const speed = state.speed / 3.6;
  const road = game.track.sample(state.s);
  game._acceptanceGuides ??= new Map();
  for (const group of game.track.hazardStream.groups) game._acceptanceGuides.set(group.id, group);
  const guideTrack = { ...game.track,
    hazardStream: { groups: [...game._acceptanceGuides.values()].sort((a, b) => a.s - b.s) } };
  const angleAt = s => {
    const p = game.track.sample(s);
    const target = passageAt(guideTrack, s);
    const derivative = passageAt(guideTrack, s + 0.5) - passageAt(guideTrack, s - 0.5);
    return Math.atan(derivative * (1 - p.curvature * target));
  };
  const referenceAt = s => {
    const p = game.track.sample(s);
    const target = passageAt(guideTrack, s);
    const heading = angleAt(s);
    const alongSpeed = speed * Math.cos(heading) / (1 - p.curvature * target);
    return { target, heading,
      rate: (p.curvature + angleAt(s + 0.5) - angleAt(s - 0.5)) * alongSpeed };
  };
  const reference = referenceAt(state.s);
  const acceleration = (referenceAt(state.s + speed * 0.1).rate
    - referenceAt(state.s - speed * 0.1).rate) / 0.2;
  const response = road.surface === 'ice' ? 3.6 : road.surface === 'snow' ? 5 : 8;
  // Compensate the known steering response, then damp heading/rate error.
  // The resulting input is still clamped to the player's physical authority.
  const rate = reference.rate + acceleration / response
    - (state.heading - reference.heading) * 3 - (state.offset - reference.target) * 0.22
    - (game._yawRate - reference.rate) * 0.8;
  return { steer: clamp(rate / steeringRate(state.speed, road.surface), -1, 1), slow: false };
}

test('harder authored tracks remain within steering authority at their maximum unbraked speed', () => {
  for (const level of LEVELS) {
    assert.ok(level.startSpeed >= 150);
    assert.ok(level.acceleration >= 4.2);
    assert.equal(level.railBreakSpeed, 150);
    assert.ok(level.width >= 12);
    assert.ok(level.length >= 1800 && level.length <= 3500);
    assert.equal(level.idealTime, Math.ceil(idealTravelTime(level.length, level.startSpeed, level.acceleration)));
    assert.equal(level.timeLimit, level.idealTime + level.bufferTime);
    const track = createTrack(level.id, { hazards: false });
    assert.ok(Math.max(...track.points.map(point => Math.abs(point.yaw))) > 1.1);
    for (const point of track.points) {
      const maximumSpeed = Math.sqrt(level.startSpeed ** 2 + 7.2 * level.acceleration * point.s);
      const demand = Math.abs(point.curvature) * maximumSpeed / 3.6;
      assert.ok(demand < steeringRate(maximumSpeed, point.surface) * (0.80 + Math.max(0, level.id - 6) * 0.05),
        `L${level.id} at ${point.s}: steering demand ${demand}`);
      assert.ok(Math.abs(track.sample(point.s).width - point.width) < 1e-10);
    }
    for (const range of track.tunnelRanges) {
      const centre = track.sample((range.start + range.end) / 2);
      assert.ok(centre.width >= 5.8 && centre.width <= 6.2);
      assert.ok(track.sample(range.start - 40).width > centre.width);
    }
    for (let s = 1; s < level.length; s++) {
      assert.ok(Math.abs(track.sample(s).width - track.sample(s - 1).width) < 0.27);
    }
  }
});

test('random hazard streams retain clear passages, advance gradually and recycle old records', () => {
  let centreObstructed = 0;
  for (const level of LEVELS) for (let seed = 1; seed <= 12; seed++) {
    const track = createTrack(level.id, { seed });
    assert.ok(track.hazards.length > 0);
    assert.ok(track.hazards[0].s >= 100 && track.hazards[0].s <= 140);
    const seen = new Set();
    for (let s = 0; s < level.length; s += 20) {
      const speed = Math.sqrt(level.startSpeed ** 2 + 7.2 * level.acceleration * s);
      track.hazardStream.update(s, speed);
      assert.ok(track.hazards.length <= 48, 'active physics records must be bounded');
      for (const hazard of track.hazards) {
        assert.ok(hazard.s >= s - 80);
        assert.ok(hazard.s <= s + 510);
        assert.ok(Math.abs(hazard.offset) + hazard.radius < track.sample(hazard.s).width / 2);
        assert.ok(hazard.passageWidth >= 3.6);
        assert.ok(Math.abs(hazard.offset - hazard.safePassage) > hazard.radius + hazard.passageWidth / 2,
          `L${level.id} seed ${seed}: corridor blocked`);
        assert.ok(!track.gapRanges.some(range => hazard.s > range.start - 108 && hazard.s < range.end + 88));
        assert.ok(!track.tunnelRanges.some(range => Math.abs(hazard.s - range.start) < 58));
        if (!seen.has(hazard.id)) {
          seen.add(hazard.id);
          if (hazard.spawnedAtS > 0) assert.ok(hazard.s - hazard.spawnedAtS >= 160, 'no close-range spawn');
          if (Math.abs(hazard.offset) < 1.5) centreObstructed++;
        }
      }
    }
    assert.ok(track.hazardStream.diagnostics.retired > 0);
    assert.ok(track.hazardStream.diagnostics.generated > track.hazards.length);
  }
  assert.ok(centreObstructed > 50, 'random hazards must also interrupt the centreline');
});

test('random retry changes seed while explicit seeded runs reproduce every obstacle', () => {
  const random = new GameSimulation(1);
  const initialSeed = random.track.runSeed;
  random.restart();
  assert.notEqual(random.track.runSeed, initialSeed);
  const first = new GameSimulation(8, { seed: 'hardcore-route' });
  const second = new GameSimulation(8, { seed: 'hardcore-route' });
  assert.deepEqual(first.track.points, second.track.points);
  assert.deepEqual(first.track.hazards, second.track.hazards);
  for (const s of [200, 700, 1600, 3000]) {
    first.track.hazardStream.update(s, 240);
    second.track.hazardStream.update(s, 240);
    assert.deepEqual(first.track.hazards, second.track.hazards);
  }
  first.restart();
  assert.equal(first.track.runSeed, second.track.runSeed);
  assert.deepEqual(first.track.hazards, createTrack(8, { seed: 'hardcore-route' }).hazards);
});

test('returning along the road restores the same obstacles and remembers already hit ones', () => {
  const track = createTrack(1, { seed: 7 });
  const originals = track.hazards.map(h => ({ ...h }));
  const first = track.hazards[0];
  first.hit = true;
  for (let s = 0; s <= 1400; s += 20) track.hazardStream.update(s, 180);
  assert.ok(!track.hazards.some(h => h.id === first.id));
  track.hazardStream.update(450, 180, -1);
  for (const original of originals) {
    const restored = track.hazards.find(h => h.id === original.id);
    assert.ok(restored);
    assert.equal(restored.s, original.s);
    assert.equal(restored.offset, original.offset);
    assert.equal(restored.type, original.type);
    assert.equal(restored.hit, original.id === first.id);
  }
  assert.ok(track.hazards.every(h => h.s >= 450 - track.hazardStream.ahead && h.s <= 530));
  assert.ok(track.hazards.length <= 48);
});

test('first course punishes no steering and simple fixed steering strategies', () => {
  for (const steer of [-1, 0, 1]) {
    const game = new GameSimulation(1, { seed: 4 });
    game.start();
    game.update(3);
    while (game.state.status === 'running') game.update(1 / 60, { steer });
    assert.equal(game.state.status, 'failed');
    assert.ok(game.state.s < game.level.length);
  }
});

test('following the centreline without dodging is no longer enough for the first deadline', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const game = new GameSimulation(1, { seed });
    game.start(); game.update(3);
    while (game.state.status === 'running') {
      const x = game.state, p = game.track.sample(x.s);
      const look = game.track.sample(x.s + x.speed / 3.6 * 0.14);
      const rate = look.curvature * x.speed / 3.6 - x.heading * 4 - x.offset * 0.22;
      game.update(1 / 120, { steer: clamp(rate / steeringRate(x.speed, p.surface), -1, 1) });
    }
    assert.equal(game.state.failCause, 'timeout', `seed ${seed}`);
    assert.ok(game.state.collisions >= 10);
  }
});

test('nine courses across varied seeds finish legally within the deadline under the no-damage collision rules', () => {
  for (const level of LEVELS) for (let seed = 1; seed <= 8; seed++) {
    const game = new GameSimulation(level.id, { seed });
    game.start();
    game.update(3);
    while (game.state.status === 'running') game.update(1 / 120, referenceInput(game));
    assert.equal(game.state.status, 'finished', `L${level.id} seed ${seed}: ${game.state.failReason}, s=${game.state.s}`);
    // The final stages deliberately approach steering authority. Light contact
    // and rail breaking are legal strategies; finishing, time and survival are
    // the actual contract. Earlier stages still have a clean reference route.
    if (level.id <= 6) assert.equal(game.state.collisions, 0, `L${level.id} seed ${seed}: collision`);
    assert.equal(game.state.durability, 100);
    assert.ok(game.state.elapsed <= level.timeLimit);
  }
});

test('every course raises both launch speed and acceleration with larger late-stage increments', () => {
  const previous = [[130, 3.60], [135, 3.75], [140, 3.90], [145, 4.05],
    [150, 4.20], [155, 4.35], [160, 4.50], [168, 4.65], [175, 4.80]];
  let speedIncrement = 0, accelerationIncrement = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const level = LEVELS[i];
    assert.ok(level.startSpeed > previous[i][0]);
    assert.ok(level.acceleration > previous[i][1]);
    if (!i) continue;
    const nextSpeed = level.startSpeed - LEVELS[i - 1].startSpeed;
    const nextAcceleration = level.acceleration - LEVELS[i - 1].acceleration;
    assert.ok(nextSpeed >= speedIncrement);
    assert.ok(nextAcceleration + 1e-9 >= accelerationIncrement);
    speedIncrement = nextSpeed; accelerationIncrement = nextAcceleration;
  }
});
