import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignProgress, PlayTimeTracker, investmentText } from '../src/progress.js';

test('the ninth road alone and repeated clears cannot unlock the grand prize', () => {
  const progress = campaignProgress([9, 9, 1, 1, 0, 10, '2', null], 9);
  assert.equal(progress.count, 2);
  assert.equal(progress.remaining, 7);
  assert.equal(progress.allCleared, false);
  assert.equal(progress.nextId, 2);
});

test('all nine different roads unlock the prize in any order; next route skips cleared roads', () => {
  assert.equal(campaignProgress([1, 2, 4, 5], 2).nextId, 3);
  const progress = campaignProgress([9, 5, 2, 1, 4, 3, 6, 7, 8, 9]);
  assert.equal(progress.count, 9);
  assert.equal(progress.remaining, 0);
  assert.equal(progress.allCleared, true);
  assert.equal(progress.nextId, null);
});

test('real play time accumulates failed and retried attempts while pause and background add nothing', () => {
  const clock = new PlayTimeTracker();
  clock.checkpoint(0, false); // Menu.
  clock.checkpoint(10000, true); // Start countdown.
  clock.checkpoint(13000, true);
  clock.checkpoint(25000, false); // Failed attempt: 15 seconds including countdown.
  clock.checkpoint(85000, true); // Retry after a minute on the result screen.
  clock.checkpoint(90000, false); // Pause/background: 5 more seconds played.
  clock.checkpoint(190000, true); // Resume after 100 seconds away.
  clock.checkpoint(200000, false); // Finish.
  assert.equal(clock.totalMs, 30000);
});

test('saved investment survives reload without counting time while the game was closed', () => {
  const previous = new PlayTimeTracker(120000);
  previous.checkpoint(500, true);
  previous.checkpoint(2500, false);
  const restored = new PlayTimeTracker(JSON.parse(JSON.stringify({ ms: previous.totalMs })).ms);
  restored.checkpoint(2000000, false);
  restored.checkpoint(3000000, true);
  restored.checkpoint(3004000, false);
  assert.equal(restored.totalMs, 126000);
});

test('slow motion does not discount invested real time; invalid timestamps cannot corrupt it', () => {
  const clock = new PlayTimeTracker(NaN);
  clock.checkpoint(100, true);
  clock.checkpoint(2100, true); // A 2-second slow action still costs 2 real seconds.
  clock.checkpoint(NaN, false);
  clock.checkpoint(1000, false);
  clock.checkpoint(3100, false);
  assert.equal(clock.totalMs, 3000);
});

test('prize duration formats seconds, minutes and hours without wrapping at one hour', () => {
  assert.equal(investmentText(999), '0 秒');
  assert.equal(investmentText(65500), '1 分 5 秒');
  assert.equal(investmentText(7323000), '2 小时 2 分 3 秒');
  assert.equal(investmentText(-1000), '0 秒');
  assert.equal(investmentText(Infinity), '0 秒');
});
