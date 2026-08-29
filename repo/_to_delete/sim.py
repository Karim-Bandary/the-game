"""
Balance simulator for the presidency game.

Why this exists: neither Karim nor I can playtest a game that doesn't exist yet.
This runs the design doc's month loop with scripted "players" so the starting
numbers get checked before they turn into code.

Key modelling choice made here (and fed back into the design doc):
the player sets each ministry's budget as a PERCENTAGE of what the ministry
asks for, not an absolute number. Inflation then raises the ask (and the
treasury bill) without forcing the player to retype numbers every month.
"""
import random, statistics

GOVS = {
    "capital":    dict(nm="العاصمة",  pop=4.2, wealth=1.30, youth=0.85),
    "industrial": dict(nm="الصناعية", pop=2.4, wealth=1.10, youth=1.00),
    "agri":       dict(nm="الزراعية", pop=2.2, wealth=0.80, youth=1.05),
    "south":      dict(nm="الجنوب",   pop=2.6, wealth=0.60, youth=1.35),
    "border":     dict(nm="الحدودية", pop=0.6, wealth=0.75, youth=1.00),
}

# cap = millions served per facility · req = national monthly ask at month 0
SERVICES = {
    "water":  dict(nm="المياه",   cap=1.5, req=60,  build=520, months=6,  run=9,  w=0.16),
    "power":  dict(nm="الكهربا",  cap=1.8, req=105, build=900, months=11, run=16, w=0.15),
    "sewage": dict(nm="الصرف",    cap=2.0, req=45,  build=610, months=9,  run=8,  w=0.11),
    "health": dict(nm="الصحة",    cap=1.0, req=82,  build=400, months=8,  run=7,  w=0.17),
    "edu":    dict(nm="التعليم",  cap=0.6, req=95,  build=180, months=4,  run=6,  w=0.14),
    "police": dict(nm="الشرطة",   cap=0.5, req=58,  build=150, months=3,  run=5,  w=0.15),
    "fire":   dict(nm="الإسعاف",  cap=0.5, req=35,  build=120, months=3,  run=4,  w=0.12),
}

START_FACILITIES = {
    "capital":    dict(water=3, power=2, sewage=2, health=4, edu=5, police=6, fire=4),
    "industrial": dict(water=2, power=1, sewage=1, health=2, edu=3, police=3, fire=2),
    "agri":       dict(water=1, power=1, sewage=1, health=2, edu=2, police=2, fire=2),
    "south":      dict(water=1, power=1, sewage=1, health=1, edu=3, police=3, fire=1),
    "border":     dict(water=1, power=1, sewage=0, health=1, edu=1, police=1, fire=1),
}

START_PCT = 118          # % of every ministry's ask, funded at month 0
COMPETENCE = 65          # average minister competence at month 0
ADMIN_SALARIES = 180
TAX_START = 20
UTIL_PRICE_START = 50
SUBSIDY_START = 60
TREASURY_START = 2400
INFLATION_START = 6.0
INFLATION_COLLAPSE = 150.0
FOOD_WORLD_PRICE = 28
AGRI_YIELD = 11.0
SMOOTH = 0.30
BOIL_CAP = 100
APPROVAL_DANGER = 35
STABILITY_DANGER = 40


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


class State:
    def __init__(self):
        self.month = 0
        self.treasury = float(TREASURY_START)
        self.personal = 0.0
        self.inflation = INFLATION_START
        self.price_index = 1.0
        self.tax = TAX_START
        self.util = UTIL_PRICE_START
        self.subsidy = float(SUBSIDY_START)
        self.pct = {s: float(START_PCT) for s in SERVICES}
        self.comp = {s: float(COMPETENCE) for s in SERVICES}
        self.fin_comp = float(COMPETENCE)
        self.fac = {g: dict(v) for g, v in START_FACILITIES.items()}
        self.pop = {g: GOVS[g]["pop"] for g in GOVS}
        self.level = {g: {s: 0.0 for s in SERVICES} for g in GOVS}
        self.gov_appr = {g: 60.0 for g in GOVS}
        self.approval = 60.0
        self.stability = 68.0
        self.boil = 0.0
        self.food_price = 50.0
        self.projects = []
        self.dead = None
        self.settle()

    def settle(self):
        """Let services and approval reach their month-0 resting values,
        so the player doesn't watch every bar swing on the first turn."""
        for _ in range(25):
            self.services()
            self.mood()

    # ---------------------------------------------------------------- parts
    def total_pop(self):
        return sum(self.pop.values())

    def operating(self, s):
        return clamp(self.pct[s] * self.comp[s] / 100.0)

    def coverage(self, g, s):
        return min(1.0, self.fac[g][s] * SERVICES[s]["cap"] / self.pop[g]) * 100.0

    def national(self, s):
        tp = self.total_pop()
        return sum(self.level[g][s] * self.pop[g] for g in GOVS) / tp

    def avg_service(self):
        return sum(self.national(s) * SERVICES[s]["w"] for s in SERVICES)

    def services(self, deficit=False):
        for s in SERVICES:
            op = self.operating(s) * (0.55 if deficit else 1.0)
            for g in GOVS:
                target = self.coverage(g, s) * op / 100.0
                cur = self.level[g][s]
                self.level[g][s] = cur + (target - cur) * (SMOOTH * (2.0 if deficit else 1.0))

    def mood(self):
        infl_pain = min(55.0, max(0.0, self.inflation - 9) * 1.5)
        tax_pain = max(0.0, self.tax - 18) * 1.6 + max(0.0, self.util - 50) * 0.8
        food_pain = max(0.0, self.food_price - 50) * 0.85
        for g in GOVS:
            svc = sum(self.level[g][s] * SERVICES[s]["w"] for s in SERVICES)
            w = GOVS[g]["wealth"]
            target = clamp(svc - (tax_pain + food_pain) / w - infl_pain)
            self.gov_appr[g] += (target - self.gov_appr[g]) * SMOOTH
        self.approval = sum(self.gov_appr[g] * self.pop[g] for g in GOVS) / self.total_pop()

    # ---------------------------------------------------------------- tick
    def tick(self):
        self.month += 1
        pi = self.price_index

        # 1. inflation: decays toward a 3% floor unless something feeds it
        self.inflation = max(3.0, self.inflation - 0.08)
        if self.treasury < 0:
            self.inflation += 1.4
        self.price_index *= 1.0 + (self.inflation / 100.0) / 12.0

        # 2. income (nominal, so it rises with the price index)
        pop = self.total_pop()
        income = pi * (
            pop * 2.30 * self.tax * (self.fin_comp / 100.0)
            + pop * 33.0 * (self.national("power") / 60.0) * (self.fin_comp / 100.0)
            + pop * 22.0 * (self.util / 50.0)
        )

        # 3. food
        production = AGRI_YIELD * (self.level["agri"]["water"] / 60.0)
        gap = max(0.0, pop - production)
        import_cost = gap * FOOD_WORLD_PRICE * pi
        target = 50 + gap * 6.0 + max(0.0, self.inflation - 6) * 0.9 - self.subsidy * 0.22
        self.food_price += (clamp(target) - self.food_price) * 0.55      # sharp by design

        # 4. expenses
        run_cost = sum(SERVICES[s]["req"] * self.pct[s] / 100.0 for s in SERVICES) * pi
        proj_cost = len(self.projects) * 9 * pi
        expense = run_cost + ADMIN_SALARIES * pi + self.subsidy * pi + import_cost + proj_cost
        self.treasury += income - expense
        deficit = self.treasury < 0

        # 5. projects finish → capacity up, and the ministry's ask goes up forever
        for p in list(self.projects):
            p["left"] -= 1
            if p["left"] <= 0:
                self.projects.remove(p)
                self.fac[p["gov"]][p["svc"]] += 1
                SERVICES[p["svc"]]["req"] += SERVICES[p["svc"]]["run"]

        # 6-9. services and mood
        self.services(deficit)
        self.mood()

        # 10-11. stability
        opposition = max(0.0, 55 - self.approval) * 0.8
        infl_pain = min(55.0, max(0.0, self.inflation - 9) * 1.5)
        st_target = clamp(74 - opposition - infl_pain * 0.6)
        self.stability += (st_target - self.stability) * 0.22

        # 14. boil and the two endings
        if self.approval < APPROVAL_DANGER and self.stability < STABILITY_DANGER:
            self.boil += (APPROVAL_DANGER - self.approval) * 0.8 + 3
        else:
            self.boil = max(0.0, self.boil - 7)
        if self.boil >= BOIL_CAP:
            self.dead = "شغب وعزل"
        if self.inflation >= INFLATION_COLLAPSE:
            self.dead = "انهيار اقتصادي"

        # 15. population growth, and inflation eating the stolen money
        h = self.national("health")
        for g in GOVS:
            self.pop[g] *= 1.0 + (0.0018 + (100 - h) / 100.0 * 0.0010) * GOVS[g]["youth"]
        self.personal *= 1.0 - (self.inflation / 100.0) / 12.0


def reset_reqs():
    """SERVICES['req'] is mutated when projects finish — restore between runs."""
    for s, v in BASE_REQ.items():
        SERVICES[s]["req"] = v


BASE_REQ = {s: SERVICES[s]["req"] for s in SERVICES}


# ---------------------------------------------------------------- players
def passive(st):
    pass


def reasonable(st):
    # keep the books straight first
    if st.treasury < 1200 and st.tax < 30:
        st.tax += 0.5
    elif st.treasury > 4000 and st.tax > 18:
        st.tax -= 0.4
    # then fix the worst service in the angriest governorate
    worst_g = min(GOVS, key=lambda g: st.gov_appr[g])
    worst_s = min(SERVICES, key=lambda s: st.level[worst_g][s])
    cost = SERVICES[worst_s]["build"] * st.price_index
    if st.treasury > cost + 600 and len(st.projects) < 4:
        st.treasury -= cost
        st.projects.append(dict(gov=worst_g, svc=worst_s, left=SERVICES[worst_s]["months"]))
    if st.treasury > 2200:
        lo = min(SERVICES, key=st.national)
        st.pct[lo] = min(150, st.pct[lo] + 1.5)
    if st.food_price > 60 and st.treasury > 1000:
        st.subsidy = min(220, st.subsidy + 12)


def thief(st):
    if st.treasury > 600:
        take = min(140, st.treasury * 0.05)
        st.treasury -= take
        st.personal += take
    if st.treasury < 500:
        st.treasury += 350 * st.price_index
        st.inflation += 2.2


def run(player, months=300, seed=0):
    random.seed(seed)
    reset_reqs()
    st = State()
    for _ in range(months):
        player(st)
        st.tick()
        if st.dead:
            break
    return st


def report(name, player, n=40):
    ends, alive, infl, per, ap = [], 0, [], [], []
    causes = {}
    for s in range(n):
        st = run(player, seed=s)
        if st.dead:
            ends.append(st.month)
            causes[st.dead] = causes.get(st.dead, 0) + 1
        else:
            alive += 1
        infl.append(st.inflation); per.append(st.personal); ap.append(st.approval)
    print(f"\n== {name} ==")
    if ends:
        print(f"   مات {len(ends)}/{n} · وسيط العمر {statistics.median(ends):.0f} شهر "
              f"(≈{statistics.median(ends)/12:.1f} سنة) · الأسباب {causes}")
    print(f"   عاش 25 سنة كاملة: {alive}/{n}")
    st = run(player, months=60, seed=0)
    print(f"   بعد 5 سنين: خزينة {st.treasury:>7.0f}م · رضا {st.approval:4.0f} · ثبات {st.stability:4.0f}"
          f" · خدمات {st.avg_service():4.0f} · تضخم {st.inflation:4.0f}% · غليان {st.boil:3.0f}"
          f" · جيبك {st.personal:5.0f}م")
    st = run(player, months=120, seed=0)
    print(f"   بعد 10 سنين: خزينة {st.treasury:>7.0f}م · رضا {st.approval:4.0f} · ثبات {st.stability:4.0f}"
          f" · خدمات {st.avg_service():4.0f} · تضخم {st.inflation:4.0f}% · غليان {st.boil:3.0f}"
          f" · جيبك {st.personal:5.0f}م" + (f"  [مات: {st.dead}]" if st.dead else ""))


if __name__ == "__main__":
    reset_reqs()
    st = State()
    print("=== حالة البداية (الشهر ٠) ===")
    print(f"  السكان {st.total_pop():.1f}م · الخزينة {st.treasury:.0f}م · التضخم {st.inflation:.0f}%")
    print(f"  الرضا {st.approval:.0f} · الثبات {st.stability:.0f} · متوسط الخدمات {st.avg_service():.0f}"
          f" · سعر الغذاء {st.food_price:.0f}")
    print("\n  الخدمات قوميًا:")
    for s in SERVICES:
        print(f"    {SERVICES[s]['nm']:<8} تشغيل {st.operating(s):3.0f}%  المستوى {st.national(s):3.0f}"
              f"  الطلب {SERVICES[s]['req']:3d}م")
    print("\n  المحافظات:")
    for g in GOVS:
        worst = min(SERVICES, key=lambda s: st.level[g][s])
        print(f"    {GOVS[g]['nm']:<10} سكان {st.pop[g]:.1f}م  رضا {st.gov_appr[g]:3.0f}"
              f"  أسوأ خدمة: {SERVICES[worst]['nm']} ({st.level[g][worst]:.0f})")
    for nm, pl in [("لاعب سلبي — ما بيعملش حاجة", passive),
                   ("لاعب معقول — بيصلّح الأسوأ", reasonable),
                   ("لاعب حرامي — بيسرق ويطبع", thief)]:
        report(nm, pl)
