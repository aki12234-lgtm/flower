// Browser checks: the things that need a real canvas and a real GPU.
//
// These test the renderer the game actually uses. An earlier version of this
// file kept passing while every render check pointed at the old 2D canvas path,
// which the game had stopped calling — fourteen green ticks that proved nothing
// about what was on screen. A test that cannot fail when the thing it names is
// broken is worse than no test, because it is read as evidence.
//
// The rule-level assertions run separately under node with tools/test.js.

import { Engine } from './engine.js';
import { Renderer3D, makeGlyphAtlas } from './gl/renderer3d.js';
import { MAT_ID } from './gl/scene.js';
import { MATERIALS } from './materials.js';
import { ActionWidget } from './ui.js';
import { PROMPTS_BY_ID } from './prompts.js';

const results = [];
const add = (name, problem, detail) => results.push({ name, ok: !problem, problem, detail });

const stage = document.createElement('div');
stage.style.cssText = 'position:fixed;left:0;top:0;width:340px;height:460px;opacity:0;pointer-events:none';
document.body.append(stage);

function newCanvas(w = 340, h = 460) {
  const c = document.createElement('canvas');
  c.style.cssText = `width:${w}px;height:${h}px;display:block`;
  stage.append(c);
  return c;
}

/** A plant to look at, and the camera framing the game would use for it. */
function scene(turns = 12, seed = 'check') {
  const e = new Engine(seed, seed);
  e.start();
  for (let i = 0; i < turns; i++) {
    const p = e.prompt;
    if (!p || e.finished) break;
    e.answer(p.options ? { index: 1 % p.options.length } : { t: 0.5 });
  }
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

  // Aimed at a point the plant is actually made of.
  //
  // The weighted mean of recent growth is not on the organism: a fork that goes
  // two ways has its centre of mass in the gap between the two members, and a
  // close-up framed there is a photograph of the space between. It survived
  // this long because the plants these checks happened to grow put something
  // near the middle — then the growth rules changed, the shape changed with
  // them, and a check about surfaces reported that wool had no surface when
  // what it had was nothing in shot. So: the real point nearest that mean.
  let onPlant = null;
  let best = Infinity;
  for (const sec of recent) {
    for (const seg of sec.segments) {
      for (const pt of seg.points) {
        const d = Math.hypot(pt.x - cx, pt.y - cy);
        if (d < best) { best = d; onPlant = pt; }
      }
    }
  }

  // A zoom that fits the whole organism, so "close up" means the same thing
  // whatever shape the rules currently grow. Checks used to name a fixed zoom,
  // and when the geometry changed they silently ended up framed on a single
  // stem — the surface sample went from 7,617 pixels of plant to 71,097.
  const b = e.plant.bounds;
  const spanX = Math.max(1, b.maxX - b.minX);
  const spanY = Math.max(1, b.maxY - b.minY);

  // Two ways to frame it. `fit` shows the whole organism. `stemZoom` asks for a
  // typical stem at a given width in pixels, which is what a check about
  // surface or about glyphs actually needs — those want a member big enough to
  // read, not a plant big enough to see. Naming a fixed zoom instead tied the
  // checks to whatever shape the rules happened to grow that week.
  const widths = [];
  for (const sec of e.plant.sections) {
    for (const seg of sec.segments) for (const p of seg.points) widths.push(p.w);
  }
  widths.sort((p, q) => p - q);
  const median = widths.length ? widths[Math.floor(widths.length / 2)] : 6;
  return {
    engine: e,
    cam: onPlant
      ? { x: onPlant.x, y: onPlant.y, zoom: 1 }
      : { x: cx, y: cy + (maxY - cy) * 0.25, zoom: 1 },
    centreOfMass: { x: cx, y: cy + (maxY - cy) * 0.25 },
    fit: Math.min(340 / spanX, 460 / spanY) * 0.9,
    // Capped, because it divides by member width and the members got thinner:
    // a plant with four-unit stems asked for a zoom of eleven, which puts the
    // camera inside the geometry and renders every material as the same flat
    // grey. That is what "wool has no surface" turned out to mean.
    stemZoom: (px) => Math.min(4.5, px / Math.max(1, median)),
    centre: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
  };
}

function readFrame(r, c) {
  const gl = r.gl;
  const px = new Uint8Array(c.width * c.height * 4);
  gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { px, w: c.width, h: c.height };
}

const lumAt = (f, x, y) => {
  const i = ((f.h - 1 - y) * f.w + x) * 4;
  return 0.299 * f.px[i] + 0.587 * f.px[i + 1] + 0.114 * f.px[i + 2];
};

function stats(f, step = 3) {
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let y = 0; y < f.h; y += step) {
    for (let x = 0; x < f.w; x += step) {
      const l = lumAt(f, x, y);
      s += l; s2 += l * l; n++;
    }
  }
  const mean = s / n;
  return { mean, sd: Math.sqrt(Math.max(0, s2 / n - mean * mean)) };
}

/** High-frequency content: how much a pixel differs from its neighbour. */
function detail(f) {
  let sum = 0;
  let n = 0;
  for (let y = 2; y < f.h - 2; y += 2) {
    for (let x = 2; x < f.w - 2; x += 2) {
      sum += Math.abs(lumAt(f, x, y) - lumAt(f, x + 1, y))
           + Math.abs(lumAt(f, x, y) - lumAt(f, x, y + 1));
      n += 2;
    }
  }
  return sum / n;
}

/** The pixels the plant covers, found by diffing against a backdrop-only frame. */
function plantMask(r, c, engine, cam) {
  const keep = r.plantMesh;
  r.plantMesh = null;
  r.render(engine.plant, cam, 1000, engine.plant.sections);
  const empty = readFrame(r, c);
  r.plantMesh = keep;
  r.render(engine.plant, cam, 1000, engine.plant.sections);
  const full = readFrame(r, c);
  const mask = new Uint8Array(full.px.length / 4);
  let n = 0;
  for (let i = 0, p = 0; i < full.px.length; i += 4, p++) {
    const d = Math.abs(full.px[i] - empty.px[i])
            + Math.abs(full.px[i + 1] - empty.px[i + 1])
            + Math.abs(full.px[i + 2] - empty.px[i + 2]);
    if (d > 12) { mask[p] = 1; n++; }
  }
  return { mask, count: n, w: full.w, h: full.h, empty };
}

/**
 * Shrink a mask away from its own boundary.
 *
 * A silhouette edge is the highest-contrast thing in the frame and it is
 * identical whatever the surface is made of, so measuring roughness over a
 * whole masked plant mostly measures its outline: wool and clay scored the same
 * while a close-up plainly showed felted fibre against smooth dimples. Only the
 * interior says anything about the substance.
 */
function erode(m, radius = 3) {
  const out = new Uint8Array(m.mask.length);
  let n = 0;
  for (let y = radius; y < m.h - radius; y++) {
    for (let x = radius; x < m.w - radius; x++) {
      const i = y * m.w + x;
      if (!m.mask[i]) continue;
      let ok = 1;
      for (let dy = -radius; dy <= radius && ok; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (!m.mask[i + dy * m.w + dx]) { ok = 0; break; }
        }
      }
      if (ok) { out[i] = 1; n++; }
    }
  }
  return { mask: out, count: n, w: m.w, h: m.h, empty: m.empty };
}

function maskedDiff(a, b, mask) {
  let sum = 0;
  let n = 0;
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    sum += Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1])
         + Math.abs(a.px[i + 2] - b.px[i + 2]);
    n += 3;
  }
  return n ? sum / n : 0;
}

function maskedDetail(f, mask) {
  let sum = 0;
  let n = 0;
  for (let y = 2; y < f.h - 2; y++) {
    for (let x = 2; x < f.w - 2; x++) {
      if (!mask[(f.h - 1 - y) * f.w + x]) continue;
      sum += Math.abs(lumAt(f, x, y) - lumAt(f, x + 1, y))
           + Math.abs(lumAt(f, x, y) - lumAt(f, x, y + 1));
      n += 2;
    }
  }
  return n ? sum / n : 0;
}

/**
 * Write a frame the checks looked at to tools/snapshots, so a failure can be
 * opened rather than reasoned about. Three separate faults in these renderer
 * checks turned out to be the measurement rather than the render, and each one
 * cost a round of guessing that looking would have ended immediately.
 */
function dump(name, f) {
  try {
    const c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    const img = new ImageData(f.w, f.h);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const s = ((f.h - 1 - y) * f.w + x) * 4;
        const d = (y * f.w + x) * 4;
        img.data[d] = f.px[s];
        img.data[d + 1] = f.px[s + 1];
        img.data[d + 2] = f.px[s + 2];
        img.data[d + 3] = 255;
      }
    }
    c.getContext('2d').putImageData(img, 0, 0);
    fetch('/_snap', {
      method: 'POST',
      body: JSON.stringify({ name: `check_${name}.png`, data: c.toDataURL('image/png') }),
    });
  } catch { /* the snapshot endpoint is a convenience, never a dependency */ }
}

function meanAbsDiff(a, b) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.px.length; i += 4 * 7) {
    sum += Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1])
         + Math.abs(a.px[i + 2] - b.px[i + 2]);
    n += 3;
  }
  return sum / n;
}

// ------------------------------------------------------------ the renderer --

let R = null;
let C = null;
let base = null;

try {
  C = newCanvas();
  R = new Renderer3D(C, { preserve: true });
  const { engine, cam } = scene();
  R.render(engine.plant, cam, 1000, engine.plant.sections);
  base = readFrame(R, C);
  const err = R.gl.getError();
  const st = stats(base);
  add('the 3D renderer draws a frame with no GL errors',
    err !== 0 ? `glGetError returned ${err}`
      : st.sd < 4 ? `the frame is nearly uniform (sd ${st.sd.toFixed(1)}) — nothing was drawn`
      : null,
    `mean ${st.mean.toFixed(0)}, sd ${st.sd.toFixed(1)}`);
} catch (e) {
  add('the 3D renderer draws a frame with no GL errors', e.message);
}

// ---------------------------------------------------------- depth is real --

if (R) {
  try {
    const gl = R.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, R.hdr.fbo);
    // depth cannot be read back directly, so prove occlusion instead: put a
    // near sphere over a far one and check the far one stops being visible
    const { engine, cam } = scene(10, 'depth');
    R.render(engine.plant, cam, 1000, engine.plant.sections);
    const front = readFrame(R, C);
    // push the camera far enough back that the same plant is tiny
    R.invalidate();
    R.render(engine.plant, { ...cam, zoom: 0.25 }, 1000, engine.plant.sections);
    const far = readFrame(R, C);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const d = meanAbsDiff(front, far);
    add('the camera has real perspective depth',
      d < 3 ? `changing the camera distance barely changed the image (${d.toFixed(1)})` : null,
      `mean change ${d.toFixed(1)}`);
  } catch (e) {
    add('the camera has real perspective depth', e.message);
  }
}

// --------------------------------------------- the camera stays above ground --

if (R) {
  try {
    // Framing a seedling aims the camera below the plant's own centre, and the
    // eye went under y = 0 — from beneath, the sweep is backfacing, so the
    // lower two thirds of a fresh game rendered as a hard horizon with pure
    // black under it. Worth a check of its own: the floor is only ever seen
    // from one side, and every early turn is somebody's first impression.
    // Framed through the renderer's own camYToPlaceAt, the call the game makes,
    // at the lowest growth line main.js will use. A first version of this check
    // built its own centroid camera instead and passed with the fix removed —
    // it was not exercising the code path that broke.
    const bad = [];
    for (const turns of [0, 1, 2, 4]) {
      const { engine } = scene(turns, 'ground');
      const aim = engine.plant.bounds.maxY;
      const cam = { x: 0, y: R.camYToPlaceAt(aim, 0.16, 1), zoom: 1 };
      R.invalidate();
      R.render(engine.plant, cam, 1000, engine.plant.sections);
      const f = readFrame(R, C);
      let dark = 0;
      let n = 0;
      // lumAt counts y downwards from the top, so the lower frame is the tail
      for (let y = Math.floor(f.h * 0.68); y < f.h; y++) {
        for (let x = 0; x < f.w; x += 3) { if (lumAt(f, x, y) < 14) dark++; n++; }
      }
      const pct = (dark / n) * 100;
      if (pct > 25) bad.push(`turn ${turns}: ${pct.toFixed(0)}% of the lower frame is void`);
    }
    add('the camera never drops below the floor',
      bad.length ? bad.join('; ') : null,
      'framed as the game frames it, at turns 0, 1, 2 and 4');
  } catch (e) {
    add('the camera never drops below the floor', e.message);
  }
}

// ------------------------------------------------------ shadows are cast --

if (R && base) {
  try {
    const { engine, cam } = scene(12, 'shadow');
    R.castShadowsOff = false;
    R.invalidate();
    R.render(engine.plant, cam, 1000, engine.plant.sections);
    const withShadow = readFrame(R, C);
    R.castShadowsOff = true;
    R.invalidate();
    R.render(engine.plant, cam, 1000, engine.plant.sections);
    const without = readFrame(R, C);
    R.castShadowsOff = false;

    // Count pixels the shadow pass actually darkened, over the ground the plant
    // is standing on rather than over the whole frame.
    //
    // This used to measure the frame entire, and passed easily, because the
    // world was a cyclorama: a wall three hundred units behind the plant, which
    // caught its shadow at nearly full size like a projection screen. A real
    // landscape has nothing standing behind the plant to catch anything — the
    // shadow lies down on the ground, in perspective, and covers a fraction of
    // the pixels the wall did. Measured frame-wide that reads as a regression
    // when it is the opposite. What matters, and what a floating plant would
    // fail, is that the ground under and behind it goes darker.
    const band = (f, fn) => {
      let hit = 0;
      let total = 0;
      for (let y = Math.floor(f.h * 0.40); y < Math.floor(f.h * 0.78); y++) {
        for (let x = 0; x < f.w; x += 2) {
          const i = ((f.h - 1 - y) * f.w + x) * 4;
          total++;
          if (fn(i)) hit++;
        }
      }
      return { hit, total };
    };
    const { hit, total } = band(withShadow, (i) => {
      const a = withShadow.px[i] + withShadow.px[i + 1] + withShadow.px[i + 2];
      const b = without.px[i] + without.px[i + 1] + without.px[i + 2];
      return b - a > 12;
    });
    const share = (hit / total) * 100;
    add('the plant casts a shadow onto the ground it stands on',
      // The bound follows the organism. Flower heads were cut to about
      // two-thirds to keep the plant spare, and a smaller plant throws a
      // smaller shadow — 0.22% of the ground band where it used to be 0.5%.
      // What this asserts is that the shadow lands on the ground at all, which
      // a floating plant would fail outright at 0.00%.
      share < 0.10 ? `only ${share.toFixed(2)}% of the ground is darkened by the shadow pass`
        : share > 55 ? `${share.toFixed(1)}% of the ground is in shadow — the map is probably misaligned`
        : null,
      `${share.toFixed(1)}% of the ground darkened`);
  } catch (e) {
    add('the plant casts a shadow onto the ground it stands on', e.message);
  }
}

// ------------------------------------------- every material builds and draws --

if (R) {
  const failed = [];
  for (const mat of MATERIALS) {
    try {
      const { engine, cam } = scene(8, 'mat');
      for (const s of engine.plant.sections) s.materialId = mat.id;
      R.invalidate();
      R.render(engine.plant, cam, 1000, engine.plant.sections);
      const f = readFrame(R, C);
      if (stats(f).sd < 3) failed.push(`${mat.id} drew nothing`);
      if (R.gl.getError() !== 0) failed.push(`${mat.id} raised a GL error`);
    } catch (e) {
      failed.push(`${mat.id}: ${e.message}`);
    }
  }
  add(`all ${MATERIALS.length} materials build geometry and render`,
    failed.length ? failed.slice(0, 4).join('; ') : null, `${MATERIALS.length} materials`);
}

// --------------------------------------------------- surfaces actually differ --

if (R) {
  try {
    // Identical geometry, different material. If the only difference is a
    // roughness number the two frames come out nearly the same, which is
    // exactly the complaint this guards against.
    // Against a plain field, for the reason given at Renderer3D's worldOff: this
    // asks what a substance looks like, and the answer should not depend on
    // whether there happens to be grass in front of it. Zoomed to a stem forty
    // pixels wide the camera sits close enough that the world's own undergrowth
    // was standing between it and the plant, and the mask came back empty.
    R.worldOff = true;
    const ref = scene(18, 'surf');
    // Aimed at where the plant actually is, not at the middle of its bounding
    // box. On a tall spare organism that centre is empty air between two
    // members, so every material rendered as backdrop and every relief
    // measurement came back the same — which reads as "wool has no surface"
    // when what it has is nothing in shot.
    const close = { x: R.camXToCentre(ref.cam.x), y: ref.cam.y, zoom: ref.stemZoom(44) };
    for (const s of ref.engine.plant.sections) { s.materialId = 'botanical'; s.envId = 'meadow'; }
    R.invalidate();
    R.render(ref.engine.plant, close, 1000, ref.engine.plant.sections);
    const whole = plantMask(R, C, ref.engine, close);
    const { mask, count } = erode(whole, 2);

    // How much each material's own relief contributes, measured by switching it
    // off. A raw roughness statistic could not tell these apart: depth of field
    // softens fine fuzz more than coarse dimples, so wool scored no higher than
    // clay even though a close-up plainly shows felt against smooth. Removing
    // the surface and seeing what changes asks the question directly.
    // Lit the same way every time. This is a question about substances, and
    // the plant arrives carrying whichever of the twelve scenes its own answers
    // chose — half of which are dark. An unrelated change elsewhere sent this
    // one to a night sky and every relief measurement collapsed together,
    // reporting that wool had no surface when what it had was no light.
    const sample = (id) => {
      const { engine } = scene(18, 'surf');
      for (const s of engine.plant.sections) { s.materialId = id; s.envId = 'meadow'; }
      R.reliefOff = false;
      R.invalidate();
      R.render(engine.plant, close, 1000, engine.plant.sections);
      const f = readFrame(R, C);
      R.reliefOff = true;
      R.invalidate();
      R.render(engine.plant, close, 1000, engine.plant.sections);
      const flat = readFrame(R, C);
      R.reliefOff = false;
      return { f, relief: maskedDiff(f, flat, mask) };
    };
    const wool = sample('wool');
    const glass = sample('glass');
    const clay = sample('clay');

    const problems = [];
    if (count < 400) problems.push('the plant covers too few pixels to judge');
    if (maskedDiff(wool.f, glass.f, mask) < 12) problems.push('wool and glass render almost identically');
    if (maskedDiff(wool.f, clay.f, mask) < 8) problems.push('wool and clay render almost identically');
    if (wool.relief < 6) problems.push(`wool has no surface of its own (${wool.relief.toFixed(1)})`);
    if (clay.relief < 2) problems.push(`clay has no surface of its own (${clay.relief.toFixed(1)})`);
    // Glass is the smooth one, and it is the only ordering worth asserting.
    //
    // This used to demand that wool be a set multiple of clay, and the margin
    // had to be lowered twice — not because anything broke but because clay
    // kept being given more surface on purpose. A check that has to be relaxed
    // every time the work improves is encoding a passing state of the art
    // rather than a requirement. That both have a real surface of their own,
    // that they do not render alike, and that glass has almost none, are the
    // claims that stay true however the substances are tuned.
    if (glass.relief > Math.min(wool.relief, clay.relief) * 0.5) {
      problems.push(`glass is not the smoothest (${glass.relief.toFixed(1)} against wool ${wool.relief.toFixed(1)}, clay ${clay.relief.toFixed(1)})`);
    }
    if (glass.relief > clay.relief) {
      problems.push(`glass has more surface than clay (${glass.relief.toFixed(1)} vs ${clay.relief.toFixed(1)})`);
    }
    R.worldOff = false;
    add('materials differ by surface, not just by a roughness number',
      problems.length ? `${problems.join('; ')} [on ${count}px]` : null,
      `on ${count}px — relief wool ${wool.relief.toFixed(1)}, clay ${clay.relief.toFixed(1)}, `
      + `glass ${glass.relief.toFixed(1)}`);
  } catch (e) {
    R.worldOff = false;
    add('materials differ by surface, not just by a roughness number', e.message);
  }
}

// ------------------------------------------------------- the flat idioms --

if (R) {
  try {
    const render = (id) => {
      const { engine, cam } = scene(10, 'idiom');
      for (const s of engine.plant.sections) s.materialId = id;
      R.invalidate();
      R.render(engine.plant, cam, 1000, engine.plant.sections);
      return readFrame(R, C);
    };
    const ref2 = scene(10, 'idiom');
    for (const s of ref2.engine.plant.sections) s.materialId = 'botanical';
    R.invalidate();
    R.render(ref2.engine.plant, ref2.cam, 1000, ref2.engine.plant.sections);
    const m2 = plantMask(R, C, ref2.engine, ref2.cam);

    const plain = render('botanical');
    const idioms = [
      'vector', 'lineart', 'ascii', 'pixel', 'halftone', 'dither', 'wireframe',
      'thermal', 'xray', 'depth', 'contour', 'blueprint', 'riso',
      'collage', 'smoke', 'stipple', 'blockprint', 'illumination',
    ];
    const weak = [];
    const seen = [];
    for (const id of idioms) {
      const d = maskedDiff(plain, render(id), m2.mask);
      seen.push(`${id} ${d.toFixed(0)}`);
      if (d < 10) weak.push(`${id} looks the same as botanical (${d.toFixed(1)})`);
      if (!MAT_ID[id] || MAT_ID[id] < 40) weak.push(`${id} has no screen-space id`);
    }
    add('each flat idiom produces a visibly different image',
      weak.length ? weak.join('; ') : null, seen.join(', '));

    // ASCII has to say what the picture says.
    //
    // "Differs from botanical" is passed just as happily by noise, and that is
    // exactly what shipped: every fragment picked its own character from its
    // own luminance, so a cell held pieces of several glyphs and the result was
    // random dots. Type is legible when darker parts of the image carry more
    // ink, so that is what gets measured — per glyph cell, against the ordinary
    // render of the same plant.
    // Judged on the whole organism, not on a close-up.
    //
    // Surface needs a stem magnified; a drawing needs its subject. Framed tight
    // on one stem the flat shading gives a single tonal step across almost the
    // entire frame, every cell picks the same dense glyph, and the correlation
    // is measuring nothing. Filling the frame with the plant gives lit sides,
    // shadowed sides and heads to describe — light and dark for the type to
    // follow. The failing frames are written to tools/snapshots, which is how
    // this was found.
    // The renderer's own cell, in the renderer's own coordinates. gl_FragCoord
    // counts up from the bottom of the frame and the cell is 9 by 14, not
    // square; walking 9 by 9 blocks down from the top meant every block sampled
    // straddled two real cells and mixed two glyphs, which is precisely the
    // defect this check exists to catch. It cannot measure the grid without
    // standing on it.
    const CELL_X = Math.round(9 * R.dpr);
    const CELL_Y = Math.round(14 * R.dpr);
    const lumBU = (f, x, yb) => {
      const i = (yb * f.w + x) * 4;
      return 0.299 * f.px[i] + 0.587 * f.px[i + 1] + 0.114 * f.px[i + 2];
    };

    /** Correlation between a cell's tone and how much ink landed in it. */
    const inkCorrelation = (seed) => {
      // Grown further than the other checks use. The growth rules are
      // deliberately spare now, and a drawing needs a subject: at ten answers
      // there is not enough plant under the glyph grid to have light and dark
      // in it, and the measurement is then about the sample, not the ramp.
      const ref = scene(22, seed);
      const cam = { x: ref.centre.x, y: ref.centre.y, zoom: ref.stemZoom(30) };
      const draw = (id) => {
        const { engine } = scene(22, seed);
        for (const s of engine.plant.sections) s.materialId = id;
        R.invalidate();
        R.render(engine.plant, cam, 1000, engine.plant.sections);
        return readFrame(R, C);
      };
      for (const s of ref.engine.plant.sections) s.materialId = 'botanical';
      R.invalidate();
      R.render(ref.engine.plant, cam, 1000, ref.engine.plant.sections);
      const mk = plantMask(R, C, ref.engine, cam);
      const art = draw('ascii');
      // the flat tone itself, rather than a posterised stand-in for it
      R.toneOnly = true;
      const tones = draw('ascii');
      R.toneOnly = false;

      // Standing on the grid means standing on its phase as well as its size.
      //
      // The shader indexes cells from gl_FragCoord + uGrid, and uGrid is the
      // camera pan — that is the whole mechanism by which the type stays put on
      // the plant instead of crawling across it. So the cell boundaries are not
      // at multiples of the cell size from the corner of the frame; they are
      // offset by the pan. Walking from zero put every sampled block across two
      // real cells and averaged two glyphs together, which flattens exactly the
      // relationship being measured: the ramp reads as describing nothing while
      // it is in fact describing the form correctly.
      const gx = cam.x * 0.4 * cam.zoom * R.dpr;
      const gy = cam.y * cam.zoom * R.dpr;
      const phase = (v, c) => ((-v % c) + c) % c;
      // Rounded to whole pixels: the pan is fractional, and a fractional start
      // walks the sampling loops off the integer grid, where every index lands
      // between texels and reads undefined.
      const x0 = Math.round(phase(gx, CELL_X)) % CELL_X;
      const y0 = Math.round(phase(gy, CELL_Y)) % CELL_Y;

      const pairs = [];
      for (let cy = y0; cy + CELL_Y < art.h; cy += CELL_Y) {
        for (let cx = x0; cx + CELL_X < art.w; cx += CELL_X) {
          let tone = 0;
          let mark = 0;
          let inside = 0;
          let n = 0;
          for (let y = cy; y < cy + CELL_Y; y++) {
            for (let x = cx; x < cx + CELL_X; x++) {
              if (mk.mask[y * art.w + x]) inside++;
              // Counted, not weighed. Summing how far each pixel departs from
              // the bare scene measures the contrast of the ink as much as how
              // much of it there is, and that let an inverted ramp pass: dark
              // parts of the plant give a bigger departure per marked pixel
              // whichever glyph was chosen. What the ramp controls is what
              // fraction of the cell is covered, so that is what to count.
              mark += Math.abs(lumBU(art, x, y) - lumBU(mk.empty, x, y)) > 18 ? 1 : 0;
              tone += lumBU(tones, x, y);
              n++;
            }
          }
          // Whole cells only. A cell that is part backdrop is both darker (or
          // lighter, depending on the scene) *and* less covered simply because
          // less of it is plant, and that association swamped the one being
          // measured: an inverted ramp passed comfortably at 85 per cent.
          if (inside === n) pairs.push([tone / n, mark / n]);
        }
      }
      if (pairs.length <= 24) return { r: null, cells: pairs.length, art, tones };
      // Compared as groups, not as a correlation.
      //
      // The flat idioms are deliberately unlit now, so a drawing holds only a
      // few discrete tones instead of a continuous gradient. Pearson's r falls
      // away when its input is quantised like that even while the property it
      // is asked about holds perfectly, so it was reporting the design rather
      // than a defect. Ranking the cells and comparing the darkest third
      // against the lightest states the claim directly and does not care how
      // many distinct tones there are.
      const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
      const third = Math.floor(sorted.length / 3);
      const mean = (rows) => rows.reduce((a, p) => a + p[1], 0) / Math.max(rows.length, 1);
      const darkInk = mean(sorted.slice(0, third));
      const lightInk = mean(sorted.slice(-third));
      return { ratio: darkInk / Math.max(lightInk, 1e-6), cells: pairs.length, art, tones };
    };

    // Judged over three plants. One organism is a small and lumpy sample: how
    // much light and dark it happens to present depends on where its stems went,
    // and a threshold set against a single one is really a threshold set against
    // that plant. The frames are written to tools/snapshots on failure, which is
    // how the point-sampling bug behind this was found.
    // Judged against a plain field rather than against the landscape, for the
    // reason given at Renderer3D's worldOff.
    R.worldOff = true;
    const runs = ['idiom', 'idiom2', 'idiom3'].map(inkCorrelation);
    R.worldOff = false;
    const usable = runs.filter((x) => x.ratio !== undefined && x.cells > 24);
    const rMean = usable.length
      ? usable.reduce((a, x) => a + x.ratio, 0) / usable.length : 0;
    const asciiBad = usable.length < 2
      ? `only ${runs.map((x) => x.cells).join('/')} cells to judge`
      : rMean < 1.25
        ? `dark cells take ${rMean.toFixed(2)}x the ink of light ones — the ramp is not describing the form`
        : null;
    if (asciiBad) { dump('ascii', runs[0].art); dump('ascii_tone', runs[0].tones); }
    add('ASCII reads as type, not as noise', asciiBad,
      `${usable.length} plants, darkest third takes ${rMean.toFixed(2)}x the ink of the lightest`);
  } catch (e) {
    add('each flat idiom produces a visibly different image', e.message);
  }
}

// ------------------------------------------ nothing leaks around a drawing --

if (R) {
  try {
    // The scene buffer holds the ordinary lit colour under every flat idiom —
    // the drawing is made from it afterwards — and anything in the camera pass
    // that reaches sideways can pull that colour out from under the drawing and
    // lay it along the outline. It happened three times, through the depth of
    // field, then the lens fringing, and finally through the *filter* on the
    // buffer itself, which blended two material ids into one that looked like
    // neither. A still frame of any single idiom shows it plainly, so it is
    // worth asking directly: beside a drawn shape, the backdrop should still
    // look like the backdrop.
    const sc = scene(9, 'leak');
    const cam = { x: sc.centre.x, y: sc.centre.y, zoom: sc.stemZoom(34) };
    for (const s of sc.engine.plant.sections) s.materialId = 'vector';
    R.invalidate();
    R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
    const m = plantMask(R, C, sc.engine, cam);

    // the band of backdrop lying just outside the silhouette
    const band = new Uint8Array(m.mask.length);
    let n = 0;
    for (let y = 2; y < m.h - 2; y++) {
      for (let x = 2; x < m.w - 2; x++) {
        const i = y * m.w + x;
        if (m.mask[i]) continue;
        if (m.mask[i - 1] || m.mask[i + 1] || m.mask[i - m.w] || m.mask[i + m.w]
          || m.mask[i - 2] || m.mask[i + 2]) { band[i] = 1; n++; }
      }
    }

    R.invalidate();
    R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
    const drawn = readFrame(R, C);

    let sum = 0;
    let count = 0;
    for (let i = 0; i < band.length; i++) {
      if (!band[i]) continue;
      const p = i * 4;
      sum += Math.abs(drawn.px[p] - m.empty.px[p])
        + Math.abs(drawn.px[p + 1] - m.empty.px[p + 1])
        + Math.abs(drawn.px[p + 2] - m.empty.px[p + 2]);
      count += 3;
    }
    const leak = count ? sum / count : 0;
    if (leak > 10) { dump('leak_drawn', drawn); dump('leak_empty', m.empty); }
    add('nothing bleeds out around a drawn section',
      n < 200 ? `only ${n} pixels of edge to look at`
        : leak > 10 ? `the backdrop beside the drawing shifted by ${leak.toFixed(1)} per channel`
        : null,
      `${n}px of surrounding backdrop, off by ${leak.toFixed(1)} per channel`);
  } catch (e) {
    add('nothing bleeds out around a drawn section', e.message);
  }
}

// --------------------------------------------------- the glyph ramp itself --

if (R) {
  try {
    // The ramp has to be ordered by how much ink each character puts down, or
    // the whole mapping is backwards however well the rest of it works. The
    // drawing-level check cannot see this on its own — inverting the ramp still
    // leaves a plant covered in characters, and the tonal structure it measures
    // survives — so the ordering is asserted directly, off the atlas.
    const atlas = makeGlyphAtlas(R.gl);
    const cw = atlas.cellW;
    const c2 = document.createElement('canvas');
    c2.width = atlas.canvas.width;
    c2.height = atlas.canvas.height;
    c2.getContext('2d').drawImage(atlas.canvas, 0, 0);
    const px = c2.getContext('2d').getImageData(0, 0, c2.width, c2.height).data;

    const ink = [];
    for (let g = 0; g < atlas.count; g++) {
      let s = 0;
      for (let y = 0; y < c2.height; y++) {
        for (let x = g * cw; x < (g + 1) * cw; x++) s += px[(y * c2.width + x) * 4];
      }
      ink.push(s / (cw * c2.height * 255));
    }
    const falls = [];
    for (let i = 1; i < ink.length; i++) {
      if (ink[i] < ink[i - 1] - 0.02) falls.push(`${i - 1}->${i}`);
    }
    add('the glyph ramp runs from least ink to most',
      ink[0] > 0.02 ? `the first character is not blank (${ink[0].toFixed(3)})`
        : ink[ink.length - 1] < ink[0] + 0.25 ? 'the ramp barely darkens across its length'
        : falls.length ? `ink falls at ${falls.join(', ')}`
        : null,
      `${atlas.count} characters, ${(ink[0] * 100).toFixed(0)}% to ${(ink[ink.length - 1] * 100).toFixed(0)}% covered`);
  } catch (e) {
    add('the glyph ramp runs from least ink to most', e.message);
  }
}

// ------------------------------------------------- the world is not still --

if (R) {
  try {
    // Grass sways, cloud drifts, birds fly, fish hold station against a current.
    //
    // All of it happens in the vertex shader, keyed to the material a vertex
    // belongs to, because the world mesh is megabytes and rebuilding it per
    // frame would cost more than the entire render. The risk with doing it
    // that way is that the displacement quietly catches something it should
    // not — the ground, a trunk, the plant — so this asks for both halves: the
    // living parts move, and the organism stands still.
    const sc = scene(14, `stir`);
    const cam = { x: R.camXToCentre(sc.cam.x), y: sc.cam.y, zoom: sc.fit * 1.4 };
    R.setWorld(0, 0, 0);
    R.invalidate();
    R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
    const mk = erode(plantMask(R, C, sc.engine, cam), 2);

    R.invalidate();
    R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
    const t0 = readFrame(R, C);
    R.invalidate();
    // Three seconds later, to the millisecond.
    //
    // The camera pass wraps its own clock at one second for the film grain, so
    // two times a whole number of seconds apart get the identical grain while
    // the world's clock has genuinely moved on. Sampling at 4200 instead left
    // 1.25 per channel of grain on everything, including the plant, and the
    // check read that as the plant swaying.
    R.render(sc.engine.plant, cam, 4000, sc.engine.plant.sections);
    const t1 = readFrame(R, C);

    const notPlant = new Uint8Array(mk.mask.length);
    for (let q = 0; q < notPlant.length; q++) notPlant[q] = mk.mask[q] ? 0 : 1;
    const world = maskedDiff(t0, t1, notPlant);
    const plant = maskedDiff(t0, t1, mk.mask);

    const problems = [];
    // Averaged over every pixel that is not plant, most of which is static
    // ground and sky: a small part of the frame moving a lot comes out as a
    // small number. With the animation off it is 0.00, so this is a floor
    // against nothing happening rather than a measure of how lively it looks.
    if (world < 0.25) problems.push(`nothing in the world moved in three seconds (${world.toFixed(2)} per channel)`);
    if (plant > 0.25) problems.push(`the plant moved too (${plant.toFixed(2)} per channel)`);
    add(`the living parts of the world move and the plant does not`,
      problems.length ? problems.join(`; `) : null,
      `world ${world.toFixed(2)}, plant ${plant.toFixed(2)} per channel over 3s`);
  } catch (e) {
    add(`the living parts of the world move and the plant does not`, e.message);
  }
}

// --------------------------------------------- the plant reads against it --

if (R) {
  try {
    // The world is held back so that the subject reads.
    //
    // A built world is a busy one and the plant is thin: a green stem in front
    // of a green hill is the same hue at nearly the same value. So everything
    // that is not the plant loses saturation and loses contrast with distance,
    // the way a painter holds a background back, and the plant is left at full
    // strength.
    //
    // Stating that as "the plant is more colourful than its background" was a
    // false measurement: it passed on a beach, where gold sand is more
    // saturated than any stem and the plant reads by being dark instead — and
    // it gave the same number with the effect switched off, which is the
    // definition of measuring nothing. This asks what the effect is actually
    // for: that holding the world back changes the world, and leaves the
    // plant alone.
    const notes = [];
    const problems = [];
    const names = { 0: 'field', 1: 'beach', 4: 'forest' };
    for (const kind of [0, 1, 4]) {
      const sc = scene(14, `recede${kind}`);
      const cam = { x: R.camXToCentre(sc.cam.x), y: sc.cam.y, zoom: sc.fit * 1.5 };
      R.setWorld(kind, 0, 0);
      R.invalidate();
      R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
      const mk = erode(plantMask(R, C, sc.engine, cam), 2);
      if (mk.count < 400) { problems.push(`no plant in shot for ${kind}`); continue; }

      R.invalidate();
      R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
      const held = readFrame(R, C);
      R.recedeOff = true;
      R.invalidate();
      R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
      const raw = readFrame(R, C);
      R.recedeOff = false;

      // Measured over the world's own geometry, not over everything that is
      // not the plant.
      //
      // Most of a beach is sky, and sky is exempt on purpose — it is the air
      // that everything else is fading into, and desaturating it would be
      // desaturating the thing distance fades towards. Averaged over the whole
      // background it read as 0.2 per channel and looked like the effect was
      // switched off, when what it actually measured was how much of that
      // frame is sky. The ground, the hills and the sea are what this is for.
      R.worldOff = true;
      R.invalidate();
      R.render(sc.engine.plant, cam, 1000, sc.engine.plant.sections);
      const bare = readFrame(R, C);
      R.worldOff = false;
      const groundMask = new Uint8Array(mk.mask.length);
      for (let q = 0; q < groundMask.length; q++) {
        if (mk.mask[q]) continue;
        const i = q * 4;
        const d = Math.abs(held.px[i] - bare.px[i]) + Math.abs(held.px[i + 1] - bare.px[i + 1])
          + Math.abs(held.px[i + 2] - bare.px[i + 2]);
        groundMask[q] = d > 16 ? 1 : 0;
      }

      // and only judged where there is ground to judge. A frame that is mostly
      // sky and plant has almost no world geometry in it, and averaging over a
      // handful of pixels reports whatever those few happen to be doing — the
      // beach came back at 0.2, then at 0.4 when the effect was doubled, which
      // is the signature of measuring nothing rather than of nothing happening.
      let groundPx = 0;
      for (let q = 0; q < groundMask.length; q++) groundPx += groundMask[q];
      if (groundPx < 4000) {
        notes.push(`${names[kind]} skipped, only ${groundPx}px of ground`);
        continue;
      }

      // how much each of the two changed when the effect was switched off
      const onPlant = maskedDiff(held, raw, mk.mask);
      const onWorld = maskedDiff(held, raw, groundMask);
      notes.push(`${names[kind]} world ${onWorld.toFixed(1)} plant ${onPlant.toFixed(1)}`);
      // Asserted where there is reliably distant ground, reported everywhere.
      //
      // The effect is a function of distance, so a frame whose world is all
      // close to the camera should show almost nothing changing — and the beach
      // is such a frame: the sand in shot is under the plant's feet. Demanding a
      // change there would be demanding that near ground be desaturated too,
      // which is the opposite of what this is for. The field always has hills at
      // the back of it, so that is where the claim is made.
      if (kind === 0 && onWorld < 3) problems.push(`${names[kind]}: the world is not being held back (${onWorld.toFixed(1)} per channel)`);
      if (onPlant > onWorld * 0.5) problems.push(`${names[kind]}: the plant is being held back too (${onPlant.toFixed(1)} against ${onWorld.toFixed(1)})`);
    }
    R.setWorld(0, 0, 0);
    add(`the world is held back and the plant is not`,
      problems.length ? problems.join(`; `) : null, notes.join(`, `));
  } catch (e) {
    R.setWorld(0, 0, 0);
    add(`the world is held back and the plant is not`, e.message);
  }
}

// ------------------------------------------------- patterns hold on scroll --

if (R) {
  try {
    // A screen-locked pattern looks perfect in any one frame and falls apart in
    // motion: scrolling drags the plant across a stationary grid, so every cell
    // changes contents as it passes and the type crawls. Nothing that renders a
    // single frame can see it, so the check has to move the camera and compare.
    //
    // The plant is shifted by a whole number of device pixels and the second
    // frame shifted back before comparing, which leaves only the pattern.
    const sc = scene(10, 'scroll');
    const cam0 = { x: sc.centre.x, y: sc.centre.y, zoom: sc.stemZoom(40) };
    const rows = 24;                       // whole pixels, so no resampling
    const dy = rows / (cam0.zoom * R.dpr);

    const shot = (camY) => {
      const { engine } = scene(10, 'scroll');
      for (const s of engine.plant.sections) s.materialId = 'halftone';
      R.invalidate();
      R.render(engine.plant, { ...cam0, y: camY }, 1000, engine.plant.sections);
      return readFrame(R, C);
    };
    // The world as it would be with nothing growing in it, at both camera
    // positions. Needed because a screen idiom is see-through: between its marks
    // the scene behind shows, and that scene is now a landscape at every depth,
    // which slides by a different amount than the plant does under the same
    // camera move. Comparing raw pixels — even inside the plant's silhouette —
    // therefore measures parallax through the gaps, not whether the marks
    // themselves held still.
    const worldOnly = (camY) => {
      const { engine } = scene(10, 'scroll');
      for (const s of engine.plant.sections) s.materialId = 'halftone';
      // Build the plant first, then take it away: invalidating and nulling in
      // the other order just has render() build it straight back, and the
      // "world only" frame comes back with the plant still in it.
      R.invalidate();
      R.render(engine.plant, { ...cam0, y: camY }, 1000, engine.plant.sections);
      const keep = R.plantMesh;
      R.plantMesh = null;
      R.render(engine.plant, { ...cam0, y: camY }, 1000, engine.plant.sections);
      const f = readFrame(R, C);
      R.plantMesh = keep;
      return f;
    };

    const a = shot(cam0.y);
    const wa = worldOnly(cam0.y);
    const b = shot(cam0.y + dy);
    const wb = worldOnly(cam0.y + dy);

    const inked = (f, w, i) =>
      Math.abs(f.px[i] - w.px[i]) + Math.abs(f.px[i + 1] - w.px[i + 1])
        + Math.abs(f.px[i + 2] - w.px[i + 2]) > 24;

    // b is the same plant moved down by `rows` device pixels, so a mark that is
    // locked to the plant lands on the same pixel in both once b is shifted back.
    // Two things can go wrong and they look different. A pattern locked to the
    // screen puts its marks in different places on the plant after a scroll, so
    // few of them coincide at all; a pattern that is nearly locked puts them in
    // the same places but not quite, so they coincide and disagree. Counting the
    // marks separately from comparing them tells the two apart, and stops a bad
    // enough slide from being reported as "not enough ink to judge".
    let diff = 0;
    let n = 0;
    let onlyA = 0;
    let onlyB = 0;
    let both = 0;
    for (let y = rows + 4; y < a.h - 4; y++) {
      for (let x = 4; x < a.w - 4; x += 2) {
        const ia = (y * a.w + x) * 4;
        const ib = ((y - rows) * a.w + x) * 4;
        const ka = inked(a, wa, ia);
        const kb = inked(b, wb, ib);
        if (ka && !kb) onlyA++;
        if (kb && !ka) onlyB++;
        if (!ka || !kb) continue;
        both++;
        diff += Math.abs(a.px[ia] - b.px[ib]) + Math.abs(a.px[ia + 1] - b.px[ib + 1])
          + Math.abs(a.px[ia + 2] - b.px[ib + 2]);
        n += 3;
      }
    }
    const marks = Math.min(both + onlyA, both + onlyB);
    if (marks < 900) throw new Error('too little ink in frame to judge');
    const landed = both / marks;
    const drift = n ? diff / n : 999;
    add('screen patterns stay put on the plant when it scrolls',
      // Whether the marks land in the same place is the test; how much the
      // pixels under them differ is only a corroborating detail now.
      //
      // Whether the marks land in the same place is the claim, and it is the
      // only thing asserted. Measured both ways, with the lock working and with
      // it deliberately broken: locked lands 99 to 100% of its marks,
      // screen-locked lands 85%.
      //
      // The per-channel figure is reported and not asserted. It was 2.3 when
      // this was written and it has climbed to 31 without the lock ever
      // faltering, because every improvement to the world raises it: surfaces
      // reflect a direction-dependent environment now, nothing is blurred, and
      // the scenery has hard-edged geometry in it. All of that changes what a
      // pixel returns when the camera moves, none of it moves a mark, and a
      // bound on it would be a bound on the lighting.
      landed < 0.93
        ? `only ${(landed * 100).toFixed(0)}% of the marks landed in the same place — the pattern slid`
        : null,
      `${(landed * 100).toFixed(0)}% of marks held, ${drift.toFixed(1)} per channel after ${rows}px`);
  } catch (e) {
    add('screen patterns stay put on the plant when it scrolls', e.message);
  }
}

// ---------------------------------------------------------- growth reveal --

if (R) {
  try {
    // Measured where the plant is. One section is a small part of a full frame,
    // most of which is backdrop that cannot change, so a whole-frame average
    // dilutes the very thing being asked about — the same fault that made two
    // earlier checks read as passing when they were not.
    const rv = scene(10, 'reveal');
    const cam = { x: rv.centre.x, y: rv.centre.y, zoom: rv.fit };
    const step = rv.engine.plant.sections.length - 1;

    // The mask first. Building it renders the plant twice on its own account,
    // which leaves the mesh in a different state from the reveal frames — asked
    // for afterwards it came back empty, and a share of nothing is nothing.
    const mk = plantMask(R, C, rv.engine, cam);

    // How much plant is on screen at each stage of the reveal.
    //
    // Asking how much the image changed needs a threshold, and any threshold is
    // a guess about how big one section happens to be — which moved the moment
    // the growth rules were thinned, through no fault of the reveal. What the
    // reveal actually promises is that a section arrives *gradually*, so the
    // honest test is that there is more of it at each stage than the last.
    const covered = (progress) => {
      R.invalidate();
      R.render(rv.engine.plant, cam, 1000, rv.engine.plant.sections, { step, progress });
      const f = readFrame(R, C);
      let n = 0;
      for (let i = 0; i < f.px.length; i += 4) {
        const d0 = Math.abs(f.px[i] - mk.empty.px[i])
          + Math.abs(f.px[i + 1] - mk.empty.px[i + 1])
          + Math.abs(f.px[i + 2] - mk.empty.px[i + 2]);
        if (d0 > 24) n++;
      }
      return n;
    };
    const a5 = covered(0.05);
    const a50 = covered(0.5);
    const a100 = covered(1);
    const grew = a100 - a5;
    const problems = [];
    if (grew <= 0) problems.push('the finished section covers no more than its first step');
    else {
      if (a50 <= a5) problems.push('nothing appeared over the first half of the reveal');
      if (a100 <= a50) problems.push('nothing appeared over the second half');
    }
    add('a section grows in rather than appearing at once',
      problems.length ? problems.join('; ') : null,
      `${a5} then ${a50} then ${a100} pixels of plant as the section arrives`);
  } catch (e) {
    add('a section grows in rather than appearing at once', e.message);
  }
}

// ------------------------------------------------------------ save/reload --

{
  const e = new Engine('selftest', 'selftestg');
  e.start();
  for (let i = 0; i < 7; i++) {
    const p = e.prompt;
    if (!p) break;
    e.answer(p.options ? { index: 0 } : { t: 0.4 });
  }
  const round = Engine.fromJSON(JSON.parse(JSON.stringify(e.toJSON())));
  const same = round.plant.sections.length === e.plant.sections.length;
  let grew = false;
  try {
    const before = round.plant.sections.length;
    round.answer(round.prompt.options ? { index: 0 } : { t: 0.5 });
    grew = round.plant.sections.length === before + 1;
  } catch { /* reported below */ }
  add('a game survives being saved and reloaded',
    same && grew ? null : `sections preserved: ${same}, could keep growing: ${grew}`,
    `${e.plant.sections.length} sections`);
}

// ---------------------------------------------------------------- actions --

async function runAction(promptId, gesture) {
  const p = PROMPTS_BY_ID[promptId];
  return new Promise((resolve) => {
    const c = document.createElement('canvas');
    c.style.cssText = 'width:400px;height:190px;display:block';
    stage.append(c);
    const w = new ActionWidget(c, p.action, (t, raw) => {
      w.destroy();
      c.remove();
      resolve({ t, raw });
    });
    w.begin();
    const r = c.getBoundingClientRect();
    const pt = (dx, dy) => ({ clientX: r.left + 200 + dx, clientY: r.top + 95 + dy, pointerId: 1, bubbles: true });
    gesture(c, pt);
  });
}

const near = (a, b, tol = 0.06) => Math.abs(a - b) <= tol;

async function actionChecks() {
  const drag = await runAction('far-enough', (c, pt) => {
    c.dispatchEvent(new PointerEvent('pointerdown', pt(0, 0)));
    c.dispatchEvent(new PointerEvent('pointermove', pt(115, 0)));
    c.dispatchEvent(new PointerEvent('pointerup', pt(115, 0)));
  });
  add('drag: half the reach reads as half', near(drag.t, 0.5) ? null : `got ${drag.t.toFixed(3)}`, drag.t.toFixed(3));

  const rot = await runAction('face-you', (c, pt) => {
    c.dispatchEvent(new PointerEvent('pointerdown', pt(40, 0)));
    for (let a = 0; a <= 180; a += 20) {
      const rad = (a * Math.PI) / 180;
      c.dispatchEvent(new PointerEvent('pointermove', pt(Math.cos(rad) * 40, Math.sin(rad) * 40)));
    }
    c.dispatchEvent(new PointerEvent('pointerup', pt(-40, 0)));
  });
  add('rotate: half a turn reads as half', near(rot.t, 0.5) ? null : `got ${rot.t.toFixed(3)}`, rot.t.toFixed(3));

  const place = await runAction('where-belongs', (c, pt) => {
    c.dispatchEvent(new PointerEvent('pointerdown', pt(0, -60)));
    c.dispatchEvent(new PointerEvent('pointerup', pt(0, -60)));
  });
  add('place: near the top reads high', place.t > 0.85 ? null : `got ${place.t.toFixed(3)}`, place.t.toFixed(3));

  const scale = await runAction('actual-size', (c, pt) => {
    c.dispatchEvent(new PointerEvent('pointerdown', pt(0, 0)));
    c.dispatchEvent(new PointerEvent('pointermove', pt(60, 0)));
    c.dispatchEvent(new PointerEvent('pointerup', pt(60, 0)));
  });
  add('scale: dragging out enlarges', scale.t > 0.5 ? null : `got ${scale.t.toFixed(3)}`, scale.t.toFixed(3));

  const hold = await runAction('hold-worth', (c, pt) => {
    c.dispatchEvent(new PointerEvent('pointerdown', pt(0, 0)));
    setTimeout(() => c.dispatchEvent(new PointerEvent('pointerup', pt(0, 0))), 900);
  });
  const expected = Math.log(0.9 / 0.4) / Math.log(9 / 0.4);
  add('hold: duration reads on a log scale',
    near(hold.t, expected, 0.08) ? null
      : `held ${hold.raw.seconds.toFixed(2)}s, got ${hold.t.toFixed(3)}, expected ~${expected.toFixed(3)}`,
    `${hold.raw.seconds.toFixed(2)}s -> ${hold.t.toFixed(3)}`);
}

// ---------------------------------------------------------------- overlays --

async function overlayChecks() {
  const frame = document.createElement('iframe');
  frame.src = 'index.html?sandbox=1';
  frame.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:560px;opacity:0;border:0;pointer-events:none';
  const loaded = new Promise((resolve) => { frame.onload = resolve; });
  document.body.append(frame);
  await loaded;
  // Wait for the game to actually be up, not merely loaded. The renderer is
  // built a couple of frames after the page paints — the prompt goes on screen
  // first, so the shader compile does not hold it back — so the canvas is still
  // at its HTML default for a moment after load fires.
  // Generous, because a cold driver compiling these shaders for the first time
  // is slow and that is exactly when this check is most likely to run.
  const upBy = Date.now() + 12000;
  for (;;) {
    const c = frame.contentDocument?.getElementById('stage');
    if (c && c.width > 320) break;
    if (frame.contentDocument?.querySelector('[role="alert"]')) break;
    if (Date.now() > upBy) break;
    await new Promise((r) => setTimeout(r, 60));
  }
  await new Promise((r) => setTimeout(r, 300));

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  const shown = (id) => {
    const el = doc.getElementById(id);
    return el ? win.getComputedStyle(el).display !== 'none' : false;
  };

  const wrongly = ['ending', 'reflection', 'specimen', 'inspector', 'note', 'return-now', 'spec-back'].filter(shown);
  add('nothing overlays a fresh game but the prompt',
    wrongly.length ? `these are on screen at step 0: ${wrongly.join(', ')}` : null, '7 overlays checked');

  add('the prompt panel is actually visible',
    shown('prompt-panel') ? null : 'the prompt panel is not being displayed',
    doc.getElementById('prompt-text')?.textContent?.slice(0, 40) || '');

  // The page has to actually start. A module that throws while it is being
  // evaluated takes the whole game with it and leaves a blank page, which is
  // exactly what an unterminated string literal in the startup path did — so
  // this looks for the panel that failure now puts up, and for a canvas that
  // has been sized rather than left at the HTML default of 300x150.
  const gameCanvas = doc.getElementById('stage');
  const failed = doc.querySelector('[role="alert"]');
  const sized = gameCanvas && gameCanvas.width > 320 && gameCanvas.height > 200;
  add('the game starts without falling over',
    failed ? `the page put up its failure panel: ${failed.textContent.slice(0, 90)}`
      : !sized ? `the canvas was never sized (${gameCanvas ? gameCanvas.width + 'x' + gameCanvas.height : 'missing'})`
      : null,
    gameCanvas ? `drawing ${gameCanvas.width}x${gameCanvas.height}` : 'no canvas');

  let ctxKind = 'none';
  try {
    ctxKind = gameCanvas.getContext('webgl2') ? 'webgl2'
      : gameCanvas.getContext('2d') ? '2d' : 'none';
  } catch { ctxKind = 'unavailable'; }
  add('the game itself renders through WebGL',
    ctxKind === 'webgl2' ? null : `the game canvas is using "${ctxKind}"`, ctxKind);

  const bad = [];
  for (const cls of ['curtain', 'panel', 'choices', 'inspector', 'note', 'chip']) {
    const probe = doc.createElement('div');
    probe.className = cls;
    probe.hidden = true;
    doc.body.append(probe);
    if (win.getComputedStyle(probe).display !== 'none') bad.push(cls);
    probe.remove();
  }
  add('the hidden attribute beats every display rule in the stylesheet',
    bad.length ? `hidden does nothing on: ${bad.join(', ')}` : null, '6 classes probed');

  frame.remove();
}

// ------------------------------------------------------------------ report --

function report() {
  const root = document.getElementById('results');
  root.replaceChildren();
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    const li = document.createElement('li');
    li.className = r.ok ? 'ok' : 'bad';
    const mark = document.createElement('span');
    mark.className = 'mark';
    mark.textContent = r.ok ? '✓' : '✕';
    const label = document.createElement('span');
    label.textContent = r.name;
    const det = document.createElement('em');
    det.textContent = r.ok ? (r.detail || '') : r.problem;
    li.append(mark, label, det);
    root.append(li);
  }
  const sum = document.getElementById('summary');
  sum.textContent = `${results.length - failed} passed, ${failed} failed`;
  sum.className = failed ? 'bad' : 'ok';
  stage.remove();
}

actionChecks()
  .then(overlayChecks)
  .then(report, (e) => {
    add('checks crashed', String(e && e.message ? e.message : e));
    report();
  });
