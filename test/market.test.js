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
    { id: 0, name: 'Céréales', symbol: 'CRL', val: 6.4, rest: 10, pct: 0.64, stock: 0, max: 100, mode: 'stable', avg: null },
    { id: 1, name: 'Chocolat', symbol: 'CHC', val: 14.55, rest: 20, pct: 0.7275, stock: 0, max: 100, mode: 'slow rise', avg: null },
  ]);
});

test('average buy price includes the 20% overhead and is weighted across buys', () => {
  const G = fakeGame();
  const M = fakeMarket(G);
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick(); // wraps the market
  M.buyGood(0, 10);           // 10 at 6.4 * 1.2 = 7.68
  M.goodsById[0].val = 5;
  M.buyGood(0, 10);           // 10 at 5 * 1.2 = 6.0
  rec.tick();
  const crl = lastLive(writes).market[0];
  assert.strictEqual(crl.stock, 20);
  assert.ok(Math.abs(crl.avg - 6.84) < 1e-9, String(crl.avg));
});

test('brokers lower the overhead used for the average', () => {
  const G = fakeGame();
  const M = fakeMarket(G);
  M.brokers = 2;
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  M.buyGood(0, 1);
  rec.tick();
  const expected = 6.4 * (1 + 0.01 * 20 * Math.pow(0.95, 2));
  assert.ok(Math.abs(lastLive(writes).market[0].avg - expected) < 1e-9);
});

test('selling keeps the average; selling everything clears it', () => {
  const G = fakeGame();
  const M = fakeMarket(G);
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  M.buyGood(0, 10);
  M.goodsById[0].val = 12;
  M.sellGood(0, 4);
  rec.tick();
  assert.ok(Math.abs(lastLive(writes).market[0].avg - 7.68) < 1e-9);
  M.sellGood(0, 6);
  rec.tick();
  assert.strictEqual(lastLive(writes).market[0].avg, null);
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
