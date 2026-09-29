const test = require('node:test');
const assert = require('node:assert');
const { renderPanel, detectCombos } = require('../mod/main.js');

const g = (t, buffs, earned = 0) => ({ kind: 'golden', t, wrath: false, earned, buffs });

test('french text, highlight and combo label', () => {
  const acts = [g(1000, ['Frenzy']), { kind: 'clicks', t: 1001, tEnd: 1003, count: 54 }, g(1010, ['Click frenzy'])];
  const html = renderPanel(acts, detectCombos(acts), 1011);
  assert.match(html, /COMBOS/);
  assert.match(html, /doré → Frénésie</);
  assert.match(html, /×54 clics/);
  assert.match(html, /Frénésie de clics/);
  assert.strictEqual((html.match(/ccc-hl/g) || []).length, 3);
  assert.strictEqual((html.match(/★ DOUBLE BONUS/g) || []).length, 1);
  assert.match(html, /\d\d:\d\d:\d\d/);
});

test('golden without buff shows cookies earned; failed spell is red', () => {
  const acts = [g(0, [], 7.7e9), { kind: 'spell', t: 1, spell: 'stretch time', ok: false }];
  const html = renderPanel(acts, [], 2);
  assert.match(html, /\+7,7 G cookies/);
  assert.match(html, /ccc-fail/);
  assert.match(html, /Dilatation temporelle ✘/);
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
