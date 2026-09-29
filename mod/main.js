/* Coach Claude Cookie — records golden-cookie combos (coachclaudecookie.txt) and a live game view (coachclaudelive.txt) in file_outputs/ */
(function () {
  'use strict';

  var PRE_START_WINDOW = 2;        // seconds of golden/buff events kept before a combo starts
  var SPELL_PRE_START_WINDOW = 15; // a Force the Hand of Fate cast may precede its golden cookie by several seconds
  var MAX_BOOST_DURATION = 300;    // longer buffs (loans, sugar frenzy) are economy, not combos

  function num(x, dflt) { return typeof x === 'number' ? x : dflt; }

  function isBoost(b) {
    if (typeof b.duration === 'number' && b.duration > MAX_BOOST_DURATION) return false;
    return b.name === 'Cursed finger' || num(b.multCpS, 1) > 1 || num(b.multClick, 1) > 1;
  }

  function preStartWindow(e) { return e.type === 'spell' ? SPELL_PRE_START_WINDOW : PRE_START_WINDOW; }

  function product(buffs, key) {
    var m = 1;
    for (var i = 0; i < buffs.length; i++) m *= num(buffs[i][key], 1);
    return m;
  }

  function ComboTracker(opts) {
    opts = opts || {};
    this.endDelay = opts.endDelay || 5;
    this.maxHistory = opts.maxHistory || 50;
    this.maxDetailed = opts.maxDetailed || 5;
    this.maxTicks = opts.maxTicks || 600;
    this.current = null;
    this.history = [];
    this.recent = [];     // events seen outside a combo, pruned by preStartWindow
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
      this.current = {
        start: s.t,
        base: this.prevTick || s,
        ticks: [],
        events: this.recent.filter(function (e) { return e.t >= s.t - preStartWindow(e); }),
      };
      this.recent = [];
    }
    if (boosting) this.lastBoostT = s.t;
    if (this.current) {
      this.current.ticks.push(s);
      if (this.current.ticks.length > this.maxTicks) this.current.ticks.shift();
      this.changed = true;
      if (!boosting && s.t - this.lastBoostT > this.endDelay) this._finish();
    } else {
      this.recent = this.recent.filter(function (e) { return e.t >= s.t - preStartWindow(e); });
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

  ComboTracker.prototype.exportHistory = function () {
    return JSON.stringify(this.history.map(function (h) { return { summary: h.summary, events: h.events }; }));
  };

  ComboTracker.prototype.importHistory = function (str) {
    var h;
    try { h = JSON.parse(str); } catch (e) { return; }
    if (!Array.isArray(h)) return;
    this.history = h.filter(function (x) { return x && x.summary; }).concat(this.history).slice(-this.maxHistory);
    this.changed = true;
  };

  ComboTracker.prototype.state = function () {
    var cur = this.current;
    return {
      version: 1,
      updated: this.prevTick ? this.prevTick.t : null,
      current: cur ? { start: cur.start, ticks: cur.ticks, events: cur.events } : null,
      history: this.history,
    };
  };

  // LiveFeed: always-on view of the game, rewritten every second (pure logic, no Game access)
  function LiveFeed(opts) {
    opts = opts || {};
    this.maxEvents = opts.maxEvents || 30;
    this.warmup = opts.warmup || 0; // ticks to ignore while the save is still loading
    this.ticks = 0;
    this.events = [];
    this.last = null;
  }

  LiveFeed.prototype.onEvent = function (evt) {
    this.events.push(evt);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  };

  LiveFeed.prototype.onTick = function (s) {
    var prev = this.last, self = this;
    this.ticks++;
    if (prev && this.ticks > this.warmup) {
      var names = Object.keys(prev.buildings);
      Object.keys(s.buildings).forEach(function (n) { if (names.indexOf(n) === -1) names.push(n); });
      names.forEach(function (n) {
        var delta = (s.buildings[n] || 0) - (prev.buildings[n] || 0);
        if (delta) self.onEvent({ type: 'building', t: s.t, name: n, delta: delta, amount: s.buildings[n] || 0 });
      });
      s.upgrades.forEach(function (n) {
        if (prev.upgrades.indexOf(n) === -1) self.onEvent({ type: 'upgrade', t: s.t, name: n });
      });
      if (s.lumps !== prev.lumps) self.onEvent({ type: 'lump', t: s.t, delta: s.lumps - prev.lumps, lumps: s.lumps });
    }
    this.last = s;
  };

  LiveFeed.prototype.state = function () {
    var s = this.last || {};
    return {
      version: 1, t: s.t, cookies: s.cookies, cookiesEarned: s.cookiesEarned, cps: s.cps,
      handmade: s.handmade, clicks: s.clicks, buffs: s.buffs, magic: s.magic, magicMax: s.magicMax,
      lumps: s.lumps, buildings: s.buildings, events: this.events,
    };
  };

  // ActionLog: player actions for the in-game panel (pure logic, no Game access)
  var BURST_GAP = 1.5; // seconds: ticks closer than this extend the same click burst

  function ActionLog(opts) {
    opts = opts || {};
    this.max = opts.max || 50;
    this.warmup = opts.warmup || 0; // ticks to ignore while the save is still loading
    this.ticks = 0;
    this.list = [];
    this.prevClicks = null;
    this.pendingDurations = {}; // durations of buffs gained inside the golden click being processed
  }

  ActionLog.prototype._push = function (a) {
    this.list.push(a);
    if (this.list.length > this.max) this.list.splice(0, this.list.length - this.max);
  };

  ActionLog.prototype.onEvent = function (e) {
    if (e.type === 'golden') {
      this._push({ kind: 'golden', t: e.t, wrath: e.wrath, earned: e.earned, buffs: e.buffs.slice(), durations: this.pendingDurations });
      this.pendingDurations = {};
    } else if (e.type === 'buff' && e.fromGolden) this.pendingDurations[e.name] = e.duration;
    else if (e.type === 'buff') this._push({ kind: 'buff', t: e.t, name: e.name, duration: e.duration, icon: e.icon });
    else if (e.type === 'spell') this._push({ kind: 'spell', t: e.t, spell: e.spell, ok: e.ok, icon: e.icon });
  };

  ActionLog.prototype.onTick = function (s) {
    var prev = this.prevClicks;
    this.prevClicks = s.clicks;
    this.ticks++;
    if (prev === null || this.ticks <= this.warmup || s.clicks <= prev) return;
    var d = s.clicks - prev, last = this.list[this.list.length - 1];
    if (last && last.kind === 'clicks' && s.t - last.tEnd <= BURST_GAP) {
      last.count += d;
      last.tEnd = s.t;
    } else {
      this._push({ kind: 'clicks', t: s.t, tEnd: s.t, count: d });
    }
  };

  ActionLog.prototype.actions = function () { return this.list; };

  function gives(name) {
    return function (a) {
      return (a.kind === 'golden' && a.buffs.indexOf(name) !== -1) || (a.kind === 'buff' && a.name === name);
    };
  }
  function spellOk(key) { return function (a) { return a.kind === 'spell' && a.spell === key && a.ok; }; }
  function isGolden(a) { return a.kind === 'golden'; }

  // Seconds the first step's buff lasts: the real duration when known (effect-duration upgrades), else the base one.
  function buffWindow(name, base) {
    return function (a) {
      if (a.kind === 'golden' && a.durations && typeof a.durations[name] === 'number') return a.durations[name];
      if (a.kind === 'buff' && a.name === name && typeof a.duration === 'number') return a.duration;
      return base;
    };
  }
  function fixedWindow(sec) { return function () { return sec; }; }

  var COMBO_RULES = [
    { name: 'DOUBLE BONUS', first: gives('Frenzy'), second: gives('Click frenzy'), window: buffWindow('Frenzy', 77) },
    { name: 'PROLONGATION', first: gives('Click frenzy'), second: spellOk('stretch time'), window: buffWindow('Click frenzy', 13) },
    { name: 'MAIN DU DESTIN', first: spellOk('hand of fate'), second: isGolden, window: fixedWindow(30) },
    { name: 'INVOCATION BOOSTÉE', first: gives('Frenzy'), second: spellOk('conjure baked goods'), window: buffWindow('Frenzy', 77) },
  ];

  // Actions that may sit between two combo steps without breaking them:
  // click bursts, a successful Hand of Fate (it sets up the next golden cookie),
  // and buff lines other than the combo buffs themselves (e.g. Godzamok's Devastation).
  function isLink(a) {
    if (a.kind === 'clicks') return true;
    if (a.kind === 'spell') return a.spell === 'hand of fate' && a.ok;
    if (a.kind === 'buff') return a.name !== 'Frenzy' && a.name !== 'Click frenzy';
    return false;
  }

  function detectCombos(actions) {
    var found = [];
    for (var i = 0; i < actions.length; i++) {
      for (var r = 0; r < COMBO_RULES.length; r++) {
        var rule = COMBO_RULES[r];
        if (!rule.first(actions[i])) continue;
        var limit = rule.window(actions[i]);
        for (var j = i + 1; j < actions.length; j++) {
          if (actions[j].t - actions[i].t > limit) break;
          if (rule.second(actions[j])) {
            var idx = [];
            for (var k = i; k <= j; k++) idx.push(k);
            found.push({ name: rule.name, indices: idx });
            break;
          }
          if (!isLink(actions[j])) break;
        }
      }
    }
    return found;
  }

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
    golden: 'doré', wrath: 'de la colère', clicks: 'clics', cookies: 'cookies', title: 'COMBOS', ok: 'OK', ko: 'RATÉ',
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

  // Icons come from the game's own sprite sheet (48 px cells), shown at 16 px.
  // The game's text rendering cannot display emoji, so the panel uses only these icons and plain text.
  var ICON_GOLDEN = [10, 14], ICON_CLICKS = [0, 0], ICON_SIZE = 16;

  function actionIcon(a) {
    if (a.kind === 'golden') return ICON_GOLDEN;
    if (a.kind === 'clicks') return ICON_CLICKS;
    return a.icon;
  }

  function iconHtml(icon) {
    // icon[2] is a custom sheet from another mod with an unknown layout: skip it
    if (!icon || typeof icon[0] !== 'number' || typeof icon[1] !== 'number' || icon[2]) return '';
    return '<span class="ccc-ico" style="background-position:-' + icon[0] * ICON_SIZE + 'px -' + icon[1] * ICON_SIZE + 'px"></span>';
  }

  function actionText(a) {
    var T = TEXT_FR;
    if (a.kind === 'golden') {
      var got = a.buffs.length
        ? a.buffs.map(function (b) { return T.buffs[b] || b; }).join(', ')
        : '+' + shortNum(a.earned) + ' ' + T.cookies;
      return (a.wrath ? T.wrath : T.golden) + ' : ' + got;
    }
    if (a.kind === 'buff') return (T.buffs[a.name] || a.name) + ' ' + Math.round(a.duration) + ' s';
    if (a.kind === 'spell') return T.spells[a.spell] || a.spell;
    return '×' + a.count + ' ' + T.clicks;
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
      var lab = (label[i] || []).map(function (n) { return '<span class="ccc-combo">[' + esc(n) + ']</span>'; }).join('');
      var status = a.kind !== 'spell' ? '' : a.ok
        ? ' <span class="ccc-ok">' + TEXT_FR.ok + '</span>'
        : ' <span class="ccc-ko">' + TEXT_FR.ko + '</span>';
      rows.push('<div class="' + cls + '">' + iconHtml(actionIcon(a)) + '<span class="ccc-time">' + hhmmss(a.t) + '</span> ' +
        esc(actionText(a)) + status + lab + '</div>');
    }
    return '<div class="ccc-title">' + TEXT_FR.title + '</div>' + rows.join('');
  }

  var PANEL_ID = 'coachComboPanel';
  var PANEL_CSS =
    '#coachComboPanel .ccc-title{font-weight:bold;opacity:0.7;margin-bottom:2px}' +
    '#coachComboPanel .ccc-row{padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '#coachComboPanel .ccc-time{opacity:0.6}' +
    '#coachComboPanel .ccc-hl{background:rgba(255,200,0,0.25);border-left:3px solid gold}' +
    '#coachComboPanel .ccc-fail{color:#ff6b6b}' +
    '#coachComboPanel .ccc-ok{color:#6bff8f;font-weight:bold}' +
    '#coachComboPanel .ccc-ko{color:#ff6b6b;font-weight:bold}' +
    '#coachComboPanel .ccc-ico{display:inline-block;width:16px;height:16px;vertical-align:middle;margin-right:3px;' +
    'background-image:url(img/icons.png);background-repeat:no-repeat;background-size:576px 592px}' +
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
    // left/right margins keep the dragon/Santa buttons (canvas, bottom-left) and the Cursor's
    // product buttons (#sectionLeftExtra, bottom-right, z-index 10) visible
    el.style.cssText = 'position:absolute;bottom:0;left:70px;right:70px;z-index:9;pointer-events:none;' +
      'background:rgba(0,0,0,0.55);color:#eee;font:11px sans-serif;padding:4px 6px;max-height:40%;overflow:hidden;';
    host.appendChild(el);
    return el;
  }

  var MOD_ID = 'coach claude cookie';
  var OUTPUT_NAME = 'coachclaudecookie';
  var LIVE_NAME = 'coachclaudelive';
  var ERROR_NAME = 'coachclaudeerror';

  function install(game, send, tracker, live, ui) {
    var disabled = false;
    var goldenBuffs = null; // buff names gained during a golden cookie click

    function safe(fn) {
      if (disabled) return;
      try { fn(); } catch (e) {
        disabled = true;
        console.error('[' + MOD_ID + ']', e);
        try { send(ERROR_NAME, new Date().toISOString() + ' ' + String(e && e.stack || e)); } catch (e2) { /* nothing left to do */ }
      }
    }
    function now() { return Date.now() / 1000; }
    function emit(evt) {
      tracker.onEvent(evt);
      if (live) live.onEvent(evt);
      if (ui) { ui.log.onEvent(evt); refreshPanel(); }
    }
    var panelDisabled = false;
    // The panel is cosmetic: its errors turn off the panel only, never the recording.
    function refreshPanel() {
      if (panelDisabled) return;
      try {
        var el = mountPanel(ui.doc);
        if (!el) return;
        var acts = ui.log.actions();
        var html = renderPanel(acts, detectCombos(acts), now());
        if (el.__coachHtml !== html) { el.innerHTML = html; el.__coachHtml = html; }
      } catch (e) {
        panelDisabled = true;
        console.error('[' + MOD_ID + '] panel', e);
        try { send(ERROR_NAME, new Date().toISOString() + ' panel: ' + String(e && e.stack || e)); } catch (e2) { /* nothing left to do */ }
      }
    }

    var origGainBuff = game.gainBuff;
    game.gainBuff = function () {
      var buff = origGainBuff.apply(this, arguments);
      safe(function () {
        if (goldenBuffs) goldenBuffs.push(buff.name);
        emit({
          type: 'buff', t: now(), name: buff.name, duration: buff.maxTime / game.fps,
          multCpS: num(buff.multCpS, 1), multClick: num(buff.multClick, 1), fromGolden: !!goldenBuffs, icon: buff.icon,
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
          emit({
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
          if (typeof orig !== 'function' || orig.__coachWrapped) return;
          var wrapped = function () {
            var out = orig.apply(this, arguments);
            // castSpell treats -1 as "not cast" (e.g. Stretch Time with no buff to stretch)
            if (out !== -1) safe(function () { emit({ type: 'spell', t: now(), spell: key, ok: kind === 'win', icon: spell.icon }); });
            return out;
          };
          wrapped.__coachWrapped = true;
          spell[kind] = wrapped;
        });
      });
    }

    function snapshot() {
      var M = game.Objects['Wizard tower'] && game.Objects['Wizard tower'].minigame;
      var buffs = Object.keys(game.buffs).map(function (k) {
        var b = game.buffs[k];
        return {
          name: b.name, timeLeft: b.time / game.fps, duration: b.maxTime / game.fps,
          multCpS: num(b.multCpS, 1), multClick: num(b.multClick, 1),
        };
      });
      return {
        t: now(), cookies: game.cookies, cookiesEarned: game.cookiesEarned,
        handmade: game.handmadeCookies, clicks: game.cookieClicks, cps: game.cookiesPs,
        buffs: buffs, magic: M ? M.magic : null, magicMax: M ? M.magicM : null,
      };
    }

    function liveSnapshot(base) {
      var buildings = {}, upgrades = [];
      // Game.ObjectsById is an array but Game.UpgradesById is an object: iterate keys for both
      var objs = game.ObjectsById || {}, upgs = game.UpgradesById || {};
      Object.keys(objs).forEach(function (k) { buildings[objs[k].name] = objs[k].amount; });
      Object.keys(upgs).forEach(function (k) { if (upgs[k].bought) upgrades.push(upgs[k].name); });
      var out = {};
      Object.keys(base).forEach(function (k) { out[k] = base[k]; });
      out.buildings = buildings;
      out.upgrades = upgrades;
      out.lumps = game.lumps;
      return out;
    }

    function tick() {
      safe(function () {
        wrapGrimoire(); // idempotent; re-wraps spells rebuilt by a hard reset
        var snap = snapshot();
        if (ui) { ui.log.onTick(snap); refreshPanel(); }
        if (live) {
          live.onTick(liveSnapshot(snap));
          send(LIVE_NAME, JSON.stringify(live.state()));
        }
        tracker.onTick(snap);
        if (tracker.changed) {
          tracker.changed = false;
          send(OUTPUT_NAME, JSON.stringify(tracker.state()));
        }
      });
    }

    return { tick: tick, disabled: function () { return disabled; } };
  }

  if (typeof Game !== 'undefined' && Game.registerMod) {
    var tracker = new ComboTracker();
    Game.registerMod(MOD_ID, {
      init: function () {
        try {
          var send = function (name, content) {
            if (typeof window !== 'undefined' && window.api && window.api.send) {
              window.api.send('toMain', { id: 'log to file', list: [[name, content]] });
            }
          };
          // the save loads after the mod starts: ignore the first 3 s of apparent changes
          var rec = install(Game, send, tracker, new LiveFeed({ warmup: 3 }), { log: new ActionLog({ warmup: 3 }), doc: typeof document !== 'undefined' ? document : null });
          Game.registerHook('logic', function () { if (Game.T % Game.fps === 0) rec.tick(); });
        } catch (e) {
          console.error('[' + MOD_ID + ']', e);
        }
      },
      save: function () {
        try { return tracker.exportHistory(); } catch (e) { return ''; }
      },
      load: function (str) {
        try { tracker.importHistory(str); } catch (e) { console.error('[' + MOD_ID + ']', e); }
      },
    });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { ComboTracker: ComboTracker, LiveFeed: LiveFeed, ActionLog: ActionLog, detectCombos: detectCombos, renderPanel: renderPanel, mountPanel: mountPanel, install: install };
})();
