/* ============================================================================
   The screens. Reads the engine's state, never changes the rules.
   ========================================================================== */

var AR = '٠١٢٣٤٥٦٧٨٩';
function ar(n) {
  return String(Math.round(n)).replace(/-/g, '−').replace(/\d/g, function (d) { return AR[+d]; });
}
/* Decimals need the same digits as everything else, or one number on the screen
   is suddenly in a different script from its neighbours. */
function arDec(n, places) {
  return n.toFixed(places).replace(/\./g, '٫').replace(/\d/g, function (d) { return AR[+d]; });
}
/* Capacities are fractions of a million; a bare decimal is hard to read and can
   reorder badly in an RTL line. Say small numbers in thousands instead. */
function arPeople(millions) {
  if (millions < 1) return ar(Math.round(millions * 1000)) + ' ألف نسمة';
  return arDec(millions, 1) + ' مليون نسمة';
}
/* The engine refuses a move with a sentence, and those sentences carry numbers
   ("استنى ٣ كمان"). The engine has no business knowing which digits this game
   draws in, so every string that comes back from it passes through here on its
   way to the screen. Without this, five refusal messages were putting Latin
   digits next to Arabic ones — and the digit test missed them for weeks because
   it happened to test a state where nothing was being refused. */
function arText(s) {
  return String(s).replace(/[0-9]/g, function (d) { return AR[+d]; });
}
function el(id) { return document.getElementById(id); }

var S = null;                 // the game state, null while in setup

/* ------------------------------------------------------------------ menu */
/* Which of the three top-level screens is showing, and which page of the menu.
   Kept as two plain strings rather than a stack: there are only three, and a
   stack here would be machinery for a problem that does not exist. */
var view = 'menu';            // 'menu' | 'setup' | 'game'
var menuPage = 'main';        // 'main' | 'settings' | 'about'

var SAVE_KEY = 'الحكم:save';
var PREF_KEY = 'الحكم:prefs';
var prefs = { speed: 0 };

/* Storage can be missing, full, or switched off — a private window, a browser
   with site data blocked, a WebView that came back without it. Every touch goes
   through these two so a game NEVER fails to start because it could not save.
   The rule is: saving is a convenience, playing is the product. */
function storeGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
function storeSet(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch (e) { return false; }
}

function loadPrefs() {
  var raw = storeGet(PREF_KEY);
  if (!raw) return;
  try {
    var p = JSON.parse(raw);
    if (p && typeof p.speed === 'number' && p.speed >= 0 && p.speed < SPEEDS.length) {
      prefs.speed = p.speed;
    }
  } catch (e) { /* a broken preferences file is not worth a broken game */ }
}
function savePrefs() { storeSet(PREF_KEY, JSON.stringify(prefs)); }

/* Written on every redraw of the game, which is after every month and after
   every action. Putting it anywhere else would mean one branch of the click
   handler forgetting it, and the player losing exactly the move he just made. */
function persist() {
  if (!S) return;
  // The save dies with the president. Without this, dying is just "close the
  // app and open it again" — and the whole reason the randomness is tied to the
  // seed is that a situation must not be re-rollable.
  if (S.dead) { storeSet(SAVE_KEY, null); return; }
  storeSet(SAVE_KEY, saveBlob(S));
}

/* Returns the saved state, or null. A save this build cannot use is DELETED
   here rather than left to fail again on the next launch. */
function readSave() {
  var raw = storeGet(SAVE_KEY);
  if (!raw) return null;
  var out = loadBlob(raw);
  if (typeof out === 'string') { storeSet(SAVE_KEY, null); return null; }
  return out;
}

function menuView() {
  if (menuPage === 'settings') return settingsView();
  if (menuPage === 'about') return aboutView();

  var saved = readSave();
  var h = '<button class="mbtn go" data-menu="new">🏛️ ابدأ فترة حكم جديدة'
    + '<span>تختار دولتك ونظام حكمك وطبيعة مجتمعك</span></button>';
  h += '<button class="mbtn" data-menu="resume"' + (saved ? '' : ' disabled') + '>'
    + '▶️ كمّل فترة حكم'
    + '<span>' + (saved ? arText(esc(saveLabel(saved))) : 'مفيش فترة حكم محفوظة')
    + '</span></button>';
  h += '<button class="mbtn" data-menu="settings">⚙️ الإعدادات'
    + '<span>سرعة الوقت · الحفظ · عن اللعبة</span></button>';
  h += '<button class="mbtn" data-menu="exit">🚪 الخروج<span>يقفل التطبيق</span></button>';
  h += '<div class="mnote">اللعبة بتحفظ نفسها كل شهر لوحدها. '
    + 'والحفظ بيتمسح لما حكمك ينتهي — مفيش رجوع في الوقت.</div>';
  return h;
}

function settingsView() {
  var h = '<div class="mrow2"><div class="lb2">سرعة الوقت<span>اللي اللعبة بتبدأ بيها</span></div>'
    + '<div class="seg">';
  var names = ['×١', '×٢', '×٣'];
  for (var i = 0; i < SPEEDS.length; i++) {
    h += '<button class="' + (prefs.speed === i ? 'on' : '') + '" data-speed="' + i + '">'
      + names[i] + '</button>';
  }
  h += '</div></div>';

  var saved = readSave();
  h += '<div class="mrow2"><div class="lb2">فترة الحكم المحفوظة<span>'
    + (saved ? arText(esc(saveLabel(saved))) : 'مفيش حاجة محفوظة') + '</span></div></div>';
  h += '<button class="mbtn" data-menu="wipe"' + (saved ? '' : ' disabled') + '>'
    + '🗑️ امسح الحفظ وابدأ من الأول<span>هيسألك تأكيد الأول</span></button>';

  // Said plainly instead of shipping a language menu that does nothing. The
  // whole game's text lives inside the code; English is its own piece of work,
  // not a switch.
  h += '<div class="mrow2"><div class="lb2">اللغة'
    + '<span>عربي — الإنجليزي في بند جاي، لأنه بيلمس كل سطر نص في اللعبة</span></div></div>';
  h += '<button class="mbtn" data-menu="about">ℹ️ عن اللعبة<span>النسخة ورقم البناء</span></button>';
  h += '<button class="mbtn" data-menu="main">⟶ رجوع</button>';
  return h;
}

function aboutView() {
  return '<div class="mrow2"><div class="lb2">الحُكم<span>لعبة إدارة سياسية</span></div></div>'
    + '<div class="mrow2"><div class="lb2">رقم البناء<span>' + BUILD + '</span></div></div>'
    + '<div class="mnote">رقم البناء ده هو اللي الحفظ بيتربط بيه. أي رفعة ملفات '
    + 'جديدة بتغيّره، والحفظ القديم بيترفض بدل ما يشتغل بأرقام نص/نص.</div>'
    + '<button class="mbtn" data-menu="settings">⟶ رجوع</button>';
}

function drawMenu() { el('menuBody').innerHTML = menuView(); }

/* The only place the three top-level screens are shown and hidden. Anywhere
   else doing it by hand is how two of them end up visible at once. */
function showView(v) {
  view = v;
  el('menu').classList[v === 'menu' ? 'remove' : 'add']('hidden');
  el('setup').classList[v === 'setup' ? 'remove' : 'add']('hidden');
  el('game').classList[v === 'game' ? 'remove' : 'add']('hidden');
  // Coming back to the menu always lands on its front page. Leaving a game and
  // finding yourself inside the settings is the kind of small wrongness that
  // makes an app feel unfinished.
  if (v === 'menu') { menuPage = 'main'; drawMenu(); }
  if (v === 'setup') drawSetup();
  if (v === 'game') drawGame();
}

/* Closing the app is the one thing a page cannot do to itself, so it is done by
   the Android shell through this bridge. The name here and the name in
   MainActivity.java must match — check_android.py compares them, because a
   mismatch leaves a button that looks alive and does nothing. */
function exitApp() {
  if (window.TheGame && typeof window.TheGame.exitApp === 'function') {
    window.TheGame.exitApp();
    return true;
  }
  return false;
}

var running = false;
var speed = 0;
var timer = null;
var setupState = { step: 0, country: '', ruler: '', gov: null, soc: null };

/* ------------------------------------------------------------------ setup */
function setupView() {
  var st = setupState;
  if (st.step === 0) {
    return '<div class="eyebrow">الخطوة ١ من ٤</div><h1>دولتك</h1>'
      + '<p class="lede">دولة خيالية، وحاكم من اختيارك. الأسماء دي هتظهر في كل مكان في اللعبة وفي شاشة النهاية.</p>'
      + '<div class="field"><label>اسم الدولة</label><div class="wrap">'
      + '<input id="cn" value="' + esc(st.country) + '" placeholder="اكتب اسم دولتك">'
      + '<button class="dice" data-roll="country">🎲</button></div></div>'
      + '<div class="field"><label>اسمك كحاكم</label><div class="wrap">'
      + '<input id="rn" value="' + esc(st.ruler) + '" placeholder="اكتب اسمك">'
      + '<button class="dice" data-roll="ruler">🎲</button></div></div>'
      + '<div class="flag">💡 لو سيبتهم فاضيين، اللعبة هتختار لك أسماء.</div>';
  }
  if (st.step === 1) {
    return '<div class="eyebrow">الخطوة ٢ من ٤</div><h1>نظام الحكم</h1>'
      + '<p class="lede">ده مش شكل بس — ده بيغيّر مصدر شرعيتك، يعني بيغيّر الحاجة اللي ممكن تسقطك.</p>'
      + optionList(SETUP.government_types, st.gov, 'gov');
  }
  if (st.step === 2) {
    return '<div class="eyebrow">الخطوة ٣ من ٤</div><h1>طبيعة المجتمع</h1>'
      + '<p class="lede">الناس اللي هتحكمهم. ده بيحدد إيه اللي بيغضبهم، وقد إيه بيسامحوا.</p>'
      + optionList(SETUP.society_types, st.soc, 'soc');
  }
  return summaryView();
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function optionList(list, current, key) {
  return list.map(function (o, i) {
    var sel = current && current.id === o.id;
    var h = '<button class="opt' + (sel ? ' sel' : '') + '" data-pick="' + key + '" data-i="' + i + '">'
      + '<div class="hd"><span class="ic">' + o.ic + '</span><span class="nm">' + o.nm + '</span>'
      + '<span class="tag">' + o.tag + '</span></div>'
      + '<p class="ds">' + o.desc + '</p><div class="detail"><div class="lst">';
    h += o.good.map(function (g) { return '<div class="li good"><b>▲</b><span>' + g + '</span></div>'; }).join('');
    h += o.bad.map(function (g) { return '<div class="li bad"><b>▼</b><span>' + g + '</span></div>'; }).join('');
    if (o.feel) h += '<div class="feel">' + o.feel + '</div>';
    return h + '</div></div></button>';
  }).join('');
}

/* Showing the resulting numbers BEFORE the game starts is the point of the
   setup: the player should feel the trade-off, not discover it in year three. */
function summaryView() {
  var st = setupState, base = SETUP.base_start, v = {}, d = {};
  for (var k in base) v[k] = base[k];
  [st.gov, st.soc].forEach(function (o) {
    if (!o) return;
    for (var k in o.mods) { v[k] += o.mods[k]; d[k] = (d[k] || 0) + o.mods[k]; }
  });
  function row(label, key, suffix) {
    var delta = d[key] ? '<span class="d ' + (d[key] > 0 ? 'up' : 'dn') + '">'
      + (d[key] > 0 ? '▲+' : '▼') + ar(Math.abs(d[key])) + '</span>' : '';
    return '<div class="srow"><span>' + label + '</span><span class="v">'
      + ar(v[key]) + (suffix || '') + delta + '</span></div>';
  }
  var h = '<div class="eyebrow">الخطوة ٤ من ٤</div><h1>قبل ما تبدأ</h1>'
    + '<p class="lede">دي حالة دولتك يوم ما تمسك الحكم — بعد ما اختياراتك اتحسبت.</p>'
    + '<div class="title"><div class="cn">' + esc(st.country || 'دولة بلا اسم') + '</div>'
    + '<div class="rn">' + (st.gov ? st.gov.ic + ' ' : '') + esc(st.ruler || 'حاكم بلا اسم') + '</div></div>'
    + '<div class="sum">'
    + row('الرضا الشعبي', 'approval') + row('الثبات السياسي', 'stability')
    + row('كفاءة الوزرا', 'competence') + row('ولاء الوزرا', 'loyalty')
    + row('طاقة القرارات', 'ap') + row('التضخم', 'inflation', '٪')
    + '<div class="srow"><span>الخزينة</span><span class="v">' + ar(BALANCE.start.treasury) + 'م</span></div>'
    + '</div>';
  if (st.gov && st.gov.id === 'republic') h += '<div class="flag">🗳️ أول انتخابات بعد ٤٨ شهر. لو رضاك وقتها تحت ٤٠، خرجت.</div>';
  // The number here is read from the data, not written down: the army line
  // moved once already and this line kept quoting the old one for a whole item
  // because it lives in the game and the check was only reading setup.json.
  if (st.gov && st.gov.id === 'dictator') {
    h += '<div class="flag">⚠️ مفيش مؤشر اسمه الجيش — ولاء وزير الدفاع هو الجيش. '
      + 'وخطك ' + ar(ARMY.line_by_government.dictator) + ' مش '
      + ar(ARMY.line_by_government.republic) + ': شرعيتك منهم، فبيتوقعوا أكتر.</div>';
  }
  if (st.gov && st.gov.id === 'monarchy') h += '<div class="flag">👑 مفيش انتخابات ومفيش مدة. بتفضل لحد ما يشيلوك.</div>';
  if (st.soc && st.soc.id === 'divided') h += '<div class="flag">⚡ الوضع الصعب. ما تلعبهوش أول مرة.</div>';
  return h;
}

function setupFoot() {
  var st = setupState;
  var ok = st.step === 1 ? !!st.gov : st.step === 2 ? !!st.soc : true;
  // The back button exists on the first step too now, because there is
  // somewhere behind it: the menu.
  return '<button class="btn ghost" data-nav="back">⟶ '
    + (st.step > 0 ? 'رجوع' : 'القايمة') + '</button>'
    + '<button class="btn" data-nav="next"' + (ok ? '' : ' disabled') + '>'
    + (st.step === 3 ? 'ابدأ الحُكم ⟵' : 'التالي ⟵') + '</button>';
}

function drawSetup() {
  var h = '';
  for (var i = 0; i < 4; i++) h += '<div class="sp ' + (i < setupState.step ? 'done' : i === setupState.step ? 'on' : '') + '"></div>';
  el('steps').innerHTML = h;
  el('setupBody').innerHTML = setupView();
  el('setupFoot').innerHTML = setupFoot();
}


/* ------------------------------------------------------------- services */
/* Which governorate the service cards are showing. It is derived from the screen
   the player is on, never set by a button: on a minister's screen it is 'all'
   (his services nationally), on a governorate's screen it is that province.
   Making it a mode the player toggles was the old design, and it meant the same
   card could mean two different things with nothing on screen saying which. */
var govFilter = 'all';

function svcColor(v) { return v >= 65 ? 'var(--good)' : v >= 45 ? 'var(--warn)' : 'var(--bad)'; }

function svcNumbers(id) {
  var op = operating(S, id);
  if (govFilter === 'all') {
    var lvl = nationalLevel(S, id);
    // Back out the average coverage so the two bars still multiply to the level.
    return { op: op, cov: op > 0 ? lvl / op * 100 : 0, lvl: lvl, fac: null };
  }
  return { op: op, cov: coverage(S, govFilter, id), lvl: S.level[govFilter][id],
           fac: S.fac[govFilter][id] };
}

function serviceCostLine(id, n) {
  var monthly = S.ask[id] * S.pct[id] / 100 * S.priceIndex;
  if (n.fac === null) return ar(monthly) + 'م/شهر على مستوى الدولة';
  return ar(n.fac) + ' منشأة في ' + BALANCE.governorates[govFilter].name;
}

/* One service, with its slider and its build button. Written once because the
   same card appears on the services screen and on its minister's screen — two
   copies would drift apart the first time either is touched. The element ids
   are what refreshService() updates mid-drag, so they must stay unique per
   service, which they are: one service is only ever on screen once. */
function serviceCard(id, gov) {
  var sd = BALANCE.services[id], n = svcNumbers(id);
  return '<div class="svc">'
    + '<div class="top1"><span class="ico">' + SVC_ICON[id] + '</span>'
    + '<span class="nm2">' + sd.name
    + '<span class="cost" id="cost-' + id + '">' + serviceCostLine(id, n) + '</span></span>'
    + '<span class="lvl" id="lvl-' + id + '" style="color:' + svcColor(n.lvl) + '">' + ar(n.lvl) + '</span></div>'
    + '<div class="two2">'
    + '<div><span class="lb2" id="covl-' + id + '">التغطية ' + ar(n.cov) + '٪</span>'
    + '<div class="bar2"><div class="fl2" id="covb-' + id + '" style="width:' + Math.min(100, n.cov)
    + '%;background:var(--info)"></div></div></div>'
    + '<div><span class="lb2" id="opl-' + id + '">التشغيل ' + ar(n.op) + '٪</span>'
    + '<div class="bar2"><div class="fl2" id="opb-' + id + '" style="width:' + Math.min(100, n.op)
    + '%;background:var(--gold2)"></div></div></div></div>'
    + '<div class="ctl">'
    + '<button class="build" data-build="' + id + '"'
    + (gov ? ' data-buildin="' + gov + '"' : '') + '>🏗️ ابني</button>'
    + '<input type="range" min="0" max="160" step="2" value="' + Math.round(S.pct[id])
    + '" data-pct="' + id + '">'
    + '<span class="pctv" id="pctv-' + id + '">' + ar(S.pct[id]) + '٪</span>'
    + '</div></div>';
}

/* ---- the governorates -------------------------------------------------- */

function govMood(g) {
  var v = S.govAppr[g];
  return v >= 65 ? 'راضيين' : v >= 50 ? 'ساكتين' : v >= 35 ? 'متضايقين' : 'على وش انفجار';
}

/* The worst service in a province, by name. This is the one number that tells
   the player where to go next, so it is on the list row and not buried inside. */
function worstServiceIn(g) {
  var worst = SERVICE_IDS[0];
  for (var i = 1; i < SERVICE_IDS.length; i++) {
    if (S.level[g][SERVICE_IDS[i]] < S.level[g][worst]) worst = SERVICE_IDS[i];
  }
  return worst;
}

function govsBody() {
  var h = '<div class="card"><div class="krow"><span class="sub">'
    + 'الرضا القومي متوسط مرجّح بالسكان — بيخبّي إن محافظة كاملة ممكن تكون في الأرض. '
    + 'ادخل على كل واحدة تشوف خدماتها هي وتبني فيها.'
    + '</span></div></div>';

  for (var i = 0; i < GOV_IDS.length; i++) {
    var g = GOV_IDS[i], gd = BALANCE.governorates[g];
    var ws = worstServiceIn(g), lvl = S.level[g][ws];
    var building = 0;
    for (var j = 0; j < S.projects.length; j++) if (S.projects[j].gov === g) building++;

    h += '<button class="mrow" data-open="governorate" data-openid="' + g + '">'
      + '<div class="mhd"><span class="mic">' + (i === 0 ? '🏛️' : '🏙️') + '</span>'
      + '<span class="mnm">' + gd.name
      + '<span class="mof">' + arPeople(S.pop[g]) + ' · ' + govMood(g) + '</span></span>'
      + '<span class="mbig" style="color:' + svcColor(S.govAppr[g]) + '">' + ar(S.govAppr[g]) + '</span></div>'
      + '<div class="mbars">'
      + mBar('خدماتها', govService(S, g), 'var(--gold2)')
      + '</div>'
      + '<div class="mfoot">أسوأ حاجة فيها: ' + BALANCE.services[ws].name + ' ' + ar(lvl)
      + (building ? ' · ' + ar(building) + ' تحت الإنشاء' : '')
      + '</div><span class="mgo">›</span></button>';
  }
  return h;
}

/* One province. The same service cards as the minister's screen, but every
   number is this province's — because the national average is exactly what hides
   a province living without a sewer. */
function governorateBody(g) {
  var gd = BALANCE.governorates[g];
  var h = '<div class="card"><h3>' + gd.name + '</h3>'
    + '<div class="krow"><span>السكان</span><b>' + arPeople(S.pop[g]) + '</b></div>'
    + '<div class="krow"><span>رضاهم عنك</span><b style="color:' + svcColor(S.govAppr[g])
    + '">' + ar(S.govAppr[g]) + ' · ' + govMood(g) + '</b></div>'
    + '<div class="krow"><span>مستوى خدماتها</span><b style="color:'
    + svcColor(govService(S, g)) + '">' + ar(govService(S, g)) + '</b></div>'
    + '<div class="krow"><span>حالها المادي</span><b>' + wealthWord(gd.wealth) + '</b></div>'
    + '<div class="krow"><span class="sub">' + wealthNote(gd) + '</span></div>'
    + '</div>';

  var q = [];
  for (var k = 0; k < S.projects.length; k++) if (S.projects[k].gov === g) q.push(S.projects[k]);
  if (q.length) {
    h += '<div class="queue"><h4>تحت الإنشاء هنا</h4>';
    for (var m = 0; m < q.length; m++) {
      h += '<div class="qi"><span>' + BALANCE.services[q[m].svc].name
        + '<span class="qsub">لما يفتح: +' + arDec(BALANCE.services[q[m].svc].adds_monthly, 1)
        + 'م على المصروف الشهري للأبد</span></span>'
        + '<span>' + ar(q[m].left) + ' شهور</span></div>';
    }
    h += '</div>';
  }

  h += '<h3 class="sech">خدماتها — الأرقام دي بتاعتها هي</h3>';
  // Worst first: the screen should open on the thing that needs the player.
  var order = SERVICE_IDS.slice().sort(function (a, b) { return S.level[g][a] - S.level[g][b]; });
  for (var i = 0; i < order.length; i++) h += serviceCard(order[i], g);
  return h;
}

function wealthWord(w) {
  return w >= 1.2 ? 'غنية' : w >= 1.0 ? 'متوسطة' : w >= 0.75 ? 'محدودة' : 'فقيرة';
}
function wealthNote(gd) {
  return gd.wealth >= 1.0
    ? 'بتمتصّ غلاء الأسعار والضرايب أحسن من غيرها.'
    : 'أي غلا في الأكل أو الضرايب بيوجعها أكتر من باقي المحافظات.';
}

/* Sliders must not rebuild the screen: redrawing mid-drag drops the thumb from
   under the player's finger. Update only the numbers that moved. */
function refreshService(id) {
  var n = svcNumbers(id);
  var monthly = S.ask[id] * S.pct[id] / 100 * S.priceIndex;
  el('pctv-' + id).textContent = ar(S.pct[id]) + '٪';
  el('opl-' + id).textContent = 'التشغيل ' + ar(n.op) + '٪';
  el('opb-' + id).style.width = Math.min(100, n.op) + '%';
  el('lvl-' + id).textContent = ar(n.lvl);
  el('lvl-' + id).style.color = svcColor(n.lvl);
  el('cost-' + id).textContent = serviceCostLine(id, n);
}

/* ---- the build sheet -------------------------------------------------- */
function openBuild(id, only) {
  var sd = BALANCE.services[id], cost = projectCost(S, id);
  var h = '<div class="sheet"><div class="sh"><span class="ic2">' + SVC_ICON[id] + '</span>'
    + '<span class="nm3">ابني ' + sd.name + '</span>'
    + '<button class="x" data-close="1">✕</button></div>'
    + '<p class="lede2">' + (only
      ? 'هتتبني في ' + BALANCE.governorates[only].name + '. المنشأة الواحدة بتخدم '
      : 'اختار المحافظة. المنشأة الواحدة بتخدم ')
    + arPeople(sd.serves_millions) + '.</p>'
    + '<div class="calc2">'
    + '<div class="cr2"><span>تكلفة الإنشاء</span><b>' + ar(cost) + 'م</b></div>'
    + '<div class="cr2"><span>مدة الإنشاء</span><b>' + ar(sd.build_months) + ' شهور</b></div>'
    + '<div class="cr2"><span>وبعد ما يفتح</span><b>+' + arDec(sd.adds_monthly, 1) + 'م كل شهر للأبد</b></div>'
    + '<div class="cr2"><span>الخزينة دلوقتي</span><b style="color:'
    + (S.treasury >= cost ? 'var(--good)' : 'var(--bad)') + '">' + ar(S.treasury) + 'م</b></div>'
    + '</div>';

  var list = only ? [only] : GOV_IDS;
  for (var i = 0; i < list.length; i++) {
    var g = list[i], cov = coverage(S, g, id);
    var afford = S.treasury >= cost;
    h += '<button class="pickg" data-buildgov="' + g + '" data-buildsvc="' + id + '"'
      + (afford ? '' : ' disabled') + '>'
      + '<div class="r1"><span class="gn">' + BALANCE.governorates[g].name + '</span>'
      + '<span class="cv" style="color:' + svcColor(cov) + '">تغطية ' + ar(cov) + '٪</span></div>'
      + '<div class="r2">' + ar(S.fac[g][id]) + ' منشأة · '
      + arPeople(S.pop[g]) + ' · التغطية هتبقى '
      + ar(Math.min(100, (S.fac[g][id] + 1) * sd.serves_millions / S.pop[g] * 100)) + '٪</div>'
      + '</button>';
  }
  if (S.treasury < cost) {
    h += '<div class="warn2">الخزينة مش كفاية — ناقصك ' + ar(cost - S.treasury) + 'م.</div>';
  }
  h += '</div>';
  el('ovl').innerHTML = h;
  el('ovl').classList.remove('hidden');
}

/* Called by the Android shell before it backgrounds the app. Return true if
   the page consumed the press. Harmless in a browser, where nothing calls it. */
/* The order here is the order the player expects: close what is on top first,
   then walk back down the screens, and only then treat the press as "leave".
   Getting this wrong means the phone's back key throws the player out of a game
   that is still running — the one navigation bug you cannot apologise for. */
function onAndroidBack() {
  // On the menu the press means "leave the app", so the shell handles it.
  if (view === 'menu') {
    if (menuPage !== 'main') {
      menuPage = (menuPage === 'about') ? 'settings' : 'main';
      drawMenu();
      return true;
    }
    return false;
  }
  // In the wizard it walks back a step, and off the first step to the menu —
  // never out of the app, which would lose the choices already made.
  if (view === 'setup') {
    if (setupState.step > 0) { setupState.step--; drawSetup(); }
    else showView('menu');
    return true;
  }
  // A pending situation comes first and swallows the press. Returning true with
  // nothing done is deliberate: the shell must believe the page handled it, or
  // it backgrounds the app — which would be an escape hatch out of the one
  // decision the game says is compulsory.
  if (S && S.pendingSituation) return true;
  var ovl = el('ovl');
  if (ovl && !ovl.classList.contains('hidden')) { closeSheet(); return true; }
  if (S && backScreen()) return true;
  if (S && running) { setRunning(false); return true; }   // pause before leaving
  return false;
}

function closeSheet() { el('ovl').classList.add('hidden'); el('ovl').innerHTML = ''; }

function toast(msg) {
  var t = el('toast');
  t.innerHTML = arText(msg);
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('on'); }, 3200);
}

/* ------------------------------------------------------------------- game */

var SVC_ICON = { water: '💧', power: '⚡', sewage: '🚰', health: '🏥',
                 edu: '🎓', police: '👮', fire: '🚒' };

/* The five tabs. Control runs through the ministers now, so there is no
   "services" tab any more: services are reached from the minister who owns them
   or from the governorate they sit in. [id, icon, short label for the bar]. */
var TABS = [['pres', '🏛️', 'الرئاسة'], ['govt', '👔', 'الوزراء'], ['govs', '🗺️', 'المحافظات'],
            ['parl', '⚖️', 'المجلس'], ['bank', '🏦', 'البنك']];

/* Every screen in the game, tab or sub-screen, described in one place: which
   artwork it wears, what it is called, and the line that says what it is FOR.
   A tab's key is 'tab_<id>'; a sub-screen's key is its own name. Routing reads
   this table and nothing else, so adding a screen is adding a row. */
var SCREENS = {
  tab_pres: { art: 'pres',  title: 'الرئاسة',       sub: 'مكتبك · وقراراتك' },
  tab_govt: { art: 'govt',  title: 'مجلس الوزراء',  sub: 'اللي بيشغّلوا الدولة نيابة عنك' },
  tab_govs: { art: 'serv',  title: 'المحافظات',     sub: 'خمس محافظات · كل واحدة بحالها' },
  tab_parl: { art: 'pol',   title: 'مجلس الشعب',    sub: 'الأحزاب والكتل اللي عايزين كرسيك' },
  tab_bank: { art: 'treas', title: 'البنك المركزي', sub: 'الفلوس والتضخم' },
  // One screen per governorate, named after it.
  governorate: { art: 'serv',
                 title: function (id) { return BALANCE.governorates[id].name; },
                 sub:   function (id) { return arPeople(S.pop[id]) + ' · ' + govMood(id); } },
  // A title that depends on which minister you opened, so it is a function of
  // the screen's id rather than a fixed string.
  minister: { art: 'govt',
              title: function (id) { return postOf(id).name; },
              sub:   function (id) { return postOf(id).of; } }
};

/* Screens may name themselves from their id. Everything that shows a screen's
   name goes through these two, so a dynamic title can never be printed raw. */
function titleOf(e) {
  var t = screenOf(e).title;
  return typeof t === 'function' ? t(e.id) : t;
}
function subOf(e) {
  var t = screenOf(e).sub;
  return typeof t === 'function' ? t(e.id) : t;
}

/* Each unfinished tab names the plan item that will fill it. Blind building
   means Karim must see what is done and what is not without asking me. */
var SOON = {
  pres: ['🏛️', 'الرئاسة', 'المواقف اللي بتيجي لك، ومكتب الرئاسة والأفعال اللي بتبدأها إنت.', 'البند ١٢']
};

/* ---- where you are ---------------------------------------------------- */
/* A stack, not a variable. The bottom is always a tab; every sub-screen is
   pushed on top. That is what makes "رجوع" mean the same thing everywhere —
   including the phone's own back key, which must never drop the player out of
   the game while a screen is still open above the tab. */
var stack = [{ s: 'tab', id: 'pres' }];

function cur() { return stack[stack.length - 1]; }
function curTab() { return stack[0].id; }
function screenOf(e) { return SCREENS[e.s === 'tab' ? 'tab_' + e.id : e.s]; }

/* Switching tabs resets the stack. Keeping a separate history per tab would
   mean the same button lands you somewhere different depending on where you
   were an hour ago — surprising in a game you play with one thumb. */
function goTab(id) { stack = [{ s: 'tab', id: id }]; drawGame(); }
function openScreen(s, id) { stack.push({ s: s, id: id }); drawGame(); }
function backScreen() {
  if (stack.length < 2) return false;
  stack.pop(); drawGame(); return true;
}

function meterColor(v) { return v >= 65 ? 'var(--good)' : v >= 45 ? 'var(--warn)' : 'var(--bad)'; }

function drawTop() {
  var g = govOf(S), dg = danger(S);
  el('date').innerHTML = 'الشهر <b>' + ar(S.month) + '</b> · السنة <b>' + ar(S.year) + '</b>';
  el('who').textContent = g.ic + ' ' + S.ruler + ' — ' + S.country;
  // Suspicion sits in the bar with the other four rather than on one screen:
  // it is the only number that can end a game while the player is looking at
  // something else, so it has to be where he already looks.
  var hc = BALANCE.heat;
  var m = [
    ['الرضا', S.approval, meterColor(S.approval), ar(S.approval), dg.approval],
    ['الثبات', S.stability, meterColor(S.stability), ar(S.stability), dg.stability],
    ['التضخم', Math.min(100, S.inflation * 2), dg.inflation ? 'var(--bad)' : 'var(--good)', ar(S.inflation) + '٪', dg.inflation],
    ['الشبهة', S.heat / hc.cap * 100, dg.heat ? 'var(--bad)' : S.heat > hc.scandal_at * 0.6 ? 'var(--warn)' : 'var(--good)', ar(S.heat), dg.heat],
    ['الطاقة', S.ap / S.apMax * 100, 'var(--info)', ar(S.ap) + '/' + ar(S.apMax), false]
  ];
  el('meters').innerHTML = m.map(function (x) {
    return '<div class="mtr' + (x[4] ? ' alarm' : '') + '"><span class="lb">' + x[0] + '</span>'
      + '<span class="vl" style="color:' + x[2] + '">' + x[3] + '</span>'
      + '<div class="bar"><div class="fl" style="width:' + Math.max(0, Math.min(100, x[1])) + '%;background:' + x[2] + '"></div></div></div>';
  }).join('');
}

function drawNav() {
  var on = curTab();
  el('nav').innerHTML = TABS.map(function (t) {
    return '<button class="' + (on === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '"><i>' + t[1] + '</i>' + t[2] + '</button>';
  }).join('');
}

function drawView() {
  var e = cur(), sc = screenOf(e);
  // Set before anything draws: the service cards read this to decide whether
  // they are showing the country or one province.
  govFilter = (e.s === 'governorate') ? e.id : 'all';
  var sub = subOf(e);
  var h = '<div class="band">' + ART[sc.art];
  // The back button names where it goes, not just that it goes back. On a phone
  // an unlabelled arrow after three taps is a guess.
  if (stack.length > 1) {
    h += '<button class="back" data-back="1">⟶ رجوع لـ<b>'
      + titleOf(stack[stack.length - 2]) + '</b></button>';
  }
  h += '<div class="ttl">' + titleOf(e) + '</div><div class="sub">' + sub + '</div></div><div class="pad">';
  el('view').innerHTML = h + screenBody(e) + '</div>';
}

/* Which function draws which screen. A screen is either in here or in SOON —
   check.py refuses to build if one is in neither, so a screen can never quietly
   render an empty page. */
var BODY = { pres: presBody, govt: cabinetBody, govs: govsBody, parl: parlBody,
             bank: bankBody, minister: ministerBody, governorate: governorateBody };

function screenBody(e) {
  var key = e.s === 'tab' ? e.id : e.s;
  if (BODY[key]) return BODY[key](e.id);
  var k = SOON[key];
  return '<div class="soon"><span class="ic">' + k[0] + '</span><h3>' + k[1] + '</h3>'
    + '<p>' + k[2] + '</p><span class="item">لسه بيتبني — ' + k[3] + '</span></div>';
}

/* ---- the cabinet board ------------------------------------------------ */
/* Nine rows built from the state, never from nine hand-written blocks: adding
   or removing a post later must change this screen without anybody editing it. */
function mBar(label, v, color) {
  return '<div class="mb"><span>' + label + '</span>'
    + '<div class="mbar"><div class="mfl" style="width:' + Math.max(0, Math.min(100, v))
    + '%;background:' + color + '"></div></div>'
    + '<b style="color:' + color + '">' + ar(v) + '</b></div>';
}

function cabinetBody() {
  var h = '<div class="card"><h3>الحكومة اللي بتحكم باسمك</h3>'
    + '<div class="krow"><span>متوسط الكفاءة</span><b style="color:' + meterColor(avgCompetence(S))
    + '">' + ar(avgCompetence(S)) + '</b></div>'
    + '<div class="krow"><span>متوسط الولاء</span><b style="color:' + meterColor(avgLoyalty(S))
    + '">' + ar(avgLoyalty(S)) + '</b></div>'
    + '<div class="krow"><span class="sub">الكفاءة بتشغّل الوزارة. الولاء بيحميك. نادرًا ما تلاقي الاتنين في واحد.</span></div>'
    + '</div>';

  for (var i = 0; i < POST_IDS.length; i++) {
    var id = POST_IDS[i], p = postOf(id), m = S.ministers[id];
    var comp = ministerComp(S, id), tag = ministerTag(S, id);
    var worst = worstServiceOf(S, id);

    // The right-hand number is the thing you judge him by: his worst service if
    // he runs any, otherwise the competence he actually works at.
    var big = worst === null ? comp : nationalLevel(S, worst);
    var bigSub = worst === null ? 'كفاءته الفعلية' : 'أسوأ خدمة عنده — ' + BALANCE.services[worst].name;

    h += '<button class="mrow" data-open="minister" data-openid="' + id + '">'
      + '<div class="mhd"><span class="mic">' + p.icon + '</span>'
      // The post is what you act on, so it is the heading; the man and what he
      // holds go underneath. Losing the portfolio here would make the board a
      // list of strangers you cannot choose between.
      + '<span class="mnm">' + p.name
      + '<span class="mof">' + m.name + ' · ' + p.of + '</span></span>'
      + '<span class="mbig" style="color:' + svcColor(big) + '">' + ar(big) + '</span></div>'
      + (tag ? '<span class="mtag ' + tag.tone + '">' + tag.nm + '</span>' : '')
      + '<div class="mbars">'
      + mBar('كفاءة', m.competence, 'var(--gold2)')
      + mBar('ولاء', m.loyalty, 'var(--info)')
      + '</div>'
      + '<div class="mfoot">' + bigSub
      + (id === 'pm' ? ' · بيضيف ' + arDec(pmBonus(S), 1) + ' لكل وزير' : '')
      + '</div><span class="mgo">›</span></button>';
  }

  return h;
}

/* ---- the central bank -------------------------------------------------- */

function independenceWord(v) {
  return v >= 70 ? 'مستقل — بيقول لأ' : v >= 45 ? 'بيجاملك' : 'بتاعك بالكامل';
}

function bankBody() {
  var cap = printCap(S), sw = BANK.swap;
  var refusal = printRefusal(S, cap), swapNo = swapGovernorRefusal(S);
  var ind = S.bank.independence;

  var h = '<div class="mrow">'
    + '<div class="mhd"><span class="mic">🏦</span>'
    + '<span class="mnm">' + S.bank.name
    + '<span class="mof">محافظ البنك المركزي · مش وزير، وما بيتشالش في التعديل الوزاري</span></span>'
    + '<span class="mbig" style="color:' + svcColor(ind) + '">' + ar(ind) + '</span></div>'
    + '<div class="mbars">' + mBar('استقلاله', ind, 'var(--info)') + '</div>'
    + '<div class="mfoot">' + independenceWord(ind) + '</div></div>';

  h += '<div class="card"><h3>حالة الفلوس</h3>'
    + '<div class="krow"><span>التضخم</span><b style="color:'
    + (S.inflation > BALANCE.inflation.pain_starts_above ? 'var(--bad)' : 'var(--good)')
    + '">' + arDec(S.inflation, 1) + '٪</b></div>'
    + '<div class="krow"><span>مؤشر الأسعار</span><b>×' + arDec(S.priceIndex, 2) + '</b></div>'
    + '<div class="krow"><span>الخزينة</span><b>' + ar(S.treasury) + 'م</b></div>'
    + '<div class="krow"><span class="sub">الوجع بيبدأ فوق '
    + ar(BALANCE.inflation.pain_starts_above) + '٪، والانهيار عند '
    + ar(BALANCE.inflation.collapse_at) + '٪.</span></div></div>';

  // The whole trade in one card, with both halves of it priced.
  h += '<h3 class="sech">تطبع فلوس؟</h3>'
    + '<div class="card">'
    + '<div class="krow"><span>أكتر حاجة هيوقّع عليها</span><b>' + ar(cap) + 'م</b></div>'
    + '<div class="krow"><span>هتزوّد التضخم</span><b style="color:var(--bad)">+'
    + arDec(printInflation(S, cap), 1) + '٪</b></div>'
    + '<div class="krow"><span>يعني التضخم هيبقى</span><b style="color:var(--bad)">'
    + arDec(S.inflation + printInflation(S, cap), 1) + '٪</b></div>'
    + '<div class="krow"><span>وهتزوّد الشبهة</span><b style="color:var(--bad)">+'
    + arDec(cap / 100 * BALANCE.heat.print_per_100m, 1) + '</b></div>'
    + '<div class="krow"><span class="sub">الفلوس دي مش بتيجي من حتة — بتيجي من جيب كل واحد '
    + 'ماسك فلوس في البلد، ومن رصيدك الشخصي كمان.</span></div></div>'
    + '<button class="danger" data-print="1"' + (refusal ? ' disabled' : '') + '>'
    + '🖨️ اطبع ' + ar(cap) + 'م'
    + '<span>' + (refusal ? arText(refusal) : 'مرة كل ' + ar(BANK.print.once_per_months) + ' شهور')
    + '</span></button>';

  h += '<h3 class="sech">تغيير المحافظ</h3>'
    + '<div class="card"><div class="krow"><span class="sub">'
    + 'محافظ من عندك هيوقّع على أكتر — بس السوق مش هيصدّق الفلوس، فنفس الجنيه المطبوع '
    + 'هيولّع تضخم أكتر. <b>الطباعة بتبقى أسهل وأغلى في نفس الوقت.</b>'
    + '</span></div>'
    + '<div class="krow"><span>استقلاله دلوقتي</span><b>' + ar(ind) + '</b></div>'
    + '<div class="krow"><span>الجديد هيبقى بين</span><b>' + ar(sw.new_independence[0])
    + ' و' + ar(sw.new_independence[1]) + '</b></div>'
    + '<div class="krow"><span>السقف هيبقى حوالي</span><b>'
    + ar(BANK.print.base_cap + (100 - (sw.new_independence[0] + sw.new_independence[1]) / 2)
        * BANK.print.cap_per_lost_independence) + 'م</b></div>'
    + '</div>'
    + '<button class="danger" data-governor="1"' + (swapNo ? ' disabled' : '') + '>'
    + '⚖️ عيّن محافظ من عندك'
    + '<span>' + (swapNo ? arText(swapNo)
      : 'بيكلّف ' + ar(sw.ap_cost) + ' طاقة · −' + ar(sw.stability_hit) + ' ثبات · شبهة +'
        + ar(BALANCE.heat.governor_swap) + ' · '
        + 'ومش هينفع تاني قبل ' + ar(sw.cooldown_months) + ' شهر')
    + '</span></button>';
  return h;
}

/* ---- the chamber ------------------------------------------------------- */

var PARTY_COLOR = { cons: 'var(--gold2)', modern: 'var(--info)',
                    nat: '#8a7fd0', indep: 'var(--dim)' };

function parlBody() {
  var back = parliamentBacking(S), bk = PARLIAMENT.backing;
  var below = Math.max(0, bk.floor - back);

  // One bar for the whole house, so the player sees the shape of his majority
  // before he reads a single number.
  var bar = '<div class="seatbar">';
  for (var i = 0; i < PARLIAMENT.parties.length; i++) {
    var p = PARLIAMENT.parties[i];
    bar += '<span style="width:' + p.seats + '%;background:' + PARTY_COLOR[p.id] + '"></span>';
  }
  bar += '</div>';

  var h = '<div class="card"><h3>تأييد المجلس</h3>'
    + '<div class="krow"><span>المقاعد اللي معاك</span><b style="color:' + svcColor(back)
    + '">' + ar(back) + '٪</b></div>'
    + bar
    + '<div class="krow"><span class="sub">'
    + (below > 0
      ? '⚠️ تحت خط الأمان (' + ar(bk.floor) + '٪) بـ' + ar(below)
        + ' — وده بينزّل ثباتك السياسي ' + arDec(below * bk.stability_coef, 1) + ' نقطة.'
      : 'فوق خط الأمان (' + ar(bk.floor) + '٪). لو نزل تحته، ثباتك السياسي هيبدأ ينزل معاه.')
    + '</span></div></div>';

  for (var j = 0; j < PARLIAMENT.parties.length; j++) {
    var q = PARLIAMENT.parties[j], mood = partyMood(S, q.id);
    var mins = ministersOfParty(S, q.id);
    h += '<div class="mrow">'
      + '<div class="mhd"><span class="mic">' + q.ic + '</span>'
      + '<span class="mnm">' + q.nm
      + '<span class="mof">' + ar(q.seats) + ' مقعد · ' + q.cares + '</span></span>'
      + '<span class="mbig" style="color:' + svcColor(mood) + '">' + ar(mood) + '</span></div>'
      + '<div class="mbars">' + mBar('رضاه عنك', mood, PARTY_COLOR[q.id]) + '</div>'
      + '<div class="mfoot">'
      + (mins ? '👔 ' + ar(mins) + ' من وزرائك من الحزب ده — وده رافع رضاه '
                + ar(mins * PARLIAMENT.minister_bonus) + ' نقطة'
              : 'مالوش وزير عندك — تعيين واحد منهم بيرفع رضاه ' + ar(PARLIAMENT.minister_bonus) + ' نقطة')
      + '</div></div>';
  }

  h += '<h3 class="sech">الكتل الاجتماعية</h3>'
    + '<div class="card"><div class="krow"><span class="sub">'
    + 'دول مش رقم تاني للرضا — ده نفس الرضا مفكوك. كل كتلة بتحس بنفس الغلا والضرايب '
    + 'بس بحساسية مختلفة، ومتوسطهم بالسكان هو رقم الرضا اللي فوق (<b>' + ar(S.approval)
    + '</b>). الفايدة إنك تشوف <b>مين</b> الزعلان بالظبط.'
    + '</span></div></div>';

  for (var k = 0; k < PARLIAMENT.blocs.length; k++) {
    var b = PARLIAMENT.blocs[k], bm = blocMood(S, b.id);
    h += '<div class="prow">'
      + '<span class="mic">' + b.ic + '</span>'
      + '<span class="pnm">' + b.nm
      + '<span class="mof">' + ar(b.share * 100) + '٪ من الناس · ' + b.cares + '</span></span>'
      + '<span class="mbig" style="color:' + svcColor(bm) + '">' + ar(bm) + '</span></div>';
  }
  return h;
}

/* ---- one minister ----------------------------------------------------- */
/* One screen serves all nine posts. The differences between them are data —
   which services he owns, what he does instead — so a tenth post would need no
   new screen. */
function ministerBody(post) {
  var p = postOf(post), m = S.ministers[post];
  var tag = ministerTag(S, post), comp = ministerComp(S, post);

  var h = '<div class="mrow">'
    + '<div class="mhd"><span class="mic">' + p.icon + '</span>'
    + '<span class="mnm">' + m.name + '<span class="mof">' + p.name + ' · ' + p.of + '</span></span></div>'
    + (tag ? '<span class="mtag ' + tag.tone + '">' + tag.nm + '</span>' : '')
    + '<div class="mbars">'
    + mBar('كفاءة', m.competence, 'var(--gold2)')
    + mBar('ولاء', m.loyalty, 'var(--info)')
    + '</div>'
    + '<div class="mfoot">' + p.note + '</div>'
    + '<div class="krow"><span>حزبه</span><b>' + partyName(m.party) + '</b></div>'
    + '<div class="krow"><span>شهور في المنصب</span><b>' + ar(m.months) + '</b></div>'
    + '</div>';

  if (p.services.length) {
    // The whole point of the restructure: the budget of a ministry is set on the
    // desk of the man who spends it, not on a national list that hides whose
    // fault a bad number is.
    h += '<div class="note2">كل جنيه هنا بيتضرب في كفاءته هو — <b>' + ar(comp)
      + '٪</b>. عشان توصل تشغيل ١٠٠٪ لازم تموّل <b>' + ar(Math.ceil(100 / (comp / 100)))
      + '٪</b>.</div>';
    for (var i = 0; i < p.services.length; i++) h += serviceCard(p.services[i]);
  } else {
    h += '<div class="card"><h3>مالوش خدمات — بيأثّر إزاي؟</h3>'
      + '<div class="krow"><span class="sub">' + ministerEffect(post) + '</span></div></div>';
  }

  // The treasury is not a tab any more: it is this man's desk. Everything that
  // moves money lives under the minister the money passes through.
  if (post === 'finance') h += treasuryPanel();
  // And the army is the defence minister's desk. It is not a tab and not a
  // meter: the player decided his loyalty IS the army, so the one lever on it
  // belongs on his screen and nowhere else.
  if (post === 'defence') h += barracksPanel();
  // Repression is his desk for the same reason the printing press is the
  // governor's: the man who carries the order out is the man the player has to
  // look at while he gives it.
  if (post === 'interior') h += streetPanel();
  // And the cabinet is the prime minister's desk: from here you sack any one of
  // them, or change the whole government in one move.
  if (post === 'pm') h += pmPanel();

  var refusal = dismissRefusal(S, post);
  h += '<button class="danger" data-fire="' + post + '"' + (refusal ? ' disabled' : '') + '>'
    + '⚖️ أقيله وعيّن غيره'
    + '<span>' + (refusal ? arText(refusal)
      : 'بتشوف تلات مرشحين بأرقامهم · بيكلّف ' + ar(MINISTERS.dismiss.ap_cost)
        + ' طاقة و−' + ar(MINISTERS.dismiss.stability_hit) + ' ثبات')
    + '</span></button>';
  return h;
}

/* What a minister with no services actually changes, in the player's words. A
   post the player cannot see the effect of is a post he will never think about. */
function ministerEffect(post) {
  if (post === 'pm') {
    return 'كفاءته بتتضاف لكل وزير تاني — دلوقتي بيضيف ' + arDec(pmBonus(S), 1)
      + ' لكل واحد فيهم. رئيس وزراء ضعيف بينزّل الحكومة كلها.';
  }
  if (post === 'finance') {
    return 'كفاءته هي نسبة تحصيل الضرايب. بكفاءته الحالية الدولة بتحصّل '
      + ar(ministerComp(S, 'finance')) + '٪ من المستحق — الباقي بيضيع.';
  }
  if (post === 'defence') {
    var risk = coupRiskChange(S);
    return army(S) >= armyLine(S)
      ? 'ولاؤه هو الجيش — مفيش مؤشر تاني. دلوقتي ' + ar(army(S)) + ' وخط الخطر '
        + ar(armyLine(S)) + '، يعني الجيش معاك وخطر الانقلاب بينزل '
        + arDec(-risk, 1) + ' كل شهر.'
      : 'ولاؤه هو الجيش — مفيش مؤشر تاني. دلوقتي ' + ar(army(S)) + ' وده تحت خط الخطر ('
        + ar(armyLine(S)) + ') بـ' + ar(armyLine(S) - army(S))
        + '، يعني خطر الانقلاب بيزيد ' + arDec(risk, 1) + ' كل شهر.';
  }
  if (post === 'interior') {
    return 'كفاءته هي نسبة نجاح القمع — هو اللي بينزّل الأمن على الأرض. '
      + 'دلوقتي ' + ar(crackdownChance(S)) + '٪، ونظام حكمك بيزوّدها أو بينقّصها.';
  }
  if (post === 'media') {
    var hc = BALANCE.heat, cut = heatSources(S).media;
    return cut > 0
      ? 'شغلانته إنه ينزّل الشبهة. بكفاءته الحالية بيشيل ' + arDec(cut, 1)
        + ' شبهة كل شهر — والوزرا اللي ولاؤهم واطي بيطلّعوا '
        + arDec(heatSources(S).talk, 1) + '.'
      : 'كفاءته تحت ' + ar(hc.media_floor) + ' فمش بينزّل ولا شبهة. '
        + 'ده المنصب الوحيد اللي شغله كله على الشبهة.';
  }
  return 'تأثيره لسه ما اتوصّلش في اللعبة — جاي في البنود الجاية.';
}

/* ---- the treasury, on the finance minister's desk ---------------------- */

/* A lever the player drags. Same shape as the budget sliders so the two feel
   like one instrument, and the same mid-drag refresh rule: never redraw the
   screen the slider lives in. */
function lever(id, icon, label, value, suffix, note, range) {
  return '<div class="lev">'
    + '<div class="lvtop"><span class="ico">' + icon + '</span>'
    + '<span class="nm2">' + label + '<span class="cost" id="lvn-' + id + '">' + note + '</span></span>'
    + '<span class="lvv" id="lvv-' + id + '">' + ar(value) + suffix + '</span></div>'
    + '<input type="range" min="' + range.min + '" max="' + range.max + '" step="' + range.step
    + '" value="' + Math.round(value) + '" data-lever="' + id + '">'
    + '</div>';
}

function leverNote(id) {
  var md = BALANCE.mood;
  if (id === 'tax') {
    var free = md.tax_pain_free_below;
    return S.tax <= free ? 'تحت ' + ar(free) + '٪ — الناس مش بتحس'
      : 'فوق ' + ar(free) + '٪ بـ' + ar(S.tax - free) + ' — الناس واجعاها';
  }
  if (id === 'utility') {
    var base = BALANCE.start.utility_price;
    return S.utilPrice <= base ? 'في حدود المعقول'
      : 'أغلى من الأصل بـ' + ar(S.utilPrice - base) + ' — بيدخّل فلوس وبيغضّب';
  }
  return 'بيرخّص الأكل · بيكلّفك ' + ar(S.subsidy) + 'م كل شهر';
}

function treasuryPanel() {
  var L = S.lastMonth, lv = BALANCE.levers;
  var h = '<div class="card"><h3>الخزينة</h3>'
    + '<div class="krow"><span>اللي موجود</span><b style="color:'
    + (S.treasury >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + ar(S.treasury) + 'م</b></div>'
    + '<div class="krow"><span>مؤشر الأسعار</span><b>×' + arDec(S.priceIndex, 2) + '</b></div>'
    + '<div class="krow"><span>سعر الغذاء</span><b style="color:'
    + (S.foodPrice > 62 ? 'var(--bad)' : 'var(--ink)') + '">' + ar(S.foodPrice) + '</b></div>'
    + '</div>';

  if (L) {
    // Every line of the month's books, because the design rule is that no number
    // appears without the player being able to see where it came from.
    h += '<div class="card"><h3>دفتر آخر شهر</h3>'
      + bookRow('ضريبة الدخل', L.incomeTax, 1) + bookRow('ضريبة الشركات', L.corpTax, 1)
      + bookRow('فواتير المرافق', L.bills, 1)
      + '<div class="krow tot"><span>إجمالي الدخل</span><b style="color:var(--good)">+'
      + ar(L.income) + 'م</b></div>'
      + bookRow('تشغيل الوزارات', L.run, -1) + bookRow('مرتبات الإدارة', L.admin, -1)
      + bookRow('مشاريع تحت الإنشاء', L.projects, -1) + bookRow('دعم الغذاء', L.subsidy, -1)
      + bookRow('استيراد غذاء', L.importCost, -1)
      + '<div class="krow tot"><span>إجمالي المصروف</span><b style="color:var(--bad)">−'
      + ar(L.expense) + 'م</b></div>'
      + '<div class="krow tot"><span>الصافي</span><b style="color:'
      + (L.net >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + (L.net >= 0 ? '+' : '−')
      + ar(Math.abs(L.net)) + 'م</b></div></div>';
  }

  h += '<h3 class="sech">المقابض</h3>'
    + lever('tax', '🧾', 'ضريبة الدخل', S.tax, '٪', leverNote('tax'), lv.tax)
    + lever('utility', '💡', 'سعر فواتير المرافق', S.utilPrice, '', leverNote('utility'), lv.utility)
    + lever('subsidy', '🍞', 'دعم الغذاء', S.subsidy, 'م', leverNote('subsidy'), lv.subsidy);

  // The pocket. Kept on the same screen as the books on purpose: the money you
  // take is the money that is missing from the column above.
  var mx = stealMax(S), refusal = stealRefusal(S, mx);
  h += '<h3 class="sech">جيبك</h3>'
    + '<div class="card"><div class="krow"><span>رصيدك الشخصي</span><b style="color:var(--gold)">'
    + ar(S.personal) + 'م</b></div>'
    + '<div class="krow"><span class="sub">بيقلّ مع التضخم زيه زي فلوس أي حد تاني.</span></div></div>'
    + '<button class="danger" data-steal="1"' + (refusal ? ' disabled' : '') + '>'
    + '🕳️ خد ' + ar(mx) + 'م لنفسك'
    + '<span>' + (refusal ? arText(refusal)
      // Two prices, both before the tap: the roll he might lose, and the
      // suspicion he pays whether he loses it or not.
      : 'احتمال وزير ماليتك يسرّبك: ' + ar(leakChance(S, mx)) + '٪ — ولاؤه '
        + ar(S.ministers.finance.loyalty) + ' · شبهة +'
        + arDec(mx / 100 * BALANCE.heat.steal_per_100m, 1)
        + ' (وكمان +' + ar(BALANCE.heat.leak_extra) + ' لو سرّبك)')
    + '</span></button>';
  return h;
}

function bookRow(label, v, sign) {
  return '<div class="krow"><span>' + label + '</span><b style="color:'
    + (sign > 0 ? 'var(--good)' : 'var(--dim)') + '">' + (sign > 0 ? '+' : '−')
    + ar(Math.abs(v)) + 'م</b></div>';
}

/* Sliders must not rebuild the screen they live in — same rule as the budgets.
   Only the number and the sentence under the label move. */
function refreshLever(id) {
  var v = id === 'tax' ? S.tax : id === 'utility' ? S.utilPrice : S.subsidy;
  var suffix = id === 'tax' ? '٪' : id === 'subsidy' ? 'م' : '';
  el('lvv-' + id).textContent = ar(v) + suffix;
  el('lvn-' + id).textContent = leverNote(id);
}

/* ---- the prime minister's desk ---------------------------------------- */

/* Every minister with a sack button next to him. The point of putting the list
   here as well as on the cabinet tab is that this is where you come when you
   have decided somebody has to go — you should not have to hunt for him. */
function pmPanel() {
  var r = MINISTERS.reshuffle;
  var h = '<h3 class="sech">وزراؤك — تقيل أي واحد من هنا</h3>';

  for (var i = 0; i < POST_IDS.length; i++) {
    var id = POST_IDS[i];
    if (id === 'pm') continue;                       // he cannot sack himself
    var p = postOf(id), m = S.ministers[id];
    var refusal = dismissRefusal(S, id);
    h += '<div class="prow">'
      + '<span class="mic">' + p.icon + '</span>'
      + '<span class="pnm">' + p.name
      + '<span class="mof">' + m.name + ' · كفاءة ' + ar(m.competence)
      + ' · ولاء ' + ar(m.loyalty) + '</span></span>'
      + '<button class="mini" data-fire="' + id + '"' + (refusal ? ' disabled' : '')
      + '>قيله</button></div>';
  }

  // The trade against sacking people one by one, stated in the player's words
  // before he presses anything.
  var shift = reshuffleQualityShift(S);
  var refusal = reshuffleRefusal(S);
  h += '<h3 class="sech">التعديل الوزاري</h3>'
    + '<div class="card"><div class="krow"><span class="sub">'
    + 'بيغيّر <b>كل</b> وزرائك مرة واحدة ما عدا رئيس الوزراء نفسه — من غير ما تشوف حد الأول. '
    + 'أسرع وأرخص من إنك تقيلهم واحد واحد، بس أعمى.'
    + '</span></div>'
    + '<div class="krow"><span>كفاءة رئيس وزرائك</span><b>' + ar(S.ministers.pm.competence) + '</b></div>'
    + '<div class="krow"><span>بتزحزح اللي بيجوا</span><b style="color:'
    + (shift >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + (shift >= 0 ? '+' : '−')
    + arDec(Math.abs(shift), 1) + '</b></div>'
    + '<div class="krow"><span>متوسط كفاءة حكومتك دلوقتي</span><b>' + ar(avgCompetence(S)) + '</b></div>'
    + '</div>'
    + '<button class="danger" data-shuffle="1"' + (refusal ? ' disabled' : '') + '>'
    + '🔄 اعمل تعديل وزاري'
    + '<span>' + (refusal ? arText(refusal)
      : 'بيكلّف ' + ar(r.ap_cost) + ' طاقة · −' + ar(r.stability_hit) + ' ثبات · −'
        + ar(r.approval_hit) + ' رضا · ومش هينفع تاني قبل ' + ar(r.cooldown_months) + ' شهر')
    + '</span></button>';
  return h;
}

/* ---- the dismissal sheet ---------------------------------------------- */
function openFire(post) {
  var p = postOf(post), m = S.ministers[post], list = candidatesFor(S, post);
  var h = '<div class="sheet"><div class="sh"><span class="ic2">' + p.icon + '</span>'
    + '<span class="nm3">بديل ' + p.name + '</span>'
    + '<button class="x" data-close="1">✕</button></div>'
    + '<p class="lede2">' + m.name + ' كفاءته ' + ar(m.competence) + ' وولاؤه ' + ar(m.loyalty)
    + '. اختار واحد من التلاتة — الأرقام دي هي اللي هتاخدها بالظبط، مفيش مفاجآت.</p>'
    // The price is restated here, not only on the button behind the sheet: this
    // is the screen where the player actually commits.
    + '<div class="calc2">'
    + '<div class="cr2"><span>بيكلّف</span><b>' + ar(MINISTERS.dismiss.ap_cost) + ' طاقة قرارات</b></div>'
    + '<div class="cr2"><span>وبيهزّ الثبات</span><b style="color:var(--bad)">−'
    + ar(MINISTERS.dismiss.stability_hit) + '</b></div>'
    + '<div class="cr2"><span>الثبات دلوقتي</span><b>' + ar(S.stability) + '</b></div>'
    + '</div>';

  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    var dC = c.competence - m.competence, dL = c.loyalty - m.loyalty;
    h += '<button class="pickg" data-hire="' + i + '" data-firepost="' + post + '">'
      + '<div class="r1"><span class="gn">' + c.name + '</span>'
      + '<span class="cv">' + partyName(c.party) + '</span></div>'
      + '<div class="r2">كفاءة <b style="color:' + svcColor(c.competence) + '">' + ar(c.competence)
      + '</b> ' + deltaTag(dC) + ' · ولاء <b style="color:' + svcColor(c.loyalty) + '">'
      + ar(c.loyalty) + '</b> ' + deltaTag(dL) + '</div></button>';
  }
  h += '<div class="warn2">التلاتة دول بتوع الشهر ده. لو مشّيت شهر، بيتغيّروا.</div></div>';
  el('ovl').innerHTML = h;
  el('ovl').classList.remove('hidden');
}

function deltaTag(d) {
  if (Math.round(d) === 0) return '<span class="dl same">=</span>';
  return '<span class="dl ' + (d > 0 ? 'up' : 'dn') + '">'
    + (d > 0 ? '▲+' : '▼') + ar(Math.abs(d)) + '</span>';
}

/* ---- the street, on the interior minister's desk ------------------------ */

/* The whole trade on one card. The failure case is spelled out next to the
   success case on purpose: a button that only advertises what it does when it
   works is not a priced decision. */
function streetPanel() {
  var c = CRACKDOWN, no = crackdownRefusal(S), md = BALANCE.mood;
  var pct = Math.round(S.boil / md.boil_cap * 100);

  var h = '<h3 class="sech">الشارع</h3>'
    + '<div class="card">'
    + '<div class="krow"><span>الغليان</span><b style="color:'
    + (pct >= 60 ? 'var(--bad)' : pct >= 30 ? 'var(--warn)' : 'var(--good)') + '">'
    + ar(pct) + '٪</b></div>'
    + '<div class="krow"><span>بيفجّر شغب عند</span><b>' + ar(md.boil_cap) + '</b></div>'
    + '<div class="krow"><span>احتمال نجاح القمع</span><b>' + ar(crackdownChance(S)) + '٪</b></div>'
    + '<div class="krow"><span class="sub">الغليان بيعلى لما الرضا والثبات يبقوا تحت '
    + 'الخط مع بعض، وبيهدا لوحده ' + ar(md.boil_cooldown) + ' في الشهور الكويسة.'
    + '</span></div></div>'
    + '<div class="calc2">'
    + '<div class="cr2"><span>لو نجح</span><b style="color:var(--good)">غليان '
    + ar(c.win.boil) + ' · ثبات +' + ar(c.win.stability) + '</b></div>'
    + '<div class="cr2"><span>وبتدفع</span><b style="color:var(--bad)">رضا '
    + ar(c.win.approval) + ' · شبهة +' + ar(c.win.heat) + '</b></div>'
    + '<div class="cr2"><span>لو فشل</span><b style="color:var(--bad)">غليان +'
    + ar(c.fail.boil) + ' · رضا ' + ar(c.fail.approval) + ' · ثبات '
    + ar(c.fail.stability) + ' · شبهة +' + ar(c.fail.heat) + '</b></div>'
    + '</div>'
    + '<button class="danger" data-crack="1"' + (no ? ' disabled' : '') + '>'
    + '🚔 انزل الأمن على الشارع'
    + '<span>' + (no ? arText(no)
      : 'بيكلّف ' + ar(c.cost.ap) + ' طاقة و' + ar(c.cost.treasury) + 'م · '
        + 'ومش هينفع تاني قبل ' + ar(c.cost.once_per_months) + ' شهور')
    + '</span></button>';
  return h;
}

/* ---- the army, on the defence minister's desk --------------------------- */

/* One card, two halves: what the risk is doing to you every month, and the one
   thing you can do about it. Both halves are priced before the tap — the money,
   the energy, AND the chance the money never arrives. */
function barracksPanel() {
  var a = ARMY, risk = coupRiskChange(S), no = bribeRefusal(S);
  var pct = Math.round(S.coupRisk / a.risk_cap * 100);
  var months = risk > 0 ? Math.ceil((a.risk_cap - S.coupRisk) / risk) : 0;

  var h = '<h3 class="sech">الجيش</h3>'
    + '<div class="card">'
    + '<div class="krow"><span>ولاؤه = الجيش</span><b style="color:' + svcColor(army(S))
    + '">' + ar(army(S)) + '</b></div>'
    + '<div class="krow"><span>خط الخطر</span><b>' + ar(armyLine(S)) + '</b></div>'
    + '<div class="krow"><span>خطر الانقلاب</span><b style="color:'
    + (pct >= 50 ? 'var(--bad)' : pct > 0 ? 'var(--warn)' : 'var(--good)') + '">'
    + ar(pct) + '٪</b></div>'
    + '<div class="krow"><span>الشهر ده</span><b style="color:'
    + (risk > 0 ? 'var(--bad)' : 'var(--good)') + '">'
    + (risk > 0 ? '+' : '−') + arDec(Math.abs(risk), 1) + '</b></div>'
    + '<div class="krow"><span>وبينزّل ثباتك كل شهر</span><b style="color:var(--bad)">−'
    + arDec(S.coupRisk * a.stability_coef, 1) + '</b></div>'
    + '<div class="krow"><span class="sub">'
    + (risk > 0
      ? '⚠️ بالمعدّل ده الجيش بيتحرك بعد ' + ar(months) + ' شهر.'
      : 'الجيش معاك. الخطر بينزل لوحده طول ما ولاؤه فوق الخط.')
    + '</span></div></div>'
    + '<button class="danger" data-bribe="1"' + (no ? ' disabled' : '') + '>'
    + '🎖️ ادفع للضباط ' + ar(a.bribe.cost) + 'م من جيبك'
    + '<span>' + (no ? arText(no)
      : '+' + ar(a.bribe.loyalty_gain) + ' ولاء · ' + ar(a.bribe.ap_cost) + ' طاقة · شبهة +'
        + ar(a.bribe.heat) + ' · احتمال ' + ar(bribeLostChance(S))
        + '٪ إنه ياخدها ومتوصلش (وقتها +' + ar(a.bribe.lost_loyalty_gain) + ' بس)')
    + '</span></button>';
  return h;
}

/* ---- suspicion, on the president's own desk ---------------------------- */

/* Reads heatSources() rather than recomputing anything. If this screen did its
   own arithmetic it would drift from the engine's the first time a coefficient
   changed, and the player would be reading a lie that adds up. */
function heatCard() {
  var hc = BALANCE.heat, src = heatSources(S), net = heatChange(S);
  var m = S.ministers.media;
  var color = S.heat >= hc.scandal_at ? 'var(--bad)'
    : S.heat > hc.scandal_at * 0.6 ? 'var(--warn)' : 'var(--good)';
  var monthsLeft = net > 0 ? Math.ceil((hc.scandal_at - S.heat) / net) : 0;

  var h = '<div class="card"><h3>الشبهة</h3>'
    + '<div class="krow"><span>دلوقتي</span><b style="color:' + color + '">'
    + ar(S.heat) + ' من ' + ar(hc.cap) + '</b></div>'
    + '<div class="krow"><span>خط الفضيحة</span><b>' + ar(hc.scandal_at) + '</b></div>'
    + '<div class="krow"><span>وزرا ولاؤهم واطي (' + ar(src.talkers) + ')</span>'
    + '<b style="color:var(--bad)">+' + arDec(src.talk, 1) + '</b></div>'
    + '<div class="krow"><span>' + postOf('media').name + ' (' + esc(m.name) + ')</span>'
    + '<b style="color:var(--good)">−' + arDec(src.media, 1) + '</b></div>'
    + '<div class="krow"><span>بينسى لوحده</span><b style="color:var(--good)">−'
    + arDec(src.decay, 1) + '</b></div>'
    + '<div class="krow tot"><span>الشهر ده</span><b style="color:'
    + (net > 0 ? 'var(--bad)' : 'var(--good)') + '">'
    + (net > 0 ? '+' : '−') + arDec(Math.abs(net), 1) + '</b></div>';

  if (S.heat >= hc.scandal_at) {
    h += '<div class="krow"><span class="sub">إنت فوق الخط — الفضيحة مستنية بس بوابة المعدّل تسمح.</span></div>';
  } else if (net > 0) {
    h += '<div class="krow"><span class="sub">بالمعدّل ده توصل خط الفضيحة بعد '
      + ar(monthsLeft) + ' شهر.</span></div>';
  } else {
    h += '<div class="krow"><span class="sub">نازلة — مفيش فضيحة في الطريق دلوقتي.</span></div>';
  }
  return h + '</div>';
}

/* Shown only while the risk is above zero — see the call site. */
function coupCard() {
  if (S.coupRisk <= 0) return '';
  var a = ARMY, risk = coupRiskChange(S);
  var pct = Math.round(S.coupRisk / a.risk_cap * 100);
  return '<div class="card danger2"><h3>⚠️ الجيش</h3>'
    + '<div class="krow"><span>خطر الانقلاب</span><b style="color:var(--bad)">'
    + ar(pct) + '٪</b></div>'
    + '<div class="krow"><span>ولاء ' + postOf('defence').name + '</span><b style="color:'
    + svcColor(army(S)) + '">' + ar(army(S)) + '</b></div>'
    + '<div class="krow"><span>الشهر ده</span><b style="color:'
    + (risk > 0 ? 'var(--bad)' : 'var(--good)') + '">'
    + (risk > 0 ? '+' : '−') + arDec(Math.abs(risk), 1) + '</b></div>'
    + '<button class="jump" data-open="minister" data-openid="defence">'
    + '🎖️ روح لوزير الدفاع<span>الرشوة والأرقام كلها هناك</span></button>'
    + '</div>';
}

function presBody() {
  var h = '';
  {
    var g = govOf(S), s = socOf(S);
    h += '<div class="card"><h3>' + esc(S.country) + '</h3>'
      + '<div class="krow"><span>نظام الحكم</span><b>' + g.ic + ' ' + g.nm + '</b></div>'
      + '<div class="krow"><span>طبيعة المجتمع</span><b>' + s.ic + ' ' + s.nm + '</b></div>'
      + '<div class="krow"><span>شهور في الحكم</span><b>' + ar(S.totalMonths) + '</b></div>'
      + '<div class="krow"><span>الخزينة</span><b>' + ar(S.treasury) + 'م</b></div>'
      + '<div class="krow"><span>مؤشر الأسعار</span><b>×' + arDec(S.priceIndex, 2) + '</b></div></div>';
    // The books used to live here. They belong to the man who keeps them, so
    // this tab now shows the headline and a way in — one number, one door.
    if (S.lastMonth) {
      var L = S.lastMonth;
      h += '<button class="jump" data-open="minister" data-openid="finance">'
        + '💰 الشهر ده: ' + (L.net >= 0 ? 'فائض ' : 'عجز ') + ar(Math.abs(L.net)) + 'م'
        + '<span>الدفتر كامل والضرايب والدعم عند ' + postOf('finance').name + '</span></button>';
    }
    // Where the suspicion is coming from, in the same numbers the engine used.
    // A running total the player is punished by and cannot account for is the
    // one thing this system was built not to be.
    h += heatCard();
    // Only once it is actually running. A permanent card reading zero teaches
    // the player to scroll past the place the warning will appear.
    h += coupCard();
    if (S.log.length) {
      h += '<div class="card"><h3>آخر الأخبار</h3>'
        + S.log.slice(-6).reverse().map(function (l) { return '<div class="log">' + l + '</div>'; }).join('')
        + '</div>';
    }
  }
  return h;
}

/* --------------------------------------------------------- situation card */
/* How each kind of price is written out. A cost key that is not in here would
   render as a blank price — a button that looks free and then charges — so
   check.py refuses to build if situations.json ever uses a key this map has
   no line for. */
var COST_LABEL = {
  ap:       function (n) { return ar(n) + ' طاقة'; },
  treasury: function (n) { return ar(n) + 'م من الخزينة'; },
  personal: function (n) { return ar(n) + 'م من جيبك'; }
};

function priceOf(ch) {
  var c = ch.cost || {}, parts = [], k;
  for (k in COST_LABEL) if (c[k]) parts.push(COST_LABEL[k](c[k]));
  if (!parts.length) return '<span class="ofree">ببلاش</span>';
  return parts.join('<br>');
}

/* The card is a pure function of S.pendingSituation, redrawn on every
   drawGame(). Nothing in this file writes that field — only answerSituation()
   in the engine clears it — so there is no code path anywhere in the UI that
   can close this card without a decision being taken. That is the whole point:
   an escape hatch here would be silent, and would only show up as "the game let
   me skip the crisis" months after it shipped. */
function drawSituation() {
  var box = el('sit');
  if (!S || !S.pendingSituation) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  var sit = situationById(S.pendingSituation);
  if (!sit) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  // A scandal is marked on the card. Same machinery, different weather: the
  // player must be able to tell "the country has a problem" from "you have a
  // problem" without reading the text twice.
  var bad = (sit.kind === 'scandal');
  var h = '<div class="sbox' + (bad ? ' scandal' : '') + '">'
    + (bad ? '<div class="sflag">فضيحة · شبهتك ' + ar(S.heat) + '</div>' : '')
    + '<div class="shd"><span class="sic">' + sit.icon + '</span>'
    + '<span class="stt">' + arText(esc(sit.title)) + '</span></div>'
    + '<div class="stx">' + arText(esc(sit.text)) + '</div>'
    // What he has to spend, next to what each choice costs. Without this he has
    // to leave the card to find out why an option is locked — and he cannot.
    + '<div class="purse">'
    + '<div class="pit"><span>طاقة القرارات</span><b>' + ar(S.ap) + '/' + ar(S.apMax) + '</b></div>'
    + '<div class="pit"><span>الخزينة</span><b>' + ar(S.treasury) + 'م</b></div>'
    + '<div class="pit"><span>رصيدك</span><b>' + ar(S.personal) + 'م</b></div>'
    + '</div>';

  for (var i = 0; i < sit.choices.length; i++) {
    var ch = sit.choices[i];
    // The engine decides what is affordable, not this screen. If the two ever
    // disagreed, the player would press a button that looks open and get a
    // refusal — so there is only one answer to the question, and it is there.
    var why = choiceRefusal(S, sit, i);
    // The price stays on the button even when it is locked. Replacing it with
    // the refusal was worse: he could see what he was short of but not what the
    // thing cost, so he had no way to judge whether it was worth chasing.
    h += '<button class="sopt' + (why ? ' lock' : '') + '" data-answer="' + i + '">'
      + '<div class="orow"><span class="onm">' + arText(esc(ch.nm)) + '</span>'
      + '<span class="opr">' + priceOf(ch) + '</span></div>'
      + '<div class="osub">' + arText(esc(ch.sub)) + '</div>'
      + (why ? '<div class="olock">🔒 ' + arText(why) + '</div>' : '')
      + '</button>';
  }
  h += '<div class="must">' + (bad
      ? 'الفضيحة حصلت خلاص — الاختيار هنا بيحدد تدفع تمنها إزاي، مش تهرب منها.'
      : 'الوقت واقف لحد ما تقرر. مفيش رجوع من الشاشة دي — الاختيار المجاني موجود دايمًا.')
    + '</div></div>';
  box.innerHTML = h;
  box.classList.remove('hidden');
}

function drawClock() {
  el('pp').textContent = running ? '⏸' : '▶';
  el('pp').className = 'cbtn' + (running ? ' on' : '');
  for (var i = 0; i < 3; i++) el('sp' + i).className = 'cbtn' + (speed === i ? ' on' : '');
}

function drawGame() {
  drawTop(); drawNav(); drawView(); drawClock(); drawSituation();
  // Saved here and nowhere else. Every action and every month ends in a
  // redraw, so no branch of the click handler can forget it — which is exactly
  // how a player loses the move he just made.
  persist();
}

/* ------------------------------------------------------------------ clock */
/* The timer is the only thing that knows about real time. tickMonth() has no
   idea it exists, which is what makes the time model swappable later. */
function schedule() {
  if (timer) { clearInterval(timer); timer = null; }
  if (running) timer = setInterval(step, SPEEDS[speed] * 1000);
}
/* The refusal lives here and not on the play button, because "the clock cannot
   start while a decision is pending" is a rule about the clock — guarding the
   one caller we happen to remember is how it comes back later. */
function setRunning(v) {
  if (v && S && S.pendingSituation) return;
  running = v; schedule(); drawClock();
}
/* Turns an engine event into a line the player reads. Every number goes through
   ar() here, so nothing can reach the screen in Latin digits. */
function eventText(e) {
  if (e.type === 'year') return 'بدأت السنة ' + ar(e.year) + '.';
  if (e.type === 'built') {
    return '🏗️ افتتح ' + BALANCE.services[e.svc].name + ' جديد في '
      + BALANCE.governorates[e.gov].name + ' — والمصروف الشهري زاد '
      + arDec(BALANCE.services[e.svc].adds_monthly, 1) + 'م للأبد.';
  }
  if (e.type === 'situation') {
    var sit = situationById(e.id);
    if (!sit) return 'موقف — مستني قرارك.';
    return sit.icon + ' ' + sit.title
      + (sit.kind === 'scandal' ? ' — فضيحة، مستنية قرارك.' : ' — مستني قرارك.');
  }
  if (e.type === 'deficit') {
    return '⚠️ الخزينة دخلت عجز. المرتبات مش مدفوعة، والخدمات بتنهار بسرعة مضاعفة.';
  }
  if (e.type === 'army') {
    return '🎖️ خطر الانقلاب وصل ' + ar(e.pct) + '٪ — ولاء ' + postOf('defence').name
      + ' ' + ar(e.loyalty) + '.';
  }
  if (e.type === 'boiling') {
    return '🔥 الغليان وصل ' + ar(e.pct) + '٪ — الشارع مش مطمئن.';
  }
  if (e.type === 'end') {
    if (e.reason === 'coup') {
      return '💥 الجيش تحرك. ' + e.minister + ' مبقاش معاك، وانتهى حكمك بانقلاب.';
    }
    if (e.reason === 'riot') {
      return '💥 قام الشغب في ' + BALANCE.governorates[e.gov].name + ' وانتهى حكمك بالعزل.';
    }
    return '💥 الاقتصاد انهار من التضخم. انتهى حكمك.';
  }
  return e.text || '';
}

function step() {
  var events = tickMonth(S);
  events.forEach(function (e) {
    var line = eventText(e);
    if (line) logLine(S, line);
    // A finished project, a deficit or the end are things the player must not
    // scroll past — put them in front of whichever screen they are on.
    if (e.type === 'built' || e.type === 'deficit' || e.type === 'end'
      || e.type === 'boiling' || e.type === 'army') {
      toast(line);
    }
    // A situation can land while a sheet is open. Close it, or the player is
    // looking at a card he cannot dismiss on top of a decision he must take.
    if (e.type === 'situation') closeSheet();
  });
  // Anything the player must see stops the clock. Later this is where a crisis,
  // a scandal or a finished project will pause the game for a decision.
  if (events.length) setRunning(false);
  drawGame();
}

/* ----------------------------------------------------------------- events */
var CLICKABLE = ['data-pick', 'data-nav', 'data-roll', 'data-tab', 'data-clock',
                 'data-build', 'data-close', 'data-buildgov',
                 'data-open', 'data-back', 'data-fire', 'data-hire', 'data-steal',
                 'data-shuffle', 'data-print', 'data-governor', 'data-answer', 'data-bribe',
                 'data-crack', 'data-menu', 'data-speed'];

document.addEventListener('click', function (ev) {
  // Every clickable attribute must be listed here or its button does nothing.
  // Forgetting one is silent — the button simply never responds.
  var t = ev.target.closest('[' + CLICKABLE.join('],[') + ']');
  if (!t) return;
  if (t.dataset.pick) {
    var list = t.dataset.pick === 'gov' ? SETUP.government_types : SETUP.society_types;
    setupState[t.dataset.pick] = list[+t.dataset.i];
    drawSetup();
  } else if (t.dataset.roll) {
    var names = t.dataset.roll === 'country' ? SETUP.suggested_country_names : SETUP.suggested_ruler_names;
    setupState[t.dataset.roll] = names[Math.floor(Math.random() * names.length)];
    drawSetup();
  } else if (t.dataset.nav) {
    captureNames();
    if (t.dataset.nav === 'back') {
      if (setupState.step > 0) { setupState.step--; drawSetup(); }
      else showView('menu');
    }
    else if (setupState.step < 3) { setupState.step++; drawSetup(); }
    else startGame();
  } else if (t.dataset.tab) {
    goTab(t.dataset.tab);
  } else if (t.dataset.open) {
    openScreen(t.dataset.open, t.dataset.openid || null);
  } else if (t.dataset.back) {
    backScreen();
  } else if (t.dataset.answer !== undefined) {
    // A locked choice keeps its button on purpose: pressing it says why it is
    // locked. The engine is asked either way, so a disabled-looking button and
    // an actually-refused one can never drift apart.
    var sitNow = situationById(S.pendingSituation);
    var pick = sitNow && sitNow.choices[+t.dataset.answer];
    var nope = answerSituation(S, +t.dataset.answer);
    if (nope) { toast(nope); }
    else {
      var dl = sitNow.icon + ' ' + sitNow.title + ' — قررت: ' + pick.nm + '.';
      logLine(S, dl); toast(dl); drawGame();
    }
  } else if (t.dataset.steal) {
    var take = stealMax(S);
    var res = stealFromTreasury(S, take);
    if (typeof res === 'string') { toast(res); }
    else {
      var line = res.leaked
        ? '🕳️ خدت ' + ar(take) + 'م — و' + postOf('finance').name
          + ' سرّبك. الناس عرفت، والشبهة بقت ' + ar(S.heat) + '.'
        : '🕳️ خدت ' + ar(take) + 'م لجيبك. محدش اتكلم — والشبهة بقت ' + ar(S.heat) + '.';
      logLine(S, line);
      toast(line);
      drawGame();
    }
  } else if (t.dataset.menu) {
    onMenu(t.dataset.menu);
  } else if (t.dataset.speed) {
    prefs.speed = +t.dataset.speed; savePrefs(); drawMenu();
  } else if (t.dataset.crack) {
    var cd = crackdown(S);
    if (typeof cd === 'string') { toast(cd); }
    else {
      var cl = cd.worked
        ? '🚔 الأمن نزل والشارع هدي — الغليان بقى ' + ar(S.boil) + ' والرضا ' + ar(S.approval) + '.'
        : '🚔 القمع فشل. الشارع ولّع أكتر — الغليان بقى ' + ar(S.boil)
          + ' والرضا ' + ar(S.approval) + '.';
      logLine(S, cl); toast(cl); drawGame();
    }
  } else if (t.dataset.bribe) {
    var out = bribeArmy(S);
    if (typeof out === 'string') { toast(out); }
    else {
      var bl = out.lost
        ? '🎖️ دفعت ' + ar(ARMY.bribe.cost) + 'م — و' + S.ministers.defence.name
          + ' خدها. الضباط شافوا ' + ar(out.gain) + ' بس.'
        : '🎖️ دفعت ' + ar(ARMY.bribe.cost) + 'م للضباط — ولاء الجيش بقى '
          + ar(army(S)) + '.';
      logLine(S, bl); toast(bl); drawGame();
    }
  } else if (t.dataset.print) {
    var amount = printCap(S);
    var whyNot = printMoney(S, amount);
    if (whyNot) { toast(whyNot); }
    else {
      var pl = '🖨️ البنك طبع ' + ar(amount) + 'م — والتضخم بقى ' + arDec(S.inflation, 1)
        + '٪ والشبهة ' + ar(S.heat) + '.';
      logLine(S, pl); toast(pl); drawGame();
    }
  } else if (t.dataset.governor) {
    var was = S.bank.independence;
    var no = swapGovernor(S);
    if (no) { toast(no); }
    else {
      var gl = '⚖️ ' + S.bank.name + ' بقى محافظ البنك — استقلاله ' + ar(S.bank.independence)
        + ' بدل ' + ar(was) + '، والشبهة بقت ' + ar(S.heat) + '.';
      logLine(S, gl); toast(gl); drawGame();
    }
  } else if (t.dataset.shuffle) {
    var out = reshuffleCabinet(S);
    if (typeof out === 'string') { toast(out); }
    else {
      // Say what actually happened to the government, not just that something
      // did. A blind move still owes the player a result he can read.
      var up = 0, down = 0;
      out.changed.forEach(function (c) { if (c.after > c.before) up++; else if (c.after < c.before) down++; });
      var line = '🔄 تعديل وزاري: ' + ar(out.changed.length) + ' وزير اتغيّروا — '
        + ar(up) + ' أحسن من اللي قبلهم و' + ar(down) + ' أوحش.';
      logLine(S, line);
      toast(line);
      drawGame();
    }
  } else if (t.dataset.fire) {
    openFire(t.dataset.fire);
  } else if (t.dataset.hire) {
    var post = t.dataset.firepost;
    var picked = candidatesFor(S, post)[+t.dataset.hire];
    var why = dismissMinister(S, post, +t.dataset.hire);
    closeSheet();
    if (why) { toast(why); }
    else {
      toast('⚖️ ' + picked.name + ' بقى ' + postOf(post).name + '.');
      logLine(S, 'عيّنت ' + picked.name + ' ' + postOf(post).name
        + ' بكفاءة ' + ar(picked.competence) + ' وولاء ' + ar(picked.loyalty) + '.');
      drawGame();
    }
  } else if (t.dataset.build) {
    openBuild(t.dataset.build, t.dataset.buildin || null);
  } else if (t.dataset.close) {
    closeSheet();
  } else if (t.dataset.buildgov) {
    var err = startProject(S, t.dataset.buildgov, t.dataset.buildsvc);
    closeSheet();
    if (err) { toast(err); }
    else {
      toast('🏗️ بدأ إنشاء ' + BALANCE.services[t.dataset.buildsvc].name + ' في '
        + BALANCE.governorates[t.dataset.buildgov].name);
      drawGame();
    }
  } else if (t.dataset.clock === 'pp') {
    // setRunning() refuses on its own; this is only so the press says something
    // instead of looking broken.
    if (S.pendingSituation) toast('الوقت واقف — لازم تاخد قرار في الموقف الأول.');
    else setRunning(!running);
  } else if (t.dataset.clock) {
    speed = +t.dataset.clock; schedule(); drawClock();
  }
});

/* Range inputs fire "input" on every pixel of a drag, so this must stay cheap
   and must not touch the DOM the slider itself lives in. */
document.addEventListener('input', function (ev) {
  var d = ev.target && ev.target.dataset;
  if (!d || !S) return;
  if (d.pct) { S.pct[d.pct] = +ev.target.value; refreshService(d.pct); return; }
  if (d.lever) {
    var v = +ev.target.value;
    if (d.lever === 'tax') S.tax = v;
    else if (d.lever === 'utility') S.utilPrice = v;
    else S.subsidy = v;
    refreshLever(d.lever);
  }
});

function captureNames() {
  var c = el('cn'), r = el('rn');
  if (c) setupState.country = c.value.trim();
  if (r) setupState.ruler = r.value.trim();
}

function startGame() {
  if (!setupState.country) setupState.country = SETUP.suggested_country_names[0];
  if (!setupState.ruler) setupState.ruler = SETUP.suggested_ruler_names[0];
  S = newGame(setupState);
  logLine(S, 'بدأ حكم ' + S.ruler + ' في ' + S.country + '.');
  speed = prefs.speed;
  showView('game');
}

/* What each button on the menu does. One function so the list of what the menu
   can do is readable in one place. */
function onMenu(what) {
  if (what === 'new') {
    setupState = { step: 0, country: '', ruler: '', gov: null, soc: null };
    showView('setup');
  } else if (what === 'resume') {
    var saved = readSave();
    if (!saved) { toast('مفيش فترة حكم محفوظة'); drawMenu(); return; }
    S = saved;
    speed = prefs.speed;
    running = false;
    stack = [{ s: 'tab', id: 'pres' }];
    showView('game');
  } else if (what === 'settings') { menuPage = 'settings'; drawMenu(); }
  else if (what === 'about') { menuPage = 'about'; drawMenu(); }
  else if (what === 'main') { menuPage = 'main'; drawMenu(); }
  else if (what === 'wipe') { openWipe(); }
  else if (what === 'wipeyes') {
    storeSet(SAVE_KEY, null);
    closeSheet();
    toast('اتمسح. ابدأ فترة حكم جديدة.');
    drawMenu();
  } else if (what === 'exit') {
    // In a browser there is nothing to close; say so instead of doing nothing.
    if (!exitApp()) toast('الخروج بيشتغل جوّه التطبيق بس.');
  }
}

/* Asked before wiping, because it is the one button on the menu that destroys
   something the player cannot get back. */
function openWipe() {
  var saved = readSave();
  el('ovl').innerHTML = '<div class="sheet"><div class="sh"><span class="ic2">🗑️</span>'
    + '<span class="nm3">امسح الحفظ؟</span>'
    + '<button class="x" data-close="1">✕</button></div>'
    + '<p class="lede2">' + (saved ? arText(esc(saveLabel(saved))) : '') + '<br>'
    + 'فترة الحكم دي هتضيع خالص ومفيش طريقة ترجّعها.</p>'
    + '<button class="danger" data-menu="wipeyes">امسحها</button>'
    + '<button class="mbtn" data-close="1">سيبها</button></div>';
  el('ovl').classList.remove('hidden');
}

el('artdefs').innerHTML = ART_DEFS;
loadPrefs();
speed = prefs.speed;
showView('menu');
