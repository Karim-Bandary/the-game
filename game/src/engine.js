/* ============================================================================
   The engine. No DOM here — only state and rules.

   This file is the ONLY place the rules of the game exist. The screens read it,
   and the balance simulator (tools/simulate.js) runs this exact code with
   scripted players. That is deliberate: when a simulator has its own copy of
   the rules, it eventually tests a game nobody is playing.

   No number is written here. Everything comes from data/balance.json, baked in
   at build time as BALANCE.
   ========================================================================== */

var BALANCE   = __BALANCE__;
var SETUP     = __SETUP__;
var MINISTERS = __MINISTERS__;
var PARLIAMENT = __PARLIAMENT__;
var BANK       = __BANK__;

/* Seconds of real time per in-game month. Slow is deliberately slow: the player
   should be able to read a screen before the month turns. */
var SPEEDS = [6.0, 3.0, 1.5];

var SERVICE_IDS = Object.keys(BALANCE.services);
var GOV_IDS = Object.keys(BALANCE.governorates);
var POST_IDS = MINISTERS.posts.map(function (p) { return p.id; });

/* Which post owns which service. Built once from the data so the answer is the
   same everywhere — a service quietly owned by nobody would run on a competence
   of undefined and go to zero without anything looking wrong on screen. */
var SERVICE_OWNER = {};
MINISTERS.posts.forEach(function (p) {
  p.services.forEach(function (s) { SERVICE_OWNER[s] = p.id; });
});

function postOf(id) {
  for (var i = 0; i < MINISTERS.posts.length; i++)
    if (MINISTERS.posts[i].id === id) return MINISTERS.posts[i];
}

/* ------------------------------------------------------------ randomness */
/* Our own generator, seeded from the state, instead of Math.random. Two reasons
   and both matter: the same game has to give the same result twice or the
   balance simulator is measuring a different game on every run, and the player
   must not be able to reroll a bad offer by leaving the screen and coming back.
   mulberry32 — small, fast, good enough for a game, and it fits in ten lines. */
function rngFrom(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Turns any string into a number, so a seed can be built out of the things that
   should decide an outcome (the game, the post, the month) rather than out of
   whenever the player happened to tap. */
function hashStr(s) {
  var h = 2166136261;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

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
    // Every roll in the game comes from here. Saved with the game, so reloading
    // cannot be used to reroll a result the player did not like.
    seed: (choice.seed === undefined) ? (Date.now() >>> 0) : (choice.seed >>> 0),
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

    // The cabinet baseline. This is what the setup modifiers land on; every
    // minister is then shifted by the same difference. No rule reads these two
    // directly — the rules read the individual minister (see ministerComp).
    competence: SETUP.base_start.competence,
    loyalty: SETUP.base_start.loyalty,
    ministers: {},

    pct: {},        // funding percentage per ministry — what the player sets
    ask: {},        // what each ministry asks for this month, in millions
    pop: {},        // population per governorate
    fac: {},        // facilities per governorate per service
    level: {},      // service level 0..100 per governorate per service
    govAppr: {},    // approval per governorate

    projects: [],
    stoleThisMonth: false,
    lastReshuffle: 0,
    // The governor is deliberately NOT one of the ministers: he cannot be swept
    // out by a reshuffle, and his independence is the only thing standing
    // between the player and the printing press.
    bank: { name: BANK.start.name, independence: BANK.start.independence,
            lastPrint: -BANK.print.once_per_months, lastSwap: 0 },
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

  // Each minister starts from his own numbers, moved by the same amount the
  // cabinet baseline moved. A republic does not make one man better — it makes
  // the whole cabinet better, and the gaps between them stay where the data put
  // them. Those gaps are the reason the player has anyone to choose between.
  var dComp = S.competence - SETUP.base_start.competence;
  var dLoy  = S.loyalty - SETUP.base_start.loyalty;
  MINISTERS.posts.forEach(function (p) {
    S.ministers[p.id] = {
      id: p.id,
      name: p.start.name,
      competence: clamp(p.start.competence + dComp),
      loyalty: clamp(p.start.loyalty + dLoy),
      party: p.start.party,
      // Two different clocks, and conflating them broke both. `months` is how
      // long he has done the job: the nine you inherit were appointed before you
      // arrived, so they are already settled and work at full strength. `since`
      // is the month YOU became responsible for him, and that is what the
      // "leave him alone for a while" rule counts — otherwise you could sack the
      // whole inherited cabinet on your first day.
      months: MINISTERS.settling.months,
      since: 0
    };
  });

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

/* A strong prime minister lifts every ministry a little and a weak one drags
   them down, so the post is worth something even though it owns no service. */
function pmBonus(S) {
  return (S.ministers.pm.competence - 50) * MINISTERS.pm_bonus_coef;
}

/* How much of his competence a minister is actually delivering yet. A man who
   took the chair last month does not run a ministry like one who has been there
   a year. This is what stops the player from churning the cabinet until the
   numbers are perfect: every swap costs months of weak work, so a mediocre
   minister who is settled can be worth more than a better one who is new. */
function settleFactor(S, post) {
  var st = MINISTERS.settling;
  return Math.min(1, st.start_factor
    + (1 - st.start_factor) * (S.ministers[post].months / st.months));
}

/* The competence a minister actually works at: his own, plus the PM's push,
   times how settled he is. The PM does not push himself. */
function ministerComp(S, post) {
  var m = S.ministers[post];
  var base = post === 'pm' ? m.competence : m.competence + pmBonus(S);
  return clamp(base * settleFactor(S, post));
}

function serviceMinister(s) { return SERVICE_OWNER[s]; }

/* Funding is a percentage of the ministry's ask, multiplied by how much of each
   pound THIS minister actually delivers. 100% funding is never 100% operating,
   and two ministries funded the same do not come out the same. */
function operating(S, s) {
  return clamp(S.pct[s] * ministerComp(S, SERVICE_OWNER[s]) / 100);
}

/* The one number that says whether a minister is doing his job: his WORST
   service, not his average. An average lets a minister hide one collapsed
   service behind two healthy ones, which is exactly what the player must see.
   Returns null for the posts that own no service. */
function worstServiceOf(S, post) {
  var list = postOf(post).services, worst = null, lo = 1e9;
  for (var i = 0; i < list.length; i++) {
    var v = nationalLevel(S, list[i]);
    if (v < lo) { lo = v; worst = list[i]; }
  }
  return worst;
}

/* The label the cabinet screen hangs on a minister. The thresholds live in the
   data, so the drama of the game can be retuned without touching a screen. */
function ministerTag(S, post) {
  var m = S.ministers[post], t = MINISTERS.tags;
  for (var i = 0; i < t.length; i++) {
    if (m.competence >= t[i].comp[0] && m.competence <= t[i].comp[1]
      && m.loyalty >= t[i].loy[0] && m.loyalty <= t[i].loy[1]) return t[i];
  }
  return null;
}

/* For the screens: the cabinet at a glance. Plain averages — every post counts
   once, including the ones that own no service. */
function avgCompetence(S) {
  var t = 0;
  for (var i = 0; i < POST_IDS.length; i++) t += S.ministers[POST_IDS[i]].competence;
  return t / POST_IDS.length;
}
function avgLoyalty(S) {
  var t = 0;
  for (var i = 0; i < POST_IDS.length; i++) t += S.ministers[POST_IDS[i]].loyalty;
  return t / POST_IDS.length;
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

/* -------------------------------------------------------------- the house */

/* What each party actually watches. Every one of these is a number the player
   can already see somewhere else in the game — a party is never angry about
   something invisible. Each returns 0..100. */
var DRIVERS = {
  stability:    function (S) { return S.stability; },
  approval:     function (S) { return S.approval; },
  services:     function (S) { return avgService(S); },
  security:     function (S) { return nationalLevel(S, 'police'); },
  education:    function (S) { return nationalLevel(S, 'edu'); },
  health:       function (S) { return nationalLevel(S, 'health'); },
  power:        function (S) { return nationalLevel(S, 'power'); },
  lowTax:       function (S) { return clamp(100 - Math.max(0, S.tax - BALANCE.mood.tax_pain_free_below) * 4); },
  lowInflation: function (S) { return clamp(100 - pains(S).inflation * 1.6); },
  treasury:     function (S) { return clamp(S.treasury / BALANCE.start.treasury * 55); }
};

/* How happy one party is with you, 0..100, plus what its own men in your
   cabinet are worth. Appointing from a party is the cheapest way to buy it —
   which is exactly the link that makes the cabinet screens political. */
function partyMood(S, id) {
  var p = partyOf(id), i;
  var v = 0;
  for (i = 0; i < p.drivers.length; i++) {
    v += DRIVERS[p.drivers[i].k](S) * p.drivers[i].w;
  }
  return clamp(v + ministersOfParty(S, p.id) * PARLIAMENT.minister_bonus);
}

/* Counts by party ID, not by display name. The two files used to keep their own
   lists of party names — "المحافظ" in one and "حزب المحافظين" in the other — so
   this always returned zero and every party reported that it had no ministers,
   while the cabinet was full of its members. Nothing errored; the screen just
   quietly told the player the opposite of the truth. */
function ministersOfParty(S, partyId) {
  var n = 0;
  for (var i = 0; i < POST_IDS.length; i++) {
    if (S.ministers[POST_IDS[i]].party === partyId) n++;
  }
  return n;
}

function partyOf(id) {
  for (var i = 0; i < PARLIAMENT.parties.length; i++) {
    if (PARLIAMENT.parties[i].id === id) return PARLIAMENT.parties[i];
  }
  return null;
}

/* The party's display name, for screens. Never used to match anything. */
function partyName(id) {
  var p = partyOf(id);
  return p ? p.nm : 'بلا حزب';
}

/* The chamber as one number: seats weighted by how content each party is. */
function parliamentBacking(S) {
  var t = 0, seats = 0;
  for (var i = 0; i < PARLIAMENT.parties.length; i++) {
    var p = PARLIAMENT.parties[i];
    t += p.seats * partyMood(S, p.id);
    seats += p.seats;
  }
  return seats ? t / seats : 0;
}

/* A social bloc's mood. Deliberately the SAME arithmetic the country's mood is
   made of, with the bloc's own sensitivities — so these five numbers are a
   breakdown of the approval rating the player already lives by, not a second
   opinion that can contradict it. */
function blocFeel(S, b) {
  var pn = pains(S), sv = avgService(S);
  return sv * b.sens.service - pn.food * b.sens.food
    - pn.tax * b.sens.tax - pn.inflation * b.sens.inflation;
}

/* A bloc's mood is the national approval SHIFTED by how differently this group
   feels the same month — not a second formula run alongside it.
   Written as a redistribution on purpose: the weighted average of the shifts is
   zero, so the five blocs always add back up to the approval rating the player
   already lives by. Computing them independently drifted more than twenty points
   under a tax shock, because approval is smoothed over months and a fresh
   formula is not — two screens, two answers, same day. */
function blocMood(S, id) {
  var b = null, i;
  for (i = 0; i < PARLIAMENT.blocs.length; i++) {
    if (PARLIAMENT.blocs[i].id === id) b = PARLIAMENT.blocs[i];
  }
  var mean = 0;
  for (i = 0; i < PARLIAMENT.blocs.length; i++) {
    mean += blocFeel(S, PARLIAMENT.blocs[i]) * PARLIAMENT.blocs[i].share;
  }
  return clamp(S.approval + (blocFeel(S, b) - mean));
}

/* The population-weighted average of the blocs. Should track S.approval; the
   checker asserts it does, because the moment it drifts, two screens are telling
   the player two different things about the same day. */
function blocAverage(S) {
  var t = 0, w = 0;
  for (var i = 0; i < PARLIAMENT.blocs.length; i++) {
    var b = PARLIAMENT.blocs[i];
    t += blocMood(S, b.id) * b.share;
    w += b.share;
  }
  return w ? t / w : 0;
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
/* The three things that make people angry, in one place. The mood of the
   country and the mood of each social bloc are the same arithmetic with
   different sensitivities — computing them twice is how two screens end up
   disagreeing about the same day. */
function pains(S) {
  var md = BALANCE.mood, nf = BALANCE.inflation;
  return {
    inflation: Math.min(55, Math.max(0, S.inflation - nf.pain_starts_above) * nf.pain_coef),
    tax: Math.max(0, S.tax - md.tax_pain_free_below) * md.tax_pain_coef
       + Math.max(0, S.utilPrice - BALANCE.start.utility_price) * md.utility_pain_coef,
    food: Math.max(0, S.foodPrice - BALANCE.food.price_base) * md.food_pain_coef
  };
}

function updateMood(S) {
  var md = BALANCE.mood;
  var pn = pains(S);
  var inflPain = pn.inflation, taxPain = pn.tax, foodPain = pn.food;
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

  // 2. income — nominal, so it rises with prices the same way costs do.
  // Collection is only as good as the finance minister: a weak one loses tax
  // that was owed, which is the point of the post existing at all.
  var finComp = ministerComp(S, 'finance');
  var incomeTax = pop * inc.income_tax_coef * S.tax * (finComp / 100);
  var corpTax = pop * inc.corporate_tax_coef * (nationalLevel(S, 'power') / 60) * (finComp / 100);
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
  var inflPain = pains(S).inflation;
  var opposition = Math.max(0, st.opposition_threshold - S.approval) * st.opposition_coef;
  var disloyal = Math.max(0, st.loyalty_floor - avgLoyalty(S)) * st.loyalty_coef;
  // A parliament that has stopped backing you is a government that wobbles,
  // whatever the street thinks. This is what makes the chamber more than a
  // picture of four parties.
  var bk = PARLIAMENT.backing;
  var noBacking = Math.max(0, bk.floor - parliamentBacking(S)) * bk.stability_coef;
  var stTarget = clamp(st.base - opposition - inflPain * st.inflation_coef
    - disloyal - noBacking);
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
  for (var q = 0; q < POST_IDS.length; q++) S.ministers[POST_IDS[q]].months += 1;
  S.ap = S.apMax;
  S.stoleThisMonth = false;

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

/* ---- the treasury ------------------------------------------------------ */

/* The most you can take this month. A share of what is there, with a ceiling —
   without the ceiling a rich treasury lets the player empty it in one tap and
   the whole trade-off disappears. */
function stealMax(S) {
  var c = BALANCE.corruption;
  return Math.max(0, Math.min(c.hard_cap, Math.floor(S.treasury * c.max_share_per_month)));
}

/* The chance your finance minister talks. Three things drive it: a floor that
   never goes away, how disloyal he is, and how greedy the grab was. Shown to
   the player BEFORE he takes the money — a hidden risk is not a decision. */
function leakChance(S, amount) {
  var c = BALANCE.corruption;
  var loy = S.ministers.finance.loyalty;
  var share = S.treasury > 0 ? amount / S.treasury : 1;
  var v = c.leak_base_pct + (100 - loy) * c.leak_loyalty_coef + share * c.leak_size_coef;
  return Math.max(c.leak_min_pct, Math.min(c.leak_max_pct, v));
}

function stealRefusal(S, amount) {
  if (S.stoleThisMonth) return 'خدت نصيبك الشهر ده — استنى الشهر الجاي';
  if (amount <= 0) return 'مفيش حاجة تتاخد';
  if (amount > stealMax(S)) return 'ده أكتر من اللي ينفع يعدي من غير ما حد ياخد باله';
  if (amount > S.treasury) return 'الخزينة مش فيها الرقم ده';
  return null;
}

/* Returns { ok, leaked } or a refusal string. The roll comes from the game's
   seed and the month, so leaving the screen and coming back cannot reroll it. */
function stealFromTreasury(S, amount) {
  var refusal = stealRefusal(S, amount);
  if (refusal) return refusal;
  var c = BALANCE.corruption;
  var chance = leakChance(S, amount);
  var roll = rngFrom(hashStr(S.seed + '|steal|' + S.totalMonths))();

  S.treasury -= amount;
  S.personal += amount;
  S.stoleThisMonth = true;

  if (roll * 100 < chance) {
    S.approval = clamp(S.approval - c.approval_hit);
    S.stability = clamp(S.stability - c.stability_hit);
    for (var i = 0; i < GOV_IDS.length; i++) {
      S.govAppr[GOV_IDS[i]] = clamp(S.govAppr[GOV_IDS[i]] - c.approval_hit);
    }
    return { ok: true, leaked: true, amount: amount };
  }
  return { ok: true, leaked: false, amount: amount };
}

/* ---- the central bank -------------------------------------------------- */

/* How much the governor will sign for. A man with his own standing says no
   earlier — which is exactly why a president might want him replaced. */
function printCap(S) {
  var pr = BANK.print;
  return Math.round(pr.base_cap
    + (100 - S.bank.independence) * pr.cap_per_lost_independence);
}

/* And what it costs. The less independent the bank, the less the money is
   believed, so the SAME printed pound burns more. That is the trade: a governor
   of your own makes printing easier and dearer at the same time. */
function printInflation(S, millions) {
  var pr = BANK.print;
  var perLot = pr.inflation_per_350
    * (1 + (100 - S.bank.independence) * pr.inflation_per_lost_independence);
  return perLot * (millions / 350);
}

function printRefusal(S, millions) {
  var pr = BANK.print;
  var since = S.totalMonths - S.bank.lastPrint;
  if (since < pr.once_per_months) {
    return 'البنك طبع من ' + since + ' شهر — استنى ' + (pr.once_per_months - since) + ' كمان';
  }
  if (millions <= 0) return 'مفيش حاجة تتطبع';
  if (millions > printCap(S)) {
    return 'المحافظ مش هيوقّع على أكتر من ' + printCap(S) + 'م';
  }
  return null;
}

/* Printing money. The rule lived here before its screen existed, because the
   simulator was already doing this arithmetic itself and a rule in two places
   is a rule that will disagree with itself. */
function printMoney(S, millions) {
  var refusal = printRefusal(S, millions);
  if (refusal) return refusal;
  S.treasury += millions * S.priceIndex;
  S.inflation += printInflation(S, millions);
  S.bank.lastPrint = S.totalMonths;
  return null;
}

function swapGovernorRefusal(S) {
  var sw = BANK.swap;
  if (S.ap < sw.ap_cost) return 'طاقة القرارات مش كفاية — محتاج ' + sw.ap_cost;
  var since = S.totalMonths - S.bank.lastSwap;
  if (since < sw.cooldown_months) {
    return 'غيّرت المحافظ من ' + since + ' شهر — استنى ' + (sw.cooldown_months - since) + ' كمان';
  }
  if (S.bank.independence <= sw.new_independence[1]) {
    return 'المحافظ ده بتاعك أصلاً — مفيش أطوع منه';
  }
  return null;
}

/* Replacing the governor with your own man. The replacement is always less
   independent than the range allows, so the move can never accidentally give the
   player a MORE independent bank — the trade has to point one way to be a trade. */
function swapGovernor(S) {
  var refusal = swapGovernorRefusal(S);
  if (refusal) return refusal;
  var sw = BANK.swap;
  var rnd = rngFrom(hashStr(S.seed + '|governor|' + S.totalMonths));
  var names = MINISTERS.candidate_names;
  S.ap -= sw.ap_cost;
  S.stability = clamp(S.stability - sw.stability_hit);
  S.bank = {
    name: names[Math.floor(rnd() * names.length)],
    independence: Math.round(sw.new_independence[0]
      + rnd() * (sw.new_independence[1] - sw.new_independence[0])),
    lastPrint: S.bank.lastPrint,
    lastSwap: S.totalMonths
  };
  return null;
}

/* ---- changing a minister ---------------------------------------------- */

/* The three people you could put in his chair. Derived from the game's seed,
   the post and the month — NOT from a stored list and not from Math.random.
   That means the screen shows the same three however many times it is redrawn,
   the player cannot reroll them by walking out and back in, and next month
   brings different people. */
/* Draws one person. The competence comes first and the loyalty is drawn AROUND
   a centre that falls as the competence rises: a man with a real reputation has
   somewhere else to go, so he owes you less. This is the trade the whole game is
   built on, and it has to live in the draw itself — otherwise repeating the draw
   eventually hands the player someone who is both, and managing the cabinet
   becomes the strongest strategy there is. */
function drawCandidate(S, rnd, compShift) {
  var d = MINISTERS.dismiss;
  var comp = clamp(Math.round(d.comp_range[0]
    + rnd() * (d.comp_range[1] - d.comp_range[0]) + (compShift || 0)),
    d.comp_range[0], d.comp_range[1]);

  var compMid = (d.comp_range[0] + d.comp_range[1]) / 2;
  var loyMid = (d.loy_range[0] + d.loy_range[1]) / 2;
  var centre = loyMid - (comp - compMid) * d.loy_tradeoff_coef;
  var loy = Math.round(centre + (rnd() - 0.5) * 2 * d.loy_spread);

  return {
    competence: comp,
    loyalty: clamp(loy, d.loy_range[0], d.loy_range[1]),
    party: PARLIAMENT.parties[Math.floor(rnd() * PARLIAMENT.parties.length)].id
  };
}

function candidatesFor(S, post) {
  var d = MINISTERS.dismiss, out = [];
  var rnd = rngFrom(hashStr(S.seed + '|' + post + '|' + S.totalMonths));
  var names = MINISTERS.candidate_names;
  var used = {};
  for (var i = 0; i < d.candidates; i++) {
    var n;
    do { n = Math.floor(rnd() * names.length); } while (used[n]);
    used[n] = 1;
    var c = drawCandidate(S, rnd, 0);
    c.name = names[n];
    out.push(c);
  }
  return out;
}

/* Why a minister cannot be sacked the month he arrives: without it the player
   rerolls the cabinet every month until the numbers are perfect, and choosing
   ministers stops being a decision with a cost. */
function dismissRefusal(S, post) {
  var d = MINISTERS.dismiss;
  if (S.ap < d.ap_cost) return 'طاقة القرارات مش كفاية — محتاج ' + d.ap_cost;
  var held = S.totalMonths - S.ministers[post].since;
  if (held < d.min_months_in_post) {
    return 'لسه في المنصب من ' + held + ' شهر — استنى ' + (d.min_months_in_post - held) + ' كمان';
  }
  return null;
}

/* ---- the whole cabinet at once ---------------------------------------- */

/* How much better (or worse) than a random draw the new cabinet will be. This
   is the prime minister's second reason to exist: a strong one brings in strong
   people, a weak one brings in whoever is around. */
function reshuffleQualityShift(S) {
  return (S.ministers.pm.competence - 50) * MINISTERS.reshuffle.pm_quality_coef;
}

function reshuffleRefusal(S) {
  var r = MINISTERS.reshuffle;
  if (S.ap < r.ap_cost) return 'طاقة القرارات مش كفاية — محتاج ' + r.ap_cost;
  var since = S.totalMonths - S.lastReshuffle;
  if (since < r.cooldown_months) {
    return 'آخر تعديل من ' + since + ' شهر — استنى ' + (r.cooldown_months - since) + ' كمان';
  }
  return null;
}

/* Replaces every minister except the prime minister, blind. The trade against
   sacking people one at a time is the whole point: this is fast and cheap per
   head, but you do not get to look at anybody first. */
function reshuffleCabinet(S) {
  var refusal = reshuffleRefusal(S);
  if (refusal) return refusal;
  var r = MINISTERS.reshuffle, d = MINISTERS.dismiss;
  var shift = reshuffleQualityShift(S);
  var changed = [];

  for (var i = 0; i < POST_IDS.length; i++) {
    var post = POST_IDS[i];
    if (post === 'pm') continue;                    // he is the one doing this
    var rnd = rngFrom(hashStr(S.seed + '|shuffle|' + S.totalMonths + '|' + post));
    var names = MINISTERS.candidate_names;
    var before = S.ministers[post];
    var c = drawCandidate(S, rnd, shift);
    S.ministers[post] = {
      id: post,
      competence: c.competence,
      loyalty: c.loyalty,
      party: c.party,
      months: 0,
      since: S.totalMonths,
      name: names[Math.floor(rnd() * names.length)]
    };
    changed.push({ post: post, before: before.competence, after: S.ministers[post].competence });
  }

  S.ap -= r.ap_cost;
  S.stability = clamp(S.stability - r.stability_hit);
  S.approval = clamp(S.approval - r.approval_hit);
  for (var g = 0; g < GOV_IDS.length; g++) {
    S.govAppr[GOV_IDS[g]] = clamp(S.govAppr[GOV_IDS[g]] - r.approval_hit);
  }
  S.lastReshuffle = S.totalMonths;
  return { ok: true, changed: changed };
}

/* Returns null on success, or the reason it was refused. The UI must never have
   to work out for itself whether a move was legal. */
function dismissMinister(S, post, pick) {
  var refusal = dismissRefusal(S, post);
  if (refusal) return refusal;
  var d = MINISTERS.dismiss;
  var c = candidatesFor(S, post)[pick];
  if (!c) return 'المرشح ده مش موجود';

  S.ap -= d.ap_cost;
  // Sacking a minister shakes the government whoever replaces him. The cost is
  // paid up front so the player feels the move, not only its result.
  S.stability = clamp(S.stability - d.stability_hit);
  // And the other eight watch it happen. Without this, churning the cabinet has
  // no cumulative price and grinding it to perfection becomes the best strategy
  // in the game — which is exactly what the simulator found.
  for (var k = 0; k < POST_IDS.length; k++) {
    if (POST_IDS[k] === post) continue;
    S.ministers[POST_IDS[k]].loyalty = clamp(S.ministers[POST_IDS[k]].loyalty - d.others_loyalty_hit);
  }
  S.ministers[post] = {
    id: post,
    name: c.name,
    competence: clamp(c.competence),
    loyalty: clamp(c.loyalty),
    party: c.party,
    months: 0,
    since: S.totalMonths
  };
  return null;
}
