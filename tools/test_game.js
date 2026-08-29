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
global.document = { getElementById: node, addEventListener() {}, querySelector: () => null };
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
      const expected = (g.mods[key] || 0) + (c.mods[key] || 0);
      ok(S.mods[key] === expected,
        `«${g.nm} + ${c.nm}»: معامل ${key} اتطبق ${S.mods[key]} والمفروض ${expected}`);
    }
    // Values the world does not move on its own must land exactly.
    for (const key of ['competence', 'loyalty']) {
      const expected = SETUP.base_start[key] + (g.mods[key] || 0) + (c.mods[key] || 0);
      ok(S[key] === expected, `«${g.nm} + ${c.nm}»: ${key} طلع ${S[key]} والمفروض ${expected}`);
    }
    ok(S.apMax === SETUP.base_start.ap + (g.mods.ap || 0) + (c.mods.ap || 0),
      `«${g.nm} + ${c.nm}»: طاقة القرارات غلط`);
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

/* Inflation decays toward its floor, so five years of compounding must land
   between the floor rate and the starting rate. Outside that band means the
   compounding is running the wrong way, or over the wrong period. */
const lo = Math.pow(1 + (BALANCE.inflation.floor / 100) / 12, 60);
const hi = Math.pow(1 + (BALANCE.start.inflation / 100) / 12, 60);
ok(S.priceIndex > lo && S.priceIndex < hi,
  `مؤشر الأسعار ${S.priceIndex.toFixed(3)} والمفروض بين ${lo.toFixed(3)} و${hi.toFixed(3)}`);

/* The choices must still bite after the world settles: a government that starts
   the country ten points angrier has to actually start it angrier. */
const mon = (function () { setupState.gov = SETUP.government_types[0]; setupState.soc = SETUP.society_types[0];
  setupState.country = 'أ'; setupState.ruler = 'أ'; startGame(); return S.approval; })();
const dic = (function () { setupState.gov = SETUP.government_types[2]; setupState.soc = SETUP.society_types[0];
  setupState.country = 'أ'; setupState.ruler = 'أ'; startGame(); return S.approval; })();
ok(dic < mon, `الديكتاتوري بدأ برضا ${dic.toFixed(0)} والملكي ${mon.toFixed(0)} — المفروض أقل`);

/* Put the reference game back: the screen checks below expect this one. */
setupState.gov = SETUP.government_types[1];
setupState.soc = SETUP.society_types[0];
setupState.country = 'جمهورية النهر'; setupState.ruler = 'كريم';
startGame();
for (let i = 0; i < 12; i++) step();

/* -------------------------------------------------------------- screens */
for (const t of ['pres', 'treas', 'serv', 'govt', 'pol']) {
  tab = t; drawView();
  ok((store.view || '').length > 150, 'تاب ' + t + ' بيرسم فاضي');
}
drawTop();
ok(/كريم/.test(store.who), 'اسم الحاكم مش ظاهر في الشريط العلوي');
ok(/الشهر/.test(store.date), 'التاريخ مش ظاهر في الشريط العلوي');
ok((store.meters || '').split('mtr').length - 1 === 4, 'الشريط العلوي مش فيه ٤ مؤشرات');

/* Every tab must have its own artwork and its own title band. A missing entry
   in ART would silently render a band with nothing in it. */
for (const t of ['pres', 'treas', 'serv', 'govt', 'pol']) {
  ok(typeof ART[t] === 'string' && ART[t].indexOf('<svg') === 0, 'تاب ' + t + ' مالوش رسمة');
  ok(/viewBox="0 0 1200 400"/.test(ART[t]), 'رسمة ' + t + ' مقاسها مش مظبوط');
  tab = t; drawView();
  ok(store.view.indexOf('class="band"') !== -1, 'تاب ' + t + ' مفيهوش شريط علوي');
  ok(store.view.indexOf('<svg') !== -1, 'شريط ' + t + ' مفيهوش الرسمة');
}
const artIds = Object.keys(ART);
ok(artIds.length === 5, 'عدد الرسومات ' + artIds.length + ' والمفروض ٥');
ok(/id="fade-down"/.test(ART_DEFS), 'التدرج المشترك ناقص — الرسومات هتبان بحافة حادة');

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

/* Any data-attribute the screens emit must be in the click handler's list, or
   that button silently does nothing. This exact bug shipped once. */
const emitted = new Set();
function collectAttrs(html) {
  for (const m of String(html || '').matchAll(/\s(data-[a-z]+)=/g)) emitted.add(m[1]);
}
setupState.step = 0; drawSetup(); collectAttrs(store.setupBody); collectAttrs(store.setupFoot);
setupState.step = 1; drawSetup(); collectAttrs(store.setupBody); collectAttrs(store.setupFoot);
setupState.gov = SETUP.government_types[1];
setupState.step = 2; drawSetup(); collectAttrs(store.setupBody);
setupState.soc = SETUP.society_types[0];
setupState.country = 'ب'; setupState.ruler = 'ب'; startGame();
for (const t of ['pres', 'treas', 'serv', 'govt', 'pol']) { tab = t; drawView(); collectAttrs(store.view); }
drawNav(); collectAttrs(store.nav);
openBuild('health'); collectAttrs(store.ovl);
const known = new Set(CLICKABLE.concat(['data-pct', 'data-i', 'data-buildsvc']));
for (const a of emitted) ok(known.has(a), 'الزرار بتاع ' + a + ' مش مسجّل في قايمة الضغطات');

/* Every event the engine can raise must produce a sentence. A silent event is a
   player waiting for something that already happened. */
const engineSrc = scripts.find(x => x.includes('function tickMonth'));
const emittedTypes = [...engineSrc.matchAll(/type:\s*'([a-z]+)'/g)].map(m => m[1]);
ok(emittedTypes.length >= 4, 'مش لاقي أنواع الأحداث في المحرك');
for (const type of new Set(emittedTypes)) {
  const sample = { type: type, year: 2, gov: GOV_IDS[0], svc: SERVICE_IDS[0], pct: 50, reason: 'riot' };
  const text = eventText(sample);
  ok(text && text.length > 5, 'الحدث «' + type + '» مالوش نص يظهر للاعب');
  ok(!/[0-9]/.test(text), 'نص الحدث «' + type + '» فيه أرقام إنجليزي: ' + text);
}

/* --------------------------------------------------------------- output */
if (failures.length) {
  console.log(`✗ اللعبة فيها ${failures.length} مشكلة:\n`);
  failures.forEach(f => console.log('   • ' + f));
  process.exit(1);
}
console.log(`✓ اللعبة عدّت الاختبار (${combos} تركيبة حكم/مجتمع · ٦٠ شهر · ٥ تابات).`);
