// Which version of the game a page is, and a way across to the other one.
//
// The site carries two. v3, at the root, is the live game, printed in flat
// inks. v2, under v2/, is the lit, realistic line as it stood before v3 was
// drawn over it: versions/v2-real, frozen, served exactly as it is.
//
//   <script src="switch.js" data-version="v3"></script>
//
// A plain script rather than a module, and included ahead of the game's own,
// because it has to have run before main.js reads the saved game (see below).

(() => {
  // Where each version lives, from the site root. The one at the root is the
  // live game, and keeps the save it has always had.
  const VERSIONS = [
    { id: 'v2', path: 'v2/', title: 'v2: the lit, realistic look' },
    { id: 'v3', path: '', title: 'v3: the illustrated look, printed in flat inks' },
  ];

  const script = document.currentScript;
  const me = VERSIONS.find((v) => v.id === script?.dataset.version);
  if (!me) return;
  const root = new URL('.', script.src);

  // One plant per version.
  //
  // Every version keeps its game under the same localStorage key, and on one
  // site they all share one localStorage. A save is not something another
  // version can be trusted with: v2 handed a v3 plant carries it on by its own,
  // older rules (or, failing to read it, starts a new one) and saves the result
  // over the top, so going across to look at the other version would cost the
  // player the plant they came from. The frozen versions are not edited to use
  // keys of their own; their keys are moved for them instead. Anywhere but the
  // root, every 'flower.' key is read and written under that version's name.
  if (me.path && window.Storage) {
    const proto = Storage.prototype;
    for (const name of ['getItem', 'setItem', 'removeItem']) {
      const original = proto[name];
      proto[name] = function (key, ...rest) {
        const moved = typeof key === 'string' && key.startsWith('flower.') ? `${me.id}:${key}` : key;
        return original.call(this, moved, ...rest);
      };
    }
  }

  // The switch: the same glass as the game's chips, in the one corner nothing
  // else uses, and as quiet as "let it be finished" until it is wanted.
  const style = document.createElement('style');
  style.textContent = `
    .version-switch {
      position: fixed;
      top: calc(18px + env(safe-area-inset-top));
      right: calc(18px + env(safe-area-inset-right));
      display: flex;
      gap: 2px;
      padding: 3px;
      font-size: 13px;
      line-height: 1;
      letter-spacing: 0.02em;
      background: var(--glass, rgba(14, 13, 12, 0.52));
      border: 1px solid var(--edge, rgba(242, 236, 224, 0.2));
      border-radius: 999px;
      backdrop-filter: blur(9px);
      -webkit-backdrop-filter: blur(9px);
      opacity: 0.42;
      transition: opacity 300ms;
    }
    .version-switch:hover, .version-switch:focus-within { opacity: 1; }
    .version-switch a {
      padding: 7px 12px;
      border-radius: 999px;
      color: var(--ink-dim, rgba(242, 236, 224, 0.62));
      text-decoration: none;
      transition: color 180ms, background 180ms;
    }
    .version-switch a[href]:hover { color: var(--ink, #f2ece0); background: rgba(242, 236, 224, 0.1); }
    .version-switch a[aria-current] { color: #16140f; background: rgba(242, 236, 224, 0.92); font-weight: 500; }
  `;

  const mount = () => {
    // The measuring flags go across with you. ?reset never does: it throws the
    // saved game away, and it would be the other version's.
    const asked = new URLSearchParams(location.search);
    const carry = new URLSearchParams();
    for (const k of ['stats', 'sandbox']) if (asked.has(k)) carry.set(k, asked.get(k));
    const query = String(carry) ? `?${carry}` : '';

    const nav = document.createElement('nav');
    nav.className = 'version-switch';
    nav.setAttribute('aria-label', 'Version');
    for (const v of VERSIONS) {
      const a = document.createElement('a');
      a.textContent = v.id;
      a.title = v.title;
      if (v === me) a.setAttribute('aria-current', 'page');
      else a.href = new URL(v.path, root).href + query;
      nav.append(a);
    }
    document.head.append(style);
    // First in the overlay, so the curtains at the end of a life draw over it.
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.prepend(nav);
    else document.body.append(nav);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
