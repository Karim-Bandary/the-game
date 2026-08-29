/* ============================================================================
   The engine. No DOM here — only state and rules.
   Kept separate from the UI so the same month loop can later be driven by the
   balance simulator without a browser, and so a UI bug can never be a rules bug.
   ========================================================================== */

var BALANCE = __BALANCE__;
var SETUP   = __SETUP__;

/* Speeds are seconds of real time per in-game month. Slow is deliberately slow:
   the player should have time to read a screen before the month turns. */
var SPEEDS = [6.0, 3.0, 1.5];

function clamp(v, lo, hi) { return Math.max(lo === undefined ? 0 : lo, Math.min(hi === undefined ? 100 : hi, v)); }

/* Build the starting state from the player's setup choices.
   Everything the game needs lives on this one plain object, so saving the game
   later is JSON.stringify(S) and nothing more. */
function newGame(choice) {
  var b = BALANCE.start;
  var S = {
    version: 1,
    country: choice.country,
    ruler: choice.ruler,
    govId: choice.gov.id,
    socId: choice.soc.id,
    month: 1,            // 1..12
    year: 1,
    totalMonths: 0,      // months survived — the score
    approval: SETUP.base_start.approval,
    stability: SETUP.base_start.stability,
    inflation: b.inflation,
    priceIndex: 1.0,
    treasury: b.treasury,
    personal: 0,
    ap: SETUP.base_start.ap,
    apMax: SETUP.base_start.ap,
    competence: SETUP.base_start.competence,
    loyalty: SETUP.base_start.loyalty,
    log: []
  };
  // Government and society are modifiers, never separate content. Applying them
  // here is the only place they touch the state.
  [choice.gov, choice.soc].forEach(function (opt) {
    for (var k in opt.mods) if (S[k] !== undefined) S[k] += opt.mods[k];
  });
  S.apMax = S.ap;
  S.approval = clamp(S.approval);
  S.stability = clamp(S.stability);
  return S;
}

/* Events carry DATA, never text. The engine must not decide how a number is
   written — that is the UI's job, and mixing the two put Latin digits on an
   Arabic screen once already. */

/* The whole month, in one function.
   Whatever calls this — a timer, a button, or elapsed offline time — is not the
   engine's business. That separation is what lets us change how time flows
   without touching a single rule. Returns the events the UI should react to. */
function tickMonth(S) {
  var events = [];

  S.totalMonths += 1;
  S.month += 1;
  if (S.month > 12) { S.month = 1; S.year += 1; events.push({ type: 'year', year: S.year }); }

  // Prices drift with inflation every month; the rest of the economy lands in
  // item 7 and reads this index rather than raw numbers.
  S.priceIndex *= 1 + (S.inflation / 100) / 12;

  S.ap = S.apMax;                       // action points refill each month

  return events;
}

/* ---- helpers the UI needs but that are rules, not presentation ---------- */

function govOf(S) {
  return SETUP.government_types.filter(function (g) { return g.id === S.govId; })[0];
}
function socOf(S) {
  return SETUP.society_types.filter(function (s) { return s.id === S.socId; })[0];
}

/* A meter is in danger below the balance file's own thresholds, so the warning
   the player sees and the number the simulator uses can never disagree. */
function danger(S) {
  return {
    approval: S.approval < BALANCE.mood.approval_danger,
    stability: S.stability < BALANCE.mood.stability_danger,
    inflation: S.inflation > BALANCE.inflation.pain_starts_above
  };
}
