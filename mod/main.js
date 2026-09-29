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
