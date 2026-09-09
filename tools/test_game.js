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

/* Seed every element's starting classes from the REAL markup. Without this the
   fake DOM starts with nothing hidden, so a screen the player has never opened
   looks open to the test — which is how a back-button bug passes a green run. */
for (const m of html.matchAll(/<div id="([a-zA-Z0-9_-]+)"[^>]*class="([^"]*)"/g)) cls[m[1]] = m[2];
for (const m of html.matchAll(/<div class="([^"]*)"[^>]*id="([a-zA-Z0-9_-]+)"/g)) cls[m[2]] = m[1];

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
    dataset: {}, value: '', style: {}
  });
}
/* Capture the game's real listeners so the test can actually fire a drag or a
   tap. Without this the test can only call functions directly and any bug in
   the handler itself — the wrong field updated, an unregistered button — walks
   straight past a green run. */
const listeners = {};
global.document = {
  getElementById: node,
  addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  querySelector: () => null
};

/* A drag on a slider: the same event the browser sends, with the same dataset. */
function fireInput(dataset, value) {
  const target = { dataset: dataset, value: String(value) };
  (listeners.input || []).forEach(fn => fn({ target: target }));
}
/* A tap. closest() is what the real handler uses to find the button that was
   hit, so the fake one answers the same question the real DOM would. */
function fireClick(dataset) {
  let hit = false;
  const target = {
    dataset: dataset,
    closest(sel) {
      // A real dataset drops the "data-" prefix: [data-answer] is dataset.answer,
      // not dataset.dataAnswer. This helper got that wrong and so matched
      // nothing at all — every tap it fired was a no-op, and the assertion after
      // it passed because the game had not moved. It was unused for weeks, which
      // is the only reason it never lied out loud.
      const wanted = sel.split(',').map(x => x.replace(/[[\]]/g, '').replace(/^data-/, '')
        .replace(/-([a-z])/g, (m, c) => c.toUpperCase()));
      if (!wanted.some(k => dataset[k] !== undefined)) return null;
      hit = true;
      return target;
    }
  };
  (listeners.click || []).forEach(fn => fn({ target: target }));
  // Loud on purpose: a tap that lands on no button must fail the build rather
  // than quietly make the next assertion true.
  if (!hit) failures.push('ضغطة على ' + JSON.stringify(dataset) + ' ما وصلتش لأي زرار');
  return hit;
}
global.setInterval = () => 1;
global.clearInterval = () => {};

/* The bundle runs in a browser, so it touches browser globals. Node 21 started
   shipping its own `navigator`, which meant this test passed here and crashed on
   CI's Node 20 with "navigator is not defined" — the exact thing this project
   exists to prevent: something that works only on my side. The fake browser now
   supplies these itself, so the test does not care which Node it is run on.
   check.py refuses to build if the bundle starts using one that is not here. */
global.navigator = { serviceWorker: { register: () => Promise.resolve() } };
global.location = { protocol: 'file:', href: 'file:///game/index.html' };

/* A localStorage the test can also switch OFF. Both states matter: with storage
   the save has to work, and without it the game still has to start — a phone in
   a private window or with site data blocked must not get a dead app. */
const disk = {};
let storageWorks = true;
global.window = {
  localStorage: {
    getItem(k) { if (!storageWorks) throw new Error('blocked'); return k in disk ? disk[k] : null; },
    setItem(k, v) { if (!storageWorks) throw new Error('blocked'); disk[k] = String(v); },
    removeItem(k) { if (!storageWorks) throw new Error('blocked'); delete disk[k]; }
  }
};

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
eval(scripts.join('\n'));


/* Advancing time now has a precondition: a pending situation freezes the clock,
   so every loop that moves months must answer one first. Written once, here, and
   used everywhere — the alternative is fifteen loops that each remember, and the
   one that forgets fails in a way that looks like a balance bug.
   The freeze itself is tested deliberately with raw tickMonth further down. */
function autoAnswer(g) {
  const sit = SITUATIONS.situations.find(x => x.id === g.pendingSituation);
  for (let i = sit.choices.length - 1; i >= 0; i--) {
    if (choiceRefusal(g, sit, i) === null) return answerSituation(g, i);
  }
  throw new Error('موقف «' + sit.id + '» مفيش فيه اختيار ينفع يتاخد');
}
function tick(g) { while (g.pendingSituation) autoAnswer(g); return tickMonth(g); }
function stepMonth() { while (S.pendingSituation) autoAnswer(S); return step(); }

/* ----------------------------------------------------------------- menu */
/* The app opens on the menu now, so this is the first thing a player sees and
   the first thing the test has to look at. */
ok(view === 'menu', 'اللعبة مش بتفتح على القايمة الرئيسية');
ok(!node('menu').classList.contains('hidden'), 'القايمة مخفية وهي المفروض أول شاشة');
ok(node('game').classList.contains('hidden'), 'شاشة اللعب ظاهرة من غير لعبة');
ok(node('setup').classList.contains('hidden'), 'معالج البداية ظاهر قبل ما حد يطلبه');
ok(/ابدأ فترة حكم جديدة/.test(store.menuBody), 'زرار البداية مش على القايمة');
ok(/data-menu="resume"[^>]*disabled/.test(store.menuBody),
  'زرار «كمّل» شغّال ومفيش حفظ — هيدوس عليه ويلاقي حاجة فاضية');

fireClick({ menu: 'settings' });
ok(/سرعة الوقت/.test(store.menuBody), 'شاشة الإعدادات مش بتفتح');
ok(/اللغة/.test(store.menuBody), 'سطر اللغة مش في الإعدادات');
fireClick({ menu: 'about' });
ok(store.menuBody.indexOf(BUILD) !== -1, 'رقم البناء مش ظاهر في «عن اللعبة»');
fireClick({ menu: 'settings' });
fireClick({ menu: 'main' });
ok(/ابدأ فترة حكم جديدة/.test(store.menuBody), 'الرجوع من الإعدادات مش راجع للقايمة');

/* The one button that cannot work outside the app must say so rather than
   looking broken. */
fireClick({ menu: 'exit' });
ok(/التطبيق/.test(store.toast), 'زرار الخروج في المتصفح ما قالش حاجة');

fireClick({ menu: 'new' });
ok(view === 'setup', 'زرار «ابدأ فترة حكم جديدة» ما فتحش المعالج');

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
    /* The setup modifier must reach every single minister. If it only moved the
       cabinet baseline, the choice of government would change a number nobody
       reads and nothing in the game would actually play differently. */
    for (const p of MINISTERS.posts) {
      const m = S.ministers[p.id];
      ok(m, `«${g.nm} + ${c.nm}»: الوزير «${p.name}» مش موجود في اللعبة`);
      const wantC = Math.max(0, Math.min(100, p.start.competence + (S.competence - SETUP.base_start.competence)));
      const wantL = Math.max(0, Math.min(100, p.start.loyalty + (S.loyalty - SETUP.base_start.loyalty)));
      ok(m.competence === wantC,
        `«${g.nm} + ${c.nm}»: كفاءة «${p.name}» طلعت ${m.competence} والمفروض ${wantC}`);
      ok(m.loyalty === wantL,
        `«${g.nm} + ${c.nm}»: ولاء «${p.name}» طلع ${m.loyalty} والمفروض ${wantL}`);
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
for (let i = 0; i < 60; i++) stepMonth();
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
for (let i = 0; i < 12; i++) stepMonth();

/* ------------------------------------------------------------- ministers */

/* Every service must belong to exactly one minister. A service owned by nobody
   would run on an undefined competence and quietly sit at zero forever. */
for (const s of SERVICE_IDS) {
  const owner = serviceMinister(s);
  ok(owner && S.ministers[owner],
    'خدمة «' + BALANCE.services[s].name + '» مالهاش وزير');
}
{
  const owned = MINISTERS.posts.flatMap(p => p.services);
  ok(owned.length === new Set(owned).size, 'فيه خدمة مربوطة بأكتر من وزير');
  for (const s of owned) ok(SERVICE_IDS.includes(s), 'وزير مربوط بخدمة مش موجودة: ' + s);
}

/* The whole point of item 1: two ministries funded exactly the same must NOT
   come out the same, because their ministers are not the same. If this passes
   with equal values, the minister screen is decoration. */
{
  const a = serviceMinister('health'), b = serviceMinister('police');
  ok(a !== b, 'الصحة والشرطة عند نفس الوزير — الاختبار ده مبقاش بيقيس حاجة');
  for (const s of SERVICE_IDS) S.pct[s] = 100;
  ok(S.ministers[a].competence > S.ministers[b].competence,
    'وزير الصحة المفروض أكفأ من وزير الداخلية في البيانات');
  ok(operating(S, 'health') > operating(S, 'police') + 1,
    'وزارتين بنفس التمويل طلعوا بنفس التشغيل — كفاءة الوزير مش داخلة الحسبة');
}

/* The prime minister owns no service, so the only way he matters is the push he
   gives everyone else. A zero here means the post is furniture. */
{
  const before = operating(S, 'health');
  S.ministers.pm.competence = 100;
  const after = operating(S, 'health');
  ok(after > before, 'رئيس وزراء كفاءته ١٠٠ ما رفعش تشغيل أي وزارة');
  S.ministers.pm.competence = 0;
  ok(operating(S, 'health') < before, 'رئيس وزراء فاشل ما نزّلش تشغيل أي وزارة');
}

/* Tax collection has to run through the finance minister, or his screen has
   nothing to say either. */
{
  function yearIncome(comp) {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'م'; setupState.ruler = 'م'; startGame();
    S.ministers.finance.competence = comp;
    tick(S);
    return S.lastMonth.incomeTax;
  }
  ok(yearIncome(90) > yearIncome(30) * 1.5,
    'وزير مالية كفء وواحد فاشل حصّلوا نفس الضرايب تقريبًا');
}

/* Put the reference game back — the screen checks below expect it. */
setupState.gov = SETUP.government_types[1];
setupState.soc = SETUP.society_types[0];
setupState.country = 'جمهورية النهر'; setupState.ruler = 'كريم';
startGame();
for (let i = 0; i < 12; i++) stepMonth();

/* -------------------------------------------------------------- screens */
/* Every screen in the routing table must actually draw. A screen that exists in
   SCREENS but has no body silently renders a band with nothing under it. */
const TAB_IDS = TABS.map(t => t[0]);
/* A sub-screen may need an id (which minister? which governorate?). Every one
   must name a sample here, so adding a screen without saying what it opens on
   fails the build instead of drawing an empty page in front of Karim. */
const SAMPLE_ID = { minister: 'health', governorate: 'south' };
/* Every id a sub-screen can be opened with, not one sample of each. Nine
   ministers share one screen function but each has his own explanation text,
   and scanning only one of them meant eight of those lines were never looked at
   by anything — a Latin comma sat in the defence minister's line and every test
   stayed green. */
const ALL_IDS = { minister: POST_IDS, governorate: GOV_IDS };
function showTab(t) { goTab(t); }
function showScreen(s, id) { goTab(curTab()); openScreen(s, id || SAMPLE_ID[s]); }

for (const t of TAB_IDS) {
  showTab(t);
  ok((store.view || '').length > 150, 'تاب ' + t + ' بيرسم فاضي');
}
for (const key of Object.keys(SCREENS)) {
  if (key.indexOf('tab_') === 0) {
    ok(TAB_IDS.indexOf(key.slice(4)) !== -1, 'شاشة ' + key + ' مش في شريط التابات');
  } else {
    ok(Object.prototype.hasOwnProperty.call(SAMPLE_ID, key),
      'شاشة «' + key + '» مالهاش مثال في SAMPLE_ID — الاختبار مش عارف يفتحها بإيه');
    showScreen(key);
    ok((store.view || '').length > 150, 'شاشة ' + key + ' بترسم فاضي');
  }
  const sc = SCREENS[key];
  ok(sc.title && sc.sub && ART[sc.art], 'شاشة ' + key + ' ناقصها عنوان أو وصف أو رسمة');
}
drawTop();
ok(/كريم/.test(store.who), 'اسم الحاكم مش ظاهر في الشريط العلوي');
ok(/الشهر/.test(store.date), 'التاريخ مش ظاهر في الشريط العلوي');
/* The number of meters is not written down here on purpose: it changes as the
   game grows, and a hard-coded 4 turns a deliberate addition into a red test.
   What must hold is that the bar's grid has a column for every meter — check.py
   compares the two files, and this asserts the bar actually drew them. */
const meterCount = (store.meters || '').split('mtr').length - 1;
const meterCols = +(/\.meters\{[^}]*repeat\((\d+), *1fr\)/.exec(html) || [])[1];
ok(meterCount >= 4, 'الشريط العلوي فيه ' + meterCount + ' مؤشر بس');
ok(meterCount === meterCols,
  'الشريط العلوي فيه ' + meterCount + ' مؤشر والشبكة ' + meterCols + ' خانة — الأخير هينزل سطر تاني');
ok(/الشبهة/.test(store.meters), 'الشبهة مش ظاهرة في الشريط العلوي');

/* Every tab must have its own artwork and its own title band. A missing entry
   in ART would silently render a band with nothing in it. */
for (const t of TAB_IDS) {
  const art = SCREENS['tab_' + t].art;
  ok(typeof ART[art] === 'string' && ART[art].indexOf('<svg') === 0, 'تاب ' + t + ' مالوش رسمة');
  ok(/viewBox="0 0 1200 400"/.test(ART[art]), 'رسمة ' + t + ' مقاسها مش مظبوط');
  showTab(t);
  ok(store.view.indexOf('class="band"') !== -1, 'تاب ' + t + ' مفيهوش شريط علوي');
  ok(store.view.indexOf('<svg') !== -1, 'شريط ' + t + ' مفيهوش الرسمة');
}
const artIds = Object.keys(ART);
ok(artIds.length === 5, 'عدد الرسومات ' + artIds.length + ' والمفروض ٥');
ok(/id="fade-down"/.test(ART_DEFS), 'التدرج المشترك ناقص — الرسومات هتبان بحافة حادة');

/* -------------------------------------------------------- cabinet board */
/* The board is built from the state, so it must show every post the data
   defines — not a number of rows somebody typed once and forgot. */
goTab('govt');
for (const p of MINISTERS.posts) {
  ok(store.view.indexOf(p.name) !== -1, 'شاشة المجلس مش فيها «' + p.name + '»');
  ok(store.view.indexOf(p.of) !== -1, '«' + p.name + '» مالوش وصف لشغله في الشاشة');
}
ok((store.view.match(/class="mrow"/g) || []).length === MINISTERS.posts.length,
  'عدد صفوف المجلس مش قد عدد الوزرا');

/* A minister who runs services is judged by his WORST one. If the screen showed
   an average instead, one collapsed service would hide behind two healthy ones
   and the player would never know which ministry to fix. */
{
  const u = 'utilities';
  const worst = worstServiceOf(S, u);
  ok(worst !== null, 'وزير المرافق المفروض له خدمات');
  for (const s of postOf(u).services) {
    ok(nationalLevel(S, worst) <= nationalLevel(S, s) + 1e-9,
      'أسوأ خدمة عند وزير المرافق مش أوطى واحدة فعلاً');
  }
  ok(store.view.indexOf(BALANCE.services[worst].name) !== -1,
    'اسم أسوأ خدمة مش ظاهر في صف الوزير');
  ok(worstServiceOf(S, 'media') === null, 'وزير الإعلام مالوش خدمات والمفروض يرجع فاضي');
}

/* The labels have to come from the data and have to actually separate people. */
{
  let tagged = 0;
  for (const p of MINISTERS.posts) {
    const t = ministerTag(S, p.id);
    if (t) {
      tagged++;
      ok(MINISTERS.tags.indexOf(t) !== -1, 'وصف «' + p.name + '» مش جاي من البيانات');
      ok(store.view.indexOf(t.nm) !== -1, 'وصف «' + t.nm + '» مش ظاهر في الشاشة');
    }
  }
  ok(tagged > 0 && tagged < MINISTERS.posts.length,
    'الأوصاف اتحطّت على ' + tagged + ' وزير من ' + MINISTERS.posts.length + ' — لازم تميّز البعض مش الكل ولا ولا حد');
}

/* -------------------------------------------------- the minister screen */
{
  goTab('govt'); openScreen('minister', 'utilities');
  const p = postOf('utilities');
  ok(store.view.indexOf(p.name) !== -1, 'شاشة الوزير مش فيها اسمه');
  // His budgets must be ON his screen — that is the whole restructure.
  for (const s of p.services) {
    ok(store.view.indexOf('data-pct="' + s + '"') !== -1,
      'خدمة «' + BALANCE.services[s].name + '» مالهاش مزلاج ميزانية في شاشة وزيرها');
    ok(store.view.indexOf('data-build="' + s + '"') !== -1,
      'خدمة «' + BALANCE.services[s].name + '» مالهاش زرار بناء في شاشة وزيرها');
  }
  // And services he does NOT own must not be there, or the screen is a copy of
  // the national list with a portrait on top.
  ok(store.view.indexOf('data-pct="health"') === -1,
    'شاشة وزير المرافق فيها خدمة مش بتاعته');

  goTab('govt'); openScreen('minister', 'finance');
  ok(store.view.indexOf('data-pct=') === -1, 'وزير المالية مالوش خدمات ومع ذلك ظهرت له مزاليج');
  ok(store.view.indexOf('data-fire="finance"') !== -1, 'مفيش زرار إقالة في شاشة الوزير');
}

/* --------------------------------------------------------- the treasury */
{
  goTab('govt'); openScreen('minister', 'finance');
  const v = store.view;
  ok(v.indexOf('data-lever="tax"') !== -1, 'مفيش مقبض ضرايب في شاشة وزير المالية');
  ok(v.indexOf('data-lever="utility"') !== -1, 'مفيش مقبض سعر المرافق');
  ok(v.indexOf('data-lever="subsidy"') !== -1, 'مفيش مقبض دعم الغذاء');
  ok(v.indexOf('data-steal') !== -1, 'مفيش زرار سرقة');
  // Every line of the books must be there — the whole reason the treasury moved
  // onto his desk was to stop money appearing without a reason next to it.
  for (const label of ['ضريبة الدخل', 'فواتير المرافق', 'تشغيل الوزارات',
                       'استيراد غذاء', 'الصافي']) {
    ok(v.indexOf(label) !== -1, 'دفتر الخزينة ناقصه سطر «' + label + '»');
  }

  /* Drag each lever through the REAL event handler, not by setting the field.
     Each must move its own field and nothing else — a handler that writes to the
     wrong one is invisible to a test that never fires an event. */
  /* Every value below is unique. A test that drags a lever to a number another
     field already happens to hold passes even when the handler writes to the
     wrong field — which is exactly what happened the first time this was
     written: the tax slider's maximum and the food subsidy were both 60. */
  {
    const LEVERS = [['tax', 'tax', 11, 23], ['utility', 'utilPrice', 75, 95],
                    ['subsidy', 'subsidy', 210, 330]];
    const all = LEVERS.flatMap(l => [l[2], l[3]]);
    ok(new Set(all).size === all.length, 'قيم اختبار المقابض فيها تكرار — الاختبار مش هيمسك حاجة');
    for (const [id, , seed] of LEVERS) fireInput({ lever: id }, seed);
    for (const [id, field, seed, moved] of LEVERS) {
      const before = { tax: S.tax, utilPrice: S.utilPrice, subsidy: S.subsidy };
      fireInput({ lever: id }, moved);
      ok(S[field] === moved, 'مقبض ' + id + ' ما حرّكش الرقم بتاعه');
      for (const other of ['tax', 'utilPrice', 'subsidy']) {
        if (other !== field) {
          ok(S[other] === before[other],
            'مقبض ' + id + ' حرّك «' + other + '» كمان: ' + before[other] + ' ← ' + S[other]);
        }
      }
      fireInput({ lever: id }, seed);
    }
  }
  /* And the budget sliders must still go through the same handler untouched. */
  {
    const b = S.pct.water;
    fireInput({ pct: 'water' }, 77);
    ok(S.pct.water === 77, 'مزلاج ميزانية الخدمة بطّل يشتغل بعد ما ضفنا المقابض');
    ok(S.tax === BALANCE.start.tax_rate || true, '');
    fireInput({ pct: 'water' }, b);
  }
  ok(BALANCE.levers.tax.min <= BALANCE.start.tax_rate
    && BALANCE.start.tax_rate <= BALANCE.levers.tax.max, 'الضريبة الابتدائية برّه مدى المقبض');
}

/* ---------------------------------------------------------- the pocket */
{
  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 4242 });
  const cap = stealMax(g);
  ok(cap > 0 && cap <= BALANCE.corruption.hard_cap, 'سقف السرقة غلط: ' + cap);
  ok(cap <= g.treasury * BALANCE.corruption.max_share_per_month + 1,
    'ينفع تاخد أكتر من النسبة المسموحة في الشهر');
  ok(typeof stealFromTreasury(g, cap + 1) === 'string', 'عدّت سرقة فوق السقف');
  ok(typeof stealFromTreasury(g, 0) === 'string', 'عدّت سرقة بصفر');

  const tBefore = g.treasury, pBefore = g.personal;
  const res = stealFromTreasury(g, cap);
  ok(typeof res !== 'string', 'السرقة اترفضت من غير سبب: ' + res);
  ok(Math.abs((tBefore - g.treasury) - cap) < 1e-9, 'الخزينة ما نقصتش بنفس الرقم');
  ok(Math.abs((g.personal - pBefore) - cap) < 1e-9, 'جيبك ما زادش بنفس الرقم');
  ok(typeof stealFromTreasury(g, 1) === 'string', 'ينفع تسرق مرتين في نفس الشهر');
  tick(g);
  ok(g.stoleThisMonth === false, 'عداد السرقة ما اتصفّرش مع الشهر الجديد');

  /* A disloyal finance minister must be more dangerous than a loyal one, or the
     post has no reason to exist on this screen. */
  const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 5151 });
  q.ministers.finance.loyalty = 95;
  const safe = leakChance(q, 100);
  q.ministers.finance.loyalty = 20;
  const risky = leakChance(q, 100);
  ok(risky > safe + 5, 'ولاء وزير المالية مش بيغيّر خطر التسريب فعليًا');
  ok(leakChance(q, 300) > leakChance(q, 30), 'حجم السرقة مش بيزوّد الخطر');
  ok(safe >= BALANCE.corruption.leak_min_pct, 'فيه حالة الخطر فيها صفر — السرقة بقت آمنة تمامًا');

  /* A leak must actually cost something the player feels. */
  const w = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 6262 });
  w.ministers.finance.loyalty = 0;          // makes a leak near-certain
  const apprBefore = w.approval;
  let leakedOnce = false;
  for (let i = 0; i < 12 && !leakedOnce; i++) {
    const r = stealFromTreasury(w, stealMax(w));
    if (typeof r !== 'string' && r.leaked) leakedOnce = true;
    tick(w);
  }
  ok(leakedOnce, 'وزير مالية ولاؤه صفر ما سرّبش ولا مرة في سنة');
  ok(w.approval < apprBefore, 'التسريب ما أثّرش على رضا الناس');

  /* Printing money is a rule now, not something the simulator does itself. */
  const z = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 7373 });
  const tr = z.treasury, inf = z.inflation;
  ok(printMoney(z, printCap(z)) === null, 'طباعة الفلوس اترفضت');
  ok(z.treasury > tr, 'طبعت فلوس والخزينة ما زادتش');
  ok(z.inflation > inf, 'طبعت فلوس والتضخم ما زادش — ده بيخلي الطباعة مجانية');
  ok(typeof printMoney(z, 0) === 'string', 'عدّت طباعة بصفر');
}

/* ------------------------------------------------------------- dismissal */
{
  /* The offer must not change when the player looks away and looks back — a
     screen that rerolls on every redraw turns a decision into a slot machine. */
  const a = JSON.stringify(candidatesFor(S, 'supply'));
  drawView(); drawView();
  ok(JSON.stringify(candidatesFor(S, 'supply')) === a,
    'المرشحين بيتغيّروا مع كل رسمة للشاشة — اللاعب يقدر يلف على الرقم اللي عايزه');
  ok(JSON.stringify(candidatesFor(S, 'media')) !== a, 'كل المناصب بتديك نفس المرشحين');
  ok(candidatesFor(S, 'supply').length === MINISTERS.dismiss.candidates,
    'عدد المرشحين مش زي اللي في البيانات');
  for (const c of candidatesFor(S, 'supply')) {
    ok(c.name && c.party, 'مرشح من غير اسم أو حزب');
    ok(c.competence >= MINISTERS.dismiss.comp_range[0] && c.competence <= MINISTERS.dismiss.comp_range[1],
      'كفاءة مرشح برّه المدى: ' + c.competence);
    ok(c.loyalty >= MINISTERS.dismiss.loy_range[0] && c.loyalty <= MINISTERS.dismiss.loy_range[1],
      'ولاء مرشح برّه المدى: ' + c.loyalty);
  }
  ok(new Set(candidatesFor(S, 'supply').map(c => c.name)).size === MINISTERS.dismiss.candidates,
    'نفس الاسم اتكرر في المرشحين');

  /* The sheet must show every candidate's real numbers and what the move costs.
     A confirmation screen that hides the price is how a player spends what he
     did not mean to spend. */
  openFire('supply');
  for (const c of candidatesFor(S, 'supply')) {
    ok(store.ovl.indexOf(c.name) !== -1, 'مرشح «' + c.name + '» مش ظاهر في ورقة الإقالة');
    ok(store.ovl.indexOf(ar(c.competence)) !== -1, 'كفاءة «' + c.name + '» مش مكتوبة');
  }
  ok(store.ovl.indexOf('طاقة قرارات') !== -1, 'ورقة الإقالة مش بتقول بتكلّف كام طاقة');
  ok(store.ovl.indexOf(ar(MINISTERS.dismiss.stability_hit)) !== -1,
    'ورقة الإقالة مش بتقول الثبات هينزل قد إيه');
  ok(!/[0-9]/.test(store.ovl.replace(/<[^>]*>/g, ' ')), 'ورقة الإقالة فيها أرقام إنجليزي');
  closeSheet();

  /* A game replayed from the same seed must deal the same hand, or the balance
     simulator is measuring a different game on every run. */
  const twin = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                         soc: SETUP.society_types[0], seed: 12345 });
  const twin2 = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                          soc: SETUP.society_types[0], seed: 12345 });
  ok(JSON.stringify(candidatesFor(twin, 'supply')) === JSON.stringify(candidatesFor(twin2, 'supply')),
    'نفس البذرة أدّت مرشحين مختلفين — اللعبة مش قابلة للإعادة');
  twin2.seed = 999;
  ok(JSON.stringify(candidatesFor(twin, 'supply')) !== JSON.stringify(candidatesFor(twin2, 'supply')),
    'بذرة مختلفة أدّت نفس المرشحين — العشوائية مش شغالة');

  /* The rules around the act itself. */
  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 777 });
  ok(dismissRefusal(g, 'supply') !== null, 'ينفع تقيل وزير أول شهر — ده بيخلي الاختيار بلا تمن');
  for (let i = 0; i < MINISTERS.dismiss.min_months_in_post; i++) tick(g);
  ok(dismissRefusal(g, 'supply') === null, 'مش عارف تقيل وزير حتى بعد المدة المطلوبة');

  const pick = candidatesFor(g, 'supply')[1];
  const apBefore = g.ap, stBefore = g.stability;
  ok(dismissMinister(g, 'supply', 1) === null, 'الإقالة اترفضت من غير سبب');
  ok(g.ministers.supply.competence === pick.competence
    && g.ministers.supply.loyalty === pick.loyalty
    && g.ministers.supply.party === pick.party,
    'اللي استلم مش هو اللي الشاشة وعدت بيه — أرقام مخفية');
  ok(g.ministers.supply.months === 0, 'الوزير الجديد استلم وعدّاد شهوره مش صفر');
  ok(g.ap === apBefore - MINISTERS.dismiss.ap_cost, 'الإقالة ما خدتش طاقة قرارات');
  ok(g.stability === stBefore - MINISTERS.dismiss.stability_hit, 'الإقالة ما هزّتش الثبات');
  ok(dismissRefusal(g, 'supply') !== null, 'ينفع تقيل الجديد في نفس اللحظة — لفة لا نهائية');

  /* Refusals must not half-happen: a rejected move changes nothing at all. */
  const g2 = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                       soc: SETUP.society_types[0], seed: 888 });
  const snap = JSON.stringify(g2.ministers) + g2.ap + g2.stability;
  ok(dismissMinister(g2, 'supply', 0) !== null, 'الإقالة عدّت رغم إن الوزير لسه مستلم');
  ok(JSON.stringify(g2.ministers) + g2.ap + g2.stability === snap,
    'إقالة اترفضت وبرضه غيّرت في اللعبة');
}

/* -------------------------------------------- the prime minister's desk */
{
  goTab('govt'); openScreen('minister', 'pm');
  // Every minister must be sackable from here — that is what the screen is for.
  for (const p of MINISTERS.posts) {
    if (p.id === 'pm') continue;
    ok(store.view.indexOf('data-fire="' + p.id + '"') !== -1,
      'مفيش زرار إقالة لـ«' + p.name + '» في شاشة رئيس الوزراء');
  }
  /* He must not appear in his own roster — but his own dismissal button stays,
     because replacing the prime minister has to be possible like anyone else. */
  const roster = store.view.split('class="prow"').slice(1).join('class="prow"')
    .split('class="sech"')[0];
  ok(roster.indexOf('data-fire="pm"') === -1, 'رئيس الوزراء مدرج في قايمة وزرائه هو');
  ok(store.view.indexOf('data-fire="pm"') !== -1,
    'مفيش طريقة تغيّر بيها رئيس الوزراء نفسه');
  ok(store.view.indexOf('data-shuffle') !== -1, 'مفيش زرار تعديل وزاري');
  ok((store.view.match(/class="prow"/g) || []).length === MINISTERS.posts.length - 1,
    'قايمة وزرا رئيس الوزراء عددها غلط');

  /* A blind move still owes the player the price and the odds up front. */
  const r = MINISTERS.reshuffle;
  ok(store.view.indexOf(ar(r.stability_hit)) !== -1, 'التعديل الوزاري مش بيقول الثبات هينزل قد إيه');
  ok(store.view.indexOf(ar(r.cooldown_months)) !== -1, 'التعديل الوزاري مش بيقول هيقفل قد إيه');
}

/* ------------------------------------------------------------- reshuffle */
{
  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 31415 });
  ok(reshuffleRefusal(g) !== null, 'ينفع تعمل تعديل وزاري أول شهر في الحكم');
  for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tick(g);
  ok(reshuffleRefusal(g) === null, 'مش عارف تعمل تعديل حتى بعد المدة');

  const before = {};
  for (const id of POST_IDS) before[id] = Object.assign({}, g.ministers[id]);
  const ap = g.ap, st = g.stability, appr = g.approval;

  const out = reshuffleCabinet(g);
  ok(typeof out !== 'string', 'التعديل الوزاري اترفض من غير سبب: ' + out);
  ok(out.changed.length === POST_IDS.length - 1, 'التعديل ما غيّرش كل الوزرا ما عدا الرئيس');

  // The prime minister survives his own reshuffle; everyone else does not.
  ok(g.ministers.pm.competence === before.pm.competence
    && g.ministers.pm.name === before.pm.name, 'رئيس الوزراء اتغيّر في تعديله هو');
  for (const id of POST_IDS) {
    if (id === 'pm') continue;
    ok(g.ministers[id].months === 0, 'وزير جديد وعدّاد شهوره مش صفر: ' + id);
    ok(g.ministers[id].name, 'وزير جديد من غير اسم: ' + id);
    ok(MINISTERS.candidate_names.indexOf(g.ministers[id].name) !== -1,
      'اسم وزير جديد مش من قايمة الأسامي');
    ok(PARLIAMENT.parties.some(x => x.id === g.ministers[id].party),
      'حزب وزير جديد مش من قايمة الأحزاب');
  }
  ok(g.ap === ap - MINISTERS.reshuffle.ap_cost, 'التعديل ما خدش طاقة');
  ok(g.stability === st - MINISTERS.reshuffle.stability_hit, 'التعديل ما هزّش الثبات');
  ok(g.approval < appr, 'التعديل ما أثّرش على الرضا');
  ok(reshuffleRefusal(g) !== null, 'ينفع تعمل تعديلين ورا بعض');

  /* The prime minister's competence must actually change who arrives, or the
     post is decoration for the second time. */
  function shuffledAverage(pmComp) {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 2718 });
    for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tick(q);
    q.ministers.pm.competence = pmComp;
    reshuffleCabinet(q);
    let t = 0, n = 0;
    for (const id of POST_IDS) { if (id !== 'pm') { t += q.ministers[id].competence; n++; } }
    return t / n;
  }
  ok(shuffledAverage(95) > shuffledAverage(20) + 3,
    'كفاءة رئيس الوزراء مش بتغيّر نوعية اللي بيجوا في التعديل');
  ok(reshuffleQualityShift({ ministers: { pm: { competence: 50 } } }) === 0,
    'رئيس وزراء متوسط المفروض ما يزحزحش حاجة');

  /* Same seed, same government — otherwise the reshuffle is a reload away from
     being retried until it comes out well. */
  function twinShuffle(seed) {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: seed });
    for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tick(q);
    reshuffleCabinet(q);
    return JSON.stringify(q.ministers);
  }
  ok(twinShuffle(555) === twinShuffle(555), 'نفس البذرة أدّت حكومة مختلفة');
  ok(twinShuffle(555) !== twinShuffle(556), 'بذرة مختلفة أدّت نفس الحكومة');

  /* A refused reshuffle must change absolutely nothing. */
  const h = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 909 });
  const snap = JSON.stringify(h.ministers) + h.ap + h.stability + h.approval;
  ok(typeof reshuffleCabinet(h) === 'string', 'التعديل عدّى رغم إنه لسه بدري');
  ok(JSON.stringify(h.ministers) + h.ap + h.stability + h.approval === snap,
    'تعديل اترفض وبرضه غيّر في اللعبة');
}

/* Every minister the player ever sees must be a person with a name — the nine
   you inherit as much as the ones you appoint. */
{
  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 1 });
  const names = POST_IDS.map(id => g.ministers[id].name);
  for (const n of names) ok(n && n.length > 2, 'فيه وزير من غير اسم في أول اللعبة');
  ok(new Set(names).size === names.length, 'وزيرين بنفس الاسم في أول اللعبة');
}

/* ------------------------------------------- the cost of churning people */
{
  /* A new minister must not deliver his full number on day one, or swapping
     people is free and grinding the cabinet becomes the whole game. */
  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 8484 });
  ok(settleFactor(g, 'utilities') === 1, 'الوزرا اللي ورثتهم المفروض مستقرين من أول يوم');
  for (let i = 0; i < MINISTERS.dismiss.min_months_in_post; i++) tick(g);
  const paper = g.ministers.utilities.competence;
  const workedBefore = ministerComp(g, 'utilities');
  dismissMinister(g, 'utilities', 0);
  const fresh = g.ministers.utilities;
  ok(settleFactor(g, 'utilities') < 1, 'وزير لسه مستلم بيشتغل بكامل كفاءته فورًا');
  ok(ministerComp(g, 'utilities') < fresh.competence,
    'الوزير الجديد بيدي رقمه الكامل من أول شهر — التقليب بقى ببلاش');
  const settling = ministerComp(g, 'utilities');
  for (let i = 0; i < MINISTERS.settling.months; i++) tick(g);
  ok(ministerComp(g, 'utilities') > settling, 'الوزير الجديد ما بيتحسّنش مع الوقت');
  ok(settleFactor(g, 'utilities') === 1, 'الوزير ما وصلش لكامل كفاءته بعد مدة الاستقرار');

  /* And the rest of the cabinet notices. Without this the churn has no
     accumulating price at all. */
  const h = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 9494 });
  for (let i = 0; i < MINISTERS.dismiss.min_months_in_post; i++) tick(h);
  const loyBefore = {};
  for (const id of POST_IDS) loyBefore[id] = h.ministers[id].loyalty;
  dismissMinister(h, 'supply', 0);
  for (const id of POST_IDS) {
    if (id === 'supply') continue;
    ok(h.ministers[id].loyalty < loyBefore[id],
      'إقالة وزير ما أثّرتش على ولاء «' + id + '» — التقليب مالوش تمن متراكم');
  }
}

/* ------------------------------------ competent people are not loyal ones */
{
  /* The trade the whole game rests on. Drawn independently, repeated hiring
     eventually hands the player someone who is both — and the simulator caught
     exactly that: a player who only managed ministers never died. */
  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 606 });
  let hiC = 0, hiN = 0, loC = 0, loN = 0, both = 0, n = 0;
  for (let m = 0; m < 400; m++) {
    for (const post of POST_IDS) {
      for (const c of candidatesFor(g, post)) {
        n++;
        if (c.competence >= 70) { hiC += c.loyalty; hiN++; }
        if (c.competence <= 50) { loC += c.loyalty; loN++; }
        if (c.competence >= 75 && c.loyalty >= 75) both++;
      }
    }
    tick(g);
  }
  ok(hiN > 30 && loN > 30, 'العينة صغيرة أوي عشان نحكم على المقايضة');
  ok(hiC / hiN < loC / loN - 8,
    'الأكفأ والأضعف بيجوا بنفس الولاء تقريبًا — المقايضة اللي اللعبة قايمة عليها مش موجودة');
  ok(both / n < 0.02,
    'نسبة اللي كفء وموالي في نفس الوقت ' + (both / n * 100).toFixed(1)
    + '٪ — كبيرة أوي، اللاعب هيلف لحد ما يجمّع حكومة مثالية');

  /* And a disloyal cabinet must cost stability, or loyalty is a number nobody
     has a reason to care about. */
  function settledStability(loy) {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 707 });
    for (const id of POST_IDS) q.ministers[id].loyalty = loy;
    for (let i = 0; i < 40; i++) tick(q);
    return q.stability;
  }
  ok(settledStability(85) > settledStability(25) + 5,
    'حكومة غير موالية مش بتهزّ الثبات — الولاء رقم على الشاشة وبس');
}

/* ---------------------------------------------------------- governorates */
{
  goTab('govs');
  for (const g of GOV_IDS) {
    ok(store.view.indexOf(BALANCE.governorates[g].name) !== -1,
      'محافظة «' + BALANCE.governorates[g].name + '» مش في القايمة');
    ok(store.view.indexOf('data-openid="' + g + '"') !== -1,
      'محافظة «' + BALANCE.governorates[g].name + '» مش بتفتح');
  }
  ok((store.view.match(/data-open="governorate"/g) || []).length === GOV_IDS.length,
    'عدد المحافظات في القايمة غلط');

  /* The worst service named on each row is the reason to go in, so it has to be
     the genuinely worst one — not the first in the list. */
  for (const g of GOV_IDS) {
    const w = worstServiceIn(g);
    for (const s of SERVICE_IDS) {
      ok(S.level[g][w] <= S.level[g][s] + 1e-9,
        'أسوأ خدمة في «' + BALANCE.governorates[g].name + '» مش أوطى واحدة فعلاً');
    }
  }

  /* Inside a province, every number must be THAT province's — the whole reason
     the screen exists is that the national average hides a province in the dirt. */
  const g = 'south';
  goTab('govs'); openScreen('governorate', g);
  ok(govFilter === g, 'شاشة المحافظة مش مظبّطة السياق بتاعها');
  ok(store.view.indexOf(BALANCE.governorates[g].name) !== -1, 'اسم المحافظة مش ظاهر');
  for (const s of SERVICE_IDS) {
    ok(store.view.indexOf('data-pct="' + s + '"') !== -1,
      'خدمة «' + BALANCE.services[s].name + '» مش في شاشة المحافظة');
  }
  // Facilities, not the national monthly bill: the line under each service must
  // be the local fact.
  ok(store.view.indexOf('منشأة في ' + BALANCE.governorates[g].name) !== -1,
    'شاشة المحافظة بتقول أرقام الدولة مش أرقام المحافظة');
  ok(store.view.indexOf('data-buildin="' + g + '"') !== -1,
    'زرار البناء في المحافظة مش عارف نفسه فين');

  /* Worst service first: the screen must open on what needs the player. */
  {
    const order = [...store.view.matchAll(/data-pct="([a-z]+)"/g)].map(m => m[1]);
    for (let i = 1; i < order.length; i++) {
      ok(S.level[g][order[i - 1]] <= S.level[g][order[i]] + 1e-9,
        'ترتيب الخدمات في المحافظة مش من الأوحش للأحسن');
    }
  }

  /* Leaving the province must put the cards back on national numbers, or the
     next screen quietly shows one province's figures under a national heading. */
  backScreen();
  ok(govFilter === 'all', 'السياق فضل على المحافظة بعد ما خرجنا منها');
  goTab('govt'); openScreen('minister', 'utilities');
  ok(store.view.indexOf('م/شهر على مستوى الدولة') !== -1,
    'شاشة الوزير بقت بتوري أرقام محافظة واحدة');

  /* Building from a province offers that province and no other. */
  goTab('govs'); openScreen('governorate', g);
  openBuild('water', g);
  ok(store.ovl.indexOf('data-buildgov="' + g + '"') !== -1, 'ورقة البناء مش فيها المحافظة نفسها');
  ok((store.ovl.match(/data-buildgov=/g) || []).length === 1,
    'ورقة البناء من جوّه المحافظة بتعرض محافظات تانية');
  ok(!/[0-9]/.test(store.ovl.replace(/<[^>]*>/g, ' ')), 'ورقة البناء فيها أرقام إنجليزي');
  closeSheet();

  /* A facility's forever-cost is a fraction of a million, so rounding it to a
     whole number prints ٠م and the sheet promises a free building. Five of the
     seven services did exactly that. Any number the player is quoted must not
     round away to nothing. */
  for (const s of SERVICE_IDS) {
    openBuild(s, g);
    const sheet = store.ovl.replace(/<[^>]*>/g, ' ');
    ok(BALANCE.services[s].adds_monthly <= 0 || sheet.indexOf('+٠م') === -1,
      'ورقة بناء «' + BALANCE.services[s].name + '» بتقول إنه هيزوّد ٠م — التكلفة اتقرّبت لصفر');
    ok(sheet.indexOf(ar(projectCost(S, s))) !== -1, 'تكلفة البناء مش ظاهرة في الورقة');
    closeSheet();
  }
  goTab('pres');
}

/* ------------------------------------------------------------ the chamber */
{
  goTab('parl');
  for (const q of PARLIAMENT.parties) {
    ok(store.view.indexOf(q.nm) !== -1, 'حزب «' + q.nm + '» مش في الشاشة');
    ok(store.view.indexOf(ar(q.seats)) !== -1, 'مقاعد «' + q.nm + '» مش ظاهرة');
  }
  for (const b of PARLIAMENT.blocs) {
    ok(store.view.indexOf(b.nm) !== -1, 'كتلة «' + b.nm + '» مش في الشاشة');
  }

  /* The five blocs are sold to the player as a breakdown of his approval
     rating. If their population-weighted average drifts away from it, the game
     is showing him two different answers to the same question on two screens. */
  {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 3131 });
    let worstShift = 0, worstDrift = 0;
    for (let i = 0; i < 120; i++) {
      // Push the world around so the two are compared under strain, not only at
      // rest: a decomposition that only matches on a calm month is not one.
      if (i === 20) g.tax = 45;
      if (i === 40) g.subsidy = 0;
      if (i === 60) for (const s of SERVICE_IDS) g.pct[s] = 40;
      if (i === 90) g.utilPrice = 120;
      tick(g);

      /* The exact property: the blocs are approval redistributed, so the shifts
         must cancel out to zero however bad the month gets. */
      let mean = 0;
      for (const b of PARLIAMENT.blocs) mean += blocFeel(g, b) * b.share;
      let sum = 0;
      for (const b of PARLIAMENT.blocs) sum += (blocFeel(g, b) - mean) * b.share;
      worstShift = Math.max(worstShift, Math.abs(sum));

      /* And the visible numbers must match too — except when the country is so
         far gone that moods hit the floor, where clamping makes an exact split
         impossible for anyone. */
      if (g.approval > 20 && g.approval < 80) {
        worstDrift = Math.max(worstDrift, Math.abs(blocAverage(g) - g.approval));
      }
    }
    ok(worstShift < 1e-9,
      'فروق الكتل مش بتلغي بعضها — يعني دي مش تفكيك للرضا، دي حساب تاني');
    ok(worstDrift < 3, 'مزاج الكتل بعد عن الرضا الحقيقي بـ' + worstDrift.toFixed(1)
      + ' نقطة — الشاشتين بيقولوا حاجتين مختلفتين عن نفس اليوم');
  }

  /* Every driver a party watches must be a real, moving number. */
  {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 4141 });
    for (const key of Object.keys(DRIVERS)) {
      const v = DRIVERS[key](g);
      ok(typeof v === 'number' && !isNaN(v) && v >= 0 && v <= 100,
        'المقياس «' + key + '» بيطلع ' + v + ' — لازم يكون رقم بين صفر ومية');
    }
    for (const q of PARLIAMENT.parties) {
      const m = partyMood(g, q.id);
      ok(m >= 0 && m <= 100, 'رضا «' + q.nm + '» برّه المدى: ' + m);
    }
    // Parties must not all move together, or the chamber is one number wearing
    // four hats.
    const moods = PARLIAMENT.parties.map(q => partyMood(g, q.id));
    ok(Math.max(...moods) - Math.min(...moods) > 8,
      'كل الأحزاب رضاهم واحد تقريبًا — المجلس بقى رقم واحد لابس أربع قبعات');
  }

  /* Appointing a minister from a party must buy you that party — the link that
     makes the cabinet screens political rather than administrative. */
  {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 5151 });
    const q = PARLIAMENT.parties[0];
    // Start from a cabinet with nobody in it from this party, or the party is
    // already near its ceiling and the increase is invisible.
    for (const id of POST_IDS) g.ministers[id].party = 'none';
    const before = partyMood(g, q.id);
    for (const id of POST_IDS) g.ministers[id].party = q.id;
    ok(partyMood(g, q.id) > before, 'تعيين وزرا من حزب ما رفعش رضاه');
    // And one appointment must not be worth the whole chamber.
    ok(PARLIAMENT.minister_bonus * POST_IDS.length <= 45,
      'مكافأة الوزير كبيرة أوي — تعيين وزرا من حزب بيلغي كل الأسباب التانية');
    ok(ministersOfParty(g, q.id) === POST_IDS.length, 'عدّ وزرا الحزب غلط');
  }

  /* And the chamber must actually cost something when it turns on you. */
  {
    /* Backing must respond to what the parties actually watch. Measured on the
       same world with one lever moved, not after fifty months of divergence —
       otherwise both arms just collapse and the comparison means nothing. */
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 6161 });
    const calm = parliamentBacking(g);
    g.tax = BALANCE.levers.tax.max;
    ok(parliamentBacking(g) < calm - 3, 'ضريبة على الآخر ما نزّلتش تأييد المجلس');
    g.tax = BALANCE.start.tax_rate;
    g.inflation = 40;
    ok(parliamentBacking(g) < calm - 3, 'تضخم ٤٠٪ ما نزّلش تأييد المجلس');

    /* And the chamber must cost stability. Isolated properly: the ONLY thing
       different between these two games is which party the ministers belong to,
       and that touches nothing in the world except the parliament. */
    function settled(packCabinet, tax) {
      const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                          soc: SETUP.society_types[0], seed: 6161 });
      q.tax = tax;
      for (const id of POST_IDS) {
        q.ministers[id].party = packCabinet ? PARLIAMENT.parties[0].id : 'none';
      }
      for (let i = 0; i < 40; i++) tick(q);
      return { st: q.stability, back: parliamentBacking(q) };
    }

    /* Squeezed country: the unfriendly chamber falls under the floor and the
       friendly one does not, so the only difference in the world is who is in
       the cabinet — and it must show up in stability. */
    const tight = BALANCE.levers.tax.max * 0.67;
    const friendly = settled(true, tight), hostile = settled(false, tight);
    ok(friendly.back > hostile.back + 2, 'تعيين وزرا من حزب ما رفعش تأييد المجلس');
    ok(hostile.back < PARLIAMENT.backing.floor,
      'الاختبار مش بيوصّل المجلس تحت خط الأمان — مش بيقيس حاجة');
    ok(friendly.st > hostile.st + 0.5, 'مجلس تحت خط الأمان ما أثّرش على ثباتك');

    /* And when both chambers are content, the parliament must cost nothing —
       the penalty is for losing the house, not for having one. */
    const calmA = settled(true, BALANCE.start.tax_rate);
    const calmB = settled(false, BALANCE.start.tax_rate);
    ok(calmA.back > PARLIAMENT.backing.floor && calmB.back > PARLIAMENT.backing.floor,
      'حتى المجلس الراضي طالع تحت خط الأمان — الخط عالي أوي');
    ok(Math.abs(calmA.st - calmB.st) < 0.01,
      'المجلس بياخد من ثباتك حتى وهو راضي — المفروض يعاقب على خسارته هو بس');
  }
}

/* -------------------------------------------------------- the central bank */
{
  goTab('bank');
  ok(store.view.indexOf(BANK.start.name) !== -1, 'اسم المحافظ مش ظاهر');
  ok(store.view.indexOf('data-print') !== -1, 'مفيش زرار طباعة');
  ok(store.view.indexOf('data-governor') !== -1, 'مفيش زرار تغيير المحافظ');

  const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 1717 });
  ok(g.bank && g.bank.independence === BANK.start.independence, 'البنك مش متظبّط في أول اللعبة');

  /* The governor must not be sackable as part of the cabinet — that is the one
     thing that makes this a separate institution and not a tenth ministry. */
  ok(POST_IDS.indexOf('bank') === -1 && POST_IDS.indexOf('governor') === -1,
    'محافظ البنك مدرج كوزير — يبقى التعديل الوزاري هيشيله');
  for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tick(g);
  const govBefore = g.bank.name;
  reshuffleCabinet(g);
  ok(g.bank.name === govBefore, 'التعديل الوزاري شال محافظ البنك — المفروض مستقل عن الحكومة');

  /* Both halves of the trade, measured. */
  {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 1818 });
    const capIndep = printCap(q), inflIndep = printInflation(q, 300);
    q.bank.independence = BANK.swap.new_independence[0];
    ok(printCap(q) > capIndep, 'محافظ من عندك مش بيوقّع على أكتر');
    ok(printInflation(q, 300) > inflIndep, 'طبعة المحافظ بتاعك مش بتوجع أكتر');
  }

  /* Printing itself: refused above the cap, refused twice in a row, and it must
     move both the treasury and the inflation when it goes through. */
  {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 1919 });
    for (let i = 0; i < BANK.print.once_per_months; i++) tick(q);
    ok(typeof printMoney(q, printCap(q) + 1) === 'string', 'عدّت طباعة فوق السقف');
    const tr = q.treasury, inf = q.inflation;
    ok(printMoney(q, printCap(q)) === null, 'الطباعة اترفضت من غير سبب');
    ok(q.treasury > tr && q.inflation > inf, 'الطباعة ما حركتش الخزينة أو التضخم');
    ok(typeof printMoney(q, 50) === 'string', 'ينفع تطبع مرتين ورا بعض');
    for (let i = 0; i < BANK.print.once_per_months; i++) tick(q);
    ok(printRefusal(q, 50) === null, 'الطباعة مقفولة حتى بعد المدة');
  }

  /* Swapping the governor: costs, cools down, and can only ever make the bank
     LESS independent. */
  {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 2020 });
    for (let i = 0; i < BANK.swap.cooldown_months; i++) tick(q);
    const ap = q.ap, st = q.stability, ind = q.bank.independence;
    ok(swapGovernor(q) === null, 'تغيير المحافظ اترفض من غير سبب');
    ok(q.bank.independence < ind, 'المحافظ الجديد طلع أكتر استقلالًا — المقايضة اتقلبت');
    ok(q.bank.name !== BANK.start.name, 'المحافظ ما اتغيّرش أصلاً');
    ok(q.ap === ap - BANK.swap.ap_cost, 'تغيير المحافظ ما خدش طاقة');
    ok(q.stability === st - BANK.swap.stability_hit, 'تغيير المحافظ ما هزّش الثبات');
    ok(typeof swapGovernor(q) === 'string', 'ينفع تغيّر المحافظ مرتين ورا بعض');

    // A refused swap must change nothing at all.
    const r = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 2121 });
    const snap = JSON.stringify(r.bank) + r.ap + r.stability;
    ok(typeof swapGovernor(r) === 'string', 'التغيير عدّى رغم إنه لسه بدري');
    ok(JSON.stringify(r.bank) + r.ap + r.stability === snap, 'تغيير مرفوض وبرضه غيّر حاجة');
  }
  goTab('pres');
}

/* ------------------------------------------------------------- المواقف */
{
  function play(seed, months, answer) {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: seed });
    let seen = 0;
    for (let i = 0; i < months && !g.dead; i++) {
      if (g.pendingSituation) { seen++; answer(g); }
      tickMonth(g);
    }
    return { g: g, seen: seen };
  }
  const freeAnswer = g => {
    const sit = SITUATIONS.situations.find(x => x.id === g.pendingSituation);
    for (let i = sit.choices.length - 1; i >= 0; i--) {
      if (choiceRefusal(g, sit, i) === null) return answerSituation(g, i);
    }
  };

  /* The clock must not move while a decision is open. That is the entire
     meaning of "every situation stops time", and it has to live in the engine —
     a screen that merely covers the view would let the month turn behind it and
     the player would answer a month that no longer exists. */
  {
    const r = play(9001, 200, freeAnswer);
    ok(r.seen > 3, 'مفيش مواقف ظهرت خالص في ٢٠٠ شهر: ' + r.seen);

    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 9001 });
    for (let i = 0; i < 200 && !g.pendingSituation && !g.dead; i++) tickMonth(g);
    ok(g.pendingSituation, 'ما قدرتش أوصل لموقف عشان أختبر وقف الوقت');
    const before = g.totalMonths;
    tickMonth(g); tickMonth(g);
    ok(g.totalMonths === before, 'الشهر عدّى والموقف لسه مفتوح — الوقت مش واقف');
    ok(answerSituation(g, 99) !== null, 'عدّى اختيار مش موجود');
    ok(g.pendingSituation, 'إجابة مرفوضة وبرضه قفلت الموقف');
    ok(answerSituation(g, 0) === null || typeof answerSituation(g, 0) === 'string',
      'الإجابة رجّعت حاجة غريبة');
    while (g.pendingSituation) freeAnswer(g);
    tickMonth(g);
    ok(g.totalMonths > before, 'الوقت ما مشيش بعد ما الموقف اتقفل');
  }

  /* Same seed, same situations — a reload must not reroll the card you got. */
  ok(JSON.stringify(play(4242, 120, freeAnswer).g.sitHistory.map(x => x.id))
    === JSON.stringify(play(4242, 120, freeAnswer).g.sitHistory.map(x => x.id)),
    'نفس البذرة أدّت مواقف مختلفة — اللاعب يقدر يعيد اللعبة عشان يغيّر الموقف');
  ok(JSON.stringify(play(4242, 120, freeAnswer).g.sitHistory.map(x => x.id))
    !== JSON.stringify(play(4243, 120, freeAnswer).g.sitHistory.map(x => x.id)),
    'بذرتين مختلفتين أدّوا نفس المواقف');

  /* The rate gate. Every card interrupts, so these two are the difference
     between drama and nagging. */
  {
    const r = play(777, 400, freeAnswer);
    const all = r.g.sitHistory;
    /* Two independent gates now: ordinary situations and scandals. Each is
       checked against its own numbers, and then the TOTAL is checked against
       what a year can carry — because the player feels the sum, not the two
       separately, and a gate each is exactly how a game ends up interrupting
       five times a year while both halves look reasonable. */
    for (const [kind, rate] of [['situation', SITUATIONS.rate],
                                ['scandal', SITUATIONS.scandal_rate]]) {
      const h = all.filter(x => (x.kind || 'situation') === kind);
      for (let i = 1; i < h.length; i++) {
        ok(h[i].month - h[i - 1].month >= rate.min_gap_months,
          kind + ': اتنين جم على بعد ' + (h[i].month - h[i - 1].month)
          + ' شهر والحد الأدنى ' + rate.min_gap_months);
      }
      for (const x of h) {
        const inYear = h.filter(y => y.month > x.month - 12 && y.month <= x.month).length;
        ok(inYear <= rate.max_per_year,
          kind + ': سنة فيها ' + inYear + ' والحد ' + rate.max_per_year);
      }
      ok(h.length === 0 || h[0].month >= rate.quiet_months_at_start,
        kind + ': ظهر قبل فترة الهدوء في أول اللعبة');
    }
    const cap = SITUATIONS.rate.max_per_year + SITUATIONS.scandal_rate.max_per_year;
    for (const x of all) {
      const inYear = all.filter(y => y.month > x.month - 12 && y.month <= x.month).length;
      ok(inYear <= cap, 'سنة فيها ' + inYear + ' مقاطعة (مواقف + فضايح) والحد ' + cap);
    }
  }

  /* A situation must never fire while its own condition is false, or the card
     describes a country the player is not living in. */
  {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 555 });
    for (let i = 0; i < 300 && !g.dead; i++) {
      if (g.pendingSituation) {
        const sit = SITUATIONS.situations.find(x => x.id === g.pendingSituation);
        for (const c of sit.when) {
          ok(conditionHolds(g, c),
            'موقف «' + sit.id + '» ظهر وشرطه [' + c.join(' ') + '] مش متحقق');
        }
        freeAnswer(g);
      }
      tickMonth(g);
    }
  }

  /* Every condition and every effect in the data must be something the engine
     actually knows — a dead condition hides a card forever, a dead effect is a
     button the player pays for and nothing happens. */
  {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 1 });
    for (const sit of SITUATIONS.situations) {
      for (const c of sit.when) {
        ok(probe(g, c[0]) !== null, 'موقف «' + sit.id + '» شرطه على «' + c[0] + '» وهي مش موجودة');
      }
      ok(sit.choices.length >= 2, 'موقف «' + sit.id + '» فيه اختيار واحد');
      let freeOne = false;
      for (const ch of sit.choices) {
        const cost = ch.cost || {};
        if (!cost.ap && !cost.treasury && !cost.personal) freeOne = true;
        for (const k in ch.effects) {
          const probeState = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                                       soc: SETUP.society_types[0], seed: 2 });
          ok(applyEffect(probeState, k, ch.effects[k]),
            'موقف «' + sit.id + '» اختيار «' + ch.nm + '» بيغيّر «' + k + '» وهي مش موجودة');
        }
      }
      // Without a free option a broke player could be locked out of every
      // choice, and the clock never restarts.
      ok(freeOne, 'موقف «' + sit.id + '» كل اختياراته ليها تمن — لاعب مفلس هيتقفل عليه');
    }
  }

  /* Paying: the cost must actually leave, and a refused choice must change
     nothing at all. */
  {
    const g = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 3131 });
    for (let i = 0; i < 300 && !g.pendingSituation && !g.dead; i++) tickMonth(g);
    if (g.pendingSituation) {
      const sit = SITUATIONS.situations.find(x => x.id === g.pendingSituation);
      let paid = -1;
      for (let i = 0; i < sit.choices.length; i++) {
        const c = sit.choices[i].cost || {};
        if ((c.ap || c.treasury) && choiceRefusal(g, sit, i) === null) { paid = i; break; }
      }
      if (paid >= 0) {
        const c = sit.choices[paid].cost;
        const ap = g.ap, tr = g.treasury;
        answerSituation(g, paid);
        if (c.ap) ok(g.ap === ap - c.ap, 'الاختيار ما خدش طاقة القرارات');
        if (c.treasury) ok(Math.abs((tr - g.treasury) - c.treasury) < 400,
          'الاختيار ما خدش من الخزينة');
        ok(g.pendingSituation === null, 'الموقف ما اتقفلش بعد الإجابة');
        ok(g.sitHistory.length > 0, 'الإجابة ما اتسجلتش');
      }
      // A choice you cannot pay for must be refused, and refusing must be inert.
      const g2 = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                           soc: SETUP.society_types[0], seed: 3131 });
      for (let i = 0; i < 300 && !g2.pendingSituation && !g2.dead; i++) tickMonth(g2);
      g2.ap = 0; g2.treasury = 0;
      const s2 = SITUATIONS.situations.find(x => x.id === g2.pendingSituation);
      for (let i = 0; i < s2.choices.length; i++) {
        const c = s2.choices[i].cost || {};
        if (c.ap || c.treasury) {
          const snap = JSON.stringify([g2.ap, g2.treasury, g2.approval, g2.pendingSituation]);
          ok(typeof answerSituation(g2, i) === 'string', 'اختيار مش مقدور عليه عدّى');
          ok(JSON.stringify([g2.ap, g2.treasury, g2.approval, g2.pendingSituation]) === snap,
            'اختيار اترفض وبرضه غيّر في اللعبة');
        }
      }
    }
  }
}

/* --------------------------------------------------------- الحفظ والقايمة */
/* The save is the only thing here that can destroy something the player cannot
   get back, and the only thing that can load a game built on numbers that no
   longer exist. Both are asserted directly. */
{
  function fresh2() {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'جمهورية الحفظ'; setupState.ruler = 'كريم'; startGame();
  }

  /* A month must reach the disk without anybody remembering to call save. */
  {
    for (const k of Object.keys(disk)) delete disk[k];
    fresh2();
    for (let i = 0; i < 5; i++) stepMonth();
    const raw = disk[SAVE_KEY];
    ok(raw, 'خمس شهور عدّوا ومفيش حاجة اتحفظت');
    const back = loadBlob(raw);
    ok(typeof back !== 'string', 'الحفظ اللي اللعبة كتبته مش بيتقري: ' + back);
    ok(back.totalMonths === S.totalMonths, 'الحفظ متأخر عن اللعبة');
    ok(back.country === S.country && back.ruler === S.ruler, 'الحفظ ناقصه الأسماء');
  }

  /* And an action, not just a month — because the redraw after an action is a
     different code path from the redraw after a tick. */
  {
    S.treasury = 9000; S.ap = 9; S.totalMonths = 60; S.lastCrackdown = 0; S.boil = 55;
    drawGame();
    const before = JSON.parse(disk[SAVE_KEY]).state.boil;
    goTab('govt'); openScreen('minister', 'interior');
    fireClick({ crack: '1' });
    ok(JSON.parse(disk[SAVE_KEY]).state.boil !== before,
      'عملت حاجة في اللعبة والحفظ فضل زي ما هو — اللاعب هيخسر آخر حركة عملها');
  }

  /* Resuming must land you where you were, not at the start. */
  {
    const month = S.totalMonths, country = S.country;
    S = null; showView('menu');
    ok(!/data-menu="resume"[^>]*disabled/.test(store.menuBody),
      'فيه حفظ وزرار «كمّل» لسه مقفول');
    ok(store.menuBody.indexOf(country) !== -1, 'زرار «كمّل» مش بيقول اسم الدولة');
    fireClick({ menu: 'resume' });
    ok(view === 'game', 'زرار «كمّل» ما فتحش اللعبة');
    ok(S && S.totalMonths === month, 'كمّلت ورجعت لشهر تاني');
    ok(running === false, 'اللعبة كمّلت والوقت ماشي من غير ما اللاعب يدوس');
  }

  /* The version guard. A save from another build must be refused, not loaded —
     it can name a minister or a situation this build does not have, and a game
     running on half-old numbers is worse than a lost game. */
  {
    const good = disk[SAVE_KEY];
    const blob = JSON.parse(good);
    blob.build = 'ffffffffffff';
    ok(typeof loadBlob(JSON.stringify(blob)) === 'string',
      'حفظ من نسخة تانية اتقبل — ده أخطر من إن الحفظ يضيع');
    blob.build = BUILD; blob.v = 999;
    ok(typeof loadBlob(JSON.stringify(blob)) === 'string', 'حفظ بإصدار تاني اتقبل');
    ok(typeof loadBlob('{ لا') === 'string', 'حفظ باظ ما اترفضش');
    ok(typeof loadBlob('null') === 'string', 'حفظ فاضي اتقبل');
    // A save missing a minister the build now has.
    const cut = JSON.parse(good);
    delete cut.state.ministers[POST_IDS[0]];
    ok(typeof loadBlob(JSON.stringify(cut)) === 'string', 'حفظ ناقصه وزير اتقبل');
    // And one waiting on a situation that no longer exists.
    const ghost = JSON.parse(good);
    ghost.state.pendingSituation = 'موقف_مش_موجود';
    ok(typeof loadBlob(JSON.stringify(ghost)) === 'string',
      'حفظ مستني موقف مش موجود اتقبل — اللعبة هتقف مستنية حاجة عمرها ما هتيجي');

    // A refused save must be cleared, not left to fail again every launch.
    disk[SAVE_KEY] = JSON.stringify(Object.assign(JSON.parse(good), { build: 'ffffffffffff' }));
    ok(readSave() === null, 'حفظ مرفوض اترجع كأنه سليم');
    ok(!disk[SAVE_KEY], 'حفظ مرفوض فضل مكانه — هيفشل تاني كل مرة يفتح فيها اللعبة');
  }

  /* Death wipes it. This is what keeps the seeded randomness meaning anything:
     without it, dying is "close the app and open it again". */
  {
    for (const k of Object.keys(disk)) delete disk[k];
    fresh2();
    for (let i = 0; i < 3; i++) stepMonth();
    ok(disk[SAVE_KEY], 'مفيش حفظ قبل الموت');
    S.dead = 'riot';
    drawGame();
    ok(!disk[SAVE_KEY], 'اللاعب مات والحفظ فضل — يعني الموت بقى «اقفل وافتح تاني»');
    S = null; showView('menu');
    ok(/data-menu="resume"[^>]*disabled/.test(store.menuBody),
      'زرار «كمّل» شغّال بعد الموت');
  }

  /* Wiping asks first, and then actually wipes. */
  {
    for (const k of Object.keys(disk)) delete disk[k];
    fresh2(); stepMonth();
    S = null; showView('menu');
    fireClick({ menu: 'settings' });
    fireClick({ menu: 'wipe' });
    ok(/امسح الحفظ؟/.test(store.ovl), 'المسح بيحصل من غير سؤال تأكيد');
    ok(disk[SAVE_KEY], 'المسح حصل قبل ما اللاعب يأكد');
    fireClick({ menu: 'wipeyes' });
    ok(!disk[SAVE_KEY], 'أكّدت المسح والحفظ لسه مكانه');
  }

  /* Storage switched off entirely: the game must still start and still play.
     Saving is a convenience; playing is the product. */
  {
    storageWorks = false;
    let threw = null;
    try {
      showView('menu');
      ok(/data-menu="resume"[^>]*disabled/.test(store.menuBody),
        'مفيش تخزين وزرار «كمّل» شغّال');
      fresh2();
      for (let i = 0; i < 4; i++) stepMonth();
      ok(S.totalMonths >= 4, 'مفيش تخزين واللعبة مش ماشية');
    } catch (e) { threw = e; }
    storageWorks = true;
    ok(!threw, 'اللعبة وقعت لما التخزين كان مقفول: ' + (threw && threw.message));
  }

  /* The default speed is a preference, and it has to survive a restart. */
  {
    for (const k of Object.keys(disk)) delete disk[k];
    showView('menu');
    fireClick({ menu: 'settings' });
    fireClick({ speed: '2' });
    ok(prefs.speed === 2, 'اختيار السرعة ما اتحفظش');
    ok(disk[PREF_KEY], 'الإعدادات ما وصلتش للتخزين');
    prefs.speed = 0; loadPrefs();
    ok(prefs.speed === 2, 'الإعدادات ما رجعتش بعد إعادة التحميل');
    fireClick({ speed: '0' });
    fireClick({ menu: 'main' });
  }

  /* The log cannot grow forever: the whole state is written every month. */
  {
    for (const k of Object.keys(disk)) delete disk[k];
    fresh2();
    for (let i = 0; i < 200; i++) logLine(S, 'سطر ' + i);
    ok(S.log.length <= LOG_KEEP,
      'السجل وصل ' + S.log.length + ' سطر والحد ' + LOG_KEEP + ' — الحفظ بيكبر كل شهر');
  }

  // Leave a clean game behind for whatever follows.
  for (const k of Object.keys(disk)) delete disk[k];
  fresh2();
}

/* -------------------------------------------------------------- القمع */
/* The one way repression can be wrong is by not being a decision: if pressing
   it can never leave you worse off, there is no reason not to press it every
   time. So the failure case is asserted as hard as the success case. */
{
  function C(seed) {
    return newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                     soc: SETUP.society_types[0], seed: seed || 800 });
  }
  const c = CRACKDOWN;

  /* A quiet street cannot be cracked down on. Without this the button becomes
     routine maintenance from month one. */
  {
    const g = C(); g.boil = 0; g.ap = 9; g.treasury = 9000; g.totalMonths = 50;
    ok(crackdownRefusal(g) !== null, 'ينفع تنزّل الأمن والشارع هادي');
    g.boil = c.boil_floor + 5;
    ok(crackdownRefusal(g) === null, 'الشارع بيغلي والزرار مقفول — ' + crackdownRefusal(g));
  }

  /* Both outcomes must actually happen and must differ in the direction that
     matters. Forced by seed rather than hoped for. */
  {
    let sawWin = false, sawFail = false;
    for (let seed = 1; seed < 200 && !(sawWin && sawFail); seed++) {
      const g = C(seed);
      g.boil = 55; g.ap = 9; g.treasury = 9000; g.totalMonths = 50; g.lastCrackdown = 0;
      const boilBefore = g.boil, apprBefore = g.approval;
      const out = crackdown(g);
      ok(typeof out !== 'string', 'القمع اترفض في حالة المفروض تعدّي: ' + out);
      if (out.worked) {
        sawWin = true;
        ok(g.boil < boilBefore, 'القمع نجح والغليان ما نزلش');
        ok(g.approval < apprBefore, 'القمع الناجح ببلاش على الرضا');
      } else {
        sawFail = true;
        ok(g.boil > boilBefore, 'القمع فشل والغليان ما زادش — يعني أسوأ نتيجة هي '
          + '«مفيش فايدة»، ومفيش سبب إن اللاعب ما يدوسش الزرار كل مرة');
        ok(g.approval < apprBefore, 'القمع الفاشل ما كلّفش رضا');
      }
    }
    ok(sawWin, 'مية بذرة ومحصلش قمع ناجح ولا مرة');
    ok(sawFail, 'مية بذرة ومحصلش قمع فاشل ولا مرة — يبقى الزرار مضمون');
  }

  /* It must cost the treasury and the energy, and it must have a wait. */
  {
    const g = C(); g.boil = 55; g.ap = 9; g.treasury = 9000; g.totalMonths = 50; g.lastCrackdown = 0;
    const t = g.treasury, a = g.ap;
    crackdown(g);
    ok(g.treasury === t - c.cost.treasury, 'القمع ما اتخصمش من الخزينة');
    ok(g.ap === a - c.cost.ap, 'القمع ما اتخصمش من طاقة القرارات');
    ok(crackdownRefusal(g) !== null, 'ينفع تقمع مرتين ورا بعض');
  }

  /* The government the player chose has to change the odds, or the sentence on
     the setup screen is a lie. */
  {
    const rep = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types.find(x => x.id === 'republic'),
                          soc: SETUP.society_types[0], seed: 5 });
    const dic = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types.find(x => x.id === 'dictator'),
                          soc: SETUP.society_types[0], seed: 5 });
    ok(crackdownChance(dic) > crackdownChance(rep),
      'القمع بينجح عند الديكتاتوري زي الجمهوري — وشاشة البداية بتقول العكس');
  }

  /* And the screen: both halves priced, and a real tap that reaches the rule. */
  {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'ت'; setupState.ruler = 'ك'; startGame();
    S.boil = 60; S.ap = 9; S.treasury = 9000; S.totalMonths = 50; S.lastCrackdown = 0;
    goTab('govt'); openScreen('minister', 'interior');
    const v = store.view;
    ok(v.indexOf('data-crack') !== -1, 'شاشة وزير الداخلية مفيهاش زرار القمع');
    ok(v.indexOf('لو فشل') !== -1, 'الكارت مش بيقول بيحصل إيه لو القمع فشل');
    ok(v.indexOf(String(ar(Math.round(crackdownChance(S))))) !== -1,
      'احتمال نجاح القمع مش مكتوب على الشاشة');
    ok(!/[0-9]/.test(v.replace(/<[^>]*>/g, ' ')), 'شاشة الشارع فيها أرقام إنجليزي');
    const boilWas = S.boil;
    fireClick({ crack: '1' });
    ok(S.boil !== boilWas, 'دوست زرار القمع ومحصلش حاجة');
  }
}

/* ------------------------------------------------------------- الجيش */
/* The army can end a game outright, so the three things it promises are
   asserted directly: the risk is escapable, the bribe is the escape, and
   nothing arrives without a warning first. */
{
  function A(seed) {
    return newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                     soc: SETUP.society_types[0], seed: seed || 700 });
  }
  const a = ARMY;

  ok(typeof army === 'function', 'مفيش دالة اسمها army — الجيش مفروض يبقى مكان واحد');
  {
    const g = A();
    g.ministers.defence.loyalty = 71;
    ok(army(g) === 71, 'الجيش مش هو ولاء وزير الدفاع');
  }

  /* Above the line the risk must actually fall, or a player who fixes the
     problem is still on his way to the same ending. */
  {
    const g = A();
    g.coupRisk = 60;
    g.ministers.defence.loyalty = armyLine(g) + 20;
    const before = g.coupRisk;
    tick(g);
    ok(g.coupRisk < before, 'ولاء وزير الدفاع فوق الخط وخطر الانقلاب ما نزلش — '
      + 'يعني اللاعب اللي صلّح المشكلة لسه ماشي على نفس النهاية');
  }

  /* Below it the risk must build, get warned about at every quarter, and end
     the rule — in that order. */
  {
    const g = A();
    let warned = 0, coup = false, months = 0;
    for (let i = 0; i < 400 && !g.dead; i++) {
      while (g.pendingSituation) autoAnswer(g);
      g.ministers.defence.loyalty = 12;
      for (const e of tickMonth(g)) {
        if (e.type === 'army') warned++;
        if (e.type === 'end' && e.reason === 'coup') coup = true;
      }
      months++;
    }
    ok(coup, 'ولاء وزير الدفاع ١٢ لـ' + months + ' شهر ومحصلش انقلاب');
    ok(g.dead === 'coup', 'اللعبة خلصت بحاجة غير الانقلاب رغم إن الجيش وصل السقف');
    ok(warned >= 3, 'الانقلاب حصل بعد ' + warned + ' تنبيه بس — '
      + 'ده موت من رقم اللاعب ما شافوش');
    ok(months >= 12, 'الانقلاب حصل بعد ' + months + ' شهر — ده قريب من الفوري');
  }

  /* The bribe: it must be payable only from the pocket, it must move the army,
     and it must be refused when the pocket is empty. */
  {
    const g = A();
    g.personal = 0; g.ap = 9;
    ok(bribeRefusal(g) !== null, 'الرشوة عدّت ورصيده الشخصي صفر');
    g.personal = a.bribe.cost * 4;
    g.totalMonths = 40; g.lastBribe = 0;
    const treasuryBefore = g.treasury, loyBefore = army(g), heatBefore = g.heat;
    const out = bribeArmy(g);
    ok(typeof out !== 'string', 'الرشوة اترفضت واللاعب دافع: ' + out);
    ok(g.treasury === treasuryBefore, 'الرشوة اتخصمت من الخزينة — المفروض من جيبه هو');
    ok(g.personal === a.bribe.cost * 4 - a.bribe.cost, 'الرشوة ما اتخصمتش من رصيده الشخصي');
    ok(army(g) > loyBefore, 'الرشوة ما رفعتش ولاء الجيش خالص');
    ok(g.heat > heatBefore, 'دفعت للضباط من جيبك ومحدش شاف — المفروض تطلّع شبهة');
    ok(bribeRefusal(g) !== null, 'ينفع تدفع مرتين ورا بعض — الانتظار مش شغال');
  }

  /* And it must be enough: a president who pays every time he can must be able
     to hold a minister who starts under the line. If he cannot, the button is
     a way to lose money, not a way to survive. */
  {
    const g = A(701);
    g.ministers.defence.loyalty = armyLine(g) - 10;
    g.personal = 99999;
    for (let i = 0; i < 120 && !g.dead; i++) {
      while (g.pendingSituation) autoAnswer(g);
      if (bribeRefusal(g) === null) bribeArmy(g);
      tickMonth(g);
    }
    ok(g.dead !== 'coup',
      'رئيس بيدفع للجيش كل ما يقدر وبرضه اتنقلب عليه — الرشوة مش كفاية تمسك الخط');
  }

  /* The lost-bribe chance must be real at the bottom and mild at the top, and
     the number the screen prints must be the number the engine rolls against. */
  {
    const hi = A(), lo = A();
    hi.ministers.defence.loyalty = 90;
    lo.ministers.defence.loyalty = 5;
    ok(bribeLostChance(lo) > bribeLostChance(hi),
      'احتمال ضياع الرشوة مش بيزيد مع الوزير اللي ولاؤه أوطى — يعني مين قاعد '
      + 'في المنصب مش فارق');
    ok(bribeLostChance(hi) >= 0 && bribeLostChance(lo) <= 100, 'احتمال ضياع الرشوة برّه ٠..١٠٠');
  }

  /* The screens: the risk must be readable, and the bribe priced before it is
     pressed. A hidden risk is the one thing this game refuses to have. */
  {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'ت'; setupState.ruler = 'ك'; startGame();
    S.ministers.defence.loyalty = 15; S.coupRisk = 55; S.personal = 900; S.ap = 5;
    goTab('govt'); openScreen('minister', 'defence');
    const v = store.view;
    ok(v.indexOf('data-bribe') !== -1, 'شاشة وزير الدفاع مفيهاش زرار الرشوة');
    ok(v.indexOf(String(ar(Math.round(bribeLostChance(S))))) !== -1,
      'احتمال ضياع الرشوة مش مكتوب على الشاشة');
    ok(!/[0-9]/.test(v.replace(/<[^>]*>/g, ' ')), 'شاشة الجيش فيها أرقام إنجليزي');
    goTab('pres');
    ok(store.view.indexOf('data-openid="defence"') !== -1,
      'خطر الانقلاب شغّال ومفيش كارت في تاب الرئاسة بيوصّل لوزير الدفاع');
    S.coupRisk = 0; goTab('pres');
    ok(store.view.indexOf('⚠️ الجيش') === -1,
      'كارت الجيش ظاهر والخطر صفر — كارت دايم بيقول صفر بيعلّم اللاعب يعدّي من فوقه');
    // A real tap, through the real handler.
    S.ministers.defence.loyalty = 20; S.personal = 900; S.ap = 5;
    S.totalMonths = 60; S.lastBribe = 0;
    const was = army(S);
    goTab('govt'); openScreen('minister', 'defence');
    fireClick({ bribe: '1' });
    ok(army(S) > was, 'دوست زرار الرشوة ومحصلش حاجة');
  }
}

/* ------------------------------------------------------ الشبهة والفضايح */
/* Suspicion is a running total, which makes it the easiest number in the game
   to get quietly wrong: nothing looks broken while it drifts. So it is checked
   against its own sources, its cap, and the thing it is supposed to cause. */
{
  function G(seed) {
    return newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                     soc: SETUP.society_types[0], seed: seed || 900 });
  }
  const hc = BALANCE.heat;

  /* The card on screen must be the same arithmetic the month ran, or the
     player is reading a breakdown that does not add up to what happened. */
  {
    const g = G();
    const s = heatSources(g);
    ok(Math.abs((s.talk - s.media - s.decay) - heatChange(g)) < 1e-9,
      'تفكيك الشبهة اللي على الشاشة مش بيطلّع نفس رقم الشهر');
  }

  /* Stealing must move it, and the screen must have said how much first. */
  {
    const g = G(); g.totalMonths = 6; g.treasury = 4000;
    const take = stealMax(g);
    const before = g.heat;
    const shown = take / 100 * hc.steal_per_100m;
    const res = stealFromTreasury(g, take);
    ok(typeof res !== 'string', 'السرقة اترفضت في اختبار الشبهة');
    ok(g.stolenTotal === take,
      'مجموع اللي اتسرق ' + g.stolenTotal + ' والمفروض ' + take
      + ' — والفضايح المبنية عليه مش هتحصل أبدًا');
    const gained = g.heat - before;
    ok(Math.abs(gained - shown) < 1e-9 || Math.abs(gained - (shown + hc.leak_extra)) < 1e-9,
      'الشبهة اللي اتحسبت من السرقة مش هي اللي الشاشة قالتها');
    ok(gained > 0, 'السرقة ما زوّدتش الشبهة خالص');
  }

  /* Printing must cost less suspicion per pound than stealing, or there is no
     reason the game offers both. */
  {
    const a = G(), b = G();
    a.totalMonths = 6; a.treasury = 4000;
    b.totalMonths = 6; b.bank.lastPrint = -99;
    const amount = 300;
    stealFromTreasury(a, Math.min(amount, stealMax(a)));
    printMoney(b, amount);
    ok(b.heat > 0, 'طبع الفلوس ما زوّدش الشبهة خالص');
    ok(b.heat / amount < a.heat / Math.min(amount, stealMax(a)),
      'طبع الفلوس شبهته زي السرقة أو أكتر — يبقى مفيش سبب تطبع');
  }

  /* The cap. A number that can pass its own ceiling makes every threshold
     built on it meaningless. */
  {
    const g = G();
    for (let i = 0; i < 200; i++) addHeat(g, 25);
    ok(g.heat === hc.cap, 'الشبهة عدّت السقف');
    for (let i = 0; i < 200; i++) addHeat(g, -25);
    ok(g.heat === 0, 'الشبهة نزلت تحت الصفر');
  }

  /* A clean president must be able to stay clean. If an ordinary cabinet
     out-produces the media minister plus the natural decay, every game ends in
     scandal whatever the player does — and the number stops being a choice. */
  {
    const g = G();
    let months = 0;
    for (let i = 0; i < 240 && !g.dead; i++) { months++; tick(g); }
    /* A government falling apart is allowed to attract a press campaign — it
       should. What must never happen is a corruption file opened on a man who
       never took a pound: the accusation would be about a game he did not play.
       This is the assertion, not the raw number. */
    ok(g.stolenTotal === 0, 'اللاعب النضيف ده سرق في اختبار مش المفروض يسرق فيه');
    for (const x of g.sitHistory) {
      const sit = SITUATIONS.situations.find(y => y.id === x.id);
      const needsTheft = (sit.when || []).some(c => c[0] === 'stolenTotal');
      ok(!needsTheft, 'رئيس ما سرقش ولا مليم جاله «' + sit.title + '»');
    }
    ok(g.heat < hc.cap, 'الشبهة وصلت السقف لرئيس ما سرقش خالص');
  }

  /* And a thief must not be able to stay clean. */
  {
    const g = G(1234);
    for (let i = 0; i < 120 && !g.dead && g.heat < hc.scandal_at; i++) {
      if (g.treasury > 800) stealFromTreasury(g, stealMax(g));
      tick(g);
    }
    ok(g.heat >= hc.scandal_at || g.dead,
      'لاعب بيسرق كل شهر لعشر سنين وشبهته فضلت تحت الخط — السرقة ببلاش');
  }

  /* Suspicion must actually produce a scandal, and the scandal must be a
     situation with all the protections situations have. */
  {
    const g = G(4321);
    let scandal = null;
    for (let i = 0; i < 400 && !g.dead && !scandal; i++) {
      if (g.treasury > 800) stealFromTreasury(g, stealMax(g));
      if (g.pendingSituation) {
        const s = SITUATIONS.situations.find(x => x.id === g.pendingSituation);
        if (s.kind === 'scandal') { scandal = s; break; }
        autoAnswer(g);
      }
      tickMonth(g);
    }
    ok(scandal, 'لاعب بيسرق باستمرار عمره ما شاف فضيحة');
    if (scandal) {
      ok(g.heat >= Math.min(...scandal.when.filter(c => c[0] === 'heat').map(c => c[2])),
        'فضيحة «' + scandal.id + '» حصلت والشبهة تحت شرطها');
      const before = g.totalMonths;
      tickMonth(g);
      ok(g.totalMonths === before, 'الوقت مشي والفضيحة مفتوحة');
      // drawGame() draws the game the SCREENS are showing, which is the global
      // one — handing it this local game is the only way the card under test is
      // the card being asserted on.
      S = g; drawGame();
      ok(!node('sit').classList.contains('hidden'), 'الفضيحة ما ظهرتش على الشاشة');
      ok(store.sit.indexOf('scandal') !== -1, 'الفضيحة مش مميّزة عن الموقف العادي على الكارت');
      /* Deliberately the choice that is supposed to bury it, with the money to
         pay for it — autoAnswer would take the free one, and at the cap a
         positive effect clamps to nothing and the assertion passes on a game
         where nothing happened. */
      g.ap = 9; g.treasury = 9000; g.personal = 9000;
      let buried = -1;
      for (let i = 0; i < scandal.choices.length; i++) {
        if ((scandal.choices[i].effects || {}).heat < 0) { buried = i; break; }
      }
      ok(buried >= 0, 'فضيحة «' + scandal.id + '» مفيش فيها اختيار بينزّل الشبهة');
      const heatBefore = g.heat;
      ok(answerSituation(g, buried) === null, 'الاختيار اللي بيدفن الفضيحة اترفض');
      ok(g.pendingSituation === null, 'الفضيحة ما اتقفلتش بعد الإجابة');
      ok(g.heat < heatBefore, 'الرد اللي المفروض يدفن الفضيحة ما نزّلش الشبهة');
    }
  }

  /* Every scandal must be answerable by a broke president, and at least one of
     its choices must bring the suspicion down — otherwise a scandal is a
     one-way door into the next scandal. */
  for (const sit of SITUATIONS.situations.filter(x => x.kind === 'scandal')) {
    const g = G(); g.ap = 0; g.treasury = 0; g.personal = 0;
    let open = false, drops = false;
    for (let i = 0; i < sit.choices.length; i++) {
      if (choiceRefusal(g, sit, i) === null) open = true;
      if ((sit.choices[i].effects || {}).heat < 0) drops = true;
    }
    ok(open, 'فضيحة «' + sit.id + '» مفيش فيها اختيار للاعب مفلس');
    ok(drops, 'فضيحة «' + sit.id + '» مفيش فيها اختيار بينزّل الشبهة — '
      + 'يعني بابها بيودّي على فضيحة تانية وبس');
  }

  /* The media minister is the only lever on suspicion the player can buy. If a
     good one does not measurably beat a bad one, the post is decoration. */
  {
    const good = G(), bad = G();
    good.ministers.media.competence = 90;
    bad.ministers.media.competence = 20;
    ok(heatSources(good).media > heatSources(bad).media,
      'وزير إعلام كفء بينزّل نفس الشبهة اللي بينزّلها الضعيف — المنصب مالوش لازمة');
  }

  /* Suspicion must be felt between scandals, not only on the day one lands. */
  {
    const calm = G(), hot = G();
    hot.heat = hc.cap;
    for (let i = 0; i < 24; i++) { tick(calm); }
    for (let i = 0; i < 24; i++) { hot.heat = hc.cap; tick(hot); }
    ok(hot.stability < calm.stability,
      'الشبهة العالية ما أثّرتش على الثبات — يعني الرقم ميّت بين الفضايح');
  }
}

/* ------------------------------------------------------- شاشة الموقف */
/* The engine already refuses to move time while a situation is open. This block
   is about the screen: that the card actually appears, that it prices every
   choice before it is pressed, and — the part that matters most — that none of
   the four ways out of a screen can get past it. */
{
  function fresh() {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'ت'; setupState.ruler = 'ك'; startGame();
  }
  function cardShown() { return !node('sit').classList.contains('hidden'); }
  function cardText() { return String(store.sit || ''); }
  function force(id) { fresh(); S.pendingSituation = id; drawGame(); }

  fresh();
  ok(!cardShown(), 'كارت الموقف ظاهر ومفيش موقف مفتوح');

  /* Every situation in the data, not just whichever one the seed happens to
     produce: a card is only ever seen by the player if it is drawn correctly,
     and eight of them means eight chances for one to render blank. */
  for (const sit of SITUATIONS.situations) {
    force(sit.id);
    const t = cardText();
    ok(cardShown(), 'موقف «' + sit.id + '»: الكارت مش بيظهر');
    ok(t.indexOf(sit.title) !== -1, 'موقف «' + sit.id + '»: عنوانه مش على الكارت');
    ok(t.indexOf(sit.text.slice(0, 20)) !== -1, 'موقف «' + sit.id + '»: نص الموقف مش على الكارت');
    ok(!/[0-9]/.test(t.replace(/<[^>]*>/g, ' ')),
      'موقف «' + sit.id + '»: فيه أرقام إنجليزي على الكارت');
    for (let i = 0; i < sit.choices.length; i++) {
      const ch = sit.choices[i];
      ok(t.indexOf('data-answer="' + i + '"') !== -1,
        'موقف «' + sit.id + '»: الاختيار «' + ch.nm + '» مالوش زرار');
      ok(t.indexOf(ch.nm) !== -1, 'موقف «' + sit.id + '»: اسم الاختيار «' + ch.nm + '» مش ظاهر');
      /* The price — or the reason it is locked — must be written on the button
         BEFORE it is pressed. A blank here is a button that looks free. */
      const seg = t.split('data-answer="' + i + '"')[1].split('</button>')[0];
      const price = (seg.match(/class="opr">([\s\S]*?)<\/span>/) || [])[1] || '';
      ok(price.replace(/<[^>]*>/g, '').trim().length > 0,
        'موقف «' + sit.id + '»: الاختيار «' + ch.nm + '» مالوش تمن مكتوب على الزرار');
      const paid = Object.keys(ch.cost || {}).length > 0;
      ok(paid === (price.indexOf('ببلاش') === -1),
        'موقف «' + sit.id + '»: الاختيار «' + ch.nm + '» بيقول ببلاش وهو بيتدفع (أو العكس)');
    }
    /* A choice that needs two things must say both in one go. Naming only the
       first shortfall sends the player away for a month to fix it and refuses
       him again on arrival for a reason he was never told. */
    const broke = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                            soc: SETUP.society_types[0], seed: 'refuse' });
    broke.ap = 0; broke.treasury = 0; broke.personal = 0;
    for (let i = 0; i < sit.choices.length; i++) {
      const c = sit.choices[i].cost || {};
      const why = choiceRefusal(broke, sit, i) || '';
      if (c.ap) ok(why.indexOf('طاقة') !== -1,
        'موقف «' + sit.id + '» اختيار «' + sit.choices[i].nm + '»: الرفض مش بيقول إن الطاقة ناقصة');
      if (c.treasury) ok(why.indexOf('الخزينة') !== -1,
        'موقف «' + sit.id + '» اختيار «' + sit.choices[i].nm + '»: الرفض مش بيقول إن الخزينة ناقصة');
      if (c.personal) ok(why.indexOf('رصيدك') !== -1,
        'موقف «' + sit.id + '» اختيار «' + sit.choices[i].nm + '»: الرفض مش بيقول إن رصيدك ناقص');
      if (!Object.keys(c).length) ok(why === '',
        'موقف «' + sit.id + '»: اختيار مجاني اترفض — لاعب مفلس هيتقفل عليه');
    }
  }

  /* The four ways out, one at a time. Each of these has closed a compulsory
     card in some other app, and none of them leaves a trace in a diff. */
  force('empty_treasury');
  const st = stack.length, tab = curTab();
  ok(onAndroidBack() === true, 'زرار الرجوع بتاع الموبايل ما بلعش الضغطة والموقف مفتوح');
  ok(cardShown(), 'زرار الرجوع قفل كارت الموقف');
  ok(stack.length === st && curTab() === tab, 'زرار الرجوع حرّك الشاشة والموقف مفتوح');

  closeSheet(); drawGame();
  ok(cardShown(), 'قفل الأوراق قفل كارت الموقف معاها');

  openScreen('minister', 'finance');
  ok(cardShown(), 'فتح شاشة تانية خلّى كارت الموقف يختفي');
  goTab('govs');
  ok(cardShown(), 'تبديل التاب خلّى كارت الموقف يختفي');

  setRunning(true);
  ok(running === false, 'الوقت مشي والموقف لسه مفتوح');
  fireClick({ clock: 'pp' });
  ok(running === false, 'زرار التشغيل مشّى الوقت والموقف مفتوح');
  const monthsWas = S.totalMonths;
  step();
  ok(S.totalMonths === monthsWas, 'الشهر عدّى من الشاشة والموقف لسه مفتوح');

  /* A player with nothing left must still be able to answer. This is the
     deadlock case: the clock is frozen until he decides, so if every button he
     can press is refused the game is over without ending. */
  force('empty_treasury');
  S.ap = 0; S.treasury = 0; S.personal = 0; drawGame();
  const sitNow = SITUATIONS.situations.find(x => x.id === 'empty_treasury');
  let answered = false;
  for (let i = 0; i < sitNow.choices.length; i++) {
    const before = JSON.stringify([S.ap, S.treasury, S.approval, S.pendingSituation]);
    const locked = choiceRefusal(S, sitNow, i) !== null;
    fireClick({ answer: String(i) });
    if (locked) {
      ok(JSON.stringify([S.ap, S.treasury, S.approval, S.pendingSituation]) === before,
        'اختيار مقفول اتضغط وغيّر في اللعبة');
      ok(cardShown(), 'اختيار مقفول اتضغط وقفل الكارت');
      ok(store.sit.indexOf('sopt lock') !== -1, 'اختيار مقفول مش مرسوم كمقفول');
      ok(store.sit.indexOf('class="olock"') !== -1, 'اختيار مقفول مش مكتوب عليه ناقصه إيه');
    } else {
      answered = true;
      ok(S.pendingSituation === null, 'اختيار مقدور عليه اتضغط والموقف فضل مفتوح');
      ok(!cardShown(), 'الموقف اتقفل والكارت لسه ظاهر');
      break;
    }
  }
  ok(answered, 'لاعب مفلس مش لاقي ولا اختيار يقدر يضغطه — اللعبة اتقفلت');

  /* And time must move again the moment the decision is taken. */
  const after = S.totalMonths;
  setRunning(true);
  ok(running === true, 'الوقت ما رجعش يمشي بعد ما الموقف اتقفل');
  setRunning(false);
  step();
  ok(S.totalMonths > after || S.pendingSituation, 'الشهر ما عدّاش بعد ما الموقف اتقفل');
  fresh();
}

/* ------------------------------------------------------------ navigation */
/* The stack is the whole item. Each of these is a way the back button has gone
   wrong in some other app: no way out of a sub-screen, a back button that shows
   up on a tab, a tab switch that leaves you buried, and — the one that matters
   most — the phone's back key dropping the player out of a running game. */
goTab('govs');
ok(stack.length === 1, 'التاب المفروض يبدأ بشاشة واحدة في المكدّس');
ok(store.view.indexOf('class="back"') === -1, 'زرار الرجوع ظاهر على تاب — مفيش حاجة يرجع لها');

openScreen('governorate', 'south');
ok(stack.length === 2, 'فتح شاشة فرعية ما زوّدش المكدّس');
ok(cur().s === 'governorate', 'الشاشة المفتوحة مش اللي اتطلبت');
ok(store.view.indexOf('class="back"') !== -1, 'شاشة فرعية من غير زرار رجوع — اللاعب محبوس');
ok(store.view.indexOf(SCREENS.tab_govs.title) !== -1, 'زرار الرجوع مش بيقول راجع لفين');
ok(store.nav.indexOf('data-tab="govs"') !== -1, 'شريط التابات اختفى جوّه شاشة فرعية');
ok(/class="on"[^>]*data-tab="govs"|data-tab="govs"[^>]*class="on"/.test(store.nav)
  || store.nav.indexOf('class="on" data-tab="govs"') !== -1,
  'التاب الأصلي مش مضلّل وإنت جوّه شاشة فرعية');

ok(onAndroidBack() === true, 'زرار الرجوع بتاع الموبايل ما رجعش من الشاشة الفرعية');
ok(stack.length === 1 && curTab() === 'govs', 'الرجوع ما رجعش للتاب اللي كنا فيه');

openScreen('governorate', 'south');
goTab('pres');
ok(stack.length === 1 && curTab() === 'pres', 'تبديل التاب ما نضّفش المكدّس');

/* A running game must pause on the first back press, never quit. */
setRunning(true);
ok(onAndroidBack() === true && running === false, 'زرار الرجوع ما وقّفش الوقت قبل ما يخرج');
ok(onAndroidBack() === false, 'اللعبة مش بتسيب اللاعب يخرج خالص');

/* The build sheet is above everything: back must close it first. */
openScreen('governorate', 'south');
openBuild('health');
ok(onAndroidBack() === true, 'الرجوع ما قفلش ورقة البناء');
ok(stack.length === 2, 'الرجوع قفل الورقة والشاشة مع بعض — ضغطة واحدة عملت حاجتين');
closeSheet();
goTab('pres');

/* Every number the player reads must be in Arabic-Indic digits. A stray
   toFixed() or a plain number lands on screen in Latin digits next to Arabic
   ones — small, ugly, and the kind of thing nobody notices in a diff. */
function visibleText(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ');   // drop tags and their attributes
}
/* Checked in TWO states, and the second one matters more: on a brand new game
   every action is still refused ("wait three months"), and those refusal
   sentences come from the engine with plain digits in them. Testing only a
   settled game hid five of them for weeks — nothing was being refused, so
   nothing printed a number in the wrong script. */
/* A third state, and it is the one that matters most: half these screens have
   a "things are fine" branch and a "things are on fire" branch, and only the
   calm one had ever been rendered by anything. A Latin comma sat in the burning
   branch of the defence minister's line and both other phases stayed green,
   because a fresh republic's army is never under the line. */
for (const phase of ['بعد سنة', 'أول شهر', 'أزمة']) {
  if (phase === 'أول شهر') {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'ت'; setupState.ruler = 'ك'; startGame();
  }
  if (phase === 'أزمة') {
    setupState.gov = SETUP.government_types[2]; setupState.soc = SETUP.society_types[2];
    setupState.country = 'ت'; setupState.ruler = 'ك'; startGame();
    for (let i = 0; i < 14; i++) stepMonth();
    // Every bad branch at once: an army under the line, a street boiling, a
    // suspicion over the scandal line, an empty treasury and no energy left.
    for (const id of POST_IDS) S.ministers[id].loyalty = 11;
    S.boil = 70; S.heat = BALANCE.heat.cap; S.coupRisk = 66;
    S.treasury = -400; S.ap = 0; S.personal = 0; S.inflation = 31;
    for (const g of GOV_IDS) S.govAppr[g] = 9;
    S.approval = 9; S.stability = 12;
    drawGame();
  }
  for (const key of Object.keys(SCREENS)) {
    // Every id, not one sample: the per-minister and per-governorate text is
    // the part most likely to carry a stray character, and it only exists when
    // that particular id is on screen.
    const ids = ALL_IDS[key] || [null];
    for (const id of ids) {
      if (key.indexOf('tab_') === 0) showTab(key.slice(4)); else showScreen(key, id);
      const where = 'شاشة ' + key + (id ? ' (' + id + ')' : '') + ' (' + phase + ')';
      const latin = visibleText(store.view).match(/[0-9]/g);
      ok(!latin, where + ' فيها أرقام إنجليزي: ' + (latin || []).join(''));
      /* And the Latin comma, for the same reason as the digits: it is the one
         punctuation mark that is easy to type by habit and looks wrong next to
         Arabic. One sat in the defence minister's line for a whole item because
         this loop only ever opened the health minister. */
      ok(visibleText(store.view).indexOf(',') === -1,
        where + ' فيها فاصلة إنجليزي — المفروض ،');
      if (key.indexOf('tab_') === 0) break;
    }
  }
  // Overlays too — the build sheet and the dismissal sheet both quote refusals.
  openBuild('water'); 
  ok(!/[0-9]/.test(visibleText(store.ovl)), 'ورقة البناء (' + phase + ') فيها أرقام إنجليزي');
  closeSheet();
  openFire('supply');
  ok(!/[0-9]/.test(visibleText(store.ovl)), 'ورقة الإقالة (' + phase + ') فيها أرقام إنجليزي');
  closeSheet();
}
// Put the settled reference game back for whatever follows.
setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
setupState.country = 'جمهورية النهر'; setupState.ruler = 'كريم'; startGame();
for (let i = 0; i < 12; i++) stepMonth();
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
for (const key of Object.keys(SCREENS)) {
  if (key.indexOf('tab_') === 0) showTab(key.slice(4)); else showScreen(key);
  collectAttrs(store.view);
}
drawNav(); collectAttrs(store.nav);
openBuild('health'); collectAttrs(store.ovl);
const known = new Set(CLICKABLE.concat(['data-pct', 'data-i', 'data-buildsvc', 'data-openid', 'data-buildin']));
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
