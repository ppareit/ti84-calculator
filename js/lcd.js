/* ---------------------------------------------------------------------------
 * lcd.js — the 96x64 monochrome framebuffer.
 *
 * Everything the calculator displays is drawn into this buffer as individual
 * pixels, exactly like the real hardware. That is what makes TRACE report
 * values like .2127659574: the graph really is 95 pixels wide.
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  var W = 96, H = 64;
  var buf = new Uint8Array(W * H);

  function clear() { buf.fill(0); }

  function px(x, y, on) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    buf[y * W + x] = (on === undefined || on) ? 1 : 0;
  }

  function get(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    return buf[y * W + x];
  }

  function xor(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    buf[y * W + x] ^= 1;
  }

  function hline(x0, x1, y, on) {
    if (x0 > x1) { var t = x0; x0 = x1; x1 = t; }
    for (var x = x0; x <= x1; x++) px(x, y, on);
  }

  function vline(x, y0, y1, on) {
    if (y0 > y1) { var t = y0; y0 = y1; y1 = t; }
    for (var y = y0; y <= y1; y++) px(x, y, on);
  }

  function rect(x, y, w, h, on) {
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) px(x + i, y + j, on);
  }

  function frame(x, y, w, h, on) {
    hline(x, x + w - 1, y, on);
    hline(x, x + w - 1, y + h - 1, on);
    vline(x, y, y + h - 1, on);
    vline(x + w - 1, y, y + h - 1, on);
  }

  /* Bresenham — TI connects plotted points with straight segments, including
     the near-vertical ones you see across an asymptote in Connected mode. */
  function line(x0, y0, x1, y1, on) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    var dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    var err = dx + dy;
    for (;;) {
      px(x0, y0, on);
      if (x0 === x1 && y0 === y1) break;
      var e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* --- text ---------------------------------------------------------- */

  function glyph(font, ch, x, y, invert) {
    var g = font.glyphs[ch];
    if (!g) g = font.glyphs['?'] || font.glyphs[' '];
    var w = font.w;
    for (var r = 0; r < font.h; r++) {
      var bits = g[r];
      for (var c = 0; c < w; c++) {
        var on = (bits >> (w - 1 - c)) & 1;
        px(x + c, y + r, invert ? !on : !!on);
      }
    }
    /* fill the cell gutters so an inverted glyph reads as a solid block */
    if (invert) {
      for (var gy = 0; gy < font.ch; gy++) for (var gx = w; gx < font.cw; gx++) px(x + gx, y + gy, 1);
      for (var gx2 = 0; gx2 < font.cw; gx2++) for (var gy2 = font.h; gy2 < font.ch; gy2++) px(x + gx2, y + gy2, 1);
    }
  }

  /* Draw a string at pixel coordinates. Returns the x just past the string. */
  function textPx(x, y, str, opts) {
    opts = opts || {};
    var font = opts.small ? TI.Font.small : TI.Font.large;
    var chars = Array.from(String(str));
    for (var i = 0; i < chars.length; i++) {
      glyph(font, chars[i], x, y, !!opts.invert);
      x += font.cw;
    }
    return x;
  }

  /* Draw a string on the 16x8 large-font character grid. */
  function text(col, row, str, opts) {
    return textPx(col * 6, row * 8, str, opts);
  }

  /* Invert one character cell — used for the block cursor and menu bars. */
  function invertCell(col, row) {
    for (var y = 0; y < 8; y++) for (var x = 0; x < 6; x++) xor(col * 6 + x, row * 8 + y);
  }

  function invertRect(x, y, w, h) {
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) xor(x + i, y + j);
  }

  /* --- presentation --------------------------------------------------- */

  /* Blit to a canvas whose backing store is exactly W*scale x H*scale so every
     LCD pixel lands on an integer block of device pixels. */
  function present(ctx, scale, colors) {
    ctx.fillStyle = colors.off;
    ctx.fillRect(0, 0, W * scale, H * scale);
    ctx.fillStyle = colors.on;
    for (var y = 0; y < H; y++) {
      var row = y * W;
      var x = 0;
      while (x < W) {
        if (buf[row + x]) {
          var start = x;
          while (x < W && buf[row + x]) x++;
          ctx.fillRect(start * scale, y * scale, (x - start) * scale, scale);
        } else x++;
      }
    }
  }

  TI.LCD = {
    W: W, H: H, buf: buf,
    clear: clear, px: px, get: get, xor: xor,
    hline: hline, vline: vline, rect: rect, frame: frame, line: line,
    text: text, textPx: textPx, invertCell: invertCell, invertRect: invertRect,
    present: present
  };
})(window.TI = window.TI || {});
