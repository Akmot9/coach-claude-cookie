/* Coach Claude Cookie — records golden-cookie combos to file_outputs/coachclaudecookie.txt */
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

  var MOD_ID = 'coach claude cookie';
  var OUTPUT_NAME = 'coachclaudecookie';

  function install(game, send, tracker) {
    var disabled = false;
    var goldenBuffs = null; // buff names gained during a golden cookie click

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
          multCpS: num(buff.multCpS, 1), multClick: num(buff.multClick, 1),
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
          if (typeof orig !== 'function' || orig.__coachWrapped) return;
          var wrapped = function () {
            var out = orig.apply(this, arguments);
            // castSpell treats -1 as "not cast" (e.g. Stretch Time with no buff to stretch)
            if (out !== -1) safe(function () { tracker.onEvent({ type: 'spell', t: now(), spell: key, ok: kind === 'win' }); });
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

    function tick() {
      safe(function () {
        wrapGrimoire(); // idempotent; re-wraps spells rebuilt by a hard reset
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
    var tracker = new ComboTracker();
    Game.registerMod(MOD_ID, {
      init: function () {
        try {
          var send = function (name, content) {
            if (typeof window !== 'undefined' && window.api && window.api.send) {
              window.api.send('toMain', { id: 'log to file', list: [[name, content]] });
            }
          };
          var rec = install(Game, send, tracker);
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

  if (typeof module !== 'undefined' && module.exports) module.exports = { ComboTracker: ComboTracker, install: install };
})();
