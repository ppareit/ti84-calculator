/* Node harness for 2nd TRACE (CALC): boots the whole calculator against a
   stand-in document, presses keys, and reads back what the screen draws. */
var fs = require('fs'), path = require('path'), vm = require('vm');
var root = path.join(__dirname, '..');

var win = {};
var doc = {
  readyState: 'loading',          /* so app.js does not boot itself */
  addEventListener: function () {},
  getElementById: function () { return null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  body: { classList: { contains: function () { return false; }, add: function () {} } }
};
Object.assign(win, { window: win, document: doc, console: console, setTimeout: setTimeout,
  clearTimeout: clearTimeout, setInterval: function () { return 0; }, clearInterval: function () {},
  navigator: {}, Uint8Array: Uint8Array });
var context = vm.createContext(win);
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html.replace(/<script src="(js\/[^"]+)"><\/script>/g, function (_, src) {
  vm.runInContext(fs.readFileSync(path.join(root, src), 'utf8'), context, { filename: src });
});
var TI = context.TI;
TI.Prgm.setHost(TI.Screens.home);

/* every string the screen draws, top to bottom */
var drawn = null;
['text', 'textPx'].forEach(function (name) {
  var real = TI.LCD[name];
  TI.LCD[name] = function (a, b, str) {
    if (drawn) drawn.push({ y: name === 'text' ? b * 8 : b, x: name === 'text' ? a * 6 : a, s: String(str) });
    return real.apply(this, arguments);
  };
});
function screen() {
  drawn = [];
  TI.LCD.clear();
  if (TI.Menu.active()) TI.Menu.draw(); else TI.Screens[TI.App.screen].draw(false);
  var out = drawn.sort(function (p, q) { return p.y - q.y || p.x - q.x; }).map(function (d) { return d.s; });
  drawn = null;
  return out.join('|');
}
function press(keys) { keys.split(/\s+/).filter(Boolean).forEach(function (id) { TI.App.press(id); }); }

var pass = 0, fails = [];
function check(name, keys, expect) {
  press(keys);
  var got = screen();
  if (got === expect) pass++;
  else fails.push('  ' + name + '\n      expected ' + expect + '\n      got      ' + got);
}

/* Y1=X²-2 and Y2=X on the standard window */
TI.App.factoryReset();
press('yeq xtn sq sub n2 enter xtn graph');

check('the menu lists the seven operations', 'second trace',
  'CALCULATE|▸|1:value|2:zero|3:minimum|4:maximum|5:intersect|6:dy/dx|7:∫f(x)dx');
check('zero asks for the left bound', 'n2', 'Y1=X²-2|Left Bound?|X=0|Y=⁻2');
check('a typed bound shows after X=', 'n1', 'Y1=X²-2|Left Bound?|X=1');
check('ENTER takes it and asks for the right bound', 'enter', 'Y1=X²-2|Right Bound?|X=1|Y=⁻1');
check('then for a guess', 'n2 enter', 'Y1=X²-2|Guess?|X=2|Y=2');
check('zero between the bounds', 'enter', 'Y1=X²-2|Zero|X=1.41421356|Y=0');
check('the other zero', 'second trace n2 negate n2 enter negate n1 enter enter', 'Y1=X²-2|Zero|X=⁻1.4142136|Y=0');
check('minimum lands on the round value', 'second trace n3 negate n1 enter n1 enter enter', 'Y1=X²-2|Minimum|X=0|Y=⁻2');
check('value', 'second trace n1 n3 enter', 'Y1=X²-2|X=3|Y=7');
check('dy/dx at the cursor', 'second trace n6 n3 enter', 'Y1=X²-2|dy/dx=6');
check('integral between two limits', 'second trace n7 n0 enter n3 enter', 'Y1=X²-2|∫f(x)dx=3');
check('intersection nearest the guess', 'second trace n5 enter enter n3 enter', 'Y1=X²-2|Intersection|X=2|Y=2');
check('and the other one', 'second trace n5 enter enter negate n2 enter', 'Y1=X²-2|Intersection|X=⁻1|Y=⁻1');
check('no sign change between the bounds', 'second trace n2 n3 enter n4 enter enter', 'ERR:NO SIGN CHNG|▸|1:Quit');
check('right bound left of the left bound', 'enter second trace n2 n3 enter n1 enter', 'ERR:BOUND|▸|1:Quit');
check('CLEAR leaves the prompt for the free cursor', 'enter second trace n2 clear', 'X=0|Y=0');

console.log('\n  ' + pass + ' passed, ' + fails.length + ' failed\n');
if (fails.length) { console.log(fails.join('\n\n')); process.exit(1); }
