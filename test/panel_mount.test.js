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
  assert.match(el.style.cssText, /left:\s*70px/, 'leaves room for dragon/santa buttons');
  assert.match(el.style.cssText, /right:\s*70px/, 'leaves room for cursor product buttons');
  assert.match(el.style.cssText, /z-index:\s*9\b/, 'below product buttons (z-index 10)');
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
  assert.match(el.innerHTML, /doré : Frénésie/);
  G.cookieClicks = 0; rec.tick();
  G.cookieClicks = 12; rec.tick();
  assert.match(el.innerHTML, /×12 clics/);
});

test('a panel error does not stop combo recording', () => {
  const G = {
    fps: 30, cookies: 0, cookiesEarned: 0, handmadeCookies: 0, cookieClicks: 0, cookiesPs: 0, buffs: {},
    gainBuff(n) { const b = { name: n, time: 30, maxTime: 30, multCpS: 7 }; this.buffs[n] = b; return b; },
    shimmerTypes: { golden: { popFunc() {} } }, Objects: {},
  };
  const badDoc = { getElementById() { throw new Error('dom boom'); } };
  const tr = new ComboTracker();
  const seen = [];
  const orig = tr.onEvent.bind(tr);
  tr.onEvent = e => { seen.push(e.type); orig(e); };
  const writes = [];
  const origErr = console.error; console.error = () => {};
  let rec;
  try {
    rec = install(G, (n, c) => writes.push(n), tr, null, { log: new ActionLog(), doc: badDoc });
    G.gainBuff('Frenzy');
    rec.tick();
    G.gainBuff('Click frenzy');
  } finally { console.error = origErr; }
  assert.strictEqual(rec.disabled(), false);
  assert.deepStrictEqual(seen, ['buff', 'buff']);
  assert.ok(writes.includes('coachclaudeerror'));
  assert.ok(writes.includes('coachclaudecookie'));
});
