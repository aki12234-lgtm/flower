// Before and after, on the same plant.
//
// Judging a visual change by opening the game and looking is judging it
// against memory, on whatever plant the game happened to grow and wherever it
// happened to put it. This grows one specimen from a fixed seed in each version,
// stands it in each place, frames it the same way, and renders the two side by
// side — so the only thing that differs between a pair is the renderer.
//
//   compare.html                      every place, v1 against now
//   compare.html?base=v2              against a later frozen version
//   compare.html?view=close           framed on the stems, for surfaces
//   compare.html?view=high            the camera up in the air, for the sky
//   compare.html?view=wide            the whole organism
//   compare.html?view=open&turns=1    the game's own framing, as a player first sees it
//   compare.html?place=4              one place, large
//   compare.html?snap=1               also save the sheet to tools/snapshots
//   compare.html?set={"k":v}          set fields on the live renderer first
//   compare.html?tag=x                add x to the saved file's name
//   compare.html?settle=16            render sixteen frames in a row before keeping one
//   compare.html?materials=1&view=close   one row per material instead of per place,
//                                     each scored by how far the two differ

import { Engine as EngineB } from '../engine.js';
import { Renderer3D as RendererB } from './renderer3d.js';
import { PLACES } from './scene.js';
import { MATERIALS } from '../materials.js';

const q = new URLSearchParams(location.search);
const BASE = q.get('base') || 'v1';
const { Engine: EngineA } = await import(`../../versions/${BASE}/src/engine.js`);
const { Renderer3D: RendererA } = await import(`../../versions/${BASE}/src/gl/renderer3d.js`);
// ?scale=2.5 renders larger, for timing at something like the size the game runs at
const SCALE = Number(q.get('scale') || 1);
const W = Math.round(420 * SCALE);
const H = Math.round(560 * SCALE);
const SEED = q.get('seed') || 'compare-7';
const TURNS = Number(q.get('turns') || 16);
const VIEW = q.get('view') || 'game';
const ERA = Number(q.get('era') || 0);
const NIGHT = Number(q.get('night') || 0);
const TIME = Number(q.get('time') || 1000);
const ONLY = q.get('place');
const SETTLE = Math.max(2, Number(q.get('settle') || 2));

function grow(Engine) {
  const e = new Engine(SEED, SEED);
  e.start();
  for (let i = 0; i < TURNS; i++) {
    const p = e.prompt;
    if (!p || e.finished) break;
    e.answer(p.options ? { index: 1 % p.options.length } : { t: 0.5 });
  }
  return e;
}

/** Where to put the camera, worked out the same way for both versions. */
function frame(e, r) {
  const secs = e.plant.sections;
  const b = e.plant.bounds;
  if (VIEW === 'place') return { x: 0, y: 210, zoom: 0.62 };
  if (VIEW === 'high') return { x: 0, y: Math.max(5200, b.maxY + 800), zoom: 0.5 };
  if (VIEW === 'wide') {
    const zx = W / Math.max(120, b.maxX - b.minX + 200);
    const zy = H / Math.max(120, b.maxY - b.minY + 200);
    return { x: r.camXToCentre((b.minX + b.maxX) / 2), y: (b.minY + b.maxY) / 2,
      zoom: Math.min(zx, zy) };
  }
  // 'game' and 'close': aimed at a point the recent growth is actually made of
  const recent = secs.slice(-3);
  let lo = Infinity;
  let hi = -Infinity;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  const pts = [];
  for (const s of recent) {
    lo = Math.min(lo, s.bounds.minY);
    hi = Math.max(hi, s.bounds.maxY);
    for (const g of s.segments) for (const p of g.points) { sx += p.x * p.w; sy += p.y * p.w; sw += p.w; pts.push(p); }
  }
  const cx = sw ? sx / sw : 0;
  const cy = sw ? sy / sw : 0;
  let on = pts[0] || { x: 0, y: 0 };
  let best = Infinity;
  for (const p of pts) {
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) { best = d; on = p; }
  }
  if (VIEW === 'close') return { x: r.camXToCentre(on.x), y: on.y, zoom: Number(q.get('zoom')) || 2.6 };
  if (VIEW === 'open') {
    // main.js's nowTarget, with the prompt panel where it usually sits
    const span = Math.max(1, hi - lo);
    const aim = (lo + hi) / 2 + span * 0.12;
    const line = Math.min(0.30, Math.max(0.16, 0.36 - (span / H) * 0.18));
    return { x: r.camXToCentre(cx), y: r.camYToPlaceAt(aim, line, 1), zoom: 1 };
  }
  const span = Math.max(200, hi - lo);
  return { x: r.camXToCentre(cx), y: (lo + hi) / 2, zoom: Math.min(1.2, (H * 0.62) / span) };
}

function makeRenderer(Renderer) {
  const c = document.createElement('canvas');
  c.style.cssText = `width:${W}px;height:${H}px;position:fixed;left:-9999px;top:0`;
  document.body.append(c);
  return { c, r: new Renderer(c, { preserve: true }) };
}

// how long each version takes to build its programs — on some drivers a long
// shader compiles for many seconds, and past the GPU watchdog it loses the context
let t0 = performance.now();
const A = makeRenderer(RendererA);
const buildA = performance.now() - t0;
t0 = performance.now();
const B = makeRenderer(RendererB);
const buildB = performance.now() - t0;
// ?set={"eyeFloorAt":80} tries values on the live renderer without editing it
if (q.get('set')) Object.assign(B.r, JSON.parse(q.get('set')));
const plantA = grow(EngineA);
const plantB = grow(EngineB);

function shoot(side, e, place) {
  const { c, r } = side;
  r.setWorld(place, NIGHT, ERA);
  r.invalidate();
  const cam = frame(e, r);
  const t0 = performance.now();
  // A run of frames sixteen milliseconds apart, ending at TIME — two by
  // default, so anything built lazily on the first is in the one kept, and more
  // with ?settle=N to see what the picture settles to when it plays.
  for (let i = SETTLE - 1; i >= 0; i--) r.render(e.plant, cam, TIME - i * 16, e.plant.sections);
  const ms = performance.now() - t0;
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d').drawImage(c, 0, 0, W, H);
  return { canvas: out, ms };
}

// ?perf=1 times the steady state: thirty frames each, waiting for the GPU after
// every one, with the world already built — so it measures drawing, not building.
if (q.get('perf')) {
  const out = [];
  for (const place of PLACES.map((_, i) => i)) {
    const row = [PLACES[place].id];
    for (const [side, e] of [[A, plantA], [B, plantB]]) {
      const { r } = side;
      r.setWorld(place, NIGHT, ERA);
      r.invalidate();
      const cam = frame(e, r);
      // finish() returns without waiting in some browsers; reading a pixel back
      // cannot, because the pixel has to exist first
      const px = new Uint8Array(4);
      const sync = () => r.gl.readPixels(0, 0, 1, 1, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 3; i++) r.render(e.plant, cam, TIME + i * 16, e.plant.sections);
      sync();
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) { r.render(e.plant, cam, TIME + i * 16, e.plant.sections); sync(); }
      row.push(((performance.now() - t0) / 30).toFixed(1));
    }
    out.push(row);
  }
  window.__perf = out;
  document.getElementById('status').textContent = `perf (ms/frame ${BASE} → now): `
    + out.map((r) => r[0] + ' ' + r[1] + ' → ' + r[2]).join(' · ');
}

/**
 * How much two shots differ: the per cent of pixels that moved by more than a
 * few levels. A mean is no use here — a thin stem against a large sky can
 * change completely and barely move it.
 */
function differ(a, b) {
  const pa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data;
  const pb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
  let moved = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const d = Math.max(Math.abs(pa[i] - pb[i]), Math.abs(pa[i + 1] - pb[i + 1]), Math.abs(pa[i + 2] - pb[i + 2]));
    if (d > 6) moved++;
  }
  return moved / (pa.length / 4) * 100;
}

const host = document.getElementById('sheet');
const BY_MATERIAL = !!q.get('materials');
const places = BY_MATERIAL ? MATERIALS.map((m) => m.id)
  : ONLY !== null ? [Number(ONLY)] : PLACES.map((_, i) => i);
const rows = [];
window.__diff = {};
for (const item of places) {
  let place = item;
  if (BY_MATERIAL) {
    place = Number(ONLY ?? 0);
    for (const e of [plantA, plantB]) for (const sec of e.plant.sections) sec.materialId = item;
  }
  const a = shoot(A, plantA, place);
  const b = shoot(B, plantB, place);
  const row = document.createElement('div');
  row.className = 'row';
  const d = differ(a.canvas, b.canvas);
  window.__diff[BY_MATERIAL ? item : PLACES[place]?.id || place] = +d.toFixed(2);
  const name = (BY_MATERIAL ? item : PLACES[place]?.id || place) + ' Δ' + d.toFixed(1) + '%';
  row.innerHTML = `<h3>${name}</h3>`;
  for (const [label, shot] of [[BASE, a], ['now', b]]) {
    const fig = document.createElement('figure');
    shot.canvas.className = 'shot';
    fig.append(shot.canvas);
    const cap = document.createElement('figcaption');
    cap.textContent = `${label} · ${shot.ms.toFixed(0)} ms for two frames`;
    fig.append(cap);
    row.append(fig);
  }
  host.append(row);
  rows.push({ name, a: a.canvas, b: b.canvas });
}

document.getElementById('status').textContent =
  `seed ${SEED} · ${TURNS} turns · view ${VIEW} · era ${ERA} · night ${NIGHT}`
  + ` · build ${buildA.toFixed(0)} → ${buildB.toFixed(0)} ms`
  + ` · Δ ${Object.entries(window.__diff).map(([k, v]) => k + ' ' + v).join(', ')}`;

// ?snap=1 writes the sheet out as one image
if (q.get('snap')) {
  const cw = Number(q.get('cw')) || (ONLY !== null && !BY_MATERIAL ? W : 300);   // full size for one place
  const ch = Math.round(cw * H / W);
  const lab = 24;
  const sheet = document.createElement('canvas');
  sheet.width = cw * 2 + 130;
  sheet.height = rows.length * (ch + lab) + lab;
  const g = sheet.getContext('2d');
  g.fillStyle = '#0b0b0e';
  g.fillRect(0, 0, sheet.width, sheet.height);
  g.font = '14px ui-sans-serif, sans-serif';
  g.fillStyle = '#f2ece0';
  g.textBaseline = 'middle';
  g.fillText(BASE, 130 + cw * 0.5 - 8, lab / 2);
  g.fillText('now', 130 + cw * 1.5 - 12, lab / 2);
  rows.forEach((row, i) => {
    const y = lab + i * (ch + lab);
    g.fillStyle = '#f2ece0';
    g.fillText(row.name, 8, y + ch / 2);
    g.drawImage(row.a, 130 + 2, y + 2, cw - 4, ch - 4);
    g.drawImage(row.b, 130 + cw + 2, y + 2, cw - 4, ch - 4);
  });
  const name = `compare_${BASE}_${VIEW}${ONLY !== null ? '_' + ONLY : ''}${NIGHT ? '_night' : ''}${ERA ? '_era' + ERA : ''}${BY_MATERIAL ? '_materials' : ''}${q.get('tag') ? '_' + q.get('tag') : ''}.png`;
  fetch('/_snap', { method: 'POST', body: JSON.stringify({ name, data: sheet.toDataURL('image/png') }) })
    .then(() => { document.getElementById('status').textContent += ' · saved ' + name; });
}
