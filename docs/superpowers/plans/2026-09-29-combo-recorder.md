# Combo Recorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cookie Clicker (Steam) mod that records every golden-cookie combo in real time to `file_outputs/coachclaudecookie.txt`, plus a Python tool that turns that file into a French coaching report.

**Architecture:**
- `mod/main.js` holds three units:
  - `ComboTracker`: pure logic, testable in Node.
  - `install()`: the recorder that wraps game functions.
  - A writer that calls the game's `log to file` IPC once per second.
- The file's `module.exports` guard lets Node tests import it. The `typeof Game` guard registers the mod only in the game.
- `tools/combo_report.py` reads the JSON the mod writes.

**Tech Stack:** Plain ES5-style JavaScript (matches the game's code and runs in Electron), Node 24 `node:test` for tests, Python 3.12 stdlib (`json`, `argparse`, `unittest`).

**Spec:** `docs/superpowers/specs/2026-09-29-combo-recorder-design.md`

## Global Constraints

- Mod ID is exactly `coach claude cookie` (letters and spaces only). It is the same string in `info.txt` and `Game.registerMod`.
- `info.txt` must contain `"AllowSteamAchievs": 1`.
- Output name passed to `log to file` is exactly `coachclaudecookie`, so the game writes `resources/app/file_outputs/coachclaudecookie.txt`.
- A combo starts when any active buff has `multCpS > 1` or `multClick > 1`. It ends once no such buff has been active for 5 s.
- History keeps the last 50 combos. Only the last 5 keep per-second `ticks`.
- The mod never changes gameplay. Every wrapper calls the original function with the same `this` and arguments, and returns its return value.
- Any mod error is caught, logged with `console.error('[coach claude cookie]', e)`, and disables the mod. The game keeps running.
- Code and identifiers are in English. The report text printed to the user is in French.
- The GitHub repo is public: `Akmot9/coach-claude-cookie`.

## Review Focus

1. **A golden cookie click lands between two ticks.** Its `golden` event happens before the tick that sees the new buff. The event must still be attached to the combo it started. Test: Task 1 `attaches events from the 2 s before start`.
2. **A new boost starts during the 5 s grace period.** That must stay one combo, not two. Test: Task 1 `grace period bridges back-to-back boosts`.
3. **A game function throws or the mod code throws.** The game's original must still run and return, and the mod disables itself. Test: Task 2 `wrapper survives tracker error`.
4. **The Grimoire is not loaded yet when the mod inits.** Spell wrapping must retry until it exists, and wrap exactly once. Test: Task 2 `wraps spells once grimoire appears`.
5. **The output file is missing, empty or mid-write.** The report must print a clear French message, not a traceback. Test: Task 3 `test_missing_and_invalid_file`.

---

## File Structure

```
mod/info.txt                    mod metadata for the game
mod/main.js                     ComboTracker + install() + game registration
test/combo_tracker.test.js      node:test for ComboTracker
test/recorder.test.js           node:test for install() with a fake Game
tools/combo_report.py           French report CLI
test/test_combo_report.py       unittest for the report
test/fixtures/sample_output.json
README.md
```

---

### Task 1: ComboTracker (pure logic)

**Files:**
- Create: `mod/main.js`
- Test: `test/combo_tracker.test.js`

**Interfaces:**
- Produces:
  - `new ComboTracker({endDelay=5, maxHistory=50, maxDetailed=5})`.
  - `.onTick(snapshot)`. Snapshot fields:
    - `{t, cookies, cookiesEarned, handmade, clicks, cps}`: all numbers, with `t` in seconds;
    - `buffs: [{name, timeLeft, multCpS, multClick}]`;
    - `magic` and `magicMax`: numbers, or `null` when there is no Grimoire.
  - `.onEvent(evt)`. `evt` has `type` (`'buff'`, `'golden'` or `'spell'`) and `t`, plus type-specific fields.
  - `.state()` returns `{version: 1, updated, current, history}`.
    - `current`: `null`, or `{start, ticks, events}`.
    - `history`: newest last. Each item is `{summary, events, ticks?}`.
  - `.changed`: a boolean that the caller resets to `false` after writing.
  - `summary` fields:
    - `start`, `end`, `duration`, `earned`, `handmade`, `clicks`;
    - `bestCpsMult`, `bestClickMult`;
    - `buffs: [{name, duration, multCpS, multClick}]`;
    - `golden`: count;
    - `spells: [{spell, ok}]`;
    - `magicStart`, `magicMax`.
  - `module.exports = { ComboTracker, install }`. `install` is added in Task 2; until then, export only `ComboTracker`.

- [ ] **Step 1: Write the failing tests**

`test/combo_tracker.test.js`:
```js
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
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `node --test test/`
Expected: FAIL with `Cannot find module '../mod/main.js'`.

- [ ] **Step 3: Implement ComboTracker**

`mod/main.js`:
```js
/* Coach Claude Cookie — records golden-cookie combos to file_outputs/coachclaudecookie.txt */
(function () {
  'use strict';

  var PRE_START_WINDOW = 2; // seconds of events kept before a combo starts

  function isBoost(b) { return (b.multCpS || 1) > 1 || (b.multClick || 1) > 1; }

  function product(buffs, key) {
    var m = 1;
    for (var i = 0; i < buffs.length; i++) m *= (buffs[i][key] || 1);
    return m;
  }

  function ComboTracker(opts) {
    opts = opts || {};
    this.endDelay = opts.endDelay || 5;
    this.maxHistory = opts.maxHistory || 50;
    this.maxDetailed = opts.maxDetailed || 5;
    this.current = null;
    this.history = [];
    this.recent = [];     // events seen outside a combo, pruned to PRE_START_WINDOW
    this.prevTick = null;
    this.lastBoostT = null;
    this.changed = false;
  }

  ComboTracker.prototype.onEvent = function (evt) {
    if (this.current) {
      this.current.events.push(evt);
      this.changed = true;
    } else {
      this.recent.push(evt);
    }
  };

  ComboTracker.prototype.onTick = function (s) {
    var boosting = s.buffs.some(isBoost);
    if (boosting && !this.current) {
      var from = s.t - PRE_START_WINDOW;
      this.current = {
        start: s.t,
        base: this.prevTick || s,
        ticks: [],
        events: this.recent.filter(function (e) { return e.t >= from; }),
      };
      this.recent = [];
    }
    if (boosting) this.lastBoostT = s.t;
    if (this.current) {
      this.current.ticks.push(s);
      this.changed = true;
      if (!boosting && s.t - this.lastBoostT > this.endDelay) this._finish();
    } else {
      var cutoff = s.t - PRE_START_WINDOW;
      this.recent = this.recent.filter(function (e) { return e.t >= cutoff; });
    }
    this.prevTick = s;
  };

  ComboTracker.prototype._finish = function () {
    var c = this.current;
    this.history.push({ summary: summarize(c), events: c.events, ticks: c.ticks });
    if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
    for (var i = 0; i < this.history.length - this.maxDetailed; i++) delete this.history[i].ticks;
    this.current = null;
    this.changed = true;
  };

  function summarize(c) {
    var a = c.base, z = c.ticks[c.ticks.length - 1];
    var bestCps = 1, bestClick = 1;
    c.ticks.forEach(function (k) {
      bestCps = Math.max(bestCps, product(k.buffs, 'multCpS'));
      bestClick = Math.max(bestClick, product(k.buffs, 'multClick'));
    });
    var buffs = [], spells = [], golden = 0;
    c.events.forEach(function (e) {
      if (e.type === 'buff') buffs.push({ name: e.name, duration: e.duration, multCpS: e.multCpS, multClick: e.multClick });
      else if (e.type === 'spell') spells.push({ spell: e.spell, ok: e.ok });
      else if (e.type === 'golden') golden++;
    });
    return {
      start: c.start, end: z.t, duration: z.t - c.start,
      earned: z.cookiesEarned - a.cookiesEarned,
      handmade: z.handmade - a.handmade,
      clicks: z.clicks - a.clicks,
      bestCpsMult: bestCps, bestClickMult: bestClick,
      buffs: buffs, golden: golden, spells: spells,
      magicStart: c.ticks[0].magic, magicMax: c.ticks[0].magicMax,
    };
  }

  ComboTracker.prototype.state = function () {
    var cur = this.current;
    return {
      version: 1,
      updated: this.prevTick ? this.prevTick.t : null,
      current: cur ? { start: cur.start, ticks: cur.ticks, events: cur.events } : null,
      history: this.history,
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = { ComboTracker: ComboTracker };
})();
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test test/`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mod/main.js test/combo_tracker.test.js
git commit -m "feat: ComboTracker detects combos and summarizes them"
```

---

### Task 2: Recorder, writer and game registration

**Files:**
- Modify: `mod/main.js`: add `snapshot`, `install`, and registration before the export line; change the export.
- Create: `mod/info.txt`
- Test: `test/recorder.test.js`

**Interfaces:**
- Consumes: `ComboTracker` from Task 1.
- Produces:
  - `install(game, send, tracker)` returns `{tick(), disabled()}`.
    - `game` is the `Game` object.
    - `send(name, content)` writes a file.
    - `tick()` is called once per second by the `logic` hook. It snapshots, feeds the tracker, retries the Grimoire wrap, and writes if `tracker.changed`.
  - `module.exports = { ComboTracker, install }`.

- [ ] **Step 1: Write the failing tests**

`test/recorder.test.js`:
```js
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
  assert.deepStrictEqual(k.buffs, [{ name: 'Frenzy', timeLeft: 77, multCpS: 7, multClick: 1 }]);
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
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `node --test test/`
Expected: the recorder tests fail with `install is not a function`, while the Task 1 tests still pass.

- [ ] **Step 3: Implement install and registration**

In `mod/main.js`, replace the final `if (typeof module ...` line with:
```js
  var MOD_ID = 'coach claude cookie';
  var OUTPUT_NAME = 'coachclaudecookie';

  function install(game, send, tracker) {
    var disabled = false;
    var goldenBuffs = null; // buff names gained during a golden cookie click
    var grimoireWrapped = false;

    function safe(fn) {
      if (disabled) return;
      try { fn(); } catch (e) { disabled = true; console.error('[' + MOD_ID + ']', e); }
    }
    function now() { return Date.now() / 1000; }

    var origGainBuff = game.gainBuff;
    game.gainBuff = function () {
      var buff = origGainBuff.apply(this, arguments);
      safe(function () {
        if (goldenBuffs) goldenBuffs.push(buff.name);
        tracker.onEvent({
          type: 'buff', t: now(), name: buff.name, duration: buff.maxTime / game.fps,
          multCpS: buff.multCpS || 1, multClick: buff.multClick || 1,
        });
      });
      return buff;
    };

    var golden = game.shimmerTypes.golden;
    var origPop = golden.popFunc;
    golden.popFunc = function (me) {
      var before = game.cookiesEarned;
      goldenBuffs = [];
      var out;
      try { out = origPop.apply(this, arguments); }
      finally {
        var gained = goldenBuffs;
        goldenBuffs = null;
        safe(function () {
          tracker.onEvent({
            type: 'golden', t: now(), wrath: !!(me && me.wrath),
            earned: game.cookiesEarned - before, buffs: gained,
          });
        });
      }
      return out;
    };

    function wrapGrimoire() {
      var tower = game.Objects['Wizard tower'];
      var M = tower && tower.minigame;
      if (!M || !M.spells) return;
      Object.keys(M.spells).forEach(function (key) {
        var spell = M.spells[key];
        ['win', 'fail'].forEach(function (kind) {
          var orig = spell[kind];
          if (typeof orig !== 'function') return;
          spell[kind] = function () {
            var out = orig.apply(this, arguments);
            safe(function () { tracker.onEvent({ type: 'spell', t: now(), spell: key, ok: kind === 'win' }); });
            return out;
          };
        });
      });
      grimoireWrapped = true;
    }

    function snapshot() {
      var M = game.Objects['Wizard tower'] && game.Objects['Wizard tower'].minigame;
      var buffs = Object.keys(game.buffs).map(function (k) {
        var b = game.buffs[k];
        return { name: b.name, timeLeft: b.time / game.fps, multCpS: b.multCpS || 1, multClick: b.multClick || 1 };
      });
      return {
        t: now(), cookies: game.cookies, cookiesEarned: game.cookiesEarned,
        handmade: game.handmadeCookies, clicks: game.cookieClicks, cps: game.cookiesPs,
        buffs: buffs, magic: M ? M.magic : null, magicMax: M ? M.magicM : null,
      };
    }

    function tick() {
      safe(function () {
        if (!grimoireWrapped) wrapGrimoire();
        tracker.onTick(snapshot());
        if (tracker.changed) {
          tracker.changed = false;
          send(OUTPUT_NAME, JSON.stringify(tracker.state()));
        }
      });
    }

    return { tick: tick, disabled: function () { return disabled; } };
  }

  if (typeof Game !== 'undefined' && Game.registerMod) {
    Game.registerMod(MOD_ID, {
      init: function () {
        var send = function (name, content) {
          if (typeof window !== 'undefined' && window.api && window.api.send) {
            window.api.send('toMain', { id: 'log to file', list: [[name, content]] });
          }
        };
        var rec = install(Game, send, new ComboTracker());
        Game.registerHook('logic', function () { if (Game.T % Game.fps === 0) rec.tick(); });
      },
      save: function () { return ''; },
      load: function () {},
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { ComboTracker: ComboTracker, install: install };
```

Create `mod/info.txt`:
```json
{
	"Name": "Coach Claude Cookie",
	"ID": "coach claude cookie",
	"Author": "Akmot9",
	"Description": "Records golden cookie combos in real time to file_outputs/coachclaudecookie.txt for coaching.",
	"ModVersion": 1,
	"GameVersion": 2.053,
	"Date": "29/09/2026",
	"Dependencies": [],
	"AllowSteamAchievs": 1
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `node --test test/`
Expected: all 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mod/ test/recorder.test.js
git commit -m "feat: recorder wraps game functions and writes combo file"
```

---

### Task 3: French combo report

**Files:**
- Create: `tools/combo_report.py`
- Create: `test/fixtures/sample_output.json`
- Test: `test/test_combo_report.py`

**Interfaces:**
- Consumes: the JSON produced by `ComboTracker.state()` (Task 1).
- Produces:
  - CLI `python3 tools/combo_report.py [--file PATH] [--all]`. The default path is `~/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/file_outputs/coachclaudecookie.txt`.
  - Functions `load(path) -> dict | str` (returns a French error string on failure), `report_combo(item) -> str`, `advice(item) -> list[str]`, `table(history) -> str`, `fmt(n) -> str`.

- [ ] **Step 1: Write the fixture and failing tests**

`test/fixtures/sample_output.json`:
```json
{"version":1,"updated":1100,"current":null,"history":[
 {"summary":{"start":1000,"end":1030,"duration":30,"earned":7700000000,"handmade":6900000000,"clicks":65,
  "bestCpsMult":7,"bestClickMult":5439,"buffs":[{"name":"Frenzy","duration":77,"multCpS":7,"multClick":1},{"name":"Click frenzy","duration":13,"multCpS":1,"multClick":777}],
  "golden":2,"spells":[{"spell":"conjure baked goods","ok":true}],"magicStart":19,"magicMax":19},
  "events":[{"type":"golden","t":999.5,"wrath":false,"earned":0,"buffs":["Frenzy"]},
   {"type":"buff","t":999.5,"name":"Frenzy","duration":77,"multCpS":7,"multClick":1},
   {"type":"golden","t":1010,"wrath":false,"earned":0,"buffs":["Click frenzy"]},
   {"type":"buff","t":1010,"name":"Click frenzy","duration":13,"multCpS":1,"multClick":777},
   {"type":"spell","t":1012,"spell":"conjure baked goods","ok":true}],
  "ticks":[
   {"t":1010,"cookies":1,"cookiesEarned":1,"handmade":0,"clicks":0,"cps":1,"buffs":[{"name":"Click frenzy","timeLeft":13,"multCpS":1,"multClick":777}],"magic":19,"magicMax":19},
   {"t":1023,"cookies":1,"cookiesEarned":1,"handmade":0,"clicks":65,"cps":1,"buffs":[{"name":"Click frenzy","timeLeft":0.1,"multCpS":1,"multClick":777}],"magic":7,"magicMax":19}]}
]}
```

`test/test_combo_report.py`:
```python
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import combo_report as cr  # noqa: E402

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "sample_output.json")


class ReportTest(unittest.TestCase):
    def setUp(self):
        self.state = cr.load(FIX)
        self.item = self.state["history"][-1]

    def test_fmt(self):
        self.assertEqual(cr.fmt(950), "950")
        self.assertEqual(cr.fmt(7_700_000_000), "7,7 G")
        self.assertEqual(cr.fmt(12_300_000), "12,3 M")

    def test_report_in_french(self):
        out = cr.report_combo(self.item)
        self.assertIn("+7,7 G", out)
        self.assertIn("30 s", out)
        self.assertIn("Frénésie de clics", out)
        self.assertIn("Invoquer des pâtisseries", out)

    def test_advice_stretch_time_and_click_speed(self):
        adv = " ".join(cr.advice(self.item))
        self.assertIn("Dilatation temporelle", adv)  # 19 mana >= 8+0.2*19, not cast
        self.assertIn("5,0 clics/s", adv)            # 65 clicks over 13 s

    def test_table(self):
        self.assertIn("+7,7 G", cr.table(self.state["history"]))

    def test_missing_and_invalid_file(self):
        self.assertIsInstance(cr.load("/nonexistent/x.txt"), str)
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            f.write('{"version":1,"hist')
        try:
            msg = cr.load(f.name)
            self.assertIsInstance(msg, str)
            self.assertIn("illisible", msg)
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `python3 -m unittest discover -s test -p 'test_*.py' -v`
Expected: `ModuleNotFoundError: No module named 'combo_report'`.

- [ ] **Step 3: Implement the report**

`tools/combo_report.py`:
```python
#!/usr/bin/env python3
"""Bilan en français des combos enregistrés par le mod Coach Claude Cookie."""
import argparse
import json
import os

DEFAULT_FILE = os.path.expanduser(
    "~/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/file_outputs/coachclaudecookie.txt"
)
BUFF_FR = {
    "Frenzy": "Frénésie",
    "Click frenzy": "Frénésie de clics",
    "Dragonflight": "Vol draconique",
    "Elder frenzy": "Frénésie des anciens",
    "Clot": "Caillot",
    "Dragon Harvest": "Récolte draconique",
    "Cursed finger": "Doigt maudit",
}
SPELL_FR = {
    "conjure baked goods": "Invoquer des pâtisseries",
    "hand of fate": "Forcer la main du Destin",
    "stretch time": "Dilatation temporelle",
    "spontaneous edifice": "Édifice spontané",
    "haggler's charm": "Charme du marchandeur",
    "summon crafty pixies": "Invoquer des lutins habiles",
    "gambler's fever dream": "Rêve fébrile du parieur",
    "resurrect abomination": "Résurrection abominable",
    "diminish ineptitude": "Réduire l'inaptitude",
}
UNITS = [(1e18, "Qi"), (1e15, "P"), (1e12, "T"), (1e9, "G"), (1e6, "M"), (1e3, "k")]


def fmt(n):
    for size, unit in UNITS:
        if abs(n) >= size:
            return f"{n / size:.1f} {unit}".replace(".", ",")
    return f"{n:.0f}"


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return f"Fichier introuvable : {path}. Le mod est-il activé et le jeu lancé ?"
    except (json.JSONDecodeError, UnicodeDecodeError):
        return f"Fichier illisible (peut-être en cours d'écriture) : {path}. Réessaie dans une seconde."


def buff_name(name):
    return BUFF_FR.get(name, name)


def advice(item):
    s, ticks = item["summary"], item.get("ticks") or []
    out = []
    names = {b["name"] for b in s["buffs"]}
    cast = {sp["spell"] for sp in s["spells"]}
    mmax = s.get("magicMax")
    if "Click frenzy" in names and "stretch time" not in cast and mmax:
        if s["magicStart"] >= 8 + 0.2 * mmax:
            out.append("Tu avais le mana pour Dilatation temporelle : lance-la dès la Frénésie de clics pour la prolonger.")
    cf = [k for k in ticks if any(b["name"] == "Click frenzy" for b in k["buffs"])]
    if len(cf) >= 2 and cf[-1]["t"] > cf[0]["t"]:
        rate = (cf[-1]["clicks"] - cf[0]["clicks"]) / (cf[-1]["t"] - cf[0]["t"])
        out.append(f"Vitesse de clic pendant la Frénésie de clics : {rate:.1f} clics/s".replace(".", ",")
                   + (" — vise 8 clics/s ou plus." if rate < 8 else " — excellent."))
    return out


def report_combo(item):
    s = item["summary"]
    lines = [
        f"Combo : +{fmt(s['earned'])} en {s['duration']:.0f} s "
        f"(dont {fmt(s['handmade'])} à la main, {s['clicks']} clics)",
        f"Multiplicateurs max : production ×{s['bestCpsMult']:g}, clic ×{s['bestClickMult']:g}",
        f"Cookies dorés cliqués : {s['golden']}",
    ]
    t0 = s["start"]
    lines.append("Déroulé :")
    for e in item["events"]:
        dt = f"{e['t'] - t0:+.0f} s".replace(".", ",")
        if e["type"] == "golden":
            got = ", ".join(buff_name(b) for b in e["buffs"]) or f"+{fmt(e['earned'])}"
            lines.append(f"  {dt}  cookie {'de la colère' if e['wrath'] else 'doré'} → {got}")
        elif e["type"] == "buff":
            lines.append(f"  {dt}  bonus {buff_name(e['name'])} ({e['duration']:.0f} s)")
        elif e["type"] == "spell":
            lines.append(f"  {dt}  sort {SPELL_FR.get(e['spell'], e['spell'])} : {'réussi' if e['ok'] else 'RATÉ'}")
    tips = advice(item)
    if tips:
        lines.append("Conseils :")
        lines += [f"  - {t}" for t in tips]
    return "\n".join(lines)


def table(history):
    rows = ["#   durée   gagné      clics  dorés  sorts"]
    for i, item in enumerate(history, 1):
        s = item["summary"]
        rows.append(f"{i:<3} {s['duration']:>4.0f} s  +{fmt(s['earned']):<9} {s['clicks']:>5}  {s['golden']:>5}  {len(s['spells']):>5}")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--file", default=DEFAULT_FILE)
    ap.add_argument("--all", action="store_true", help="tableau de tous les combos gardés")
    a = ap.parse_args()
    st = load(a.file)
    if isinstance(st, str):
        print(st)
        return
    if st.get("current"):
        cur = st["current"]
        print(f"Combo en cours depuis {cur['ticks'][-1]['t'] - cur['start']:.0f} s…\n")
    if not st["history"]:
        print("Aucun combo terminé pour l'instant.")
    elif a.all:
        print(table(st["history"]))
    else:
        print(report_combo(st["history"][-1]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `python3 -m unittest discover -s test -p 'test_*.py' -v`
Expected: 5 tests OK.

- [ ] **Step 5: Commit**

```bash
git add tools/ test/test_combo_report.py test/fixtures/
git commit -m "feat: French combo report tool"
```

---

### Task 4: Install, integrate, publish

**Files:**
- Create: `README.md`
- Modify (outside repo): `~/.local/share/cookie-coach/cc_watch.py`: report finished combos.
- Symlink: `…/resources/app/mods/local/coach claude cookie` → `~/github/coach-claude-cookie/mod`

**Interfaces:**
- Consumes: output file (Task 2), `combo_report.fmt` semantics (Task 3).

- [ ] **Step 1: Write the README**

`README.md`:
````markdown
# Coach Claude Cookie

Cookie Clicker (Steam) mod that records every golden-cookie combo in real time. It is built so an AI coach can review your combos second by second.

## What it records
- A combo starts when a buff multiplies production or clicks. It ends 5 s after the last such buff.
- For each combo it records the golden cookies clicked, the buffs gained, the Grimoire spells (success or backfire), the clicks, and a snapshot every second.
- Output: `resources/app/file_outputs/coachclaudecookie.txt` (JSON). It holds the current combo plus the last 50 combos, and the last 5 keep their per-second snapshots.

The mod only observes: it does not change gameplay and does not block Steam achievements.

## Install (Steam, Linux)
```bash
git clone https://github.com/Akmot9/coach-claude-cookie.git
ln -s "$PWD/coach-claude-cookie/mod" \
  "$HOME/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/mods/local/coach claude cookie"
```
Then in game: Options → Mods → enable **Coach Claude Cookie** → restart.

## Report
```bash
python3 tools/combo_report.py        # last combo, in French
python3 tools/combo_report.py --all  # table of all kept combos
```

## Tests
```bash
node --test test/
python3 -m unittest discover -s test -p 'test_*.py'
```
````

- [ ] **Step 2: Install the symlink and verify**

```bash
ln -s ~/github/coach-claude-cookie/mod "$HOME/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/mods/local/coach claude cookie"
ls -la "$HOME/.local/share/Steam/steamapps/common/Cookie Clicker/resources/app/mods/local/"
```
Expected: the link is listed and points to the repo's `mod/`.

- [ ] **Step 3: Add combo notifications to cc_watch.py**

Add this near the top of `~/.local/share/cookie-coach/cc_watch.py`, after `SAVE = ...`:
```python
COMBO_FILE = APP + "/file_outputs/coachclaudecookie.txt"


def combos():
    try:
        with open(COMBO_FILE, encoding="utf-8") as f:
            return json.load(f).get("history", [])
    except Exception:
        return None
```
Add `import json` to the imports if it is missing. In the polling loop, keep `last_combo_end = None`. On each poll:
```python
h = combos()
if h:
    s = h[-1]["summary"]
    if last_combo_end is not None and s["end"] != last_combo_end:
        print(f"COMBO terminé : +{fmt(s['earned'])} en {s['duration']:.0f} s, "
              f"{s['golden']} dorés, {len(s['spells'])} sorts, {s['clicks']} clics", flush=True)
    last_combo_end = s["end"]
```
Run: `python3 ~/.local/share/cookie-coach/cc_watch.py --once`
Expected: the summary prints with no error.

- [ ] **Step 4: Commit and publish to GitHub**

```bash
cd ~/github/coach-claude-cookie
git add README.md && git commit -m "docs: README"
gh repo create Akmot9/coach-claude-cookie --public --source=. --push \
  --description "Cookie Clicker mod recording golden cookie combos for coaching"
```
Expected: the repo URL is printed and `git log origin/main` matches the local log.

- [ ] **Step 5: Manual in-game test (with the player)**

1. The player restarts the game, then enables **Coach Claude Cookie** in Options → Mods and restarts again.
2. Run `ls -la ".../resources/app/file_outputs/"`. The file appears after the first boost.
3. After a real combo, run `python3 tools/combo_report.py`. Its earned total must match the change in cookies produced shown in the save (`cc_watch.py --once`).
4. Confirm that the Steam achievements still unlock: the mod's info shows that achievements are allowed.

- [ ] **Step 6: Final verification**

Run `node --test test/ && python3 -m unittest discover -s test -p 'test_*.py'`. All tests must pass.
