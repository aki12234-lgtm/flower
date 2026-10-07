// Vitality.
//
// The rule the whole system is built around: no single answer can kill the
// plant. Damage is capped per turn (MAX_DAMAGE), so collapse takes at least ten
// consecutive turns of accumulated strain, and any of them can be walked back.
//
// Stress comes from what the organism has *become*, not from what was chosen:
//   overload  - more mass than the base laid down early can carry
//   topple    - that mass hanging out to one side
//   sprawl    - too many growing tips for the structure supporting them
//   churn     - the internal state changing violently, turn after turn
//   fixation  - one value held at an extreme for a long time
//
// The player is never shown any of this. They see the plant.

import { clamp01 } from './rng.js';

export const TUNING = {
  MAX_DAMAGE: 0.105,   // per turn. 1.0 / 0.105 => at least 10 turns to die.
  RECOVERY: 0.062,     // per turn when nothing is straining the plant
  HEAL_CEILING: 0.42,  // load above which no healing happens at all
  DEATH_GRACE: 2,      // turns at zero before it is actually over
  // Thresholds. Each is the ratio at which that strain starts to count at all;
  // it reaches full weight at twice the value. Set from the distributions
  // printed by `node tools/tune.js`, not by feel.
  K_OVERLOAD: 6.2,     // mass carried per unit of base strength
  K_TOPPLE: 6.8,       // centre of mass offset per unit of base width
  K_CHURN: 0.50,       // volatility above which constant reversal costs something
  ENABLED: true,       // tools/tune.js turns this off to see structure alone
};

export const CONDITIONS = ['healthy', 'strained', 'wilting', 'failing', 'dead'];

export function createVitality() {
  return { stress: 0, vitality: 1, condition: 'healthy', zeroTurns: 0, lastInputs: null, dead: false };
}

export function conditionFor(vitality, dead) {
  if (dead) return 'dead';
  if (vitality > 0.72) return 'healthy';
  if (vitality > 0.45) return 'strained';
  if (vitality > 0.15) return 'wilting';
  return 'failing';
}

/**
 * Advance vitality one turn.
 * @param {object} vit    vitality state (mutated)
 * @param {object} struct measureStructure() output
 * @param {object} derived value system derived metrics
 */
export function stepVitality(vit, struct, derived) {
  const T = TUNING;

  // Each strain is a ratio, zeroed at its threshold and full at twice it.
  const ramp = (ratio, k) => clamp01(ratio / k - 1);

  const overload = ramp(struct.mass / Math.max(1, struct.strength), T.K_OVERLOAD);

  // Lean, not size: how far the centre of mass sits off the axis relative to
  // the width of the base. A tall straight plant scores low here however big
  // it gets; a lopsided one scores high even when small.
  const topple = ramp(struct.comX / struct.baseWidth, T.K_TOPPLE);

  // A thin plant cannot feed many tips at once. The constant term keeps a
  // seedling from reading as overextended simply because its base is new.
  const sustainable = 1.2 + struct.baseWidth * 0.13;
  const sprawl = clamp01((struct.tipCount - sustainable) / 4.5);

  // Reversal separates "answering against yourself" from merely moving a lot.
  const churn = ramp(derived.volatility * 0.55 + derived.reversal * 0.75, T.K_CHURN);
  const fixation = clamp01((derived.heldAtEdge - 2) / 8) * derived.extremity;

  const load =
    overload * 0.40 +
    topple * 0.34 +
    sprawl * 0.16 +
    churn * 0.34 +
    fixation * 0.20;

  const inputs = { overload, topple, sprawl, churn, fixation, load };
  if (!T.ENABLED) { vit.lastInputs = inputs; return inputs; }

  // Damage and healing both apply every turn, so there is an equilibrium load
  // rather than a cliff. A previous version only healed below a fixed load,
  // which meant a plant that had reduced its strain but not eliminated it could
  // never get better, however long the player spent putting it right.
  const damage = Math.min(T.MAX_DAMAGE, load * T.MAX_DAMAGE * 1.35);
  const heal = T.RECOVERY * clamp01(1 - load / T.HEAL_CEILING);
  vit.stress = clamp01(vit.stress + damage - heal);

  vit.vitality = clamp01(1 - vit.stress);
  if (vit.vitality <= 0.02) vit.zeroTurns++;
  else vit.zeroTurns = 0;
  if (vit.zeroTurns >= T.DEATH_GRACE) vit.dead = true;

  vit.condition = conditionFor(vit.vitality, vit.dead);
  vit.lastInputs = inputs;
  return inputs;
}

/**
 * A short, non-diagnostic line for the moment the plant's condition changes.
 * Deliberately describes, never explains, and never says what to do about it.
 */
export function conditionNote(from, to) {
  if (from === to) return null;
  const notes = {
    strained: 'Something in it is holding more than it was built to hold.',
    wilting: 'It is turning away from the light.',
    failing: 'It has stopped reaching.',
    dead: 'It has stopped.',
    healthy: from === 'healthy' ? null : 'It is carrying itself again.',
  };
  return notes[to] ?? null;
}
