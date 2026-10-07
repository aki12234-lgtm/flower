// Prints the raw strain ratios per player type with vitality damage switched
// off, so the thresholds in vitality.js can be placed between the considered
// players and the careless ones instead of guessed.
//
//   node tools/tune.js [runs] [turns]

import { Engine } from '../src/engine.js';
import { makeRng } from '../src/rng.js';
import { measureStructure } from '../src/growth.js';
import { TUNING } from '../src/vitality.js';

TUNING.ENABLED = false;

const RUNS = Number(process.argv[2] || 40);
const TURNS = Number(process.argv[3] || 22);

const PLAYERS = {
  measured: (rng) => ({ pick: (n) => (n === 2 ? rng.int(0, 1) : rng.int(1, 2)), slide: () => 0.42 + rng() * 0.16, act: () => 0.42 + rng() * 0.16 }),
  leaning: (rng) => ({ pick: (n) => (rng.chance(0.75) ? 0 : rng.int(0, n - 1)), slide: () => 0.22 + rng() * 0.2, act: () => 0.25 + rng() * 0.2 }),
  drifting: (rng) => ({ pick: (n) => rng.int(0, n - 1), slide: () => rng(), act: () => rng() }),
  reaching: () => ({ pick: (n) => n - 1, slide: () => 0.88, act: () => 0.85 }),
  withholding: () => ({ pick: () => 0, slide: () => 0.12, act: () => 0.15 }),
  contradicting: () => { let f = 0; return { pick: (n) => (f++ % 2 ? 0 : n - 1), slide: () => (f++ % 2 ? 0.08 : 0.92), act: () => (f++ % 2 ? 0.1 : 0.9) }; },
};

function run(name, seed) {
  const rng = makeRng('tune:' + name + ':' + seed);
  const player = PLAYERS[name](rng);
  const e = new Engine('tune:' + name + ':' + seed);
  e.start();
  for (let i = 0; i < TURNS; i++) {
    const p = e.prompt;
    if (!p) break;
    if (p.type === 'binary') e.answer({ index: player.pick(2) });
    else if (p.type === 'quad') e.answer({ index: player.pick(4) });
    else e.answer({ t: p.type === 'slider' ? player.slide() : player.act() });
  }
  const s = measureStructure(e.plant);
  const d = e.values.derived();
  return {
    carry: s.mass / s.strength,
    lean: s.comX / s.baseWidth,
    tips: s.tipCount,
    sustainable: 1.2 + s.baseWidth * 0.30,
    baseWidth: s.baseWidth,
    volatility: d.volatility,
    heldAtEdge: d.heldAtEdge,
    extremity: d.extremity,
    height: s.height,
    spread: e.plant.bounds.maxX - e.plant.bounds.minX,
  };
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };

console.log(`\n  raw strain ratios, damage off, ${RUNS} runs x ${TURNS} turns\n`);
console.log('  player          carry(p50/p90)   lean(p50/p90)   tips/sust   volatility  held  baseW  height  spread');
console.log('  ' + '-'.repeat(96));

for (const name of Object.keys(PLAYERS)) {
  const rs = [];
  for (let i = 0; i < RUNS; i++) rs.push(run(name, i));
  const g = (k) => rs.map((r) => r[k]);
  console.log(
    '  ' + name.padEnd(15) +
    `${pct(g('carry'), 0.5).toFixed(2)} / ${pct(g('carry'), 0.9).toFixed(2)}`.padStart(14) +
    `${pct(g('lean'), 0.5).toFixed(2)} / ${pct(g('lean'), 0.9).toFixed(2)}`.padStart(16) +
    `${mean(g('tips')).toFixed(1)} / ${mean(g('sustainable')).toFixed(1)}`.padStart(12) +
    mean(g('volatility')).toFixed(2).padStart(13) +
    mean(g('heldAtEdge')).toFixed(1).padStart(6) +
    mean(g('baseWidth')).toFixed(1).padStart(7) +
    mean(g('height')).toFixed(0).padStart(8) +
    mean(g('spread')).toFixed(0).padStart(8)
  );
}
console.log(`\n  current thresholds: K_OVERLOAD=${TUNING.K_OVERLOAD} K_TOPPLE=${TUNING.K_TOPPLE} K_CHURN=${TUNING.K_CHURN}`);
console.log('  place each threshold above the considered players and below the careless ones.\n');
