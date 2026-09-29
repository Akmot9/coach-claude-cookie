const test = require('node:test');
const assert = require('node:assert');
const { ActionLog, ComboTracker, install } = require('../mod/main.js');

test('events become actions', () => {
  const a = new ActionLog();
  a.onEvent({ type: 'golden', t: 1, wrath: false, earned: 5, buffs: ['Frenzy'] });
  a.onEvent({ type: 'buff', t: 2, name: 'Clot', duration: 66, multCpS: 0.5, multClick: 1, fromGolden: false });
  a.onEvent({ type: 'spell', t: 3, spell: 'stretch time', ok: false });
  assert.deepStrictEqual(a.actions(), [
    { kind: 'golden', t: 1, wrath: false, earned: 5, buffs: ['Frenzy'], durations: {} },
    { kind: 'buff', t: 2, name: 'Clot', duration: 66 },
    { kind: 'spell', t: 3, spell: 'stretch time', ok: false },
  ]);
});

test('buff gained inside a golden click is not duplicated', () => {
  const a = new ActionLog();
  a.onEvent({ type: 'buff', t: 1, name: 'Frenzy', duration: 77, multCpS: 7, multClick: 1, fromGolden: true });
  a.onEvent({ type: 'golden', t: 1, wrath: false, earned: 0, buffs: ['Frenzy'] });
  assert.deepStrictEqual(a.actions().map(x => x.kind), ['golden']);
});

test('clicks are grouped into bursts across consecutive ticks', () => {
  const a = new ActionLog();
  a.onTick({ t: 0, clicks: 10 });
  a.onTick({ t: 1, clicks: 15 });
  a.onTick({ t: 2, clicks: 22 });
  a.onTick({ t: 3, clicks: 22 });
  a.onTick({ t: 5, clicks: 25 });
  assert.deepStrictEqual(a.actions(), [
    { kind: 'clicks', t: 1, tEnd: 2, count: 12 },
    { kind: 'clicks', t: 5, tEnd: 5, count: 3 },
  ]);
});

test('an action between ticks starts a new burst', () => {
  const a = new ActionLog();
  a.onTick({ t: 0, clicks: 0 });
  a.onTick({ t: 1, clicks: 4 });
  a.onEvent({ type: 'spell', t: 1.5, spell: 'stretch time', ok: true });
  a.onTick({ t: 2, clicks: 9 });
  assert.deepStrictEqual(a.actions().map(x => x.kind), ['clicks', 'spell', 'clicks']);
});

test('clicks going down (ascension) resets without a negative burst', () => {
  const a = new ActionLog();
  a.onTick({ t: 0, clicks: 100 });
  a.onTick({ t: 1, clicks: 0 });
  a.onTick({ t: 2, clicks: 2 });
  assert.deepStrictEqual(a.actions(), [{ kind: 'clicks', t: 2, tEnd: 2, count: 2 }]);
});

test('keeps at most max actions', () => {
  const a = new ActionLog({ max: 3 });
  for (let i = 0; i < 5; i++) a.onEvent({ type: 'spell', t: i, spell: 'x', ok: true });
  assert.deepStrictEqual(a.actions().map(x => x.t), [2, 3, 4]);
});

test('recorder marks buffs gained during a golden click', () => {
  const G = {
    fps: 30, cookies: 0, cookiesEarned: 0, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 0, buffs: {},
    gainBuff(n) { const b = { name: n, time: 30, maxTime: 30 }; this.buffs[n] = b; return b; },
    shimmerTypes: { golden: { popFunc() { G.gainBuff('Frenzy'); } } },
    Objects: {},
  };
  const tr = new ComboTracker();
  const events = [];
  tr.onEvent = e => events.push(e);
  install(G, () => {}, tr);
  G.gainBuff('Clot');
  G.shimmerTypes.golden.popFunc({});
  const buffs = events.filter(e => e.type === 'buff');
  assert.deepStrictEqual(buffs.map(b => [b.name, b.fromGolden]), [['Clot', false], ['Frenzy', true]]);
});

test('golden action carries the durations of buffs it gave', () => {
  const a = new ActionLog();
  a.onEvent({ type: 'buff', t: 1, name: 'Frenzy', duration: 154, multCpS: 7, multClick: 1, fromGolden: true });
  a.onEvent({ type: 'golden', t: 1, wrath: false, earned: 0, buffs: ['Frenzy'] });
  a.onEvent({ type: 'golden', t: 9, wrath: false, earned: 3, buffs: [] });
  assert.deepStrictEqual(a.actions().map(x => x.durations), [{ Frenzy: 154 }, {}]);
});
