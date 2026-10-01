const test = require('node:test');
const assert = require('node:assert');
const { renderPanel, detectCombos } = require('../mod/main.js');

const g = (t, buffs, earned = 0) => ({ kind: 'golden', t, wrath: false, earned, buffs });

test('french text, highlight and combo label', () => {
  const acts = [g(1000, ['Frenzy']), { kind: 'clicks', t: 1001, tEnd: 1003, count: 54 }, g(1010, ['Click frenzy'])];
  const html = renderPanel(acts, detectCombos(acts), 1011);
  assert.match(html, /COMBOS/);
  assert.match(html, /doré : Frénésie</);
  assert.match(html, /×54 clics/);
  assert.match(html, /Frénésie de clics/);
  assert.strictEqual((html.match(/ccc-hl/g) || []).length, 3);
  assert.strictEqual((html.match(/\[DOUBLE BONUS\]/g) || []).length, 1);
  assert.match(html, /\d\d:\d\d:\d\d/);
});

test('golden without buff shows cookies earned; failed spell is red', () => {
  const acts = [g(0, [], 7.7e9), { kind: 'spell', t: 1, spell: 'stretch time', ok: false }];
  const html = renderPanel(acts, [], 2);
  assert.match(html, /\+7,7 B cookies/);
  assert.match(html, /ccc-fail/);
  assert.match(html, /Dilatation temporelle <span class="ccc-ko">RATÉ<\/span>/);
});

test('at most 12 rows, newest last, older than 300 s dropped', () => {
  const acts = [];
  for (let i = 0; i < 20; i++) acts.push({ kind: 'spell', t: 1000 + i, spell: 'conjure baked goods', ok: true });
  acts.unshift({ kind: 'spell', t: 1, spell: 'hand of fate', ok: true });
  const html = renderPanel(acts, [], 1020);
  assert.strictEqual((html.match(/ccc-row/g) || []).length, 12);
  assert.doesNotMatch(html, /Destin/);
});

test('escapes html', () => {
  const html = renderPanel([{ kind: 'buff', t: 0, name: '<img src=x>', duration: 5 }], [], 1);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('highlight index survives trimming to 12 rows', () => {
  const acts = [];
  for (let i = 0; i < 15; i++) acts.push({ kind: 'spell', t: i, spell: 'x', ok: true });
  acts.push(g(20, ['Frenzy']), g(30, ['Click frenzy']));
  const html = renderPanel(acts, detectCombos(acts), 31);
  assert.strictEqual((html.match(/ccc-hl/g) || []).length, 2);
});

test('only plain latin text: no emoji or symbols the game cannot display', () => {
  const acts = [
    g(0, ['Frenzy']), { kind: 'buff', t: 1, name: 'Clot', duration: 66, icon: [15, 5] },
    { kind: 'spell', t: 2, spell: 'stretch time', ok: true, icon: [23, 11] },
    { kind: 'spell', t: 3, spell: 'conjure baked goods', ok: false }, { kind: 'clicks', t: 4, tEnd: 4, count: 9 },
    g(5, ['Click frenzy']),
  ];
  const html = renderPanel(acts, detectCombos(acts), 6);
  const bad = [...html].filter(ch => ch.codePointAt(0) > 0xff && ch !== 'œ' && ch !== 'Œ');
  assert.deepStrictEqual(bad, []);
});

test('each row starts with a game icon from img/icons.png', () => {
  const acts = [
    g(0, []), { kind: 'buff', t: 1, name: 'Clot', duration: 66, icon: [15, 5] },
    { kind: 'spell', t: 2, spell: 'stretch time', ok: true, icon: [23, 11] },
    { kind: 'clicks', t: 3, tEnd: 3, count: 9 },
    { kind: 'buff', t: 4, name: 'Modded', duration: 5, icon: [1, 2, 'http://x/y.png'] },
  ];
  const html = renderPanel(acts, [], 5);
  assert.match(html, /class="ccc-ico" style="background-position:-160px -224px"/); // golden cookie [10,14] at 16 px
  assert.match(html, /background-position:-240px -80px/);   // Clot [15,5]
  assert.match(html, /background-position:-368px -176px/);  // spell [23,11]
  assert.match(html, /background-position:-0px -0px/);      // cursor [0,0] for clicks
  assert.strictEqual((html.match(/ccc-ico/g) || []).length, 4, 'custom icon sheet falls back to no icon');
});

test('numbers use the game short scale (B, T, Qa) like Cookie Monster', () => {
  const html = renderPanel([g(0, [], 2.5e12), g(1, [], 3e15)], [], 2);
  assert.match(html, /\+2,5 T cookies/);
  assert.match(html, /\+3,0 Qa cookies/);
});
