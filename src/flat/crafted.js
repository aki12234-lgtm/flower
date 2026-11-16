// The made looks: the whole picture in one material, plant and world together.
//
// A look here is not a filter laid over a finished picture. It is what the
// scene is made of, and three things have to hold for it to read that way:
//
//   - the plant and the world are the same stuff, and still told apart: in
//     type, by the size of the letters; in yarn, by the weight of the stitch
//   - the stuff is recognisable close to: a letter is a letter, a stitch has a
//     loop, a shade side and a gap beside it
//   - it grows the way that stuff is made: type is written a letter at a time,
//     a chain is worked a stitch at a time
//
// The world is the flat renderer's own (so every place, bird and deer is
// here), drawn small and then set on a grid fixed to the ground: one cell is
// one letter, or one stitch, in one colour. The plant is made directly from
// its sections, over that.

import { Renderer2D } from './renderer2d.js';
import { stemColour, flowerHueFor, bloomColour, PIGMENT } from '../gl/scene.js';
import { makeRng } from '../rng.js';
import { layoutText } from '../looks.js';

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const mod = (a, n) => ((a % n) + n) % n;
const hsl = (c, dl = 0, ks = 1) => `hsl(${c.h.toFixed(0)} ${clamp(c.s * ks, 0, 100).toFixed(0)}% ${clamp(c.l + dl, 2, 97).toFixed(0)}%)`;

/** One cell, in CSS pixels: a small letter, and a knit stitch. */
const CELL = { ascii: [7, 12] };
const PAGE = '#0a0b0e';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function canvasOf(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  return Object.assign(document.createElement('canvas'), { width: Math.max(1, w), height: Math.max(1, h) });
}

/** Points every `gap` along a line of screen points, each with the way the line is heading. */
function stations(pts, gap, from = 0) {
  const out = [];
  let need = from;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) continue;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    while (need <= len) {
      const t = need / len;
      out.push({
        x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx, ty,
        w: a.w + (b.w - a.w) * t, k: (a.k ?? 0) + ((b.k ?? 0) - (a.k ?? 0)) * t,
      });
      need += typeof gap === 'function' ? gap(tx, ty) : gap;
    }
    need -= len;
  }
  return out;
}

export class RendererCrafted extends Renderer2D {
  constructor(canvas, opts = {}) {
    super(canvas, opts);
    this.mode = 'ascii';
    this.gpuName = 'Canvas 2D (made)';
    this.words = '';
  }

  setLook() { this.mode = 'ascii'; }

  /** What the small type behind the plant says: everything asked and answered. */
  setText(text) { this.words = text || ''; }

  render(plant, cam, time, sections) {
    const reveal = arguments[4] || null;
    this.adapt(time);
    this.resize();
    this.ensureWorld();
    const v = this.view(cam, time);
    const d = this.dpr;
    // whole device pixels to a cell, so the grid never beats against the screen
    const cw = Math.max(2, Math.round(CELL[this.mode][0] * d));
    const ch = Math.max(2, Math.round(CELL[this.mode][1] * d));
    // the grid is fixed to the ground: where the world's origin falls, in cells
    const gx = this.mode === 'ascii' ? 0 : Math.round(mod((v.W / 2 - v.ex * v.zoom) * d, cw));
    const gy = Math.round(mod((v.H / 2 + v.lookY * v.zoom) * d, ch));
    const cols = Math.ceil(this.pw / cw) + 2;
    const rows = Math.ceil(this.ph / ch) + 2;
    const grid = { cw, ch, gx, gy, cols, rows, x0: gx - cw, y0: gy - ch };

    this.drawCells(v, time, plant, grid);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.typeWorld(ctx, v, grid);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    const P = (p) => ({ x: v.W / 2 + (p.x - v.ex) * v.zoom, y: v.H / 2 - (p.y - v.lookY) * v.zoom, w: (p.w || 1) * v.zoom, k: p.k ?? 0 });
    this.typePlant(ctx, plant, reveal, P, v, time);
  }

  /**
   * The world, small, and then one colour to a cell. Drawn at a fraction of the
   * size: the cells are all that is kept of it, and a cell is several pixels.
   */
  drawCells(v, time, plant, g) {
    const k = 3 / Math.min(g.cw, g.ch) * this.dpr;       // about three samples across a cell
    const lw = Math.ceil(g.cols * g.cw / this.dpr * k);
    const lh = Math.ceil(g.rows * g.ch / this.dpr * k);
    if (!this.low || this.low.width !== lw || this.low.height !== lh) this.low = canvasOf(lw, lh);
    if (!this.cells || this.cells.width !== g.cols || this.cells.height !== g.rows) this.cells = canvasOf(g.cols, g.rows);
    const lc = this.low.getContext('2d', { alpha: false });
    const lv = { ...v, dpr: k, ox: g.x0 / this.dpr * k, oy: g.y0 / this.dpr * k, time };
    const moving = this.moving.at(time * 0.001, plant, lv);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSky(lc, lv);
    // (the sky is filled to the screen's edge, and the grid starts a cell before it)
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'destination-over';
    lc.drawImage(this.low, -4, -4, lw + 8, lh + 8);
    lc.globalCompositeOperation = 'source-over';
    let m = 0;
    for (const it of this.world.items) {
      while (m < moving.length && moving[m].z < it.z) moving[m++].draw(lc, lv);
      if (!it.sky) it.draw(lc, lv);
    }
    while (m < moving.length) moving[m++].draw(lc, lv);
    const cc = this.cells.getContext('2d', { alpha: false });
    cc.imageSmoothingEnabled = true;
    cc.imageSmoothingQuality = 'high';
    cc.drawImage(this.low, 0, 0, g.cols, g.rows);
  }

  // ------------------------------------------------------------------ type --

  /**
   * The world, typed. Nothing is behind the letters: the page is bare, and a
   * shape is only where there are characters and how heavily they are set.
   * Open sky is left empty. An edge between two things is drawn the way ASCII
   * draws one, with the stroke that leans its way ( | _ / \ ), and what is
   * inside an edge is filled with the running text of what was asked and
   * answered, in one of three weights by how dark the thing is.
   *
   * Set again about ten times a second rather than every frame: a terminal
   * redraws in steps, and twelve thousand characters is real work.
   */
  typeWorld(ctx, v, g) {
    const W = this.pw;
    const H = this.ph;
    const first = Math.floor((v.H / 2 + v.lookY * v.zoom) * this.dpr / g.ch);
    const key = [W, H, g.cols, g.rows, g.y0, first, this.words.length, this.worldKind].join('|');
    const now = v.time || 0;
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) { this.layer = canvasOf(W, H); this.typeKey = null; }
    if (this.typeKey !== key || now - (this.typeAt || 0) > 95) {
      this.typeKey = key;
      this.typeAt = now;
      const cols = g.cols;
      const rows = g.rows;
      const px = this.cells.getContext('2d', { alpha: false, willReadFrequently: true }).getImageData(0, 0, cols, rows).data;
      const lum = new Float32Array(cols * rows);
      for (let i = 0; i < cols * rows; i++) lum[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;
      // the sky is whatever the top row mostly is
      // (the middle value of each channel, so a peak or a cloud up there does not tint it)
      const sky = [0, 1, 2].map((c) => {
        const vals = [];
        for (let x = 0; x < cols; x++) vals.push(px[(cols + x) * 4 + c]);
        return vals.sort((a, b) => a - b)[cols >> 1];
      });
      const far = (i, c) => Math.abs(px[i * 4] - c[0]) + Math.abs(px[i * 4 + 1] - c[1]) + Math.abs(px[i * 4 + 2] - c[2]);
      const diff = (a, b) => Math.abs(px[a * 4] - px[b * 4]) + Math.abs(px[a * 4 + 1] - px[b * 4 + 1]) + Math.abs(px[a * 4 + 2] - px[b * 4 + 2]);
      const text = layoutText(this.words || '...', cols);
      const lc = this.layer.getContext('2d');
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.fillStyle = PAGE;
      lc.fillRect(0, 0, W, H);
      lc.textAlign = 'center';
      lc.textBaseline = 'middle';
      const size = Math.round(g.ch * 0.9);
      const TONES = ['#3d3d39', '#6f6d65', '#a19e92'];
      // one weight at a time, so the font and the colour are set three times and not twelve thousand
      const runs = [[], [], [], []];
      // in colour, a letter is the colour of the thing it is part of: a few
      // dozen inks at most, so the letters are still set an ink at a time
      const inks = new Map();
      const colour = this.typeColour !== false;
      const put = (i, chr, x, y, tone) => {
        if (!colour) { runs[tone].push(chr, x, y); return; }
        const key = ((px[i * 4] >> 4) << 9) | ((px[i * 4 + 1] >> 4) << 5) | ((px[i * 4 + 2] >> 4) << 1) | (tone === 3 ? 1 : 0);
        let run = inks.get(key);
        if (!run) inks.set(key, run = []);
        run.push(chr, x, y);
      };
      for (let y = 1; y < rows - 1; y++) {
        const line = text[mod(y - first, text.length)];
        for (let x = 2; x < cols - 1; x++) {
          const i = y * cols + x;
          const dx = diff(i - 1, i + 1);
          const dy = diff(i - cols, i + cols);
          if (dx + dy > 150) {
            // an edge: the stroke that runs along it
            const sx = lum[i + 1] - lum[i - 1];
            const sy = lum[i + cols] - lum[i - cols];
            const chr = dx > dy * 2.2 ? '|' : dy > dx * 2.2 ? '_' : (sx * sy > 0 ? '/' : '\\');
            put(i, chr, x, y, 3);
            continue;
          }
          if (far(i, sky) < 70) continue;               // open sky: nothing is written
          const chr = line[x];
          if (chr === ' ') continue;
          put(i, chr, x, y, lum[i] > 0.62 ? 0 : lum[i] > 0.36 ? 1 : 2);
        }
      }
      for (const [key, run] of inks) {
        const edge = key & 1;
        // the thing's own colour, brought up to where type reads on a dark page
        let c = [((key >> 9) & 15) * 17, ((key >> 5) & 15) * 17, ((key >> 1) & 15) * 17];
        const m = Math.max(c[0], c[1], c[2], 1);
        const lift = (edge ? 215 : 150) / m;
        c = c.map((q) => Math.round(Math.min(255, q * Math.min(lift, 2.6) * 0.82 + (edge ? 34 : 14))));
        lc.font = `${edge ? 700 : 500} ${size}px ${MONO}`;
        lc.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
        for (let q = 0; q < run.length; q += 3) {
          lc.fillText(run[q], g.x0 + (run[q + 1] + 0.5) * g.cw, g.y0 + (run[q + 2] + 0.5) * g.ch);
        }
      }
      runs.forEach((run, t) => {
        lc.font = `${t >= 2 ? 700 : 500} ${size}px ${MONO}`;
        lc.fillStyle = t === 3 ? '#b4b0a3' : TONES[t];
        for (let q = 0; q < run.length; q += 3) {
          lc.fillText(run[q], g.x0 + (run[q + 1] + 0.5) * g.cw, g.y0 + (run[q + 2] + 0.5) * g.ch);
        }
      });
    }
    ctx.drawImage(this.layer, 0, 0);
  }

  /**
   * The plant, written: each section is the question it grew from and the
   * answer that grew it, set large along its own stems, upright, a letter at a
   * time as it arrives. Its flowers are the answer, in a ring.
   */
  typePlant(ctx, plant, reveal, P, v, time) {
    const flowerHue = flowerHueFor(plant);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const letter = (ch, x, y, fs, colour) => {
      ctx.font = `700 ${fs.toFixed(1)}px ${MONO}`;
      ctx.fillStyle = PAGE;
      ctx.fillRect(x - fs * 0.36, y - fs * 0.56, fs * 0.72, fs * 1.12);
      ctx.fillStyle = colour;
      ctx.fillText(ch, x, y + fs * 0.04);
    };
    for (const section of plant.sections) {
      const growing = reveal && section.step === reveal.step;
      const kMax = growing ? reveal.progress * section.steps : Infinity;
      if (growing && reveal.progress <= 0) continue;
      const col = stemColour(section, makeRng(1013 + section.step * 7919));
      const ink = '#ffffff';
      const said = section.promptText
        ? `${section.promptText} ${String(section.responseLabel || '').toUpperCase()} `
        : 'ONCE ';
      let n = 0;
      for (const seg of section.segments) {
        // set from the whole run, grown or not, so a letter never changes
        // under the eye: only how many of them are there yet
        const pts = seg.points.map(P);
        if (pts.length < 2) continue;
        const fs = clamp(pts[0].w * 4.2, 13, 26) * (seg.depth > 0 ? 0.86 : 1);
        // upright letters: a line going up the screen needs a whole line's height each
        const st = stations(pts, (tx, ty) => fs * (0.64 * Math.abs(tx) + 1.02 * Math.abs(ty)), fs * 0.5);
        // a straight run is read left to right and top to bottom whichever way
        // it grew, so one heading left or up takes its letters from the far end
        for (let a = 0; a < st.length;) {
          let b = a + 1;
          while (b < st.length && Math.abs(st[b].tx - st[a].tx) + Math.abs(st[b].ty - st[a].ty) < 0.2) b++;
          const back = st[a].tx < -0.3 || (Math.abs(st[a].tx) <= 0.3 && st[a].ty < 0);
          for (let i = a; i < b; i++) {
            const ch = said[(n + (back ? b - 1 - i : i - a)) % said.length];
            if (st[i].k <= kMax) letter(ch, st[i].x, st[i].y, fs, ink);
          }
          n += b - a;
          a = b;
        }
      }
      const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
      for (const node of section.nodes) {
        const open = growing ? clamp((kMax - Math.max(0, node.k - 2.2)) / 2.2, 0, 1) : 1;
        if (open <= 0) continue;
        const c = bloomColour(col, node, flowerHue, pig);
        const p = P(node);
        const leaf = node.kind === 'leaf';
        const R = Math.max(leaf ? 8 : 15, node.size * v.zoom * (leaf ? 0.8 : 1.15)) * open;
        const cx = p.x + Math.cos(node.angle) * R * 1.15;
        const cy = p.y - Math.sin(node.angle) * R * 1.15;
        const word = (String(section.responseLabel || 'yes').replace(/[^A-Za-z0-9]/g, '') || 'yes').toUpperCase();
        const colour = leaf ? '#ffffff' : hsl({ h: c.h, s: Math.max(c.s, 80), l: 66 });
        if (leaf) {
          const fs = clamp(R * 0.9, 11, 18);
          for (let i = 0; i < 3; i++) {
            letter(word[i % word.length], cx + Math.cos(node.angle) * (i - 1) * fs * 0.66, cy - Math.sin(node.angle) * (i - 1) * fs * 0.9, fs, colour);
          }
          continue;
        }
        const fs = clamp(R * 0.62, 13, 24);
        const count = Math.max(5, Math.min(10, Math.round((2 * Math.PI * R) / (fs * 0.8))));
        for (let i = 0; i < Math.round(count * open); i++) {
          const a = (i / count) * Math.PI * 2 - Math.PI / 2;
          letter(word[i % word.length], cx + Math.cos(a) * R, cy + Math.sin(a) * R * 0.92, fs, colour);
        }
        letter('@', cx, cy, fs * 1.2, '#ffffff');
      }
    }
    // where the writing has got to: a cursor at every growing end
    if (Math.floor(time / 530) % 2 === 0 || reveal) {
      for (const tip of plant.tips || []) {
        if (tip.alive === false) continue;
        let at = tip;
        if (reveal) {
          const sec = plant.sections[plant.sections.length - 1];
          const seg = sec && sec.segments.find((s) => s.tipId === tip.id);
          const pts = seg ? seg.points.filter((p) => p.k <= reveal.progress * sec.steps) : [];
          if (pts.length) at = pts[pts.length - 1];
        }
        const p = P(at);
        const fs = clamp((tip.width || 3) * v.zoom * 4.2, 13, 26);
        ctx.fillStyle = '#f4f1e6';
        ctx.fillRect(p.x - fs * 0.3, p.y - fs * 1.5, fs * 0.6, fs);
      }
    }
  }
}
