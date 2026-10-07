// Bootstrap, camera, input, and the turn loop.

import { Engine, SAVE_KEY, ARCHIVE_KEY } from './engine.js';
import { Renderer3D } from './gl/renderer3d.js';
import { support } from './gl/glutil.js';
import { UI } from './ui.js';
import { clamp, lerp } from './rng.js';
import { PLACES } from './gl/scene.js';

const GROW_MS = 1600;
const GROWTH_LINE = 0.30;   // where down the screen the newest growth sits
const AWAY_THRESHOLD = 260; // how far you can drift before "now" is offered

// `?sandbox` runs a throwaway game that never touches localStorage. selftest.html
// loads the real page this way so its checks cannot clobber a game in progress.
const SANDBOX = new URLSearchParams(location.search).has('sandbox');

// `?reset` throws the saved game away before anything reads it.
//
// There was no way out of a wedged save at all: if a restored game could not be
// carried on, the page came up showing it and there was nothing on screen that
// would start another. Whatever put it in that state, the person looking at it
// needs a door.
if (new URLSearchParams(location.search).has('reset')) {
  try {
    localStorage.removeItem('flower.save.v1');
  } catch { /* blocked; the fresh game below still runs */ }
}

const canvas = document.getElementById('stage');

/**
 * Say so when the renderer cannot start.
 *
 * This used to be a bare `new Renderer3D(canvas)` at the top of the module, so
 * anything it threw — no WebGL 2, a missing float extension, a shader the
 * driver would not take — killed the whole module before a single line of the
 * game ran, and the page simply stayed blank. A blank page tells nobody
 * anything, least of all the person it happened to.
 */
function reportFailure(err) {
  const s = support();
  const detail = [
    err && err.message ? err.message : String(err),
    err && err.stack ? err.stack : '',
    '',
    ...Object.entries(s).map(([k, v]) => `${k}: ${v}`),
    `userAgent: ${navigator.userAgent}`,
  ].join('\n');

  const panel = document.createElement('div');
  panel.setAttribute('role', 'alert');
  panel.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;padding:32px;'
    + 'background:#0b0b0e;color:#f2ece0;font:15px/1.6 ui-sans-serif,system-ui,sans-serif;z-index:99';
  const inner = document.createElement('div');
  inner.style.cssText = 'max-width:60ch';
  const h = document.createElement('h1');
  h.textContent = 'This machine cannot run the renderer';
  h.style.cssText = 'font:400 24px/1.3 Georgia,serif;margin:0 0 12px';
  const p = document.createElement('p');
  p.textContent = s.webgl2
    ? 'The browser has WebGL 2 but is missing something the renderer needs.'
    : 'The browser could not open WebGL 2. That is usually hardware acceleration '
      + 'being switched off in the browser settings, or a very old browser.';
  p.style.cssText = 'color:rgba(242,236,224,0.75);margin:0 0 16px';
  const pre = document.createElement('pre');
  pre.textContent = detail;
  pre.style.cssText = 'white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;'
    + 'background:rgba(255,255,255,0.06);padding:14px;border-radius:8px;'
    + 'color:rgba(242,236,224,0.72);max-height:44vh;overflow:auto';
  inner.append(h, p, pre);
  panel.append(inner);
  document.body.append(panel);
  console.error('[flower] renderer failed to start', err, s);
}

let renderer;

let engine = null;
let mode = 'asking';        // asking | growing | ending | reflection | specimen | looking
let growing = null;         // { step, start }
let selected = null;
let lastNote = null;

const cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tz: 1, free: false };

const ui = new UI({
  onAnswer: handleAnswer,
  onFinish: () => { engine.finish('voluntary'); enterEnding(); },
  onReturnToNow: () => { cam.free = false; ui.setReturnVisible(false); },
  onRestart: () => startFresh(),
  onEndingContinue: () => { mode = 'reflection'; ui.showReflection(); },
  onSeal: handleSeal,
  onLookAtIt: () => {
    mode = 'looking';
    ui.hideSpecimen(true);
    fitWholePlant();
  },
  onBackToCard: () => {
    mode = 'specimen';
    ui.hideInspector();
    ui.el.specBack.hidden = true;
    ui.showSpecimen(engine, engine.stats());
    cam.tz = 1;
  },
  onNewPlant: startFresh,
});

// ------------------------------------------------------------------- turns --

function handleAnswer(response) {
  if (mode !== 'asking') return;
  ui.hidePrompt();
  ui.setFinishVisible(false);
  ui.hideInspector();
  selected = null;

  const result = engine.answer(response);
  if (!result) return;

  lastNote = result.note;
  growing = { step: result.section.step, start: performance.now() };
  mode = 'growing';
  cam.free = false;
  ui.setReturnVisible(false);
  save();
}

function finishGrowing() {
  growing = null;
  if (lastNote) { ui.showNote(lastNote); lastNote = null; }
  if (engine.finished) { enterEnding(); return; }
  mode = 'asking';
  ui.showPrompt(engine.prompt);
  ui.setFinishVisible(engine.canFinish());
}

function enterEnding() {
  mode = 'ending';
  ui.showEnding(engine);
}

function handleSeal(name, reflection) {
  engine.archive = { name: name || 'Unnamed', reflection };
  const stats = engine.stats();
  saveToArchive(engine, stats);
  clearSave();
  mode = 'specimen';
  ui.showSpecimen(engine, stats);
}

function startFresh() {
  clearSave();
  ui.reset();
  engine = new Engine(String(Date.now()) + ':' + Math.floor(Math.random() * 1e9));
  engine.start();
  renderer.invalidate();
  mode = 'asking';
  growing = null;
  selected = null;
  cam.free = false;
  cam.zoom = cam.tz = 1;
  snapCameraToNow(true);
  ui.showPrompt(engine.prompt);
  ui.setFinishVisible(engine.canFinish());
  save();
}

// ------------------------------------------------------------------ camera --

function nowTarget() {
  // Frame the last few sections, not just the newest tip.
  //
  // Aiming at the top of the newest section alone put the camera on a bare run
  // of stem whenever that section happened to fall between blooms, and the
  // player got a screen of empty backdrop. Taking in the recent growth as a
  // whole keeps something worth looking at in shot.
  const secs = engine.plant.sections;
  const recent = secs.slice(Math.max(0, secs.length - 3));
  let minY = Infinity;
  let maxY = -Infinity;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (const s of recent) {
    minY = Math.min(minY, s.bounds.minY);
    maxY = Math.max(maxY, s.bounds.maxY);
    for (const seg of s.segments) {
      for (const p of seg.points) { sx += p.x * p.w; sy += p.y * p.w; sw += p.w; }
    }
  }
  const cx = sw ? sx / sw : 0;
  const cy = sw ? sy / sw : 0;

  // Aim at the middle of what grew, not at the top of it.
  //
  // Leaning most of the way towards the highest point works while a plant grows
  // one way, and comes apart the moment it grows two: a plant with one tip
  // climbing and another heading down has a centre of mass in between, and a
  // camera chasing the top of it loses the bottom off the screen — then swings
  // back the next turn when the lower tip moves further. It follows the middle
  // of the block now, with only a slight lean upwards.
  const span = Math.max(1, maxY - minY);
  const middle = (minY + maxY) / 2;
  const aim = middle + span * 0.12;

  // Sit that block in whatever space the prompt panel has left. A two-choice
  // prompt and an action prompt differ by a couple of hundred pixels.
  const free = ui.panelTop ?? renderer.h * 0.72;
  const usable = clamp(free / renderer.h, 0.35, 0.95);
  // and pull back if that block will not fit in the space the panel leaves
  const room = (ui.panelTop ?? renderer.h * 0.72) * 0.82;
  const need = span * cam.tz;
  if (need > room) cam.tz = clamp(room / span, 0.12, 1);

  const spanPx = span * cam.zoom;
  // if the recent block is short, keep headroom above it; if it is tall, centre it
  const line = clamp(usable * 0.5 - (spanPx / renderer.h) * 0.18, 0.16, GROWTH_LINE);

  let y = renderer.camYToPlaceAt(aim, line, cam.zoom);
  let x = renderer.camXToCentre(cx);

  // Ride with the section that is arriving.
  //
  // Framing the middle of the last three sections is right for looking at a
  // plant, and wrong for watching one grow: the block's centre barely moves when
  // a section is added to its end, so answering a question slid the camera a few
  // pixels and the growth appeared to happen to a stationary picture. An answer
  // should take you with it — up when the plant climbs, down when it turns and
  // goes under. So while the new growth is on its way the aim leans towards the
  // end of it, in proportion to how much of it has arrived, and relaxes back to
  // the block once it is all there.
  if (growing) {
    const tip = newestTip();
    if (tip) {
      const lean = Math.sin(clamp(progress, 0, 1) * Math.PI) * 0.55 + progress * 0.30;
      x = lerp(x, renderer.camXToCentre(tip.x), lean * 0.6);
      y = lerp(y, renderer.camYToPlaceAt(tip.y, line, cam.zoom), lean);
    }
  }
  return { x, y };
}

/** The far end of the newest section — where the plant is actually reaching. */
function newestTip() {
  const secs = engine.plant.sections;
  const s = secs[secs.length - 1];
  if (!s || !s.segments || !s.segments.length) return null;
  const seg = s.segments[s.segments.length - 1];
  const pt = seg && seg.points && seg.points[seg.points.length - 1];
  return pt ? { x: pt.x, y: pt.y } : null;
}

function snapCameraToNow(instant) {
  if (!renderer) return;
  const t = nowTarget();
  cam.tx = t.x;
  cam.ty = t.y;
  if (instant) { cam.x = t.x; cam.y = t.y; }
}

function fitWholePlant() {
  if (!renderer) return;
  const b = engine.plant.bounds;
  const pad = 90;
  const zx = renderer.w / Math.max(120, (b.maxX - b.minX) + pad * 2);
  const zy = renderer.h / Math.max(120, (b.maxY - b.minY) + pad * 2);
  cam.tz = clamp(Math.min(zx, zy), 0.05, 1.2);
  cam.tx = renderer.camXToCentre((b.minX + b.maxX) / 2);
  cam.ty = renderer.camYToCentre((b.minY + b.maxY) / 2, cam.tz);
  cam.free = true;
}

function updateCamera(dt) {
  if (!cam.free) {
    const t = nowTarget();
    cam.tx = t.x;
    cam.ty = t.y;
  }
  const k = 1 - Math.pow(0.0025, dt / 1000);
  cam.x = lerp(cam.x, cam.tx, k);
  cam.y = lerp(cam.y, cam.ty, k);
  cam.zoom = lerp(cam.zoom, cam.tz, k);
  // (A zoom used to invalidate the renderer every frame it was moving, which
  // rebuilt the whole plant and the whole world — a fifth of a second each —
  // for every frame of every zoom. The world rebuilds itself when the view has
  // changed enough to need it.)
}

// ------------------------------------------------------------------- input --

let drag = null;

for (const type of ['pointerdown', 'pointermove', 'wheel', 'keydown']) {
  window.addEventListener(type, () => { lastTouch = performance.now(); }, { passive: true });
}
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture?.(e.pointerId);
  drag = { x: e.clientX, y: e.clientY, moved: 0, startY: cam.ty, startX: cam.tx };
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 4) {
    canvas.classList.add('dragging');
    cam.free = true;
    cam.ty = drag.startY + dy / cam.zoom;
    cam.tx = drag.startX - dx / cam.zoom;
    clampCamera();
    updateReturnChip();
  }
});

const endDrag = (e) => {
  if (!drag) return;
  canvas.classList.remove('dragging');
  if (drag.moved <= 4) inspectAt(e.clientX, e.clientY);
  drag = null;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; canvas.classList.remove('dragging'); });

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    cam.tz = clamp(cam.tz * Math.exp(-e.deltaY * 0.0016), 0.08, 1.8);
    cam.free = true;
  } else {
    cam.free = true;
    cam.ty -= e.deltaY / cam.zoom;
    clampCamera();
  }
  updateReturnChip();
}, { passive: false });

function clampCamera() {
  const b = engine.plant.bounds;
  cam.ty = clamp(cam.ty, b.minY - 220, b.maxY + 700);
  cam.tx = clamp(cam.tx, b.minX - 500, b.maxX + 500);
}

function updateReturnChip() {
  if (mode === 'looking' || mode === 'specimen' || mode === 'reflection') return;
  const t = nowTarget();
  const away = Math.abs(cam.ty - t.y) > AWAY_THRESHOLD || Math.abs(cam.tz - 1) > 0.05;
  ui.setReturnVisible(cam.free && away);
}

function inspectAt(clientX, clientY) {
  if (!renderer) return;
  const r = canvas.getBoundingClientRect();
  const sx = clientX - r.left;
  const sy = clientY - r.top;
  let section = null;
  let best = 46 * 46;
  for (const s of engine.plant.sections) {
    if (!s.promptId) continue;
    const b = s.bounds;
    const p = renderer.project(cam, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2);
    if (!p) continue;
    const d = (p.x - sx) ** 2 + (p.y - sy) ** 2;
    if (d < best) { best = d; section = s; }
  }
  if (!section) { selected = null; ui.hideInspector(); return; }
  selected = section.step;
  ui.showInspector(section, sx, sy, { w: renderer.w, h: renderer.h });
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { selected = null; ui.hideInspector(); return; }
  if (mode !== 'asking') return;
  const p = engine.prompt;
  if (!p || (p.type !== 'binary' && p.type !== 'quad')) return;
  const n = Number(e.key);
  if (Number.isInteger(n) && n >= 1 && n <= p.options.length) {
    ui.choiceButtons?.[n - 1]?.click();
  }
});

window.addEventListener('resize', () => {
  // The window can settle, or the user can move it, before the shaders have
  // finished compiling — and a listener that assumed a renderer was already
  // there threw on every one of those, which is a black screen for anyone
  // whose browser fires a resize during load.
  if (!renderer) return;
  renderer.resize();
  ui.measurePanel();
  if (mode === 'looking') fitWholePlant();
});

// ?era=42 pins one era open, for looking at it. The table itself lives in
// environment.js, so the field guide can show every manner the world has
// without importing the game to do it.
const ERA_PIN = new URLSearchParams(location.search).get('era');
// ?place=3 pins the world somewhere, the same way, for looking at it.
const PLACE_PIN = new URLSearchParams(location.search).get('place');
// The world stays itself. It used to drift through drawn eras on a clock —
// a riso print, a halftone, a blueprint — and a whole place turning magenta
// after a minute of looking at it reads as the game breaking, not as a mood.
// ?era= still pins one, for looking at them.
const era = () => (ERA_PIN !== null ? Number(ERA_PIN) || 0 : 0);

/** How far through its arrival the newest section is, 0 to 1. */
let progress = 1;

// -------------------------------------------------------------------- loop --

let last = performance.now();

/**
 * Is anything happening that needs every frame? Nothing growing, the camera at
 * rest, and no hand on the view: then only the birds and the grass are moving,
 * and they are just as alive at thirty frames a second as at sixty — while the
 * graphics card does half the work, and a laptop stays cool.
 */
let lastDrawn = 0;
let lastTouch = 0;
function idle(now) {
  return !growing && !drag && now - lastTouch > 800
    && Math.abs(cam.x - cam.tx) < 0.5 && Math.abs(cam.y - cam.ty) < 0.5 && Math.abs(cam.zoom - cam.tz) < 0.001;
}

function frame(now) {
  // A throw in here used to end the loop in silence: the canvas stopped being
  // painted, the UI carried on responding, and the game looked like it had gone
  // black rather than broken. Three separate faults hid behind that. Now the
  // first one says so, with a stack, and stops.
  try {
    const resting = idle(now);
    // resting frames come further apart on purpose; that is not the machine
    // being slow, and the renderer must not turn its resolution down for it
    if (renderer) renderer.fixedScale = resting;
    if (!resting || now - lastDrawn > 30) {
      draw(now);
      if (stats) stats.tick(now);
      lastDrawn = now;
    }
  } catch (err) {
    reportFailure(err);
    return;
  }
  requestAnimationFrame(frame);
}

// ?stats shows how long frames are taking, at what size, on what chip — so a
// machine can be measured by whoever is sitting at it.
const stats = new URLSearchParams(location.search).has('stats') ? (() => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99;padding:6px 8px;border-radius:6px;'
    + 'font:12px/1.4 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,0.55);pointer-events:none;white-space:pre';
  document.body.append(el);
  let prev = 0;
  let ms = 16;
  let shown = 0;
  return {
    tick(now) {
      if (prev) ms = ms * 0.9 + Math.min(250, now - prev) * 0.1;
      prev = now;
      if (now - shown < 500 || !renderer) return;
      shown = now;
      el.textContent = `${ms.toFixed(1)} ms  ${(1000 / ms).toFixed(0)} fps\n`
        + `${renderer.pw}×${renderer.ph}  scale ${(renderer.renderScale ?? 1).toFixed(2)}\n`
        + `${renderer.gpuName || ''}`.slice(0, 180);
    },
  };
})() : null;

let frames = 0;

// A handle on what the loop is actually doing, for when the canvas is black and
// nothing has thrown. window.flower.frames says whether it is running at all;
// the rest says whether it is drawing into anything.
window.flower = {
  get frames() { return frames; },
  get target() { return renderer ? [renderer.pw, renderer.ph] : null; },
  get canvas() { return [canvas.width, canvas.height]; },
  get cam() { return { x: cam.x, y: cam.y, zoom: cam.zoom, free: cam.free }; },
  get growing() { return growing ? progress : null; },
  get glError() {
    const gl = renderer && renderer.gl;
    return gl ? gl.getError() : 'no context';
  },
  get lost() {
    const gl = renderer && renderer.gl;
    return gl ? gl.isContextLost() : 'no context';
  },

  /**
   * One frame, as a PNG data URL.
   *
   * The canvas is not created with preserveDrawingBuffer — it costs a copy on
   * every frame to serve something almost nothing needs — so its contents are
   * gone by the time anything outside the loop could ask for them. Reading them
   * has to happen in the same callback that drew them, which is the one thing a
   * caller from outside cannot arrange for itself.
   */
  capture() {
    return new Promise((resolve, reject) => {
      requestAnimationFrame((t) => {
        try {
          draw(t);
          const gl = renderer.gl;
          const w = canvas.width;
          const h = canvas.height;
          const px = new Uint8Array(w * h * 4);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
          // readPixels counts up from the bottom; a canvas counts down from the top
          const flipped = new Uint8ClampedArray(w * h * 4);
          for (let y = 0; y < h; y++) {
            flipped.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
          }
          const out = document.createElement('canvas');
          out.width = w;
          out.height = h;
          out.getContext('2d').putImageData(new ImageData(flipped, w, h), 0, 0);
          resolve(out.toDataURL('image/png'));
        } catch (err) {
          reject(err);
        }
      });
    });
  },
};

function draw(now) {
  frames++;
  const dt = Math.min(64, now - last);
  last = now;

  // How far the new growth has come has to be known before the camera is
  // moved, because the camera now follows it.
  progress = 1;
  if (growing) {
    progress = clamp((now - growing.start) / GROW_MS, 0, 1);
    // ease out, so a section arrives rather than stops
    progress = 1 - Math.pow(1 - progress, 2.2);
  }

  updateCamera(dt);

  if (growing && progress >= 1) finishGrowing();

  // The ground comes from the plant's own seed, and the night comes on as it
  // climbs — the same axis its history runs along.
  const top = engine.plant.bounds.maxY;
  renderer.setWorld(
    PLACE_PIN !== null ? Number(PLACE_PIN) || 0
      : Math.abs(Math.round((engine.plant.baseHue ?? 90) * 7.3)) % PLACES.length,
    clamp((top - 2600) / 5200, 0, 1),
    era(now),
  );
  renderer.render(engine.plant, cam, now, engine.plant.sections,
    growing ? { step: growing.step, progress } : null);
}

// ------------------------------------------------------------------- store --

function save() {
  if (SANDBOX || !engine || engine.finished) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(engine.toJSON())); } catch { /* full or blocked */ }
}
function clearSave() {
  if (SANDBOX) return;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
function saveToArchive(e, stats) {
  if (SANDBOX) return;
  try {
    const list = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || '[]');
    list.push({
      at: Date.now(),
      name: e.archive?.name,
      reflection: e.archive?.reflection,
      seed: e.seed,
      stats: {
        age: stats.age, height: Math.round(stats.height), length: Math.round(stats.length),
        spread: Math.round(stats.spread), condition: stats.condition, ending: stats.ending,
        materials: stats.materialNames, environments: stats.environmentNames,
      },
    });
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(list.slice(-60)));
  } catch { /* ignore */ }
}

function loadSaved() {
  if (SANDBOX) return null;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const e = Engine.fromJSON(JSON.parse(raw));
    return e.plant?.sections?.length ? e : null;
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------- init --

/**
 * Build the renderer after the page has had a chance to paint.
 *
 * Compiling the shaders takes most of a second even on a fast card — the post
 * program alone carries every idiom — and it holds the main thread the whole
 * time. Doing it during module evaluation meant the browser could not paint
 * anything at all until it finished, so the first thing anyone saw was a blank
 * window for as long as their driver took. There is nothing to be done about
 * the cost, but it does not have to be spent in silence: the page and its first
 * prompt come up straight away, and the plant arrives when the shaders are
 * ready.
 */
function boot() {
  try {
    renderer = new Renderer3D(canvas);
  } catch (err) {
    reportFailure(err);
    return;
  }
  canvas.classList.remove('warming');
  snapCameraToNow(true);
  requestAnimationFrame(frame);
}

// The question first, then the plant.
//
// Restoring or starting a game costs a few milliseconds and needs no GPU at
// all, so it happens before the shaders are touched: the prompt is on screen
// almost immediately and the organism appears behind it once the driver is
// done. Ordering it the other way meant the page sat blank for the whole
// compile with nothing on it to read.
canvas.classList.add('warming');
startGame();

// Two frames if the page is being painted, a timer if it is not.
//
// requestAnimationFrame does not fire in a hidden or offscreen frame, so a
// page that nobody is looking at never got as far as building its renderer —
// it sat with the prompt up and no plant behind it, indefinitely. Waiting for
// a frame is an optimisation, not a requirement, and it needs a way out.
let booted = false;
const bootOnce = () => { if (!booted) { booted = true; boot(); } };
requestAnimationFrame(() => requestAnimationFrame(bootOnce));
setTimeout(bootOnce, 250);

function startGame() {
const restored = loadSaved();
if (restored) {
  engine = restored;
  if (!engine.prompt && !engine.finished) engine.nextPrompt();
  if (engine.finished) enterEnding();
  else {
    ui.showPrompt(engine.prompt);
    ui.setFinishVisible(engine.canFinish());
  }
} else {
  engine = new Engine(String(Date.now()) + ':' + Math.floor(Math.random() * 1e9));
  engine.start();
  ui.showPrompt(engine.prompt);
  ui.setFinishVisible(engine.canFinish());
  save();
}
}
