// Headless tuning + verification harness.
//
//   node tools/simulate.js [runsPerStrategy] [maxTurns]
//
// This exists to answer the brief's key prototype question with numbers rather
// than vibes: can a small set of hidden rules produce plants that are
// meaningfully different from one another?
//
// It plays the game many times under different "player characters", measures
// the resulting organisms, and reports (a) whether the vitality system is
// tuned so that careless play can die and considered play does not, and
// (b) whether between-strategy morphological variation is larger than the
// noise within a single strategy.

import { Engine } from '../src/engine.js';
import { makeRng } from '../src/rng.js';

const RUNS = Number(process.argv[2] || 60);
const MAX_TURNS = Number(process.argv[3] || 22);

// --------------------------------------------------------------- players --

const STRATEGIES = {
  // answers at random
  drifting: (rng) => ({ pick: (n) => rng.int(0, n - 1), slide: () => rng(), act: () => rng() }),
  // always takes the first option, always slides low
  withholding: () => ({ pick: () => 0, slide: () => 0.12, act: () => 0.15 }),
  // always takes the last option, always slides high
  reaching: (rng) => ({ pick: (n) => n - 1, slide: () => 0.88, act: () => 0.85 }),
  // flips between extremes every turn
  contradicting: (rng) => {
    let f = 0;
    return {
      pick: (n) => (f++ % 2 ? 0 : n - 1),
      slide: () => (f++ % 2 ? 0.08 : 0.92),
      act: () => (f++ % 2 ? 0.1 : 0.9),
    };
  },
  // stays near the middle of everything
  measured: (rng) => ({
    pick: (n) => (n === 2 ? rng.int(0, 1) : rng.int(1, 2)),
    slide: () => 0.42 + rng() * 0.16,
    act: () => 0.42 + rng() * 0.16,
  }),
  // consistent lean, but not mechanical about it
  leaning: (rng) => ({
    pick: (n) => (rng.chance(0.75) ? 0 : rng.int(0, n - 1)),
    slide: () => 0.22 + rng() * 0.2,
    act: () => 0.25 + rng() * 0.2,
  }),
};

function play(strategyName, seed, maxTurns, growthSeed = seed) {
  const rng = makeRng('player:' + strategyName + ':' + seed);
  const player = STRATEGIES[strategyName](rng);
  // The script seed deliberately does *not* include the strategy, so the same
  // run of questions can be replayed by different players. The growth seed is
  // separate so the geometry noise can be varied on its own.
  const e = new Engine('sim:' + seed, 'grow:' + growthSeed);
  e.start();

  let turns = 0;
  while (!e.finished && turns < maxTurns) {
    const p = e.prompt;
    if (!p) break;
    if (p.type === 'binary') e.answer({ index: player.pick(2) });
    else if (p.type === 'quad') e.answer({ index: player.pick(4) });
    else if (p.type === 'slider') e.answer({ t: player.slide() });
    else e.answer({ t: player.act() });
    turns++;
  }
  if (!e.finished) e.finish('voluntary');
  return e;
}

// ------------------------------------------------------------- measuring --

function describe(e) {
  const s = e.stats();
  let branches = 0;
  let curvature = 0;
  let curvSamples = 0;
  let vertical = 0;
  let vertSamples = 0;
  let below = 0;

  for (const sec of e.plant.sections) {
    for (const seg of sec.segments) {
      if (seg.depth > 0) branches++;
      for (let i = 2; i < seg.points.length; i++) {
        const a = seg.points[i - 2], b = seg.points[i - 1], c = seg.points[i];
        const a1 = Math.atan2(b.y - a.y, b.x - a.x);
        const a2 = Math.atan2(c.y - b.y, c.x - b.x);
        let d = a2 - a1;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        curvature += Math.abs(d);
        curvSamples++;
      }
      for (let i = 1; i < seg.points.length; i++) {
        const dx = seg.points[i].x - seg.points[i - 1].x;
        const dy = seg.points[i].y - seg.points[i - 1].y;
        const l = Math.hypot(dx, dy) || 1;
        vertical += dy / l;
        vertSamples++;
        if (dy < 0) below += l;
      }
    }
  }

  return {
    height: s.height,
    spread: s.spread,
    mass: s.mass,
    length: s.length,
    tips: s.tips,
    branches,
    curvature: curvSamples ? curvature / curvSamples : 0,
    verticality: vertSamples ? vertical / vertSamples : 0,
    downward: s.length ? below / s.length : 0,
    materials: s.materials.length,
    environments: s.environments.length,
    condition: s.condition,
    ending: s.ending,
    turns: s.age,
    vitality: s.vitality,
  };
}

// Tips and branches are left out: the plant is one stem (see maxTips in
// growth.js), so both are all but constant, and a feature that barely varies
// turns the odd stopped stem into a huge normalised difference — noise.
const NUMERIC = ['height', 'spread', 'mass', 'length', 'curvature',
                 'verticality', 'downward', 'materials', 'environments'];

function stats(values) {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { mean, sd };
}

// ------------------------------------------------------------------ main --

const results = {};
for (const name of Object.keys(STRATEGIES)) {
  results[name] = [];
  for (let i = 0; i < RUNS; i++) results[name].push(describe(play(name, i, MAX_TURNS)));
}

const all = Object.values(results).flat();
const norm = {};
for (const key of NUMERIC) norm[key] = stats(all.map((d) => d[key]));

const fmt = (x, w = 7, d = 1) => String(typeof x === 'number' ? x.toFixed(d) : x).padStart(w);

console.log(`\n  ${RUNS} runs x ${Object.keys(STRATEGIES).length} strategies, up to ${MAX_TURNS} turns\n`);
console.log('  strategy         died  turns  height  spread    mass   tips  branch   curve  vert  down  mat  env');
console.log('  ' + '-'.repeat(103));

for (const [name, runs] of Object.entries(results)) {
  const died = runs.filter((r) => r.ending === 'natural').length;
  const m = (k) => stats(runs.map((r) => r[k])).mean;
  console.log(
    '  ' + name.padEnd(15) +
    fmt((died / runs.length) * 100, 5, 0) + '%' +
    fmt(m('turns'), 6, 1) +
    fmt(m('height'), 8, 0) +
    fmt(m('spread'), 8, 0) +
    fmt(m('mass'), 8, 0) +
    fmt(m('tips'), 7, 1) +
    fmt(m('branches'), 8, 1) +
    fmt(m('curvature'), 8, 3) +
    fmt(m('verticality'), 6, 2) +
    fmt(m('downward'), 6, 2) +
    fmt(m('materials'), 5, 1) +
    fmt(m('environments'), 5, 1)
  );
}

// The brief's key question, as an experiment.
//
// Two plants can differ because the player answered differently, or because the
// random stream happened to fall differently. Only the first kind of difference
// is the game working. So:
//
//   answers : same world seed, different players   -> difference from responses
//   noise   : same player, different world seeds   -> difference from the rng
//
// If answers / noise is not comfortably above 1, the hidden system is
// decorative and the plant is really just a random shape.
function dist(a, b) {
  let s = 0;
  for (const k of NUMERIC) {
    const sd = norm[k].sd || 1;
    s += ((a[k] - b[k]) / sd) ** 2;
  }
  return Math.sqrt(s / NUMERIC.length);
}

const names = Object.keys(results);

// Pure noise: identical script, identical answers, different geometry stream.
let noiseSum = 0, noiseN = 0;
for (const name of names) {
  for (let seed = 0; seed < Math.min(RUNS, 20); seed++) {
    const variants = [0, 1, 2].map((g) => describe(play(name, seed, MAX_TURNS, `${seed}-alt${g}`)));
    for (let a = 0; a < variants.length; a++) {
      for (let b = a + 1; b < variants.length; b++) { noiseSum += dist(variants[a], variants[b]); noiseN++; }
    }
  }
}

// Signal: identical script and geometry stream, different answers.
let ansSum = 0, ansN = 0;
for (let seed = 0; seed < RUNS; seed++) {
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      ansSum += dist(results[names[i]][seed], results[names[j]][seed]);
      ansN++;
    }
  }
}

// Determinism check: the same answers on the same seed must rebuild the same plant.
const twice = [describe(play("measured", 7, MAX_TURNS)), describe(play("measured", 7, MAX_TURNS))];
const deterministic = dist(twice[0], twice[1]) === 0;

const noise = noiseSum / noiseN;
const answers = ansSum / ansN;
console.log('\n  morphological distance');
console.log(`    same script + noise, diff answers : ${answers.toFixed(3)}`);
console.log(`    same answers, diff noise stream : ${noise.toFixed(3)}`);
console.log(`    signal / noise               : ${(answers / noise).toFixed(2)}x  (want > 1.3)`);
console.log(`    deterministic replay         : ${deterministic ? 'yes' : 'NO — same input gave a different plant'}`);

const conditions = {};
for (const r of all) conditions[r.condition] = (conditions[r.condition] || 0) + 1;
console.log('\n  final conditions:', Object.entries(conditions).map(([k, v]) =>
  `${k} ${Math.round((v / all.length) * 100)}%`).join('  '));
console.log();
