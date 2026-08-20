/* ---------------------------------------------------------------------------
 * prgmedit.js — PROGRAM name entry and the program editor.
 *
 * The editor is where notes live. Each line is prefixed with ':' and holds
 * free text; ALPHA types letters and 2nd ALPHA locks the layer so you can type
 * a sentence without reaching for ALPHA between every character.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var LCD = TI.LCD, S = TI.State, T = TI.Tok;
  var W = 16, H = 8;

  /* ===================== name entry ===================== */

  var nameEd = new TI.Editor([]);

  function nameText() {
    return nameEd.toks.map(function (t) { return t.s; }).join('');
  }

  var nameScreen = {
    id: 'prgmname',
    enter: function () {
      nameEd.clear();
      TI.App.mod = 'lock';          /* the real one turns A-LOCK on for you */
    },
    draw: function (blink) {
      LCD.clear();
      LCD.text(0, 0, 'PROGRAM');
      LCD.text(0, 1, 'Name=' + nameText());
      if (blink) {
        var col = 5 + nameEd.charIndex();
        if (col < W) { LCD.text(col, 1, 'A'); LCD.invertCell(col, 1); }
      }
      LCD.text(0, 3, 'Letters and');
      LCD.text(0, 4, 'digits, max 8.');
    },
    key: function (k) {
      if (k.tok) {
        var t = k.tok();
        var ok = (t.t === 'var') || (t.t === 'd' && t.s !== '.' && nameEd.toks.length > 0);
        if (ok && nameEd.toks.length < 8) nameEd.insert(t);
        return;
      }
      switch (k.act) {
        case 'del':   nameEd.del(); return;
        case 'clear': nameEd.clear(); return;
        case 'left':  nameEd.left(); return;
        case 'right': nameEd.right(); return;
        case 'enter': {
          var name = nameText();
          if (!TI.Prgm.validName(name)) return;
          if (TI.Prgm.find(name)) { TI.Menu.error('DUPLICATE'); return; }
          TI.Prgm.create(name);
          TI.App.mod = null;
          editScreen.open(name);
          return;
        }
      }
    }
  };

  /* ===================== the editor ===================== */

  var prog = null;
  var ln = 0;                    /* current line index          */
  var ed = new TI.Editor([]);    /* editor over the current line */
  var top = 0;                   /* first visible display row    */

  function bind(i) {
    ln = Math.max(0, Math.min(prog.lines.length - 1, i));
    ed.toks = prog.lines[ln];
    ed.cur = Math.min(ed.cur, ed.toks.length);
  }

  /* One display row per 16 columns; the ':' takes the first column of the
     line's first row, continuations use the full width. */
  function layout() {
    var rows = [];
    for (var i = 0; i < prog.lines.length; i++) {
      var chars = Array.from(TI.Tok.toText(prog.lines[i]));
      rows.push({ line: i, first: true, text: chars.slice(0, W - 1).join(''), offset: 0 });
      var c = W - 1;
      while (c < chars.length) {
        rows.push({ line: i, first: false, text: chars.slice(c, c + W).join(''), offset: c });
        c += W;
      }
    }
    return rows;
  }

  function cursorCell(rows) {
    var ci = ed.charIndex();
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (row.line !== ln) continue;
      var width = row.first ? W - 1 : W;
      var base = row.first ? 1 : 0;
      if (ci >= row.offset && ci < row.offset + width) return { row: r, col: base + (ci - row.offset) };
      var nxt = rows[r + 1];
      if ((!nxt || nxt.line !== ln) && ci === row.offset + Array.from(row.text).length) {
        var col = base + (ci - row.offset);
        return col < W ? { row: r, col: col } : { row: r + 1, col: 0, overflow: true };
      }
    }
    return { row: 0, col: 1 };
  }

  var editScreen = {
    id: 'prgmedit',

    open: function (name) {
      prog = TI.Prgm.find(name);
      if (!prog) { TI.App.setScreen('home'); return; }
      if (!prog.lines.length) prog.lines.push([]);
      ln = 0; top = 0;
      bind(0); ed.end();
      TI.App.setScreen('prgmedit');
    },

    /* Jump straight to a line — used by 2:Goto on a runtime error. */
    openAt: function (name, line) {
      editScreen.open(name);
      if (prog) { bind(line); ed.end(); }
    },

    enter: function () {
      if (!prog) { TI.App.setScreen('home'); return; }
      bind(ln);
    },

    leave: function () { S.save(); },

    reset: function () { prog = null; ln = 0; top = 0; ed.toks = []; ed.cur = 0; },

    current: function () { return prog; },

    draw: function (blink) {
      LCD.clear();
      if (!prog) return;
      LCD.text(0, 0, ('PROGRAM:' + prog.name).slice(0, W));

      var rows = layout();
      var cur = cursorCell(rows);
      var body = H - 1;
      if (cur.row < top) top = cur.row;
      if (cur.row >= top + body) top = cur.row - body + 1;
      if (top > Math.max(0, rows.length - body)) top = Math.max(0, rows.length - body);
      if (top < 0) top = 0;

      for (var i = 0; i < body; i++) {
        var r = rows[top + i];
        if (!r) break;
        if (r.first) { LCD.text(0, i + 1, ':'); LCD.text(1, i + 1, r.text); }
        else LCD.text(0, i + 1, r.text);
      }

      if (blink && cur.row >= top && cur.row < top + body) {
        var vr = cur.row - top + 1;
        if (vr < H) {
          if (TI.App.mod === 'alpha' || TI.App.mod === 'lock') LCD.text(cur.col, vr, 'A');
          else if (TI.App.mod === '2nd') LCD.text(cur.col, vr, '↑');
          LCD.invertCell(cur.col, vr);
        }
      }
    },

    key: function (k) {
      if (!prog) return;

      if (k.tok) {
        ed.insert(k.tok(), TI.App.insert === false);
        S.save();
        return;
      }

      switch (k.act) {
        case 'enter': {
          /* split the line at the cursor, as the editor does */
          var tail = ed.toks.splice(ed.cur, ed.toks.length - ed.cur);
          prog.lines.splice(ln + 1, 0, tail);
          bind(ln + 1);
          ed.cur = 0;
          S.save();
          return;
        }
        case 'up':    if (ln > 0) { bind(ln - 1); ed.end(); } return;
        case 'down':  if (ln < prog.lines.length - 1) { bind(ln + 1); ed.end(); } return;
        case 'left':
          if (!ed.left() && ln > 0) { bind(ln - 1); ed.end(); }
          return;
        case 'right':
          if (!ed.right() && ln < prog.lines.length - 1) { bind(ln + 1); ed.home(); }
          return;
        case 'del':
          if (ed.cur === 0 && ed.toks.length === 0 && prog.lines.length > 1) {
            prog.lines.splice(ln, 1);
            bind(Math.max(0, ln - 1));
            ed.end();
          } else if (ed.cur === 0 && ln > 0) {
            /* join this line onto the end of the previous one */
            var mine = prog.lines[ln];
            prog.lines.splice(ln, 1);
            bind(ln - 1);
            ed.end();
            var at = ed.toks.length;
            Array.prototype.push.apply(ed.toks, mine);
            ed.cur = at;
          } else {
            ed.del();
          }
          S.save();
          return;
        case 'clear':
          if (ed.toks.length) { ed.toks.length = 0; ed.cur = 0; }
          else if (prog.lines.length > 1) { prog.lines.splice(ln, 1); bind(Math.max(0, ln - 1)); ed.end(); }
          S.save();
          return;
        case 'sto': ed.insert(T.store()); S.save(); return;
      }
    }
  };

  TI.Screens = TI.Screens || {};
  TI.Screens.prgmname = nameScreen;
  TI.Screens.prgmedit = editScreen;
})(window.TI = window.TI || {});
