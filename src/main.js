import './style.css';
import { LEVELS, createTrack } from './levels.js';
import { GameSimulation } from './core.js';
import { MountainRenderer } from './renderer.js';
import { SynthAudio } from './audio.js';
import { SteeringInput } from './controls.js';

const $ = (id) => document.getElementById(id);
const initialSettings = { muted: false, volume: 0.35, quality: 'high', shake: true };
const SAVE_KEY = 'mountain-no-brakes-escalation-v5';
let saved = { best: {}, records: {}, attempts: {}, completed: [], settings: initialSettings };
try {
  const value = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (value && typeof value === 'object') {
    saved = {
      best: value.best && typeof value.best === 'object' ? value.best : {},
      records: value.records && typeof value.records === 'object' ? value.records : {},
      attempts: value.attempts && typeof value.attempts === 'object' ? value.attempts : {},
      completed: Array.isArray(value.completed) ? value.completed.filter((id) => LEVELS.some((l) => l.id === id)) : [],
      settings: { ...initialSettings, ...value.settings },
    };
  }
} catch { /* Corrupt or unavailable storage does not prevent playing. */ }
const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); } catch { /* Session remains playable. */ } };
const audio = new SynthAudio();
audio.setVolume(saved.settings.volume);
audio.setMuted(saved.settings.muted);
let renderer;
let simulation;
let selectedId = 1;
let inMenu = true;
let modalKind = null;
let toastTimer;
let lastStatus = 'ready';
let lastTick = null;
let lastTime = performance.now();
let previewClock = 0;
let lastUI = 0;
let mapCache = null;
const previewPaths = new Map();
const input = { steer: 0, slow: false };
const steeringInput = new SteeringInput();
const keys = new Set();
const touch = { left: false, right: false, slow: false };
const two = (n) => String(n).padStart(2, '0');
const timeText = (seconds, decimals = true) => {
  const s = Math.max(0, Number(seconds) || 0);
  return `${two(Math.floor(s / 60))}:${two(Math.floor(s % 60))}${decimals ? `.${Math.floor((s % 1) * 10)}` : ''}`;
};

function showToast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2400);
}

function updateSoundButton() {
  $('sound-button').textContent = saved.settings.muted ? '声音：关' : '声音：开';
  $('sound-button').setAttribute('aria-label', saved.settings.muted ? '开启声音' : '关闭声音');
}

function buildLevelList() {
  $('level-list').innerHTML = LEVELS.map((l) => `<button class="level-card${l.id === selectedId ? ' active' : ''}" data-level="${l.id}" aria-label="试玩第 ${l.id} 关 ${l.name}" aria-pressed="${l.id === selectedId}"><span class="level-n">${two(l.id)}</span>${saved.completed.includes(l.id) ? '<span class="level-cleared">✓</span>' : ''}${routePreview(l)}<span class="level-name">${l.name}</span><span class="level-detail">${(l.length / 1000).toFixed(2)} KM · ${l.timeLimit} S</span></button>`).join('');
  $('challenge-progress').textContent = saved.completed.length ? `已通关 ${new Set(saved.completed).size} / 9 · 全关可试玩` : '预览版九关均可试玩';
  $('level-list').querySelectorAll('button').forEach((button) => button.addEventListener('click', () => selectLevel(Number(button.dataset.level))));
}

function routePreview(level) {
  if (previewPaths.has(level.id)) return previewPaths.get(level.id);
  const points = createTrack(level.id, { seed: level.seed, hazards: false }).points.filter((_, i) => i % 8 === 0);
  const xs = points.map(p => p.x), zs = points.map(p => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${(3 + (z1 - p.z) / Math.max(1, z1 - z0) * 94).toFixed(1)},${(3 + (p.x - x0) / Math.max(1, x1 - x0) * 22).toFixed(1)}`).join(' ');
  const svg = `<svg class="route-spark" viewBox="0 0 100 28" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>`;
  previewPaths.set(level.id, svg);
  return svg;
}

function selectLevel(id) {
  selectedId = id;
  simulation = new GameSimulation(id);
  renderer.loadTrack(simulation.track);
  previewClock = 0;
  lastStatus = 'ready';
  lastTick = null;
  const l = simulation.level;
  $('selected-num').textContent = `${two(id)} / 09`;
  $('selected-name').textContent = l.name;
  document.querySelector('.difficulty-stamp b').textContent = ['高压','高压','严酷','严酷','极难','极限','极限','噩梦','绝境'][id - 1];
  $('selected-subtitle').textContent = l.subtitle;
  $('selected-length').textContent = `${(l.length / 1000).toFixed(2)} KM`;
  $('selected-time').textContent = `${l.timeLimit} SEC`;
  $('selected-best').textContent = saved.best[id] ? `最佳 ${timeText(saved.best[id])}` : `已尝试 ${saved.attempts[id] || 0} 次`;
  $('selected-start-speed').innerHTML = `${l.startSpeed}<span> KM/H</span>`;
  $('selected-acceleration').innerHTML = `+${l.acceleration.toFixed(2)}<span> KM/H·S⁻¹</span>`;
  $('scene-coordinates').textContent = `RIDGE ${two(id)} / ${['ALPINE PASS','SWITCHBACKS','CLIFF EDGE','NINE HAIRPINS','MIDNIGHT RAIN','FROZEN SUMMIT','THE BROKEN BRIDGE','HIGH ALTITUDE','DEATH RIDGE'][id - 1]}`;
  $('race-number').textContent = two(id);
  $('race-name').textContent = l.name;
  $('length-value').textContent = (l.length / 1000).toFixed(2);
  $('acceleration-text').textContent = `+${l.acceleration.toFixed(2)}`;
  $('ability-charges').innerHTML = Array.from({ length: l.charges }, (_, i) => `<i class="charge" data-charge="${i}" aria-hidden="true"></i>`).join('');
  $('slow-hint').classList.toggle('hidden', l.charges === 0);
  buildLevelList();
  mapCache = null;
  drawMap();
}

function clearInput() {
  steeringInput.reset();
  keys.clear();
  touch.left = touch.right = touch.slow = false;
  input.steer = 0;
  input.slow = false;
}

async function startRace() {
  closeModal();
  clearInput();
  inMenu = false;
  document.body.classList.add('in-race');
  $('menu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('pause-button').classList.remove('hidden');
  simulation.restart();
  simulation.start();
  renderer.loadTrack(simulation.track);
  saved.attempts[selectedId] = (saved.attempts[selectedId] || 0) + 1;
  persist();
  mapCache = null;
  lastStatus = simulation.state.status;
  lastTick = null;
  lastTime = performance.now();
  if (!saved.settings.muted) await audio.enable();
}

function returnMenu() {
  closeModal();
  clearInput();
  inMenu = true;
  document.body.classList.remove('in-race');
  $('menu').classList.remove('hidden');
  $('hud').classList.add('hidden');
  $('pause-button').classList.add('hidden');
  $('countdown').classList.add('hidden');
  selectLevel(selectedId);
}

function openModal(kind, html) {
  modalKind = kind;
  $('modal-content').innerHTML = html;
  $('modal').classList.remove('hidden');
  const first = $('modal-content').querySelector('button,input,select');
  if (first) first.focus({ preventScroll: true });
}

function closeModal() {
  $('modal').classList.add('hidden');
  modalKind = null;
}

function pauseRace() {
  if (inMenu || !['running', 'countdown', 'paused'].includes(simulation.state.status)) return;
  if (simulation.state.status !== 'paused') simulation.pause();
  clearInput();
  openModal('pause', `<div class="modal-label">TAKE A BREATH</div><h2 id="modal-title">山道等你片刻。</h2><p>倒计时已暂停。准备好了，就继续向终点出发。</p><div class="modal-buttons"><button class="primary-button" id="resume-button">继续驾驶 <span>→</span></button><button class="secondary-button" id="restart-button">重新开始</button><button class="secondary-button" id="back-button">返回选关</button></div>`);
  $('resume-button').onclick = resumeRace;
  $('restart-button').onclick = startRace;
  $('back-button').onclick = returnMenu;
}

function resumeRace() {
  closeModal();
  clearInput();
  simulation.resume();
  lastTime = performance.now();
}

function showGuide() {
  const running = !inMenu && ['running', 'countdown'].includes(simulation.state.status);
  if (running) simulation.pause();
  openModal('guide', `<div class="modal-label">A DRIVER'S FIELD GUIDE</div><h2 id="modal-title">先判断，再转向。</h2><ul class="guide-list"><li><b>A / D</b><span>高起速、强加速。提前观察大弯，用短按轻柔修正，长按逐渐加大转向。普通山路较宽，隧道入口会渐渐收窄。</span></li><li><b>掉头</b><span>普通道路宽约 26–28 米。先靠道路一侧，再持续转向完成掉头；逆向会远离终点，倒计时照常流逝。窄隧道和桥面不适合掉头。</span></li><li><b>随机路障</b><span>每次出发都有不同障碍；前方生成的路障会占据部分车道，提前选择留出的通道。</span></li><li><b>护栏 / 路障</b><span>撞护栏仅降低约 3 km/h，撞路障约 4 km/h；碰撞不扣耐久，也不会撞坏车辆。</span></li><li><b>${simulation.level.railBreakSpeed || 150} KM/H</b><span>达到此速度后可撞断室外护栏，碎裂缺口会保留。不要从缺口冲进山谷；隧道墙体不会被撞开。</span></li><li><b>SPACE</b><span>第 4 关起限次慢动作，每次最多 2 秒；倒计时照常流逝，桥前减速过多会跳不过去。</span></li><li><b>倒计时</b><span>理想时间加紧缩缓冲。归零前没过终点，车辆爆炸。暂停不扣时间。</span></li></ul><div class="modal-buttons"><button class="primary-button" id="guide-close">开始挑战 <span>→</span></button></div>`);
  $('guide-close').onclick = () => { closeModal(); if (running) resumeRace(); };
}

function showSettings() {
  const previousModal = modalKind;
  const running = !inMenu && ['running', 'countdown'].includes(simulation.state.status);
  const wasPaused = !inMenu && simulation.state.status === 'paused';
  if (running) { simulation.pause(); clearInput(); }
  openModal('settings', `<div class="modal-label">MAKE IT YOUR DRIVE</div><h2 id="modal-title">驾驶设置</h2><label class="settings-row"><span>声音</span><input type="checkbox" id="setting-sound" ${saved.settings.muted ? '' : 'checked'} /></label><label class="settings-row"><span>音量</span><input type="range" min="0" max="1" step="0.05" value="${saved.settings.volume}" id="setting-volume" /></label><label class="settings-row"><span>画面质量</span><select id="setting-quality"><option value="high" ${saved.settings.quality === 'high' ? 'selected' : ''}>清晰</option><option value="low" ${saved.settings.quality === 'low' ? 'selected' : ''}>流畅</option></select></label><label class="settings-row"><span>镜头震动</span><input type="checkbox" id="setting-shake" ${saved.settings.shake ? 'checked' : ''} /></label><div class="modal-buttons"><button id="settings-close" class="primary-button">保存并返回 <span>→</span></button></div>`);
  $('setting-sound').onchange = async (e) => { saved.settings.muted = !e.target.checked; audio.setMuted(saved.settings.muted); if (!saved.settings.muted) await audio.enable(); updateSoundButton(); persist(); };
  $('setting-volume').oninput = (e) => { saved.settings.volume = Number(e.target.value); audio.setVolume(saved.settings.volume); persist(); };
  $('setting-quality').onchange = (e) => { saved.settings.quality = e.target.value; renderer.resize(); persist(); };
  $('setting-shake').onchange = (e) => { saved.settings.shake = e.target.checked; persist(); };
  $('settings-close').onclick = () => { closeModal(); if (running) resumeRace(); else if (wasPaused) pauseRace(); else if (previousModal === 'result') showResult(); };
}

function showResult() {
  const state = simulation.state;
  clearInput();
  $('countdown').classList.add('hidden');
  $('pause-button').classList.add('hidden');
  const win = state.status === 'finished';
  let record = false;
  if (win) {
    record = !saved.best[selectedId] || state.elapsed < saved.best[selectedId];
    if (record) {
      saved.best[selectedId] = state.elapsed;
      saved.records[selectedId] = { elapsed: state.elapsed, seed: simulation.track.runSeed, rulesVersion: 5 };
    }
    if (!saved.completed.includes(selectedId)) saved.completed.push(selectedId);
    persist();
  }
  const failLabels = { timeout: '倒计时归零，车辆爆炸。', cliff: '驶出道路，坠入山谷。撞断护栏后要及时修正方向。', gap: '未能跨过断桥。' };
  const reason = failLabels[state.failCause] || state.failReason || '这次没能驶过终点，再试一次。';
  openModal('result', `<div class="modal-label">${win ? 'ROAD CONQUERED / ' + two(selectedId) : 'THE MOUNTAIN WINS THIS TIME'}</div><h2 id="modal-title">${win ? (selectedId === 9 ? '九条山道，全部征服。' : '驶过终点。') : (state.failCause === 'timeout' ? '时间到了。' : '下一次，走得更远。')}</h2><p>${win ? (record ? '新的个人最佳。' : '稳稳通过，这条山道已有你的车辙。') : reason}</p><div class="result-stats"><div><small>本次用时</small><strong>${timeText(state.elapsed)}</strong></div><div><small>${win ? '剩余时间' : '路线进度'}</small><strong>${win ? timeText(state.remaining) : Math.min(100, state.s / simulation.level.length * 100).toFixed(0) + '%'}</strong></div><div><small>碰撞次数</small><strong>${state.collisions || 0}</strong></div><div><small>撞断护栏</small><strong>${state.brokenRails || 0} 段</strong></div></div><div class="modal-buttons"><button class="primary-button" id="result-primary">${win && selectedId < 9 ? '下一条山道' : '再次出发'} <span>→</span></button><button class="secondary-button" id="result-back">返回选关</button>${win && selectedId < 9 ? '<button class="text-button" id="result-retry">重玩本关</button>' : ''}</div>`);
  $('result-primary').onclick = () => { if (win && selectedId < 9) selectLevel(selectedId + 1); startRace(); };
  $('result-back').onclick = returnMenu;
  if ($('result-retry')) $('result-retry').onclick = startRace;
}

function drawMap() {
  if (!simulation) return;
  const canvas = $('minimap');
  const ctx = canvas.getContext('2d');
  const points = simulation.track.points;
  if (!mapCache || mapCache.track !== simulation.track) {
    const xs = points.map(p => p.x), zs = points.map(p => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
    mapCache = { track: simulation.track, midX: (minX + maxX) / 2, midZ: (minZ + maxZ) / 2, scale: Math.min(150 / Math.max(1, maxX - minX), 120 / Math.max(1, maxZ - minZ)) };
  }
  const px = x => 90 + (x - mapCache.midX) * mapCache.scale;
  const pz = z => 75 + (z - mapCache.midZ) * mapCache.scale;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#7c9a75';
  ctx.beginPath();
  points.forEach((p, i) => { if (!i) ctx.moveTo(px(p.x), pz(p.z)); else ctx.lineTo(px(p.x), pz(p.z)); });
  ctx.stroke();
  const car = simulation.track.sample(simulation.state.s);
  ctx.fillStyle = '#d7f06a';
  ctx.beginPath(); ctx.arc(px(car.x), pz(car.z), 4.5, 0, Math.PI * 2); ctx.fill();
  const finish = points.at(-1);
  ctx.fillStyle = '#fff2dd';
  ctx.fillRect(px(finish.x) - 3, pz(finish.z) - 3, 6, 6);
}

function updateHUD(state) {
  const railBreakSpeed = simulation.level.railBreakSpeed || 150;
  const gaugeMaximum = Math.ceil(Math.sqrt(simulation.level.startSpeed ** 2 + 7.2 * simulation.level.acceleration * simulation.level.length) / 50) * 50;
  $('speed-value').textContent = Math.round(state.speed);
  $('speed-progress').style.width = `${Math.min(100, state.speed / gaugeMaximum * 100)}%`;
  document.querySelector('.speed-gauge').classList.toggle('danger', state.speed >= railBreakSpeed);
  document.querySelector('.speed-rail i').style.left = `${railBreakSpeed / gaugeMaximum * 100}%`;
  $('speed-note').textContent = state.speed >= railBreakSpeed ? '已达破栏速度 · 撞击只轻微减速' : `${railBreakSpeed} KM/H 可撞断护栏`;
  $('distance-value').textContent = (state.s / 1000).toFixed(2);
  $('race-progress').style.width = `${Math.min(100, state.s / simulation.level.length * 100)}%`;
  $('time-value').textContent = timeText(state.remaining);
  $('time-panel').classList.toggle('urgent', state.remaining <= 20);
  $('broken-rails-value').textContent = `${state.brokenRails || 0} 段`;
  $('ability-text').textContent = !simulation.level.charges ? '第 4 关解锁' : state.timeScale < 0.95 ? `慢动作 ${Math.max(0, state.slowRemaining).toFixed(1)}s` : state.slowCooldown > 0 ? `冷却 ${state.slowCooldown.toFixed(1)}s` : state.slowCharges > 0 ? '按住 SPACE 使用' : '次数已耗尽';
  $('ability-charges').querySelectorAll('.charge').forEach((c, i) => c.classList.toggle('empty', i >= state.slowCharges));
  const sample = simulation.track.sample(state.s);
  let warning = state.warning || '';
  const direction = state.travelDirection || 1;
  const gap = simulation.track.gapRanges?.find(g => {
    const distance = direction > 0 ? g.start - state.s : state.s - g.end;
    return distance > 0 && distance < 130;
  });
  const hazard = simulation.track.hazards?.filter(h => !h.hit && (h.s - state.s) * direction > 0
    && Math.abs(h.s - state.s) < Math.max(95, state.speed / 3.6 * 2))
    .sort((a, b) => Math.abs(a.s - state.s) - Math.abs(b.s - state.s))[0];
  if (state.remaining <= 10) warning = '时间即将耗尽 · 尽快驶向终点';
  else if (gap) warning = `前方断桥 ${Math.ceil(direction > 0 ? gap.start - state.s : state.s - gap.end)} m · 保持起跳速度`;
  else if (direction < 0) warning = '正在逆向行驶 · 掉头返回终点方向';
  else if (hazard) warning = `前方路障 ${Math.ceil(Math.abs(hazard.s - state.s))} m · 碰撞仅轻微减速`;
  else if (sample.surface === 'ice') warning = '薄冰路段 · 小幅转向，提前修正';
  else if (state.speed >= railBreakSpeed) warning = '已达破栏速度 · 注意缺口外的落差';
  $('race-warning').textContent = warning;
  $('race-warning').classList.toggle('hidden', !warning || state.status === 'failed' || state.status === 'finished');
  $('countdown').classList.toggle('hidden', state.status !== 'countdown');
  if (state.status === 'countdown') $('countdown-value').textContent = Math.max(1, Math.ceil(state.countdown));
  drawMap();
}

function frame(now) {
  const dt = Math.max(0, (now - lastTime) / 1000);
  lastTime = now;
  const rawSteer = (keys.has('KeyD') || keys.has('ArrowRight') || touch.right ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') || touch.left ? 1 : 0);
  input.steer = steeringInput.update(rawSteer, dt);
  input.slow = keys.has('Space') || touch.slow;
  if (!inMenu) simulation.update(dt, input);
  const state = simulation.state;
  const events = simulation.consumeEvents();
  events.forEach((event) => {
    if (event.type === 'collision') { audio.play('collision'); renderer.triggerEffect('collision', state); showToast(`碰撞轻微减速 · −${Math.round(event.beforeSpeed - event.speed)} km/h`); }
    else if (event.type === 'rail-break') { renderer.triggerEffect('rail-break', event); showToast('护栏已撞断 · 及时修正方向'); }
    else if (event.type === 'explosion') { audio.play('explosion'); renderer.triggerEffect('explosion', state); }
    else if (event.type === 'slow' && event.active) audio.play('slow');
    else if (event.type === 'start') audio.play('start');
    else if (event.type === 'finish') audio.play('finish');
  });
  if (!inMenu && state.status !== lastStatus && ['failed', 'finished'].includes(state.status)) {
    const endedSimulation = simulation;
    const endedStatus = state.status;
    clearInput();
    $('pause-button').classList.add('hidden');
    setTimeout(() => {
      if (!inMenu && simulation === endedSimulation && simulation.state.status === endedStatus) showResult();
    }, endedStatus === 'failed' ? 850 : 350);
  }
  lastStatus = state.status;
  if (!inMenu && state.status === 'running' && state.remaining <= 5 && Math.ceil(state.remaining) !== lastTick) {
    lastTick = Math.ceil(state.remaining); audio.play('tick');
  }
  previewClock += dt;
  const renderState = inMenu ? { ...state, s: 70 + Math.sin(previewClock * 0.1) * 3, status: 'ready', speed: 0, offset: 0, heading: 0, timeScale: 1 } : state;
  renderer.render(renderState, dt, { menu: inMenu, quality: saved.settings.quality, shake: saved.settings.shake });
  audio.update(inMenu ? { ...state, status: 'ready' } : state, dt);
  $('slow-overlay').style.opacity = !inMenu && state.timeScale < 0.95 && state.status === 'running' ? '1' : '0';
  $('hit-overlay').style.opacity = !inMenu ? String(Math.min(0.8, Math.max(0, state.hitFlash || 0))) : '0';
  if (now - lastUI > 80 && !inMenu) { updateHUD(state); lastUI = now; }
  requestAnimationFrame(frame);
}

function bindTouch(id, property) {
  const element = $(id);
  element.addEventListener('pointerdown', (e) => { e.preventDefault(); element.setPointerCapture(e.pointerId); touch[property] = true; });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((event) => element.addEventListener(event, () => { touch[property] = false; }));
}

document.addEventListener('keydown', (e) => {
  if (e.code === 'Tab' && modalKind) {
    const focusable = [...$('modal-content').querySelectorAll('button,input,select')].filter((el) => !el.disabled);
    const first = focusable[0], last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code) && !['INPUT', 'SELECT'].includes(e.target.tagName)) e.preventDefault();
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) keys.add(e.code);
  if (e.repeat || ['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  if (e.code === 'Escape') { if (modalKind === 'pause') resumeRace(); else if (modalKind === 'guide' && inMenu) closeModal(); else if (!modalKind && !inMenu) pauseRace(); }
  if (e.code === 'KeyR' && !inMenu && modalKind !== 'settings') startRace();
  if (e.code === 'Enter' && inMenu && !modalKind && e.target.tagName !== 'BUTTON') startRace();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('visibilitychange', () => { if (document.hidden && !inMenu && ['running', 'countdown'].includes(simulation.state.status)) pauseRace(); });
window.addEventListener('blur', () => { clearInput(); if (!inMenu && ['running', 'countdown'].includes(simulation.state.status)) pauseRace(); });
window.addEventListener('resize', () => renderer?.resize());
$('start-button').onclick = startRace;
$('home-button').onclick = () => { if (!inMenu) returnMenu(); };
$('guide-button').onclick = showGuide;
$('pause-button').onclick = pauseRace;
$('settings-button').onclick = showSettings;
$('sound-button').onclick = async () => {
  saved.settings.muted = !saved.settings.muted;
  audio.setMuted(saved.settings.muted);
  if (!saved.settings.muted) {
    const enabled = await audio.enable();
    if (enabled === false) showToast('声音暂不可用，仍可继续驾驶');
  }
  updateSoundButton(); persist();
};
bindTouch('touch-left', 'left'); bindTouch('touch-right', 'right'); bindTouch('touch-slow', 'slow');

try {
  renderer = new MountainRenderer($('scene'), { quality: saved.settings.quality });
  selectLevel(1);
  updateSoundButton();
  $('loading').classList.add('hidden');
  requestAnimationFrame(frame);
} catch (error) {
  console.error(error);
  $('loading').innerHTML = '<span class="loading-mark">N / B</span><strong>三维场景未能启动</strong><small>请使用支持 WebGL 的浏览器，并开启硬件加速。</small>';
}

// Local diagnostics entry, separate from the gameplay controls.
Object.defineProperty(window, '__mountainGame', { get: () => ({ state: simulation?.state, level: simulation?.level, track: simulation?.track, renderer, simulation }) });
