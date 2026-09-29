const test = require('node:test');
const assert = require('node:assert');
const { detectCombos } = require('../mod/main.js');

const g = (t, buffs) => ({ kind: 'golden', t, wrath: false, earned: 0, buffs });
const sp = (t, spell, ok = true) => ({ kind: 'spell', t, spell, ok });
const cl = (t, count = 5) => ({ kind: 'clicks', t, tEnd: t, count });

test('double bonus', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), g(30, ['Click frenzy'])]),
    [{ name: 'DOUBLE BONUS', indices: [0, 1] }]);
});

test('double bonus too late is not a combo', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), g(78, ['Click frenzy'])]), []);
});

test('clicks between steps do not break adjacency and are highlighted', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), cl(1), cl(5), g(10, ['Click frenzy'])]),
    [{ name: 'DOUBLE BONUS', indices: [0, 1, 2, 3] }]);
});

test('a failed spell between steps breaks adjacency', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), sp(2, 'stretch time', false), g(10, ['Click frenzy'])]), []);
});

test('prolongation, overlapping with double bonus', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), g(10, ['Click frenzy']), cl(11), sp(12, 'stretch time')]), [
    { name: 'DOUBLE BONUS', indices: [0, 1] },
    { name: 'PROLONGATION', indices: [1, 2, 3] },
  ]);
});

test('prolongation needs a successful spell within 13 s', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Click frenzy']), sp(5, 'stretch time', false)]), []);
  assert.deepStrictEqual(detectCombos([g(0, ['Click frenzy']), sp(14, 'stretch time')]), []);
});

test('hand of fate then golden cookie', () => {
  assert.deepStrictEqual(detectCombos([sp(0, 'hand of fate'), g(4, [])]),
    [{ name: 'MAIN DU DESTIN', indices: [0, 1] }]);
});

test('boosted conjure; buff actions count as giving the buff', () => {
  assert.deepStrictEqual(detectCombos([{ kind: 'buff', t: 0, name: 'Frenzy', duration: 77 }, sp(20, 'conjure baked goods')]),
    [{ name: 'INVOCATION BOOSTÉE', indices: [0, 1] }]);
});

test('no actions, no combos', () => {
  assert.deepStrictEqual(detectCombos([]), []);
});
