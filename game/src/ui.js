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
function el(id) { return document.getElementById(id); }

var S = null;                 // the game state, null while in setup
var tab = 'pres';
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
  if (st.gov && st.gov.id === 'dictator') h += '<div class="flag">⚠️ رضا الجيش تحت ٣٠ = انقلاب فوري. راقب وزير الدفاع.</div>';
  if (st.gov && st.gov.id === 'monarchy') h += '<div class="flag">👑 مفيش انتخابات ومفيش مدة. بتفضل لحد ما يشيلوك.</div>';
  if (st.soc && st.soc.id === 'divided') h += '<div class="flag">⚡ الوضع الصعب. ما تلعبهوش أول مرة.</div>';
  return h;
}

function setupFoot() {
  var st = setupState;
  var ok = st.step === 1 ? !!st.gov : st.step === 2 ? !!st.soc : true;
  return (st.step > 0 ? '<button class="btn ghost" data-nav="back">⟶ رجوع</button>' : '')
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

/* ------------------------------------------------------------------- game */
var TABS = [['pres', '🏛️', 'الرئاسة'], ['treas', '💰', 'الخزينة'], ['serv', '🏗️', 'الخدمات'],
            ['govt', '👔', 'الحكومة'], ['pol', '⚖️', 'السياسة']];

/* Each tab names the plan item that fills it. Blind building means Karim must
   be able to see what is done and what is not without asking. */
var SOON = {
  pres: ['🏛️', 'الرئاسة', 'المواقف اللي بتيجي لك، ومكتب الرئاسة والأفعال اللي بتبدأها إنت.', 'البند ١٢'],
  treas: ['💰', 'الخزينة', 'الدخل والمصروف والضرايب وأسعار الخدمات ودعم الغذاء.', 'البند ٨'],
  serv: ['🏗️', 'الخدمات', 'السبع خدمات، التشغيل والبناء، وفلتر المحافظات الخمسة.', 'البند ٧'],
  govt: ['👔', 'الحكومة', 'رئيس الوزراء والوزرا التمنية، الولاء والكفاءة، والبنك المركزي.', 'البند ١٠'],
  pol: ['⚖️', 'السياسة', 'الأحزاب الأربعة والكتل الاجتماعية الخمسة والصراع بينهم.', 'البند ١٣']
};

function meterColor(v) { return v >= 65 ? 'var(--good)' : v >= 45 ? 'var(--warn)' : 'var(--bad)'; }

function drawTop() {
  var g = govOf(S), dg = danger(S);
  el('date').innerHTML = 'الشهر <b>' + ar(S.month) + '</b> · السنة <b>' + ar(S.year) + '</b>';
  el('who').textContent = g.ic + ' ' + S.ruler + ' — ' + S.country;
  var m = [
    ['الرضا', S.approval, meterColor(S.approval), ar(S.approval), dg.approval],
    ['الثبات', S.stability, meterColor(S.stability), ar(S.stability), dg.stability],
    ['التضخم', Math.min(100, S.inflation * 2), dg.inflation ? 'var(--bad)' : 'var(--good)', ar(S.inflation) + '٪', dg.inflation],
    ['الطاقة', S.ap / S.apMax * 100, 'var(--info)', ar(S.ap) + '/' + ar(S.apMax), false]
  ];
  el('meters').innerHTML = m.map(function (x) {
    return '<div class="mtr' + (x[4] ? ' danger' : '') + '"><span class="lb">' + x[0] + '</span>'
      + '<span class="vl" style="color:' + x[2] + '">' + x[3] + '</span>'
      + '<div class="bar"><div class="fl" style="width:' + Math.max(0, Math.min(100, x[1])) + '%;background:' + x[2] + '"></div></div></div>';
  }).join('');
}

function drawNav() {
  el('nav').innerHTML = TABS.map(function (t) {
    return '<button class="' + (tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '"><i>' + t[1] + '</i>' + t[2] + '</button>';
  }).join('');
}

function drawView() {
  var h = '';
  if (tab === 'pres') {
    var g = govOf(S), s = socOf(S);
    h += '<div class="card"><h3>' + esc(S.country) + '</h3>'
      + '<div class="krow"><span>نظام الحكم</span><b>' + g.ic + ' ' + g.nm + '</b></div>'
      + '<div class="krow"><span>طبيعة المجتمع</span><b>' + s.ic + ' ' + s.nm + '</b></div>'
      + '<div class="krow"><span>شهور في الحكم</span><b>' + ar(S.totalMonths) + '</b></div>'
      + '<div class="krow"><span>الخزينة</span><b>' + ar(S.treasury) + 'م</b></div>'
      + '<div class="krow"><span>مؤشر الأسعار</span><b>×' + arDec(S.priceIndex, 2) + '</b></div></div>';
    if (S.log.length) {
      h += '<div class="card"><h3>آخر الأخبار</h3>'
        + S.log.slice(-6).reverse().map(function (l) { return '<div class="log">' + l + '</div>'; }).join('')
        + '</div>';
    }
  }
  var k = SOON[tab];
  h += '<div class="soon"><span class="ic">' + k[0] + '</span><h3>' + k[1] + '</h3>'
    + '<p>' + k[2] + '</p><span class="item">لسه بيتبني — ' + k[3] + '</span></div>';
  el('view').innerHTML = h;
}

function drawClock() {
  el('pp').textContent = running ? '⏸' : '▶';
  el('pp').className = 'cbtn' + (running ? ' on' : '');
  for (var i = 0; i < 3; i++) el('sp' + i).className = 'cbtn' + (speed === i ? ' on' : '');
}

function drawGame() { drawTop(); drawNav(); drawView(); drawClock(); }

/* ------------------------------------------------------------------ clock */
/* The timer is the only thing that knows about real time. tickMonth() has no
   idea it exists, which is what makes the time model swappable later. */
function schedule() {
  if (timer) { clearInterval(timer); timer = null; }
  if (running) timer = setInterval(step, SPEEDS[speed] * 1000);
}
function setRunning(v) { running = v; schedule(); drawClock(); }
/* Turns an engine event into a line the player reads. Every number goes through
   ar() here, so nothing can reach the screen in Latin digits. */
function eventText(e) {
  if (e.type === 'year') return 'بدأت السنة ' + ar(e.year) + '.';
  return e.text || '';
}

function step() {
  var events = tickMonth(S);
  events.forEach(function (e) {
    var line = eventText(e);
    if (line) S.log.push(line);
  });
  // Anything the player must see stops the clock. Later this is where a crisis,
  // a scandal or a finished project will pause the game for a decision.
  if (events.length) setRunning(false);
  drawGame();
}

/* ----------------------------------------------------------------- events */
document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-pick],[data-nav],[data-roll],[data-tab],[data-clock]');
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
    if (t.dataset.nav === 'back') { setupState.step--; drawSetup(); }
    else if (setupState.step < 3) { setupState.step++; drawSetup(); }
    else startGame();
  } else if (t.dataset.tab) {
    tab = t.dataset.tab; drawNav(); drawView();
  } else if (t.dataset.clock === 'pp') {
    setRunning(!running);
  } else if (t.dataset.clock) {
    speed = +t.dataset.clock; schedule(); drawClock();
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
  S.log.push('بدأ حكم ' + S.ruler + ' في ' + S.country + '.');
  el('setup').classList.add('hidden');
  el('game').classList.remove('hidden');
  drawGame();
}

drawSetup();
