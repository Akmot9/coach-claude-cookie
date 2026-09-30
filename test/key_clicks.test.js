const test = require('node:test');
const assert = require('node:assert');
const { installKeyClicks, renderPanel } = require('../mod/main.js');

function setup() {
  const handlers = {};
  const win = { addEventListener(type, fn) { handlers[type] = fn; } };
  const game = { clicks: 0, ClickCookie(e) { assert.strictEqual(e, undefined); this.clicks++; } };
  installKeyClicks(win, game);
  const press = (key, extra) => {
    let prevented = false;
    handlers.keydown(Object.assign({ key, repeat: false, target: { tagName: 'BODY' }, preventDefault() { prevented = true; } }, extra));
    return prevented;
  };
  return { game, press };
}

test('P and Space each click the big cookie once', () => {
  const { game, press } = setup();
  press('p'); press(' '); press('P');
  assert.strictEqual(game.clicks, 3);
});

test('space does not scroll or press a focused button', () => {
  const { press } = setup();
  assert.strictEqual(press(' '), true);
});

test('holding a key does not auto-repeat clicks', () => {
  const { game, press } = setup();
  press('p');
  press('p', { repeat: true });
  press('p', { repeat: true });
  assert.strictEqual(game.clicks, 1);
});

test('ignored while typing text or with modifiers', () => {
  const { game, press } = setup();
  press('p', { target: { tagName: 'INPUT' } });
  press(' ', { target: { tagName: 'TEXTAREA' } });
  press('p', { target: { tagName: 'DIV', isContentEditable: true } });
  press('p', { ctrlKey: true });
  press('p', { altKey: true });
  assert.strictEqual(game.clicks, 0);
});

test('other keys are ignored', () => {
  const { game, press } = setup();
  press('f'); press('Enter'); press('s', { ctrlKey: true });
  assert.strictEqual(game.clicks, 0);
});

test('no window is a no-op', () => {
  assert.doesNotThrow(() => installKeyClicks(undefined, {}));
});

test('panel shows the keyboard hint', () => {
  assert.match(renderPanel([], [], 0), /Clic clavier : P \/ Espace/);
});
