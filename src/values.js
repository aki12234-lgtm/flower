// The hidden value system.
//
// Six values, each in 0..1, all starting at 0.5. They are never shown to the
// player. No single answer moves one value far; the point is that the *sequence*
// accumulates into something with its own tendencies.
//
// Internally each value is an unbounded accumulator `z`, mapped to 0..1 through
// an algebraic sigmoid. That gives us three properties we want:
//   - near the middle, an authored effect of 0.14 moves the value by ~0.11
//   - the edges are asymptotic: reachable, never cheap, never pinned
//   - a per-turn pull back towards the middle means extremes have to be
//     maintained by continued answers, not just touched once
//
// Two things keep this from being a personality quiz:
//   1. every response touches several values, and rarely the "obvious" one
//   2. derived quantities (volatility, reversal, pressure, tension) matter as
//      much as the raw values, so two players who end at the same six numbers by
//      different routes still grow different organisms

import { clamp, clamp01, lerp } from './rng.js';

export const VALUE_KEYS = ['expansion', 'stability', 'openness', 'attachment', 'intensity', 'order'];

const GAIN = 2.0;    // authored effect units -> accumulator units
const DRIFT = 0.05;  // fraction of the accumulator released each turn (~13 turn half-life)
const RECENT = 4;

const toZ = (v) => { const u = clamp((v - 0.5) * 2, -0.9995, 0.9995); return u / (1 - Math.abs(u)); };
const fromZ = (z) => 0.5 + (z / (1 + Math.abs(z))) / 2;

export class ValueState {
  constructor(initial) {
    this.z = {};
    for (const k of VALUE_KEYS) this.z[k] = toZ(initial?.[k] ?? 0.5);
    this.values = {};
    this._sync();
    this.momentum = {};
    for (const k of VALUE_KEYS) this.momentum[k] = 0;
    this.log = [{ ...this.values }];
    this.deltaLog = []; // { applied, requested }
  }

  static fromJSON(data) {
    const vs = new ValueState();
    vs.z = { ...data.z };
    vs._sync();
    vs.momentum = { ...data.momentum };
    vs.log = data.log.map((v) => ({ ...v }));
    vs.deltaLog = data.deltaLog.map((d) => ({ applied: { ...d.applied }, requested: { ...d.requested } }));
    return vs;
  }

  toJSON() {
    return { z: this.z, momentum: this.momentum, log: this.log, deltaLog: this.deltaLog };
  }

  _sync() { for (const k of VALUE_KEYS) this.values[k] = fromZ(this.z[k]); }

  get(k) { return this.values[k]; }

  /** Apply one turn's worth of effects. `effects` is { key: delta }. */
  apply(effects) {
    const applied = {};
    const requested = {};
    for (const k of VALUE_KEYS) {
      const want = effects[k] || 0;
      const before = this.values[k];
      this.z[k] = this.z[k] * (1 - DRIFT) + want * GAIN;
      this.values[k] = fromZ(this.z[k]);
      applied[k] = this.values[k] - before;
      requested[k] = want;
      this.momentum[k] = this.momentum[k] * 0.62 + applied[k] * 0.38;
    }
    this.deltaLog.push({ applied, requested });
    this.log.push({ ...this.values });
    return applied;
  }

  /** Second-order read of the value history. This is where character comes from. */
  derived() {
    const v = this.values;
    const recent = this.deltaLog.slice(-RECENT);
    const n = Math.max(1, recent.length);

    let churn = 0;
    let push = 0;
    for (const d of recent) {
      for (const k of VALUE_KEYS) {
        churn += Math.abs(d.applied[k]);
        push += Math.abs(d.requested[k]);
      }
    }
    // How much the state actually moved, vs how hard the answers pushed.
    const volatility = clamp01(churn / n / 0.30);
    const pressure = clamp01(push / n / 0.34);

    // Direction changes: answering against yourself, turn after turn.
    let flips = 0;
    let pairs = 0;
    for (let i = 1; i < recent.length; i++) {
      for (const k of VALUE_KEYS) {
        const a = recent[i - 1].requested[k];
        const b = recent[i].requested[k];
        if (Math.abs(a) < 0.02 || Math.abs(b) < 0.02) continue;
        pairs++;
        if (a * b < 0) flips++;
      }
    }
    const reversal = pairs ? flips / pairs : 0;

    let ext = 0;
    for (const k of VALUE_KEYS) ext += Math.abs(v[k] - 0.5) * 2;
    const extremity = clamp01(ext / VALUE_KEYS.length);

    // Consecutive turns ending with something out at the edge.
    let held = 0;
    for (let i = this.log.length - 1; i >= 0; i--) {
      let anyEdge = false;
      for (const k of VALUE_KEYS) if (Math.abs(this.log[i][k] - 0.5) > 0.24) { anyEdge = true; break; }
      if (!anyEdge) break;
      held++;
    }

    let dominant = VALUE_KEYS[0];
    for (const k of VALUE_KEYS) {
      if (Math.abs(v[k] - 0.5) > Math.abs(v[dominant] - 0.5)) dominant = k;
    }

    return {
      volatility,
      pressure,
      reversal,
      extremity,
      heldAtEdge: held,
      dominant,
      dominantStrength: Math.abs(v[dominant] - 0.5) * 2,
      // Opposed pairs. High tension means the plant is pulled two ways at once.
      tensionGrowth: Math.abs(v.expansion - v.stability),
      tensionBond: Math.abs(v.openness - v.attachment),
      tensionForm: Math.abs(v.intensity - v.order),
      turn: this.deltaLog.length,
    };
  }
}

/**
 * Resolve a prompt option's effect table into concrete deltas.
 * Fixed tables are objects of numbers. Continuous responses (slider, action)
 * use [atZero, atOne] pairs interpolated by the measured value t.
 */
export function resolveEffects(table, t = 0) {
  const out = {};
  for (const k of VALUE_KEYS) {
    const e = table?.[k];
    if (e === undefined) continue;
    out[k] = Array.isArray(e) ? lerp(e[0], e[1], t) : e;
  }
  return out;
}
