// Plays games and prints the cultivar names they end with.
//
//   node tools/names.js [games] [samples]
//
// Reports how often names repeat, how many games read as steady (no turning
// point), which genera come up, and the spread of turning-point scores that
// TURN_THRESHOLD in src/names.js is set against. Then prints some names with
// the answers each word came from.

import { Engine } from '../src/engine.js';
import { makeRng } from '../src/rng.js';
import { cultivarName, findTurn, TURN_THRESHOLD } from '../src/names.js';

const GAMES = Number(process.argv[2] || 1000);
const SAMPLES = Number(process.argv[3] || 12);

const names = new Map();
const genera = new Map();
const scores = [];
let steady = 0;
const samples = [];

for (let s = 0; s < GAMES; s++) {
  const rng = makeRng('names:' + s);
  const e = new Engine('nm' + s, 'nmg' + s);
  e.start();
  // Mostly ordinary lengths, some long ones, a few that stop at the minimum.
  const len = rng.chance(0.1) ? 4 + rng.int(0, 2) : rng.chance(0.25) ? 25 + rng.int(0, 40) : 8 + rng.int(0, 16);
  // A player with a lean that sometimes changes its mind.
  let lean = rng();
  for (let i = 0; i < len && e.prompt && !e.finished; i++) {
    if (rng.chance(0.08)) lean = 1 - lean;
    const p = e.prompt;
    const t = Math.min(1, Math.max(0, lean + rng.bell() * 0.8));
    e.answer(p.options ? { index: Math.min(p.options.length - 1, Math.floor(t * p.options.length)) } : { t });
  }
  const n = cultivarName(e);
  names.set(n.text, (names.get(n.text) || 0) + 1);
  genera.set(n.genus.name, (genera.get(n.genus.name) || 0) + 1);
  if (n.steady) steady++;
  const turn = findTurn(e.values.log, e.values.deltaLog, -Infinity);
  scores.push(turn ? turn.score : 0);
  if (samples.length < SAMPLES) samples.push({ n, answers: e.history.length });
}

const repeated = [...names.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);
console.log(`\n  ${GAMES} games`);
console.log(`  distinct names     : ${names.size} (${(100 * names.size / GAMES).toFixed(1)}%)`);
console.log(`  games sharing name : ${repeated}`);
console.log(`  steady (no turn)   : ${(100 * steady / GAMES).toFixed(1)}%   threshold ${TURN_THRESHOLD}`);
scores.sort((a, b) => a - b);
console.log('  best turn score    : ' + [0.1, 0.25, 0.5, 0.75, 0.9]
  .map((q) => `p${q * 100} ${scores[Math.floor(q * scores.length)].toFixed(3)}`).join('  '));
console.log('  genera             : ' + [...genera].sort((a, b) => b[1] - a[1]).map(([g, c]) => `${g} ${c}`).join(', '));

console.log('');
for (const { n, answers } of samples) {
  console.log(`  ${n.text}   (${answers} answers)`);
  console.log(`      ${n.genus.name}: ${n.genus.gloss}`);
  const { start, turn } = n.moments;
  if (start) console.log(`      ${start.words[1].padEnd(12)} first answer, "${start.label}" (${start.promptId})`);
  if (turn) console.log(`      ${turn.words[0].padEnd(12)} turning point at answer ${turn.index + 1}, "${turn.label}" (${turn.promptId})`);
  else console.log(`      ${n.epithet.split(' ')[0].padEnd(12)} no turning point: a steady journey`);
  if (n.closing) console.log(`      ${n.closing.padEnd(12)} the journey ended in that season`);
}
console.log('');
