const test = require('node:test');
const assert = require('node:assert');
const { planDoubleCast, magicMax, renderPanel } = require('../mod/main.js');

const f = (n, result, ok = true) => ({ n, ok, result, roll: 0.1, fdSafe: false });

test('magicMax mirrors the Grimoire formula', () => {
  assert.strictEqual(magicMax(109, 2), 53);
  assert.strictEqual(magicMax(1, 1), 5);
  assert.strictEqual(magicMax(0, 1), 5); // the game counts at least one tower
  assert.strictEqual(magicMax(25, 1), 25);
});

test('not enough max mana: tells the max needed', () => {
  const p = planDoubleCast({ magic: 53, towers: 109, level: 2, costMult: 1 });
  assert.strictEqual(p.status, 'max');
  assert.strictEqual(p.max, 53);
  assert.strictEqual(p.needMax, 81);
});

test('enough max mana but not full: tells the mana needed', () => {
  const towers = 350; // magicMax(350, 2) >= 81
  const M = magicMax(towers, 2);
  const p = planDoubleCast({ magic: 40, towers, level: 2, costMult: 1 });
  assert.strictEqual(p.status, 'mana');
  assert.strictEqual(p.needMagic, Math.floor(10 + 0.6 * M) + 23);
});

test('playable: keeps as many towers as possible and the second cast fits the new max', () => {
  const towers = 350, M = magicMax(towers, 2);
  const p = planDoubleCast({ magic: M, towers, level: 2, costMult: 1 });
  assert.strictEqual(p.status, 'ok');
  assert.strictEqual(p.keep + p.sell, towers);
  const left = M - Math.floor(10 + 0.6 * M);
  const M2 = magicMax(p.keep, 2), cost2 = Math.floor(10 + 0.6 * M2);
  assert.ok(cost2 <= Math.min(left, M2));
  // one more tower kept would not work
  const M3 = magicMax(p.keep + 1, 2);
  assert.ok(Math.floor(10 + 0.6 * M3) > Math.min(left, M3));
});

test('no selling needed when the mana left already pays a second cast', () => {
  const p = planDoubleCast({ magic: 1000, towers: 350, level: 2, costMult: 1 });
  assert.strictEqual(p.status, 'ok');
  assert.strictEqual(p.sell, 0);
});

test('a cheaper spell cost (Supreme Intellect) lowers the max needed', () => {
  const p = planDoubleCast({ magic: 10, towers: 1, level: 1, costMult: 0.9 });
  assert.ok(p.needMax < 81);
});

test('panel shows the double cast plan when the next two fates are worth it', () => {
  const fates = [f(161, 'frenzy'), f(162, 'click frenzy'), f(163, 'multiply cookies')];
  const plan = { status: 'ok', keep: 14, sell: 246 };
  const html = renderPanel([], [], 100, fates, plan);
  assert.match(html, /Double sort/);
  assert.match(html, /vends 246 tours \(garde 14\)/);
});

test('panel tells the max mana needed for a worthy pair', () => {
  const fates = [f(161, 'frenzy'), f(162, 'click frenzy')];
  const html = renderPanel([], [], 100, fates, { status: 'max', max: 53, needMax: 81 });
  assert.match(html, /81 de mana max/);
});

test('no double cast line when the next two fates are not worth it', () => {
  const fates = [f(163, 'multiply cookies'), f(164, 'frenzy')];
  const html = renderPanel([], [], 100, fates, { status: 'ok', keep: 14, sell: 246 });
  assert.doesNotMatch(html, /Double sort/);
});
