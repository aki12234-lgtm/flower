// Comparison page for the 3D renderer, mirroring dev.html so the two can be
// judged against each other on identical plants.

import { Engine } from '../engine.js';
import { makeRng } from '../rng.js';
import { Renderer3D } from './renderer3d.js';

const PLAYERS = {
  measured: (r) => ({ pick: (n) => (n === 2 ? r.int(0, 1) : r.int(1, 2)), slide: () => 0.42 + r() * 0.16, act: () => 0.42 + r() * 0.16 }),
  leaning: (r) => ({ pick: (n) => (r.chance(0.75) ? 0 : r.int(0, n - 1)), slide: () => 0.22 + r() * 0.2, act: () => 0.25 + r() * 0.2 }),
  withholding: () => ({ pick: () => 0, slide: () => 0.12, act: () => 0.15 }),
  drifting: (r) => ({ pick: (n) => r.int(0, n - 1), slide: () => r(), act: () => r() }),
  reaching: () => ({ pick: (n) => n - 1, slide: () => 0.88, act: () => 0.85 }),
  contradicting: () => { let f = 0; return { pick: (n) => (f++ % 2 ? 0 : n - 1), slide: () => (f++ % 2 ? 0.08 : 0.92), act: () => (f++ % 2 ? 0.1 : 0.9) }; },
};

function play(name, seed, turns) {
  const rng = makeRng(`dev:${name}:${seed}`);
  const player = PLAYERS[name](rng);
  const e = new Engine(`dev:${seed}`, `grow:${seed}`);
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

/** Same framing rule the 2D game uses: aim at the mass of recent growth. */
function frame(e) {
  const recent = e.plant.sections.slice(-3);
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const s of recent) {
    maxY = Math.max(maxY, s.bounds.maxY);
    for (const seg of s.segments) {
      for (const p of seg.points) { sx += p.x * p.w; sy += p.y * p.w; sw += p.w; }
    }
  }
  const cx = sw ? sx / sw : 0;
  const cy = sw ? sy / sw : 0;
  return { x: cx, y: cy + (maxY - cy) * 0.25, zoom: 1 };
}

const err = document.getElementById('err');

function card(label, engine) {
  const el = document.createElement('div');
  el.className = 'card';
  const canvas = document.createElement('canvas');
  const lbl = document.createElement('div');
  lbl.className = 'lbl';
  el.append(canvas, lbl);
  document.getElementById('grid').append(el);

  try {
    const r = new Renderer3D(canvas);
    const cam = frame(engine);
    const env = r.render(engine.plant, cam, performance.now(), engine.plant.sections);
    const s = engine.stats();
    lbl.textContent = `${label} — ${s.materialNames.join(', ')} · ${env.name}`;
    canvas.__renderer = r;
    canvas.__engine = engine;
  } catch (e) {
    err.textContent += `\n${label}: ${e.message}`;
    lbl.textContent = label + ' — failed';
  }
  return canvas;
}

function build() {
  err.textContent = '';
  document.getElementById('grid').replaceChildren();
  const turns = Number(document.getElementById('turns').value) || 15;
  const seed = document.getElementById('seed').value || '7';
  for (const name of Object.keys(PLAYERS)) card(name, play(name, seed, turns));
}

document.getElementById('go').addEventListener('click', build);
document.getElementById('shuffle').addEventListener('click', () => {
  document.getElementById('seed').value = String(Math.floor(Math.random() * 99999));
  build();
});

build();

window.__gl = { play, frame, Renderer3D, PLAYERS };
