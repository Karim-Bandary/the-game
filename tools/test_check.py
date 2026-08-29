#!/usr/bin/env python3
"""
Tests the checker itself.

A checker that has never failed is not a checker — it is decoration. This
breaks each thing on purpose in a throwaway copy of the repo and asserts that
tools/check.py notices. If someone weakens a check later, this goes red.

Every new check added to check.py should get a deliberate breakage here.
"""
import json, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

TEXT_CASES = [
    ("وسم مش مقفول", "docs/design.html", lambda s: s.replace("</section>", "", 1)),
    ("رابط داخلي ميت", "docs/design.html", lambda s: s.replace('href="#s5"', 'href="#nope"')),
    ("لون معرّف في الوضع الداكن بس", "docs/design.html", lambda s: s.replace("--seal:#155c4c;", "", 1)),
    ("سهم في الرسمة مالوش تعريف", "docs/design.html", lambda s: s.replace('<marker id="m1"', '<marker id="mX"', 1)),
    ("دالة زرار ناقصة", "docs/app-mockup.html", lambda s: s.replace("function gset(g)", "function gsetX(g)", 1)),
    ("خطأ في الجافاسكريبت", "docs/setup-mockup.html", lambda s: s.replace("function draw(){", "function draw(){{", 1)),
    ("ملف متولّد اتعدّل بالإيد", "docs/balance.html", lambda s: s.replace("<h1>", "<h1>x", 1)),
    ("الملف الملزوق اتعدّل بالإيد", "game/index.html", lambda s: s.replace("<title>", "<title>x", 1)),
]

# These change a game source and rebuild first, so the bundle is valid but the
# RULES are wrong — the only thing that catches that is the game's own test.
REBUILD_CASES = [
    ("طاقة القرارات مبقتش بتتجدد", "game/src/engine.js",
     lambda s: s.replace("S.ap = S.apMax;", "// removed")),
    ("لفة السنة اتكسرت", "game/src/engine.js",
     lambda s: s.replace("if (S.month > 12)", "if (S.month > 13)")),
    ("معاملات الاختيارات مش بتتطبق", "game/src/engine.js",
     lambda s: s.replace("for (var k in opt.mods) if (S[k] !== undefined) S[k] += opt.mods[k];", "")),
]

JSON_CASES = [
    ("وزن خدمة اتغير فالمجموع باظ", "data/balance.json",
     lambda d: d["services"]["water"].__setitem__("approval_weight", 0.30)),
    ("تكلفة بناء بالسالب", "data/balance.json",
     lambda d: d["services"]["health"].__setitem__("build_cost", -5)),
    ("معامل بيشاور على مفتاح مش موجود", "data/setup.json",
     lambda d: d["government_types"][0]["mods"].__setitem__("moraleX", 5)),
    ("تركيبة بتطلع برّه المدى", "data/setup.json",
     lambda d: d["government_types"][0]["mods"].__setitem__("approval", -60)),
    ("اختيار من غير نجتف", "data/setup.json",
     lambda d: d["society_types"][0].__setitem__("bad", [])),
    ("توازن باظ — الخدمات بقت مجانية", "data/balance.json",
     lambda d: [s.__setitem__("monthly_ask", 1) for s in d["services"].values()]),
]


def broken_repo_fails(rel, mutate, as_json, rebuild=False):
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        p = work / rel
        if as_json:
            d = json.loads(p.read_text(encoding="utf-8"))
            mutate(d)
            p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            p.write_text(mutate(p.read_text(encoding="utf-8")), encoding="utf-8")
        if rebuild:
            b = subprocess.run([sys.executable, str(work / "tools" / "build_game.py")],
                               capture_output=True, text=True)
            if b.returncode:
                return True   # the bundler itself refusing is a pass too
        r = subprocess.run([sys.executable, str(work / "tools" / "check.py")],
                           capture_output=True, text=True)
        return r.returncode != 0


def main():
    ok = True
    for name, rel, mutate in TEXT_CASES:
        caught = broken_repo_fails(rel, mutate, False)
        print(f"  {'✓' if caught else '✗'} {name}")
        ok &= caught
    for name, rel, mutate in JSON_CASES:
        caught = broken_repo_fails(rel, mutate, True)
        print(f"  {'✓' if caught else '✗'} {name}")
        ok &= caught
    for name, rel, mutate in REBUILD_CASES:
        caught = broken_repo_fails(rel, mutate, False, rebuild=True)
        print(f"  {'✓' if caught else '✗'} {name}")
        ok &= caught
    total = len(TEXT_CASES) + len(JSON_CASES) + len(REBUILD_CASES)
    print()
    if ok:
        print(f"✓ الفاحص مسك كل الأخطاء المتعمدة ({total} خطأ).")
        return 0
    print("✗ فيه خطأ متعمد عدّى من غير ما الفاحص يمسكه — الفاحص نفسه محتاج تصليح.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
