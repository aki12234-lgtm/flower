// The interface layer.
//
// Kept as thin as the brief asks for: a question, a way to answer it, and
// nothing that reports on the plant. No health bar, no step counter, no
// read-out of what an answer "meant". After you answer, the feedback is that
// something grows.

import { clamp01, clamp, lerp } from './rng.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.el = {
      panel: $('prompt-panel'),
      text: $('prompt-text'),
      response: $('response'),
      note: $('note'),
      inspector: $('inspector'),
      returnNow: $('return-now'),
      finish: $('finish'),
      restart: $('restart'),
      ending: $('ending'),
      endingLine: $('ending-line'),
      endingGo: $('ending-go'),
      reflection: $('reflection'),
      name: $('plant-name'),
      reflect: $('plant-reflection'),
      seal: $('seal'),
      specimen: $('specimen'),
      specName: $('spec-name'),
      specFacts: $('spec-facts'),
      specReflection: $('spec-reflection'),
      specLook: $('spec-look'),
      specNew: $('spec-new'),
      specBack: $('spec-back'),
    };
    this.action = null;
    this.noteTimer = null;
    this.panelTop = null;

    this.el.returnNow.addEventListener('click', () => this.h.onReturnToNow());
    this.el.finish.addEventListener('click', () => this.h.onFinish());
    this.el.endingGo.addEventListener('click', () => this.h.onEndingContinue());
    // Two clicks, because it throws away a life that took a while to grow and
    // there is no way back from it.
    this.el.restart.addEventListener('click', () => {
      if (this.el.restart.dataset.armed === '1') {
        this.el.restart.dataset.armed = '0';
        this.el.restart.textContent = 'start again';
        this.el.restart.classList.remove('armed');
        this.h.onRestart();
        return;
      }
      this.el.restart.dataset.armed = '1';
      this.el.restart.textContent = 'start again? this one is lost';
      this.el.restart.classList.add('armed');
      clearTimeout(this._restartTimer);
      this._restartTimer = setTimeout(() => {
        this.el.restart.dataset.armed = '0';
        this.el.restart.textContent = 'start again';
        this.el.restart.classList.remove('armed');
      }, 4000);
    });
    this.el.seal.addEventListener('click', () => {
      this.h.onSeal(this.el.name.value.trim(), this.el.reflect.value.trim());
    });
    this.el.specLook.addEventListener('click', () => this.h.onLookAtIt());
    this.el.specNew.addEventListener('click', () => this.h.onNewPlant());
    this.el.specBack.addEventListener('click', () => this.h.onBackToCard());
  }

  // ---------------------------------------------------------------- prompt --

  showPrompt(prompt) {
    const { panel, text, response } = this.el;
    this.teardownAction();
    text.textContent = prompt.text;
    response.replaceChildren();

    if (prompt.type === 'binary' || prompt.type === 'quad') {
      response.append(this.buildChoices(prompt));
    } else if (prompt.type === 'slider') {
      response.append(this.buildSlider(prompt));
    } else {
      response.append(...this.buildAction(prompt));
    }

    panel.hidden = false;
    // restart the entrance animation
    panel.style.animation = 'none';
    void panel.offsetWidth;
    panel.style.animation = '';
    // Only now does the action stage have a measurable size. Sizing it from a
    // frame callback instead would leave it blank in a backgrounded tab.
    this.action?.begin();
    this.measurePanel();
  }

  /**
   * How far down the screen the prompt panel starts. The camera uses this to
   * keep the newest growth clear of it: an action prompt carries a 190px stage
   * and is far taller than a two-choice one, and on a short screen the
   * difference decides whether you can see what you just grew.
   *
   * The last measurement is kept while the panel is hidden during growth, so
   * the camera does not lurch when the next question arrives.
   */
  measurePanel() {
    const r = this.el.panel.getBoundingClientRect();
    if (r.height > 0) this.panelTop = r.top;
    return this.panelTop;
  }

  hidePrompt() {
    this.teardownAction();
    this.el.panel.hidden = true;
  }

  buildChoices(prompt) {
    const wrap = document.createElement('div');
    wrap.className = `choices ${prompt.type === 'binary' ? 'two' : 'four'}`;
    prompt.options.forEach((opt, i) => {
      const b = document.createElement('button');
      b.className = 'choice';
      b.type = 'button';
      b.textContent = opt.label;
      b.addEventListener('click', () => {
        if (wrap.dataset.done) return;
        wrap.dataset.done = '1';
        b.classList.add('taken');
        setTimeout(() => this.h.onAnswer({ index: i }), 210);
      });
      wrap.append(b);
    });
    this.choiceButtons = [...wrap.children];
    return wrap;
  }

  buildSlider(prompt) {
    const wrap = document.createElement('div');
    wrap.className = 'slider';

    const poles = document.createElement('div');
    poles.className = 'slider-poles';
    const a = document.createElement('span');
    a.textContent = prompt.poles[0];
    const b = document.createElement('span');
    b.textContent = prompt.poles[1];
    poles.append(a, b);

    const track = document.createElement('div');
    track.className = 'slider-track';
    const knob = document.createElement('div');
    knob.className = 'slider-knob';
    track.append(knob);

    let t = 0.5;
    let done = false;
    const place = () => { knob.style.left = `${t * 100}%`; };
    place();

    const positionFrom = (e) => {
      const r = track.getBoundingClientRect();
      t = clamp01((e.clientX - r.left) / Math.max(1, r.width));
      place();
    };

    const up = (e) => {
      if (done) return;
      track.releasePointerCapture?.(e.pointerId);
      track.removeEventListener('pointermove', positionFrom);
      done = true;
      // A short settle, so a release reads as a decision rather than a twitch.
      track.classList.add('settling');
      setTimeout(() => this.h.onAnswer({ t }), 380);
    };

    track.addEventListener('pointerdown', (e) => {
      if (done) return;
      track.setPointerCapture?.(e.pointerId);
      positionFrom(e);
      track.addEventListener('pointermove', positionFrom);
      track.addEventListener('pointerup', up, { once: true });
      track.addEventListener('pointercancel', up, { once: true });
    });

    wrap.append(poles, track);
    return wrap;
  }

  buildAction(prompt) {
    const canvas = document.createElement('canvas');
    canvas.className = 'action-stage';
    const hint = document.createElement('div');
    hint.className = 'action-hint';
    hint.textContent = HINTS[prompt.action.kind] || '';
    this.action = new ActionWidget(canvas, prompt.action, (t, raw) => {
      this.teardownAction();
      this.h.onAnswer({ t, raw });
    });
    return [canvas, hint];
  }

  teardownAction() {
    this.action?.destroy();
    this.action = null;
  }

  // ------------------------------------------------------------------ note --

  showNote(textContent) {
    if (!textContent) return;
    const n = this.el.note;
    n.textContent = textContent;
    n.hidden = false;
    n.style.animation = 'none';
    void n.offsetWidth;
    n.style.animation = '';
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => { n.hidden = true; }, 5200);
  }

  // ------------------------------------------------------------- inspector --

  showInspector(section, x, y, viewport) {
    const el = this.el.inspector;
    el.querySelector('.insp-step').textContent = `step ${section.step}`;
    el.querySelector('.insp-question').textContent = section.promptText || '';
    el.querySelector('.insp-answer').textContent = describeResponse(section);
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${clamp(x + 16, 12, viewport.w - w - 12)}px`;
    el.style.top = `${clamp(y - h / 2, 12, viewport.h - h - 12)}px`;
  }

  hideInspector() { this.el.inspector.hidden = true; }

  // -------------------------------------------------------------- chrome --

  setReturnVisible(v) { this.el.returnNow.hidden = !v; }
  setFinishVisible(v) { this.el.finish.hidden = !v; }

  // -------------------------------------------------------------- endings --

  showEnding(engine) {
    this.hidePrompt();
    this.setFinishVisible(false);
    this.el.endingLine.textContent =
      engine.ending === 'grounded' ? 'It has come back down to the ground it started from.'
        : engine.ending === 'natural' ? 'It has stopped growing. What is here is what there is.'
        : 'You have decided it is finished.';
    this.el.ending.hidden = false;
  }

  showReflection() {
    this.el.ending.hidden = true;
    this.el.reflection.hidden = false;
    setTimeout(() => this.el.name.focus(), 60);
  }

  showSpecimen(engine, stats) {
    this.el.reflection.hidden = true;
    this.el.specimen.hidden = false;
    this.el.specBack.hidden = true;
    this.el.specName.textContent = engine.archive?.name || 'Unnamed';

    const facts = [
      ['ended', engine.ending === 'grounded' ? 'by reaching the ground'
        : engine.ending === 'natural' ? 'of its own accord'
        : 'by your decision'],
      ['condition', CONDITION_WORDS[stats.condition] || stats.condition],
      ['age', `${stats.age} ${stats.age === 1 ? 'answer' : 'answers'}`],
      ['height', `${Math.round(stats.height)}`],
      ['total length', `${Math.round(stats.length)}`],
      ['widest span', `${Math.round(stats.spread)}`],
      ['made of', stats.materialNames.join(', ')],
      ['grew through', stats.environmentNames.join(', ')],
    ];
    this.el.specFacts.replaceChildren();
    for (const [k, v] of facts) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      this.el.specFacts.append(dt, dd);
    }
    const r = engine.archive?.reflection;
    this.el.specReflection.textContent = r || '';
    this.el.specReflection.hidden = !r;
  }

  hideSpecimen(showBack) {
    this.el.specimen.hidden = true;
    this.el.specBack.hidden = !showBack;
  }

  reset() {
    this.hidePrompt();
    this.hideInspector();
    this.el.ending.hidden = true;
    this.el.reflection.hidden = true;
    this.el.specimen.hidden = true;
    this.el.specBack.hidden = true;
    this.el.note.hidden = true;
    this.el.name.value = '';
    this.el.reflect.value = '';
  }
}

const CONDITION_WORDS = {
  healthy: 'sound',
  strained: 'strained',
  wilting: 'wilting',
  failing: 'barely holding',
  dead: 'dead',
};

const HINTS = {
  hold: 'press and hold',
  drag: 'drag, then let go',
  scale: 'drag out from the centre',
  rotate: 'drag around the centre',
  place: 'drag it somewhere',
};

/** The archival line shown when a past section is inspected. */
function describeResponse(section) {
  const d = section.responseDetail;
  if (d?.poles) {
    const pct = Math.round(d.t * 100);
    return `${d.poles[0]} —— ${d.poles[1]}   ·   ${pct}%`;
  }
  return section.responseLabel || '';
}

// ------------------------------------------------------------ action stage --

/**
 * The physical response types. Each resolves to a single number in 0..1 that
 * the value system reads, so nothing here needs interpreting: the duration,
 * the distance, the angle *is* the answer.
 */
export class ActionWidget {
  constructor(canvas, action, onDone) {
    this.canvas = canvas;
    this.action = action;
    this.onDone = onDone;
    this.ctx = canvas.getContext('2d');
    this.raf = 0;
    this.dead = false;
    this.t = action.kind === 'scale' ? 0.28 : action.kind === 'place' ? 0.5 : 0;
    this.holdStart = 0;
    this.holding = false;
    this.settle = 0;
    this.angle = 0;
    this.lastPointerAngle = null;
    this.pointer = null;

    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    canvas.addEventListener('pointerdown', this.onDown);
  }

  begin() {
    if (this.dead) return;
    this.fit();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width || 400;
    this.h = r.height || 190;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    if (this.dead || this.settle) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp, { once: true });
    this.canvas.addEventListener('pointercancel', this.onUp, { once: true });
    this.pointer = this.local(e);
    if (this.action.kind === 'hold') {
      this.holding = true;
      this.holdStart = performance.now();
    } else {
      this.onMove(e);
    }
  }

  onMove(e) {
    if (this.dead) return;
    const p = this.local(e);
    this.pointer = p;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const a = this.action;

    switch (a.kind) {
      case 'drag': {
        const d = Math.hypot(p.x - cx, p.y - cy);
        this.t = clamp01(d / (a.maxDist * this.scaleFactor()));
        break;
      }
      case 'scale': {
        const d = Math.hypot(p.x - cx, p.y - cy);
        const scale = clamp(d / 26, a.min, a.max);
        this.t = clamp01((scale - a.min) / (a.max - a.min));
        break;
      }
      case 'rotate': {
        const ang = Math.atan2(p.y - cy, p.x - cx);
        if (this.lastPointerAngle !== null) {
          let d = ang - this.lastPointerAngle;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          this.angle = clamp(this.angle + d, 0, a.turns * Math.PI * 2);
        }
        this.lastPointerAngle = ang;
        this.t = clamp01(this.angle / (a.turns * Math.PI * 2));
        break;
      }
      case 'place': {
        this.t = clamp01(1 - (p.y - 26) / Math.max(1, this.h - 52));
        break;
      }
      default:
        break;
    }
  }

  /** Actions are authored in a nominal 400px-wide stage. */
  scaleFactor() { return Math.min(1, this.w / 400); }

  onUp(e) {
    if (this.dead || this.settle) return;
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.releasePointerCapture?.(e.pointerId);

    let raw = null;
    if (this.action.kind === 'hold') {
      const secs = (performance.now() - this.holdStart) / 1000;
      const { min, max } = this.action;
      // Logarithmic: the difference between one second and three matters more
      // than the difference between seven and nine.
      this.t = clamp01(Math.log(Math.max(secs, min) / min) / Math.log(max / min));
      this.holding = false;
      raw = { seconds: secs };
    }
    this.settle = performance.now();
    setTimeout(() => {
      if (this.dead) return;
      this.onDone(this.t, raw);
    }, 420);
  }

  loop(now) {
    if (this.dead) return;
    this.draw(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  draw(now) {
    const ctx = this.ctx;
    const { w, h } = this;
    const cx = w / 2;
    const cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    const settling = this.settle ? clamp01((now - this.settle) / 420) : 0;
    const ink = `rgba(242,236,224,${0.9 - settling * 0.55})`;
    const faint = `rgba(242,236,224,${0.22 - settling * 0.12})`;

    ctx.lineWidth = 1;
    ctx.strokeStyle = faint;
    ctx.fillStyle = ink;

    switch (this.action.kind) {
      case 'hold': {
        const secs = this.holding ? (now - this.holdStart) / 1000 : null;
        const { min, max } = this.action;
        const grow = secs === null
          ? this.t
          : clamp01(Math.log(Math.max(secs, min) / min) / Math.log(max / min));
        const r = 16 + grow * 46;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(242,236,224,${0.10 + grow * 0.16})`;
        ctx.fill();
        ctx.strokeStyle = ink;
        ctx.stroke();
        // a slow breath, so holding never feels like nothing is happening
        const pulse = 1 + Math.sin(now * 0.0022) * 0.05;
        ctx.beginPath();
        ctx.arc(cx, cy, r * pulse + 12, 0, Math.PI * 2);
        ctx.strokeStyle = faint;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        break;
      }
      case 'drag': {
        const reach = this.action.maxDist * this.scaleFactor();
        const p = this.pointer && !settling
          ? this.pointer
          : { x: cx + this.t * reach * 0.72, y: cy };
        const dx = p.x - cx;
        const dy = p.y - cy;
        const d = Math.min(Math.hypot(dx, dy), reach);
        const ux = d ? dx / Math.hypot(dx, dy) : 1;
        const uy = d ? dy / Math.hypot(dx, dy) : 0;
        const paired = this.action.paired;

        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(paired ? cx - ux * d * 0.5 : cx, paired ? cy - uy * d * 0.5 : cy);
        ctx.lineTo(paired ? cx + ux * d * 0.5 : cx + ux * d, paired ? cy + uy * d * 0.5 : cy + uy * d);
        ctx.strokeStyle = faint;
        ctx.stroke();
        ctx.setLineDash([]);

        const mark = (mx, my) => {
          ctx.beginPath();
          ctx.arc(mx, my, 7, 0, Math.PI * 2);
          ctx.fillStyle = ink;
          ctx.fill();
        };
        if (paired) {
          mark(cx - ux * d * 0.5, cy - uy * d * 0.5);
          mark(cx + ux * d * 0.5, cy + uy * d * 0.5);
        } else {
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.strokeStyle = ink;
          ctx.stroke();
          mark(cx + ux * d, cy + uy * d);
        }
        break;
      }
      case 'scale': {
        const a = this.action;
        const scale = lerp(a.min, a.max, this.t);
        const r = 22 * scale;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(r, h * 0.46), 0, Math.PI * 2);
        ctx.strokeStyle = ink;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.strokeStyle = faint;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'rotate': {
        const r = 46;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = faint;
        ctx.stroke();
        const a = -Math.PI / 2 + this.angle;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        ctx.strokeStyle = ink;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 6, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        break;
      }
      case 'place': {
        const top = 26;
        const bottom = h - 26;
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, bottom);
        ctx.strokeStyle = faint;
        ctx.stroke();
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = faint;
        ctx.fillText(this.action.poles[1], cx, top - 8);
        ctx.fillText(this.action.poles[0], cx, bottom + 16);
        const y = lerp(bottom, top, this.t);
        ctx.beginPath();
        ctx.arc(cx, y, 8, 0, Math.PI * 2);
        ctx.fillStyle = ink;
        ctx.fill();
        break;
      }
      default:
        break;
    }
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
  }
}
