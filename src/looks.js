// The looks: the ways the whole picture can be drawn, and the player's to choose.
//
// A look is not what the plant is made of (that is a material, and comes from
// the answers) and not where it grows (that is a place, and comes from the
// seed). It is the hand the whole scene is drawn in, plant and world together,
// and nothing but the player ever changes it: it used to turn over on a clock,
// and a place going magenta on its own reads as the game breaking.
//
// `renderer` is what draws it: 'v1' is the lit 3D renderer as it stood in v1
// (versions/v1, frozen, and the look that was liked best), 'gl' the printed 3D
// one, 'flat' the 2D one, and 'made' the looks made of one material throughout
// (flat/crafted.js): type, and yarn.

export const LOOKS = [
  { id: '3d', name: '3D', renderer: 'v1' },
  { id: 'print', name: 'Illustrated', renderer: 'gl' },
  { id: 'flat', name: 'Flat', renderer: 'flat' },
  { id: 'ascii', name: 'ASCII', renderer: 'made' },
  { id: 'crochet', name: 'Crochet', renderer: 'yarn' },
  { id: 'riso', name: 'Riso', renderer: 'riso' },
];

export const LOOK_BY_ID = Object.fromEntries(LOOKS.map((l) => [l.id, l]));

/** Where the chosen look is kept. It belongs to the player, not to a plant. */
export const LOOK_KEY = 'flower.look.v1';

/**
 * What the ASCII look is written in: every question asked and the answer
 * given, in order, and then the question now on the table.
 */
export function wordsOf(engine) {
  const said = [];
  for (const s of engine.plant.sections) {
    if (!s.promptText) continue;
    said.push(`${s.promptText} ${String(s.responseLabel || '').replace(/[.?!]*$/, '')}.`);
  }
  if (engine.prompt?.text) said.push(engine.prompt.text);
  return said.join(' ');
}

/**
 * Text as a page: word-wrapped to `cols`, one line a row, each exactly `cols`
 * long. A short text is said again until it fills a screen's worth of rows,
 * each time starting a little further along so the lines do not stack up.
 */
export function layoutText(text, cols) {
  const plain = String(text || '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7e]/g, ' ').replace(/\s+/g, ' ').trim();
  const rows = [];
  let line = '';
  for (const word of plain.split(' ')) {
    if (!word) continue;
    if (line && line.length + 1 + word.length > cols) { rows.push(line); line = ''; }
    line = line ? line + ' ' + word : word.slice(0, cols);
  }
  if (line) rows.push(line);
  const base = rows.slice();
  for (let k = 1; base.length && rows.length < 48; k++) {
    for (const r of base) rows.push((' '.repeat((k * 7) % 11) + r).slice(0, cols));
  }
  return rows.slice(0, 512).map((r) => r.padEnd(cols, ' '));
}
