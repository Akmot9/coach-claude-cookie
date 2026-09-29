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
})();
