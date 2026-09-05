#!/usr/bin/env python3
"""
Tests the checker itself.

A checker that has never failed is not a checker — it is decoration. This
breaks each thing on purpose in a throwaway copy of the repo and asserts that
tools/check.py notices. If someone weakens a check later, this goes red.

Every new check added to check.py should get a deliberate breakage here.
"""
import json, os, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
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
    ("مانيفست أندرويد XML باظ", "android/app/src/main/AndroidManifest.xml",
     lambda s: s.replace("</manifest>", "")),
    ("اسم الحزمة في الجافا مش زي الجرادل", "android/app/src/main/java/com/karim/thegame/MainActivity.java",
     lambda s: s.replace("package com.karim.thegame;", "package com.other.app;")),
    ("المانيفست بيشاور على نشاط مش موجود", "android/app/src/main/AndroidManifest.xml",
     lambda s: s.replace('android:name=".MainActivity"', 'android:name=".Missing"')),
    ("اسم التطبيق اتشال من res", "android/app/src/main/res/values/strings.xml",
     lambda s: s.replace('name="app_name"', 'name="other"')),
    ("minSdk نزل تحت ٢٦ والأيقونة XML بس", "android/app/build.gradle",
     lambda s: s.replace("minSdk 26", "minSdk 21")),
    ("نسخ اللعبة للتطبيق اتشال", "android/app/build.gradle",
     lambda s: s.replace("tasks.register('copyGame', Copy) {", "tasks.register('unused', Copy) {")),
    ("نسخ اللعبة مش مربوط بالبناء", "android/app/build.gradle",
     lambda s: s.replace("dependsOn 'copyGame'", "// unlinked")),
    ("زرار الرجوع بينده على دالة مش موجودة", "game/src/ui.js",
     lambda s: s.replace("function onAndroidBack()", "function onAndroidBackX()")),
    # The bug that turned CI red while everything was green here: the fake
    # browser stopped supplying a global the game uses, and the test only
    # survived because the Node on this machine happened to have it.
    ("المتصفح المزيّف ناقصه navigator", "tools/test_game.js",
     lambda s: s.replace(
         "global.navigator = { serviceWorker: { register: () => Promise.resolve() } };", "")),
    ("المتصفح المزيّف ناقصه location", "tools/test_game.js",
     lambda s: s.replace(
         "global.location = { protocol: 'file:', href: 'file:///game/index.html' };", "")),
]

# These change a game source and rebuild first, so the bundle is valid but the
# RULES are wrong — the only thing that catches that is the game's own test.
REBUILD_CASES = [
    ("المحرك رجع لـ Math.random", "game/src/engine.js",
     lambda s: s.replace("var rnd = rngFrom(hashStr(S.seed + '|' + post + '|' + S.totalMonths));",
                         "var rnd = Math.random;")),
    ("مصدر العشوائية المحفوظة اتشال", "game/src/engine.js",
     lambda s: s.replace("function rngFrom(", "function rngFromX(")),
    ("المحاكي رجع يسرق بنفسه", "tools/simulate.js",
     lambda s: s.replace("if (S.treasury > 600) stealFromTreasury(S, Math.floor(Math.min(140, stealMax(S))));",
                         "if (S.treasury > 600) { S.treasury -= 140; S.personal += 140; }")),
    ("المحاكي رجع يطبع فلوس بنفسه", "tools/simulate.js",
     lambda s: s.replace("if (S.treasury < 500) printMoney(S, printCap(S));",
                         "if (S.treasury < 500) { S.treasury += 350; S.inflation += 2.2; }")),
    ("السرقة ما بتنقّصش الخزينة", "game/src/engine.js",
     lambda s: s.replace("  S.treasury -= amount;\n  S.personal += amount;", "  S.personal += amount;")),
    ("ينفع تسرق مرتين في الشهر", "game/src/engine.js",
     lambda s: s.replace("  if (S.stoleThisMonth) return 'خدت نصيبك الشهر ده — استنى الشهر الجاي';", "")),
    ("الكتل بقت حساب تاني مش تفكيك للرضا", "game/src/engine.js",
     lambda s: s.replace("return clamp(S.approval + (blocFeel(S, b) - mean));",
                         "return clamp(blocFeel(S, b));")),
    ("المجلس اتشال من حساب الثبات", "game/src/engine.js",
     lambda s: s.replace("    - disloyal - noBacking);", "    - disloyal);")),
    ("التعديل الوزاري بيشيل محافظ البنك", "game/src/engine.js",
     lambda s: s.replace("  S.bank = {\n    name: names[Math.floor(rnd() * names.length)],",
                         "  S.bank = {\n    name: S.bank.name,")),
    ("الطباعة ما بتتقفلش بعد ما تحصل", "game/src/engine.js",
     lambda s: s.replace("  S.bank.lastPrint = S.totalMonths;", "")),
    ("أرقام إنجليزي في رسايل الرفض", "game/src/ui.js",
     lambda s: s.replace("  return String(s).replace(/[0-9]/g, function (d) { return AR[+d]; });",
                         "  return String(s);")),
    ("طباعة الفلوس من غير تضخم", "game/src/engine.js",
     lambda s: s.replace("  S.inflation += printInflation(S, millions);", "")),
    ("رئيس الوزراء بيتغيّر في تعديله هو", "game/src/engine.js",
     lambda s: s.replace("    if (post === 'pm') continue;                    // he is the one doing this", "")),
    ("التعديل الوزاري ما بياخدش طاقة", "game/src/engine.js",
     lambda s: s.replace("  S.ap -= r.ap_cost;\n  S.stability = clamp(S.stability - r.stability_hit);",
                         "  S.stability = clamp(S.stability - r.stability_hit);")),
    ("تعديل وزاري مرفوض وبرضه بيغيّر", "game/src/engine.js",
     lambda s: s.replace("  var refusal = reshuffleRefusal(S);\n  if (refusal) return refusal;",
                         "  var refusal = reshuffleRefusal(S);")),
    ("الولاء مالوش تمن على الثبات", "data/balance.json",
     lambda s: s.replace('"loyalty_coef": 0.55', '"loyalty_coef": 0')),
    ("الوزرا الموروثين بيبدأوا غير مستقرين", "game/src/engine.js",
     lambda s: s.replace("      months: MINISTERS.settling.months,\n      since: 0",
                         "      months: 0,\n      since: 0")),
    ("عدّاد الاستقرار ما بيتصفّرش للوزير الجديد", "game/src/engine.js",
     lambda s: s.replace("    party: c.party,\n    months: 0,\n    since: S.totalMonths",
                         "    party: c.party,\n    months: 99,\n    since: S.totalMonths")),
    ("قايمة وزرا رئيس الوزراء ناقصة واحد", "game/src/ui.js",
     lambda s: s.replace("    if (id === 'pm') continue;                       // he cannot sack himself",
                         "    if (id === 'pm' || id === 'media') continue;")),
    ("طاقة القرارات مبقتش بتتجدد", "game/src/engine.js",
     lambda s: s.replace("S.ap = S.apMax;", "// removed")),
    ("لفة السنة اتكسرت", "game/src/engine.js",
     lambda s: s.replace("if (S.month > 12)", "if (S.month > 13)")),
    ("معاملات الاختيارات مش بتتطبق", "game/src/engine.js",
     lambda s: s.replace("      S[k] += opt.mods[k];", "      // removed")),
    ("رسمة تاب اتشالت", "game/src/art.js", lambda s: s.replace("  pol: '<svg", "  polX: '<svg", 1)),
    ("تدرّج لوني مالوش تعريف", "game/src/art.js",
     lambda s: s.replace('id="fade-down"', 'id="fade-gone"', 1)),
    ("تركيبة بقت فخ — كفاءة واطية أوي", "tools/build_setup_mockup.py",
     lambda s: s.replace('"mods": {"loyalty": +15, "competence": -6},',
                         '"mods": {"loyalty": +15, "competence": -40},')),
]

JSON_CASES = [
    ("وزن خدمة اتغير فالمجموع باظ", "data/balance.json",
     lambda d: d["services"]["water"].__setitem__("approval_weight", 0.30)),
    ("تكلفة بناء بالسالب", "data/balance.json",
     lambda d: d["services"]["health"].__setitem__("build_cost", -5)),
    ("منشأة بتحل المحافظة بضغطة", "data/balance.json",
     lambda d: d["services"]["water"].__setitem__("serves_millions", 3.0)),
    ("معامل بيشاور على مفتاح مش موجود", "data/setup.json",
     lambda d: d["government_types"][0]["mods"].__setitem__("moraleX", 5)),
    ("تركيبة بتطلع برّه المدى", "data/setup.json",
     lambda d: d["government_types"][0]["mods"].__setitem__("approval", -60)),
    ("اختيار من غير نجتف", "data/setup.json",
     lambda d: d["society_types"][0].__setitem__("bad", [])),
    ("توازن باظ — الخدمات بقت مجانية", "data/balance.json",
     lambda d: [s.__setitem__("monthly_ask", 1) for s in d["services"].values()]),
    ("الضرايب اتضاعفت فالدولة بقت غنية", "data/balance.json",
     lambda d: d["income"].__setitem__("income_tax_coef", 9.0)),
    ("السرقة بقت من غير تمن", "data/balance.json",
     lambda d: (d["corruption"].__setitem__("approval_hit", 0),
                d["corruption"].__setitem__("stability_hit", 0))),
    ("ولاء وزير المالية مالوش تأثير على التسريب", "data/balance.json",
     lambda d: d["corruption"].__setitem__("leak_loyalty_coef", 0)),
    ("مفيش سقف للسرقة", "data/balance.json",
     lambda d: d["corruption"].__setitem__("hard_cap", 0)),
    ("احتمال التسريب مقلوب", "data/balance.json",
     lambda d: d["corruption"].__setitem__("leak_min_pct", 90)),
    ("الضريبة الابتدائية برّه مدى المقبض", "data/balance.json",
     lambda d: d["levers"]["tax"].__setitem__("min", 30)),
    ("خطوة المقبض كبيرة أوي", "data/balance.json",
     lambda d: d["levers"]["subsidy"].__setitem__("step", 200)),
    ("مقاعد الأحزاب مش ١٠٠", "data/parliament.json",
     lambda d: d["parties"][0].__setitem__("seats", 50)),
    ("أوزان حزب مش بتجمع ١", "data/parliament.json",
     lambda d: d["parties"][1]["drivers"][0].__setitem__("w", 0.9)),
    ("حزب بيهتم بحاجة مش موجودة في اللعبة", "data/parliament.json",
     lambda d: d["parties"][0]["drivers"][0].__setitem__("k", "football")),
    ("نسب الكتل الاجتماعية مش بتجمع ١", "data/parliament.json",
     lambda d: d["blocs"][0].__setitem__("share", 0.10)),
    ("كل الكتل بتحس بالأكل بنفس الدرجة", "data/parliament.json",
     lambda d: [b["sens"].__setitem__("food", 1.0) for b in d["blocs"]]),
    ("تأييد المجلس مالوش أثر على الثبات", "data/parliament.json",
     lambda d: d["backing"].__setitem__("stability_coef", 0)),
    ("تعيين وزير من حزب مالوش أثر", "data/parliament.json",
     lambda d: d.__setitem__("minister_bonus", 0)),
    ("مكافأة الوزير بتشتري الحزب كله", "data/parliament.json",
     lambda d: d.__setitem__("minister_bonus", 9)),
    ("وزير حزبه مش موجود في المجلس", "data/ministers.json",
     lambda d: d["posts"][0]["start"].__setitem__("party", "المحافظ")),
    ("محافظ البنك من عندك مش بيوقّع على أكتر", "data/bank.json",
     lambda d: d["print"].__setitem__("cap_per_lost_independence", 0)),
    ("طبعة المحافظ بتاعك مش بتوجع أكتر", "data/bank.json",
     lambda d: d["print"].__setitem__("inflation_per_lost_independence", 0)),
    ("المحافظ الجديد ممكن يطلع أكتر استقلالًا", "data/bank.json",
     lambda d: d["swap"].__setitem__("new_independence", [18, 90])),
    ("الطباعة كل شهر", "data/bank.json",
     lambda d: d["print"].__setitem__("once_per_months", 0)),
    ("الطباعة تقريبًا ببلاش", "data/bank.json",
     lambda d: d["print"].__setitem__("inflation_per_350", 0.2)),
    ("طبعة واحدة بتنهي اللعبة", "data/bank.json",
     lambda d: d["print"].__setitem__("inflation_per_350", 60)),
    ("تغيير المحافظ ببلاش", "data/bank.json",
     lambda d: d["swap"].__setitem__("ap_cost", 0)),
]

# ministers.json is baked into the bundle, so ANY edit to it also trips the
# "generated file was edited by hand" check — which would make these cases pass
# for a reason that has nothing to do with the ministers. So these rebuild
# first, and each one names the sentence it must see in the output.
MINISTER_CASES = [
    ("خدمة من غير وزير",
     lambda d: d["posts"][4].__setitem__("services", []), "مالهاش وزير"),
    ("خدمة عند وزيرين",
     lambda d: d["posts"][5]["services"].append("health"), "عند وزيرين"),
    ("وزير مربوط بخدمة مش موجودة",
     lambda d: d["posts"][5]["services"].append("nope"), "خدمة مش موجودة"),
    ("منصبين بنفس الـ id",
     lambda d: d["posts"][5].__setitem__("id", "health"), "نفس الـ id"),
    ("رئيس الوزرا اتشال",
     lambda d: d["posts"].__setitem__(0, dict(d["posts"][0], id="chief")), "مفيش رئيس وزراء"),
    ("وزير المالية اتشال",
     lambda d: d["posts"].__setitem__(1, dict(d["posts"][1], id="money")), "مفيش وزير مالية"),
    ("كفاءة وزير برّه المدى",
     lambda d: d["posts"][2]["start"].__setitem__("competence", 99), "برّه المدى"),
    ("الحكومة كلها بقت فاشلة والتوازن مبني على غيرها",
     lambda d: [p["start"].__setitem__("competence", 20) for p in d["posts"]], "الفرق أكبر من ٨"),
    ("كل الوزرا خدوا نفس الوصف",
     lambda d: d.__setitem__("tags", [{"id": "x", "nm": "أي حاجة", "tone": "good",
                                       "comp": [0, 100], "loy": [0, 100]}]),
     "مش بيميّز حد"),
    ("مفيش وزير بيطابق أي وصف",
     lambda d: d.__setitem__("tags", [{"id": "x", "nm": "مستحيل", "tone": "good",
                                       "comp": [99, 100], "loy": [99, 100]}]),
     "الأوصاف في الشاشة ميتة"),
    ("مدى الوصف مقلوب",
     lambda d: d["tags"][0].__setitem__("comp", [90, 10]), "مقلوب أو برّه"),
    ("الإقالة بقت ببلاش",
     lambda d: d["dismiss"].__setitem__("ap_cost", 0), "إقالة ببلاش"),
    ("ينفع تقيل الوزير أول شهر",
     lambda d: d["dismiss"].__setitem__("min_months_in_post", 0), "الاختيار بقى بلا تمن"),
    ("أسوأ مرشح أحسن من أسوأ وزير",
     lambda d: d["dismiss"].__setitem__("comp_range", [60, 88]), "مكسب مضمون"),
    ("أحسن مرشح أوحش من أحسن وزير",
     lambda d: d["dismiss"].__setitem__("comp_range", [34, 70]), "الزرار مالوش لازمة"),
    ("مرشح واحد بس — مش اختيار",
     lambda d: d["dismiss"].__setitem__("candidates", 1), "مش اختيار"),
    ("التعديل الوزاري أغلى من إقالتهم واحد واحد",
     lambda d: d["reshuffle"].__setitem__("ap_cost", 20), "مفيش سبب تعمله"),
    ("التعديل الوزاري بيوجع أقل من إقالة واحد",
     lambda d: d["reshuffle"].__setitem__("stability_hit", 3), "لازم يوجع أكتر"),
    ("التعديل من غير مدة انتظار",
     lambda d: d["reshuffle"].__setitem__("cooldown_months", 0), "هيلف على حكومة مثالية"),
    ("كفاءة رئيس الوزراء مالهاش تأثير على التعديل",
     lambda d: d["reshuffle"].__setitem__("pm_quality_coef", 0), "المنصب بقى ديكور"),
    ("اسمين وزرا متكررين في البداية",
     lambda d: d["posts"][2]["start"].__setitem__("name", d["posts"][1]["start"]["name"]),
     "اسمين وزرا متكررين"),
    ("المقايضة كفاءة/ولاء اتشالت",
     lambda d: d["dismiss"].__setitem__("loy_tradeoff_coef", 0),
     "المقايضة اللي اللعبة قايمة عليها مش موجودة"),
    ("الوزير الجديد بيشتغل بكامل كفاءته فورًا",
     lambda d: d["settling"].__setitem__("start_factor", 1.0),
     "بيشتغل بكامل كفاءته فورًا"),
    ("إقالة وزير ما بتأثرش على باقي الحكومة",
     lambda d: d["dismiss"].__setitem__("others_loyalty_hit", 0),
     "التقليب مالوش تمن متراكم"),
]


# The shell and the back button. Same rule as the ministers cases: any edit to
# ui.js also trips the "generated file edited by hand" check, so these rebuild
# first and each names the sentence it must see.
UI_CASES = [
    ("عامل الخدمة اتكرر تاني",
     lambda s: s.replace("  navigator.serviceWorker.register('sw.js').catch(function () {});",
                         "  navigator.serviceWorker.register('sw.js').catch(function () {});\n"
                         "  navigator.serviceWorker.register('sw.js').catch(function () {});", 1),
     "مكرر"),
    ("زرار الرجوع بتاع الموبايل بطّل يمشي على المكدّس",
     lambda s: s.replace("if (S && backScreen()) return true;", "// removed", 1),
     "هيطلّع اللاعب برّه اللعبة"),
    ("المكدّس اتشال خالص",
     lambda s: s.replace("var stack = [{ s: 'tab'", "var stackk = [{ s: 'tab'", 1),
     "مفيش مكدّس شاشات"),
    ("تاب مالوش شاشة في الجدول",
     lambda s: s.replace("['bank', '🏦', 'البنك']", "['bankx', '🏦', 'البنك']", 1),
     "مالوش شاشة في جدول الشاشات"),
    ("شاشة مفيش زرار بيوصّل لها",
     lambda s: s.replace('data-open="governorate"', 'data-openx="governorate"', 1),
     "مفيش زرار بيفتحها"),
    ("زرار بيفتح شاشة مش موجودة",
     lambda s: s.replace('data-open="governorate"', 'data-open="nope"', 1),
     "مش في جدول الشاشات"),
    ("شاشة من غير دالة رسم ولا كارت «لسه بيتبني»",
     lambda s: s.replace("govt: cabinetBody, ", "", 1),
     "هتطلع صفحة فاضية"),
    ("مقبض بيحرّك حاجة تانية معاه",
     lambda s: s.replace("    if (d.lever === 'tax') S.tax = v;",
                         "    if (d.lever === 'tax') { S.tax = v; S.subsidy = v; }", 1),
     "كمان"),
    ("دفتر الخزينة اختفى منه سطر",
     lambda s: s.replace("+ bookRow('استيراد غذاء', L.importCost, -1)", "", 1),
     "دفتر الخزينة ناقصه سطر"),
    ("كلاس مستخدم في الشاشات ومالوش تنسيق",
     lambda s: s.replace('<div class="lev">', '<div class="levv">', 1),
     "مالوش أي تنسيق"),
    ("رقم بيتقرّب لصفر في ورقة البناء",
     lambda s: s.replace("<b>+' + arDec(sd.adds_monthly, 1)", "<b>+' + ar(sd.adds_monthly)", 1),
     "اتقرّبت لصفر"),
    ("شاشة المحافظة بتوري أرقام الدولة",
     lambda s: s.replace("  govFilter = (e.s === 'governorate') ? e.id : 'all';",
                         "  govFilter = 'all';", 1),
     "مش مظبّطة السياق"),
    ("السياق فاضل على المحافظة بعد الخروج منها",
     lambda s: s.replace("  govFilter = (e.s === 'governorate') ? e.id : 'all';",
                         "  if (e.s === 'governorate') govFilter = e.id;", 1),
     "فضل على المحافظة"),
    ("ورقة البناء من جوّه المحافظة بتعرض غيرها",
     lambda s: s.replace("  var list = only ? [only] : GOV_IDS;", "  var list = GOV_IDS;", 1),
     "بتعرض محافظات تانية"),
]

CSS_CASES = [
    ("سطر راجع تحت حافة الشريط فبيتقص",
     lambda s: s.replace("bottom:8px;font-size:10px", "bottom:-2px;font-size:10px", 1),
     "هيتقص من غير ما حد ياخد باله"),
]


def broken_repo_fails(rel, mutate, as_json, rebuild=False, expect=None):
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        p = work / rel
        if as_json:
            d = json.loads(p.read_text(encoding="utf-8"))
            mutate(d)
            p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            before = p.read_text(encoding="utf-8")
            after = mutate(before)
            if after == before:
                print(f"      ⚠ التعديل المتعمد ما طابقش حاجة في {rel} — الحالة دي بقت فاضية")
                return False
            p.write_text(after, encoding="utf-8")
        if rebuild:
            # Regenerate data first (setup.json is generated), then the bundle.
            for script in ("build_setup_mockup.py", "build_game.py"):
                b = subprocess.run([sys.executable, str(work / "tools" / script)],
                                   capture_output=True, text=True)
                if b.returncode:
                    return True   # a builder refusing to build is a pass too
        # Skip the generated-files check unless this case is about it: it copies
        # the repo and rebuilds four documents, which is half the runtime of the
        # whole suite multiplied by ninety cases. It has its own breakages.
        env = dict(os.environ)
        if rel not in ("docs/balance.html", "docs/app-mockup.html",
                       "docs/setup-mockup.html", "game/index.html"):
            env["CHECK_SKIP"] = "check_generated_files_match"
        r = subprocess.run([sys.executable, str(work / "tools" / "check.py")],
                           capture_output=True, text=True, env=env)
        if r.returncode == 0:
            return False
        # A check that fails for the wrong reason is not a check. When the case
        # says what it expects to read, the exact sentence has to be there.
        return expect is None or expect in (r.stdout + r.stderr)


def main():
    # Every case is an independent repo copy, so they can run side by side. The
    # suite grew to ninety cases and a serial run stopped finishing in time —
    # a check nobody waits for is a check nobody runs.
    jobs = []
    for name, rel, mutate in TEXT_CASES:
        jobs.append((name, rel, mutate, False, False, None))
    for name, rel, mutate in JSON_CASES:
        # balance.json is baked into the bundle, so a case that edits it must
        # rebuild or the game still runs on the old numbers and the case passes
        # for the wrong reason. setup.json is the opposite: it is GENERATED, so
        # rebuilding would wipe the very mutation being tested.
        jobs.append((name, rel, mutate, True, rel == "data/balance.json", None))
    for name, rel, mutate in REBUILD_CASES:
        jobs.append((name, rel, mutate, False, True, None))
    for name, mutate, expect in MINISTER_CASES:
        jobs.append((name, "data/ministers.json", mutate, True, True, expect))
    for name, mutate, expect in UI_CASES:
        jobs.append((name, "game/src/ui.js", mutate, False, True, expect))
    for name, mutate, expect in CSS_CASES:
        jobs.append((name, "game/src/style.css", mutate, False, True, expect))

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(
            lambda j: broken_repo_fails(j[1], j[2], j[3], rebuild=j[4], expect=j[5]), jobs))

    ok = True
    for (name, *_), caught in zip(jobs, results):
        print(f"  {'✓' if caught else '✗'} {name}")
        ok &= caught
    total = len(jobs)
    print()
    if ok:
        print(f"✓ الفاحص مسك كل الأخطاء المتعمدة ({total} خطأ).")
        return 0
    print("✗ فيه خطأ متعمد عدّى من غير ما الفاحص يمسكه — الفاحص نفسه محتاج تصليح.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
