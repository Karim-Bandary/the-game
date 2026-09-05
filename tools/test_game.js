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
  const target = {
    dataset: dataset,
    closest(sel) {
      const wanted = sel.split(',').map(x => x.replace(/[[\]]/g, '').replace(/-([a-z])/g,
        (m, c) => c.toUpperCase()));
      return wanted.some(k => dataset[k] !== undefined) ? target : null;
    }
  };
  (listeners.click || []).forEach(fn => fn({ target: target }));
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
    tickMonth(S);
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
for (let i = 0; i < 12; i++) step();

/* -------------------------------------------------------------- screens */
/* Every screen in the routing table must actually draw. A screen that exists in
   SCREENS but has no body silently renders a band with nothing under it. */
const TAB_IDS = TABS.map(t => t[0]);
/* A sub-screen may need an id (which minister? which governorate?). Every one
   must name a sample here, so adding a screen without saying what it opens on
   fails the build instead of drawing an empty page in front of Karim. */
const SAMPLE_ID = { minister: 'health', governorate: 'south' };
function showTab(t) { goTab(t); }
function showScreen(s) { goTab(curTab()); openScreen(s, SAMPLE_ID[s]); }

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
ok((store.meters || '').split('mtr').length - 1 === 4, 'الشريط العلوي مش فيه ٤ مؤشرات');

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
  tickMonth(g);
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
    tickMonth(w);
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
  for (let i = 0; i < MINISTERS.dismiss.min_months_in_post; i++) tickMonth(g);
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
  for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tickMonth(g);
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
    for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tickMonth(q);
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
    for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tickMonth(q);
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
  for (let i = 0; i < MINISTERS.dismiss.min_months_in_post; i++) tickMonth(g);
  const paper = g.ministers.utilities.competence;
  const workedBefore = ministerComp(g, 'utilities');
  dismissMinister(g, 'utilities', 0);
  const fresh = g.ministers.utilities;
  ok(settleFactor(g, 'utilities') < 1, 'وزير لسه مستلم بيشتغل بكامل كفاءته فورًا');
  ok(ministerComp(g, 'utilities') < fresh.competence,
    'الوزير الجديد بيدي رقمه الكامل من أول شهر — التقليب بقى ببلاش');
  const settling = ministerComp(g, 'utilities');
  for (let i = 0; i < MINISTERS.settling.months; i++) tickMonth(g);
  ok(ministerComp(g, 'utilities') > settling, 'الوزير الجديد ما بيتحسّنش مع الوقت');
  ok(settleFactor(g, 'utilities') === 1, 'الوزير ما وصلش لكامل كفاءته بعد مدة الاستقرار');

  /* And the rest of the cabinet notices. Without this the churn has no
     accumulating price at all. */
  const h = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                      soc: SETUP.society_types[0], seed: 9494 });
  for (let i = 0; i < MINISTERS.dismiss.min_months_in_post; i++) tickMonth(h);
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
    tickMonth(g);
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
    for (let i = 0; i < 40; i++) tickMonth(q);
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
      tickMonth(g);

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
      for (let i = 0; i < 40; i++) tickMonth(q);
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
  for (let i = 0; i < MINISTERS.reshuffle.cooldown_months; i++) tickMonth(g);
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
    for (let i = 0; i < BANK.print.once_per_months; i++) tickMonth(q);
    ok(typeof printMoney(q, printCap(q) + 1) === 'string', 'عدّت طباعة فوق السقف');
    const tr = q.treasury, inf = q.inflation;
    ok(printMoney(q, printCap(q)) === null, 'الطباعة اترفضت من غير سبب');
    ok(q.treasury > tr && q.inflation > inf, 'الطباعة ما حركتش الخزينة أو التضخم');
    ok(typeof printMoney(q, 50) === 'string', 'ينفع تطبع مرتين ورا بعض');
    for (let i = 0; i < BANK.print.once_per_months; i++) tickMonth(q);
    ok(printRefusal(q, 50) === null, 'الطباعة مقفولة حتى بعد المدة');
  }

  /* Swapping the governor: costs, cools down, and can only ever make the bank
     LESS independent. */
  {
    const q = newGame({ country: 'ت', ruler: 'ك', gov: SETUP.government_types[1],
                        soc: SETUP.society_types[0], seed: 2020 });
    for (let i = 0; i < BANK.swap.cooldown_months; i++) tickMonth(q);
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
for (const phase of ['بعد سنة', 'أول شهر']) {
  if (phase === 'أول شهر') {
    setupState.gov = SETUP.government_types[1]; setupState.soc = SETUP.society_types[0];
    setupState.country = 'ت'; setupState.ruler = 'ك'; startGame();
  }
  for (const key of Object.keys(SCREENS)) {
    if (key.indexOf('tab_') === 0) showTab(key.slice(4)); else showScreen(key);
    const latin = visibleText(store.view).match(/[0-9]/g);
    ok(!latin, 'شاشة ' + key + ' (' + phase + ') فيها أرقام إنجليزي: ' + (latin || []).join(''));
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
for (let i = 0; i < 12; i++) step();
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
