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
