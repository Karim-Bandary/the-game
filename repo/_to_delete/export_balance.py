"""
Single source of truth: turns the simulator's constants into data/balance.json.

Why: the balance document and the game must never disagree. The document's
tables are generated from this file, and check_balance.py fails the build if
a number in the document is not in the JSON.
"""
import json, os, sys, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent   # repo root, whatever the cwd is
DATA = ROOT / "data"
DOCS = ROOT / "docs"

def wrap_page(title, body):
    """docs/ pages are standalone: GitHub Pages serves them with no wrapper."""
    head, rest = body.split("</style>", 1)
    return ('<!DOCTYPE html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + head + "</style>\n</head>\n<body>\n" + rest + "\n</body>\n</html>\n")
import io, contextlib
sys.path.insert(0, str(ROOT / "tools"))
import sim

out = {
    "_note": "كل الفلوس بالمليون. كل المؤشرات من 0 إلى 100 إلا التضخم (نسبة سنوية).",
    "start": {
        "treasury": sim.TREASURY_START,
        "inflation": sim.INFLATION_START,
        "tax_rate": sim.TAX_START,
        "utility_price": sim.UTIL_PRICE_START,
        "food_subsidy": sim.SUBSIDY_START,
        "budget_pct": sim.START_PCT,
        "minister_competence": sim.COMPETENCE,
        "admin_salaries": sim.ADMIN_SALARIES,
        "population_millions": round(sum(g["pop"] for g in sim.GOVS.values()), 1),
    },
    "governorates": {
        k: {"name": v["nm"], "population": v["pop"], "wealth": v["wealth"], "youth": v["youth"],
            "facilities": sim.START_FACILITIES[k]}
        for k, v in sim.GOVS.items()
    },
    "services": {
        k: {"name": v["nm"], "serves_millions": v["cap"], "monthly_ask": sim.BASE_REQ[k],
            "build_cost": v["build"], "build_months": v["months"],
            "adds_monthly": v["run"], "approval_weight": v["w"]}
        for k, v in sim.SERVICES.items()
    },
    "income": {
        "income_tax_coef": 2.30, "corporate_tax_coef": 33.0, "utility_bills_coef": 22.0,
        "formula": "الدخل = مؤشر الأسعار × (سكان×2.30×الضريبة×كفاءة المالية + سكان×33×(الكهربا÷60)×كفاءة المالية + سكان×22×(سعر الفواتير÷50))"
    },
    "food": {
        "agri_yield": sim.AGRI_YIELD, "world_price": sim.FOOD_WORLD_PRICE,
        "consumption_per_million": 1.0, "price_smoothing": 0.55,
        "formula": "الإنتاج = 11 × (مستوى مياه الزراعية ÷ 60) · العجز = السكان − الإنتاج"
    },
    "inflation": {
        "monthly_decay": 0.08, "floor": 3.0, "deficit_penalty": 1.4,
        "collapse_at": sim.INFLATION_COLLAPSE, "pain_starts_above": 9.0, "pain_coef": 1.5,
        "print_350_adds": 2.2
    },
    "mood": {
        "smoothing": sim.SMOOTH, "stability_smoothing": 0.22,
        "tax_pain_coef": 1.6, "tax_pain_free_below": 18,
        "utility_pain_coef": 0.8, "food_pain_coef": 0.85,
        "approval_danger": sim.APPROVAL_DANGER, "stability_danger": sim.STABILITY_DANGER,
        "boil_cap": sim.BOIL_CAP, "boil_cooldown": 7,
    },
    "population": {"monthly_growth_base": 0.0018, "health_penalty_coef": 0.0010},
}

DATA.mkdir(exist_ok=True)
with open(DATA / "balance.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2)

# capture the simulator's verdict so the document can quote real output
buf = io.StringIO()
with contextlib.redirect_stdout(buf):
    sim.reset_reqs()
    st = sim.State()
    rows = []
    for nm, pl in [("سلبي", sim.passive), ("معقول", sim.reasonable), ("حرامي", sim.thief)]:
        lives = []
        for s in range(40):
            r = sim.run(pl, seed=s)
            lives.append(r.month if r.dead else 300)
        lives.sort()
        rows.append((nm, lives[len(lives)//2]))
print(json.dumps({"start_state": {
    "approval": round(st.approval), "stability": round(st.stability),
    "avg_service": round(st.avg_service()),
    "by_gov": {sim.GOVS[g]["nm"]: round(st.gov_appr[g]) for g in sim.GOVS},
    "by_service": {sim.SERVICES[s]["nm"]: round(st.national(s)) for s in sim.SERVICES},
}, "median_lifespan_months": dict(rows)}, ensure_ascii=False, indent=2))
