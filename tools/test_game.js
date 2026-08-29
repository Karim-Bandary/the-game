/* Headless smoke test for the built game.
 *
 * Karim cannot test every path and I cannot see the screen. This drives the
 * real bundle through a fake DOM — setup, choices, starting the game, five
 * years of months, every tab — and asserts the rules actually happened.
 * Any bug that shows up once should become an assertion here.
 *
 * Run: node tools/test_game.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8');

const failures = [];
function ok(cond, msg) { if (!cond) failures.push(msg); }

/* A DOM small enough to be honest about what it fakes: the game only ever
   reads/writes innerHTML, textContent, className and classList. */
const store = {}, cls = {};
const nodes = {};
function node(id) {
  return nodes[id] || (nodes[id] = {
    get innerHTML() { return store[id] || ''; }, set innerHTML(v) { store[id] = v; },
    get textContent() { return store[id] || ''; }, set textContent(v) { store[id] = v; },
    get className() { return cls[id] || ''; }, set className(v) { cls[id] = v; },
    classList: {
      add(c) { cls[id] = (cls[id] || '') + ' ' + c; },
      remove(c) { cls[id] = (cls[id] || '').split(' ').filter(x => x !== c).join(' '); },
      contains(c) { return (cls[id] || '').split(' ').includes(c); }
    },
    dataset: {}, value: ''
  });
}
global.document = { getElementById: node, addEventListener() {} };
global.setInterval = () => 1;
global.clearInterval = () => {};

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
eval(scripts.join('\n'));

/* ---------------------------------------------------------------- setup */
ok(/اسم الدولة/.test(store.setupBody), 'شاشة الأسماء مش بتظهر');
setupState.step = 1; drawSetup();
ok(/نظام الحكم/.test(store.setupBody), 'شاشة نظام الحكم مش بتظهر');
SETUP.government_types.forEach(g => ok(store.setupBody.includes(g.nm), 'نظام الحكم «' + g.nm + '» ناقص من الشاشة'));
setupState.step = 2; drawSetup();
SETUP.society_types.forEach(s => ok(store.setupBody.includes(s.nm), 'طبيعة المجتمع «' + s.nm + '» ناقصة من الشاشة'));

/* Every combination must start the game with the modifiers actually applied.
   A modifier that silently does nothing is the exact bug this catches. */
let combos = 0;
for (const g of SETUP.government_types) {
  for (const c of SETUP.society_types) {
    setupState.gov = g; setupState.soc = c;
    setupState.country = 'تجربة'; setupState.ruler = 'حاكم';
    startGame();
    combos++;
    for (const key of Object.keys(Object.assign({}, g.mods, c.mods))) {
      const expected = SETUP.base_start[key] + (g.mods[key] || 0) + (c.mods[key] || 0);
      const actual = key === 'ap' ? S.apMax : S[key];
      const clamped = Math.max(0, Math.min(100, expected));
      ok(actual === expected || actual === clamped,
        `«${g.nm} + ${c.nm}»: ${key} طلع ${actual} والمفروض ${expected}`);
    }
    ok(S.country === 'تجربة' && S.ruler === 'حاكم', 'الأسماء مش بتتحفظ في اللعبة');
  }
}

/* ------------------------------------------------------------ the clock */
setupState.gov = SETUP.government_types[1];
setupState.soc = SETUP.society_types[0];
setupState.country = 'جمهورية النهر'; setupState.ruler = 'كريم';
startGame();
const startAp = S.apMax;
S.ap = 0;                                   // spend everything
const priceBefore = S.priceIndex;
for (let i = 0; i < 60; i++) step();
ok(S.totalMonths === 60, 'عداد الشهور غلط: ' + S.totalMonths);
ok(S.year === 6 && S.month === 1, 'لفة السنة غلط: سنة ' + S.year + ' شهر ' + S.month);
ok(S.ap === startAp, 'طاقة القرارات ما اتجددتش مع الشهر الجديد');
ok(S.priceIndex > priceBefore, 'مؤشر الأسعار ما تحركش مع التضخم');
ok(S.log.length >= 5, 'السجل فاضي بعد ٥ سنين');

/* Five years of 6% inflation should compound to roughly ×1.34 — a wrong
   compounding direction or period would show up here immediately. */
const expectedIndex = Math.pow(1 + (BALANCE.start.inflation / 100) / 12, 60);
ok(Math.abs(S.priceIndex - expectedIndex) < 0.01,
  `مؤشر الأسعار ${S.priceIndex.toFixed(3)} والمفروض ${expectedIndex.toFixed(3)}`);

/* -------------------------------------------------------------- screens */
for (const t of ['pres', 'treas', 'serv', 'govt', 'pol']) {
  tab = t; drawView();
  ok((store.view || '').length > 150, 'تاب ' + t + ' بيرسم فاضي');
}
drawTop();
ok(/كريم/.test(store.who), 'اسم الحاكم مش ظاهر في الشريط العلوي');
ok(/الشهر/.test(store.date), 'التاريخ مش ظاهر في الشريط العلوي');
ok((store.meters || '').split('mtr').length - 1 === 4, 'الشريط العلوي مش فيه ٤ مؤشرات');

/* Every number the player reads must be in Arabic-Indic digits. A stray
   toFixed() or a plain number lands on screen in Latin digits next to Arabic
   ones — small, ugly, and the kind of thing nobody notices in a diff. */
function visibleText(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');   // drop tags and their attributes
}
for (const t of ['pres', 'treas', 'serv', 'govt', 'pol']) {
  tab = t; drawView();
  const latin = visibleText(store.view).match(/[0-9]/g);
  ok(!latin, 'تاب ' + t + ' فيه أرقام إنجليزي: ' + (latin || []).join(''));
}
drawTop();
['date', 'meters', 'who'].forEach(function (id) {
  const latin = visibleText(store[id]).match(/[0-9]/g);
  ok(!latin, 'الشريط العلوي (' + id + ') فيه أرقام إنجليزي: ' + (latin || []).join(''));
});

/* --------------------------------------------------------------- output */
if (failures.length) {
  console.log(`✗ اللعبة فيها ${failures.length} مشكلة:\n`);
  failures.forEach(f => console.log('   • ' + f));
  process.exit(1);
}
console.log(`✓ اللعبة عدّت الاختبار (${combos} تركيبة حكم/مجتمع · ٦٠ شهر · ٥ تابات).`);
