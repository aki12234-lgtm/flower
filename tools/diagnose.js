// Prints the raw structural numbers per turn, so the vitality constants can be
// set from data instead of guessed.
//
//   node tools/diagnose.js [strategy] [turns]

import { Engine } from '../src/engine.js';
import { makeRng } from '../src/rng.js';
import { measureStructure } from '../src/growth.js';

const NAME = process.argv[2] || 'measured';
const TURNS = Number(process.argv[3] || 20);

const PLAYERS = {
  measured: (rng) => ({ pick: (n) => (n === 2 ? rng.int(0, 1) : rng.int(1, 2)), slide: () => 0.5, act: () => 0.5 }),
  reaching: () => ({ pick: (n) => n - 1, slide: () => 0.88, act: () => 0.85 }),
  withholding: () => ({ pick: () => 0, slide: () => 0.12, act: () => 0.15 }),
  contradicting: () => { let f = 0; return { pick: (n) => (f++ % 2 ? 0 : n - 1), slide: () => (f++ % 2 ? 0.08 : 0.92), act: () => (f++ % 2 ? 0.1 : 0.9) }; },
  drifting: (rng) => ({ pick: (n) => rng.int(0, n - 1), slide: () => rng(), act: () => rng() }),
};

const rng = makeRng('diag:' + NAME);
const player = PLAYERS[NAME](rng);
const e = new Engine('diag:' + NAME);
e.start();

const f = (x, w = 8, d = 1) => String(x.toFixed(d)).padStart(w);
console.log(`\n  ${NAME}\n`);
console.log('  turn    mass strength   ratio    comX  lean/w  tips  height  reach  vital  E    S    O    A    I    R');
console.log('  ' + '-'.repeat(114));

for (let i = 0; i < TURNS && !e.finished; i++) {
  const p = e.prompt;
  if (!p) break;
  if (p.type === 'binary') e.answer({ index: player.pick(2) });
  else if (p.type === 'quad') e.answer({ index: player.pick(4) });
  else e.answer({ t: p.type === 'slider' ? player.slide() : player.act() });

  const s = measureStructure(e.plant);
  const v = e.values.values;
  console.log(
    '  ' + String(i + 1).padStart(4) +
    f(s.mass, 8, 0) + f(s.strength, 9, 0) + f(s.mass / s.strength, 8, 2) +
    f(s.comX, 10, 1) + f(s.comX / s.baseWidth, 9, 2) +
    f(s.tipCount, 6, 0) + f(s.height, 8, 0) +
    f(e.plant.sections.at(-1).segments.reduce((a, sg) => a + sg.points.length, 0), 7, 0) +
    f(e.vit.vitality, 7, 2) +
    f(v.expansion, 5, 2) + f(v.stability, 5, 2) + f(v.openness, 5, 2) +
    f(v.attachment, 5, 2) + f(v.intensity, 5, 2) + f(v.order, 5, 2)
  );
}
console.log('\n  ending:', e.ending, '| condition:', e.vit.condition, '| inputs:',
  JSON.stringify(Object.fromEntries(Object.entries(e.vit.lastInputs || {}).map(([k, x]) => [k, +x.toFixed(2)]))));
console.log();
