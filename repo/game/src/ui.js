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


/* ------------------------------------------------------------- services */
/* The governorate filter is the whole point of this screen: the national
   average hides that somebody is living without a sewer. Picking a province
   swaps every number below from the average to that province's reality. */
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

function servView() {
  var h = '<div class="gfilter">'
    + '<button class="gf ' + (govFilter === 'all' ? 'on' : '') + '" data-gf="all">الدولة كلها</button>';
  for (var i = 0; i < GOV_IDS.length; i++) {
    var g = GOV_IDS[i];
    h += '<button class="gf ' + (govFilter === g ? 'on' : '') + '" data-gf="' + g + '">'
      + BALANCE.governorates[g].name
      + '<b style="color:' + svcColor(S.govAppr[g]) + '">' + ar(S.govAppr[g]) + '</b></button>';
  }
  h += '</div>';

  for (var j = 0; j < SERVICE_IDS.length; j++) {
    var id = SERVICE_IDS[j], sd = BALANCE.services[id], n = svcNumbers(id);
    var monthly = S.ask[id] * S.pct[id] / 100 * S.priceIndex;
    h += '<div class="svc">'
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
      + '<button class="build" data-build="' + id + '">🏗️ ابني</button>'
      + '<input type="range" min="0" max="160" step="2" value="' + Math.round(S.pct[id])
      + '" data-pct="' + id + '">'
      + '<span class="pctv" id="pctv-' + id + '">' + ar(S.pct[id]) + '٪</span>'
      + '</div></div>';
  }

  if (S.projects.length) {
    h += '<div class="queue"><h4>تحت الإنشاء</h4>';
    for (var k = 0; k < S.projects.length; k++) {
      var pr = S.projects[k];
      h += '<div class="qi"><span>' + BALANCE.services[pr.svc].name + ' — '
        + BALANCE.governorates[pr.gov].name
        + '<span class="qsub">لما يفتح: +' + ar(BALANCE.services[pr.svc].adds_monthly)
        + 'م على المصروف الشهري للأبد</span></span>'
        + '<span>' + ar(pr.left) + ' شهور</span></div>';
    }
    h += '</div>';
  }

  var need = Math.ceil(100 / (S.competence / 100));
  h += '<div class="note2">⚠️ تمويل ١٠٠٪ مش معناه تشغيل ١٠٠٪. كفاءة وزرائك '
    + ar(S.competence) + '، يعني عشان توصل تشغيل كامل لازم تموّل <b>' + ar(need)
    + '٪</b> — أو تجيب وزرا أكفأ.</div>';
  return h;
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
function openBuild(id) {
  var sd = BALANCE.services[id], cost = projectCost(S, id);
  var h = '<div class="sheet"><div class="sh"><span class="ic2">' + SVC_ICON[id] + '</span>'
    + '<span class="nm3">ابني ' + sd.name + '</span>'
    + '<button class="x" data-close="1">✕</button></div>'
    + '<p class="lede2">اختار المحافظة. المنشأة الواحدة بتخدم '
    + arPeople(sd.serves_millions) + '.</p>'
    + '<div class="calc2">'
    + '<div class="cr2"><span>تكلفة الإنشاء</span><b>' + ar(cost) + 'م</b></div>'
    + '<div class="cr2"><span>مدة الإنشاء</span><b>' + ar(sd.build_months) + ' شهور</b></div>'
    + '<div class="cr2"><span>وبعد ما يفتح</span><b>+' + ar(sd.adds_monthly) + 'م كل شهر للأبد</b></div>'
    + '<div class="cr2"><span>الخزينة دلوقتي</span><b style="color:'
    + (S.treasury >= cost ? 'var(--good)' : 'var(--bad)') + '">' + ar(S.treasury) + 'م</b></div>'
    + '</div>';

  for (var i = 0; i < GOV_IDS.length; i++) {
    var g = GOV_IDS[i], cov = coverage(S, g, id);
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
function onAndroidBack() {
  var ovl = el('ovl');
  if (ovl && !ovl.classList.contains('hidden')) { closeSheet(); return true; }
  if (S && running) { setRunning(false); return true; }   // pause before leaving
  return false;
}

function closeSheet() { el('ovl').classList.add('hidden'); el('ovl').innerHTML = ''; }

function toast(msg) {
  var t = el('toast');
  t.innerHTML = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { t.classList.remove('on'); }, 3200);
}

/* ------------------------------------------------------------------- game */
var TABS = [['pres', '🏛️', 'الرئاسة'], ['treas', '💰', 'الخزينة'], ['serv', '🏗️', 'الخدمات'],
            ['govt', '👔', 'الحكومة'], ['pol', '⚖️', 'السياسة']];

/* One line under each tab's title. Not decoration — it tells the player what
   this screen is FOR before they have read a single number on it. */
var SVC_ICON = { water: '💧', power: '⚡', sewage: '🚰', health: '🏥',
                 edu: '🎓', police: '👮', fire: '🚒' };

var BAND_SUB = {
  pres: 'مكتبك · وقراراتك',
  treas: 'الدخل والمصروف · وجيبك',
  serv: 'اللي بتبنيه واللي بتشغّله',
  govt: 'اللي بيصرفوا فلوسك',
  pol: 'اللي عايزين كرسيك'
};

/* Each tab names the plan item that fills it. Blind building means Karim must
   be able to see what is done and what is not without asking. */
var SOON = {
  pres: ['🏛️', 'الرئاسة', 'المواقف اللي بتيجي لك، ومكتب الرئاسة والأفعال اللي بتبدأها إنت.', 'البند ١٢'],
  treas: ['💰', 'الخزينة', 'الدخل والمصروف والضرايب وأسعار الخدمات ودعم الغذاء.', 'البند ٨'],
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
  var name = '';
  for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === tab) name = TABS[i][2];
  var sub = BAND_SUB[tab];
  if (tab === 'serv' && govFilter !== 'all') sub = BALANCE.governorates[govFilter].name + ' — بس';
  var h = '<div class="band">' + ART[tab]
    + '<div class="ttl">' + name + '</div><div class="sub">' + sub + '</div></div><div class="pad">';
  if (tab === 'pres') {
    var g = govOf(S), s = socOf(S);
    h += '<div class="card"><h3>' + esc(S.country) + '</h3>'
      + '<div class="krow"><span>نظام الحكم</span><b>' + g.ic + ' ' + g.nm + '</b></div>'
      + '<div class="krow"><span>طبيعة المجتمع</span><b>' + s.ic + ' ' + s.nm + '</b></div>'
      + '<div class="krow"><span>شهور في الحكم</span><b>' + ar(S.totalMonths) + '</b></div>'
      + '<div class="krow"><span>الخزينة</span><b>' + ar(S.treasury) + 'م</b></div>'
      + '<div class="krow"><span>مؤشر الأسعار</span><b>×' + arDec(S.priceIndex, 2) + '</b></div></div>';
    // The month's books, shown here until the treasury tab exists. Rule of the
    // design doc: no number without a visible reason behind it.
    if (S.lastMonth) {
      var L = S.lastMonth;
      h += '<div class="card"><h3>آخر شهر</h3>'
        + '<div class="krow"><span>الدخل</span><b style="color:var(--good)">+' + ar(L.income) + 'م</b></div>'
        + '<div class="krow"><span>المصروف</span><b style="color:var(--bad)">−' + ar(L.expense) + 'م</b></div>'
        + '<div class="krow"><span class="sub">منه تشغيل الوزارات ' + ar(L.run) + 'م · دعم ' + ar(L.subsidy)
        + 'م · استيراد غذاء ' + ar(L.importCost) + 'م</span></div>'
        + '<div class="krow" style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px">'
        + '<span>الصافي</span><b style="color:' + (L.net >= 0 ? 'var(--good)' : 'var(--bad)') + '">'
        + (L.net >= 0 ? '+' : '−') + ar(Math.abs(L.net)) + 'م</b></div>'
        + '<div class="krow"><span>سعر الغذاء</span><b style="color:'
        + (S.foodPrice > 62 ? 'var(--bad)' : 'var(--ink)') + '">' + ar(S.foodPrice) + '</b></div>'
        + '</div>';
    }
    if (S.log.length) {
      h += '<div class="card"><h3>آخر الأخبار</h3>'
        + S.log.slice(-6).reverse().map(function (l) { return '<div class="log">' + l + '</div>'; }).join('')
        + '</div>';
    }
  }
  if (tab === 'serv') {
    el('view').innerHTML = h + servView() + '</div>';
    var sel = document.querySelector('.gf.on');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
    return;
  }
  var k = SOON[tab];
  h += '<div class="soon"><span class="ic">' + k[0] + '</span><h3>' + k[1] + '</h3>'
    + '<p>' + k[2] + '</p><span class="item">لسه بيتبني — ' + k[3] + '</span></div>';
  el('view').innerHTML = h + '</div>';
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
  if (e.type === 'built') {
    return '🏗️ افتتح ' + BALANCE.services[e.svc].name + ' جديد في '
      + BALANCE.governorates[e.gov].name + ' — والمصروف الشهري زاد '
      + arDec(BALANCE.services[e.svc].adds_monthly, 1) + 'م للأبد.';
  }
  if (e.type === 'deficit') {
    return '⚠️ الخزينة دخلت عجز. المرتبات مش مدفوعة، والخدمات بتنهار بسرعة مضاعفة.';
  }
  if (e.type === 'boiling') {
    return '🔥 الغليان وصل ' + ar(e.pct) + '٪ — الشارع مش مطمئن.';
  }
  if (e.type === 'end') {
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
    if (line) S.log.push(line);
    // A finished project, a deficit or the end are things the player must not
    // scroll past — put them in front of whichever screen they are on.
    if (e.type === 'built' || e.type === 'deficit' || e.type === 'end' || e.type === 'boiling') {
      toast(line);
    }
  });
  // Anything the player must see stops the clock. Later this is where a crisis,
  // a scandal or a finished project will pause the game for a decision.
  if (events.length) setRunning(false);
  drawGame();
}

/* ----------------------------------------------------------------- events */
var CLICKABLE = ['data-pick', 'data-nav', 'data-roll', 'data-tab', 'data-clock',
                 'data-gf', 'data-build', 'data-close', 'data-buildgov'];

document.addEventListener('click', function (ev) {
  // Every clickable attribute must be listed here or its button does nothing.
  // Forgetting one is silent — the button simply never responds.
  var t = ev.target.closest('[' + CLICKABLE.join('],[') + ']');
  if (!t) return;
  if (t.dataset.pick) {
    var list = t.dataset.pick === 'gov' ? SETUP.government_types : SETUP.society_types;
    setupState[t.dataset.pick] = list[+t.dataset.i];
    el('artdefs').innerHTML = ART_DEFS;
drawSetup();
  } else if (t.dataset.roll) {
    var names = t.dataset.roll === 'country' ? SETUP.suggested_country_names : SETUP.suggested_ruler_names;
    setupState[t.dataset.roll] = names[Math.floor(Math.random() * names.length)];
    el('artdefs').innerHTML = ART_DEFS;
drawSetup();
  } else if (t.dataset.nav) {
    captureNames();
    if (t.dataset.nav === 'back') { setupState.step--; drawSetup(); }
    else if (setupState.step < 3) { setupState.step++; drawSetup(); }
    else startGame();
  } else if (t.dataset.tab) {
    tab = t.dataset.tab; drawNav(); drawView();
  } else if (t.dataset.gf) {
    govFilter = t.dataset.gf; drawView();
  } else if (t.dataset.build) {
    openBuild(t.dataset.build);
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
    setRunning(!running);
  } else if (t.dataset.clock) {
    speed = +t.dataset.clock; schedule(); drawClock();
  }
});

/* Range inputs fire "input" on every pixel of a drag, so this must stay cheap
   and must not touch the DOM the slider itself lives in. */
document.addEventListener('input', function (ev) {
  var id = ev.target && ev.target.dataset && ev.target.dataset.pct;
  if (!id || !S) return;
  S.pct[id] = +ev.target.value;
  refreshService(id);
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

el('artdefs').innerHTML = ART_DEFS;
drawSetup();
