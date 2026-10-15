import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, createTrack } from '../src/levels.js';
import { railKey } from '../src/rails.js';
import { GameSimulation, steeringRate } from '../src/core.js';

function running(id = 1) {
  const game = new GameSimulation(id, { seed: 1, hazards: false });
  game.start();
  game.update(3);
  assert.equal(game.state.status, 'running');
  game.consumeEvents();
  return game;
}

function robotInput(game) {
  const state = game.state;
  const speed = state.speed / 3.6;
  const road = game.track.sample(state.s);
  const targetRate = road.curvature * speed;
  const response = road.surface === 'ice' ? 3.6 : road.surface === 'snow' ? 5 : 8;
  const rateChange = (game.track.sample(state.s + speed * 0.1).curvature
    - game.track.sample(state.s - speed * 0.1).curvature) * speed / 0.2;
  const rate = targetRate + rateChange / response - state.heading * 3 - state.offset * 0.22
    - (game._yawRate - targetRate) * 0.8;
  return { steer: Math.max(-1, Math.min(1, rate / steeringRate(state.speed, road.surface))), slow: false };
}

test('authored roads and seeded hazards reproduce while gaps stay fixed', () => {
  assert.equal(LEVELS.length, 9);
  for (const level of LEVELS) {
    const first = createTrack(level.id, { seed: 22 });
    const second = createTrack(level.id, { seed: 22 });
    assert.deepEqual(first.points, second.points);
    assert.deepEqual(first.hazards, second.hazards);
    assert.notEqual(first.hazards, second.hazards);
    assert.equal(first.points.at(-1).s, level.length);
    assert.equal(first.sample(-10).s, 0);
    assert.equal(first.sample(level.length + 20).s, level.length);
    assert.equal(first.sample(10).yaw, 0);
    assert.ok(first.points.some(p => Math.abs(p.curvature) > 0.001));
    for (const hazard of first.hazards) assert.ok(hazard.s >= 100);
    for (const gap of first.gapRanges) {
      assert.ok(gap.end - gap.start >= 7 && gap.end - gap.start <= 9);
      assert.equal(first.sample((gap.start + gap.end) / 2).gap, true);
    }
  }
});

test('steering stays free: curved road moves underneath a car with no steering input', () => {
  const game = running();
  game.state.s = 100;
  const old = game.state.offset;
  game.update(0.7, { steer: 0 });
  assert.ok(Math.abs(game.state.heading) > 0.01);
  assert.ok(Math.abs(game.state.offset - old) > 0.1);
});

test('the first course starts fast and makes uncorrected steering reach a real rail impact', () => {
  const game = running();
  while (game.state.status === 'running' && game.state.collisions === 0) game.update(1 / 120);
  assert.equal(game.state.status, 'running');
  assert.ok(game.state.elapsed > 2 && game.state.elapsed < 10);
  assert.equal(game.state.collisions, 1);
  assert.equal(game.state.durability, 100);
});

test('a rail hit lowers the current speed, then acceleration resumes from it', () => {
  const game = running();
  game.state.speed = 80;
  game.state.offset = game.level.width / 2 - 1.05 - 0.01;
  game.state.heading = 0.25;
  game.update(1 / 120, { steer: 0 });
  assert.equal(game.state.collisions, 1);
  assert.ok(Math.abs(game.state.speed - 77) < 0.05);
  assert.equal(game.state.durability, 100);
  game.state.offset = 0;
  const after = game.state.speed;
  game.update(0.5);
  assert.ok(Math.abs(game.state.speed - (after + game.level.acceleration * 0.5)) < 0.01);
  assert.equal(game.consumeEvents().filter(e => e.type === 'collision').length, 1);
});

test('all obstacles cause a small speed loss without damaging or destroying the car', () => {
  for (const type of ['barrel', 'barrier', 'rock']) for (const speed of [80, 180, 260]) {
    const game = running(3);
    game.track.hazards = [{ id: 'test', s: 5, offset: 0, type, radius: 0.6, hit: false }];
    game.state.speed = speed;
    game.update(0.3);
    assert.equal(game.state.status, 'running');
    assert.equal(game.state.collisions, 1);
    assert.equal(game.state.durability, 100);
    assert.ok(Math.abs(game.state.speed - (speed + game.level.acceleration * 0.3 - 4)) < 0.01);
    game.update(0.2);
    assert.equal(game.state.collisions, 1);
    assert.equal(game.consumeEvents().filter(e => e.type === 'explosion').length, 0);
  }
});

test('150 km/h breaks an outdoor rail in normal and slow time instead of breaking the car', () => {
  for (const slow of [false, true]) for (const speed of [149, 150, 220]) {
    const game = running(4);
    if (slow) game.update(0.15, { slow: true });
    game.state.speed = speed;
    game.state.offset = game.track.sample(game.state.s).width / 2 - 1.0;
    game.state.heading = 0.3;
    game.update(1 / 120, { slow });
    assert.equal(game.state.status, 'running');
    assert.equal(game.state.durability, 100);
    assert.equal(game.state.collisions, 1);
    assert.ok(Math.abs(game.state.speed - (speed - 3)) < 0.05);
    const events = game.consumeEvents();
    assert.equal(events.filter(e => e.type === 'explosion').length, 0);
    assert.equal(events.filter(e => e.type === 'rail-break').length, speed >= 150 ? 1 : 0);
    assert.equal(game.track.brokenRails.has(railKey('right', game.state.s)), speed >= 150);
    const brokenCount = game.state.brokenRails;
    if (speed >= 150) assert.ok(brokenCount > 0);
    game.restart();
    assert.equal(game.track.brokenRails.size, 0);
    assert.equal(game.state.brokenRails, 0);
  }
});

test('continuous contact neither drains durability nor repeatedly reduces speed', () => {
  const speeds = [];
  for (const fps of [30, 60, 120]) {
    const game = running();
    game.state.speed = 70;
    game.state.offset = game.level.width / 2 - 1.05 - 0.01;
    game.state.heading = 0.2;
    for (let i = 0; i < fps; i++) game.update(1 / fps);
    assert.equal(game.state.collisions, 1);
    assert.equal(game.state.durability, 100);
    assert.equal(game.state.status, 'running');
    speeds.push(game.state.speed);
  }
  assert.ok(Math.max(...speeds) - Math.min(...speeds) < 1e-8);
});

test('a full controlled U-turn fits the wide road at 150 and then travels backwards', () => {
  const game = running();
  game.state.s = 15;
  game.state.offset = -11;
  game.state.speed = 150;
  // Release before 180 degrees to allow for steering inertia.
  while (game.state.heading < 2.7) game.update(1 / 120, { steer: 1 });
  for (let i = 0; i < 45; i++) game.update(1 / 120);
  assert.ok(Math.cos(game.state.heading) < -0.95);
  assert.equal(game.state.status, 'running');
  assert.equal(game.state.collisions, 0);
  const s = game.state.s;
  game.update(0.15);
  assert.ok(game.state.s < s);
  assert.equal(game.state.travelDirection, -1);
  assert.equal(game.state.durability, 100);
});

test('reverse collisions are swept in the reverse direction and preserve reverse heading', () => {
  const game = running();
  game.state.s = 25;
  game.state.heading = Math.PI;
  game.track.hazards = [{ id: 'reverse', s: 22, offset: 0, type: 'barrel', radius: 0.42 }];
  game.update(0.2);
  assert.equal(game.state.collisions, 1);
  assert.equal(game.state.status, 'running');
  assert.equal(game.state.travelDirection, -1);
  game.state.heading = Math.PI - 0.2;
  game.state.offset = game.level.width / 2 - 1;
  game.state.speed = 100;
  game.update(1 / 120);
  assert.ok(Math.cos(game.state.heading) < -0.99);
  assert.ok(game.state.s < 25);
});

test('tunnel walls contain the car even above the rail breaking threshold', () => {
  const game = running(7);
  game.state.s = 600;
  game.state.speed = 200;
  game.state.offset = 2.1;
  game.state.heading = 0.3;
  game.update(1 / 120);
  assert.equal(game.state.status, 'running');
  assert.equal(game.track.brokenRails.size, 0);
  assert.equal(game.state.collisions, 1);
});

test('slow time has a 2 real second limit; a held key never spends multiple charges', () => {
  const game = running(4);
  game.update(1, { slow: true });
  assert.equal(game.state.slowCharges, 1);
  assert.ok(game.state.timeScale < 0.4);
  assert.ok(Math.abs(game.state.elapsed - 1) < 1e-8);
  assert.ok(Math.abs(game.state.remaining - (game.level.timeLimit - 1)) < 1e-8);
  game.state.s = 0;
  game.state.offset = 0;
  game.state.heading = 0;
  game.update(1, { slow: true });
  assert.equal(game.state.timeScale, 1);
  assert.equal(game.state.slowCharges, 1);
  game.state.s = 0;
  game.update(1.1, { slow: true });
  assert.equal(game.state.slowCharges, 1);
  game.update(0.01, { slow: false });
  game.update(0.01, { slow: true });
  assert.equal(game.state.slowCharges, 0);
});

test('pause freezes both clocks and ability duration; release ends on resume', () => {
  const game = running(4);
  game.update(0.5, { slow: true });
  game.pause();
  const snapshot = { ...game.state };
  game.update(10, { slow: false });
  assert.deepEqual(game.state, snapshot);
  game.resume();
  game.update(0.13, { slow: false });
  assert.equal(game.state.timeScale, 1);
  assert.equal(game.state.slowCharges, 1);
  assert.ok(Math.abs(game.state.elapsed - 0.63) < 1e-8);
});

test('deadline produces one explosion and restart fully restores a fresh run', () => {
  const game = running(4);
  game.state.elapsed = game.level.timeLimit - 0.05;
  game.update(0.1, { slow: true });
  assert.equal(game.state.status, 'failed');
  assert.equal(game.state.remaining, 0);
  assert.equal(game.state.failReason, '超时爆炸');
  assert.equal(game.state.timeScale, 1);
  assert.equal(game.consumeEvents().filter(e => e.type === 'explosion').length, 1);
  game.update(10);
  assert.equal(game.consumeEvents().length, 0);
  game.restart();
  assert.equal(game.state.status, 'countdown');
  assert.equal(game.state.elapsed, 0);
  assert.equal(game.state.speed, game.level.startSpeed);
  assert.equal(game.state.durability, 100);
  assert.equal(game.state.slowCharges, 2);
  assert.equal(game.state.remaining, game.level.timeLimit);
});

test('finishing before the deadline wins even if the update spans expiry', () => {
  const game = running();
  game.state.s = game.level.length - 0.01;
  game.state.elapsed = game.level.timeLimit - 0.002;
  game.state.heading = 0;
  game.update(0.1);
  assert.equal(game.state.status, 'finished');
  assert.ok(game.state.elapsed <= game.level.timeLimit);
  assert.equal(game.consumeEvents().filter(e => e.type === 'finish').length, 1);
});

test('bridge launch is passable at route speed and too much reduction can lose the landing', () => {
  for (const speed of [100, 25]) {
    const game = running(7);
    const gap = game.track.gapRanges[0];
    game.state.s = gap.start - 0.5;
    game.state.speed = speed;
    game.update(1.3, { steer: 0 });
    if (speed === 100) {
      assert.equal(game.state.status, 'running');
      assert.equal(game.state.y, 0);
      assert.equal(game.state.durability, 100);
      assert.ok(game.state.s > gap.end);
    } else {
      assert.equal(game.state.status, 'failed');
      assert.equal(game.state.failCause, 'gap');
    }
  }
});

test('a bridge can be crossed backwards after turning around', () => {
  const game = running(7);
  const gap = game.track.gapRanges[0];
  game.state.s = gap.end + 0.5;
  game.state.heading = Math.PI;
  game.state.speed = 100;
  game.update(1.3);
  assert.equal(game.state.status, 'running');
  assert.equal(game.state.y, 0);
  assert.ok(game.state.s < gap.start);
  assert.equal(game.state.collisions, 0);
});

test('nine authored courses have a no-collision, no-slow reference run within the time budget', () => {
  for (const level of LEVELS) {
    const game = running(level.id);
    let maximumOffset = 0;
    while (game.state.status === 'running') {
      game.update(1 / 120, robotInput(game));
      maximumOffset = Math.max(maximumOffset, Math.abs(game.state.offset));
    }
    assert.equal(game.state.status, 'finished', `L${level.id}: ${game.state.failReason}, s=${game.state.s}`);
    assert.equal(game.state.collisions, 0, `L${level.id}: unintended collision`);
    assert.equal(game.state.durability, 100);
    assert.equal(game.state.slowCharges, level.charges);
    assert.ok(game.state.elapsed < level.timeLimit);
    assert.ok(game.state.elapsed <= level.idealTime + 1,
      `L${level.id}: driven reference exceeds the theoretical baseline excessively`);
    assert.ok(maximumOffset < level.width * 0.5 - 1.2, `L${level.id}: offset=${maximumOffset}`);
  }
});
