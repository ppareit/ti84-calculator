/* ---------------------------------------------------------------------------
 * embed.js — lets a host page drive the calculator when it is loaded in an
 * iframe with ?embed.
 *
 * The host sends messages to the frame:
 *
 *   { ti84: 'reset' }                          factory-fresh calculator
 *   { ti84: 'reset', keys: 'yeq n1 graph' }    the same, then these keys at
 *                                              once and unseen: a known state
 *                                              to start a sequence from
 *   { ti84: 'press', keys: 'yeq n1:120 enter', press these keys, in order,
 *     delay: 400, id: 7 }                      waiting `delay` ms after each
 *                                              (default 400); a key written
 *                                              id:ms waits ms instead, but
 *                                              never longer than `delay`, so
 *                                              delay 0 presses them at once
 *   { ti84: 'stop' }                           abandon a running sequence
 *   { ti84: 'finish' }                         press the rest of the running
 *                                              sequence at once (then 'done')
 *   { ti84: 'theme', theme: 'light' }          the white livery; 'dark' is the
 *                                              charcoal one (?theme=light in
 *                                              the URL starts in it)
 *
 * and the frame answers to its parent:
 *
 *   { ti84: 'ready' }                          booted, messages are accepted
 *   { ti84: 'touched' }                        the user pressed or dragged
 *                                              something; sent once per reset,
 *                                              so the host knows the state is
 *                                              no longer the one it scripted
 *   { ti84: 'done', id: 7 }                    that sequence has finished
 *
 * Keys are the ids of js/keypad.js (yeq, window, second, n0..n9, enter, ...).
 * Nothing is persisted in this mode (see state.js).
 * ------------------------------------------------------------------------- */
(function (TI) {
  'use strict';

  if (!TI.State.embed || window.parent === window) return;

  var App = TI.App, timer = null, run = null;

  function stop() {
    if (timer) { clearTimeout(timer); timer = null; }
    run = null;
  }

  function end() {
    var id = run.id;
    run = null;
    window.parent.postMessage({ ti84: 'done', id: id }, '*');
  }

  function play(keys, delay, id) {
    stop();
    run = { queue: String(keys).split(/\s+/).filter(Boolean), delay: delay, id: id };
    (function next() {
      timer = null;
      if (!run) return;
      if (!run.queue.length) { end(); return; }
      var token = run.queue.shift().split(':');
      App.pressVisible(token[0]);
      var eigen = token.length > 1 ? Number(token[1]) : run.delay;
      timer = setTimeout(next, Math.min(run.delay, eigen >= 0 ? eigen : run.delay));
    })();
  }

  /* Press whatever is left of the running sequence at once. */
  function finish() {
    if (!run) return;
    if (timer) { clearTimeout(timer); timer = null; }
    while (run.queue.length) App.pressVisible(run.queue.shift().split(':')[0]);
    end();
  }

  /* Only events from the user are trusted; the host's key presses go
     straight to App.press and never reach the DOM as events. */
  var touched = false;
  function touch(e) {
    if (!e.isTrusted || touched) return;
    touched = true;
    window.parent.postMessage({ ti84: 'touched' }, '*');
  }
  document.addEventListener('pointerdown', touch, true);
  document.addEventListener('keydown', touch, true);

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== window.parent || !m || typeof m !== 'object') return;
    if (m.ti84 === 'reset') {
      stop(); App.factoryReset(); touched = false;
      String(m.keys || '').split(/\s+/).filter(Boolean).forEach(function (key) {
        App.press(key.split(':')[0]);
      });
    }
    else if (m.ti84 === 'stop') stop();
    else if (m.ti84 === 'finish') finish();
    else if (m.ti84 === 'theme') App.setTheme(m.theme);
    else if (m.ti84 === 'press') {
      var d = Number(m.delay);
      play(m.keys, d >= 0 ? d : 400, m.id);
    }
  });

  /* app.js boots on DOMContentLoaded and registered first, so by the time
     this listener runs the keypad exists. */
  function ready() { window.parent.postMessage({ ti84: 'ready' }, '*'); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})(window.TI = window.TI || {});
