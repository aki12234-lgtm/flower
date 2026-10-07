// A materials sheet: one plant, every substance, side by side.
//
// Built because "all the textures look the same" is a judgement about an image,
// and the only honest way to answer it is to put the substances next to each
// other at a size where the surface is actually legible. A single roughness
// number in a table cannot be argued with; a sheet can.

import { Engine } from '../engine.js';
import { Renderer3D } from './renderer3d.js';
import { MATERIALS } from '../materials.js';

/**
 * Matches selftest's own scene() exactly when `raw` is set, so a failing check
 * can be looked at instead of reasoned about.
 */
function play(seed, turns, raw) {
  const e = raw ? new Engine(seed, seed) : new Engine(`mat:${seed}`, `grow:${seed}`);
  e.start();
  for (let i = 0; i < turns; i++) {
    const p = e.prompt;
    if (!p || e.finished) break;
    e.answer(p.options ? { index: 1 % p.options.length } : { t: raw ? 0.5 : 0.55 });
  }
  return e;
}

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
  return { x: cx, y: cy + (maxY - cy) * 0.25, zoom: Number(zoomEl.value) };
}

const grid = document.getElementById('grid');
const zoomEl = document.getElementById('zoom');
const turnsEl = document.getElementById('turns');
const canvases = [];

// settings live in the URL so a sheet can be linked to, and so a reload keeps
// showing the thing that was being judged rather than resetting to defaults
const q = new URLSearchParams(location.search);
if (q.get('zoom')) zoomEl.value = q.get('zoom');
if (q.get('turns')) turnsEl.value = q.get('turns');
if (q.get('only')) document.body.dataset.only = q.get('only');
if (q.get('cell')) {
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${q.get('cell')}px, 1fr))`;
}

// One WebGL context, reused. A browser will only keep a handful alive at once,
// and a sheet of 23 silently loses most of them — every cell comes back blank.
// Render into the shared context and blit the result into a plain 2D cell.
let shared = null;
let sharedR = null;

function draw() {
  grid.innerHTML = '';
  canvases.length = 0;
  const engine = play(q.get('seed') || 'sheet', Number(turnsEl.value), q.has('seed'));
  const W = 460;
  const H = 613;
  if (!shared) {
    shared = document.createElement('canvas');
    shared.style.cssText = `width:${W}px;height:${H}px;position:fixed;left:-9999px;top:0`;
    document.body.append(shared);
    sharedR = new Renderer3D(shared, { preserve: true });
  }

  const only = (q.get('only') || '').split(',').filter(Boolean);
  const list = only.length ? MATERIALS.filter((m) => only.includes(m.id)) : MATERIALS;
  for (const m of list) {
    const cell = document.createElement('figure');
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.style.cssText = 'width:100%;aspect-ratio:3/4;display:block;background:#000';
    const cap = document.createElement('figcaption');
    cap.textContent = m.id;
    cell.append(c, cap);
    grid.append(cell);
    try {
      for (const sec of engine.plant.sections) sec.materialId = m.id;
      sharedR.invalidate();
      sharedR.render(engine.plant, frame(engine), 1000, engine.plant.sections);
      c.getContext('2d').drawImage(shared, 0, 0, c.width, c.height);
      canvases.push([m.id, c]);
    } catch (err) {
      cap.textContent = `${m.id} — ${err.message}`;
      cap.style.color = '#ef8a7a';
    }
  }
}

document.getElementById('redraw').onclick = draw;
document.getElementById('snap').onclick = async () => {
  for (const [id, c] of canvases) {
    await fetch('/_snap', {
      method: 'POST',
      body: JSON.stringify({ name: `mat_${id}.png`, data: c.toDataURL('image/png') }),
    });
  }
  document.getElementById('snap').textContent = `saved ${canvases.length}`;
};
draw();
