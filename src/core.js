import { LEVELS, createTrack } from './levels.js';
import { railIntact, breakRail } from './rails.js';
import { steeringRate } from './controls.js';
export { steeringRate } from './controls.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const STEP = 1 / 120;
const CAR_HALF_WIDTH = 1.05;
const NORMAL_HIT_SPEED = 3 / 3.6;
const wrapAngle = value => Math.atan2(Math.sin(value), Math.cos(value));

export class GameSimulation {
  constructor(levelId = 1, options = {}) {
    this.level = LEVELS.find(level => level.id === levelId);
    if (!this.level) throw new RangeError('Unknown level');
    this.options = { ...options };
    this._reset();
  }

  _reset() {
    this.track = createTrack(this.level, this.options);
    this.state = {
      status: 'ready', s: 0, speed: this.level.startSpeed, offset: 0,
      heading: 0, y: 0, elapsed: 0, remaining: this.level.timeLimit,
      durability: 100, brokenRails: 0, travelDirection: 1, slowCharges: this.level.charges, timeScale: 1,
      slowRemaining: 0, slowCooldown: 0, hitFlash: 0, failReason: '', failCause: '',
      warning: '', countdown: 3, collisions: 0,
      railBreakSpeed: this.level.railBreakSpeed, runSeed: this.track.runSeed,
    };
    this._events = [];
    this._slowHeld = false;
    this._slowActive = false;
    this._slowAge = 0;
    this._slowEnd = 2;
    this._contact = null;
    this._contactRelease = 0;
    this._yawRate = 0;
    this._air = null;
    this._resumeStatus = 'running';
  }

  start() {
    if (this.state.status === 'ready') this.state.status = 'countdown';
    return this;
  }

  restart() {
    this._reset();
    return this.start();
  }

  pause() {
    if (['running', 'countdown'].includes(this.state.status)) {
      this._resumeStatus = this.state.status;
      this.state.status = 'paused';
    }
  }

  resume() {
    if (this.state.status === 'paused') this.state.status = this._resumeStatus;
  }

  consumeEvents() {
    const result = this._events;
    this._events = [];
    return result;
  }

  update(realDt, input = {}) {
    if (!Number.isFinite(realDt) || realDt < 0) return this.state;
    const controls = { steer: clamp(Number(input.steer) || 0, -1, 1), slow: Boolean(input.slow) };
    if (this.state.status === 'paused') {
      // Menu input never queues a new activation, but releasing an active hold
      // is remembered and processed when driving resumes.
      this._slowHeld = controls.slow;
      return this.state;
    }
    let remaining = realDt;
    while (remaining > 1e-10 && ['countdown', 'running'].includes(this.state.status)) {
      const dt = Math.min(STEP, remaining);
      this._step(dt, controls);
      remaining -= dt;
    }
    return this.state;
  }

  _step(dt, input) {
    const state = this.state;
    if (state.status === 'countdown') {
      if (state.countdown > dt + 1e-9) {
        state.countdown -= dt;
        this._slowHeld = input.slow;
        return;
      }
      dt = Math.max(0, dt - state.countdown);
      state.countdown = 0;
      state.status = 'running';
      this._events.push({ type: 'start', levelId: this.level.id });
      if (dt < 1e-10) return;
    }
    dt = Math.min(dt, Math.max(0, this.level.timeLimit - state.elapsed));
    if (dt <= 1e-10) {
      this._fail('超时爆炸', 'timeout');
      return;
    }
    const scale = this._updateSlow(dt, input.slow);
    state.hitFlash = Math.max(0, state.hitFlash - dt * 2.5);
    const finishFraction = this._drive(dt * scale, input.steer);
    const used = finishFraction === null ? dt : dt * finishFraction;
    state.elapsed += used;
    state.remaining = Math.max(0, this.level.timeLimit - state.elapsed);
    if (finishFraction !== null && state.status === 'running') this._finish();
    else if (state.status === 'running' && state.remaining < 1e-9) this._fail('超时爆炸', 'timeout');
    state.warning = state.remaining <= 10 ? '时间即将耗尽'
      : state.travelDirection < 0 ? '正在逆向行驶 · 掉头返回终点方向'
        : state.speed >= state.railBreakSpeed ? '可撞断护栏 · 注意外侧落差' : '';
  }

  _updateSlow(dt, held) {
    const state = this.state;
    const rising = held && !this._slowHeld;
    this._slowHeld = held;
    if (!this._slowActive) state.slowCooldown = Math.max(0, state.slowCooldown - dt);
    if (rising && !this._slowActive && state.slowCooldown <= 0 && state.slowCharges > 0) {
      state.slowCharges -= 1;
      this._slowActive = true;
      this._slowAge = 0;
      this._slowEnd = 2;
      this._events.push({ type: 'slow', active: true });
    }
    if (!this._slowActive) {
      state.timeScale = 1;
      state.slowRemaining = 0;
      return 1;
    }
    if (!held) this._slowEnd = Math.min(this._slowEnd, this._slowAge + 0.12);
    const mid = this._slowAge + dt * 0.5;
    const strength = clamp(Math.min(mid / 0.12, (this._slowEnd - mid) / 0.12), 0, 1);
    const scale = 1 - 0.65 * strength;
    this._slowAge += dt;
    state.timeScale = scale;
    state.slowRemaining = Math.max(0, this._slowEnd - this._slowAge);
    if (this._slowAge >= this._slowEnd - 1e-9) {
      this._slowActive = false;
      state.slowRemaining = 0;
      state.timeScale = 1;
      state.slowCooldown = 1;
      this._events.push({ type: 'slow', active: false });
    }
    return scale;
  }

  _drive(dt, steer) {
    const state = this.state;
    const previousS = state.s;
    const previousOffset = state.offset;
    state.steering = steer;
    const road = this.track.sample(previousS);
    state.speed += this.level.acceleration * dt;
    const direction = Math.cos(state.heading) < 0 ? -1 : 1;
    this.track.hazardStream?.update(previousS, state.speed, direction);
    const speed = (this._air ? this._air.speed : state.speed) / 3.6;
    if (!this._air) {
      const desired = steer * steeringRate(state.speed, road.surface);
      const response = road.surface === 'ice' ? 3.6 : road.surface === 'snow' ? 5 : 8;
      this._yawRate += (desired - this._yawRate) * (1 - Math.exp(-response * dt));
      state.heading += this._yawRate * dt;
    }
    state.heading = wrapAngle(state.heading);
    const ds = speed * Math.cos(state.heading) * dt
      / Math.max(0.7, 1 - road.curvature * state.offset);
    state.s = clamp(previousS + ds, 0, this.level.length);
    state.offset += speed * Math.sin(state.heading) * dt;
    const nextRoad = this.track.sample(state.s);
    state.heading = wrapAngle(state.heading - (nextRoad.yaw - road.yaw));
    state.travelDirection = Math.cos(state.heading) < 0 ? -1 : 1;

    for (const gap of this.track.gapRanges) {
      const launchForward = ds > 0 && previousS < gap.start && state.s >= gap.start;
      const launchBackward = ds < 0 && previousS > gap.end && state.s <= gap.end;
      if (!this._air && (launchForward || launchBackward)) {
        const lip = launchForward ? gap.start : gap.end;
        const beforeLip = this.track.sample(Math.max(0, lip - 1));
        const afterLip = this.track.sample(Math.min(this.track.length, lip + 1));
        const slope = (afterLip.y - beforeLip.y) / (afterLip.s - beforeLip.s);
        this._air = { worldY: this.track.sample(lip).y + 0.03,
          vy: 4.3 + slope * state.speed / 3.6 * Math.cos(state.heading), speed: state.speed };
      }
    }
    if (this._air) {
      this._air.worldY += this._air.vy * dt - 4.905 * dt * dt;
      this._air.vy -= 9.81 * dt;
      state.y = this._air.worldY - nextRoad.y;
      if (state.y <= 0 && this._air.vy < 0) {
        if (nextRoad.gap || Math.abs(state.offset) > nextRoad.width * 0.5 - 0.15) {
          this._fail('错过断桥落点', 'gap');
          return null;
        }
        this._air = null;
        state.y = 0;
      }
    } else state.y = 0;

    // Include car length when sideways, so a U-turn must actually fit the road.
    const halfExtent = Math.abs(Math.cos(state.heading)) * CAR_HALF_WIDTH
      + Math.abs(Math.sin(state.heading)) * 1.95;
    const limit = nextRoad.width * 0.5 - halfExtent;
    const side = state.offset >= 0 ? 'right' : 'left';
    let intact = railIntact(this.track, nextRoad, side);
    const touching = !this._air && intact && (Math.abs(state.offset) >= limit
      || (this._contact === side && Math.abs(state.offset) >= limit - 0.035));
    if (!this._air && Math.abs(state.offset) > limit && intact) {
      const normalSpeed = state.speed / 3.6 * Math.abs(Math.sin(state.heading));
      const effective = (this._contact !== side || (!nextRoad.tunnel && state.speed >= state.railBreakSpeed))
        && normalSpeed >= NORMAL_HIT_SPEED;
      if (effective) {
        const broken = !nextRoad.tunnel && state.speed >= state.railBreakSpeed;
        this._hit('rail', 3);
        if (broken) {
          const sections = breakRail(this.track, side, state.s);
          state.brokenRails = this.track.brokenRails.size;
          this._events.push({ type: 'rail-break', side, sections, s: state.s,
            offset: (side === 'right' ? 1 : -1) * (nextRoad.width * 0.5 + 0.13) });
          intact = false;
          this._contact = null;
        }
      }
      if (intact) {
        state.offset = (side === 'right' ? 1 : -1) * limit;
        if ((side === 'right' && Math.sin(state.heading) > 0)
          || (side === 'left' && Math.sin(state.heading) < 0)) {
          // Preserve reverse travel instead of snapping every impact forward.
          state.heading = Math.cos(state.heading) < 0 ? Math.PI : 0;
          this._yawRate = 0;
        }
      }
    }
    if (!this._air && !intact) {
      const margin = nextRoad.bridge ? 0.7 : nextRoad.cliff ? 1.5 : 4;
      if (Math.abs(state.offset) > nextRoad.width * 0.5 + margin) {
        this._fail('驶出道路，坠入山谷', 'cliff');
        return null;
      }
    }
    if (touching && intact) {
      this._contact = side;
      this._contactRelease = 0;
    } else if (this._contact !== null) {
      this._contactRelease += dt;
      if (this._contactRelease >= 0.2) {
        this._contact = null;
        this._contactRelease = 0;
      }
    }

    if (!this._air) for (const hazard of this.track.hazards) {
      if (hazard.hit || hazard.s < Math.min(previousS, state.s) - 2
        || hazard.s > Math.max(previousS, state.s) + 2) continue;
      const fraction = clamp((hazard.s - previousS) / (state.s - previousS || 1), 0, 1);
      const offset = previousOffset + (state.offset - previousOffset) * fraction;
      const collisionRadius = halfExtent + (hazard.radius ?? (hazard.type === 'rock' ? 0.64 : 0.42));
      if (Math.abs(offset - hazard.offset) > collisionRadius) continue;
      hazard.hit = true;
      this._hit(hazard.type, 4, hazard.id);
    }

    if (ds > 0 && state.s >= this.level.length) {
      return clamp((this.level.length - previousS) / ds, 0, 1);
    }
    return null;
  }

  _hit(kind, speedLoss, hazardId = null) {
    const state = this.state;
    const beforeSpeed = state.speed;
    state.collisions += 1;
    state.speed = Math.max(25, beforeSpeed - speedLoss);
    state.hitFlash = 0.3;
    this._events.push({ type: 'collision', kind, hazardId, beforeSpeed,
      speed: state.speed, damage: 0, s: state.s, offset: state.offset });
    return true;
  }

  _clearSlow() {
    this._slowActive = false;
    this.state.timeScale = 1;
    this.state.slowRemaining = 0;
    this.state.slowCooldown = 0;
  }

  _fail(reason, cause) {
    if (this.state.status !== 'running') return;
    this.state.status = 'failed';
    this.state.failReason = reason;
    this.state.failCause = cause;
    this._clearSlow();
    this._events.push({ type: 'explosion', cause, reason, s: this.state.s, offset: this.state.offset });
  }

  _finish() {
    this.state.status = 'finished';
    this._clearSlow();
    this._events.push({ type: 'finish', levelId: this.level.id, elapsed: this.state.elapsed,
      remaining: this.state.remaining, durability: this.state.durability });
  }
}
