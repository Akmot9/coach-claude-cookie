const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { predictFates, renderPanel, install, ComboTracker, LiveFeed, ActionLog } = require('../mod/main.js');

// A Math object with the game's seedrandom, like Math in the game page.
function gameMath() {
  const ctx = { Math: Object.create(Math), navigator: { plugins: [] }, screen: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures', 'seedrandom.min.js'), 'utf8'), ctx);
  return ctx.Math;
}
const BASE = { seed: 'wdilj', failChance: 0.15, buildings10: true, dragonflight: false, season: '' };

test('reproduces real casts recorded in game (seed wdilj, casts 7-13)', () => {
  const got = predictFates(gameMath(), Object.assign({}, BASE, { start: 7, count: 7 }));
  assert.deepStrictEqual(got.map(f => [f.n, f.ok, f.result]), [
    [7, false, 'ruin cookies'], [8, true, 'cookie storm drop'], [9, false, 'ruin cookies'],
    [10, true, 'click frenzy'], [11, true, 'cookie storm drop'], [12, true, 'frenzy'], [13, true, 'frenzy'],
  ]);
});

test('a golden cookie on screen (+15% fail) flips cast 18 to a backfire', () => {
  const calm = predictFates(gameMath(), Object.assign({}, BASE, { start: 18, count: 1 }))[0];
  const busy = predictFates(gameMath(), Object.assign({}, BASE, { start: 18, count: 1, failChance: 0.30 }))[0];
  assert.deepStrictEqual([calm.ok, calm.result], [true, 'click frenzy']);
  assert.strictEqual(busy.ok, false);
});

test('dragonflight removes click frenzy from the choices', () => {
  const f = predictFates(gameMath(), Object.assign({}, BASE, { start: 18, count: 1, dragonflight: true }))[0];
  assert.notStrictEqual(f.result, 'click frenzy');
});

test('valentines/easter consume one extra random for the cookie picture', () => {
  const a = predictFates(gameMath(), Object.assign({}, BASE, { start: 10, count: 12 })).map(f => f.result);
  const b = predictFates(gameMath(), Object.assign({}, BASE, { start: 10, count: 12, season: 'valentines' })).map(f => f.result);
  assert.notDeepStrictEqual(a, b);
});

test('prediction reseeds the global random stream afterwards', () => {
  const M = gameMath();
  const calls = [];
  const orig = M.seedrandom;
  M.seedrandom = function () { calls.push(arguments.length); return orig.apply(this, arguments); };
  predictFates(M, Object.assign({}, BASE, { start: 13, count: 2 }));
  assert.deepStrictEqual(calls, [1, 1, 0]);
});

test('panel shows the next fates, highlighting the good ones', () => {
  const fates = [
    { n: 13, ok: true, result: 'frenzy' }, { n: 14, ok: false, result: 'clot' },
    { n: 15, ok: true, result: 'click frenzy' }, { n: 16, ok: true, result: 'building special' },
  ];
  const html = renderPanel([], [], 0, fates);
  assert.match(html, /Destin/);
  assert.match(html, /13 : Frénésie/);
  assert.match(html, /14 : <span class="ccc-ko">RATÉ \(Caillot\)<\/span>/);
  assert.match(html, /<span class="ccc-good">15 : Frénésie de clics<\/span>/);
  assert.match(html, /<span class="ccc-good">16 : Bonus de bâtiment<\/span>/);
  assert.doesNotMatch(renderPanel([], [], 0, null), /Destin/);
});

test('install predicts from the grimoire, caches until the cast count changes', () => {
  const rng = gameMath();
  let seeds = 0;
  const orig = rng.seedrandom;
  rng.seedrandom = function () { seeds++; return orig.apply(this, arguments); };
  const M = {
    magic: 25, magicM: 25, spellsCastTotal: 13, spells: { 'hand of fate': {} },
    getFailChance() { return 0.15; },
  };
  const G = {
    fps: 30, seed: 'wdilj', season: '', BuildingsOwned: 500, cookies: 0, cookiesEarned: 0, handmadeCookies: 0,
    cookieClicks: 0, cookiesPs: 0, lumps: 0, buffs: {}, hasBuff() { return 0; },
    gainBuff() {}, shimmerTypes: { golden: { popFunc() {} } },
    Objects: { 'Wizard tower': { minigame: M } }, ObjectsById: [], UpgradesById: {},
  };
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed(), { log: new ActionLog(), doc: null, rng });
  rec.tick();
  const live = JSON.parse(writes.filter(w => w[0] === 'coachclaudelive').pop()[1]);
  assert.deepStrictEqual(live.fates.slice(0, 2).map(f => [f.n, f.ok, f.result]), [[13, true, 'frenzy'], [14, false, 'clot']]);
  const after = seeds;
  rec.tick();
  assert.strictEqual(seeds, after, 'no recompute when nothing changed');
  M.spellsCastTotal = 14;
  rec.tick();
  assert.ok(seeds > after, 'recomputed after a cast');
});
