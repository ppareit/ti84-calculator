/* ---------------------------------------------------------------------------
 * evaluator.js — walks the AST and produces a number, honouring MODE settings.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var err = TI.Parser.err;

  function toRad(ctx, x) { return ctx.degree ? x * Math.PI / 180 : x; }
  function fromRad(ctx, x) { return ctx.degree ? x * 180 / Math.PI : x; }

  function checkFinite(v) {
    if (typeof v !== 'number' || v !== v) throw err('DOMAIN');
    if (!isFinite(v)) throw err('OVERFLOW');
    return v;
  }

  function factorial(n) {
    /* TI accepts non-negative integers and halves up to 69. */
    if (n < 0 || Math.abs(n * 2 - Math.round(n * 2)) > 1e-9) throw err('DOMAIN');
    if (n > 69) throw err('OVERFLOW');
    if (Math.abs(n - Math.round(n)) > 1e-9) {           /* half-integer: use Γ */
      var half = Math.round(n - 0.5);
      var r = Math.sqrt(Math.PI);
      for (var k = 1; k <= half; k++) r *= (k + 0.5);
      return r;
    }
    var out = 1;
    for (var i = 2; i <= Math.round(n); i++) out *= i;
    return out;
  }

  function nPr(n, r) {
    if (n < 0 || r < 0 || n !== Math.round(n) || r !== Math.round(r) || r > n) throw err('DOMAIN');
    var out = 1;
    for (var i = 0; i < r; i++) out *= (n - i);
    return out;
  }
  function nCr(n, r) {
    if (n < 0 || r < 0 || n !== Math.round(n) || r !== Math.round(r) || r > n) throw err('DOMAIN');
    r = Math.min(r, n - r);
    var out = 1;
    for (var i = 1; i <= r; i++) out = out * (n - r + i) / i;
    return Math.round(out);
  }

  function gcd2(a, b) {
    a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
    while (b) { var t = b; b = a % b; a = t; }
    return a;
  }

  /* --- functions taking already-evaluated arguments --------------------- */
  var FN = {
    sin:  function (c, a) { return Math.sin(toRad(c, a[0])); },
    cos:  function (c, a) { return Math.cos(toRad(c, a[0])); },
    tan:  function (c, a) { return Math.tan(toRad(c, a[0])); },
    asin: function (c, a) { if (a[0] < -1 || a[0] > 1) throw err('DOMAIN'); return fromRad(c, Math.asin(a[0])); },
    acos: function (c, a) { if (a[0] < -1 || a[0] > 1) throw err('DOMAIN'); return fromRad(c, Math.acos(a[0])); },
    atan: function (c, a) { return fromRad(c, Math.atan(a[0])); },
    sinh: function (c, a) { return Math.sinh(a[0]); },
    cosh: function (c, a) { return Math.cosh(a[0]); },
    tanh: function (c, a) { return Math.tanh(a[0]); },
    log:  function (c, a) { if (a[0] === 0) throw err('DIVIDE BY 0'); if (a[0] < 0) throw err('NONREAL ANS'); return Math.log10(a[0]); },
    ln:   function (c, a) { if (a[0] === 0) throw err('DIVIDE BY 0'); if (a[0] < 0) throw err('NONREAL ANS'); return Math.log(a[0]); },
    exp:  function (c, a) { return Math.exp(a[0]); },
    tenpow: function (c, a) { return Math.pow(10, a[0]); },
    sqrt: function (c, a) { if (a[0] < 0) throw err('NONREAL ANS'); return Math.sqrt(a[0]); },
    cbrt: function (c, a) { return Math.cbrt(a[0]); },
    abs:  function (c, a) { return Math.abs(a[0]); },
    int:  function (c, a) { return Math.floor(a[0]); },
    iPart: function (c, a) { return Math.trunc(a[0]); },
    fPart: function (c, a) { return a[0] - Math.trunc(a[0]); },
    round: function (c, a) {
      var d = a.length > 1 ? Math.round(a[1]) : 9;
      if (d < 0 || d > 9) throw err('DOMAIN');
      var m = Math.pow(10, d);
      return Math.round(a[0] * m) / m;
    },
    min: function (c, a) { if (a.length < 2) throw err('SYNTAX'); return Math.min(a[0], a[1]); },
    max: function (c, a) { if (a.length < 2) throw err('SYNTAX'); return Math.max(a[0], a[1]); },
    gcd: function (c, a) { if (a.length < 2) throw err('SYNTAX'); return gcd2(a[0], a[1]); },
    lcm: function (c, a) {
      if (a.length < 2) throw err('SYNTAX');
      var g = gcd2(a[0], a[1]);
      return g === 0 ? 0 : Math.abs(Math.round(a[0]) * Math.round(a[1])) / g;
    },
    not: function (c, a) { return a[0] === 0 ? 1 : 0; },
    rand: function () { return Math.random(); },
    randInt: function (c, a) {
      if (a.length < 2) throw err('SYNTAX');
      var lo = Math.round(a[0]), hi = Math.round(a[1]);
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    }
  };
  var ARITY1 = ['sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','log','ln',
                'exp','tenpow','sqrt','cbrt','abs','int','iPart','fPart','not'];

  /* --- functions that need the unevaluated argument --------------------- */
  var LAZY = {
    /* nDeriv(expr, var, value [, ε]) — symmetric difference, TI default ε=1e-3 */
    nDeriv: function (ctx, args, ev) {
      if (args.length < 3) throw err('SYNTAX');
      var name = varName(args[1]);
      var x = ev(args[2]);
      var h = args.length > 3 ? ev(args[3]) : 1e-3;
      return withVar(ctx, name, x, function () {
        var f = function (t) { return withVar(ctx, name, t, function () { return ev(args[0]); }); };
        return (f(x + h) - f(x - h)) / (2 * h);
      });
    },
    /* fnInt(expr, var, lower, upper) — adaptive Simpson */
    fnInt: function (ctx, args, ev) {
      if (args.length < 4) throw err('SYNTAX');
      var name = varName(args[1]);
      var lo = ev(args[2]), hi = ev(args[3]);
      var f = function (t) { return withVar(ctx, name, t, function () { return ev(args[0]); }); };
      return simpson(f, lo, hi, 1e-9, 20);
    },
    fMin: function (ctx, args, ev) { return extremum(ctx, args, ev, -1); },
    fMax: function (ctx, args, ev) { return extremum(ctx, args, ev, 1); }
  };

  function varName(node) {
    if (!node || node.k !== 'var') throw err('SYNTAX');
    return node.n;
  }
  function withVar(ctx, name, value, fn) {
    var prev = ctx.vars[name];
    ctx.vars[name] = value;
    try { return fn(); } finally { ctx.vars[name] = prev; }
  }
  function simpson(f, a, b, eps, depth) {
    function s(a, b, fa, fm, fb) { return (b - a) / 6 * (fa + 4 * fm + fb); }
    function rec(a, b, fa, fm, fb, whole, d) {
      var m = (a + b) / 2;
      var lm = (a + m) / 2, rm = (m + b) / 2;
      var flm = f(lm), frm = f(rm);
      var left = s(a, m, fa, flm, fm), right = s(m, b, fm, frm, fb);
      if (d <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
      return rec(a, m, fa, flm, fm, left, d - 1) + rec(m, b, fm, frm, fb, right, d - 1);
    }
    var fa = f(a), fb = f(b), fm = f((a + b) / 2);
    return rec(a, b, fa, fm, fb, s(a, b, fa, fm, fb), depth);
  }
  /* golden-section search; sign = -1 finds the minimiser, +1 the maximiser */
  function extremum(ctx, args, ev, sign) {
    if (args.length < 4) throw err('SYNTAX');
    var name = varName(args[1]);
    var a = ev(args[2]), b = ev(args[3]);
    var lo = Math.min(a, b), hi = Math.max(a, b);
    var f = function (t) { return sign * withVar(ctx, name, t, function () { return ev(args[0]); }); };

    /* Golden section brackets the optimum reliably but stalls around sqrt(eps)
       because f is flat there, so finish with parabolic interpolation. */
    var gr = (Math.sqrt(5) - 1) / 2;
    var c = b - gr * (b - a), d = a + gr * (b - a);
    var fc = f(c), fd = f(d);
    for (var i = 0; i < 200 && Math.abs(b - a) > 1e-7; i++) {
      if (fc > fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); }
      else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); }
    }
    var span = hi - lo;
    var x = (a + b) / 2;
    for (var j = 0; j < 40; j++) {
      var h = Math.max(Math.abs(x) * 1e-5, 1e-6);
      var f0 = f(x - h), f1 = f(x), f2 = f(x + h);
      var den = f0 - 2 * f1 + f2;
      if (!(den < 0)) break;                       /* not concave here */
      var step = -h * (f2 - f0) / (2 * den);
      if (!isFinite(step) || Math.abs(step) > span) break;
      var nx = x + step;
      if (nx < lo || nx > hi) break;
      x = nx;
      if (Math.abs(step) < 1e-13 * Math.max(1, Math.abs(x))) break;
    }
    return x;
  }

  /* --- ▸Frac ------------------------------------------------------------ */
  /* Continued-fraction expansion. TI gives up and shows the decimal when the
     denominator would run past four digits. */
  function toFraction(x) {
    if (!isFinite(x)) return null;
    if (Math.abs(x - Math.round(x)) < 1e-11) return { n: Math.round(x), d: 1 };
    var sign = x < 0 ? -1 : 1, v = Math.abs(x);
    var h0 = 0, h1 = 1, k0 = 1, k1 = 0, t = v;
    for (var i = 0; i < 40; i++) {
      var a = Math.floor(t);
      var h2 = a * h1 + h0, k2 = a * k1 + k0;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (k1 > 9999) return null;
      if (Math.abs(v - h1 / k1) < 1e-10 * Math.max(1, v)) return { n: sign * h1, d: k1 };
      var frac = t - a;
      if (frac < 1e-12) break;
      t = 1 / frac;
    }
    return null;
  }

  /* --- the evaluator ---------------------------------------------------- */

  function evaluate(ast, ctx) {
    ctx.depth = 0;
    ctx.frac = false;
    var v = ev(ast, ctx);
    return { value: v, frac: ctx.frac };
  }

  function ev(n, ctx) {
    switch (n.k) {
      case 'num': return n.v;
      case 'ans': return ctx.ans;
      case 'const':
        if (n.n === 'pi') return Math.PI;
        if (n.n === 'rand') return Math.random();
        return Math.E;
      case 'var': {
        var v = ctx.vars[n.n];
        return typeof v === 'number' ? v : 0;   /* unset variables are 0 */
      }
      case 'yvar': {
        var toks = ctx.yGet ? ctx.yGet(n.n) : null;
        if (!toks || !toks.length) throw err('UNDEFINED', n.pos);
        if (ctx.depth > 12) throw err('MEMORY', n.pos);
        ctx.depth++;
        try { return ev(TI.Parser.parse(toks), ctx); } finally { ctx.depth--; }
      }
      case 'neg': return -ev(n.a, ctx);
      case 'post': {
        var a = ev(n.a, ctx);
        switch (n.o) {
          case 'sq':   return checkFinite(a * a);
          case 'cube': return checkFinite(a * a * a);
          case 'inv':  if (a === 0) throw err('DIVIDE BY 0'); return 1 / a;
          case 'fact': return factorial(a);
          case 'deg':  return ctx.degree ? a : a * Math.PI / 180;
        }
        throw err('SYNTAX');
      }
      case 'conv':
        if (n.f === 'frac') { var val = ev(n.a, ctx); ctx.frac = true; return val; }
        { var v2 = ev(n.a, ctx); ctx.frac = false; return v2; }
      case 'bin': {
        var A = ev(n.a, ctx), B = ev(n.b, ctx);
        switch (n.o) {
          case '+': return checkFinite(A + B);
          case '-': return checkFinite(A - B);
          case '*': return checkFinite(A * B);
          case '/': if (B === 0) throw err('DIVIDE BY 0'); return checkFinite(A / B);
          case '^': {
            if (A === 0 && B < 0) throw err('DIVIDE BY 0');
            /* a negative base is only real for integer exponents */
            if (A < 0 && Math.abs(B - Math.round(B)) > 1e-12) throw err('NONREAL ANS');
            return checkFinite(Math.pow(A, B));
          }
          case 'xroot': {
            if (A === 0) throw err('DIVIDE BY 0');
            if (B < 0) {
              if (Math.abs(A - Math.round(A)) < 1e-12 && Math.round(A) % 2 !== 0) return -Math.pow(-B, 1 / A);
              throw err('NONREAL ANS');
            }
            return checkFinite(Math.pow(B, 1 / A));
          }
          case 'nPr': return nPr(A, B);
          case 'nCr': return nCr(A, B);
          case '=':  return A === B ? 1 : 0;
          case '≠':  return A !== B ? 1 : 0;
          case '>':  return A > B ? 1 : 0;
          case '≥':  return A >= B ? 1 : 0;
          case '<':  return A < B ? 1 : 0;
          case '≤':  return A <= B ? 1 : 0;
          case 'and': return (A !== 0 && B !== 0) ? 1 : 0;
          case 'or':  return (A !== 0 || B !== 0) ? 1 : 0;
          case 'xor': return ((A !== 0) !== (B !== 0)) ? 1 : 0;
        }
        throw err('SYNTAX');
      }
      case 'call': {
        if (LAZY[n.f]) return checkFinite(LAZY[n.f](ctx, n.args, function (node) { return ev(node, ctx); }));
        var fn = FN[n.f];
        if (!fn) throw err('SYNTAX', n.pos);
        var args = n.args.map(function (x) { return ev(x, ctx); });
        if (ARITY1.indexOf(n.f) >= 0 && args.length !== 1) throw err('SYNTAX', n.pos);
        if (!args.length && n.f !== 'rand') throw err('SYNTAX', n.pos);
        var r = fn(ctx, args);
        if (r !== r) throw err('DOMAIN', n.pos);
        return r;
      }
      case 'store': {
        var val = ev(n.a, ctx);
        if (n.target.t === 'var') ctx.vars[n.target.n] = val;
        else throw err('SYNTAX');
        return val;
      }
    }
    throw err('SYNTAX');
  }

  TI.Eval = {
    evaluate: evaluate,
    toFraction: toFraction,
    factorial: factorial,
    FN: FN
  };
})(window.TI = window.TI || {});
