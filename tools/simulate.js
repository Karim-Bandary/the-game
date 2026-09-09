#!/usr/bin/env node
/*
 * The balance simulator — and the important part is that it runs THE GAME.
 *
 * It loads the built bundle, pulls out the engine, and plays it with scripted
 * players. There is no second copy of the rules here, so a number this prints
 * is a number the player will actually meet. Before this existed the simulator
 * had its own Python implementation of the month loop, which meant we were
 * balancing a game nobody was playing.
 *
 *   node tools/simulate.js            report for the three scripted players
 *   node tools/simulate.js --json     the same, as JSON, for the documents
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'game', 'index.html'), 'utf8');

/* Take only the engine script. The UI script needs a DOM and has no business
   being loaded to run a simulation. */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const engineSrc = scripts.find(s => s.includes('function tickMonth'));
if (!engineSrc) {
  console.error('مش لاقي المحرك في الملف الملزوق — شغّل tools/build_game.py الأول');
  process.exit(1);
}
eval(engineSrc);

/* --------------------------------------------------------------- players */

/* The seed is fixed by default so a balance number that moved and a die that
   rolled differently never look the same. But ONE run is not a measurement once
   situations are in the game: which cards happen to fire swings a lifetime by
   tens of months, and tuning against a single seed is tuning against noise —
   which is exactly what happened before this was written. Anything comparing
   playstyles or starting combinations runs several seeds and takes the median. */
const BASE_SEED = 20260101;
function fresh(govId, socId, seed) {
  const gov = SETUP.government_types.find(g => g.id === (govId || 'republic'));
  const soc = SETUP.society_types.find(s => s.id === (socId || 'conservative'));
  return newGame({ country: 'محاكاة', ruler: 'لاعب', gov: gov, soc: soc,
                   seed: seed === undefined ? BASE_SEED : seed });
}

/* A situation stops the clock until it is answered, so every scripted player
   must answer one — otherwise the month never turns, nobody ever dies, and the
   simulator reports that every strategy is immortal. (It did exactly that the
   first time, which is how this got written.)
     'act'    — deal with it, but do not bankrupt yourself doing it
     'ignore' — take the last one, which by convention is the free one

   'act' will not spend more than a quarter of the treasury on a single card.
   Without that limit the bot took the first affordable option every time and
   emptied a poor country paying for water trucks — which made the hardest
   starting combination look like an unwinnable trap when the real problem was
   that the bot was not behaving like the thoughtful player it stands for. */
function handleSituation(S, style) {
  if (!S.pendingSituation) return false;
  const sit = SITUATIONS.situations.find(x => x.id === S.pendingSituation);
  const order = style === 'ignore'
    ? [...sit.choices.keys()].reverse()
    : [...sit.choices.keys()];
  if (style === 'act') {
    for (const i of order) {
      if (choiceRefusal(S, sit, i) !== null) continue;
      const spend = (sit.choices[i].cost || {}).treasury || 0;
      if (spend > S.treasury * 0.25) continue;
      // A thoughtful player does not print money into an inflation he is already
      // losing to. Without this the bot printed every time the treasury dipped
      // and dug the hole deeper each round — which read as the situations being
      // brutal when it was the bot being reckless.
      if ((sit.choices[i].effects || {}).printCap
        && S.inflation > BALANCE.inflation.pain_starts_above) continue;
      answerSituation(S, i); return true;
    }
  }
  for (const i of order) {
    if (choiceRefusal(S, sit, i) === null) { answerSituation(S, i); return true; }
  }
  // Nothing affordable: the last option is always free by design, but if that
  // ever stops being true the game would deadlock — so say so loudly.
  throw new Error('موقف «' + sit.id + '» مفيش فيه اختيار ينفع يتاخد — اللعبة هتقف');
}

/* Does nothing at all. Standing still must not be a strategy. */
function passive(S) { handleSituation(S, 'ignore'); }

/* Fixes the worst service in the angriest governorate and keeps the books.
   Roughly what a thoughtful player does without optimising. */
function reasonable(S) {
  if (handleSituation(S, 'act')) return;
  if (S.treasury < 1200 && S.tax < 30) S.tax += 0.5;
  else if (S.treasury > 4000 && S.tax > 18) S.tax -= 0.4;

  const worstG = worstGovernorate(S);
  let worstS = SERVICE_IDS[0];
  for (const s of SERVICE_IDS) if (S.level[worstG][s] < S.level[worstG][worstS]) worstS = s;
  if (S.projects.length < 4 && S.treasury > projectCost(S, worstS) + 600) {
    startProject(S, worstG, worstS);
  }
  if (S.treasury > 2200) {
    let lo = SERVICE_IDS[0];
    for (const s of SERVICE_IDS) if (nationalLevel(S, s) < nationalLevel(S, lo)) lo = s;
    S.pct[lo] = Math.min(150, S.pct[lo] + 1.5);
  }
  if (S.foodPrice > 60 && S.treasury > 1000) S.subsidy = Math.min(220, S.subsidy + 12);
}

/* Steals steadily and prints money to cover the hole. Should end up rich and
   short-lived — a real trade, not a punishment. */
function thief(S) {
  if (handleSituation(S, 'ignore')) return;
  // Steals through the ENGINE's rule, not its own arithmetic. When the simulator
  // has its own copy of a rule it eventually measures a game nobody is playing —
  // and the leak risk, which is the whole cost of stealing, would be invisible.
  if (S.treasury > 600) stealFromTreasury(S, Math.floor(Math.min(140, stealMax(S))));
  // Prints whatever this governor will sign for, whenever he is allowed to.
  if (S.treasury < 500) printMoney(S, printCap(S));
}

/* Plays the cabinet instead of the country: sacks the weakest minister whenever
   he is allowed to, takes the best of the three on offer, and reshuffles the
   moment the cooldown lifts. This exists to answer one question — is managing
   people on its own a winning strategy? If this player outlives the one who
   actually runs the services, the ministers are overpowered. */
function shuffler(S) {
  if (handleSituation(S, 'act')) return;
  reasonable(S);                                  // still keeps the lights on

  /* Before anything else: the army. This bot exists to answer one question —
     is managing the cabinet overpowered? — and it can only answer it while it
     plays the cabinet the way a person would. Chasing competence blindly used
     to be free; now it installs a defence minister nobody bought and the game
     ends in a coup, which stops the bot measuring the thing it is for. A human
     watching a coup warning would fix the defence chair first, so it does. */
  if (army(S) < armyLine(S) && dismissRefusal(S, 'defence') === null) {
    const men = candidatesFor(S, 'defence');
    let loyal = 0;
    for (let i = 1; i < men.length; i++) if (men[i].loyalty > men[loyal].loyalty) loyal = i;
    if (men[loyal].loyalty > army(S)) { dismissMinister(S, 'defence', loyal); return; }
  }

  if (reshuffleRefusal(S) === null && avgCompetence(S) < 70) { reshuffleCabinet(S); return; }
  let worst = null;
  for (const id of POST_IDS) {
    if (dismissRefusal(S, id) !== null) continue;
    if (!worst || S.ministers[id].competence < S.ministers[worst].competence) worst = id;
  }
  if (!worst) return;
  const offers = candidatesFor(S, worst);
  let best = 0;
  for (let i = 1; i < offers.length; i++) if (offers[i].competence > offers[best].competence) best = i;
  // Never trade the defence chair for competence alone: that is the one seat
  // where a better man who likes you less is a worse man.
  if (worst === 'defence' && offers[best].loyalty < armyLine(S)) return;
  if (offers[best].competence > S.ministers[worst].competence + 5) dismissMinister(S, worst, best);
}

/* Answers one question and only one: is repression a winning strategy? He runs
   the country exactly like the reasonable player and adds the riot police
   whenever the button is available. If he outlives the man who fixes the
   services, the button is too strong and the game rewards beating people up;
   if he does not outlive the passive player, it is decoration. Both edges are
   asserted in check.py. */
function baton(S) {
  if (crackdownRefusal(S) === null) { crackdown(S); return; }
  reasonable(S);
}

const PLAYERS = { 'سلبي': passive, 'معقول': reasonable, 'حرامي': thief,
                  'مقلّب': shuffler, 'قامع': baton };

/* ----------------------------------------------------------------- runner */

function play(player, months, govId, socId, seed) {
  const S = fresh(govId, socId, seed);
  for (let i = 0; i < months && !S.dead; i++) { player(S); tickMonth(S); }
  return S;
}

function median(a) { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; }

function lifespans(player, runs, months, govId, socId) {
  const lives = [];
  for (let i = 0; i < runs; i++) {
    const S = play(player, months, govId, socId, BASE_SEED + i * 7919);
    lives.push(S.dead ? S.totalMonths : months);
  }
  return lives;
}

// Long enough that the STRONGEST strategy still dies inside it, and no longer:
// at 300 the cabinet-managing player hit the ceiling and looked immortal, which
// hid that he was outliving everyone; at 900 the checker took minutes. He dies
// around 304, so this leaves room without paying for it on every push.
const MONTHS = 420;
// Enough seeds that one unlucky run of cards cannot move a verdict.
const RUNS = 5;
const startState = fresh();
const report = {
  start: {
    approval: Math.round(startState.approval),
    stability: Math.round(startState.stability),
    avgService: Math.round(avgService(startState)),
    treasury: Math.round(startState.treasury),
    byGov: {}, byService: {}
  },
  players: {},
  combos: {}
};
for (const g of GOV_IDS) report.start.byGov[BALANCE.governorates[g].name] = Math.round(startState.govAppr[g]);
for (const s of SERVICE_IDS) report.start.byService[BALANCE.services[s].name] = Math.round(nationalLevel(startState, s));

/* The full month-0 picture, so the design mockups can show the same world the
   game starts in instead of numbers someone typed by hand. */
report.detail = { services: {}, governorates: {} };
for (const s of SERVICE_IDS) {
  report.detail.services[s] = {
    pct: Math.round(startState.pct[s]),
    operating: Math.round(operating(startState, s)),
    national: Math.round(nationalLevel(startState, s)),
    ask: Math.round(startState.ask[s]),
    byGov: {}
  };
  for (const g of GOV_IDS) {
    report.detail.services[s].byGov[g] = {
      coverage: Math.round(coverage(startState, g, s)),
      level: Math.round(startState.level[g][s]),
      facilities: startState.fac[g][s]
    };
  }
}
for (const g of GOV_IDS) {
  report.detail.governorates[g] = {
    name: BALANCE.governorates[g].name,
    population: +startState.pop[g].toFixed(2),
    approval: Math.round(startState.govAppr[g])
  };
}
report.detail.competence = startState.competence;          // the cabinet baseline
report.detail.ministers = {};
for (const p of MINISTERS.posts) {
  report.detail.ministers[p.id] = {
    name: p.name,
    competence: startState.ministers[p.id].competence,
    loyalty: startState.ministers[p.id].loyalty,
    services: p.services.map(s => BALANCE.services[s].name)
  };
}

/* The first month's books, so the balance document can quote the real figures
   instead of numbers someone typed in by hand. */
const firstMonth = fresh();
tickMonth(firstMonth);
report.firstMonth = {
  income: Math.round(firstMonth.lastMonth.income),
  expense: Math.round(firstMonth.lastMonth.expense),
  net: Math.round(firstMonth.lastMonth.net),
  run: Math.round(firstMonth.lastMonth.run),
  importCost: Math.round(firstMonth.lastMonth.importCost),
  foodGap: +firstMonth.lastMonth.foodGap.toFixed(2)
};

/* How often each style of player gets his game stopped. The player asked for
   every situation to interrupt, so this is the number that decides whether the
   feature is drama or nagging. */
report.interruptions = {};
for (const [name, fn] of Object.entries(PLAYERS)) {
  const S = fresh();
  let months = 0, hits = 0;
  for (let i = 0; i < MONTHS && !S.dead; i++) {
    fn(S);
    tickMonth(S);
    // Counted AFTER the tick that raises it and before the player answers it —
    // counting first reads zero every time, because the player just cleared it.
    if (S.pendingSituation) hits++;
    months++;
  }
  report.interruptions[name] = { months: months, situations: hits,
    everyMonths: hits ? +(months / hits).toFixed(1) : 0 };
}

/* Suspicion, per style. This is the number the balance of the whole heat system
   lives or dies on: an honest player who ends up as suspected as a thief means
   the meter is measuring failure instead of corruption, and a thief who never
   gets near the line means stealing is free. */
report.heat = {};
for (const [name, fn] of Object.entries(PLAYERS)) {
  const S = fresh();
  let peak = 0, months = 0;
  for (let i = 0; i < MONTHS && !S.dead; i++) {
    fn(S);
    tickMonth(S);
    if (S.heat > peak) peak = S.heat;
    months++;
  }
  // Counted from the history rather than while the loop runs: the player
  // functions answer their own cards, so a counter that watched pendingSituation
  // from out here read zero every time — and reported "no scandals ever" for a
  // game that was firing seven of them.
  const scandals = S.sitHistory.filter(x => x.kind === 'scandal').length;
  report.heat[name] = { peak: Math.round(peak), end: Math.round(S.heat),
    scandals: scandals, stolen: Math.round(S.stolenTotal), months: months };
}

/* Repression, measured where it actually matters. Adding the riot police to a
   president who is already doing well barely comes up — his street never boils
   — so the comparison that answers the question is a FAILING president with and
   without the button. How much time does beating people up buy? Too much and
   the game rewards it as a strategy; none at all and the screen is decoration. */
report.crackdown = {};
{
  function runPassive(useBaton, seed, govId) {
    const S = fresh(govId, undefined, seed);
    let months = 0, used = 0, failed = 0;
    for (let i = 0; i < MONTHS && !S.dead; i++) {
      if (useBaton && crackdownRefusal(S) === null) {
        const out = crackdown(S);
        if (typeof out !== 'string') { used++; if (!out.worked) failed++; }
      }
      passive(S);
      tickMonth(S);
      months++;
    }
    return { months: months, used: used, failed: failed };
  }
  /* Across seeds and taken as a median, like the lifespans. The crackdown is a
     coin flip weighted by one minister, so a single run measures which way two
     coins happened to land — and tuning against that produced a "repression
     costs you time" reading that reversed on the next seed. */
  const plain = [], withBaton = [], uses = [], fails = [];
  for (let i = 0; i < RUNS; i++) {
    const seed = BASE_SEED + i * 7919;
    plain.push(runPassive(false, seed).months);
    const b = runPassive(true, seed);
    withBaton.push(b.months); uses.push(b.used); fails.push(b.failed);
  }
  report.crackdown.failingPlain = median(plain);
  report.crackdown.failingWithBaton = median(withBaton);
  report.crackdown.used = median(uses);
  report.crackdown.failed = median(fails);

  /* The same measurement under a dictatorship, because that is where the whole
     fantasy lives: the setup screen sells "repression works better for you", and
     the gap between these two lines is the only honest way to know whether it
     does. If a dictator gains no more from the riot police than a republic, the
     sentence on that screen is decoration. */
  const dPlain = [], dBaton = [];
  for (let i = 0; i < RUNS; i++) {
    const seed = BASE_SEED + i * 7919;
    dPlain.push(runPassive(false, seed, 'dictator').months);
    dBaton.push(runPassive(true, seed, 'dictator').months);
  }
  report.crackdown.dictatorPlain = median(dPlain);
  report.crackdown.dictatorWithBaton = median(dBaton);
}

/* The army, per style — and one deliberate neglect run. No bot dies of a coup
   any more (they all watch the defence chair), which means the ending itself
   would never be exercised by this file. So it is measured directly: a
   president who lets the army go, and how long he has. That number is the
   whole balance of the feature — too short and one bad appointment ends the
   game, too long and the meter is decoration. */
report.army = {};
for (const [name, fn] of Object.entries(PLAYERS)) {
  const S = fresh();
  let peak = 0;
  for (let i = 0; i < MONTHS && !S.dead; i++) {
    fn(S);
    tickMonth(S);
    if (S.coupRisk > peak) peak = S.coupRisk;
  }
  report.army[name] = { peakRisk: Math.round(peak), loyalty: Math.round(army(S)),
                        died: S.dead || '-' };
}
{
  // Held just under the line, the way a president who keeps appointing the
  // most competent man he can find would leave it.
  const S = fresh();
  let months = 0;
  for (let i = 0; i < MONTHS && !S.dead; i++) {
    reasonable(S);
    if (S.pendingSituation) handleSituation(S, 'act');
    S.ministers.defence.loyalty = Math.min(S.ministers.defence.loyalty,
                                           armyLine(S) - 12);
    tickMonth(S);
    months++;
  }
  report.army.neglect = { months: months, died: S.dead || '-',
                          risk: Math.round(S.coupRisk) };
}

for (const [name, fn] of Object.entries(PLAYERS)) {
  const lives = lifespans(fn, RUNS, MONTHS);
  const five = play(fn, 60);
  const ten = play(fn, 120);
  report.players[name] = {
    lifespan: median(lives),
    at5: { treasury: Math.round(five.treasury), approval: Math.round(five.approval),
           service: Math.round(avgService(five)), inflation: Math.round(five.inflation),
           personal: Math.round(five.personal) },
    at10: { treasury: Math.round(ten.treasury), approval: Math.round(ten.approval),
            service: Math.round(avgService(ten)), inflation: Math.round(ten.inflation),
            personal: Math.round(ten.personal), dead: ten.dead }
  };
}

/* Twelve combinations, one competent player. If one of them is far ahead of the
   rest, the setup choice is decoration and we should know before shipping it. */
for (const g of SETUP.government_types) {
  for (const c of SETUP.society_types) {
    report.combos[g.nm + ' + ' + c.nm] = median(lifespans(reasonable, RUNS, MONTHS, g.id, c.id));
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const r = report;
  console.log('=== حالة البداية ===');
  console.log(`  الرضا ${r.start.approval} · الثبات ${r.start.stability} · متوسط الخدمات ${r.start.avgService}`);
  console.log('  المحافظات: ' + Object.entries(r.start.byGov).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('  الخدمات:  ' + Object.entries(r.start.byService).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log(`\n=== أول شهر ===`);
  console.log(`  دخل ${r.firstMonth.income}م · مصروف ${r.firstMonth.expense}م · الصافي ${r.firstMonth.net}م`
    + `  (تشغيل ${r.firstMonth.run}م · استيراد غذاء ${r.firstMonth.importCost}م)`);
  console.log('\n=== أنماط اللعب ===');
  for (const [name, p] of Object.entries(r.players)) {
    console.log(`  ${name.padEnd(7)} عاش ${String(p.lifespan).padStart(3)} شهر (${(p.lifespan / 12).toFixed(1)} سنة)`
      + ` · بعد ٥ سنين: خزينة ${String(p.at5.treasury).padStart(6)}م رضا ${String(p.at5.approval).padStart(3)}`
      + ` خدمات ${String(p.at5.service).padStart(3)} جيبك ${String(p.at5.personal).padStart(5)}م`);
  }
  console.log('\n=== الشبهة ===');
  for (const [name, x] of Object.entries(r.heat)) {
    console.log(`  ${name.padEnd(7)} أعلى شبهة ${String(x.peak).padStart(3)}`
      + ` · آخر شبهة ${String(x.end).padStart(3)} · فضايح ${String(x.scandals).padStart(2)}`
      + ` · سرق ${String(x.stolen).padStart(6)}م في ${String(x.months).padStart(3)} شهر`);
  }
  console.log('\n=== الجيش ===');
  for (const [name, x] of Object.entries(r.army)) {
    if (name === 'neglect') continue;
    console.log(`  ${name.padEnd(7)} أعلى خطر انقلاب ${String(x.peakRisk).padStart(3)}٪`
      + ` · ولاء وزير الدفاع في الآخر ${String(x.loyalty).padStart(3)} · مات بـ ${x.died}`);
  }
  console.log(`  ${'مهمل'.padEnd(7)} سايب الجيش تحت الخط: عاش `
    + `${r.army.neglect.months} شهر ومات بـ ${r.army.neglect.died}`);
  console.log('\n=== القمع ===');
  {
    const k = r.crackdown;
    console.log(`  رئيس فاشل من غير قمع عاش ${k.failingPlain} شهر · وبالقمع ${k.failingWithBaton} شهر`
      + ` — يعني القمع اشترى ${k.failingWithBaton - k.failingPlain} شهر`);
    console.log(`  نزّل الأمن ${k.used} مرة، فشل منهم ${k.failed}`);
    console.log(`  وتحت الديكتاتورية: من غير قمع ${k.dictatorPlain} شهر · وبالقمع `
      + `${k.dictatorWithBaton} شهر — اشترى ${k.dictatorWithBaton - k.dictatorPlain} شهر`);
  }
  console.log('\n=== المقاطعات ===');
  for (const [name, x] of Object.entries(r.interruptions)) {
    console.log(`  ${name.padEnd(7)} ${String(x.situations).padStart(3)} مقاطعة في `
      + `${String(x.months).padStart(3)} شهر — واحدة كل ${x.everyMonths} شهر`);
  }
  console.log('\n=== التركيبات ===');
  const combos = Object.entries(r.combos).sort((a, b) => b[1] - a[1]);
  for (const [name, life] of combos) console.log(`  ${String(life).padStart(3)} شهر — ${name}`);
}
