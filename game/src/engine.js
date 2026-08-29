/* ============================================================================
   The engine. No DOM here — only state and rules.

   This file is the ONLY place the rules of the game exist. The screens read it,
   and the balance simulator (tools/simulate.js) runs this exact code with
   scripted players. That is deliberate: when a simulator has its own copy of
   the rules, it eventually tests a game nobody is playing.

   No number is written here. Everything comes from data/balance.json, baked in
   at build time as BALANCE.
   ========================================================================== */

var BALANCE = __BALANCE__;
var SETUP   = __SETUP__;

/* Seconds of real time per in-game month. Slow is deliberately slow: the player
   should be able to read a screen before the month turns. */
var SPEEDS = [6.0, 3.0, 1.5];

var SERVICE_IDS = Object.keys(BALANCE.services);
var GOV_IDS = Object.keys(BALANCE.governorates);

function clamp(v, lo, hi) {
  lo = (lo === undefined) ? 0 : lo;
  hi = (hi === undefined) ? 100 : hi;
  return Math.max(lo, Math.min(hi, v));
}

/* ---------------------------------------------------------------- new game */

function newGame(choice) {
  var b = BALANCE.start, i, g, s;
  var S = {
    version: 2,
    country: choice.country,
    ruler: choice.ruler,
    govId: choice.gov.id,
    socId: choice.soc.id,

    month: 1, year: 1, totalMonths: 0,

    treasury: b.treasury,
    personal: 0,
    inflation: b.inflation,
    priceIndex: 1.0,

    tax: b.tax_rate,
    utilPrice: b.utility_price,
    subsidy: b.food_subsidy,

    approval: SETUP.base_start.approval,
    stability: SETUP.base_start.stability,
    boil: 0,
    ap: SETUP.base_start.ap,
    apMax: SETUP.base_start.ap,

    competence: SETUP.base_start.competence,   // the cabinet average, for now
    loyalty: SETUP.base_start.loyalty,
    finComp: b.minister_competence,

    pct: {},        // funding percentage per ministry — what the player sets
    ask: {},        // what each ministry asks for this month, in millions
    pop: {},        // population per governorate
    fac: {},        // facilities per governorate per service
    level: {},      // service level 0..100 per governorate per service
    govAppr: {},    // approval per governorate

    projects: [],
    foodPrice: BALANCE.food.price_base,
    lastMonth: null,   // the numbers behind the last tick, for the screens
    log: [],
    dead: null
  };

  for (i = 0; i < SERVICE_IDS.length; i++) {
    s = SERVICE_IDS[i];
    S.pct[s] = b.budget_pct;
    S.ask[s] = BALANCE.services[s].monthly_ask;
  }
  for (i = 0; i < GOV_IDS.length; i++) {
    g = GOV_IDS[i];
    S.pop[g] = BALANCE.governorates[g].population;
    S.fac[g] = {};
    S.level[g] = {};
    for (var j = 0; j < SERVICE_IDS.length; j++) {
      s = SERVICE_IDS[j];
      S.fac[g][s] = BALANCE.governorates[g].facilities[s];
      S.level[g][s] = 0;
    }
    S.govAppr[g] = SETUP.base_start.approval;
  }

  // Government and society are modifiers, never separate content. This is the
  // only place they touch the state.
  S.mods = {};
  [choice.gov, choice.soc].forEach(function (opt) {
    for (var k in opt.mods) {
      if (S[k] === undefined) continue;
      S[k] += opt.mods[k];
      S.mods[k] = (S.mods[k] || 0) + opt.mods[k];
    }
  });
  S.apMax = S.ap;
  S.approval = clamp(S.approval);
  S.stability = clamp(S.stability);
  for (i = 0; i < GOV_IDS.length; i++) S.govAppr[GOV_IDS[i]] = S.approval;

  // Let the services and the mood reach their resting values before the player
  // sees them, so nothing swings wildly on the very first month.
  for (i = 0; i < BALANCE.mood.settle_months; i++) {
    updateServices(S, false);
    updateMood(S);
  }
  return S;
}

/* ----------------------------------------------------------------- reading */

function totalPop(S) {
  var t = 0;
  for (var i = 0; i < GOV_IDS.length; i++) t += S.pop[GOV_IDS[i]];
  return t;
}

/* Funding is a percentage of the ministry's ask, multiplied by how much of each
   pound the minister actually delivers. 100% funding is never 100% operating. */
function operating(S, s) {
  return clamp(S.pct[s] * S.competence / 100);
}

function coverage(S, g, s) {
  return Math.min(1, S.fac[g][s] * BALANCE.services[s].serves_millions / S.pop[g]) * 100;
}

function nationalLevel(S, s) {
  var t = 0, p = totalPop(S);
  for (var i = 0; i < GOV_IDS.length; i++) t += S.level[GOV_IDS[i]][s] * S.pop[GOV_IDS[i]];
  return t / p;
}

function avgService(S) {
  var t = 0;
  for (var i = 0; i < SERVICE_IDS.length; i++) {
    t += nationalLevel(S, SERVICE_IDS[i]) * BALANCE.services[SERVICE_IDS[i]].approval_weight;
  }
  return t;
}

function govService(S, g) {
  var t = 0;
  for (var i = 0; i < SERVICE_IDS.length; i++) {
    t += S.level[g][SERVICE_IDS[i]] * BALANCE.services[SERVICE_IDS[i]].approval_weight;
  }
  return t;
}

/* The monthly bill for running what already exists. */
function runningCost(S) {
  var t = 0;
  for (var i = 0; i < SERVICE_IDS.length; i++) t += S.ask[SERVICE_IDS[i]] * S.pct[SERVICE_IDS[i]] / 100;
  return t * S.priceIndex;
}

function worstGovernorate(S) {
  var worst = GOV_IDS[0];
  for (var i = 1; i < GOV_IDS.length; i++) if (S.govAppr[GOV_IDS[i]] < S.govAppr[worst]) worst = GOV_IDS[i];
  return worst;
}

function danger(S) {
  return {
    approval: S.approval < BALANCE.mood.approval_danger,
    stability: S.stability < BALANCE.mood.stability_danger,
    inflation: S.inflation > BALANCE.inflation.pain_starts_above,
    treasury: S.treasury < 0
  };
}

function govOf(S) {
  for (var i = 0; i < SETUP.government_types.length; i++)
    if (SETUP.government_types[i].id === S.govId) return SETUP.government_types[i];
}
function socOf(S) {
  for (var i = 0; i < SETUP.society_types.length; i++)
    if (SETUP.society_types[i].id === S.socId) return SETUP.society_types[i];
}

/* ------------------------------------------------------------- the pieces */

function updateServices(S, deficit) {
  var d = BALANCE.deficit, m = BALANCE.mood.smoothing;
  for (var i = 0; i < SERVICE_IDS.length; i++) {
    var s = SERVICE_IDS[i];
    var op = operating(S, s) * (deficit ? d.operating_multiplier : 1);
    for (var j = 0; j < GOV_IDS.length; j++) {
      var g = GOV_IDS[j];
      var target = coverage(S, g, s) * op / 100;
      S.level[g][s] += (target - S.level[g][s]) * (m * (deficit ? d.decay_multiplier : 1));
    }
  }
}

/* Three sources of anger, three different speeds — services are slow, food is
   sharp, inflation creeps. Wealth divides the first two because a rich province
   absorbs a price rise; it does not divide inflation, which nobody escapes. */
function updateMood(S) {
  var md = BALANCE.mood, nf = BALANCE.inflation;
  var inflPain = Math.min(55, Math.max(0, S.inflation - nf.pain_starts_above) * nf.pain_coef);
  var taxPain = Math.max(0, S.tax - md.tax_pain_free_below) * md.tax_pain_coef
              + Math.max(0, S.utilPrice - BALANCE.start.utility_price) * md.utility_pain_coef;
  var foodPain = Math.max(0, S.foodPrice - BALANCE.food.price_base) * md.food_pain_coef;
  var total = 0, pop = totalPop(S);
  for (var i = 0; i < GOV_IDS.length; i++) {
    var g = GOV_IDS[i], w = BALANCE.governorates[g].wealth;
    var target = clamp(govService(S, g) - (taxPain + foodPain) / w - inflPain);
    S.govAppr[g] += (target - S.govAppr[g]) * md.smoothing;
    total += S.govAppr[g] * S.pop[g];
  }
  S.approval = total / pop;
}

/* --------------------------------------------------------------- the month */

/* Everything that happens when a month passes, in the order the design document
   fixes. The order matters: inflation first because it prices everything after
   it, events last so they see the state the player is actually in.
   Whatever calls this — a timer, a button, the simulator — is not the engine's
   business, which is what lets the time model change without touching a rule. */
function tickMonth(S) {
  var events = [];
  if (S.dead) return events;

  var nf = BALANCE.inflation, fd = BALANCE.food, inc = BALANCE.income, st = BALANCE.stability;

  S.totalMonths += 1;
  S.month += 1;
  if (S.month > 12) { S.month = 1; S.year += 1; events.push({ type: 'year', year: S.year }); }

  // 1. inflation, then the price index everything else is measured in
  S.inflation = Math.max(nf.floor, S.inflation - nf.monthly_decay);
  if (S.treasury < 0) S.inflation += nf.deficit_penalty;
  S.priceIndex *= 1 + (S.inflation / 100) / 12;

  var pop = totalPop(S);
  var pi = S.priceIndex;

  // 2. income — nominal, so it rises with prices the same way costs do
  var incomeTax = pop * inc.income_tax_coef * S.tax * (S.finComp / 100);
  var corpTax = pop * inc.corporate_tax_coef * (nationalLevel(S, 'power') / 60) * (S.finComp / 100);
  var bills = pop * inc.utility_bills_coef * (S.utilPrice / BALANCE.start.utility_price);
  var income = pi * (incomeTax + corpTax + bills);

  // 3. food: the farm province's water decides how much of the country eats
  var production = fd.agri_yield * (S.level.agri.water / 60);
  var gap = Math.max(0, pop * fd.consumption_per_million - production);
  var importCost = gap * fd.world_price * pi;
  var priceTarget = clamp(fd.price_base + gap * fd.price_gap_coef
    + Math.max(0, S.inflation - fd.price_inflation_free_below) * fd.price_inflation_coef
    - S.subsidy * fd.subsidy_coef);
  S.foodPrice += (priceTarget - S.foodPrice) * fd.price_smoothing;

  // 4. the bill
  var run = runningCost(S);
  var admin = BALANCE.start.admin_salaries * pi;
  var projects = S.projects.length * BALANCE.projects.monthly_cost_each * pi;
  var subsidy = S.subsidy * pi;
  var expense = run + admin + projects + subsidy + importCost;
  var wasNegative = S.treasury < 0;
  S.treasury += income - expense;
  var deficit = S.treasury < 0;
  if (deficit && !wasNegative) events.push({ type: 'deficit' });

  // 5. projects: capacity arrives, and the ministry's ask grows forever
  for (var i = S.projects.length - 1; i >= 0; i--) {
    S.projects[i].left -= 1;
    if (S.projects[i].left <= 0) {
      var p = S.projects[i];
      S.fac[p.gov][p.svc] += 1;
      S.ask[p.svc] += BALANCE.services[p.svc].adds_monthly;
      S.projects.splice(i, 1);
      events.push({ type: 'built', gov: p.gov, svc: p.svc });
    }
  }

  // 6-9. services, then the mood they produce
  updateServices(S, deficit);
  updateMood(S);

  // 10-11. stability
  var inflPain = Math.min(55, Math.max(0, S.inflation - nf.pain_starts_above) * nf.pain_coef);
  var opposition = Math.max(0, st.opposition_threshold - S.approval) * st.opposition_coef;
  var stTarget = clamp(st.base - opposition - inflPain * st.inflation_coef);
  S.stability += (stTarget - S.stability) * st.smoothing;

  // 14. the boil, and the two endings
  var md = BALANCE.mood;
  if (S.approval < md.approval_danger && S.stability < md.stability_danger) {
    var boilBefore = S.boil;
    S.boil += (md.approval_danger - S.approval) * md.boil_gain_coef + md.boil_gain_base;
    var step = md.boil_cap / 4;
    if (Math.floor(S.boil / step) > Math.floor(boilBefore / step) && S.boil < md.boil_cap) {
      events.push({ type: 'boiling', pct: Math.round(S.boil / md.boil_cap * 100) });
    }
  } else {
    S.boil = Math.max(0, S.boil - md.boil_cooldown);
  }
  if (S.boil >= md.boil_cap) {
    S.dead = 'riot';
    events.push({ type: 'end', reason: 'riot', gov: worstGovernorate(S) });
  } else if (S.inflation >= nf.collapse_at) {
    S.dead = 'collapse';
    events.push({ type: 'end', reason: 'collapse' });
  }

  // 15. people, money, and the month's paperwork
  var health = nationalLevel(S, 'health');
  var pg = BALANCE.population;
  for (var k = 0; k < GOV_IDS.length; k++) {
    var g = GOV_IDS[k];
    S.pop[g] *= 1 + (pg.monthly_growth_base + (100 - health) / 100 * pg.health_penalty_coef)
      * BALANCE.governorates[g].youth;
  }
  S.personal *= 1 - (S.inflation / 100) / 12;
  S.ap = S.apMax;

  // Keep the arithmetic so the screens can show the player where a number came
  // from. Rule of the design doc: no number without a visible reason.
  S.lastMonth = {
    income: income, incomeTax: pi * incomeTax, corpTax: pi * corpTax, bills: pi * bills,
    expense: expense, run: run, admin: admin, projects: projects,
    subsidy: subsidy, importCost: importCost,
    net: income - expense, foodGap: gap, deficit: deficit
  };
  return events;
}

/* ------------------------------------------------------------- the actions */

/* Starting a building project. Returns null on success, or why it was refused —
   the UI must never have to work that out for itself. */
function startProject(S, gov, svc) {
  var sd = BALANCE.services[svc];
  var cost = Math.round(sd.build_cost * S.priceIndex);
  if (S.treasury < cost) return 'الخزينة مش كفاية';
  S.treasury -= cost;
  S.projects.push({ gov: gov, svc: svc, left: sd.build_months, cost: cost });
  return null;
}

function projectCost(S, svc) {
  return Math.round(BALANCE.services[svc].build_cost * S.priceIndex);
}
