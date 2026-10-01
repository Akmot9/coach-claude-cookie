const test = require('node:test');
const assert = require('node:assert');
const { install, ComboTracker, LiveFeed } = require('../mod/main.js');

// Minimal stock market shaped like minigameMarket.js
function fakeMarket(G) {
  const M = {
    brokers: 0,
    goodsById: [
      { id: 0, name: 'Céréales', symbol: 'CRL', val: 6.4, mode: 0, stock: 0, active: true, hidden: false },
      { id: 1, name: 'Chocolat', symbol: 'CHC', val: 14.55, mode: 1, stock: 0, active: true, hidden: false },
      { id: 2, name: 'Beurre', symbol: 'BTR', val: 20, mode: 2, stock: 0, active: false, hidden: false },
    ],
    getRestingVal(id) { return 10 + 10 * id; },
    getGoodMaxStock() { return 100; },
    buyGood(id, n) { const g = this.goodsById[id]; g.stock += n; return true; },
    sellGood(id, n) { const g = this.goodsById[id]; n = Math.min(n, g.stock); g.stock -= n; return n > 0; },
  };
  G.Objects.Bank = { minigame: M };
  return M;
}
function fakeGame() {
  return {
    fps: 30, cookies: 0, cookiesEarned: 0, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 0, lumps: 0, buffs: {},
    gainBuff() {}, shimmerTypes: { golden: { popFunc() {} } }, Objects: {}, ObjectsById: [], UpgradesById: {},
  };
}
function lastLive(writes) { return JSON.parse(writes.filter(w => w[0] === 'coachclaudelive').pop()[1]); }

test('live feed lists active goods with price, resting value, stock and trend', () => {
  const G = fakeGame();
  fakeMarket(G);
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  assert.deepStrictEqual(lastLive(writes).market, [
    { id: 0, name: 'Céréales', symbol: 'CRL', val: 6.4, rest: 10, pct: 0.64, stock: 0, max: 100, mode: 'stable', avg: null, unknown: 0, realized: 0 },
    { id: 1, name: 'Chocolat', symbol: 'CHC', val: 14.55, rest: 20, pct: 0.7275, stock: 0, max: 100, mode: 'slow rise', avg: null, unknown: 0, realized: 0 },
  ]);
});

test('average buy price comes from the Suivi des ordres ledger when present', () => {
  const G = fakeGame();
  const M = fakeMarket(G);
  M.goodsById[0].stock = 20;
  G.mods = { 'suivi des ordres': { ledger: {
    position(id, val) {
      if (id !== 0) return { qtyKnown: 0, qtyUnknown: 0, pru: 0, unrealized: 0, realized: 0 };
      return { qtyKnown: 15, qtyUnknown: 5, pru: 6.84, unrealized: 15 * (val - 6.84), realized: 12 };
    },
  } } };
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  const crl = lastLive(writes).market[0];
  assert.ok(Math.abs(crl.avg - 6.84) < 1e-9);
  assert.strictEqual(crl.unknown, 5);
  assert.ok(Math.abs(crl.realized - 12) < 1e-9);
});

test('without the ledger mod, avg is null and nothing breaks', () => {
  const G = fakeGame();
  const M = fakeMarket(G);
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  M.buyGood(0, 10);
  rec.tick();
  const crl = lastLive(writes).market[0];
  assert.strictEqual(crl.avg, null);
  assert.strictEqual(crl.stock, 10);
});

test('a failed buy (returns false) does not change the average', () => {
  const G = fakeGame();
  const M = fakeMarket(G);
  M.buyGood = function () { return false; };
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  M.buyGood(0, 10);
  rec.tick();
  assert.strictEqual(lastLive(writes).market[0].avg, null);
});

test('no bank minigame gives a null market', () => {
  const writes = [];
  const rec = install(fakeGame(), (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  assert.strictEqual(lastLive(writes).market, null);
});
