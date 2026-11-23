const test = require('node:test');
const assert = require('node:assert');
const { LiveFeed, ComboTracker, install } = require('../mod/main.js');

function snap(t, over) {
  return Object.assign({
    t, cookies: 100, cookiesEarned: 1000, handmade: 0, clicks: 0, cps: 10,
    buffs: [], magic: null, magicMax: null,
    buildings: { Cursor: 10 }, upgrades: [], lumps: 2,
    dragon: { level: 12, maxLevel: 25, auras: [null, null] },
    levels: { Cursor: 2, Farm: 8 },
    garden: { seeds: 10, seedsTotal: 34 },
  }, over || {});
}

test('dragon, aura, building level and seed changes become events', () => {
  const f = new LiveFeed();
  f.onTick(snap(0));
  f.onTick(snap(1, {
    dragon: { level: 13, maxLevel: 25, auras: ['Breath of Milk', null] },
    levels: { Cursor: 2, Farm: 9 },
    garden: { seeds: 11, seedsTotal: 34 },
  }));
  assert.deepStrictEqual(f.state().events, [
    { type: 'dragon', t: 1, level: 13, prev: 12 },
    { type: 'aura', t: 1, slot: 0, aura: 'Breath of Milk', prev: null },
    { type: 'level', t: 1, name: 'Farm', level: 9 },
    { type: 'seed', t: 1, seeds: 11, total: 34 },
  ]);
  assert.strictEqual(f.state().dragon.level, 13);
});

test('a feed without progress data stays quiet', () => {
  const f = new LiveFeed();
  f.onTick(snap(0, { dragon: undefined, levels: undefined, garden: undefined }));
  f.onTick(snap(1, { dragon: undefined, levels: undefined, garden: undefined }));
  assert.deepStrictEqual(f.state().events, []);
  assert.strictEqual(f.state().dragon, null);
});

test('install reads prestige, dragon, levels, lump, golden cookies and garden from the game', () => {
  const clover = { name: 'Golden clover', unlocked: 1, mature: 50 };
  const wheat = { name: "Baker's wheat", unlocked: 1, mature: 35 };
  const locked = { name: 'Juicy queenbeet', unlocked: 0, mature: 85 };
  const G = {
    fps: 30, cookies: 5, cookiesEarned: 50, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 2, lumps: 1,
    buffs: {}, gainBuff(n) { const b = { name: n, time: 30, maxTime: 30 }; this.buffs[n] = b; return b; },
    shimmerTypes: { golden: { popFunc() {} } },
    prestige: 542, heavenlyChips: 29, resets: 2, cookiesReset: 1e20,
    dragonLevel: 12, dragonAura: 1, dragonAura2: 0, dragonLevels: new Array(26),
    dragonAuras: { 0: { name: 'No aura' }, 1: { name: 'Breath of Milk' } },
    lumpT: 1000000, lumpMatureAge: 2000, lumpRipeAge: 5000, lumpCurrentType: 0,
    goldenClicks: 487, missedGoldenClicks: 1716, season: '',
    Objects: {
      'Wizard tower': {},
      Farm: { minigame: {
        plantsById: [wheat, clover, locked], soil: 0, soilsById: [{ name: 'Dirt' }], freeze: 0, nextStep: 9000,
        isTileUnlocked: (x, y) => y === 0,
        plot: [[[2, 60], [2, 10], [1, 5], [0, 0]], [[3, 0], [0, 0], [0, 0], [0, 0]]],
      } },
    },
    ObjectsById: [{ name: 'Cursor', amount: 3, level: 2 }, { name: 'Farm', amount: 1, level: 8 }],
    UpgradesById: {},
  };
  const writes = [];
  install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed()).tick();
  const st = JSON.parse(writes.find(w => w[0] === 'coachclaudelive')[1]);
  assert.deepStrictEqual(st.ascension, { prestige: 542, chips: 29, resets: 2, cookiesReset: 1e20 });
  assert.deepStrictEqual(st.dragon, { level: 12, maxLevel: 25, auras: ['Breath of Milk', null] });
  assert.deepStrictEqual(st.levels, { Cursor: 2, Farm: 8 });
  assert.deepStrictEqual(st.lump, { matureAt: 1002, ripeAt: 1005, type: 0 });
  assert.deepStrictEqual(st.golden, { clicked: 487, missed: 1716 });
  assert.deepStrictEqual(st.garden, {
    tiles: 4, empty: 1, seeds: 2, seedsTotal: 3, soil: 'Dirt', frozen: false, nextTick: 9,
    plants: { 'Golden clover': { count: 2, mature: 1 }, "Baker's wheat": { count: 1, mature: 0 } },
  });
  assert.strictEqual(st.season, null);
});
