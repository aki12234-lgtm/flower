// Assertions about the rules, not the rendering.
//
//   node tools/test.js
//
// The visual half lives in tools/selftest.html.

import { Engine } from '../src/engine.js';
import { makeRng } from '../src/rng.js';
import { ValueState, VALUE_KEYS, resolveEffects } from '../src/values.js';
import { PROMPTS, SEASONS, ROOTS_TURNS, seasonAt } from '../src/prompts.js';
import { cultivarName, WORDS, GENERA } from '../src/names.js';
import { TUNING } from '../src/vitality.js';
import { MATERIALS } from '../src/materials.js';
import { buildPlant, buildBackdrop, PLACES, setDisplacement, setStyle, STEM_DRAWN } from '../src/gl/scene.js';
import { partBoxes, segBoxDist, boxesOverlap, PART_WIDTH, PART_BAND } from '../src/growth.js';
import { ENVIRONMENTS } from '../src/environment.js';
import { Renderer3D } from '../src/gl/renderer3d.js';
import { buildFlatPlant } from '../src/flat/plant2d.js';
import { Renderer2D } from '../src/flat/renderer2d.js';
import { PLANT_SET } from '../src/flat/ink.js';
import { readFileSync } from 'fs';
import vm from 'vm';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    const problem = fn();
    if (problem) failures.push(`${name}: ${problem}`);
    else passed++;
  } catch (e) {
    failures.push(`${name}: threw ${e && e.stack ? e.stack.split('\n')[0] : e}`);
  }
}

/** Play a scripted game. `answers` is a function of (prompt, index). */
function playGame(seed, growthSeed, answer, turns = 22) {
  const e = new Engine(seed, growthSeed);
  e.start();
  for (let i = 0; i < turns; i++) {
    const p = e.prompt;
    if (!p || e.finished) break;
    e.answer(answer(p, i));
  }
  return e;
}

const alwaysFirst = (p) => (p.type === 'binary' || p.type === 'quad' ? { index: 0 } : { t: 0.1 });
const alwaysLast = (p) => (p.type === 'binary' || p.type === 'quad' ? { index: p.options.length - 1 } : { t: 0.9 });

// ------------------------------------------------------------ determinism --

check('same seeds and answers rebuild the same plant', () => {
  const a = playGame('s1', 'g1', alwaysFirst);
  const b = playGame('s1', 'g1', alwaysFirst);
  if (JSON.stringify(a.plant) !== JSON.stringify(b.plant)) return 'plants differ';
  if (JSON.stringify(a.values.values) !== JSON.stringify(b.values.values)) return 'values differ';
  return null;
});

check('the script stream is independent of the growth stream', () => {
  const a = playGame('s1', 'gA', alwaysFirst);
  const b = playGame('s1', 'gB', alwaysFirst);
  // Compared over the common prefix: geometry noise can still change *when* a
  // plant dies, which ends the run early, and that is not the streams leaking
  // into each other. What must not differ is which question comes next.
  const n = Math.min(a.history.length, b.history.length);
  for (let i = 0; i < n; i++) {
    if (a.history[i].promptId !== b.history[i].promptId) {
      return `turn ${i + 1} asked ${a.history[i].promptId} vs ${b.history[i].promptId}`;
    }
  }
  if (n < 3) return 'both runs ended too early to compare';
  if (JSON.stringify(a.plant) === JSON.stringify(b.plant)) return 'changing the growth seed changed nothing';
  return null;
});

check('different answers on the same seed produce a different plant', () => {
  const a = playGame('s2', 'g2', alwaysFirst);
  const b = playGame('s2', 'g2', alwaysLast);
  return JSON.stringify(a.plant) === JSON.stringify(b.plant) ? 'plants are identical' : null;
});

// ----------------------------------------------------------------- angles --

check('every run sits exactly on 0, 45 or 90 degrees', () => {
  // This assertion used to require the opposite as well — that runs departed
  // from the lattice by a couple of degrees, on the argument that a perfectly
  // straight member reads as a drawing rather than as grown material. Held up
  // against the reference constructions that argument does not survive: they
  // are made of pieces cut and joined at right angles and half-right angles,
  // and the wobble only blurred the single rule the whole form is built on.
  // The lower bound is gone and the discipline is now exact.
  const offs = [];
  for (let s = 0; s < 25; s++) {
    const e = playGame('ang' + s, 'angg' + s, s % 2 ? alwaysFirst : alwaysLast, 26);
    for (const sec of e.plant.sections) {
      for (const seg of sec.segments) {
        for (let i = 1; i < seg.points.length; i++) {
          const dx = seg.points[i].x - seg.points[i - 1].x;
          const dy = seg.points[i].y - seg.points[i - 1].y;
          if (Math.hypot(dx, dy) < 1e-9) continue;
          const deg = (Math.atan2(dx, dy) * 180) / Math.PI;
          offs.push(Math.abs(((deg + 22.5 + 360) % 45) - 22.5));
        }
      }
    }
  }
  offs.sort((a, b) => a - b);
  const mean = offs.reduce((a, b) => a + b, 0) / offs.length;
  const p99 = offs[Math.floor(offs.length * 0.99)];
  const worst = offs[offs.length - 1];
  if (mean > 1e-6) return `runs average ${mean.toFixed(4)} degrees off the lattice`;
  if (worst > 1e-6) return `a run sat ${worst.toFixed(4)} degrees off the lattice`;
  return null;
});

check('a stem is made of straight runs, not one corner per step', () => {
  // If every step turned, the 45 degree rule would just read as a jagged curve.
  // A corner is a real change of bearing, which now means any turn at all.
  let steps = 0;
  let corners = 0;
  for (let s = 0; s < 12; s++) {
    const e = playGame('run' + s, 'rung' + s, alwaysFirst, 24);
    for (const sec of e.plant.sections) {
      for (const seg of sec.segments) {
        for (let i = 2; i < seg.points.length; i++) {
          const a = seg.points[i - 1];
          const b = seg.points[i - 2];
          const c = seg.points[i];
          const d1 = Math.atan2(a.x - b.x, a.y - b.y);
          const d2 = Math.atan2(c.x - a.x, c.y - a.y);
          let d = d2 - d1;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          steps++;
          if (Math.abs(d) > 0.175) corners++;
        }
      }
    }
  }
  const ratio = corners / Math.max(1, steps);
  return ratio > 0.6 ? `${Math.round(ratio * 100)}% of steps turn — there are no runs` : null;
});

// --------------------------------------------------------------- vitality --

check('no single answer can drop vitality by more than the cap', () => {
  let worst = 0;
  for (let s = 0; s < 30; s++) {
    const rng = makeRng('drop:' + s);
    const e = new Engine('d' + s, 'dg' + s);
    e.start();
    let prev = e.vit.vitality;
    for (let i = 0; i < 30 && !e.finished; i++) {
      const p = e.prompt;
      if (!p) break;
      e.answer(p.type === 'binary' || p.type === 'quad'
        ? { index: rng.int(0, p.options.length - 1) }
        : { t: rng() });
      worst = Math.max(worst, prev - e.vit.vitality);
      prev = e.vit.vitality;
    }
  }
  return worst > TUNING.MAX_DAMAGE + 1e-9
    ? `a turn cost ${worst.toFixed(4)}, cap is ${TUNING.MAX_DAMAGE}`
    : null;
});

check('death always takes at least ten answers', () => {
  let soonest = Infinity;
  for (let s = 0; s < 60; s++) {
    const e = playGame('k' + s, 'kg' + s, alwaysLast, 40);
    if (e.ending === 'natural') soonest = Math.min(soonest, e.history.length);
  }
  if (soonest === Infinity) return null; // nothing died in this sample, checked elsewhere
  return soonest < 10 ? `a plant died after ${soonest} answers` : null;
});

check('a plant can die, and considered play usually does not', () => {
  let careless = 0;
  let considered = 0;
  const RUNS = 40;
  for (let s = 0; s < RUNS; s++) {
    if (playGame('c' + s, 'cg' + s, alwaysLast, 26).ending === 'natural') careless++;
    const mid = (p) => (p.type === 'binary' || p.type === 'quad'
      ? { index: p.type === 'binary' ? s % 2 : 1 + (s % 2) }
      : { t: 0.45 + (s % 3) * 0.03 });
    if (playGame('m' + s, 'mg' + s, mid, 26).ending === 'natural') considered++;
  }
  if (careless === 0) return 'no careless run ever died';
  if (considered / RUNS > 0.35) return `considered play died ${considered}/${RUNS} of the time`;
  return null;
});

check('vitality can recover once the strain stops', () => {
  // Push hard into strain, then answer towards the middle for a long time.
  // Searching across seeds rather than trusting one: whether a given run
  // actually strains depends on the plant it happens to build, and a test that
  // silently stops straining stops testing recovery at all.
  // Measured as a rate over many seeds rather than looked for in a few.
  //
  // Thirty seeds turned out to be a lottery: an unrelated change to how the
  // material is chosen consumes the script stream differently, every later
  // prompt shifts with it, and the same mechanism went from six recoveries in
  // fourteen to none — while across a hundred and sixty seeds it sat at a
  // steady twenty-nine per cent throughout. A check that swings like that on a
  // change it has nothing to do with is measuring the sample, not the thing.
  let strainedRuns = 0;
  let recovered = 0;
  let worstCase = null;

  for (let s = 0; s < 160; s++) {
    const e = new Engine('rec' + s, 'recg' + s);
    e.start();
    for (let i = 0; i < 13 && !e.finished; i++) {
      if (!e.prompt) break;
      e.answer(alwaysLast(e.prompt));
    }
    const low = e.vit.vitality;
    if (e.finished || low > 0.80) continue; // this run never got into trouble
    strainedRuns++;
    for (let i = 0; i < 16 && !e.finished; i++) {
      const p = e.prompt;
      if (!p) break;
      e.answer(p.type === 'binary' || p.type === 'quad' ? { index: 0 } : { t: 0.5 });
    }
    if (e.vit.vitality > low + 0.05) recovered++;
    else if (!worstCase) worstCase = `${low.toFixed(2)} -> ${e.vit.vitality.toFixed(2)}`;
  }

  if (strainedRuns < 20) return `only ${strainedRuns} of 160 runs strained at all — cannot test recovery`;
  const rate = recovered / strainedRuns;
  // Around 29 per cent. Recovery is meant to be reachable, not easy: the
  // threshold is placed low enough to survive the ordinary seed-to-seed spread
  // and high enough to fail outright if the way back closes.
  if (rate < 0.15) {
    return `only ${recovered} of ${strainedRuns} strained plants recovered (${(rate * 100).toFixed(0)}%, e.g. ${worstCase})`;
  }
  return null;
});

// ----------------------------------------------------------------- values --

check('values stay strictly inside 0..1', () => {
  for (let s = 0; s < 25; s++) {
    const e = playGame('v' + s, 'vg' + s, s % 2 ? alwaysFirst : alwaysLast, 40);
    for (const k of VALUE_KEYS) {
      const v = e.values.values[k];
      if (!(v > 0 && v < 1)) return `${k} reached ${v}`;
    }
  }
  return null;
});

check('a value moves less the further out it already is', () => {
  const v = new ValueState();
  const first = (() => { v.apply({ expansion: 0.14 }); return v.values.expansion - 0.5; })();
  for (let i = 0; i < 12; i++) v.apply({ expansion: 0.14 });
  const before = v.values.expansion;
  v.apply({ expansion: 0.14 });
  const late = v.values.expansion - before;
  return late >= first ? `a late push moved ${late.toFixed(4)}, an early one ${first.toFixed(4)}` : null;
});

check('an unreinforced answer fades but does not vanish', () => {
  const v = new ValueState();
  v.apply({ attachment: 0.14 });
  const peak = v.values.attachment;
  for (let i = 0; i < 8; i++) v.apply({});
  const now = v.values.attachment;
  if (now >= peak) return 'no decay at all';
  if (now <= 0.5 + (peak - 0.5) * 0.25) return 'decayed away almost entirely';
  return null;
});

// ---------------------------------------------------------------- prompts --

check('prompt bank is well formed', () => {
  const ids = new Set();
  for (const p of PROMPTS) {
    if (ids.has(p.id)) return `duplicate id ${p.id}`;
    ids.add(p.id);
    if (!p.text) return `${p.id} has no text`;
    const tables = [];
    if (p.type === 'binary' || p.type === 'quad') {
      const want = p.type === 'binary' ? 2 : 4;
      if (p.options?.length !== want) return `${p.id} needs ${want} options`;
      for (const o of p.options) {
        if (!o.label) return `${p.id} has an unlabelled option`;
        tables.push(o.effects);
      }
    } else if (p.type === 'slider') {
      if (p.poles?.length !== 2) return `${p.id} needs two poles`;
      tables.push(p.effects);
    } else if (p.type === 'action') {
      if (!p.action?.kind) return `${p.id} has no action kind`;
      tables.push(p.effects);
    } else return `${p.id} has unknown type ${p.type}`;

    for (const t of tables) {
      const keys = Object.keys(t || {});
      if (!keys.length) return `${p.id} has an option with no effect`;
      for (const k of keys) {
        if (!VALUE_KEYS.includes(k)) return `${p.id} touches unknown value "${k}"`;
        for (const x of (Array.isArray(t[k]) ? t[k] : [t[k]])) {
          if (typeof x !== 'number' || Math.abs(x) > 0.2) return `${p.id}.${k} effect ${x} is out of range`;
        }
      }
    }
  }
  return null;
});

check('every value can be pushed both ways', () => {
  const dir = Object.fromEntries(VALUE_KEYS.map((k) => [k, { up: 0, down: 0 }]));
  for (const p of PROMPTS) {
    const tables = p.options ? p.options.map((o) => o.effects) : [p.effects];
    for (const t of tables) {
      for (const [k, val] of Object.entries(t || {})) {
        for (const x of (Array.isArray(val) ? val : [val])) {
          if (x > 0.02) dir[k].up++;
          if (x < -0.02) dir[k].down++;
        }
      }
    }
  }
  for (const k of VALUE_KEYS) {
    if (dir[k].up < 4 || dir[k].down < 4) return `${k} has ${dir[k].up} up / ${dir[k].down} down`;
  }
  return null;
});

check('all four response types get used in a normal game', () => {
  const seen = new Set();
  for (let s = 0; s < 8; s++) {
    for (const h of playGame('t' + s, 'tg' + s, alwaysFirst, 24).history) seen.add(h.type);
  }
  const missing = ['binary', 'quad', 'slider', 'action'].filter((t) => !seen.has(t));
  return missing.length ? `never saw ${missing.join(', ')}` : null;
});

check('every prompt has a season, and weather is exactly the quiet ones', () => {
  for (const p of PROMPTS) {
    if (!SEASONS.includes(p.season)) return `${p.id} has season ${p.season}`;
    if ((p.season === 'weather') !== (p.tone === 'quiet')) return `${p.id} is ${p.tone} in ${p.season}`;
  }
  for (const s of SEASONS) {
    const n = PROMPTS.filter((p) => p.season === s).length;
    if (n < 10) return `${s} has only ${n} prompts`;
  }
  return null;
});

check('questions follow the seasons', () => {
  let fit = 0, heavy = 0, quiet = 0, total = 0;
  for (let s = 0; s < 12; s++) {
    const h = playGame('se' + s, 'seg' + s, alwaysFirst, 40).history;
    for (let i = 0; i < h.length; i++) {
      total++;
      if (h[i].season === 'weather') { quiet++; continue; }
      heavy++;
      if (h[i].season === seasonAt(i)) fit++;
      if (i < ROOTS_TURNS && h[i].season !== 'roots') return `turn ${i + 1} was ${h[i].season}, not roots`;
    }
  }
  if (fit / heavy < 0.9) return `only ${Math.round(100 * fit / heavy)}% of heavy prompts were in season`;
  const q = quiet / total;
  if (q < 0.1 || q > 0.3) return `${Math.round(100 * q)}% of turns were quiet`;
  return null;
});

// ------------------------------------------------------------------ names --

check('every answer has name words, and every pair of values a genus', () => {
  for (const p of PROMPTS) {
    const bank = WORDS[p.id];
    const want = p.options ? p.options.length : 3;
    if (!bank || bank.length !== want) return `${p.id} needs ${want} word pairs`;
    for (const [adj, noun] of bank) {
      if (!/^[A-Z][a-z-]+$/.test(adj)) return `${p.id}: adjective "${adj}"`;
      if (!/^[A-Z][a-z]+$/.test(noun)) return `${p.id}: noun "${noun}" should be one plain word`;
    }
  }
  for (const id of Object.keys(WORDS)) if (!PROMPTS.some((p) => p.id === id)) return `words for unknown prompt ${id}`;
  for (let i = 0; i < VALUE_KEYS.length; i++) {
    for (let j = i + 1; j < VALUE_KEYS.length; j++) {
      const key = [VALUE_KEYS[i], VALUE_KEYS[j]].sort().join('+');
      if (!GENERA[key]) return `no genus for ${key}`;
    }
  }
  return null;
});

check('a name comes from the answers alone, and survives a save', () => {
  const a = playGame('nm1', 'g1', alwaysFirst, 14);
  const b = playGame('nm1', 'g2', alwaysFirst, 14);
  // Different growth noise, same answers: the name must not notice.
  if (a.history.length === b.history.length && cultivarName(a).text !== cultivarName(b).text) {
    return `${cultivarName(a).text} vs ${cultivarName(b).text}`;
  }
  const c = Engine.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
  if (cultivarName(c).text !== cultivarName(a).text) return 'the name changed after reloading';
  return null;
});

check('names are nearly always different, and some journeys are steady', () => {
  const seen = new Set();
  let steady = 0, games = 0;
  for (let s = 0; s < 300; s++) {
    const e = playGame('nu' + s, 'nug' + s,
      (p, i) => (p.options ? { index: (i * 5 + s * 3 + (i * s) % 7) % p.options.length } : { t: ((i * 37 + s * 11) % 100) / 100 }),
      6 + (s % 30));
    const n = cultivarName(e);
    if (!n.text.startsWith(n.genus.name + " '")) return `malformed name ${n.text}`;
    if ((e.history.length >= 12) !== Boolean(n.closing)) return `${e.history.length} answers, closing "${n.closing}"`;
    seen.add(n.text);
    if (n.steady) steady++;
    games++;
  }
  if (seen.size / games < 0.95) return `only ${seen.size} different names in ${games} games`;
  if (steady / games < 0.05 || steady / games > 0.4) return `${Math.round(100 * steady / games)}% steady`;
  return null;
});

check('the same prompt is not asked twice in one game', () => {
  for (let s = 0; s < 12; s++) {
    const ids = playGame('r' + s, 'rg' + s, alwaysFirst, 30).history.map((h) => h.promptId);
    if (new Set(ids).size !== ids.length) return `a prompt repeated within ${ids.length} turns`;
  }
  return null;
});

check('the same response type is never asked three times running', () => {
  for (let s = 0; s < 12; s++) {
    const types = playGame('y' + s, 'yg' + s, alwaysFirst, 30).history.map((h) => h.type);
    for (let i = 2; i < types.length; i++) {
      if (types[i] === types[i - 1] && types[i] === types[i - 2]) return `three ${types[i]} in a row`;
    }
  }
  return null;
});

check('continuous responses actually depend on where you put them', () => {
  const slider = PROMPTS.find((p) => p.type === 'slider');
  const lo = resolveEffects(slider.effects, 0);
  const hi = resolveEffects(slider.effects, 1);
  return JSON.stringify(lo) === JSON.stringify(hi) ? 'slider ends resolve identically' : null;
});

// ------------------------------------------------------- scene and matter --

check('material and scene changes stay rare enough to register', () => {
  for (let s = 0; s < 15; s++) {
    const e = playGame('h' + s, 'hg' + s, alwaysLast, 26);
    const secs = e.plant.sections.filter((x) => x.promptId);
    let matRun = 0;
    let envRun = 0;
    for (let i = 1; i < secs.length; i++) {
      matRun = secs[i].materialId === secs[i - 1].materialId ? matRun + 1 : 0;
      envRun = secs[i].envId === secs[i - 1].envId ? envRun + 1 : 0;
      if (secs[i].materialId !== secs[i - 1].materialId && matRun !== 0) return 'material bookkeeping is wrong';
      if (i > 1 && secs[i].materialId !== secs[i - 1].materialId
          && secs[i - 1].materialId !== secs[i - 2].materialId) {
        return 'material changed on two consecutive sections';
      }
    }
  }
  return null;
});

check('a long game visits several materials and several scenes', () => {
  const e = playGame('long', 'longg', alwaysFirst, 24);
  const s = e.stats();
  if (s.materials.length < 3) return `only ${s.materials.length} materials in ${s.age} answers`;
  if (s.environments.length < 3) return `only ${s.environments.length} scenes in ${s.age} answers`;
  return null;
});

check('material and scene do not predict each other', () => {
  // A material should be seen under more than one sky across many games.
  // Rare materials that turned up in a single game say nothing either way, so
  // they are left out: which rare ones those are shifts whenever the prompt bank
  // changes, and counting them made this fail on luck.
  const pairs = new Map();
  const games = new Map();
  for (let s = 0; s < 30; s++) {
    const seen = new Set();
    for (const sec of playGame('p' + s, 'pg' + s, s % 2 ? alwaysFirst : alwaysLast, 22).plant.sections) {
      if (!sec.materialId) continue;
      if (!pairs.has(sec.materialId)) pairs.set(sec.materialId, new Set());
      pairs.get(sec.materialId).add(sec.envId);
      seen.add(sec.materialId);
    }
    for (const m of seen) games.set(m, (games.get(m) || 0) + 1);
  }
  const stuck = [...pairs.entries()]
    .filter(([m, envs]) => games.get(m) > 1 && envs.size < 2).map(([m]) => m);
  return stuck.length > 3 ? `these only ever appeared under one sky: ${stuck.join(', ')}` : null;
});

/** A few real plants, played out, for the checks on parts below. */
const partGames = (tag, n = 24) => Array.from({ length: n }, (_, s) => playGame(tag + s, tag + 'g' + s,
  (p, i) => (p.options ? { index: (i * 7 + s) % p.options.length } : { t: ((i * 37 + s) % 10) / 10 }), 22));

check('flowers do not land on flowers, and stems do not grow through them', () => {
  // Every part claims the ground it is drawn in (partBoxes in growth.js), and
  // nothing may stand in it: not another part, and no stem as drawn — not a
  // later one, not an earlier one, not the one it grows from past its stalk.
  let onParts = 0;
  let through = 0;
  let parts = 0;
  for (const e of partGames('fl')) {
    const nodes = [];
    const stems = [];
    for (const sec of e.plant.sections) {
      nodes.push(...sec.nodes);
      for (const g of sec.segments) {
        for (let i = 1; i < g.points.length; i++) stems.push([g.points[i - 1], g.points[i]]);
      }
    }
    parts += nodes.length;
    const boxes = nodes.map(partBoxes);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (boxes[i].some((a) => boxes[j].some((b) => boxesOverlap(a, b)))) onParts++;
      }
      const n = nodes[i];
      const hit = stems.some(([a, b]) => {
        const r = Math.max(a.w, b.w) * 0.5 * STEM_DRAWN;
        // at the part's own joint the two share the stalk, and ten units round
        // the joint itself (the same allowance the drawn check below makes)
        const fromA = Math.hypot(a.x - n.x, a.y - n.y) < 1e-6;
        const fromB = Math.hypot(b.x - n.x, b.y - n.y) < 1e-6;
        let [x0, y0, x1, y1] = [a.x, a.y, b.x, b.y];
        if (fromA || fromB) {
          const len = Math.hypot(x1 - x0, y1 - y0);
          if (len <= 10) return false;
          const k = 10 / len;
          if (fromA) { x0 += (x1 - x0) * k; y0 += (y1 - y0) * k; } else { x1 -= (x1 - x0) * k; y1 -= (y1 - y0) * k; }
        }
        return boxes[i].some((bx) => !(bx.stalk && (fromA || fromB)) && segBoxDist(x0, y0, x1, y1, bx) < r);
      });
      if (hit) through++;
    }
  }
  if (onParts) return `${onParts} parts landed on other parts`;
  if (through) return `${through} of ${parts} parts have a stem through them`;
  return null;
});

check('no part is drawn touching a stem', () => {
  // The claims above are growth's own account; this is the picture. Each part
  // of real plants drawn on its own where it grew, every vertex of it measured
  // against every stem as drawn. Only its own joint, where stalk and stem
  // meet, is allowed.
  const F = 15;
  const off = { id: 1, depth: 0, tipId: 99, broken: false, z0: 0, zSlope: 0,
    points: [{ x: 0, y: -1e5, w: 0.01, k: 0 }, { x: 0, y: -1e5 + 1, w: 0.01, k: 4, dir: 0 }] };
  const alone = (nodes) => ({ baseHue: 100, tips: [],
    sections: [{ step: 1, steps: 8, materialId: 'botanical', segments: [off], nodes }] });
  const bare = buildPlant(alone([])).data.length / F;
  let touching = 0;
  let parts = 0;
  let example = null;
  for (const e of partGames('dt', 8)) {
    const stems = [];
    for (const sec of e.plant.sections) for (const g of sec.segments) {
      for (let i = 1; i < g.points.length; i++) stems.push([g.points[i - 1], g.points[i]]);
    }
    for (const sec of e.plant.sections) {
      for (const n of sec.nodes) {
        parts++;
        const d = buildPlant(alone([n])).data;
        let hit = false;
        for (let i = bare * F; i < d.length && !hit; i += F) {
          const x = d[i];
          const y = d[i + 1];
          if (Math.hypot(x - n.x, y - n.y) < 10) continue;
          for (const [a, b] of stems) {
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const s = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
            const r = (a.w + (b.w - a.w) * s) * 0.5 * STEM_DRAWN;
            if (Math.hypot(x - (a.x + dx * s), y - (a.y + dy * s)) < r) { hit = true; break; }
          }
        }
        if (hit) { touching++; example = example || n.kind; }
      }
    }
  }
  if (touching) return `${touching} of ${parts} parts are drawn touching a stem (a ${example}, for one)`;
  return null;
});

check('every part is drawn inside the ground it claims', () => {
  // growth.js claims ground for each kind from a table measured off the
  // renderer's own parts; this is what keeps the two in step. Each part from a
  // few real games, drawn alone on a stub of stem in both looks, every vertex
  // measured in the part's own frame against its kind's widths.
  const F = 15;
  const stub = () => ({ id: 1, depth: 0, tipId: 99, broken: false, z0: 0, zSlope: 0,
    points: [{ x: 0, y: -400, w: 6, k: 0 }, { x: 0, y: 400, w: 6, k: 4, dir: 0 }] });
  const alone = (nodes) => ({ baseHue: 100, tips: [],
    sections: [{ step: 1, steps: 8, materialId: 'botanical', segments: [stub()], nodes }] });
  const sample = [];
  for (let s = 0; s < 8; s++) {
    const e = playGame('pd' + s, 'pdg' + s, s % 2 ? alwaysFirst : alwaysLast, 22);
    for (const sec of e.plant.sections) sample.push(...sec.nodes);
  }
  let worst = null;
  for (const style of ['real', 'toon']) {
    setStyle(style);
    const bare = buildPlant(alone([])).data.length / F;
    for (const n0 of sample) {
      const n = { ...n0, x: 0, y: 0, z: 0 };
      const d = buildPlant(alone([n])).data;
      const su = Math.sin(n.angle);
      const cu = Math.cos(n.angle);
      const widths = PART_WIDTH[n.kind];
      for (let i = bare * F; i < d.length; i += F) {
        const u = (d[i] * su + d[i + 1] * cu) / n.size;
        const v = Math.abs(d[i] * cu - d[i + 1] * su) / n.size;
        const band = Math.max(0, Math.floor(u / PART_BAND));
        const out = u < -0.02 ? -u : Math.max(0, v - (widths[band] ?? 0));
        if (out > 0.005 && (!worst || out > worst.out)) worst = { out, kind: n.kind, style, u, v };
      }
    }
  }
  setStyle('toon');
  if (worst) {
    return `a ${worst.kind} (${worst.style}) is drawn ${worst.out.toFixed(2)} of its size outside its ground, at u ${worst.u.toFixed(2)} v ${worst.v.toFixed(2)}`;
  }
  return null;
});

check('members do not grow through one another, or back the way they came', () => {
  // Two rules, both absolute rather than merely unlikely, because either one
  // read as a mistake whenever it happened. A tip may not step onto ground some
  // other member already stands in, and may not turn back along the bearing its
  // last run arrived on.
  let touching = 0;
  let reversed = 0;
  let games = 0;
  for (let s = 0; s < 24; s++) {
    const e = playGame('ov' + s, 'ovg' + s, alwaysFirst, 20);
    const segs = [];
    for (const sec of e.plant.sections) for (const g of sec.segments) segs.push(g);
    // Where each member began. A stem that is boxed in starts again from the
    // side of the old one (restartPoint in growth.js), and touches it there by
    // design: that is a joint, not one member growing through another.
    const began = new Map();
    for (const g of segs) if (!began.has(g.tipId)) began.set(g.tipId, g.points[0]);
    const atJoint = (p, q, j) => j && Math.hypot(p.x - j.x, p.y - j.y) < 40
      && Math.hypot(q.x - j.x, q.y - j.y) < 40;
    for (let a = 0; a < segs.length; a++) {
      for (let b = a + 1; b < segs.length; b++) {
        if (segs[a].tipId === segs[b].tipId) continue;   // one member continuing
        const ja = began.get(segs[a].tipId);
        const jb = began.get(segs[b].tipId);
        for (const p of segs[a].points) {
          for (const q of segs[b].points) {
            const d = Math.hypot(p.x - q.x, p.y - q.y);
            if (d > 1e-6 && d < (p.w + q.w) * 0.5 && !atJoint(p, q, ja) && !atJoint(p, q, jb)) touching++;
          }
        }
      }
      // and no point may sit exactly where the one before last did
      const pts = segs[a].points;
      for (let i = 2; i < pts.length; i++) {
        if (Math.hypot(pts[i].x - pts[i - 2].x, pts[i].y - pts[i - 2].y) < 1e-6) reversed++;
      }
    }
    games++;
  }
  const per = touching / games;
  if (reversed) return `${reversed} steps doubled back onto their own previous point`;
  // Fifteen a plant with the rule off; about four with it on, now that the
  // plant is one stem and nothing grows through a part. This asserts the rule
  // is doing its work, not that overlap is gone: what is left is members
  // passing close enough to touch without either of them ever choosing a cell
  // the other had taken, which a grid cannot see and only real
  // segment-to-segment collision would.
  if (per > 6) return `members overlap ${per.toFixed(1)} times a plant`;
  return null;
});

check('the plant is one stem, and each answer carries on where the last one stopped', () => {
  // A fork put growth in two places at once, and handing a turn from one arm
  // to another threw the camera across the plant. Growth may restart from a
  // point near where it stopped when it is boxed in, but never from far off.
  for (let s = 0; s < 24; s++) {
    const e = playGame(`one${s}`, `stem${s}`, (p, i) => (p.options
      ? { index: (s + i) % p.options.length } : { t: ((s * 7 + i * 3) % 10) / 10 }));
    let end = null;
    for (const sec of e.plant.sections.slice(1)) {
      if (sec.segments.length > 1) return `section ${sec.step} grew ${sec.segments.length} members`;
      const seg = sec.segments[0];
      if (!seg) continue;
      if (end) {
        const jump = Math.hypot(seg.points[0].x - end.x, seg.points[0].y - end.y);
        if (jump > 300) return `section ${sec.step} started ${Math.round(jump)} units from where growth stopped`;
      }
      end = seg.points[seg.points.length - 1];
    }
  }
  return null;
});

check('a bloom opens over several steps instead of appearing at once', () => {
  // The stem was revealed a step at a time while every node on it arrived at
  // full size the instant the stem reached it, so a whole flower head appeared
  // between one frame and the next. Sampling the reveal finely, no single step
  // should account for most of the growth — that signature is a pop.
  const e = playGame('open', 'openg', alwaysFirst, 12);
  const withNodes = e.plant.sections.filter((s) => s.nodes.length);
  if (!withNodes.length) return 'no section grew a node, so this is untested';
  const section = withNodes[withNodes.length - 1];

  // Built on its own and without its stem.
  //
  // The whole plant's extent is set by everything that grew before it, and the
  // stem inside the section reveals a point at a time — genuinely in steps —
  // which swamps what is being asked about here. What is left is the blooms.
  const alone = { ...e.plant, sections: [{ ...section, segments: [] }] };
  const F = 15;
  // Only the samples that actually have a bloom in them. Before the stem
  // reaches its first node the mesh is empty, and an unset bounding box there
  // is not a size — measuring it anyway reported a pop where there was simply
  // nothing yet.
  const spread = (progress) => {
    const m = buildPlant(alone, { step: section.step, progress });
    if (!m.data.length) return null;
    let minX = 1e9;
    let maxX = -1e9;
    let minY = 1e9;
    let maxY = -1e9;
    for (let i = 0; i < m.data.length; i += F) {
      minX = Math.min(minX, m.data[i]); maxX = Math.max(maxX, m.data[i]);
      minY = Math.min(minY, m.data[i + 1]); maxY = Math.max(maxY, m.data[i + 1]);
    }
    return (maxX - minX) + (maxY - minY);
  };

  const steps = 30;
  const at = [];
  for (let i = 0; i <= steps; i++) {
    const v = spread(i / steps);
    if (v !== null) at.push(v);
  }
  if (at.length < 6) return `only ${at.length} samples had a bloom in them`;
  let biggest = 0;
  for (let i = 1; i < at.length; i++) biggest = Math.max(biggest, Math.abs(at[i] - at[i - 1]));
  const total = Math.abs(at[at.length - 1] - at[0]);
  if (total < 1) return 'the bloom is the same size from the moment it appears — it is popping in';
  const share = biggest / total;
  return share > 0.75
    ? `one step accounted for ${(share * 100).toFixed(0)}% of the opening — it is popping in`
    : null;
});

check('nothing grows through the floor, and reaching it ends the life', () => {
  // Growth is planar and knows nothing about the sweep the renderer builds
  // later, so a plant driven downwards used to carry straight on through the
  // floor and out of the world underneath it.
  let grounded = 0;
  let below = null;
  let keptAsking = null;
  for (let s = 0; s < 90; s++) {
    // pushed down hard, which is the only way to get there
    const e = playGame('gr' + s, 'grg' + s, (p) => (p.options ? { index: 0 } : { t: 0.05 }), 26);
    for (const sec of e.plant.sections) {
      for (const seg of sec.segments) {
        for (const p of seg.points) {
          if (p.y < -1e-9 && !below) below = `step ${sec.step} reached y = ${p.y.toFixed(1)}`;
        }
      }
    }
    if (e.plant.grounded) {
      grounded++;
      if (!e.finished) keptAsking = `seed ${s} touched down and was still asking questions`;
      else if (e.ending !== 'grounded') keptAsking = `seed ${s} ended as '${e.ending}'`;
    }
  }
  if (below) return below;
  if (!grounded) return 'no plant reached the floor in 90 games, so this is untested';
  if (keptAsking) return keptAsking;
  return null;
});

check('a rough material displaces its own surface', () => {
  // Relief is two separate things and only one of them is shading. The
  // displacement moves the mesh, so no amount of light can reveal whether it is
  // there — and it was briefly not being applied at all while every shading
  // measurement stayed perfectly healthy. Measured against a build of the same
  // plant with displacement disabled, which isolates it exactly.
  const e = playGame('disp', 'dispg', alwaysFirst, 9);
  const F = 15;
  const positions = () => {
    const m = buildPlant(e.plant);
    const a = [];
    for (let i = 0; i < m.data.length; i += F) a.push(m.data[i], m.data[i + 1], m.data[i + 2]);
    return a;
  };
  const widths = [];
  for (const sec of e.plant.sections) {
    for (const seg of sec.segments) for (const p of seg.points) widths.push(p.w);
  }
  widths.sort((a, b) => a - b);
  // as drawn, which is narrower than the width growth works with
  const radius = widths[widths.length >> 1] / 2 * STEM_DRAWN;

  // Relief belongs to the lit look; printed, the plant is pressed flat and a
  // surface is told by its pattern instead.
  setStyle('real');
  const shift = (id) => {
    for (const sec of e.plant.sections) sec.materialId = id;
    setDisplacement(true);
    const on = positions();
    setDisplacement(false);
    const off = positions();
    setDisplacement(true);
    // Averaged over the vertices that displacement actually touches. Taking it
    // over every vertex in the plant measured the *ratio* of tube and sphere
    // vertices to blade ones as much as the displacement itself, so adding leaf
    // kinds — which carry none — quietly halved the number without anything
    // about the surfaces changing.
    let s = 0;
    let n2 = 0;
    for (let i = 0; i < on.length; i += 3) {
      const d = (on[i] - off[i]) ** 2 + (on[i + 1] - off[i + 1]) ** 2
        + (on[i + 2] - off[i + 2]) ** 2;
      if (d > 1e-12) { s += d; n2++; }
    }
    return n2 ? Math.sqrt(s / n2) / radius : 0;
  };

  const wool = shift('wool');
  const rust = shift('rust');
  const glass = shift('glass');
  setStyle('toon');
  if (wool < 0.08) return `wool barely moves its surface (${(wool * 100).toFixed(1)}% of radius)`;
  if (rust < 0.08) return `rust barely moves its surface (${(rust * 100).toFixed(1)}% of radius)`;
  if (glass > 0.02) return `glass should stay smooth (${(glass * 100).toFixed(1)}% of radius)`;
  if (wool < glass * 4) return 'wool is no rougher than glass';
  return null;
});

check('every material and environment is reachable', () => {
  // Enough games that a material appearing in roughly one switch in a hundred
  // still turns up. With thirty-five materials the old sample was too small to
  // tell "rare" from "unreachable", which is a distinction this check exists to
  // make.
  const mats = new Map();
  const envs = new Set();
  for (let s = 0; s < 320; s++) {
    const answer = s % 3 === 0 ? alwaysFirst : s % 3 === 1 ? alwaysLast
      : (p) => (p.options ? { index: s % p.options.length } : { t: (s % 10) / 10 });
    for (const sec of playGame('a' + s, 'ag' + s, answer, 26).plant.sections) {
      if (sec.materialId) mats.set(sec.materialId, (mats.get(sec.materialId) || 0) + 1);
      if (sec.envId) envs.add(sec.envId);
    }
  }
  const missM = MATERIALS.filter((m) => !mats.has(m.id)).map((m) => m.id);
  const rarest = MATERIALS
    .map((m) => [m.id, mats.get(m.id) || 0])
    .sort((a, b) => a[1] - b[1])[0];
  const missE = ENVIRONMENTS.filter((e) => !envs.has(e.id)).map((e) => e.id);
  const parts = [];
  if (missM.length) parts.push(`materials never seen: ${missM.join(', ')}`);
  if (!missM.length && rarest[1] < 6) {
    parts.push(`${rarest[0]} appeared only ${rarest[1]} times in 320 games`);
  }
  if (missE.length) parts.push(`scenes never seen: ${missE.join(', ')}`);
  return parts.length ? parts.join('; ') : null;
});

// ------------------------------------------------------- saving and ending --

check('a saved game reloads and can be carried on', () => {
  const a = playGame('save', 'saveg', alwaysFirst, 9);
  const json = JSON.parse(JSON.stringify(a.toJSON()));
  const b = Engine.fromJSON(json);
  if (b.plant.sections.length !== a.plant.sections.length) return 'section count changed';
  if (JSON.stringify(b.values.values) !== JSON.stringify(a.values.values)) return 'values changed';
  if (!b.prompt) return 'restored game has no question to answer';
  const before = b.plant.sections.length;
  b.answer(alwaysFirst(b.prompt));
  if (b.plant.sections.length !== before + 1) return 'could not grow after restoring';
  return null;
});

check('voluntary ending closes the game and reports on it', () => {
  const e = playGame('vol', 'volg', alwaysFirst, 8);
  if (!e.canFinish()) return 'finishing was not offered after 8 answers';
  e.finish('voluntary');
  const s = e.stats();
  if (!e.finished || e.ending !== 'voluntary') return 'ending not recorded';
  if (!(s.height > 0) || !(s.length > 0)) return 'specimen has no measurements';
  if (!s.materialNames.length || !s.environmentNames.length) return 'specimen lists nothing it was made of';
  return null;
});

check('finishing is not offered before the plant is anything', () => {
  const e = new Engine('early', 'earlyg');
  e.start();
  return e.canFinish() ? 'offered to finish at step 0' : null;
});

check('a dead plant stops asking questions', () => {
  for (let s = 0; s < 40; s++) {
    const e = playGame('dd' + s, 'ddg' + s, alwaysLast, 40);
    if (e.ending === 'natural') {
      if (e.prompt) return 'a dead plant was still asking';
      if (!e.finished) return 'a dead plant was not marked finished';
      if (e.answer({ index: 0 }) !== null) return 'a dead plant accepted an answer';
      return null;
    }
  }
  return null;
});

check('every material has an entry in all three surface tables', () => {
  // A missing entry does not throw: the lookup quietly yields undefined and the
  // material borrows whatever sorts nearby. flock wore botanical's surface for a
  // week that way, and a missing cloud entry turned the whole world black.
  const src = readFileSync(new URL('../src/gl/scene.js', import.meta.url), 'utf8');
  const keysOf = (name) => {
    const start = src.indexOf(name + ' = {');
    const body = src.slice(start, src.indexOf('\n};', start));
    return new Set(body.split(':').slice(0, -1).map((c) => c.split(/[^A-Za-z0-9_]/).pop()));
  };
  const tables = { MAT_ID: keysOf('MAT_ID'), SURFACE: keysOf('SURFACE'), PIGMENT: keysOf('PIGMENT') };
  const missing = [];
  for (const id of [...MATERIALS.map((m) => m.id), 'cloud', 'terrain', 'scenery', 'thicket', 'water', 'rock', 'wing', 'fish', 'frond', 'grass', 'leaves']) {
    for (const [name, keys] of Object.entries(tables)) if (!keys.has(id)) missing.push(name + '.' + id);
  }
  return missing.length ? 'no entry for ' + missing.join(', ') : null;
});

check('every place builds without a NaN in it', () => {
  // tube() reads its path points as { x, y, z, r }. Every tube in the world —
  // trunks, grass, ferns, coral, stalagmites, driftwood — was handing it
  // { p: [x, y, z], r } instead, so b.x - a.x was undefined and the whole run of
  // geometry came out NaN. NaN triangles are silently dropped by the rasteriser,
  // so nothing errored and nothing drew: the forest was invisible, the grass was
  // invisible, and every place was reduced to the spheres it had in common,
  // which is exactly why they all looked alike.
  const bad = [];
  for (let i = 0; i < PLACES.length; i++) {
    const b = buildBackdrop(ENVIRONMENTS[0], { w: 900, h: 1200 }, i);
    let n = 0;
    for (let v = 0; v < b.data.length; v++) if (Number.isNaN(b.data[v])) n++;
    if (n) bad.push(PLACES[i].id + ': ' + n);
  }
  return bad.length ? 'NaN vertex data in ' + bad.join(', ') : null;
});

// ------------------------------------------------------- the flat renderer --
//
// v4 draws the same game in two dimensions (src/flat). There is no canvas
// here, so it is run against a stand-in that keeps nothing and checks
// everything it is handed: a NaN in a path is drawn as nothing at all, without
// an error, which is how the 3D world once lost every tube it had (above).

const nonFinite = [];
const finite = (name) => (...args) => {
  for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) { nonFinite.push(name); return; }
};
globalThis.Path2D = class {
  constructor() {
    for (const m of ['moveTo', 'lineTo', 'arc', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo', 'rect']) this[m] = finite('Path2D.' + m);
  }
  closePath() {}
};
function stubCanvas(w, h) {
  const state = {};
  const ctx = new Proxy(state, {
    get(t, k) { return k in t ? t[k] : finite('ctx.' + String(k)); },
    set(t, k, v) {
      if (typeof v === 'number' && !Number.isFinite(v)) nonFinite.push('ctx.' + String(k) + ' =');
      t[k] = v;
      return true;
    },
  });
  return { width: w, height: h, clientWidth: w, clientHeight: h, getContext: () => ctx, toDataURL: () => 'data:,' };
}

check('the flat renderer frames the plant where the 3D one does', () => {
  // main.js frames everything through the renderer's own camera rules, so the
  // two have to agree: exactly with the camera level. Where it tilts down at
  // something lower than the eye can go, a lens leans the picture and a flat
  // drawing only slides it, which is out by a few pixels towards the edges —
  // a fiftieth of the frame is the most it may be (v4 hit-tests through its
  // own projection, so it always agrees with itself).
  const flat = new Renderer2D(stubCanvas(1024, 640), { width: 1024, height: 640, dpr: 1 });
  const solid = { w: 1024, h: 640, worldKind: 0, get eyeFloor() { return 90; }, lens: Renderer3D.prototype.lens };
  const worst = { level: 0, tilted: 0 };
  for (const cam of [{ x: 0, y: 900, zoom: 1 }, { x: 300, y: 2400, zoom: 0.5 }, { x: -800, y: 5000, zoom: 0.2 },
    { x: 0, y: -165, zoom: 1 }, { x: 100, y: 40, zoom: 1.4 }]) {
    for (const [px, py] of [[0, cam.y], [120, cam.y + 80], [-300, cam.y - 200]]) {
      const a = flat.project(cam, px, py);
      const b = Renderer3D.prototype.project.call(solid, cam, px, py);
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const kind = cam.y >= 90 ? 'level' : 'tilted';
      worst[kind] = Math.max(worst[kind], d);
    }
  }
  if (worst.level > 0.01) return `level camera off by ${worst.level.toFixed(3)} px`;
  if (worst.tilted > 640 / 50) return `tilted camera off by ${worst.tilted.toFixed(2)} px`;
  return null;
});

check('the flat plant is made of finite shapes in the plant\'s own inks', () => {
  const games = [['flat-1', 'flat-1', 24], ['flat-2', 'flat-x', 40], ['flat-3', 'flat-3', 8]];
  for (const [seed, growth, turns] of games) {
    const e = playGame(seed, growth, (p, i) => (p.options ? { index: i % p.options.length } : { t: (i * 0.37) % 1 }), turns);
    const shapes = buildFlatPlant(e.plant);
    if (!shapes.length) return `${seed}: no shapes`;
    for (const s of shapes) {
      if (!PLANT_SET.includes(s.ink)) return `${seed}: a ${s.type} printed in an ink the plant does not have`;
      const nums = s.type === 'disc' ? [s.x, s.y, s.r] : s.pts.flatMap((p) => [p.x, p.y, p.l ?? 0, p.r ?? 0]);
      if (nums.some((n) => !Number.isFinite(n))) return `${seed}: a ${s.type} with a non-finite coordinate`;
    }
  }
  return null;
});

check('a section grown in flat ends as the same shapes it settles into', () => {
  // the growing section is made on its own every frame; arrived, it has to be
  // what the whole plant makes of it, or the last frame of growth jumps
  const e = playGame('flat-grow', 'flat-grow', (p, i) => (p.options ? { index: (i * 3) % p.options.length } : { t: 0.6 }), 18);
  const step = e.plant.sections[e.plant.sections.length - 1].step;
  const reveal = { step, progress: 1 };
  const parts = buildFlatPlant(e.plant, reveal, 'settled').length + buildFlatPlant(e.plant, reveal, 'growing').length;
  const whole = buildFlatPlant(e.plant).length;
  return parts === whole ? null : `${parts} shapes in parts, ${whole} whole`;
});

check('every place draws flat without a NaN, day and night, near and far', () => {
  const e = playGame('flat-world', 'flat-world', (p, i) => (p.options ? { index: i % p.options.length } : { t: 0.4 }), 30);
  const step = e.plant.sections[e.plant.sections.length - 1].step;
  const r = new Renderer2D(stubCanvas(900, 700),
    { width: 900, height: 700, dpr: 1.5, makeCanvas: (w, h) => stubCanvas(w, h) });
  const cams = [{ x: 0, y: -165, zoom: 1 }, { x: 200, y: 900, zoom: 1 }, { x: -500, y: 6000, zoom: 0.4 },
    { x: 0, y: 700, zoom: 0.08 }, { x: 60, y: 300, zoom: 1.8 }];
  nonFinite.length = 0;
  for (let k = 0; k < PLACES.length; k++) {
    for (const night of [0, 0.5, 1]) {
      r.setWorld(k, night, 0);
      for (const cam of cams) {
        r.fixedScale = false;
        r.render(e.plant, cam, 4000 + k * 777, e.plant.sections, null);
        r.render(e.plant, cam, 4100 + k * 777, e.plant.sections, { step, progress: 0.4 });
        // and held still: the kept picture, then frames drawn over it
        r.fixedScale = true;
        for (let f = 0; f < 3; f++) r.render(e.plant, cam, 4200 + k * 777 + f * 500, e.plant.sections, null);
      }
    }
  }
  return nonFinite.length ? `non-finite numbers handed to ${[...new Set(nonFinite)].join(', ')}` : null;
});

check('switch.js keeps v2\'s plant apart and shares v3\'s with v4', () => {
  // a page per version, each with the switch script and nothing else
  const src = readFileSync(new URL('../switch.js', import.meta.url), 'utf8');
  const page = (version, href) => {
    class Storage {
      constructor() { this.m = new Map(); }
      getItem(k) { return this.m.has(String(k)) ? this.m.get(String(k)) : null; }
      setItem(k, v) { this.m.set(String(k), String(v)); }
      removeItem(k) { this.m.delete(String(k)); }
    }
    const el = () => ({ attrs: {}, children: [], dataset: {}, setAttribute(k, v) { this.attrs[k] = v; },
      append(c) { this.children.push(c); }, prepend(c) { this.children.unshift(c); } });
    const overlay = el();
    const document = {
      readyState: 'complete', currentScript: { src: 'https://example.github.io/flower/switch.js', dataset: { version } },
      head: el(), body: el(), createElement: el, getElementById: (id) => (id === 'overlay' ? overlay : null),
      addEventListener() {},
    };
    const ctx = { document, location: new URL(href), URL, URLSearchParams, Storage };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext('var localStorage = new Storage();', ctx);
    vm.runInContext(src, ctx);
    return { store: vm.runInContext('localStorage', ctx), nav: overlay.children[0] };
  };
  const v2 = page('v2', 'https://example.github.io/flower/v2/');
  v2.store.setItem('flower.save.v1', 'x');
  if (v2.store.m.has('flower.save.v1')) return 'v2 wrote over the save v3 keeps';
  const v4 = page('v4', 'https://example.github.io/flower/v4/');
  v4.store.setItem('flower.save.v1', 'y');
  if (v4.store.m.get('flower.save.v1') !== 'y') return 'v4 keeps a save of its own instead of v3\'s';
  const links = v4.nav.children.map((a) => a.href || 'here');
  const want = ['https://example.github.io/flower/v2/', 'https://example.github.io/flower/', 'here'];
  return links.join() === want.join() ? null : `the switch on v4 links ${links.join(', ')}`;
});

// ------------------------------------------------------------------ report --

console.log();
for (const f of failures) console.log('  FAIL  ' + f);
console.log(`  ${passed} passed, ${failures.length} failed\n`);
process.exit(failures.length ? 1 : 0);
