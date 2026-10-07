// What each place costs to build, in vertices and in milliseconds.
//
//   node tools/budget.mjs
//
// The world is built on the main thread the first time a game is framed, and
// again whenever the camera has climbed far enough to need a bigger one. Every
// vertex in here is time the player spends looking at nothing.
import { buildBackdrop, PLACES } from '../src/gl/scene.js';
import { ENVIRONMENTS } from '../src/environment.js';

let worst = 0;
for (let i = 0; i < PLACES.length; i++) {
  const t0 = performance.now();
  const b = buildBackdrop(ENVIRONMENTS[0], { w: 900, h: 1200 }, i);
  const ms = performance.now() - t0;
  const v = b.data.length / 15;
  worst = Math.max(worst, v);
  console.log(PLACES[i].id.padEnd(8), String(v).padStart(7), 'verts',
    (b.data.length * 4 / 1048576).toFixed(1).padStart(5), 'MB', ms.toFixed(0).padStart(4), 'ms',
    b.wide ? '32-bit' : '16-bit');
}
console.log('worst', worst);
