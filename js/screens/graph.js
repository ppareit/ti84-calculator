/* ---------------------------------------------------------------------------
 * graph.js — the plotting screen.
 *
 * The plot area is 95 x 63 pixels, so
 *     ΔX = (Xmax-Xmin)/94      ΔY = (Ymax-Ymin)/62
 * which is why TRACE on the standard window steps in .2127659574 and lands
 * exactly on X=0 at the middle column. Everything here works from that grid.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var LCD = TI.LCD, S = TI.State;
  var GW = 95, GH = 63;            /* plot area, in pixels          */
  var XSPAN = GW - 1, YSPAN = GH - 1;

  var plotBuf = new Uint8Array(LCD.W * LCD.H);
  var cacheKey = null;

  var mode = 'free';               /* free | trace | calc | zoomcenter | box1 | box2 */
  var pendingZoom = null;
  var cur = { c: 47, r: 31 };      /* free cursor, in pixels        */
  var trace = { fn: 0, c: 47 };
  var box = { c: 0, r: 0 };

  /* --- coordinate mapping ---------------------------------------------- */
  /* Xmin + 47ΔX should land exactly on the axis. In binary floating point it
     lands a few 1e-16 away, which would surface in TRACE as X=⁻8.882ᴇ⁻16.
     The real machine's 14-digit decimal arithmetic swallows that, so snap the
     result to the same precision relative to the window. */
  function snap(v, scale) {
    if (!isFinite(v) || !isFinite(scale) || scale === 0) return v;
    var q = Math.abs(scale) * 1e-13;
    return Math.round(v / q) * q;
  }
  function dX() { return (S.win.Xmax - S.win.Xmin) / XSPAN; }
  function dY() { return (S.win.Ymax - S.win.Ymin) / YSPAN; }
  function xAt(c) { return snap(S.win.Xmin + c * dX(), Math.max(Math.abs(S.win.Xmin), Math.abs(S.win.Xmax))); }
  function yAt(r) { return snap(S.win.Ymax - r * dY(), Math.max(Math.abs(S.win.Ymin), Math.abs(S.win.Ymax))); }
  function colOf(x) { return Math.round((x - S.win.Xmin) / dX()); }
  function rowOf(y) { return (S.win.Ymax - y) / dY(); }

  function windowValid() {
    var w = S.win;
    return isFinite(w.Xmin) && isFinite(w.Xmax) && isFinite(w.Ymin) && isFinite(w.Ymax) &&
           w.Xmax > w.Xmin && w.Ymax > w.Ymin;
  }

  /* --- which functions are being plotted -------------------------------- */
  function activeFns() {
    var out = [];
    for (var i = 0; i < 10; i++) {
      var y = S.ys[i];
      if (!y.on || !y.toks.length) continue;
      var ast = null;
      try { ast = TI.Parser.parse(y.toks); } catch (e) { ast = null; }
      out.push({ slot: i, ast: ast, text: TI.Tok.toText(y.toks) });
    }
    return out;
  }

  function evalAt(fn, x, ctx) {
    if (!fn.ast) return NaN;
    ctx.vars.X = x;
    try {
      var r = TI.Eval.evaluate(fn.ast, ctx);
      return typeof r.value === 'number' ? r.value : NaN;
    } catch (e) { return NaN; }
  }

  /* --- clipping --------------------------------------------------------- */
  /* Cohen-Sutherland against the plot rectangle. Without it a segment that
     jumps across an asymptote would run the line routine for millions of
     steps; with it you get the same near-vertical stroke the calculator draws. */
  function outcode(x, y) {
    var c = 0;
    if (x < 0) c |= 1; else if (x > XSPAN) c |= 2;
    if (y < 0) c |= 4; else if (y > YSPAN) c |= 8;
    return c;
  }
  function clipSegment(x0, y0, x1, y1) {
    var c0 = outcode(x0, y0), c1 = outcode(x1, y1);
    for (var guard = 0; guard < 8; guard++) {
      if (!(c0 | c1)) return [x0, y0, x1, y1];
      if (c0 & c1) return null;
      var c = c0 || c1, x, y;
      if (c & 8)      { x = x0 + (x1 - x0) * (YSPAN - y0) / (y1 - y0); y = YSPAN; }
      else if (c & 4) { x = x0 + (x1 - x0) * (0 - y0) / (y1 - y0);     y = 0; }
      else if (c & 2) { y = y0 + (y1 - y0) * (XSPAN - x0) / (x1 - x0); x = XSPAN; }
      else            { y = y0 + (y1 - y0) * (0 - x0) / (x1 - x0);     x = 0; }
      if (!isFinite(x) || !isFinite(y)) return null;
      if (c === c0) { x0 = x; y0 = y; c0 = outcode(x0, y0); }
      else          { x1 = x; y1 = y; c1 = outcode(x1, y1); }
    }
    return null;
  }

  /* --- render the static plot ------------------------------------------- */
  function keyOf() {
    var w = S.win;
    return [w.Xmin, w.Xmax, w.Xscl, w.Ymin, w.Ymax, w.Yscl, w.Xres,
            S.plotStyle, S.axes, S.grid, S.label, S.angle,
            S.ys.map(function (y) { return (y.on ? '1' : '0') + TI.Tok.toText(y.toks); }).join('|')].join(',');
  }

  function renderPlot() {
    var k = keyOf();
    if (k === cacheKey) return;
    cacheKey = k;

    var saved = LCD.buf.slice();
    LCD.clear();

    if (!windowValid()) {
      LCD.text(0, 3, 'ERR:WINDOW RANGE');
      plotBuf.set(LCD.buf);
      LCD.buf.set(saved);
      return;
    }

    var w = S.win;
    var ax = colOf(0), ay = rowOf(0);
    var axOn = ax >= 0 && ax <= XSPAN;
    var ayOn = ay >= 0 && ay <= YSPAN;

    /* grid dots at the tick spacing */
    if (S.grid && w.Xscl > 0 && w.Yscl > 0) {
      var gx0 = Math.ceil(w.Xmin / w.Xscl), gx1 = Math.floor(w.Xmax / w.Xscl);
      var gy0 = Math.ceil(w.Ymin / w.Yscl), gy1 = Math.floor(w.Ymax / w.Yscl);
      if (gx1 - gx0 < 200 && gy1 - gy0 < 200) {
        for (var gi = gx0; gi <= gx1; gi++) {
          for (var gj = gy0; gj <= gy1; gj++) LCD.px(colOf(gi * w.Xscl), Math.round(rowOf(gj * w.Yscl)), 1);
        }
      }
    }

    /* axes with tick marks */
    if (S.axes) {
      if (ayOn) LCD.hline(0, XSPAN, Math.round(ay), 1);
      if (axOn) LCD.vline(ax, 0, YSPAN, 1);
      if (w.Xscl > 0 && ayOn) {
        var tx0 = Math.ceil(w.Xmin / w.Xscl), tx1 = Math.floor(w.Xmax / w.Xscl);
        if (tx1 - tx0 < 200) for (var t = tx0; t <= tx1; t++) {
          var tc = colOf(t * w.Xscl);
          LCD.vline(tc, Math.round(ay) - 1, Math.round(ay) + 1, 1);
        }
      }
      if (w.Yscl > 0 && axOn) {
        var ty0 = Math.ceil(w.Ymin / w.Yscl), ty1 = Math.floor(w.Ymax / w.Yscl);
        if (ty1 - ty0 < 200) for (var u = ty0; u <= ty1; u++) {
          var tr = Math.round(rowOf(u * w.Yscl));
          LCD.hline(ax - 1, ax + 1, tr, 1);
        }
      }
    }

    /* the functions */
    var fns = activeFns();
    var ctx = S.evalCtx();
    var savedX = S.vars.X;
    var step = Math.max(1, Math.min(8, Math.round(w.Xres) || 1));
    var dot = S.plotStyle === 'DOT';

    for (var f = 0; f < fns.length; f++) {
      var prevC = null, prevR = null;
      for (var c = 0; c <= XSPAN + step; c += step) {
        var cc = Math.min(c, XSPAN);
        var y = evalAt(fns[f], xAt(cc), ctx);
        var r = (typeof y === 'number' && isFinite(y)) ? rowOf(y) : null;

        if (r === null) { prevC = null; prevR = null; if (cc === XSPAN) break; continue; }
        if (dot || prevC === null) {
          if (r >= 0 && r <= YSPAN) LCD.px(cc, Math.round(r), 1);
        } else {
          var seg = clipSegment(prevC, prevR, cc, r);
          if (seg) LCD.line(Math.round(seg[0]), Math.round(seg[1]), Math.round(seg[2]), Math.round(seg[3]), 1);
        }
        prevC = cc; prevR = r;
        if (cc === XSPAN) break;
      }
    }
    if (savedX === undefined) delete S.vars.X; else S.vars.X = savedX;

    /* axis end labels */
    if (S.label && S.axes) {
      if (ayOn) LCD.textPx(XSPAN - 8, Math.round(ay) + 2, 'X', { small: true });
      if (axOn) LCD.textPx(ax + 2, 0, 'Y', { small: true });
    }

    plotBuf.set(LCD.buf);
    LCD.buf.set(saved);
  }

  /* --- cursor and readout ------------------------------------------------ */
  function drawCursor(c, r) {
    c = Math.round(c); r = Math.round(r);
    for (var i = -2; i <= 2; i++) { LCD.xor(c + i, r); LCD.xor(c, r + i); }
  }

  function fitNum(v, chars) {
    var s = TI.Fmt.num(v, { notation: S.notation, digits: S.digits });
    if (Array.from(s).length <= chars) return s;
    for (var d = 9; d >= 1; d--) {
      var t = TI.Fmt.num(TI.Fmt.sigRound(v, d), { notation: S.notation, digits: -1 });
      if (Array.from(t).length <= chars) return t;
    }
    return TI.Fmt.num(v, { notation: 'SCI', digits: 2 });
  }

  function drawReadout(x, y) {
    if (!S.coord) return;
    LCD.rect(0, 58, LCD.W, 6, 0);
    LCD.textPx(0, 58, 'X=' + fitNum(x, 10), { small: true });
    LCD.textPx(48, 58, 'Y=' + fitNum(y, 10), { small: true });
  }

  function drawExpr(fn) {
    if (!S.expr || !fn) return;
    LCD.rect(0, 0, LCD.W, 6, 0);
    var label = 'Y' + S.yNumber(fn.slot) + '=' + fn.text;
    LCD.textPx(0, 0, label.slice(0, 24), { small: true });
  }

  function draw(blink) {
    renderPlot();
    LCD.buf.set(plotBuf);
    if (!windowValid()) return;

    var fns = activeFns();

    if (mode === 'trace') {
      if (!fns.length) { mode = 'free'; }
      else {
        if (trace.fn >= fns.length) trace.fn = 0;
        var fn = fns[trace.fn];
        var ctx = S.evalCtx();
        var savedX = S.vars.X;
        var x = xAt(trace.c);
        var y = evalAt(fn, x, ctx);
        if (savedX === undefined) delete S.vars.X; else S.vars.X = savedX;
        drawExpr(fn);
        if (isFinite(y)) {
          var r = rowOf(y);
          if (r >= 0 && r <= YSPAN && blink) drawCursor(trace.c, r);
          drawReadout(x, y);
        } else {
          drawReadout(x, NaN);
        }
        return;
      }
    }

    if (mode === 'calc') {
      if (!fns.length) { mode = 'free'; calc = null; }
      else { drawCalc(fns, blink); return; }
    }

    if (mode === 'box2') {
      /* rubber band between the anchor and the live cursor */
      var x0 = Math.min(box.c, cur.c), x1 = Math.max(box.c, cur.c);
      var y0 = Math.min(box.r, cur.r), y1 = Math.max(box.r, cur.r);
      for (var i = x0; i <= x1; i += 2) { LCD.xor(i, y0); LCD.xor(i, y1); }
      for (var j = y0; j <= y1; j += 2) { LCD.xor(x0, j); LCD.xor(x1, j); }
    }

    if (blink) drawCursor(cur.c, cur.r);
    drawReadout(xAt(cur.c), yAt(cur.r));
  }

  /* --- zoom ------------------------------------------------------------- */
  function saveZoom() {
    S.zoomPrev = { Xmin: S.win.Xmin, Xmax: S.win.Xmax, Xscl: S.win.Xscl,
                   Ymin: S.win.Ymin, Ymax: S.win.Ymax, Yscl: S.win.Yscl };
  }
  function applyWindow(w) {
    saveZoom();
    Object.keys(w).forEach(function (k) { S.win[k] = w[k]; });
    S.save();
  }

  function zoomAbout(cx, cy, fx, fy) {
    var hw = (S.win.Xmax - S.win.Xmin) / 2 * fx;
    var hh = (S.win.Ymax - S.win.Ymin) / 2 * fy;
    applyWindow({ Xmin: cx - hw, Xmax: cx + hw, Ymin: cy - hh, Ymax: cy + hh });
  }

  var Zoom = {
    box:      function () { mode = 'box1'; TI.App.setScreen('graph'); },
    zin:      function () { pendingZoom = 'in';  mode = 'zoomcenter'; TI.App.setScreen('graph'); },
    zout:     function () { pendingZoom = 'out'; mode = 'zoomcenter'; TI.App.setScreen('graph'); },
    zinteger: function () { pendingZoom = 'int'; mode = 'zoomcenter'; TI.App.setScreen('graph'); },
    decimal:  function () {
      applyWindow({ Xmin: -4.7, Xmax: 4.7, Xscl: 1, Ymin: -3.1, Ymax: 3.1, Yscl: 1 });
      TI.App.setScreen('graph');
    },
    square: function () {
      /* make one pixel the same width and height by widening X about its centre */
      var cx = (S.win.Xmin + S.win.Xmax) / 2;
      var half = dY() * XSPAN / 2;
      applyWindow({ Xmin: cx - half, Xmax: cx + half });
      TI.App.setScreen('graph');
    },
    standard: function () {
      applyWindow({ Xmin: -10, Xmax: 10, Xscl: 1, Ymin: -10, Ymax: 10, Yscl: 1 });
      TI.App.setScreen('graph');
    },
    trig: function () {
      if (S.angle === 'DEGREE') {
        applyWindow({ Xmin: -352.5, Xmax: 352.5, Xscl: 90, Ymin: -4, Ymax: 4, Yscl: 1 });
      } else {
        var h = 47 * Math.PI / 24;
        applyWindow({ Xmin: -h, Xmax: h, Xscl: Math.PI / 2, Ymin: -4, Ymax: 4, Yscl: 1 });
      }
      TI.App.setScreen('graph');
    },
    stat: function () { TI.Menu.error('STAT'); },
    fit: function () {
      var fns = activeFns();
      if (!fns.length) { TI.App.setScreen('graph'); return; }
      var ctx = S.evalCtx(), savedX = S.vars.X;
      var lo = Infinity, hi = -Infinity;
      for (var c = 0; c <= XSPAN; c++) {
        for (var i = 0; i < fns.length; i++) {
          var y = evalAt(fns[i], xAt(c), ctx);
          if (isFinite(y)) { if (y < lo) lo = y; if (y > hi) hi = y; }
        }
      }
      if (savedX === undefined) delete S.vars.X; else S.vars.X = savedX;
      if (!isFinite(lo) || !isFinite(hi)) { TI.App.setScreen('graph'); return; }
      if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
      applyWindow({ Ymin: lo, Ymax: hi });
      TI.App.setScreen('graph');
    },
    prev: function () {
      if (!S.zoomPrev) { TI.App.setScreen('graph'); return; }
      var p = S.zoomPrev;
      saveZoom();
      ['Xmin','Xmax','Xscl','Ymin','Ymax','Yscl'].forEach(function (k) { S.win[k] = p[k]; });
      S.save();
      TI.App.setScreen('graph');
    },
    sto: function () {
      S.zoomStore = { Xmin: S.win.Xmin, Xmax: S.win.Xmax, Xscl: S.win.Xscl,
                      Ymin: S.win.Ymin, Ymax: S.win.Ymax, Yscl: S.win.Yscl };
    },
    rcl: function () {
      if (!S.zoomStore) { TI.App.setScreen('graph'); return; }
      applyWindow(S.zoomStore);
      TI.App.setScreen('graph');
    }
  };

  function openZoomMenu() {
    TI.Menu.open({
      tabs: ['ZOOM', 'MEMORY'],
      items: [
        [
          { label: 'ZBox', run: Zoom.box },
          { label: 'Zoom In', run: Zoom.zin },
          { label: 'Zoom Out', run: Zoom.zout },
          { label: 'ZDecimal', run: Zoom.decimal },
          { label: 'ZSquare', run: Zoom.square },
          { label: 'ZStandard', run: Zoom.standard },
          { label: 'ZTrig', run: Zoom.trig },
          { label: 'ZInteger', run: Zoom.zinteger },
          { label: 'ZoomStat', run: Zoom.stat },
          { label: 'ZoomFit', run: Zoom.fit }
        ],
        [
          { label: 'ZPrevious', run: Zoom.prev },
          { label: 'ZoomSto', run: Zoom.sto },
          { label: 'ZoomRcl', run: Zoom.rcl }
        ]
      ]
    });
  }

  /* --- CALC (2nd TRACE) -------------------------------------------------- */
  /* Each operation walks through its prompts on the graph, with the cursor
     riding the curve as in TRACE. A bound can be pointed at with the arrows
     or typed: the digits appear after X= and ENTER takes them. */
  var CALC = {
    value:     { prompts: [] },
    zero:      { prompts: ['Left Bound?', 'Right Bound?', 'Guess?'], label: 'Zero' },
    minimum:   { prompts: ['Left Bound?', 'Right Bound?', 'Guess?'], label: 'Minimum' },
    maximum:   { prompts: ['Left Bound?', 'Right Bound?', 'Guess?'], label: 'Maximum' },
    intersect: { prompts: ['First curve?', 'Second curve?', 'Guess?'], label: 'Intersection' },
    dydx:      { prompts: [] },
    integral:  { prompts: ['Lower Limit?', 'Upper Limit?'] }
  };
  var calc = null;   /* { op, stage, fn, x, toks, marks, lo, hi, first, out } */

  function curve(fn) {
    var ctx = S.evalCtx();
    return function (x) {
      var savedX = S.vars.X;
      var y = evalAt(fn, x, ctx);
      if (savedX === undefined) delete S.vars.X; else S.vars.X = savedX;
      return y;
    };
  }

  /* A search stops a few 1e-12 short of the round value it is closing in on.
     The calculator's own search gives up much sooner (it reports 5.9999994
     for a top at 6); here the last digits are dropped instead, so that a top
     at 6 reads 6. */
  function tidy(v, scale) {
    if (!isFinite(v)) return v;
    var q = Math.pow(10, Math.ceil(Math.log10(Math.max(Math.abs(scale), 1))) - 9);
    return TI.Fmt.sigRound(Math.round(v / q) * q, 12) + 0;
  }
  function xScale() { return Math.max(Math.abs(S.win.Xmin), Math.abs(S.win.Xmax)); }
  function yScale() { return Math.max(Math.abs(S.win.Ymin), Math.abs(S.win.Ymax)); }

  function bisect(g, a, b) {
    var ga = g(a);
    if (ga === 0) return a;
    if (g(b) === 0) return b;
    for (var i = 0; i < 200; i++) {
      var m = (a + b) / 2, gm = g(m);
      if (gm === 0 || m === a || m === b) return m;
      if ((gm < 0) === (ga < 0)) { a = m; ga = gm; } else b = m;
    }
    return (a + b) / 2;
  }
  /* The sign change of g in [lo, hi] nearest the guess, or null. */
  function rootNear(g, lo, hi, guess) {
    var n = 2 * XSPAN, best = null;
    var px = lo, pg = g(lo);
    for (var i = 1; i <= n; i++) {
      var x = i === n ? hi : lo + i * (hi - lo) / n, gx = g(x);
      if (isFinite(pg) && isFinite(gx) && pg * gx <= 0) {
        var r = bisect(g, px, x);
        if (best === null || Math.abs(r - guess) < Math.abs(best - guess)) best = r;
      }
      px = x; pg = gx;
    }
    return best;
  }
  /* Golden section brackets the optimum, parabolic steps finish it (the same
     two stages as fMin( and fMax( in the evaluator). sign +1 finds a maximum. */
  function extremumIn(f, lo, hi, sign) {
    var g = function (t) { return sign * f(t); };
    var a = lo, b = hi, gr = (Math.sqrt(5) - 1) / 2;
    var c = b - gr * (b - a), d = a + gr * (b - a), gc = g(c), gd = g(d);
    for (var i = 0; i < 200 && b - a > 1e-7; i++) {
      if (gc > gd) { b = d; d = c; gd = gc; c = b - gr * (b - a); gc = g(c); }
      else { a = c; c = d; gc = gd; d = a + gr * (b - a); gd = g(d); }
    }
    var x = (a + b) / 2;
    for (var j = 0; j < 40; j++) {
      var h = Math.max(Math.abs(x) * 1e-5, 1e-6);
      var g0 = g(x - h), g1 = g(x), g2 = g(x + h), den = g0 - 2 * g1 + g2;
      if (!(den < 0)) break;                       /* not concave here */
      var st = -h * (g2 - g0) / (2 * den);
      if (!isFinite(st) || x + st < lo || x + st > hi) break;
      x += st;
      if (Math.abs(st) < 1e-13 * Math.max(1, Math.abs(x))) break;
    }
    return x;
  }
  function simpson(f, a, b) {
    var n = 2000, h = (b - a) / n, sum = f(a) + f(b);
    for (var i = 1; i < n; i++) sum += (i % 2 ? 4 : 2) * f(a + i * h);
    return sum * h / 3;
  }

  function startCalc(op) {
    TI.App.setScreen('graph');
    var fns = activeFns();
    if (!fns.length || !windowValid()) return;
    mode = 'calc';
    calc = { op: op, stage: 0, fn: trace.fn < fns.length ? trace.fn : 0,
             x: xAt(Math.max(0, Math.min(XSPAN, trace.c))), toks: [], marks: [], out: null };
  }
  function leaveCalc() {
    if (calc) cur.c = Math.max(0, Math.min(XSPAN, colOf(calc.x)));
    mode = 'free'; calc = null;
  }
  function calcError(name) {
    leaveCalc();
    TI.Menu.error(name);
  }

  function openCalcMenu() {
    function item(label, op) { return { label: label, run: function () { startCalc(op); } }; }
    TI.Menu.open({
      tabs: ['CALCULATE'],
      items: [[
        item('value', 'value'), item('zero', 'zero'), item('minimum', 'minimum'),
        item('maximum', 'maximum'), item('intersect', 'intersect'), item('dy/dx', 'dydx'),
        item('∫f(x)dx', 'integral')
      ]]
    });
  }

  function drawCalc(fns, blink) {
    if (calc.fn >= fns.length) calc.fn = 0;
    var fn = fns[calc.fn], out = calc.out;
    var y = out ? out.y : curve(fn)(calc.x);
    drawExpr(fn);

    /* a bound stays marked at the top of the plot, pointing into the interval */
    calc.marks.forEach(function (m) {
      var c = colOf(m.x);
      for (var i = 0; i < 3; i++) for (var j = i - 2; j <= 2 - i; j++) LCD.px(c + m.dir * i, 10 + j, 1);
    });

    var c = colOf(calc.x), r = rowOf(y);
    if (blink && isFinite(y) && c >= 0 && c <= XSPAN && r >= 0 && r <= YSPAN) drawCursor(c, r);

    var line = out ? out.label : CALC[calc.op].prompts[calc.stage];
    if (line) {
      LCD.rect(0, 52, Array.from(line).length * 4 + 1, 6, 0);
      LCD.textPx(0, 52, line, { small: true });
    }
    var typed = calc.toks.length || (calc.op === 'value' && !out);
    if (out && out.only) {
      LCD.rect(0, 58, LCD.W, 6, 0);
      LCD.textPx(0, 58, out.only, { small: true });
    } else if (typed) {
      LCD.rect(0, 58, LCD.W, 6, 0);
      LCD.textPx(0, 58, 'X=' + TI.Tok.toText(calc.toks), { small: true });
    } else {
      drawReadout(calc.x, y);
    }
  }

  function calcDone(label, x, y) {
    calc.x = tidy(x, xScale());
    calc.out = { label: label, y: tidy(y, yScale()) };
    calc.marks = [];
    S.vars.X = calc.x; S.vars.Y = calc.out.y;      /* as the calculator leaves them */
  }

  function calcEnter(fns) {
    var x = calc.x, f = curve(fns[calc.fn]);
    if (calc.toks.length) {
      try {
        x = TI.Eval.evaluate(TI.Parser.parse(calc.toks), S.evalCtx()).value;
      } catch (e) { calcError(e.ti || 'SYNTAX'); return; }
      if (typeof x !== 'number' || !isFinite(x)) { calcError('DATA TYPE'); return; }
      if (x < S.win.Xmin || x > S.win.Xmax) { calcError('INVALID'); return; }
      calc.toks = [];
      calc.x = x;
    } else if (calc.op === 'value') return;

    switch (calc.op) {
      case 'value':
        calc.out = { y: f(x) };
        S.vars.X = x; S.vars.Y = calc.out.y;
        return;
      case 'dydx':
        calc.out = { y: f(x), only: 'dy/dx=' + fitNum((f(x + 1e-3) - f(x - 1e-3)) / 2e-3, 14) };
        return;
      case 'intersect':
        if (calc.stage === 0) { calc.first = calc.fn; calc.fn = (calc.fn + 1) % fns.length; calc.stage = 1; return; }
        if (calc.stage === 1) { calc.second = calc.fn; calc.stage = 2; return; }
        var f1 = curve(fns[calc.first]), f2 = curve(fns[calc.second]);
        var cross = rootNear(function (t) { return f1(t) - f2(t); }, S.win.Xmin, S.win.Xmax, x);
        if (cross === null || calc.first === calc.second) { calcError('NO SIGN CHNG'); return; }
        calc.fn = calc.first;
        calcDone(CALC.intersect.label, cross, f1(cross));
        return;
    }

    /* the rest work between two bounds */
    if (calc.stage === 0) { calc.lo = x; calc.marks.push({ x: x, dir: 1 }); calc.stage = 1; return; }
    if (calc.stage === 1) {
      if (calc.op !== 'integral' && x <= calc.lo) { calcError('BOUND'); return; }
      calc.hi = x; calc.marks.push({ x: x, dir: -1 });
      if (calc.op === 'integral') {
        calc.marks = [];
        calc.out = { y: f(x), only: '∫f(x)dx=' + fitNum(tidy(simpson(f, calc.lo, calc.hi), 1), 14) };
        return;
      }
      calc.stage = 2; return;
    }
    if (x < calc.lo || x > calc.hi) { calcError('BOUND'); return; }
    var at;
    if (calc.op === 'zero') {
      at = rootNear(f, calc.lo, calc.hi, x);
      if (at === null) { calcError('NO SIGN CHNG'); return; }
    } else {
      at = extremumIn(f, calc.lo, calc.hi, calc.op === 'maximum' ? 1 : -1);
    }
    calcDone(CALC[calc.op].label, at, f(at));
  }

  function calcKey(k) {
    var fns = activeFns();
    if (!fns.length) { leaveCalc(); return; }
    if (calc.out) {            /* the answer stays until the cursor is asked for again */
      if (k.act === 'clear' || k.act === 'up' || k.act === 'down' ||
          k.act === 'left' || k.act === 'right') leaveCalc();
      return;
    }
    if (k.tok) { calc.toks.push(k.tok()); return; }
    var typing = calc.toks.length > 0;
    switch (k.act) {
      case 'left': case 'right':
        if (!typing) calc.x = xAt(Math.max(0, Math.min(XSPAN, colOf(calc.x) + (k.act === 'left' ? -1 : 1))));
        return;
      case 'up': case 'down':
        if (!typing) calc.fn = (calc.fn + (k.act === 'down' ? 1 : -1) + fns.length) % fns.length;
        return;
      case 'del':   calc.toks.pop(); return;
      case 'clear': if (typing) calc.toks = []; else leaveCalc(); return;
      case 'enter': calcEnter(fns); return;
    }
  }

  /* --- keys ------------------------------------------------------------- */
  function step(dc, dr, fast) {
    var n = fast ? 5 : 1;
    if (mode === 'trace') {
      if (dc) {
        trace.c += dc * n;
        if (trace.c > XSPAN) {
          var over = trace.c - XSPAN; trace.c = XSPAN;
          applyWindow({ Xmin: S.win.Xmin + over * dX(), Xmax: S.win.Xmax + over * dX() });
        } else if (trace.c < 0) {
          var under = -trace.c; trace.c = 0;
          applyWindow({ Xmin: S.win.Xmin - under * dX(), Xmax: S.win.Xmax - under * dX() });
        }
      }
      if (dr) {
        var fns = activeFns();
        if (fns.length) trace.fn = (trace.fn + (dr > 0 ? 1 : -1) + fns.length) % fns.length;
      }
      return;
    }
    cur.c = Math.max(0, Math.min(XSPAN, cur.c + dc * n));
    cur.r = Math.max(0, Math.min(YSPAN, cur.r + dr * n));
  }

  function key(k) {
    if (mode === 'calc') { calcKey(k); return; }
    switch (k.act) {
      case 'up':    step(0, -1); return;
      case 'down':  step(0, 1);  return;
      case 'left':  step(-1, 0); return;
      case 'right': step(1, 0);  return;
      case 'enter':
        if (mode === 'zoomcenter') {
          var cx = xAt(cur.c), cy = yAt(cur.r);
          if (pendingZoom === 'in')  zoomAbout(cx, cy, 1 / S.zoomFactors.x, 1 / S.zoomFactors.y);
          if (pendingZoom === 'out') zoomAbout(cx, cy, S.zoomFactors.x, S.zoomFactors.y);
          if (pendingZoom === 'int') {
            applyWindow({ Xmin: Math.round(cx) - 47, Xmax: Math.round(cx) + 47, Xscl: 10,
                          Ymin: Math.round(cy) - 31, Ymax: Math.round(cy) + 31, Yscl: 10 });
          }
          pendingZoom = null; mode = 'free';
          cur.c = 47; cur.r = 31;
          return;
        }
        if (mode === 'box1') { box.c = cur.c; box.r = cur.r; mode = 'box2'; return; }
        if (mode === 'box2') {
          var xa = xAt(Math.min(box.c, cur.c)), xb = xAt(Math.max(box.c, cur.c));
          var ya = yAt(Math.max(box.r, cur.r)), yb = yAt(Math.min(box.r, cur.r));
          if (xb - xa > 1e-9 && yb - ya > 1e-9) applyWindow({ Xmin: xa, Xmax: xb, Ymin: ya, Ymax: yb });
          mode = 'free';
          return;
        }
        return;
      case 'clear':
        if (mode !== 'free') { mode = 'free'; pendingZoom = null; return; }
        TI.App.setScreen('home');
        return;
    }
  }

  function enter(opts) {
    if (mode === 'calc') { mode = 'free'; calc = null; }
    if (opts && opts.trace) {
      mode = 'trace';
      var fns = activeFns();
      if (!fns.length) { mode = 'free'; return; }
      if (trace.fn >= fns.length) trace.fn = 0;
      if (trace.c < 0 || trace.c > XSPAN) trace.c = 47;
    } else if (mode === 'trace') {
      mode = 'free';
    }
  }

  /* Mobile gestures: drag to pan, pinch to zoom. */
  function pan(dc, dr) {
    var w = S.win;
    var ox = dc * dX(), oy = dr * dY();
    S.win.Xmin = w.Xmin - ox; S.win.Xmax = w.Xmax - ox;
    S.win.Ymin = w.Ymin + oy; S.win.Ymax = w.Ymax + oy;
  }
  function pinch(cx, cy, scale) {
    var x = xAt(cx), y = yAt(cy);
    var hw = (S.win.Xmax - S.win.Xmin) / 2 / scale;
    var hh = (S.win.Ymax - S.win.Ymin) / 2 / scale;
    var fx = (x - (S.win.Xmin + S.win.Xmax) / 2);
    var fy = (y - (S.win.Ymin + S.win.Ymax) / 2);
    var ncx = x - fx / scale, ncy = y - fy / scale;
    S.win.Xmin = ncx - hw; S.win.Xmax = ncx + hw;
    S.win.Ymin = ncy - hh; S.win.Ymax = ncy + hh;
  }

  TI.Screens = TI.Screens || {};
  TI.Screens.graph = {
    id: 'graph', draw: draw, key: key, enter: enter,
    openZoomMenu: openZoomMenu, openCalcMenu: openCalcMenu,
    pan: pan, pinch: pinch,
    settle: function () { saveZoom(); S.save(); },
    isTracing: function () { return mode === 'trace'; },
    reset: function () {
      mode = 'free'; pendingZoom = null; cacheKey = null; calc = null;
      cur.c = 47; cur.r = 31; trace.fn = 0; trace.c = 47;
    }
  };
  TI.Graph = { xAt: xAt, yAt: yAt, colOf: colOf, rowOf: rowOf, dX: dX, dY: dY, activeFns: activeFns, evalAt: evalAt };
})(window.TI = window.TI || {});
