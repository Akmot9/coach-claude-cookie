const test = require('node:test');
const assert = require('node:assert');
const { LiveFeed, ComboTracker, install } = require('../mod/main.js');

function snap(t, over) {
  return Object.assign({
    t, cookies: 100, cookiesEarned: 1000, handmade: 0, clicks: 0, cps: 10,
    buffs: [], magic: null, magicMax: null,
    buildings: { Cursor: 10, Farm: 5 }, upgrades: ['Reinforced index finger'], lumps: 2,
  }, over || {});
}

test('first tick reports state without inventing events', () => {
  const f = new LiveFeed();
  f.onTick(snap(0));
  const st = f.state();
  assert.strictEqual(st.version, 1);
  assert.strictEqual(st.t, 0);
  assert.strictEqual(st.cps, 10);
  assert.deepStrictEqual(st.buildings, { Cursor: 10, Farm: 5 });
  assert.strictEqual(st.lumps, 2);
  assert.deepStrictEqual(st.events, []);
});

test('building, upgrade and lump changes become events', () => {
  const f = new LiveFeed();
  f.onTick(snap(0));
  f.onTick(snap(1, {
    buildings: { Cursor: 12, Farm: 4, Mine: 1 },
    upgrades: ['Reinforced index finger', 'Kitten workers'],
    lumps: 3,
  }));
  assert.deepStrictEqual(f.state().events, [
    { type: 'building', t: 1, name: 'Cursor', delta: 2, amount: 12 },
    { type: 'building', t: 1, name: 'Farm', delta: -1, amount: 4 },
    { type: 'building', t: 1, name: 'Mine', delta: 1, amount: 1 },
    { type: 'upgrade', t: 1, name: 'Kitten workers' },
    { type: 'lump', t: 1, delta: 1, lumps: 3 },
  ]);
});

test('recorder events are kept and the list is capped, newest last', () => {
  const f = new LiveFeed({ maxEvents: 3 });
  for (let i = 0; i < 5; i++) f.onEvent({ type: 'spell', t: i, spell: 'x', ok: true });
  f.onTick(snap(9));
  assert.deepStrictEqual(f.state().events.map(e => e.t), [2, 3, 4]);
});

test('install writes the live file every tick even without a combo', () => {
  const G = {
    fps: 30, cookies: 5, cookiesEarned: 50, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 2, lumps: 1,
    buffs: {}, gainBuff(n) { const b = { name: n, time: 30, maxTime: 30 }; this.buffs[n] = b; return b; },
    shimmerTypes: { golden: { popFunc() {} } },
    Objects: { 'Wizard tower': {} },
    ObjectsById: [{ name: 'Cursor', amount: 3 }],
    UpgradesById: { 0: { name: 'A', bought: 1 }, 1: { name: 'B', bought: 0 } }, // an object in the real game, not an array
  };
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker(), new LiveFeed());
  rec.tick();
  G.ObjectsById[0].amount = 4;
  G.UpgradesById[1].bought = 1;
  G.gainBuff('Clot');
  rec.tick();
  const live = writes.filter(w => w[0] === 'coachclaudelive').map(w => JSON.parse(w[1]));
  assert.strictEqual(live.length, 2);
  assert.deepStrictEqual(live[0].buildings, { Cursor: 3 });
  assert.deepStrictEqual(live[1].events.map(e => e.type).sort(), ['buff', 'building', 'upgrade']);
  assert.ok(!writes.some(w => w[0] === 'coachclaudecookie'), 'no combo file without a combo');
});
