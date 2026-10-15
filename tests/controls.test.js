import test from 'node:test';
import assert from 'node:assert/strict';
import { SteeringInput } from '../src/controls.js';
import { GameSimulation } from '../src/core.js';

function start() {
  const game = new GameSimulation(1, { hazards: false });
  game.start(); game.update(3); game.state.speed = 150;
  return game;
}

test('a 100 ms keyboard tap turns much less than immediate full lock', () => {
  const angles = [];
  for (const filtered of [false, true]) {
    const game = start(), control = new SteeringInput();
    for (let i = 0; i < 30; i++) {
      const raw = i < 12 ? 1 : 0;
      game.update(1 / 120, { steer: filtered ? control.update(raw, 1 / 120) : raw });
    }
    angles.push(Math.abs(game.state.heading));
  }
  assert.ok(angles[1] < angles[0] * 0.3);
  assert.ok(angles[1] < 0.08);
});

test('holding still reaches full steering and release/reversal removes stale input quickly', () => {
  const control = new SteeringInput();
  for (let i = 0; i < 120; i++) control.update(1, 1 / 120);
  assert.ok(control.value > 0.99);
  assert.ok(control.update(-1, 1 / 120) < 0);
  for (let i = 0; i < 20; i++) control.update(0, 1 / 120);
  assert.ok(Math.abs(control.value) < 0.003);
  control.reset();
  assert.equal(control.value, 0);
  assert.equal(control.age, 0);
});

test('progressive keyboard steering preserves a controllable U-turn and reverse travel', () => {
  const game = start(), control = new SteeringInput();
  game.state.s = 15; game.state.offset = -12;
  let held = true;
  for (let i = 0; i < 220; i++) {
    if (game.state.heading > 2.6) held = false;
    game.update(1 / 120, { steer: control.update(held ? 1 : 0, 1 / 120) });
    if (!held && Math.cos(game.state.heading) < -0.97) break;
  }
  assert.equal(game.state.status, 'running');
  assert.equal(game.state.durability, 100);
  assert.ok(Math.cos(game.state.heading) < -0.95);
  const before = game.state.s;
  game.update(0.05, { steer: control.update(0, 0.05) });
  assert.ok(game.state.s < before);
});
