/* ---------------------------------------------------------------------------
 * menu.js — TI-style modal menus (ZOOM, MATH, VARS, error dialogs, prompts).
 *
 * A menu paints over the whole screen: tab names on the top row with the
 * active tab inverted, then numbered items with a ▸ marking the selection.
 * When the list runs past the screen the last visible item shows ↓ in place
 * of its colon, exactly as the calculator does.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var LCD = TI.LCD;
  var stack = [];

  function open(def) {
    def.tab = def.tab || 0;
    def.sel = def.sel || 0;
    def.top = 0;
    stack.push(def);
  }
  function close() { stack.pop(); }
  function closeAll() { stack.length = 0; }
  function active() { return stack.length ? stack[stack.length - 1] : null; }

  function itemsOf(m) { return m.tabs ? m.items[m.tab] : m.items; }

  function keyChar(i) {
    if (i < 9) return String(i + 1);
    if (i === 9) return '0';
    return String.fromCharCode(65 + i - 10);
  }

  function draw() {
    var m = active();
    if (!m) return;
    LCD.clear();

    var firstRow = 0;
    if (m.tabs) {
      var x = 0;
      for (var t = 0; t < m.tabs.length; t++) {
        LCD.textPx(x, 0, m.tabs[t], { invert: t === m.tab });
        x += (m.tabs[t].length + 1) * 6;
      }
      firstRow = 1;
    } else if (m.title) {
      LCD.text(0, 0, m.title);
      firstRow = 1;
    }

    var items = itemsOf(m);
    var visible = 8 - firstRow;

    /* keep the selection inside the visible band */
    if (m.sel < m.top) m.top = m.sel;
    if (m.sel >= m.top + visible) m.top = m.sel - visible + 1;

    for (var i = 0; i < visible; i++) {
      var idx = m.top + i;
      if (idx >= items.length) break;
      var row = firstRow + i;
      var last = (i === visible - 1) && (idx < items.length - 1);
      var sep = last ? '↓' : ':';
      if (idx === m.sel) LCD.text(0, row, '▸');
      LCD.text(1, row, keyChar(idx) + sep + items[idx].label);
    }
  }

  function pick(m, idx) {
    var items = itemsOf(m);
    if (idx < 0 || idx >= items.length) return;
    var it = items[idx];
    if (it.disabled) return;
    close();
    if (it.run) it.run();
    else if (m.onPick) m.onPick(it, idx);
  }

  function key(k) {
    var m = active();
    if (!m) return false;
    var items = itemsOf(m);

    if (k.act === 'up')    { m.sel = (m.sel - 1 + items.length) % items.length; return true; }
    if (k.act === 'down')  { m.sel = (m.sel + 1) % items.length; return true; }
    if (k.act === 'left' && m.tabs)  { m.tab = (m.tab - 1 + m.tabs.length) % m.tabs.length; m.sel = 0; m.top = 0; return true; }
    if (k.act === 'right' && m.tabs) { m.tab = (m.tab + 1) % m.tabs.length; m.sel = 0; m.top = 0; return true; }
    if (k.act === 'enter') { pick(m, m.sel); return true; }
    if (k.act === 'clear' || k.act === 'quit') { close(); if (m.onCancel) m.onCancel(); return true; }

    /* number and letter shortcuts jump straight to an item */
    if (k.tok) {
      var t = k.tok();
      var ch = null;
      if (t.t === 'd') ch = t.s;
      else if (t.t === 'var') ch = t.n;
      if (ch !== null) {
        for (var i = 0; i < items.length; i++) if (keyChar(i) === ch) { pick(m, i); return true; }
      }
    }
    return true;   /* menus swallow everything else */
  }

  TI.Menu = {
    open: open, close: close, closeAll: closeAll, active: active,
    draw: draw, key: key
  };

  /* --- error dialog ----------------------------------------------------- */
  TI.Menu.error = function (name, onGoto) {
    var items = [{ label: 'Quit', run: function () {} }];
    if (onGoto) items.push({ label: 'Goto', run: onGoto });
    open({ title: 'ERR:' + name, items: items });
  };
})(window.TI = window.TI || {});
