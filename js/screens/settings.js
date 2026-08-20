/* ---------------------------------------------------------------------------
 * settings.js — MODE and FORMAT: rows of mutually exclusive options with the
 * active one shown in inverse video.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var LCD = TI.LCD, S = TI.State;

  function OptionScreen(rows) {
    this.rows = rows;      /* [{ opts:[{label, on(), pick()}], locked }] */
    this.r = 0; this.c = 0;
  }

  OptionScreen.prototype.enter = function () { this.r = 0; this.c = 0; };

  OptionScreen.prototype.draw = function (blink) {
    LCD.clear();
    for (var i = 0; i < this.rows.length && i < 8; i++) {
      var row = this.rows[i];
      var col = 0;
      for (var j = 0; j < row.opts.length; j++) {
        var o = row.opts[j];
        LCD.text(col, i, o.label, { invert: o.on() });
        if (blink && i === this.r && j === this.c) LCD.invertCell(col, i);
        col += o.label.length + (row.tight ? 0 : 1);
      }
    }
  };

  OptionScreen.prototype.key = function (k) {
    var row = this.rows[this.r];
    switch (k.act) {
      case 'up':    this.r = (this.r - 1 + this.rows.length) % this.rows.length; this.c = Math.min(this.c, this.rows[this.r].opts.length - 1); return true;
      case 'down':  this.r = (this.r + 1) % this.rows.length; this.c = Math.min(this.c, this.rows[this.r].opts.length - 1); return true;
      case 'left':  this.c = Math.max(0, this.c - 1); return true;
      case 'right': this.c = Math.min(row.opts.length - 1, this.c + 1); return true;
      case 'enter':
        if (row.locked) return true;
        row.opts[this.c].pick();
        S.save();
        return true;
    }
    return true;
  };

  function opt(label, isOn, pick) { return { label: label, on: isOn, pick: pick || function () {} }; }
  function notationOpt(n) { return opt(n, function () { return S.notation === n; }, function () { S.notation = n; }); }
  function digitOpts() {
    var out = [opt('FLOAT', function () { return S.digits < 0; }, function () { S.digits = -1; })];
    for (var d = 0; d <= 9; d++) {
      (function (d) {
        out.push(opt(String(d), function () { return S.digits === d; }, function () { S.digits = d; }));
      })(d);
    }
    return out;
  }

  var modeScreen = new OptionScreen([
    { opts: [notationOpt('NORMAL'), notationOpt('SCI'), notationOpt('ENG')] },
    { opts: digitOpts(), tight: true },
    { opts: [
      opt('RADIAN', function () { return S.angle === 'RADIAN'; }, function () { S.angle = 'RADIAN'; }),
      opt('DEGREE', function () { return S.angle === 'DEGREE'; }, function () { S.angle = 'DEGREE'; })
    ] },
    { opts: [opt('FUNC', function () { return true; }), opt('PAR', function () { return false; }),
             opt('POL', function () { return false; }), opt('SEQ', function () { return false; })], locked: true },
    { opts: [
      opt('CONNECTED', function () { return S.plotStyle === 'CONNECTED'; }, function () { S.plotStyle = 'CONNECTED'; }),
      opt('DOT', function () { return S.plotStyle === 'DOT'; }, function () { S.plotStyle = 'DOT'; })
    ] },
    { opts: [opt('SEQUENTIAL', function () { return true; }), opt('SIMUL', function () { return false; })], locked: true },
    { opts: [opt('REAL', function () { return true; }), opt('a+bi', function () { return false; }),
             opt('re^θi', function () { return false; })], locked: true },
    { opts: [opt('FULL', function () { return true; }), opt('HORIZ', function () { return false; }),
             opt('G-T', function () { return false; })], locked: true }
  ]);

  function toggleRow(onLabel, offLabel, get, set) {
    return { opts: [
      opt(onLabel,  function () { return get(); },  function () { set(true); }),
      opt(offLabel, function () { return !get(); }, function () { set(false); })
    ] };
  }

  var formatScreen = new OptionScreen([
    { opts: [opt('RectGC', function () { return true; }), opt('PolarGC', function () { return false; })], locked: true },
    toggleRow('CoordOn', 'CoordOff', function () { return S.coord; }, function (v) { S.coord = v; }),
    { opts: [
      opt('GridOff', function () { return !S.grid; }, function () { S.grid = false; }),
      opt('GridOn',  function () { return S.grid; },  function () { S.grid = true; })
    ] },
    toggleRow('AxesOn', 'AxesOff', function () { return S.axes; }, function (v) { S.axes = v; }),
    { opts: [
      opt('LabelOff', function () { return !S.label; }, function () { S.label = false; }),
      opt('LabelOn',  function () { return S.label; },  function () { S.label = true; })
    ] },
    toggleRow('ExprOn', 'ExprOff', function () { return S.expr; }, function (v) { S.expr = v; })
  ]);

  TI.Screens = TI.Screens || {};
  TI.Screens.mode = {
    id: 'mode',
    draw: function (b) { modeScreen.draw(b); },
    key: function (k) { modeScreen.key(k); },
    enter: function () { modeScreen.enter(); },
    reset: function () { modeScreen.enter(); }
  };
  TI.Screens.format = {
    id: 'format',
    draw: function (b) { formatScreen.draw(b); },
    key: function (k) { formatScreen.key(k); },
    enter: function () { formatScreen.enter(); },
    reset: function () { formatScreen.enter(); }
  };
})(window.TI = window.TI || {});
