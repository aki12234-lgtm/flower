// The field guide: every part the game can grow, laid out to be looked at.
//
// The catalogue of node kinds, materials and scenes only existed as tables in
// source, which meant the only way to find out whether a frond actually looked
// like a frond was to play until one appeared. Everything is shown here on the
// same specimen, so the twelve botanical kinds can be compared against each
// other rather than against memory.

import { Engine } from '../engine.js';
import { Renderer3D } from './renderer3d.js';
import { NODE_KINDS } from '../growth.js';
import { MATERIALS } from '../materials.js';
import { ENVIRONMENTS, WORLD_ERAS } from '../environment.js';
import { PLACES } from './scene.js';

const W = 420;
const H = 560;

// ?only=kinds|materials|scenes shows one plate set at a time, and ?cell= sets
// how wide a plate is. A guide that only works as one very long page is hard to
// look at and impossible to screenshot.
const q = new URLSearchParams(location.search);
const only = q.get('only');
const wants = (name) => !only || only.split(',').includes(name);
if (q.get('cell')) {
  for (const el of document.querySelectorAll('.grid')) {
    el.style.gridTemplateColumns = `repeat(auto-fill, minmax(${q.get('cell')}px, 1fr))`;
  }
}
for (const sec of ['kinds', 'materials', 'grounds', 'eras', 'scenes']) {
  if (!wants(sec)) {
    document.getElementById(sec).previousElementSibling.hidden = true;
    document.getElementById(sec).previousElementSibling.previousElementSibling.hidden = true;
    document.getElementById(sec).hidden = true;
  }
}

/** One specimen, used for every plate so the comparison is like for like. */
function specimen(seed, turns) {
  const e = new Engine(seed, seed);
  e.start();
  for (let i = 0; i < turns; i++) {
    const p = e.prompt;
    if (!p || e.finished) break;
    e.answer(p.options ? { index: 1 % p.options.length } : { t: 0.5 });
  }
  return e;
}

/**
 * `?close=N` frames so a typical member is about N pixels wide, which is the
 * only way to judge a surface. At whole-plant framing a stem is a few pixels
 * across and every substance looks the same, which is exactly the mistake that
 * made the first version of this sheet useless for the thing it was built for.
 */
function framing(e, zoom) {
  const b = e.plant.bounds;
  const spanX = Math.max(1, b.maxX - b.minX);
  const spanY = Math.max(1, b.maxY - b.minY);
  const close = Number(q.get('close') || 0);
  if (close > 0) {
    const w = [];
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (const sec of e.plant.sections) {
      for (const seg of sec.segments) {
        for (const p of seg.points) { w.push(p.w); sx += p.x * p.w; sy += p.y * p.w; sw += p.w; }
      }
    }
    w.sort((p, r) => p - r);
    const median = w.length ? w[Math.floor(w.length / 2)] : 8;
    // Aimed at the plant's mass. The middle of a tall sparse organism's
    // bounding box is empty air between two members, and a close-up of empty
    // air is a picture of the backdrop.
    return {
      x: sw ? sx / sw : 0,
      y: sw ? sy / sw : 0,
      // capped for the same reason the checks cap it: past this the camera is
      // inside the stem and every plate comes back blank
      zoom: Math.min(4.5, close / Math.max(1, median)),
    };
  }
  const fit = Math.min(W / spanX, H / spanY) * 0.88;
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    zoom: fit * (zoom || 1),
  };
}

let shared = null;
let R = null;

function renderer() {
  if (!R) {
    shared = document.createElement('canvas');
    shared.style.cssText = `width:${W}px;height:${H}px;position:fixed;left:-9999px;top:0`;
    document.body.append(shared);
    R = new Renderer3D(shared, { preserve: true });
  }
  return R;
}

function plate(host, label, note, draw) {
  const fig = document.createElement('figure');
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.style.cssText = 'width:100%;aspect-ratio:3/4;display:block;background:#111;border-radius:3px';
  const cap = document.createElement('figcaption');
  cap.innerHTML = `<b>${label}</b>${note ? `<span>${note}</span>` : ''}`;
  fig.append(c, cap);
  host.append(fig);
  try {
    draw(renderer());
    c.getContext('2d').drawImage(shared, 0, 0, c.width, c.height);
  } catch (err) {
    cap.innerHTML = `<b>${label}</b><span class="bad">${err.message}</span>`;
  }
}

// ------------------------------------------------------------- the plates --

const kindsHost = document.getElementById('kinds');
const matsHost = document.getElementById('materials');
const scenesHost = document.getElementById('scenes');
const groundsHost = document.getElementById('grounds');
const erasHost = document.getElementById('eras');

// Every node on one specimen switched to the same kind, so the twelve are
// compared on identical architecture and only the botany differs.
const kindSpec = specimen('guide-kind', 11);
const kindCam = framing(kindSpec, 1.7);
for (const kind of wants('kinds') ? NODE_KINDS : []) {
  plate(kindsHost, kind, null, (r) => {
    for (const s of kindSpec.plant.sections) {
      s.materialId = 'botanical';
      for (const n of s.nodes) n.kind = kind;
    }
    r.invalidate();
    r.render(kindSpec.plant, kindCam, 1000, kindSpec.plant.sections);
  });
}

const matSpec = specimen('guide-mat', 12);
const matCam = framing(matSpec, 1.15);
for (const m of wants('materials') ? MATERIALS : []) {
  plate(matsHost, m.id, m.graphic ? 'flat' : null, (r) => {
    for (const s of matSpec.plant.sections) s.materialId = m.id;
    r.invalidate();
    r.render(matSpec.plant, matCam, 1000, matSpec.plant.sections);
  });
}

// ---- the world ----
//
// Framed for the background rather than for the plant: pulled back until the
// horizon is in shot, with a small specimen standing in it for scale. Framing
// these the way the other plates are framed would fill each one with stem and
// show a few hundred pixels of the thing being catalogued.
const worldSpec = specimen('guide-world', 7);
const worldCam = { x: 0, y: 210, zoom: 0.62 };
const inWorld = (kind, nightness, idiom) => (r) => {
  for (const s of worldSpec.plant.sections) {
    s.materialId = 'botanical';
    s.envId = 'soil';
  }
  r.setWorld(kind, nightness, idiom);
  r.invalidate();
  r.render(worldSpec.plant, worldCam, 1000, worldSpec.plant.sections);
};

PLACES.forEach((pl, i) => {
  if (!wants('grounds')) return;
  plate(groundsHost, pl.id, pl.note, inWorld(i, 0, 0));
});
if (wants('grounds')) {
  // and a place as the night comes on, which it does with height
  plate(groundsHost, 'field · dusk', 'half night', inWorld(0, 0.5, 0));
  plate(groundsHost, 'beach · night', 'full night', inWorld(1, 1, 0));
}

for (const eraDef of wants('eras') ? WORLD_ERAS : []) {
  plate(erasHost, eraDef.id, eraDef.note || 'drawn', inWorld(1, 0, eraDef.idiom));
}

// The scene plates are about light and air, so put the world back to itself
// first — otherwise whichever era ran last is still on when they are drawn.
if (wants('scenes')) renderer().setWorld(0, 0, 0);

const envSpec = specimen('guide-env', 12);
const envCam = framing(envSpec, 1.0);
for (const env of wants('scenes') ? ENVIRONMENTS : []) {
  plate(scenesHost, env.id, env.dark ? 'dark' : null, (r) => {
    for (const s of envSpec.plant.sections) {
      s.materialId = 'botanical';
      s.envId = env.id;
    }
    r.invalidate();
    r.render(envSpec.plant, envCam, 1000, envSpec.plant.sections);
  });
}

document.getElementById('status').textContent =
  `${NODE_KINDS.length} kinds · ${MATERIALS.length} materials · ${PLACES.length} places`
  + ` · ${WORLD_ERAS.length} eras · ${ENVIRONMENTS.length} scenes`;

// ?snap=1 composites every visible plate into one contact sheet and saves it,
// so the whole catalogue can be opened as a single image instead of scrolled.
if (q.get('snap')) {
  const figs = [...document.querySelectorAll('figure')];
  const cols = Math.ceil(Math.sqrt(figs.length * 0.75)) || 1;
  const rows = Math.ceil(figs.length / cols);
  const cw = 300;
  const ch = Math.round(cw * H / W);
  const lab = 26;
  const sheet = document.createElement('canvas');
  sheet.width = cols * cw;
  sheet.height = rows * (ch + lab);
  const g = sheet.getContext('2d');
  g.fillStyle = '#0b0b0e';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '15px ui-sans-serif, sans-serif';
  g.textBaseline = 'middle';
  figs.forEach((f, i) => {
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * (ch + lab);
    g.drawImage(f.querySelector('canvas'), x + 3, y + 3, cw - 6, ch - 6);
    g.fillStyle = '#f2ece0';
    g.fillText(f.querySelector('b').textContent, x + 6, y + ch + lab / 2);
  });
  fetch('/_snap', {
    method: 'POST',
    body: JSON.stringify({ name: `guide_${only || 'all'}.png`, data: sheet.toDataURL('image/png') }),
  }).then(() => { document.getElementById('status').textContent += ' · sheet saved'; });
}
