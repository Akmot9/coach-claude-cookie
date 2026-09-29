# Combo Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-game panel, shown at the bottom left over the milk, that lists the player's actions and highlights adjacent actions that form a known combo.

**Architecture:** Four additions to `mod/main.js`:
- `ActionLog`: pure logic that turns events and ticks into actions.
- `detectCombos`: pure rule matching.
- `renderPanel`: pure HTML string builder.
- `mountPanel` plus the wiring in `install()`: the only part that touches the DOM.

The recorder adds `fromGolden: true` to buff events gained during a golden-cookie click.

**Tech Stack:** ES5-style JS (matches existing mod), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-29-combo-panel-design.md`

## Global Constraints

- The panel is `div#coachComboPanel` inside `#sectionLeft`. Its style is `position:absolute; bottom:0; left:0; right:0; z-index:10; pointer-events:none`, with background `rgba(0,0,0,0.55)` and 11 px text.
- It shows at most 12 actions, drops actions older than 300 s, and the newest is at the bottom. At most 50 actions are kept in memory.
- Combo names, exactly: `DOUBLE BONUS`, `PROLONGATION`, `MAIN DU DESTIN`, `INVOCATION BOOSTÉE`. Their windows are 77 s, 13 s, 30 s and 77 s.
- Click bursts are ignored when deciding whether two actions are adjacent. A failed spell breaks adjacency.
- All displayed text goes through `esc()`. User-facing strings are French and grouped in one table.
- Existing behaviour and files (`coachclaudecookie.txt`, `coachclaudelive.txt`, error file) do not change.
- Test command: `node --test test/*.test.js`.

## Review Focus

1. **The buff event arrives before its golden event.** The panel must show one golden line, not a golden line plus a duplicate buff line. Test: Task 1 `buff gained inside a golden click is not duplicated`.
2. **Clicks happen between two combo steps.** The combo must still match, and the clicks must be highlighted with it. Test: Task 2 `clicks between steps do not break adjacency`.
3. **The panel must never block clicks on the big cookie.** It needs `pointer-events:none`. Test: Task 4 `mounts once in sectionLeft with pointer-events none`.
4. **A buff or spell name contains HTML.** It must be escaped. Test: Task 3 `escapes html`.
5. **There is no `document` (Node) or no `#sectionLeft` yet.** Mounting is a no-op and does not throw. Test: Task 4 `no document or no sectionLeft is a no-op`.

---

### Task 1: ActionLog and fromGolden flag

**Files:**
- Modify: `mod/main.js`: add `ActionLog` after `LiveFeed`, and add `fromGolden` to the buff event in `install`.
- Test: `test/action_log.test.js`

**Interfaces:**
- Produces:
  - `new ActionLog({max=50})`, with `.onEvent(evt)`, `.onTick(snapshot)` and `.actions()`, which returns an array.
  - Action shapes:
    - `{kind:'golden', t, wrath, earned, buffs:[names]}`
    - `{kind:'buff', t, name, duration}`
    - `{kind:'spell', t, spell, ok}`
    - `{kind:'clicks', t, tEnd, count}`
  - The buff event from `install` gains a `fromGolden` boolean.
  - Export `ActionLog`.

- [ ] **Step 1: Write the failing tests**

`test/action_log.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { ActionLog, ComboTracker, install } = require('../mod/main.js');

test('events become actions', () => {
  const a = new ActionLog();
  a.onEvent({ type: 'golden', t: 1, wrath: false, earned: 5, buffs: ['Frenzy'] });
  a.onEvent({ type: 'buff', t: 2, name: 'Clot', duration: 66, multCpS: 0.5, multClick: 1, fromGolden: false });
  a.onEvent({ type: 'spell', t: 3, spell: 'stretch time', ok: false });
  assert.deepStrictEqual(a.actions(), [
    { kind: 'golden', t: 1, wrath: false, earned: 5, buffs: ['Frenzy'] },
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
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: the new tests fail (`ActionLog is not a constructor`, and `fromGolden` is undefined); all other tests pass.

- [ ] **Step 3: Implement**

In `mod/main.js`, insert after `LiveFeed.prototype.state = ...};`:
```js
  // ActionLog: player actions for the in-game panel (pure logic, no Game access)
  var BURST_GAP = 1.5; // seconds: ticks closer than this extend the same click burst

  function ActionLog(opts) {
    opts = opts || {};
    this.max = opts.max || 50;
    this.list = [];
    this.prevClicks = null;
  }

  ActionLog.prototype._push = function (a) {
    this.list.push(a);
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
  };

  ActionLog.prototype.onEvent = function (e) {
    if (e.type === 'golden') this._push({ kind: 'golden', t: e.t, wrath: e.wrath, earned: e.earned, buffs: e.buffs.slice() });
    else if (e.type === 'buff' && !e.fromGolden) this._push({ kind: 'buff', t: e.t, name: e.name, duration: e.duration });
    else if (e.type === 'spell') this._push({ kind: 'spell', t: e.t, spell: e.spell, ok: e.ok });
  };

  ActionLog.prototype.onTick = function (s) {
    var prev = this.prevClicks;
    this.prevClicks = s.clicks;
    if (prev === null || s.clicks <= prev) return;
    var d = s.clicks - prev, last = this.list[this.list.length - 1];
    if (last && last.kind === 'clicks' && s.t - last.tEnd <= BURST_GAP) {
      last.count += d;
      last.tEnd = s.t;
    } else {
      this._push({ kind: 'clicks', t: s.t, tEnd: s.t, count: d });
    }
  };

  ActionLog.prototype.actions = function () { return this.list; };
```
In `install`, change the buff event:
```js
        emit({
          type: 'buff', t: now(), name: buff.name, duration: buff.maxTime / game.fps,
          multCpS: num(buff.multCpS, 1), multClick: num(buff.multClick, 1), fromGolden: !!goldenBuffs,
        });
```
This means `if (goldenBuffs) goldenBuffs.push(buff.name);` stays as it is, and `fromGolden` is added to the object literal. Change the export to `module.exports = { ComboTracker: ComboTracker, LiveFeed: LiveFeed, ActionLog: ActionLog, install: install };`.

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js`
Expected: all tests pass (24 existing + 7 new = 31).

- [ ] **Step 5: Commit**

```bash
git add mod/main.js test/action_log.test.js
git commit -m "feat: ActionLog for the combo panel; flag buffs from golden clicks"
```

---

### Task 2: detectCombos

**Files:**
- Modify: `mod/main.js`: add `COMBO_RULES` and `detectCombos` after `ActionLog`.
- Test: `test/detect_combos.test.js`

**Interfaces:**
- Consumes: the action shapes from Task 1.
- Produces: `detectCombos(actions)`, which returns `[{name, indices:[int]}]`, sorted by the first index. Export `detectCombos`.

- [ ] **Step 1: Write the failing tests**

`test/detect_combos.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { detectCombos } = require('../mod/main.js');

const g = (t, buffs) => ({ kind: 'golden', t, wrath: false, earned: 0, buffs });
const sp = (t, spell, ok = true) => ({ kind: 'spell', t, spell, ok });
const cl = (t, count = 5) => ({ kind: 'clicks', t, tEnd: t, count });

test('double bonus', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), g(30, ['Click frenzy'])]),
    [{ name: 'DOUBLE BONUS', indices: [0, 1] }]);
});

test('double bonus too late is not a combo', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), g(78, ['Click frenzy'])]), []);
});

test('clicks between steps do not break adjacency and are highlighted', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), cl(1), cl(5), g(10, ['Click frenzy'])]),
    [{ name: 'DOUBLE BONUS', indices: [0, 1, 2, 3] }]);
});

test('a failed spell between steps breaks adjacency', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), sp(2, 'stretch time', false), g(10, ['Click frenzy'])]), []);
});

test('prolongation, overlapping with double bonus', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Frenzy']), g(10, ['Click frenzy']), cl(11), sp(12, 'stretch time')]), [
    { name: 'DOUBLE BONUS', indices: [0, 1] },
    { name: 'PROLONGATION', indices: [1, 2, 3] },
  ]);
});

test('prolongation needs a successful spell within 13 s', () => {
  assert.deepStrictEqual(detectCombos([g(0, ['Click frenzy']), sp(5, 'stretch time', false)]), []);
  assert.deepStrictEqual(detectCombos([g(0, ['Click frenzy']), sp(14, 'stretch time')]), []);
});

test('hand of fate then golden cookie', () => {
  assert.deepStrictEqual(detectCombos([sp(0, 'hand of fate'), g(4, [])]),
    [{ name: 'MAIN DU DESTIN', indices: [0, 1] }]);
});

test('boosted conjure; buff actions count as giving the buff', () => {
  assert.deepStrictEqual(detectCombos([{ kind: 'buff', t: 0, name: 'Frenzy', duration: 77 }, sp(20, 'conjure baked goods')]),
    [{ name: 'INVOCATION BOOSTÉE', indices: [0, 1] }]);
});

test('no actions, no combos', () => {
  assert.deepStrictEqual(detectCombos([]), []);
});
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: the new tests fail with `detectCombos is not a function`.

- [ ] **Step 3: Implement**

Insert after the ActionLog code:
```js
  function gives(name) {
    return function (a) {
      return (a.kind === 'golden' && a.buffs.indexOf(name) !== -1) || (a.kind === 'buff' && a.name === name);
    };
  }
  function spellOk(key) { return function (a) { return a.kind === 'spell' && a.spell === key && a.ok; }; }
  function isGolden(a) { return a.kind === 'golden'; }

  var COMBO_RULES = [
    { name: 'DOUBLE BONUS', first: gives('Frenzy'), second: gives('Click frenzy'), within: 77 },
    { name: 'PROLONGATION', first: gives('Click frenzy'), second: spellOk('stretch time'), within: 13 },
    { name: 'MAIN DU DESTIN', first: spellOk('hand of fate'), second: isGolden, within: 30 },
    { name: 'INVOCATION BOOSTÉE', first: gives('Frenzy'), second: spellOk('conjure baked goods'), within: 77 },
  ];

  // Two actions are adjacent when only click bursts sit between them.
  function detectCombos(actions) {
    var found = [];
    for (var i = 0; i < actions.length; i++) {
      var j = i + 1;
      while (j < actions.length && actions[j].kind === 'clicks') j++;
      if (j >= actions.length) continue;
      for (var r = 0; r < COMBO_RULES.length; r++) {
        var rule = COMBO_RULES[r];
        if (rule.first(actions[i]) && rule.second(actions[j]) && actions[j].t - actions[i].t <= rule.within) {
          var idx = [];
          for (var k = i; k <= j; k++) idx.push(k);
          found.push({ name: rule.name, indices: idx });
        }
      }
    }
    return found;
  }
```
Add `detectCombos: detectCombos` to `module.exports`.

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js`
Expected: all 40 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mod/main.js test/detect_combos.test.js
git commit -m "feat: detect adjacent-action combos"
```

---

### Task 3: renderPanel

**Files:**
- Modify: `mod/main.js`: add `TEXT_FR`, `esc`, `shortNum`, `hhmmss` and `renderPanel` after `detectCombos`.
- Test: `test/render_panel.test.js`

**Interfaces:**
- Consumes: actions (Task 1) and combos (Task 2).
- Produces: `renderPanel(actions, combos, now)` returns an HTML string. Row classes are `ccc-row`, with `ccc-hl` when the row belongs to a combo and `ccc-fail` for a failed spell. The combo label is `<span class="ccc-combo">★ NAME</span>` on the last row of each group. The title is `<div class="ccc-title">COMBOS</div>`. Export `renderPanel`.

- [ ] **Step 1: Write the failing tests**

`test/render_panel.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { renderPanel, detectCombos } = require('../mod/main.js');

const g = (t, buffs, earned = 0) => ({ kind: 'golden', t, wrath: false, earned, buffs });

test('french text, highlight and combo label', () => {
  const acts = [g(1000, ['Frenzy']), { kind: 'clicks', t: 1001, tEnd: 1003, count: 54 }, g(1010, ['Click frenzy'])];
  const html = renderPanel(acts, detectCombos(acts), 1011);
  assert.match(html, /COMBOS/);
  assert.match(html, /doré → Frénésie</);
  assert.match(html, /×54 clics/);
  assert.match(html, /Frénésie de clics/);
  assert.strictEqual((html.match(/ccc-hl/g) || []).length, 3);
  assert.strictEqual((html.match(/★ DOUBLE BONUS/g) || []).length, 1);
  assert.match(html, /\d\d:\d\d:\d\d/);
});

test('golden without buff shows cookies earned; failed spell is red', () => {
  const acts = [g(0, [], 7.7e9), { kind: 'spell', t: 1, spell: 'stretch time', ok: false }];
  const html = renderPanel(acts, [], 2);
  assert.match(html, /\+7,7 G cookies/);
  assert.match(html, /ccc-fail/);
  assert.match(html, /Dilatation temporelle ✘/);
});

test('at most 12 rows, newest last, older than 300 s dropped', () => {
  const acts = [];
  for (let i = 0; i < 20; i++) acts.push({ kind: 'spell', t: 1000 + i, spell: 'conjure baked goods', ok: true });
  acts.unshift({ kind: 'spell', t: 1, spell: 'hand of fate', ok: true });
  const html = renderPanel(acts, [], 1020);
  assert.strictEqual((html.match(/ccc-row/g) || []).length, 12);
  assert.doesNotMatch(html, /Destin/);
});

test('escapes html', () => {
  const html = renderPanel([{ kind: 'buff', t: 0, name: '<img src=x>', duration: 5 }], [], 1);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x&gt;/);
});

test('highlight index survives trimming to 12 rows', () => {
  const acts = [];
  for (let i = 0; i < 15; i++) acts.push({ kind: 'spell', t: i, spell: 'x', ok: true });
  acts.push(g(20, ['Frenzy']), g(30, ['Click frenzy']));
  const html = renderPanel(acts, detectCombos(acts), 31);
  assert.strictEqual((html.match(/ccc-hl/g) || []).length, 2);
});
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: the new tests fail with `renderPanel is not a function`.

- [ ] **Step 3: Implement**

Insert after `detectCombos`:
```js
  var PANEL_ROWS = 12, PANEL_MAX_AGE = 300;
  var TEXT_FR = {
    buffs: {
      'Frenzy': 'Frénésie', 'Click frenzy': 'Frénésie de clics', 'Dragonflight': 'Vol draconique',
      'Elder frenzy': 'Frénésie des anciens', 'Clot': 'Caillot', 'Cursed finger': 'Doigt maudit',
      'Dragon Harvest': 'Récolte draconique',
    },
    spells: {
      'conjure baked goods': 'Invoquer des pâtisseries', 'hand of fate': 'Forcer la main du Destin',
      'stretch time': 'Dilatation temporelle', 'spontaneous edifice': 'Édifice spontané',
      "haggler's charm": 'Charme du marchandeur', 'summon crafty pixies': 'Invoquer des lutins habiles',
      "gambler's fever dream": 'Rêve fébrile du parieur', 'resurrect abomination': 'Résurrection abominable',
      'diminish ineptitude': "Réduire l'inaptitude",
    },
    golden: 'doré', wrath: 'de la colère', clicks: 'clics', cookies: 'cookies', title: 'COMBOS',
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function shortNum(n) {
    var units = [[1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k']];
    for (var i = 0; i < units.length; i++) {
      if (Math.abs(n) >= units[i][0]) return (n / units[i][0]).toFixed(1).replace('.', ',') + ' ' + units[i][1];
    }
    return String(Math.round(n));
  }

  function hhmmss(t) {
    var d = new Date(t * 1000);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(function (x) { return (x < 10 ? '0' : '') + x; }).join(':');
  }

  function actionText(a) {
    var T = TEXT_FR;
    if (a.kind === 'golden') {
      var got = a.buffs.length
        ? a.buffs.map(function (b) { return T.buffs[b] || b; }).join(', ')
        : '+' + shortNum(a.earned) + ' ' + T.cookies;
      return '🍪 ' + (a.wrath ? T.wrath : T.golden) + ' → ' + got;
    }
    if (a.kind === 'buff') return '⚡ ' + (T.buffs[a.name] || a.name) + ' ' + Math.round(a.duration) + ' s';
    if (a.kind === 'spell') return '✨ ' + (T.spells[a.spell] || a.spell) + (a.ok ? ' ✔' : ' ✘');
    return '👆 ×' + a.count + ' ' + T.clicks;
  }

  function renderPanel(actions, combos, now) {
    var hl = {}, label = {};
    combos.forEach(function (c) {
      c.indices.forEach(function (i) { hl[i] = true; });
      var last = c.indices[c.indices.length - 1];
      (label[last] = label[last] || []).push(c.name);
    });
    var rows = [];
    for (var i = Math.max(0, actions.length - PANEL_ROWS); i < actions.length; i++) {
      var a = actions[i];
      if (now - (a.tEnd || a.t) > PANEL_MAX_AGE) continue;
      var cls = 'ccc-row' + (hl[i] ? ' ccc-hl' : '') + (a.kind === 'spell' && !a.ok ? ' ccc-fail' : '');
      var lab = (label[i] || []).map(function (n) { return '<span class="ccc-combo">★ ' + esc(n) + '</span>'; }).join('');
      rows.push('<div class="' + cls + '"><span class="ccc-time">' + hhmmss(a.t) + '</span> ' + esc(actionText(a)) + lab + '</div>');
    }
    return '<div class="ccc-title">' + TEXT_FR.title + '</div>' + rows.join('');
  }
```
Add `renderPanel: renderPanel` to `module.exports`.

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js`
Expected: all 45 tests pass.

- [ ] **Step 5: Commit**

```bash
git add mod/main.js test/render_panel.test.js
git commit -m "feat: render combo panel HTML"
```

---

### Task 4: Mount the panel, wire it into install, publish

**Files:**
- Modify: `mod/main.js`: add `PANEL_CSS` and `mountPanel`; `install` takes a 5th param `ui = {log, doc}`; registration passes `{log: new ActionLog(), doc: document}`.
- Modify: `README.md`, to add a "Combo panel" section.
- Test: `test/panel_mount.test.js`

**Interfaces:**
- Consumes: `ActionLog`, `detectCombos`, `renderPanel`.
- Produces:
  - `mountPanel(doc)` returns the panel element, or `null`.
  - `install(game, send, tracker, live, ui)`. When `ui` is given, each emitted event and each tick feed `ui.log` and refresh the panel.
  - Export `mountPanel`.

- [ ] **Step 1: Write the failing tests**

`test/panel_mount.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const { mountPanel, install, ComboTracker, ActionLog } = require('../mod/main.js');

function fakeDoc(withHost = true) {
  const byId = {};
  const mk = tag => ({ tagName: tag, style: {}, children: [], id: '', innerHTML: '',
    appendChild(c) { this.children.push(c); if (c.id) byId[c.id] = c; return c; } });
  const doc = {
    head: mk('head'),
    createElement: mk,
    getElementById: id => byId[id] || null,
  };
  if (withHost) byId.sectionLeft = mk('div');
  return doc;
}

test('mounts once in sectionLeft with pointer-events none', () => {
  const doc = fakeDoc();
  const el = mountPanel(doc);
  assert.ok(el);
  assert.strictEqual(el.id, 'coachComboPanel');
  assert.strictEqual(doc.getElementById('sectionLeft').children.length, 1);
  assert.match(el.style.cssText, /pointer-events:\s*none/);
  assert.match(el.style.cssText, /bottom:\s*0/);
  assert.strictEqual(mountPanel(doc), el);
  assert.strictEqual(doc.getElementById('sectionLeft').children.length, 1);
  assert.strictEqual(doc.head.children.length, 1, 'style added once');
});

test('no document or no sectionLeft is a no-op', () => {
  assert.strictEqual(mountPanel(undefined), null);
  assert.strictEqual(mountPanel(fakeDoc(false)), null);
});

test('install updates the panel on events and ticks', () => {
  const doc = fakeDoc();
  const G = {
    fps: 30, cookies: 0, cookiesEarned: 0, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 0, buffs: {},
    gainBuff(n) { const b = { name: n, time: 30 * 77, maxTime: 30 * 77, multCpS: 7 }; this.buffs[n] = b; return b; },
    shimmerTypes: { golden: { popFunc() { G.gainBuff('Frenzy'); } } },
    Objects: {},
  };
  const rec = install(G, () => {}, new ComboTracker(), null, { log: new ActionLog(), doc });
  G.shimmerTypes.golden.popFunc({});
  const el = doc.getElementById('coachComboPanel');
  assert.match(el.innerHTML, /doré → Frénésie/);
  G.cookieClicks = 0; rec.tick();
  G.cookieClicks = 12; rec.tick();
  assert.match(el.innerHTML, /×12 clics/);
});
```

- [ ] **Step 2: Run and check they fail**

Run: `node --test test/*.test.js`
Expected: the new tests fail with `mountPanel is not a function`.

- [ ] **Step 3: Implement**

Insert after `renderPanel`:
```js
  var PANEL_ID = 'coachComboPanel';
  var PANEL_CSS =
    '#coachComboPanel .ccc-title{font-weight:bold;opacity:0.7;margin-bottom:2px}' +
    '#coachComboPanel .ccc-row{padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#coachComboPanel .ccc-time{opacity:0.6}' +
    '#coachComboPanel .ccc-hl{background:rgba(255,200,0,0.25);border-left:3px solid gold}' +
    '#coachComboPanel .ccc-fail{color:#ff6b6b}' +
    '#coachComboPanel .ccc-combo{color:gold;font-weight:bold;float:right;margin-left:6px}';

  function mountPanel(doc) {
    if (!doc || !doc.getElementById) return null;
    var host = doc.getElementById('sectionLeft');
    if (!host) return null;
    var el = doc.getElementById(PANEL_ID);
    if (el) return el;
    var style = doc.createElement('style');
    style.innerHTML = PANEL_CSS;
    doc.head.appendChild(style);
    el = doc.createElement('div');
    el.id = PANEL_ID;
    el.style.cssText = 'position:absolute;bottom:0;left:0;right:0;z-index:10;pointer-events:none;' +
      'background:rgba(0,0,0,0.55);color:#eee;font:11px sans-serif;padding:4px 6px;max-height:40%;overflow:hidden;';
    host.appendChild(el);
    return el;
  }
```
In `install`:
- The signature becomes `function install(game, send, tracker, live, ui) {`.
- Replace `emit` with:
```js
    function emit(evt) {
      tracker.onEvent(evt);
      if (live) live.onEvent(evt);
      if (ui) { ui.log.onEvent(evt); refreshPanel(); }
    }
    function refreshPanel() {
      var el = mountPanel(ui.doc);
      if (!el) return;
      var acts = ui.log.actions();
      var html = renderPanel(acts, detectCombos(acts), now());
      if (el.__coachHtml !== html) { el.innerHTML = html; el.__coachHtml = html; }
    }
```
- In `tick()`, after `var snap = snapshot();`, add:
```js
        if (ui) { ui.log.onTick(snap); refreshPanel(); }
```
- In the registration, `var rec = install(Game, send, tracker, new LiveFeed(), { log: new ActionLog(), doc: typeof document !== 'undefined' ? document : null });`.
- Add `mountPanel: mountPanel` to `module.exports`.

README: add after the Live view bullet:
```markdown
- Combo panel: an overlay at the bottom left of the screen, over the milk. It lists your last 12 actions (golden cookies, buffs, spells, click bursts) and highlights adjacent actions that form a known combo: DOUBLE BONUS, PROLONGATION, MAIN DU DESTIN, INVOCATION BOOSTÉE. It never blocks clicks.
```

- [ ] **Step 4: Run and check they pass**

Run: `node --test test/*.test.js && python3 -m unittest discover -s test -p 'test_*.py'`
Expected: all 48 JS tests pass and the Python tests are OK.

- [ ] **Step 5: Commit and publish**

```bash
git add mod/main.js test/panel_mount.test.js README.md
git commit -m "feat: in-game combo panel over the milk"
git checkout main && git merge --ff-only feat/combo-panel && git push
```

- [ ] **Step 6: In-game check (with the player)**

1. The player restarts the game.
2. The panel is visible at the bottom left over the milk, and the big cookie can still be clicked.
3. A real Frenzy followed by a Click frenzy is highlighted `★ DOUBLE BONUS`.
4. `file_outputs/coachclaudeerror.txt` does not exist.
