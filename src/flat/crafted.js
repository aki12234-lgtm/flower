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
const CELL = { ascii: [7, 12], crochet: [9, 8] };
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
    this.mode = opts.mode === 'crochet' ? 'crochet' : 'ascii';
    this.gpuName = 'Canvas 2D (made)';
    this.words = '';
  }

  setLook(look) { this.mode = look.id === 'crochet' ? 'crochet' : 'ascii'; }

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
    if (this.mode === 'ascii') this.typeWorld(ctx, v, grid);
    else this.knitWorld(ctx, grid);

    ctx.setTransform(d, 0, 0, d, 0, 0);
    const P = (p) => ({ x: v.W / 2 + (p.x - v.ex) * v.zoom, y: v.H / 2 - (p.y - v.lookY) * v.zoom, w: (p.w || 1) * v.zoom, k: p.k ?? 0 });
    if (this.mode === 'ascii') this.typePlant(ctx, plant, reveal, P, v, time);
    else this.knitPlant(ctx, plant, reveal, P, v, time);
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

  /** The page of small type, white on clear, as tall as the text runs. */
  typeMask(g) {
    const cols = g.cols;
    const key = [cols, g.cw, g.ch, this.words].join('|');
    if (this.maskKey === key) return this.mask;
    this.maskKey = key;
    const rows = layoutText(this.words || '...', cols).slice(0, 160);
    const mask = canvasOf(cols * g.cw, rows.length * g.ch);
    const mc = mask.getContext('2d');
    mc.fillStyle = '#fff';
    mc.font = `600 ${Math.round(g.ch * 0.86)}px ${MONO}`;
    mc.textAlign = 'center';
    mc.textBaseline = 'middle';
    rows.forEach((row, y) => {
      for (let x = 0; x < cols; x++) {
        if (row[x] !== ' ') mc.fillText(row[x], (x + 0.5) * g.cw, (y + 0.5) * g.ch);
      }
    });
    this.mask = mask;
    return mask;
  }

  typeWorld(ctx, v, g) {
    const W = this.pw;
    const H = this.ph;
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) this.layer = canvasOf(W, H);
    const lc = this.layer.getContext('2d');
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.imageSmoothingEnabled = false;
    lc.drawImage(this.cells, g.x0, g.y0, g.cols * g.cw, g.rows * g.ch);
    // the letters cut the colour: what is left is the world, written
    const mask = this.typeMask(g);
    lc.globalCompositeOperation = 'destination-in';
    // rows fixed to the ground, so the page scrolls with the plant
    const first = Math.floor((v.H / 2 + v.lookY * v.zoom) * this.dpr / g.ch);
    let y = g.y0 - mod(-first * g.ch, mask.height) ;
    // one fill of clear where the mask does not reach, then the mask tiled down
    const tiles = canvasOf(W, H);
    const tc = tiles.getContext('2d');
    for (; y < H; y += mask.height) tc.drawImage(mask, 0, y);
    lc.drawImage(tiles, 0, 0);
    lc.globalCompositeOperation = 'source-over';

    ctx.fillStyle = PAGE;
    ctx.fillRect(0, 0, W, H);
    // the shapes themselves, very dimly, so a hill is still a hill behind its letters
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.13;
    ctx.drawImage(this.cells, g.x0, g.y0, g.cols * g.cw, g.rows * g.ch);
    ctx.globalAlpha = 0.72;
    ctx.drawImage(this.layer, 0, 0);
    ctx.globalAlpha = 1;
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
      const ink = hsl({ h: col.h, s: Math.max(col.s, 45), l: 78 });
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
        const colour = hsl({ h: c.h, s: Math.max(c.s, 70), l: leaf ? 62 : 70 });
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
        letter('*', cx, cy, fs * 1.25, '#fff6d8');
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

  // ------------------------------------------------------------------ yarn --

  /** A patch of stocking stitch to lay over the colour: each cell a V, lit from the upper left. */
  knitTile(g) {
    const key = g.cw + 'x' + g.ch;
    if (this.tileKey === key) return this.tile;
    this.tileKey = key;
    const N = 8;
    const tile = canvasOf(g.cw * N, g.ch * N);
    const tc = tile.getContext('2d');
    const rng = makeRng(4471);
    // between the stitches: the shade the yarn falls into
    tc.fillStyle = 'rgb(96,92,98)';
    tc.fillRect(0, 0, tile.width, tile.height);
    tc.lineCap = 'round';
    const leg = (x0, y0, x1, y1, w, tone) => {
      tc.lineWidth = w;
      tc.strokeStyle = `rgb(${tone},${tone},${tone})`;
      tc.beginPath();
      tc.moveTo(x0, y0);
      tc.lineTo(x1, y1);
      tc.stroke();
    };
    // a row overlaps the one under it, so the wrap is drawn too
    for (let j = -1; j <= N; j++) {
      for (let i = -1; i <= N; i++) {
        const x = i * g.cw;
        const y = j * g.ch;
        const b = 232 + Math.round((rng() - 0.5) * 22);
        const jx = (rng() - 0.5) * g.cw * 0.08;
        const mx = x + g.cw / 2 + jx;
        const top = y - g.ch * 0.18;
        const bot = y + g.ch * 1.02;
        const w = g.cw * 0.40;
        for (const side of [-1, 1]) {
          const ox = mx + side * g.cw * 0.30;
          leg(ox, top, mx + side * g.cw * 0.06, bot, w * 1.18, 150);          // its own shadow edge
          leg(ox, top, mx + side * g.cw * 0.06, bot, w * 0.86, b);            // the yarn
          leg(ox - w * 0.12, top + g.ch * 0.2, mx + side * g.cw * 0.06 - w * 0.12, bot - g.ch * 0.3, w * 0.28, 255);
        }
      }
    }
    // the fuzz a yarn has: short loose fibres across the stitches
    for (let f = 0; f < N * N * 3; f++) {
      const x = rng() * tile.width;
      const y = rng() * tile.height;
      const a = rng() * Math.PI;
      const len = g.cw * (0.3 + rng() * 0.5);
      tc.lineWidth = Math.max(0.5, g.cw * 0.05);
      tc.strokeStyle = rng() < 0.5 ? 'rgba(255,255,255,0.20)' : 'rgba(70,66,72,0.14)';
      tc.beginPath();
      tc.moveTo(x, y);
      tc.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      tc.stroke();
    }
    this.tile = tile;
    return tile;
  }

  knitWorld(ctx, g) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.cells, g.x0, g.y0, g.cols * g.cw, g.rows * g.ch);
    // wool is not as loud as ink: a little of its colour goes to the fibre
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(214,200,182,0.42)';
    ctx.fillRect(0, 0, this.pw, this.ph);
    ctx.globalCompositeOperation = 'multiply';
    ctx.setTransform(1, 0, 0, 1, g.gx, g.gy);
    ctx.fillStyle = ctx.createPattern(this.knitTile(g), 'repeat');
    ctx.fillRect(-g.cw, -g.ch, this.pw + g.cw * 2, this.ph + g.ch * 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * The plant, crocheted: a chain a good deal heavier than the knitting behind
   * it, worked a stitch at a time, with the yarn still hanging from each end
   * that is being worked. It lies on the fabric and shades it.
   */
  knitPlant(ctx, plant, reveal, P, v, time) {
    const flowerHue = flowerHueFor(plant);
    const yarn = (c) => {
      const y = { h: c.h, s: clamp(c.s * 1.05, 28, 82), l: clamp(c.l * 1.12 + 9, 34, 72) };
      return { base: hsl(y), dark: hsl(y, -y.l * 0.42), deep: hsl(y, -y.l * 0.62), light: hsl(y, 15, 0.85), y };
    };
    const loop = (x, y, a, len, wid, Y) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(a);
      ctx.fillStyle = Y.dark;
      ctx.beginPath(); ctx.ellipse(0, 0, len * 0.5, wid * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = Y.base;
      ctx.beginPath(); ctx.ellipse(-len * 0.02, -wid * 0.05, len * 0.44, wid * 0.36, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = Y.light;
      ctx.beginPath(); ctx.ellipse(-len * 0.08, -wid * 0.14, len * 0.26, wid * 0.11, 0, 0, Math.PI * 2); ctx.fill();
      // the twist of the plies
      ctx.strokeStyle = Y.dark;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = Math.max(0.6, wid * 0.07);
      for (const k of [-0.22, 0.02, 0.26]) {
        ctx.beginPath(); ctx.moveTo(len * k - wid * 0.12, wid * 0.26); ctx.lineTo(len * k + wid * 0.12, -wid * 0.26); ctx.stroke();
      }
      ctx.restore();
    };
    const shade = (on) => {
      ctx.shadowColor = on ? 'rgba(20,14,24,0.42)' : 'transparent';
      ctx.shadowBlur = on ? 7 * this.dpr : 0;
      ctx.shadowOffsetX = on ? 3 * this.dpr : 0;
      ctx.shadowOffsetY = on ? 5 * this.dpr : 0;
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const ends = [];
    for (const section of plant.sections) {
      const growing = reveal && section.step === reveal.step;
      const kMax = growing ? reveal.progress * section.steps : Infinity;
      if (growing && reveal.progress <= 0) continue;
      const col = stemColour(section, makeRng(1013 + section.step * 7919));
      const Y = yarn(col);
      for (const seg of section.segments) {
        const pts = (growing ? seg.points.filter((p) => p.k <= kMax) : seg.points).map(P);
        if (pts.length < 2) continue;
        const T = clamp(pts[0].w * 3.4, 11, 26) * (seg.depth > 0 ? 0.84 : 1);
        // the cord under the chain, and the shade the whole thing throws
        shade(true);
        ctx.strokeStyle = Y.deep;
        ctx.lineWidth = T * 0.86;
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.stroke();
        shade(false);
        const st = stations(pts, T * 0.60, T * 0.3);
        st.forEach((s, i) => {
          const a = Math.atan2(s.ty, s.tx);
          // the newest stitch is still being pulled through
          const fresh = growing && i === st.length - 1 ? 0.55 + 0.45 * ((kMax * 3) % 1) : 1;
          const nx = -s.ty;
          const ny = s.tx;
          for (const side of [-1, 1]) {
            loop(s.x + nx * side * T * 0.21, s.y + ny * side * T * 0.21, a + side * 0.46, T * 0.98 * fresh, T * 0.46 * fresh, Y);
          }
        });
        if (growing && st.length) ends.push({ ...st[st.length - 1], T, Y });
      }
      const pig = PIGMENT[section.materialId] || PIGMENT.botanical;
      for (const node of section.nodes) {
        const open = growing ? clamp((kMax - Math.max(0, node.k - 2.2)) / 2.2, 0, 1) : 1;
        if (open <= 0) continue;
        const N = yarn(bloomColour(col, node, flowerHue, pig));
        const p = P(node);
        const leaf = node.kind === 'leaf';
        const ca = Math.cos(node.angle);
        const sa = -Math.sin(node.angle);
        if (leaf) {
          const L = Math.max(20, node.size * v.zoom * 2.0) * open;
          const Wd = L * 0.42;
          const G = yarn({ h: 118, s: 46, l: 38 });
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.atan2(sa, ca));
          shade(true);
          ctx.fillStyle = G.dark;
          ctx.beginPath();
          ctx.moveTo(0, 0); ctx.quadraticCurveTo(L * 0.5, -Wd, L, 0); ctx.quadraticCurveTo(L * 0.5, Wd, 0, 0);
          ctx.fill();
          shade(false);
          ctx.save();
          ctx.clip();
          // rows of stitches fanning from the rib
          for (let x = L * 0.08; x < L; x += Math.max(4, L * 0.11)) {
            for (const side of [-1, 1]) {
              ctx.strokeStyle = G.base; ctx.lineWidth = Math.max(3, L * 0.085);
              ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + Wd * 0.7, side * Wd); ctx.stroke();
              ctx.strokeStyle = G.light; ctx.lineWidth = Math.max(1, L * 0.022);
              ctx.beginPath(); ctx.moveTo(x - 1, side * 1.5); ctx.lineTo(x + Wd * 0.6, side * Wd * 0.86); ctx.stroke();
            }
          }
          ctx.restore();
          ctx.strokeStyle = G.deep; ctx.lineWidth = Math.max(1.5, L * 0.04);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(L * 0.94, 0); ctx.stroke();
          ctx.restore();
          continue;
        }
        const R = Math.max(17, node.size * v.zoom * 1.25) * open;
        const cx = p.x + ca * R * 0.95;
        const cy = p.y + sa * R * 0.95;
        const petals = 5 + (node.seed % 2);
        const spin = (node.seed % 628) / 100;
        // each petal a round worked into the middle: the same stitch as the
        // stem, lighter, carried round a ring, and a shorter round inside it
        const t = clamp(R * 0.20, 5, 12);
        const ring = (ox, oy, rot, rx, ry, Yn, th) => {
          const count = Math.max(6, Math.round((Math.PI * (rx + ry)) / (th * 0.62)));
          for (let q = 0; q < count; q++) {
            const b = (q / count) * Math.PI * 2;
            const ex = Math.cos(b) * rx;
            const ey = Math.sin(b) * ry;
            const x = ox + ex * Math.cos(rot) - ey * Math.sin(rot);
            const y = oy + ex * Math.sin(rot) + ey * Math.cos(rot);
            const tan = Math.atan2(Math.cos(b) * ry, -Math.sin(b) * rx) + rot;
            loop(x, y, tan + 0.46, th * 0.98, th * 0.50, Yn);
          }
        };
        const Nin = yarn({ h: N.y.h, s: N.y.s, l: N.y.l - 9 });
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < petals; i++) {
            const a = spin + (i / petals) * Math.PI * 2;
            const px = cx + Math.cos(a) * R * 0.58;
            const py = cy + Math.sin(a) * R * 0.58;
            if (pass === 0) {
              ctx.save();
              ctx.translate(px, py);
              ctx.rotate(a);
              shade(true);
              ctx.fillStyle = N.deep;
              ctx.beginPath(); ctx.ellipse(0, 0, R * 0.46 + t * 0.3, R * 0.34 + t * 0.3, 0, 0, Math.PI * 2); ctx.fill();
              shade(false);
              ctx.restore();
            } else {
              ring(px, py, a, R * 0.16, R * 0.07, Nin, t * 0.8);
              ring(px, py, a, R * 0.28, R * 0.18, Nin, t * 0.9);
              ring(px, py, a, R * 0.42, R * 0.30, N, t);
            }
          }
        }
        // the middle: a small tight round in another yarn
        const M = yarn({ h: 44, s: 78, l: 50 });
        ctx.fillStyle = M.deep;
        ctx.beginPath(); ctx.arc(cx, cy, R * 0.26, 0, Math.PI * 2); ctx.fill();
        ring(cx, cy, 0, R * 0.08, R * 0.08, M, t * 0.8);
        ring(cx, cy, 0, R * 0.20, R * 0.20, M, t * 0.9);
      }
    }

    // the yarn the work is still attached to, hanging from each end being worked
    const live = ends.length ? ends : (plant.tips || []).filter((t) => t.alive !== false).map((t) => {
      const sec = plant.sections.find((s) => s.segments.some((g2) => g2.tipId === t.id));
      const last = [...plant.sections].reverse().find((s) => s.segments.some((g2) => g2.tipId === t.id)) || sec;
      const Y = yarn(stemColour(last || plant.sections[0], makeRng(1013 + (last ? last.step : 0) * 7919)));
      const p = P({ x: t.x, y: t.y, w: t.width || 3 });
      return { x: p.x, y: p.y, T: clamp(p.w * 3.4, 11, 26), Y };
    });
    for (const e of live) {
      const sway = Math.sin(time * 0.0016 + e.x * 0.01) * 5;
      ctx.strokeStyle = e.Y.dark; ctx.lineWidth = e.T * 0.24;
      const tail = () => {
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.bezierCurveTo(e.x + 16 + sway, e.y - 10, e.x + 22 - sway, e.y + 22, e.x + 10 + sway * 1.5, e.y + 44);
        ctx.stroke();
      };
      tail();
      ctx.strokeStyle = e.Y.base; ctx.lineWidth = e.T * 0.15;
      tail();
    }
  }
}
