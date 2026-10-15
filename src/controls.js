const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Keyboard/touch steering: small taps, progressively stronger held turns. */
export class SteeringInput {
  constructor() { this.reset(); }

  reset() { this.value = 0; this.age = 0; this.direction = 0; }

  update(raw, dt) {
    const direction = Math.sign(raw);
    dt = clamp(Number(dt) || 0, 0, 0.1);
    if (direction !== this.direction) {
      this.age = 0;
      if (direction && this.direction) this.value = 0;
      this.direction = direction;
    }
    this.age = direction ? this.age + dt : 0;
    const t = clamp((this.age - 0.06) / 0.42, 0, 1);
    const strength = 0.23 + 0.77 * t * t * (3 - 2 * t);
    const target = direction * strength;
    this.value += (target - this.value) * (1 - Math.exp(-(direction ? 18 : 28) * dt));
    if (!direction && Math.abs(this.value) < 0.001) this.value = 0;
    return this.value;
  }
}

const SURFACE_GRIP = { dry: 1, wet: 0.90, snow: 0.84, ice: 0.76 };

// Shared by physical steering and the hazard generator's correction allowance.
export function steeringRate(speed, surface = 'dry') {
  return 4.60 * (SURFACE_GRIP[surface] ?? 1) / (1 + speed / 820);
}
