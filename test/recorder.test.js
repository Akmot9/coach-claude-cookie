const test = require('node:test');
const assert = require('node:assert');
const { ComboTracker, install } = require('../mod/main.js');

function fakeGame() {
  const G = {
    fps: 30, cookies: 100, cookiesEarned: 100, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 5,
    buffs: {},
    gainBuff(type, time, a1) {
      const b = { name: type, time: time * 30, maxTime: time * 30, multCpS: a1 || 1 };
      this.buffs[type] = b; return b;
    },
    shimmerTypes: { golden: { popFunc(me) { G.cookiesEarned += 50; G.gainBuff('Frenzy', 77, 7); return 'popped'; } } },
    Objects: { 'Wizard tower': { minigame: undefined } },
  };
  return G;
}
function grimoire() {
  return {
    magic: 12, magicM: 20,
    spells: {
      'conjure baked goods': { win() { return 'w'; }, fail() { return 'f'; } },
      'stretch time': { win() { return 'w2'; } },
    },
  };
}

test('records buffs and golden clicks, returns originals values', () => {
  const G = fakeGame();
  const tr = new ComboTracker();
  const events = [];
  const orig = tr.onEvent.bind(tr);
  tr.onEvent = e => { events.push(e); orig(e); };
  install(G, () => {}, tr);
  const r = G.shimmerTypes.golden.popFunc({ wrath: 0 });
  assert.strictEqual(r, 'popped');
  const golden = events.find(e => e.type === 'golden');
  assert.strictEqual(golden.earned, 50);
  assert.deepStrictEqual(golden.buffs, ['Frenzy']);
  const buff = events.find(e => e.type === 'buff');
  assert.deepStrictEqual([buff.name, buff.duration, buff.multCpS, buff.multClick], ['Frenzy', 77, 7, 1]);
});

test('tick snapshots game, writes file only when changed', () => {
  const G = fakeGame();
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), new ComboTracker());
  rec.tick();
  assert.strictEqual(writes.length, 0);
  G.gainBuff('Frenzy', 77, 7);
  rec.tick();
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0][0], 'coachclaudecookie');
  const st = JSON.parse(writes[0][1]);
  assert.ok(st.current);
  const k = st.current.ticks[0];
  assert.deepStrictEqual(k.buffs, [{ name: 'Frenzy', timeLeft: 77, duration: 77, multCpS: 7, multClick: 1 }]);
  assert.strictEqual(k.magic, null);
});

test('wraps spells once grimoire appears', () => {
  const G = fakeGame();
  const tr = new ComboTracker();
  const rec = install(G, () => {}, tr);
  rec.tick();
  const M = grimoire();
  G.Objects['Wizard tower'].minigame = M;
  rec.tick();
  rec.tick(); // must not double-wrap
  tr.onTick = () => {};
  const events = [];
  tr.onEvent = e => events.push(e);
  assert.strictEqual(M.spells['conjure baked goods'].win(), 'w');
  assert.strictEqual(M.spells['conjure baked goods'].fail(), 'f');
  assert.strictEqual(M.spells['stretch time'].win(), 'w2');
  assert.deepStrictEqual(events.map(e => [e.spell, e.ok]), [
    ['conjure baked goods', true], ['conjure baked goods', false], ['stretch time', true],
  ]);
});

test('wrapper survives tracker error and disables mod', () => {
  const G = fakeGame();
  const tr = new ComboTracker();
  tr.onEvent = () => { throw new Error('boom'); };
  const rec = install(G, () => {}, tr);
  const origErr = console.error; console.error = () => {};
  try {
    const b = G.gainBuff('Frenzy', 77, 7);
    assert.strictEqual(b.name, 'Frenzy');
    assert.strictEqual(rec.disabled(), true);
    assert.strictEqual(G.shimmerTypes.golden.popFunc({}), 'popped');
  } finally { console.error = origErr; }
});

test('aborted spell (win returns -1) is not recorded', () => {
  const G = fakeGame();
  const tr = new ComboTracker();
  const rec = install(G, () => {}, tr);
  const M = grimoire();
  M.spells['stretch time'].win = () => -1;
  G.Objects['Wizard tower'].minigame = M;
  rec.tick();
  const events = [];
  tr.onEvent = e => events.push(e);
  assert.strictEqual(M.spells['stretch time'].win(), -1);
  assert.strictEqual(events.length, 0);
});

test('spells are re-wrapped after the grimoire rebuilds them', () => {
  const G = fakeGame();
  const tr = new ComboTracker();
  const rec = install(G, () => {}, tr);
  const M = grimoire();
  G.Objects['Wizard tower'].minigame = M;
  rec.tick();
  M.spells = grimoire().spells; // hard reset rebuilds spells
  rec.tick();
  rec.tick();
  const events = [];
  tr.onEvent = e => events.push(e);
  M.spells['conjure baked goods'].win();
  assert.strictEqual(events.length, 1);
});

test('snapshot keeps buff duration and a zero multCpS', () => {
  const G = fakeGame();
  const writes = [];
  const rec = install(G, (n, c) => writes.push(c), new ComboTracker());
  G.buffs['Cursed finger'] = { name: 'Cursed finger', time: 300, maxTime: 300, multCpS: 0 };
  rec.tick();
  const b = JSON.parse(writes[0]).current.ticks[0].buffs[0];
  assert.deepStrictEqual(b, { name: 'Cursed finger', timeLeft: 10, duration: 10, multCpS: 0, multClick: 1 });
});

test('game registration: init never throws and save/load round-trip history', () => {
  const hooks = {};
  let mod;
  global.Game = {
    fps: 30, T: 0, buffs: {}, cookies: 0, cookiesEarned: 0, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 0,
    gainBuff() {}, shimmerTypes: { golden: { popFunc() {} } }, Objects: {},
    registerMod(id, m) { mod = m; },
    registerHook() { throw new Error('hook boom'); },
  };
  const origErr = console.error; console.error = () => {};
  try {
    delete require.cache[require.resolve('../mod/main.js')];
    require('../mod/main.js');
    assert.doesNotThrow(() => mod.init());
    assert.strictEqual(typeof mod.save(), 'string');
    assert.doesNotThrow(() => mod.load('[{"summary":{"start":1},"events":[]}]'));
    assert.match(mod.save(), /"start":1/);
  } finally {
    console.error = origErr;
    delete global.Game;
    delete require.cache[require.resolve('../mod/main.js')];
  }
});

test('a mod error is written to an error file instead of failing silently', () => {
  const G = fakeGame();
  const tr = new ComboTracker();
  tr.onTick = () => { throw new Error('tick boom'); };
  const writes = [];
  const rec = install(G, (n, c) => writes.push([n, c]), tr);
  const origErr = console.error; console.error = () => {};
  try { rec.tick(); } finally { console.error = origErr; }
  const err = writes.find(w => w[0] === 'coachclaudeerror');
  assert.ok(err, 'error file written');
  assert.match(err[1], /tick boom/);
});
