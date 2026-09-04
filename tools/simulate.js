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

function fresh(govId, socId) {
  const gov = SETUP.government_types.find(g => g.id === (govId || 'republic'));
  const soc = SETUP.society_types.find(s => s.id === (socId || 'conservative'));
  // A fixed seed: the simulator must measure the same game every run, or a
  // balance number that moved and a die that rolled differently look identical.
  return newGame({ country: 'محاكاة', ruler: 'لاعب', gov: gov, soc: soc, seed: 20260101 });
}

/* Does nothing at all. Standing still must not be a strategy. */
function passive() {}

/* Fixes the worst service in the angriest governorate and keeps the books.
   Roughly what a thoughtful player does without optimising. */
function reasonable(S) {
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
  reasonable(S);                                  // still keeps the lights on
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
  if (offers[best].competence > S.ministers[worst].competence + 5) dismissMinister(S, worst, best);
}

const PLAYERS = { 'سلبي': passive, 'معقول': reasonable, 'حرامي': thief, 'مقلّب': shuffler };

/* ----------------------------------------------------------------- runner */

function play(player, months, govId, socId) {
  const S = fresh(govId, socId);
  for (let i = 0; i < months && !S.dead; i++) { player(S); tickMonth(S); }
  return S;
}

function median(a) { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; }

function lifespans(player, runs, months, govId, socId) {
  const lives = [];
  for (let i = 0; i < runs; i++) {
    const S = play(player, months, govId, socId);
    lives.push(S.dead ? S.totalMonths : months);
  }
  return lives;
}

// Long enough that the STRONGEST strategy still dies inside it, and no longer:
// at 300 the cabinet-managing player hit the ceiling and looked immortal, which
// hid that he was outliving everyone; at 900 the checker took minutes. He dies
// around 304, so this leaves room without paying for it on every push.
const MONTHS = 420;
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

for (const [name, fn] of Object.entries(PLAYERS)) {
  const lives = lifespans(fn, 1, MONTHS);
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
    report.combos[g.nm + ' + ' + c.nm] = median(lifespans(reasonable, 1, MONTHS, g.id, c.id));
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
  console.log('\n=== التركيبات ===');
  const combos = Object.entries(r.combos).sort((a, b) => b[1] - a[1]);
  for (const [name, life] of combos) console.log(`  ${String(life).padStart(3)} شهر — ${name}`);
}
