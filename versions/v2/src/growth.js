// Procedural growth.
//
// This module owns *geometry only*. It knows nothing about how a section will
// be drawn. Materials render whatever shape arrives, which is what lets a wool
// section and a wireframe section sit on the same organism without either
// system knowing about the other.
//
// World space: +y is up, origin (0,0) is Point 0 at ground level.
// Headings: 0 = straight up, positive rotates towards +x.
//
// All tips advance one micro-step together, breadth-first. That means a
// section's micro-step index doubles as its growth animation clock: the whole
// new part of the organism pushes outward at once instead of one strand
// finishing before the next begins.

import { clamp, clamp01, lerp } from './rng.js';

const TAU = Math.PI * 2;
const angNorm = (a) => { let x = (a + Math.PI) % TAU; if (x < 0) x += TAU; return x - Math.PI; };

// Bloom types, not foliage types. Each is a different flower head, and a plant
// carries several kinds at once: the reference is hybrid botanical construction,
// separate species joined into one body.
export const NODE_KINDS = [
  // flowers and fruit
  'disc', 'cup', 'bell', 'globe', 'spike', 'umbel', 'star', 'pod',
  'spider', 'burr', 'button', 'trumpet', 'pom',
  'lily', 'pansy', 'allium', 'drumstick', 'cactus',
  // foliage
  'leaf', 'frond', 'needle', 'fan', 'heart', 'lobed', 'strap', 'trefoil',
  'saw', 'arrow',
];

// ------------------------------------------------------------- directions --
//
// Growth only ever travels along one of eight directions: 0, 45 and 90 degrees
// and their mirrors. A tip holds a direction for a run of steps and then turns
// by a quarter or a half of a right angle, so a stem is a sequence of straight
// runs meeting at hard corners rather than a smooth curve.

const STEP_ANGLE = Math.PI / 4;
/** index 0 = up, increasing clockwise towards +x. */
export const DIRS = Array.from({ length: 8 }, (_, i) => ({
  x: Math.sin(i * STEP_ANGLE),
  y: Math.cos(i * STEP_ANGLE),
  angle: i * STEP_ANGLE,
}));
// exact values, so a 45 degree run is exactly 45 degrees
for (const d of DIRS) {
  d.x = Math.abs(d.x) < 1e-9 ? 0 : d.x;
  d.y = Math.abs(d.y) < 1e-9 ? 0 : d.y;
}

const dirOfAngle = (a) => ((Math.round(a / STEP_ANGLE) % 8) + 8) % 8;
/** shortest number of 45 degree steps between two directions */
const dirGap = (a, b) => {
  const d = ((a - b) % 8 + 8) % 8;
  return Math.min(d, 8 - d);
};
/** 0 when the direction is straight up, 1 when it is straight down */
const downness = (d) => (1 - DIRS[d].y) / 2;

const TURNS = [-2, -1, 0, 1, 2];

/** Where the floor is. Point zero, the same place the seed starts from. */
const GROUND = 0;

/**
 * Pick the next direction for a tip.
 * Everything that used to nudge a floating-point heading now weights a discrete
 * choice instead: inertia keeps a run going, steer pulls back towards where the
 * tip wants to be, winding makes a tip keep turning the same way (which is what
 * produces boxed-in spirals), and sag makes unwell growth prefer downhill.
 */
/**
 * Where the tip goes next.
 *
 * Two things are forbidden outright rather than merely made unlikely, because
 * both of them read as a mistake however rarely they happen:
 *
 * A run may not point back the way the last one came. A single turn is capped
 * at ninety degrees so it cannot doubl e back in one move, but two turns the same
 * way could, and a member that retraces its own path is not a plant growing, it
 * is a plant undoing itself.
 *
 * And it may not step onto ground the plant already occupies. Growth is on a
 * lattice with a fixed step, so every point sits on a grid and "is this cell
 * taken" is a lookup, not a geometry problem. Members crossing through one
 * another was the single clearest sign the thing was drawn rather than built.
 */
function chooseDirection(tip, params, rng, target, occupied, stepLen, tidy = true) {
  const back = tip.prevDir === undefined ? -1 : (tip.prevDir + 4) % 8;
  const turn = rng.weighted(TURNS, (t) => {
    const nd = ((tip.dir + t) % 8 + 8) % 8;
    if (nd === back) return 1e-9;
    if (occupied && cellTaken(occupied, tip, nd, stepLen, tidy)) return 1e-9;
    let w = Math.exp(-Math.abs(t) * params.inertia);
    w *= Math.exp(-dirGap(nd, target) * params.steerW);
    if (t !== 0 && Math.sign(t) === tip.torqueSign) w *= 1 + params.winding * 5;
    if (params.droop > 0.02) w *= 1 + params.droop * downness(nd) * 2.4;
    return Math.max(1e-4, w);
  });
  return ((tip.dir + turn) % 8 + 8) % 8;
}

/**
 * The occupancy grid, in world units and the same for every section.
 *
 * Sizing a cell from the section's own step length seemed natural and was
 * wrong: step length varies with the values, so each section laid down a grid
 * that did not line up with the last one and members from different turns
 * passed straight through each other regardless. One fixed size, a little wider
 * than a stem, keeps every section talking about the same squares.
 */
// Twelve measured best across a sweep. Finer grids blocked more and overlapped
// *more*, not less: heavy blocking diverts tips into worse configurations than
// it prevents.
const CELL = 12;
const cellKey = (x, y) => `${Math.round(x / CELL)},${Math.round(y / CELL)}`;

/** The cells within a small radius of a point — used to free a new joint. */
function markDisc(set, x, y, r) {
  const n = Math.ceil(r / CELL);
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      if (Math.hypot(i, j) * CELL <= r) set.add(cellKey(x + i * CELL, y + j * CELL));
    }
  }
}

/**
 * Mark every cell a step passes through, to the thickness of the member.
 *
 * Marking the centreline alone left the commonest overlap untouched: two
 * members running parallel a cell apart have their centres in different squares
 * and their bodies in the same space. A member takes up the room it actually
 * takes up.
 */
function markPath(occupied, x0, y0, x1, y1, w = 0) {
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL * 0.6)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (w > CELL * 0.5) markDisc(occupied, x, y, w * 0.5);
    else occupied.add(cellKey(x, y));
  }
}

/**
 * Would a step in this direction cross ground some *other* member stands in?
 *
 * A member touches itself along its whole length, so a tip has to be blind to
 * its own trail or a straight run blocks itself on its own previous step the
 * moment rounding puts the next sample back in the same square — which stopped
 * plants dead after a handful of points. Excluding the couple of cells nearest
 * the tip instead was too permissive the other way, and let members pass
 * through each other again. A tip keeps its own trail and ignores exactly that.
 */
function cellTaken(occupied, tip, dir, stepLen, allowed = true) {
  if (!allowed) return false;
  const x1 = tip.x + DIRS[dir].x * stepLen;
  const y1 = tip.y + DIRS[dir].y * stepLen;
  const n = Math.max(1, Math.ceil(stepLen / (CELL * 0.6)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const k = cellKey(tip.x + (x1 - tip.x) * t, tip.y + (y1 - tip.y) * t);
    if (tip.trail && tip.trail.has(k)) continue;
    if (occupied.has(k)) return true;
  }
  return false;
}

/**
 * Translate the hidden values into growth behaviour.
 *
 * Nothing here is a one-to-one metaphor. Expansion is not "up", openness is not
 * "wide" on its own, and vitality quietly scales most of it.
 */
export function growthParams(values, derived, vitality, struct = null) {
  const { expansion: E, stability: S, openness: O, attachment: A, intensity: I, order: R } = values;
  const health = clamp01(vitality);

  // Reaction wood. A plant that has been carrying its weight off to one side
  // lays down extra timber at the base to hold it. Without this a plant that
  // ever leaned could never recover: the centre of mass is a fact about the
  // whole history, and new growth is too small a share of it to move the
  // number. With it, staying still and not making things worse is a real way
  // back — it just takes a while, and the mass keeps mounting meanwhile.
  const lean = struct ? struct.comX / struct.baseWidth : 0;
  const reaction = clamp01((lean - 2.5) / 6);

  // In practice the values live between roughly 0.25 and 0.75 — the drift in
  // values.js makes the far edges expensive — so every coefficient here is
  // scaled to produce a visible difference across *that* range, not across a
  // theoretical 0..1.
  // The armature is meant to be sparse: a handful of long, deliberate members
  // carrying a few large blooms, not a thicket. An earlier version produced 83
  // segments and 514 leaves after sixteen answers, which read as a hedge rather
  // than as a constructed thing.
  return {
    // how far this turn's growth reaches, before vitality is taken into account
    reach: (46 + E * 122 + I * 24) * (0.42 + health * 0.58),
    // few steps, so each one is long
    steps: Math.round(3 + E * 3 + I * 2),
    // how strongly a tip is pulled back towards the direction it wants
    steerW: 0.95 + R * 1.6 + S * 0.40,
    // how reluctant it is to turn at all once it is running
    inertia: 0.72 + R * 1.6,
    // steps in a straight run before the next corner
    runLength: lerp(5.5, 2.5, clamp01(0.04 + (1 - R) * 0.55 + I * 0.22)),
    // how irregular those runs are
    runJitter: clamp01((1 - R) * 0.7),
    // persistent winding. Intensity without order is what boxes a stem into a spiral.
    winding: I * (1 - R) * 0.40,
    // sideways lean away from vertical. Never negative: low openness means
    // "does not spread", not "spreads the other way".
    lateral: Math.max(0, (O - 0.32) * 2.3 - A * 0.75),
    // how much a tip is drawn back over the body of the plant
    homing: clamp01(A * 1.6 - O * 0.7),
    droop: clamp01((1 - health) * 1.3 + (1 - S) * 0.25 - 0.14),
    // Spare, not thicketed.
    //
    // Twenty answers were producing around sixty members carrying thirty parts,
    // all fighting for the same space — which is a hedge. The reference is an
    // armature: a few clean runs with a great deal of nothing around them, and
    // every part on it visible as a part. Branching and the number of live tips
    // are what set that, and both were roughly twice what they should be.
    branchP: clamp01(E * 0.34 + O * 0.18 - R * 0.14 + I * 0.07),
    spread: 0.22 + O * 1.3 - A * 0.4,
    maxTips: Math.max(1, Math.round(1 + E * 1.7 + I * 0.5 - A * 0.9)),
    // Thin, and near enough uniform along its length: a member, not a trunk.
    baseWidth: 4.6 + S * 7.2 + A * 2.2,
    childWidth: 0.78 + S * 0.12,
    taper: 0.995 + S * 0.004,
    symmetry: clamp01(R * 1.6 - I * 0.5),
    // Blooms are the point of interest, so there are few of them and they are
    // large. Density here sets how far apart they sit, not how many pile on.
    nodeDensity: clamp01(0.04 + I * 0.60 + O * 0.28 - R * 0.12),
    // Heads have to be a real part of the object, not punctuation on it. At the
    // old scale a node was about two per cent of the plant's height: on a
    // two-thousand-unit armature that is a speck, and the organism read as bare
    // wire with something small stuck to it. The reference puts large, clearly
    // identifiable botanical parts on a spare frame, so these are roughly twice
    // the size and spaced a little closer — bigger and still few, rather than
    // many and small.
    nodeSize: 38 + O * 26 + I * 16,
    persistence: clamp01(0.50 + S * 0.44),
    // How readily a coiling tip reverses its winding. Order keeps a spiral
    // going in one direction; disorder makes it change its mind.
    torqueFlip: 0.04 + (1 - R) * 0.34,
    // second-order behaviour: answering against yourself bends the stem sharply
    kink: derived.reversal > 0.42 ? (derived.reversal - 0.42) * 2.4 : 0,
    // sustained extremes make growth reach for one direction and stay there
    fixation: clamp01((derived.heldAtEdge - 2) / 7) * derived.dominantStrength,
    returnChance: clamp01((A - 0.56) * 2.2),
    reaction,
    health,
  };
}

export function createPlant() {
  return {
    // One colour family for the whole organism. Materials are still told apart
    // by their optics, but a stem that is salmon in one section and mint in the
    // next stops reading as a plant and starts reading as wiring.
    baseHue: 0,
    sections: [],
    tips: [],
    nextSegId: 1,
    nextTipId: 1,
    bounds: { minX: -30, maxX: 30, minY: -20, maxY: 20 },
  };
}

function newTip(plant, over) {
  return {
    id: plant.nextTipId++,
    x: 0, y: 0, dir: 0, runLeft: 0, width: 4, depth: 0, age: 0,
    side: 1, torqueSign: 1, mode: 'rise', alive: true,
    ...over,
  };
}

/** The sprout that exists before the first prompt is answered. */
export function seedPlant(plant, rng) {
    // Green, or woody brown. The band between them is straw, and a straw stem
  // reads as dead grass rather than as the living thing this is meant to be.
  plant.baseHue = rng.chance(0.62) ? rng.range(78, 138) : rng.range(18, 38);
  const section = {
    step: 0,
    segments: [],
    nodes: [],
    steps: 8,
    promptId: null,
    promptText: null,
    responseLabel: null,
    type: null,
    tone: null,
  };
  // Straight up, then one 45 degree lean: the sprout states the rule the rest of
  // the organism is built from.
  const lean = rng.sign();
  const seg = { id: plant.nextSegId++, depth: 0, tipId: 0, broken: false, points: [] };
  let x = 0;
  let y = 0;
  for (let k = 0; k <= 8; k++) {
    seg.points.push({ x, y, w: 5.2 - (k / 8) * 1.4, k, dir: k < 5 ? 0 : (lean > 0 ? 1 : 7) });
    const d = k < 4 ? DIRS[0] : DIRS[lean > 0 ? 1 : 7];
    x += d.x * 3.4;
    y += d.y * 3.4;
  }
  section.segments.push(seg);
  section.nodes.push({
    x, y, angle: DIRS[lean > 0 ? 6 : 2].angle, size: 5, kind: 'leaf', k: 8, seed: rng.int(0, 9999),
  });
  plant.tips.push(newTip(plant, {
    x, y, dir: lean > 0 ? 1 : 7, width: 3.8, torqueSign: rng.sign(),
  }));
  finishSection(plant, section);
  plant.sections.push(section);
  return section;
}

/** A point on existing growth that a "returning" tip can aim for. */
function pickAnchor(plant, rng) {
  const pool = [];
  for (const s of plant.sections) {
    for (const n of s.nodes) pool.push(n);
  }
  if (!pool.length) return { x: 0, y: 10 };
  return rng.pick(pool);
}

/**
 * Grow one section. Mutates plant.tips, returns the new section.
 */
export function growSection(plant, params, rng, meta) {
  const section = {
    step: plant.sections.length,
    segments: [],
    nodes: [],
    steps: params.steps,
    ...meta,
  };

  // Every cell the plant already stands in. Rebuilt per section rather than
  // carried, because it is cheap at this size and a stale one would forbid
  // ground that no longer holds anything.
  const stepLen = params.reach / params.steps;
  const occupied = new Set();
  for (const sec of plant.sections) {
    for (const seg of sec.segments) {
      for (let i = 0; i < seg.points.length; i++) {
        const p = seg.points[i];
        if (i > 0) {
          const q = seg.points[i - 1];
          markPath(occupied, q.x, q.y, p.x, p.y, (p.w + q.w) * 0.5);
        } else {
          occupied.add(cellKey(p.x, p.y));
        }
      }
    }
  }

  if (plant.tips.length === 0) {
    // Everything that was growing has stopped. The organism restarts from
    // somewhere it has already been rather than from the ground.
    const a = pickAnchor(plant, rng);
    plant.tips.push(newTip(plant, {
      x: a.x, y: a.y, dir: rng.pick([7, 0, 0, 1]), width: params.baseWidth * 0.55,
      depth: 1, side: rng.sign(), torqueSign: rng.sign(),
    }));
  }

  // A plant in trouble is allowed to grow back over itself.
  //
  // Keeping members apart is a rule about how a healthy thing is built, and
  // applying it unconditionally quietly removed the only way a leaning plant
  // had to recover: correcting a lean means growing back across your own mass,
  // and this rule forbade exactly that. Strained plants stopped recovering and
  // died instead — the balance had been tuned around a route that no longer
  // existed. Below about two thirds health the rule lifts, which also reads
  // right: a struggling plant is the one that grows through itself.
  const tidy = params.health > 0.66;

  const alive = plant.tips.filter((t) => t.alive);

  // One member grows per turn.
  //
  // Every living tip used to advance on every answer, each steering by its own
  // target — so a plant with four tips put four runs into the world at once,
  // one climbing, one heading down, two going sideways. There is no camera that
  // can follow that: aim at the highest and you lose the lowest, aim at the mean
  // and you sit in the gap between them watching nothing move. It also makes an
  // answer illegible, because what it did is spread over four places at once.
  //
  // So a turn belongs to one member, and it stays with that member until it can
  // go no further. Growth reads as one continuous line, the camera has exactly
  // one thing to follow, and the plant still becomes a branched organism — the
  // branches simply take their turns rather than all growing at once.
  let lead = alive.find((t) => t.id === plant.leadId);
  if (!lead && alive.length) {
    // Whichever is nearest the one that just stopped, so the eye is handed on
    // rather than thrown across the plant.
    const from = plant.leadAt || { x: 0, y: 0 };
    lead = alive.reduce((best, t) => {
      const d = Math.hypot(t.x - from.x, t.y - from.y) - t.width * 6;
      return !best || d < best.d ? { t, d } : best;
    }, null).t;
  }
  plant.leadId = lead ? lead.id : null;
  const active = lead ? [lead] : [];
  // Each tip's own path, so it can tell its own body from everyone else's. A
  // branch inherits its parent's, because it grows out of it and starts life
  // standing inside it.
  //
  // Rebuilt from the segments whenever it is missing or is not a Set — which is
  // what comes back from a saved game, since a Set serialises to an empty
  // object and every later lookup then throws. A reloaded game has to be able
  // to carry on.
  for (const t of active) {
    if (t.trail instanceof Set) continue;
    t.trail = new Set([cellKey(t.x, t.y)]);
    for (const sec of plant.sections) {
      for (const seg of sec.segments) {
        if (seg.tipId !== t.id) continue;
        for (let i = 1; i < seg.points.length; i++) {
          const a = seg.points[i - 1];
          const b = seg.points[i];
          markPath(t.trail, a.x, a.y, b.x, b.y, (a.w + b.w) * 0.5);
        }
      }
    }
  }

  // Each tip gets a segment for this turn.
  const segFor = new Map();
  for (const tip of active) {
    // Apply any once-per-section direction events at the start of the section.
    if (params.kink > 0 && rng.chance(params.kink * 0.8)) {
      tip.dir = ((tip.dir + rng.sign() * rng.int(1, 3)) % 8 + 8) % 8;
      tip.runLeft = 0;
    }
    if (rng.chance(params.returnChance) && plant.sections.length > 2) {
      tip.mode = 'return';
      tip.anchor = pickAnchor(plant, rng);
    } else if (tip.mode === 'return' && rng.chance(0.45)) {
      tip.mode = 'rise';
      tip.anchor = null;
    }
    if (rng.chance(params.torqueFlip)) tip.torqueSign = -tip.torqueSign;
    tip.branchDebt = tip.branchDebt || 0;

    // New growth pushes with fresh vigour instead of tapering away forever.
    // A stable plant produces thicker shoots; an unstable one stays wiry, and
    // the step in thickness where two sections meet reads as a graft.
    const vigour = params.baseWidth * Math.pow(0.74, Math.min(tip.depth, 5));
    tip.width = lerp(tip.width, Math.max(tip.width, vigour), 0.55);

    const seg = { id: plant.nextSegId++, depth: tip.depth, tipId: tip.id, broken: false, points: [] };
    seg.points.push({ x: tip.x, y: tip.y, w: tip.width, k: 0 });
    segFor.set(tip.id, seg);
    section.segments.push(seg);
  }

  // Spacing is per tip, not per plant. Sharing one accumulator meant a plant
  // with three growing points sprouted blooms three times as fast as one with a
  // single stem, which is why bloom counts ranged from 1 to 26 for the same
  // number of answers.
  const spacing = lerp(980, 470, params.nodeDensity);

  for (let k = 1; k <= params.steps; k++) {
    const progress = k / params.steps;
    const spawned = [];

    for (const tip of active) {
      if (!tip.alive) continue;
      const seg = segFor.get(tip.id);
      if (!seg || seg.broken) continue;

      // ---- decide where this tip wants to be pointing ----
      let targetAngle;
      if (tip.mode === 'return' && tip.anchor) {
        targetAngle = Math.atan2(tip.anchor.x - tip.x, tip.anchor.y - tip.y);
      } else {
        targetAngle = params.lateral * tip.side;
        // fixation: a long-held extreme locks growth into one direction
        if (params.fixation > 0.1) {
          targetAngle = lerp(targetAngle, params.lateral * tip.side * 1.7, params.fixation);
        }
        // homing leans growth back over the axis it came from
        if (params.homing > 0.05) {
          const toAxis = Math.atan2(-tip.x, 55);
          targetAngle += angNorm(toAxis - targetAngle) * params.homing * 0.7;
        }
      }
      const target = dirOfAngle(targetAngle);

      // ---- turn, but only at the end of a run ----
      if (tip.runLeft <= 0) {
        tip.dir = chooseDirection(tip, params, rng, target, occupied, stepLen, tidy);
        const jitter = 1 + rng.bell() * 2 * params.runJitter;
        tip.runLen = Math.max(1, Math.round(params.runLength * jitter));
        tip.runLeft = tip.runLen;
      }
      tip.runLeft--;

      // gravity: growth that is not carrying itself gives way at the next corner
      const sag = params.droop * (0.3 + 0.7 * progress) * (0.55 + Math.min(tip.depth, 3) * 0.22);
      if (sag > 0.35 && tip.runLeft > 0 && rng.chance(sag * 0.12)) tip.runLeft = 0;

      // Every step is the same length and every bearing is exactly one of the
      // eight. Runs used to carry a small fixed departure from the ideal angle
      // and a bow across their length, on the argument that a perfectly straight
      // member looks CAD-drawn. It does not read that way against the reference:
      // those constructions are made of members cut and joined at right angles
      // and half-right angles, and the wobble only blurred the one rule the
      // whole form is built on. Character comes from which directions are
      // chosen and how long the runs are, not from bending them.
      // The ground is the ground.
      //
      // A plant driven downwards kept going straight through the floor and out
      // of the world below it, which is the one direction with something
      // already in the way. Nothing stopped it because nothing in the
      // simulation knew the floor was there: growth is planar, and the sweep is
      // built later in the renderer.
      //
      // The step is refused rather than shortened. Clamping the end of it to
      // the floor left one member sitting a fraction of a degree off the
      // lattice, which is the rule the whole form is built on — a tip that
      // cannot take its next step without going through the floor simply stops
      // where it is, and the plant is recorded as having come down.
      // A run does not get to plough through. Choosing the bearing at the top
      // of a run was not enough on its own: a run is several steps long, and
      // whatever it meets partway is met with the direction already settled.
      if (cellTaken(occupied, tip, tip.dir, stepLen, tidy)) {
        const alt = chooseDirection(tip, params, rng, target, occupied, stepLen, tidy);
        if (cellTaken(occupied, tip, alt, stepLen, tidy)) {
          // boxed in on every bearing — this tip has nowhere left to go
          tip.alive = false;
          continue;
        }
        tip.dir = alt;
        tip.runLeft = Math.max(1, Math.round(params.runLength)) - 1;
      }

      // Checked here, after the bearing is final. It used to sit above the
      // re-route, which then quietly changed `tip.dir` — so a tip diverted
      // around another member could be diverted straight into the floor on a
      // bearing nothing had checked, and a step landed below zero.
      if (tip.y + DIRS[tip.dir].y * stepLen <= GROUND) {
        plant.grounded = true;
        tip.alive = false;
        continue;
      }

      tip.prevDir = tip.dir;
      const fromX = tip.x;
      const fromY = tip.y;
      tip.x += DIRS[tip.dir].x * stepLen;
      tip.y += DIRS[tip.dir].y * stepLen;
      markPath(occupied, fromX, fromY, tip.x, tip.y, tip.width);
      markPath(tip.trail, fromX, fromY, tip.x, tip.y, tip.width);
      tip.width = Math.max(0.6, tip.width * params.taper);
      tip.age++;

      seg.points.push({ x: tip.x, y: tip.y, w: tip.width, k, dir: tip.dir });

      // ---- structural failure ----
      if (params.health < 0.28 && rng.chance((0.28 - params.health) * 0.09)) {
        seg.broken = true;
        tip.alive = false;
        continue;
      }

      // ---- nodes ----
      tip.nodeDebt = (tip.nodeDebt || 0) + stepLen;
      // One part per turn, across the whole plant.
      //
      // Every tip kept its own running debt, so a plant with two or three live
      // tips could put out a leaf on each in the same turn and they arrived
      // together as a bunch. An answer produces a length of stem and at most one
      // thing on it, which is also what makes the part worth looking at.
      if (section.nodes.length > 0) tip.nodeDebt = Math.min(tip.nodeDebt, spacing * 0.9);
      if (section.nodes.length === 0 && tip.nodeDebt >= spacing) {
        tip.nodeDebt -= spacing;
        // One side, never a pair. Opposite leaves are a real arrangement and
        // this used to grow them, but two arriving on the same answer is the
        // bunch: an answer should put out one thing, and one thing is what the
        // eye can attribute to it.
        for (const sd of [rng.sign()]) {
          section.nodes.push({
            x: tip.x, y: tip.y,
            angle: DIRS[((tip.dir + sd * (rng.chance(0.5) ? 1 : 2)) % 8 + 8) % 8].angle,
            size: params.nodeSize * rng.range(0.7, 1.3) * (0.55 + params.health * 0.45),
            kind: pickNodeKind(rng, params, meta.values, plant),
            k, seed: rng.int(0, 99999),
          });
        }
      }

      // ---- branching ----
      // Branching runs off an accumulator rather than a per-step coin flip, so
      // the *number* of branches is a direct function of the hidden values and
      // only their placement is jittered. Vigour, not a fixed generation count,
      // is the limit: a thriving plant keeps opening out, a depleted one
      // narrows to a single strand.
      tip.branchDebt += (params.branchP * 1.15) / params.steps;
      const room = active.length + spawned.length < params.maxTips;
      const vigorous = tip.width > params.baseWidth * 0.20;
      if (room && vigorous && k > 1 && k < params.steps && tip.branchDebt >= 1) {
        tip.branchDebt -= 1;
        // One new path at a time.
        //
        // A symmetric pair opening at once puts two tips into the world from a
        // single junction, and from there the plant widens twice as fast as it
        // climbs: it reads as a diagram of a branching process rather than as
        // something growing. A fork that goes one way is also the harder, more
        // characterful choice — the organism commits to a side.
        //
        // Which side is not a coin flip. A pair was self-separating — one went
        // left and one went right and neither could be in the other's way — and
        // taking that away, two forks near each other could both pick the same
        // side and run down the same corridor. So the fork looks first: if one
        // side is into ground something already stands in and the other is
        // clear, it takes the clear one.
        const turn = rng.chance(clamp01(params.spread * 0.6)) ? 2 : 1;
        const dirOf = (d) => ((tip.dir + d * turn) % 8 + 8) % 8;
        const blocked = (d) => cellTaken(occupied, tip, dirOf(d), stepLen, tidy);
        const first = rng.sign();
        const side = blocked(first) && !blocked(-first) ? -first : first;
        for (const d of [side]) {
          const child = newTip(plant, {
            x: tip.x, y: tip.y,
            // a branch leaves at 45 or 90 degrees; wide spread favours the right angle
            dir: dirOf(d),
            runLeft: Math.max(1, Math.round(params.runLength)),
            width: Math.max(0.9, tip.width * params.childWidth),
            depth: tip.depth + 1,
            side: d,
            torqueSign: rng.chance(0.6) ? tip.torqueSign : -tip.torqueSign,
            mode: tip.mode,
          });
          // Only the joint, not the parent's whole history.
          //
          // Handing a branch its parent's entire trail made it blind to the
          // parent for the rest of its life, and a branch running back along
          // the member it came from is most of the overlap there is. It needs
          // to be free of the few cells around the junction and nothing else.
          child.trail = new Set();
          markDisc(child.trail, child.x, child.y, CELL * 1.8);
          const cseg = { id: plant.nextSegId++, depth: child.depth, tipId: child.id, broken: false, points: [] };
          cseg.points.push({ x: child.x, y: child.y, w: child.width, k });
          section.segments.push(cseg);
          segFor.set(child.id, cseg);
          spawned.push(child);
        }
      }
    }

    for (const c of spawned) { plant.tips.push(c); active.push(c); }
  }

  if (lead) plant.leadAt = { x: lead.x, y: lead.y };

  // ---- which tips carry on into the next turn ----
  // How many tips carry on is a function of stability; *which* ones is decided
  // by thickness and by how far out on the structure they are. Rolling a coin
  // per tip made the number of growing points mostly luck, which showed up as
  // plants that differed wildly under identical answers.
  //
  // The depth penalty is what gives the organism a spine: the main member keeps
  // going, side arms run a little way and stop. Without it every branch grew
  // forever and the result was a thicket with no structure to read.
  plant.tips = plant.tips.filter((t) => t.alive);
  const keep = clamp(
    Math.round(plant.tips.length * params.persistence + 0.35),
    Math.min(1, plant.tips.length),
    params.maxTips
  );
  const merit = (t) => t.width - t.depth * 2.2 - t.age * 0.06 + rng.bell() * 0.8;
  plant.tips.sort((a, b) => merit(b) - merit(a));
  const stopping = plant.tips.slice(keep);
  for (const tip of stopping) tip.alive = false;
  plant.tips.length = keep;

  // Every arm that stops here ends in a bloom. This is the single change that
  // made the thing read like a constructed piece: flowers sit at the ends of
  // members, the way they do when someone has assembled one.
  for (const tip of stopping) {
    // A stub that barely left its parent is a joint, not an arm; giving it a
    // flower head made the organism look studded rather than composed.
    if (tip.age < 2) continue;
    // and still one part a turn: several arms ending at once put out a bunch
    if (section.nodes.length > 0) break;
    section.nodes.push({
      x: tip.x, y: tip.y,
      angle: DIRS[tip.dir].angle,
      size: params.nodeSize * rng.range(0.95, 1.35) * (0.6 + params.health * 0.4),
      kind: pickNodeKind(rng, params, meta.values, plant),
      terminal: true,
      k: params.steps, seed: rng.int(0, 99999),
    });
  }

  // Drop segments that never went anywhere.
  section.segments = section.segments.filter((s) => s.points.length > 1);

  finishSection(plant, section);
  plant.sections.push(section);
  thickenTrunk(plant, params);
  return section;
}

function pickNodeKind(rng, params, values, plant) {
  if (!values) return rng.pick(NODE_KINDS);
  const w = {
    disc: 0.5 + values.openness * 1.3 + values.order * 0.4,
    cup: 0.4 + values.attachment * 1.0 + values.stability * 0.5,
    bell: 0.3 + values.attachment * 1.1 - values.openness * 0.3,
    globe: 0.3 + values.intensity * 1.2 + values.expansion * 0.4,
    spike: 0.25 + values.intensity * 0.9 + values.order * 0.5,
    // an umbel is many small parts held in one plane: openness, arranged
    umbel: 0.20 + values.openness * 1.1 + values.order * 0.8,
    // a star is openness without softness
    star: 0.20 + values.openness * 1.0 + values.intensity * 0.6 - values.attachment * 0.4,
    // a pod is what is left when a flower closes around what it is keeping
    pod: 0.18 + values.attachment * 1.2 + values.stability * 0.5 - values.openness * 0.5,
    leaf: 0.45 + values.stability * 0.9 - values.intensity * 0.3,
    // a frond is repetition: order, and room to repeat into
    frond: 0.20 + values.order * 1.2 + values.expansion * 0.5,
    // needles are intensity with nothing spare
    needle: 0.18 + values.intensity * 1.1 - values.expansion * 0.4,
    // a fan is one broad surface turned outward
    fan: 0.20 + values.openness * 0.8 + values.stability * 0.6,
    // a heart is soft and holds: attachment, with room to be broad
    heart: 0.20 + values.attachment * 1.0 + values.expansion * 0.4,
    // a lobed edge is a blade that has been interrupted and carried on anyway
    lobed: 0.18 + values.stability * 0.7 + (1 - values.order) * 0.7,
    // a strap is length without width
    strap: 0.18 + values.expansion * 0.9 - values.openness * 0.3,
    // a trefoil is the same part repeated three times, and knows it
    trefoil: 0.18 + values.order * 1.0 + values.stability * 0.5,
    // The plain ones. A circle with an eye in it, a funnel, a ring of equal
    // rays — no arrangement to read, which is its own kind of statement.
    button: 0.22 + values.order * 0.9 + values.stability * 0.6,
    trumpet: 0.20 + values.openness * 1.0 + values.attachment * 0.4,
    pom: 0.20 + values.order * 0.8 + values.expansion * 0.6,
    // Single distinct heads on bare stems, which is what the reference keeps
    // doing: one clearly identifiable flower at the end of a length of nothing.
    lily: 0.20 + values.openness * 1.0 + values.expansion * 0.5,
    pansy: 0.20 + values.attachment * 0.9 + values.openness * 0.5,
    allium: 0.20 + values.order * 1.0 + values.intensity * 0.4,
    drumstick: 0.20 + values.order * 0.7 + (1 - values.expansion) * 0.7,
    cactus: 0.18 + values.intensity * 0.9 + values.stability * 0.6 - values.openness * 0.4,
    // The sharp ones. Everything above curves; these are what a plant grows
    // when it is not being accommodating, and they are weighted accordingly.
    spider: 0.18 + values.intensity * 1.2 + values.openness * 0.6 - values.attachment * 0.4,
    burr: 0.16 + values.intensity * 1.0 + values.attachment * 0.7 - values.openness * 0.5,
    saw: 0.18 + values.intensity * 0.9 + (1 - values.attachment) * 0.6,
    arrow: 0.16 + values.intensity * 0.8 + values.order * 0.7,
  };
  // Narrow to the few kinds these values actually call for.
  //
  // With twenty kinds available and a weighted pick per node, one plant grew a
  // sample of all of them and read as a catalogue rather than as a single
  // organism. Two at a time is a vocabulary — one form and a foil for it —
  // where three already started to look like an assortment on a plant this
  // spare. Because the values drift, that pair still changes across a life
  // instead of being fixed at seeding.
  // A plant remembers what it grows.
  //
  // Taking the two strongest each time still gathered four or five kinds over a
  // life, because the values drift and the top of the list drifts with them —
  // so a spare plant ended up carrying an assortment anyway. Kinds it has grown
  // before are weighted heavily, which lets a vocabulary *settle*: it can still
  // take up something new when the values move far enough to overcome the
  // habit, and that is then the thing it keeps doing.
  const seen = plant?.kinds || [];
  const bias = (k) => w[k] + (seen.includes(k) ? 2.4 : 0);
  const top = [...NODE_KINDS].sort((a, b) => bias(b) - bias(a)).slice(0, 2);
  const chosen = rng.weighted(top, bias);
  if (plant) {
    if (!plant.kinds) plant.kinds = [];
    if (!plant.kinds.includes(chosen)) plant.kinds.push(chosen);
  }
  return chosen;
}

/**
 * Older wood keeps thickening, but only near the base. A plant that was
 * unstable early stays permanently thin at the bottom, and everything it grows
 * later has to be carried by that.
 */
function thickenTrunk(plant, params) {
  const rate = (0.006 + params.health * (0.006 + 0.028 * (params.baseWidth / 12)))
    * (1 + params.reaction * 1.8);
  // The ceiling tracks how vigorous the plant has been *on average*, so
  // stability is what decides how thick the base can ever get. A flat
  // multiplier made every plant converge on the same trunk; taking the maximum
  // ever seen let one good turn raise the ceiling permanently.
  const want = params.baseWidth * (1.35 + params.reaction * 0.75);
  plant.ceiling = plant.ceiling === undefined ? want : plant.ceiling * 0.85 + want * 0.15;
  const ceiling = plant.ceiling;
  for (const s of plant.sections) {
    let touched = false;
    for (const seg of s.segments) {
      if (seg.depth > 1) continue;
      for (const p of seg.points) {
        p.w0 = p.w0 ?? p.w;
        const cap = Math.max(p.w0, ceiling);
        const grown = Math.min(cap, p.w * (1 + rate * (seg.depth === 0 ? 1 : 0.55)));
        if (grown !== p.w) { p.w = grown; touched = true; }
      }
    }
    if (touched) s.dirty = true;
  }
}

function finishSection(plant, section) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const consider = (x, y, pad) => {
    if (x - pad < minX) minX = x - pad;
    if (x + pad > maxX) maxX = x + pad;
    if (y - pad < minY) minY = y - pad;
    if (y + pad > maxY) maxY = y + pad;
  };
  for (const seg of section.segments) for (const p of seg.points) consider(p.x, p.y, p.w * 1.6 + 24);
  for (const n of section.nodes) consider(n.x, n.y, n.size * 2.2 + 24);
  if (!isFinite(minX)) { minX = -10; maxX = 10; minY = 0; maxY = 10; }
  section.bounds = { minX, maxX, minY, maxY };
  section.dirty = true;

  const b = plant.bounds;
  b.minX = Math.min(b.minX, minX); b.maxX = Math.max(b.maxX, maxX);
  b.minY = Math.min(b.minY, minY); b.maxY = Math.max(b.maxY, maxY);
}

/**
 * Physical read of the organism, used by the vitality system.
 * Mass is carried by whatever thickness exists near the ground; growth that
 * leans far to one side asks more of that base than growth that stays over it.
 */
export function measureStructure(plant) {
  let mass = 0;
  let moment = 0;
  let momentX = 0;
  let strength = 0;
  let baseWidth = 0;
  let tipCount = 0;
  let height = 0;
  let length = 0;

  for (const s of plant.sections) {
    for (const seg of s.segments) {
      for (let i = 1; i < seg.points.length; i++) {
        const a = seg.points[i - 1];
        const b = seg.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const w = (a.w + b.w) * 0.5;
        const m = len * w;
        mass += m;
        length += len;
        momentX += m * Math.abs((a.x + b.x) * 0.5);
        moment += m * Math.abs((a.x + b.x) * 0.5) * (1 + Math.max(0, (a.y + b.y) * 0.5) / 400);
        if (seg.depth === 0 && (a.y + b.y) * 0.5 < 55) {
          strength += w * w * len;
          baseWidth = Math.max(baseWidth, w);
        }
        if (b.y > height) height = b.y;
      }
    }
  }
  tipCount = plant.tips.length;
  return {
    mass, moment, momentX, strength: Math.max(1, strength),
    // How far the centre of mass sits off the axis, against how wide the base
    // laid down early actually is. This is lean, not size: a tall straight
    // plant scores low, a squat lopsided one scores high.
    comX: mass > 0 ? momentX / mass : 0,
    baseWidth: Math.max(1, baseWidth),
    tipCount, height, length,
  };
}
