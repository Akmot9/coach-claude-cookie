const test = require('node:test');
const assert = require('node:assert');
const { ComboTracker } = require('../mod/main.js');

function snap(t, over) {
  return Object.assign({
    t, cookies: 1000, cookiesEarned: 1000 + t * 10, handmade: 0, clicks: 0,
    cps: 10, buffs: [], magic: 10, magicMax: 20,
  }, over || {});
}
const FRENZY = { name: 'Frenzy', timeLeft: 77, multCpS: 7, multClick: 1 };
const CF = { name: 'Click frenzy', timeLeft: 13, multCpS: 1, multClick: 777 };
const CLOT = { name: 'Clot', timeLeft: 60, multCpS: 0.5, multClick: 1 };

test('no combo without boosting buff', () => {
  const c = new ComboTracker();
  c.onTick(snap(0));
  c.onTick(snap(1, { buffs: [CLOT] }));
  assert.strictEqual(c.state().current, null);
  assert.strictEqual(c.state().history.length, 0);
});

test('combo starts, ends after 5 s grace, summary is correct', () => {
  const c = new ComboTracker();
  c.onTick(snap(0));
  c.onTick(snap(1, { buffs: [FRENZY], cookiesEarned: 2000 }));
  assert.ok(c.state().current);
  c.onTick(snap(2, { buffs: [FRENZY, CF], cookiesEarned: 5000, handmade: 2500, clicks: 20 }));
  c.onTick(snap(3, { buffs: [], cookiesEarned: 6000, handmade: 2500, clicks: 20 }));
  for (let t = 4; t <= 7; t++) c.onTick(snap(t, { cookiesEarned: 6000, handmade: 2500, clicks: 20 }));
  assert.ok(c.state().current, 'still in grace at t=7 (4 s since last boost)');
  c.onTick(snap(8, { cookiesEarned: 6100, handmade: 2500, clicks: 20 }));
  const st = c.state();
  assert.strictEqual(st.current, null);
  assert.strictEqual(st.history.length, 1);
  const s = st.history[0].summary;
  assert.strictEqual(s.start, 1);
  assert.strictEqual(s.end, 8);
  assert.strictEqual(s.duration, 7);
  assert.strictEqual(s.earned, 6100 - 1000); // baseline = tick before start
  assert.strictEqual(s.handmade, 2500);
  assert.strictEqual(s.clicks, 20);
  assert.strictEqual(s.bestCpsMult, 7);
  assert.strictEqual(s.bestClickMult, 777);
  assert.strictEqual(s.magicStart, 10);
  assert.strictEqual(s.magicMax, 20);
});

test('grace period bridges back-to-back boosts', () => {
  const c = new ComboTracker();
  c.onTick(snap(0, { buffs: [FRENZY] }));
  c.onTick(snap(1));
  c.onTick(snap(4, { buffs: [CF] }));
  c.onTick(snap(5));
  c.onTick(snap(9)); // exactly 5 s after last boost: still in grace
  assert.strictEqual(c.state().history.length, 0);
  c.onTick(snap(10));
  assert.strictEqual(c.state().history.length, 1);
  assert.strictEqual(c.state().history[0].summary.start, 0);
});

test('events during combo and from the 2 s before start are attached', () => {
  const c = new ComboTracker();
  c.onTick(snap(0));
  c.onEvent({ type: 'golden', t: 0.2, wrath: false, earned: 0, buffs: ['Old'] }); // too old
  c.onEvent({ type: 'golden', t: 0.5, wrath: false, earned: 0, buffs: [] });
  c.onEvent({ type: 'golden', t: 1.5, wrath: false, earned: 0, buffs: ['Frenzy'] });
  c.onEvent({ type: 'buff', t: 1.5, name: 'Frenzy', duration: 77, multCpS: 7, multClick: 1 });
  c.onTick(snap(2.4, { buffs: [FRENZY] }));
  c.onEvent({ type: 'spell', t: 3, spell: 'hand of fate', ok: true });
  c.onEvent({ type: 'spell', t: 3.5, spell: 'conjure baked goods', ok: false });
  c.onTick(snap(3, { buffs: [FRENZY] }));
  c.onTick(snap(9));
  const h = c.state().history[0];
  assert.strictEqual(h.summary.golden, 2);
  assert.deepStrictEqual(h.summary.spells, [
    { spell: 'hand of fate', ok: true },
    { spell: 'conjure baked goods', ok: false },
  ]);
  assert.deepStrictEqual(h.summary.buffs, [{ name: 'Frenzy', duration: 77, multCpS: 7, multClick: 1 }]);
  assert.strictEqual(h.events.length, 5);
});

test('history capped at 50, ticks kept only on last 5', () => {
  const c = new ComboTracker();
  let t = 0;
  for (let i = 0; i < 55; i++) {
    c.onTick(snap(t++, { buffs: [FRENZY] }));
    t += 6;
    c.onTick(snap(t++));
  }
  const h = c.state().history;
  assert.strictEqual(h.length, 50);
  assert.strictEqual(h.filter(x => x.ticks).length, 5);
  assert.ok(h[49].ticks && !h[44].ticks);
});

test('changed flag set on tick in combo and on events', () => {
  const c = new ComboTracker();
  c.onTick(snap(0));
  assert.strictEqual(c.changed, false);
  c.onTick(snap(1, { buffs: [FRENZY] }));
  assert.strictEqual(c.changed, true);
  c.changed = false;
  c.onEvent({ type: 'spell', t: 1.2, spell: 'stretch time', ok: true });
  assert.strictEqual(c.changed, true);
});

test('long economic buffs (loan, sugar frenzy) do not start a combo', () => {
  const c = new ComboTracker();
  c.onTick(snap(0, { buffs: [{ name: 'Loan 1', timeLeft: 7000, duration: 7200, multCpS: 1.5, multClick: 1 }] }));
  c.onTick(snap(1, { buffs: [{ name: 'Sugar frenzy', timeLeft: 3500, duration: 3600, multCpS: 3, multClick: 1 }] }));
  assert.strictEqual(c.state().current, null);
});

test('combo ticks are capped', () => {
  const c = new ComboTracker({ maxTicks: 10 });
  for (let t = 0; t < 30; t++) c.onTick(snap(t, { buffs: [FRENZY] }));
  assert.strictEqual(c.state().current.ticks.length, 10);
  assert.strictEqual(c.state().current.ticks[9].t, 29);
});

test('cursed finger counts as a boost and keeps multCpS 0', () => {
  const c = new ComboTracker();
  c.onTick(snap(0));
  c.onTick(snap(1, { buffs: [{ name: 'Cursed finger', timeLeft: 10, duration: 10, multCpS: 0, multClick: 1 }] }));
  assert.ok(c.state().current);
  assert.strictEqual(c.state().current.ticks[0].buffs[0].multCpS, 0);
});

test('a spell cast up to 15 s before the combo is attached', () => {
  const c = new ComboTracker();
  c.onTick(snap(0));
  c.onEvent({ type: 'spell', t: 2, spell: 'hand of fate', ok: true });
  c.onEvent({ type: 'golden', t: 5, wrath: false, earned: 0, buffs: [] }); // too old for non-spell
  for (let t = 1; t < 12; t++) c.onTick(snap(t));
  c.onTick(snap(12, { buffs: [FRENZY] }));
  const ev = c.state().current.events;
  assert.deepStrictEqual(ev.map(e => e.type), ['spell']);
});

test('history exports without ticks and imports back', () => {
  const a = new ComboTracker();
  a.onTick(snap(0, { buffs: [FRENZY] }));
  a.onTick(snap(7));
  const dump = a.exportHistory();
  assert.ok(!JSON.parse(dump)[0].ticks);
  const b = new ComboTracker();
  b.importHistory(dump);
  assert.strictEqual(b.changed, true, 'loaded history is written on next tick');
  assert.strictEqual(b.state().history.length, 1);
  assert.strictEqual(b.state().history[0].summary.start, 0);
  b.importHistory('garbage{');
  assert.strictEqual(b.state().history.length, 1);
});
