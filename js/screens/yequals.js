/* ---------------------------------------------------------------------------
 * yequals.js — the Y= editor.
 *
 * Ten function slots, Y1 through Y0. A function is plotted when its = sign is
 * highlighted; move the cursor left onto the = and press ENTER to toggle it.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var LCD = TI.LCD, S = TI.State;
  var W = 16, H = 8;
  var PREFIX = 4;                 /* \Y₁= */

  var sel = 0;                    /* which Y slot          */
  var onEquals = false;           /* cursor sits on the =  */
  var ed = new TI.Editor([]);
  var top = 0;                    /* first visible display row */

  function bind(i) {
    sel = i;
    ed.toks = S.ys[i].toks;
    ed.cur = Math.min(ed.cur, ed.toks.length);
  }

  function enter() { bind(sel); ed.end(); }

  /* Display rows: one for the Plot header, then each Y wrapped to 16 columns. */
  function layout() {
    var rows = [{ kind: 'plot' }];
    for (var i = 0; i < 10; i++) {
      var expr = TI.Tok.toText(S.ys[i].toks);
      var chars = Array.from(expr);
      var first = chars.slice(0, W - PREFIX).join('');
      rows.push({ kind: 'y', slot: i, first: true, text: first, offset: 0 });
      var c = W - PREFIX;
      while (c < chars.length) {
        rows.push({ kind: 'y', slot: i, first: false, text: chars.slice(c, c + W).join(''), offset: c });
        c += W;
      }
    }
    return rows;
  }

  function cursorCell(rows) {
    var ci = ed.charIndex();
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row.kind !== 'y' || row.slot !== sel) continue;
      if (onEquals) { if (row.first) return { row: r, col: PREFIX - 1 }; continue; }
      var width = row.first ? W - PREFIX : W;
      if (ci >= row.offset && ci < row.offset + width) {
        return { row: r, col: (row.first ? PREFIX : 0) + (ci - row.offset) };
      }
      /* cursor sitting exactly at the end of the last row of this slot */
      var nxt = rows[r + 1];
      if ((!nxt || nxt.slot !== sel) && ci === row.offset + Array.from(row.text).length) {
        var col = (row.first ? PREFIX : 0) + (ci - row.offset);
        if (col < W) return { row: r, col: col };
        return { row: r + 0.5, col: 0 };   /* wraps to a fresh row */
      }
    }
    return { row: 1, col: PREFIX };
  }

  function draw(blink) {
    LCD.clear();
    var rows = layout();
    var cur = cursorCell(rows);
    var curRow = Math.floor(cur.row);

    if (curRow < top) top = curRow;
    if (curRow >= top + H) top = curRow - H + 1;
    if (top > rows.length - H) top = Math.max(0, rows.length - H);
    if (top < 0) top = 0;

    for (var i = 0; i < H; i++) {
      var r = rows[top + i];
      if (!r) break;
      if (r.kind === 'plot') {
        LCD.textPx(0, 1, 'Plot1', { small: true });
        LCD.textPx(28, 1, 'Plot2', { small: true });
        LCD.textPx(56, 1, 'Plot3', { small: true });
        continue;
      }
      if (r.first) {
        LCD.text(0, i, '\\' + S.yLabel(r.slot));
        /* an empty slot is not plotted, so its = is not highlighted */
        LCD.text(3, i, '=', { invert: S.ys[r.slot].on && S.ys[r.slot].toks.length > 0 });
        LCD.text(PREFIX, i, r.text);
      } else {
        LCD.text(0, i, r.text);
      }
    }

    if (blink && curRow >= top && curRow < top + H) {
      var vr = curRow - top;
      var vc = cur.col;
      if (cur.row % 1 !== 0) { vr += 1; vc = 0; }
      if (vr < H) {
        if (TI.App.mod === 'alpha' || TI.App.mod === 'lock') LCD.text(vc, vr, 'A');
        else if (TI.App.mod === '2nd') LCD.text(vc, vr, '↑');
        LCD.invertCell(vc, vr);
      }
    }
  }

  function moveTo(i) {
    if (i < 0 || i > 9) return;
    bind(i);
    onEquals = false;
    ed.end();
  }

  function key(k) {
    if (k.tok) {
      if (onEquals) { onEquals = false; ed.home(); }
      ed.insert(k.tok(), TI.App.insert === false);
      S.save();
      return;
    }
    switch (k.act) {
      case 'enter':
        if (onEquals) { S.ys[sel].on = !S.ys[sel].on; S.save(); return; }
        if (sel < 9) moveTo(sel + 1);
        return;
      case 'up':    if (sel > 0) moveTo(sel - 1); return;
      case 'down':  if (sel < 9) moveTo(sel + 1); return;
      case 'left':
        if (onEquals) return;
        if (!ed.left()) onEquals = true;
        return;
      case 'right':
        if (onEquals) { onEquals = false; ed.home(); return; }
        ed.right();
        return;
      case 'del':
        if (onEquals) return;
        ed.del(); S.save();
        return;
      case 'clear':
        onEquals = false;
        S.ys[sel].toks = [];
        bind(sel); ed.end(); S.save();
        return;
      case 'sto': ed.insert(TI.Tok.store()); return;
    }
  }

  TI.Screens = TI.Screens || {};
  TI.Screens.yeq = {
    id: 'yeq', draw: draw, key: key, enter: enter,
    reset: function () { sel = 0; onEquals = false; top = 0; bind(0); ed.end(); }
  };
})(window.TI = window.TI || {});
