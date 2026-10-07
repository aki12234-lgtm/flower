// The comparison grid.
//
// The brief's prototype question is whether a small set of hidden rules can
// produce plants that feel meaningfully different. This page is the visual half
// of the answer; tools/simulate.js is the numeric half. Both compare the same
// two things: what changes when the answers change, and what changes when only
// the random stream does.

import { Engine } from './engine.js';
import { Renderer } from './render.js';
import { makeRng, clamp } from './rng.js';
import { MATERIAL_BY_ID } from './materials.js';
import { ENV_BY_ID } from './environment.js';

const PLAYERS = {
  drifting: (rng) => ({ pick: (n) => rng.int(0, n - 1), slide: () => rng(), act: () => rng() }),
  withholding: () => ({ pick: () => 0, slide: () => 0.12, act: () => 0.15 }),
  reaching: () => ({ pick: (n) => n - 1, slide: () => 0.88, act: () => 0.85 }),
  contradicting: () => { let f = 0; return { pick: (n) => (f++ % 2 ? 0 : n - 1), slide: () => (f++ % 2 ? 0.08 : 0.92), act: () => (f++ % 2 ? 0.1 : 0.9) }; },
  measured: (rng) => ({ pick: (n) => (n === 2 ? rng.int(0, 1) : rng.int(1, 2)), slide: () => 0.42 + rng() * 0.16, act: () => 0.42 + rng() * 0.16 }),
  leaning: (rng) => ({ pick: (n) => (rng.chance(0.75) ? 0 : rng.int(0, n - 1)), slide: () => 0.22 + rng() * 0.2, act: () => 0.25 + rng() * 0.2 }),
};

function play(playerName, scriptSeed, growthSeed, turns) {
  const rng = makeRng(`dev:${playerName}:${scriptSeed}`);
  const player = PLAYERS[playerName](rng);
  const e = new Engine(`dev:${scriptSeed}`, `grow:${growthSeed}`);
  e.start();
  for (let i = 0; i < turns; i++) {
    const p = e.prompt;
    if (!p || e.finished) break;
    if (p.type === 'binary') e.answer({ index: player.pick(2) });
    else if (p.type === 'quad') e.answer({ index: player.pick(4) });
    else e.answer({ t: p.type === 'slider' ? player.slide() : player.act() });
  }
  if (!e.finished) e.finish('voluntary');
  return e;
}

/** Fit the whole organism into one still frame using the real render pipeline. */
function paint(canvas, engine) {
  const r = new Renderer(canvas);
  const b = engine.plant.bounds;
  const pad = 60;
  const zoom = clamp(Math.min(
    r.w / Math.max(140, (b.maxX - b.minX) + pad * 2),
    r.h / Math.max(140, (b.maxY - b.minY) + pad * 2)
  ), 0.02, 1.4);
  const cam = {
    x: (b.minX + b.maxX) / 2,
    y: r.camYToCentre((b.minY + b.maxY) / 2, zoom),
    zoom,
  };
  const now = performance.now();
  const env = r.drawEnvironment(cam, engine.plant.sections, now);
  r.drawGround(cam, env);
  r.drawPlant(cam, engine, { time: now, growProgress: 1, growingStep: -1 });
  r.drawVignette(env);
  return r;
}

function card(label, engine) {
  const el = document.createElement('div');
  el.className = 'card';
  const canvas = document.createElement('canvas');
  el.append(canvas);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const h = document.createElement('h2');
  h.textContent = label;
  const dl = document.createElement('dl');
  meta.append(h, dl);
  el.append(meta);

  // Appending first gives the canvas its laid-out size, so the renderer can
  // size its buffer straight away. Waiting for a frame callback would leave the
  // grid blank in any tab that is not currently compositing.
  document.getElementById('grid').append(el);

  paint(canvas, engine);
  const s = engine.stats();
  const rows = [
    ['ended', s.ending === 'natural' ? 'died' : 'stopped'],
    ['condition', s.condition],
    ['answers', String(s.age)],
    ['height', String(Math.round(s.height))],
    ['span', String(Math.round(s.spread))],
    ['materials', s.materials.map((m) => MATERIAL_BY_ID[m]?.name ?? m).join(', ')],
    ['scenes', s.environments.map((e) => ENV_BY_ID[e]?.name ?? e).join(', ')],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  return canvas;
}

function build() {
  document.getElementById('grid').replaceChildren();
  const turns = Number(document.getElementById('turns').value) || 20;
  const seed = document.getElementById('seed').value || '1';
  const mode = document.getElementById('mode').value;

  if (mode === 'answers') {
    for (const name of Object.keys(PLAYERS)) card(name, play(name, seed, seed, turns));
  } else {
    for (let i = 0; i < 6; i++) {
      card(`measured · noise ${i + 1}`, play('measured', seed, `${seed}-n${i}`, turns));
    }
  }
}

document.getElementById('regrow').addEventListener('click', build);
document.getElementById('mode').addEventListener('change', build);
document.getElementById('shuffle').addEventListener('click', () => {
  document.getElementById('seed').value = String(Math.floor(Math.random() * 99999));
  build();
});

build();

// Exposed so the render pipeline can be checked without a screenshot.
window.__flowerDev = { play, paint, PLAYERS };
