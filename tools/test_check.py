#!/usr/bin/env python3
"""
Tests the checker itself.

A checker that has never failed is not a checker — it is decoration. This
breaks each thing on purpose in a throwaway copy of the repo and asserts that
tools/check.py notices. If someone weakens a check later, this goes red.

Every new check added to check.py should get a deliberate breakage here.
"""
import json, os, re, shutil, subprocess, sys, tempfile
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
    ("اسم الجسر في الجافا مش زي اللي اللعبة بتنده عليه",
     "android/app/src/main/java/com/karim/thegame/MainActivity.java",
     lambda s: s.replace('new Bridge(), "TheGame"', 'new Bridge(), "TheGameX"')),
    ("دالة الجسر مش عليها الوسم اللي بيخليها تتشاف",
     "android/app/src/main/java/com/karim/thegame/MainActivity.java",
     lambda s: s.replace("@JavascriptInterface\n        public void exitApp()",
                         "public void exitApp()")),
    ("الجسر اتشال من التطبيق واللعبة لسه بتنده عليه",
     "android/app/src/main/java/com/karim/thegame/MainActivity.java",
     lambda s: s.replace('web.addJavascriptInterface(new Bridge(), "TheGame");', "")),
    ("زرار الرجوع بينده على دالة مش موجودة", "game/src/ui.js",
     lambda s: s.replace("function onAndroidBack()", "function onAndroidBackX()")),
    # The bug that turned CI red while everything was green here: the fake
    # browser stopped supplying a global the game uses, and the test only
    # survived because the Node on this machine happened to have it.
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
     lambda s: s.replace("    - disloyal - noBacking - suspicion - barracks);",
                         "    - disloyal - suspicion - barracks);")),
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
    ("الشبهة بتتزوّد من غير سقف", "game/src/engine.js",
     lambda t: t.replace("  addHeat(S, amount / 100 * BALANCE.heat.steal_per_100m);",
                         "  S.heat += amount / 100 * BALANCE.heat.steal_per_100m;")),
    ("السرقة بطّلت تزوّد الشبهة", "game/src/engine.js",
     lambda t: t.replace("  addHeat(S, amount / 100 * BALANCE.heat.steal_per_100m);", "")),
    ("الشبهة بطّلت تأثر على الثبات", "game/src/engine.js",
     lambda t: t.replace("    - disloyal - noBacking - suspicion - barracks);",
                         "    - disloyal - noBacking - barracks);")),
    ("الفضايح بقت تتحسب مع المواقف في نفس البوابة", "game/src/engine.js",
     lambda t: t.replace("function pickSituation(S) {\n  return pickOfKind(S, 'scandal') || pickOfKind(S, 'situation');",
                         "function pickSituation(S) {\n  return pickOfKind(S, 'situation');")),
    ("مجموع اللي اتسرق بطّل يتسجّل", "game/src/engine.js",
     lambda t: t.replace("  S.stolenTotal += amount;", "")),
    ("تفكيك الشبهة على الشاشة مش هو الحساب الحقيقي", "game/src/engine.js",
     lambda t: t.replace("  return s.talk - s.media - s.decay;",
                         "  return s.talk - s.media * 2 - s.decay;")),
    ("القمع مش بيتخصم من الخزينة", "game/src/engine.js",
     lambda t: t.replace("  S.treasury -= c.treasury;\n  S.lastCrackdown = S.totalMonths;",
                         "  S.lastCrackdown = S.totalMonths;")),
    ("نظام الحكم بطّل يأثر على نجاح القمع", "game/src/engine.js",
     lambda t: t.replace(" * c.per_competence_point + gov;", " * c.per_competence_point;")),
    ("خطر الانقلاب بيتزوّد من غير سقف", "game/src/engine.js",
     lambda t: t.replace("  S.coupRisk = Math.max(0, Math.min(ARMY.risk_cap, S.coupRisk + coupRiskChange(S)));",
                         "  S.coupRisk += coupRiskChange(S);")),
    ("الجيش بطّل يأثر على الثبات", "game/src/engine.js",
     lambda t: t.replace("    - disloyal - noBacking - suspicion - barracks);",
                         "    - disloyal - noBacking - suspicion);")),
    ("الانقلاب بيحصل من غير تنبيه", "game/src/engine.js",
     lambda t: t.replace("    events.push({ type: 'army', pct: Math.round(S.coupRisk / ARMY.risk_cap * 100),\n                  loyalty: Math.round(army(S)) });", "")),
    ("الرشوة مش بتتخصم من الرصيد الشخصي", "game/src/engine.js",
     lambda t: t.replace("  S.personal -= b.cost;\n", "")),
    ("التحميل بطّل يقارن بصمة البناء", "game/src/engine.js",
     lambda t: t.replace("  if (blob.build !== BUILD) return 'الحفظ ده اتعمل بنسخة تانية من اللعبة';", "")),
    ("التحميل بطّل يقارن إصدار الحفظ", "game/src/engine.js",
     lambda t: t.replace("if (!blob || blob.v !== SAVE_VERSION)", "if (!blob)")),
    ("السجل بطّل يبقى ليه حد", "game/src/engine.js",
     lambda t: t.replace("  if (S.log.length > LOG_KEEP) S.log.splice(0, S.log.length - LOG_KEEP);", "")),
    ("الحفظ بطّل يتأكد إن الوزرا كلهم موجودين", "game/src/engine.js",
     lambda t: t.replace("    if (!S.ministers || !S.ministers[POST_IDS[i]]) return 'الحفظ ناقصه وزير';", "")),
    ("مكان كارت الموقف اتشال من الصفحة", "game/src/index.html",
     lambda s: s.replace('id="sit"', 'id="sitX"', 1)),
    ("الصفحة بتطلب ملف مش موجود", "game/src/index.html",
     lambda s: s.replace('<meta charset="utf-8">',
                         '<meta charset="utf-8">\n<link rel="icon" href="icon-192.png">', 1)),
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
    # Matched by pattern, not by the exact number: this case went dead once when
    # the tribal modifier was retuned, and a breakage that quietly stops
    # breaking anything is worse than no breakage at all.
    ("تركيبة بقت فخ — كفاءة واطية أوي", "tools/build_setup_mockup.py",
     lambda s: re.sub(r'("loyalty": \+15, "competence": )-\d+', r'\g<1>-40', s)),
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
    ("موقف شرطه على حاجة مش موجودة", "data/situations.json",
     lambda d: d["situations"][0]["when"].__setitem__(0, ["weather", "<", 5])),
    ("اختيار بيغيّر حاجة مش موجودة", "data/situations.json",
     lambda d: d["situations"][0]["choices"][0]["effects"].__setitem__("morale", 5)),
    ("موقف كل اختياراته ليها تمن", "data/situations.json",
     lambda d: [c.__setitem__("cost", {"ap": 1}) for c in d["situations"][0]["choices"]]),
    ("موقف فيه اختيار واحد", "data/situations.json",
     lambda d: d["situations"][0].__setitem__("choices", d["situations"][0]["choices"][:1])),
    ("المواقف ممكن تيجي ورا بعض", "data/situations.json",
     lambda d: d["rate"].__setitem__("min_gap_months", 1)),
    ("مواقف كتير أوي في السنة", "data/situations.json",
     lambda d: d["rate"].__setitem__("max_per_year", 12)),
    ("موقف وزنه صفر", "data/situations.json",
     lambda d: d["situations"][0].__setitem__("weight", 0)),
    # ---- الشبهة والفضايح
    ("فضيحة شرطها مش على الشبهة", "data/situations.json",
     lambda d: [x for x in d["situations"] if x.get("kind") == "scandal"][0]
        .__setitem__("when", [["approval", "<", 40]])),
    ("فضيحة عايزة شبهة فوق السقف", "data/situations.json",
     lambda d: [x for x in d["situations"] if x.get("kind") == "scandal"][0]
        .__setitem__("when", [["heat", ">", 400]])),
    ("كل الفضايح فوق الخط المعلن", "data/situations.json",
     lambda d: [x.__setitem__("when", [["heat", ">", 95]])
                for x in d["situations"] if x.get("kind") == "scandal"]),
    ("مفيش بوابة معدّل للفضايح", "data/situations.json",
     lambda d: d.pop("scandal_rate")),
    ("الفضايح والمواقف مع بعض بيقاطعوا كتير أوي", "data/situations.json",
     lambda d: d["scandal_rate"].__setitem__("max_per_year", 5)),
    ("الفضايح بتيجي ورا بعض أسرع من المواقف", "data/situations.json",
     lambda d: d["scandal_rate"].__setitem__("min_gap_months", 2)),
    ("مفيش ولا فضيحة شرطها إن اللاعب سرق", "data/situations.json",
     lambda d: [x.__setitem__("when", [c for c in x["when"] if c[0] != "stolenTotal"])
                for x in d["situations"] if x.get("kind") == "scandal"]),
    ("الشبهة مبتنزلش لوحدها", "data/balance.json",
     lambda d: d["heat"].__setitem__("monthly_decay", 0)),
    ("الشبهة بتعلى لوحدها مهما عملت", "data/balance.json",
     lambda d: d["heat"].__setitem__("disloyal_coef", 0.9)),
    ("وزير إعلام واحد بيلغي كل حاجة", "data/balance.json",
     lambda d: d["heat"].__setitem__("media_coef", 2.0)),
    ("خط الفضيحة فوق السقف", "data/balance.json",
     lambda d: d["heat"].__setitem__("scandal_at", 140)),
    ("السرقة شبهتها أقل من طباعة الفلوس", "data/balance.json",
     lambda d: d["heat"].__setitem__("steal_per_100m", 0.5)),
    # ---- القمع
    ("القمع الفاشل مش بيزوّد الغليان", "data/crackdown.json",
     lambda d: d["fail"].__setitem__("boil", 0)),
    ("القمع الفاشل تمنه زي الناجح", "data/crackdown.json",
     lambda d: d["fail"].__setitem__("approval", d["win"]["approval"])),
    ("القمع الناجح مش بينزّل الغليان", "data/crackdown.json",
     lambda d: d["win"].__setitem__("boil", 0)),
    ("ينفع تقمع شارع هادي", "data/crackdown.json",
     lambda d: d.__setitem__("boil_floor", 0)),
    ("ينفع تقمع كل شهر", "data/crackdown.json",
     lambda d: d["cost"].__setitem__("once_per_months", 0)),
    ("القمع بينجح بنفس النسبة في كل الأنظمة", "data/crackdown.json",
     lambda d: d.__setitem__("success_by_government",
                             {k: 0 for k in d["success_by_government"]})),
    ("القمع مش بينجح عند الديكتاتوري أكتر", "data/crackdown.json",
     lambda d: d["success_by_government"].__setitem__("dictator", -20)),
    ("القمع مضمون حتى مع أسوأ وزير داخلية", "data/crackdown.json",
     lambda d: d["success"].__setitem__("min_pct", 80)),
    # ---- الجيش
    ("خطر الانقلاب مبينزلش أبدًا", "data/army.json",
     lambda d: d.__setitem__("risk_decay_above", 0)),
    ("الجيش بينقلب بعد شهرين من الإهمال", "data/army.json",
     lambda d: d.__setitem__("risk_per_point_below", 4.5)),
    ("إهمال الجيش عمره ما بيوصل لانقلاب", "data/army.json",
     lambda d: d.__setitem__("risk_per_point_below", 0.01)),
    ("الرشوة مش بترفع ولاء حد", "data/army.json",
     lambda d: d["bribe"].__setitem__("loyalty_gain", 0)),
    ("الرشوة ببلاش", "data/army.json",
     lambda d: d["bribe"].__setitem__("cost", 0)),
    ("ضياع الرشوة مالوش أي معنى", "data/army.json",
     lambda d: d["bribe"].__setitem__("lost_loyalty_gain", d["bribe"]["loyalty_gain"])),
    ("الرشوة ممكن تضيع ١٠٠٪", "data/army.json",
     lambda d: d["bribe"].__setitem__("lost_max_pct", 100)),
    ("ينفع تدفع للجيش كل شهر", "data/army.json",
     lambda d: d["bribe"].__setitem__("once_per_months", 0)),
    ("وصف الوزير بيقول كفاءته بتعمل حاجة والمحرك مش بيقراها", "data/ministers.json",
     lambda d: [p.__setitem__("note", "كفاءته بتحمي البلد من الغزو")
                for p in d["posts"] if p["id"] == "defence"]),
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
     "كفء وموالي في نفس الوقت"),
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
def paste_a_function_twice(src):
    """The real accident, reproduced: a whole function pasted in a second time
    under another name. Derived from the file instead of written out here, so
    the case cannot go stale the way a hand-copied block would."""
    i = src.index("function coupCard() {")
    j = src.index("\n}\n", i) + 3
    twin = src[i:j].replace("function coupCard()", "function coupCardTwin()", 1)
    return src[:i] + twin + "\n" + src[i:]


def hide_the_failure_case(src):
    """The button that advertises only its good outcome. Written as a function
    because the row is three lines of string concatenation and a hand-copied
    copy of it here would go stale the first time the wording changed."""
    start = src.index("    + '<div class=\"cr2\"><span>\u0644\u0648 \u0641\u0634\u0644</span>")
    end = src.index("\n", src.index("ar(c.fail.heat)", start))
    return src[:start] + "    + ''" + src[end:]


def drop_click(name):
    """Removes one entry from the click handler's list of known attributes,
    wherever it sits in it. Written as a regex rather than a literal line
    because the list is re-wrapped every time a button is added, and a literal
    copy of it here goes stale — silently, since a case that matches nothing
    stops testing anything."""
    def go(src):
        out = re.sub(r"'" + name + r"',\s*", "", src, count=1)
        if out == src:
            out = re.sub(r",\s*'" + name + r"'", "", src, count=1)
        return out
    return go


def drop_from_draw_game(src):
    """Takes drawSituation() out of drawGame, however drawGame is laid out."""
    i = src.index("function drawGame()")
    j = src.index("\n}", i)
    return src[:i] + src[i:j].replace("drawSituation();", "", 1) + src[j:]


UI_CASES = [
    ("تركيب الرسومات اتكرر",
     lambda s: s.replace("el('artdefs').innerHTML = ART_DEFS;",
                         "el('artdefs').innerHTML = ART_DEFS;\nel('artdefs').innerHTML = ART_DEFS;", 1),
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
    # ---- the situation card: every escape hatch, one at a time -------------
    ("كارت الموقف بقى فيه زرار قفل",
     lambda s: s.replace("  h += '<div class=\"must\">' + (bad",
                         "  h += '<button data-close=\"1\">✕</button>';\n  h += '<div class=\"must\">' + (bad", 1),
     "باب خروج من غير قرار"),
    ("زرار الرجوع بتاع الموبايل بطّل يحسب حساب الموقف",
     lambda s: s.replace("  if (S && S.pendingSituation) return true;\n  var ovl = el('ovl');",
                         "  var ovl = el('ovl');", 1),
     "قرار مفروض إجباري"),
    ("الوقت ينفع يمشي والموقف لسه مفتوح",
     lambda s: s.replace("  if (v && S && S.pendingSituation) return;\n", "", 1),
     "الوقف بيتلغي من غير قرار"),
    ("الكارت مش بيترسم مع كل تحديث",
     drop_from_draw_game,
     "مش هيترسم مع كل تحديث"),
    ("الواجهة بقت تمسح الموقف بنفسها",
     lambda s: s.replace("function closeSheet() { el('ovl')",
                         "function closeSheet() { if (S) S.pendingSituation = null; el('ovl')", 1),
     "المحرك بس هو اللي يقفل الموقف"),
    ("زرار الإجابة مش مسجّل في قايمة الضغطات",
     drop_click("data-answer"),
     "مش مسجّل في قايمة الضغطات"),
    ("تمن من الخزينة مش بيتكتب على الزرار",
     lambda s: s.replace("  treasury: function (n) { return ar(n) + 'م من الخزينة'; },\n", "", 1),
     "هيبان مجاني وياخد الفلوس"),
    ("الشاشة بتكتب تمن المحرك مش بيخصمه",
     lambda s: s.replace("  personal: function (n) {", "  fame: function (n) {", 1),
     "ما اتدفعتش"),
    # These two pass check.py's reading of the file and are caught by the game's
    # own run instead — the card renders, it just renders wrong.
    ("الكارت بيتبني وبيفضل مخفي",
     lambda s: s.replace("  box.innerHTML = h;\n  box.classList.remove('hidden');",
                         "  box.innerHTML = h;", 1),
     "الكارت مش بيظهر"),
    ("كل الاختيارات بتقول ببلاش",
     lambda s: s.replace("  if (!parts.length) return '<span class=\"ofree\">ببلاش</span>';\n  return parts.join('<br>');",
                         "  return '<span class=\"ofree\">ببلاش</span>';", 1),
     "بيقول ببلاش"),
    ("بلوك كامل اتلزق مرتين", paste_a_function_twice, "مكرّرة"),
    ("فاصلة إنجليزي في نص عربي",
     lambda t: t.replace("'، يعني خطر الانقلاب بيزيد '", "', يعني خطر الانقلاب بيزيد '", 1),
     "فاصلة إنجليزي"),
    ("الحفظ بطّل يتكتب من drawGame",
     lambda t: t.replace("  persist();\n}", "}", 1),
     "هتضيع"),
    ("الحفظ بيفضل موجود بعد ما اللاعب يموت",
     lambda t: t.replace("  if (S.dead) { storeSet(SAVE_KEY, null); return; }", ""),
     "اقفل التطبيق وافتحه تاني"),
    ("التخزين بقى من غير حماية",
     lambda t: t.replace("  try { return window.localStorage.getItem(key); } catch (e) { return null; }",
                         "  return window.localStorage.getItem(key);"),
     "تطبيق ميت"),
    ("المسح بيحصل من غير سؤال تأكيد",
     lambda t: t.replace("  else if (what === 'wipe') { openWipe(); }",
                         "  else if (what === 'wipe') { storeSet(SAVE_KEY, null); drawMenu(); }"),
     "من غير سؤال تأكيد"),
    ("زرار «كمّل» بيبدأ لعبة جديدة",
     lambda t: t.replace("    S = saved;\n    speed = prefs.speed;", "    S = newGame(setupState);\n    speed = prefs.speed;"),
     "كمّلت ورجعت لشهر تاني"),
    ("شاشة البداية بترجع تكتب خط الجيش بالإيد",
     lambda t: t.replace("+ 'وخطك ' + ar(ARMY.line_by_government.dictator) + ' مش '",
                         "+ 'وزير الدفاع تحت ٤٠ · وخطك ' + ar(ARMY.line_by_government.dictator) + ' مش '", 1),
     "بالإيد"),
    ("زرار القمع مش مسجّل في قايمة الضغطات",
     drop_click("data-crack"),
     "مش مسجّل في قايمة الضغطات"),
    ("الكارت مش بيقول بيحصل إيه لو القمع فشل", hide_the_failure_case, "لو فشل"),
    ("زرار الرشوة مش مسجّل في قايمة الضغطات",
     drop_click("data-bribe"),
     "مش مسجّل في قايمة الضغطات"),
    ("احتمال ضياع الرشوة مش مكتوب على الزرار",
     lambda t: t.replace("bribeLostChance(S)", "0", 1),
     "خطر مستخبي"),
    ("كارت الجيش اتشال من تاب الرئاسة",
     lambda t: t.replace("    h += coupCard();", "", 1),
     "بيوصّل لوزير الدفاع"),
    ("الشبهة اتشالت من الشريط العلوي",
     lambda t: re.sub(r"\n *\['الشبهة',[^\n]*\],", "", t, count=1),
     "مؤشر والشبكة"),
    ("الشاشة بطّلت توري الشبهة جاية منين",
     lambda t: t.replace("heatSources(S)", "0 && 0 || ({talk:0,talkers:0,media:0,decay:0})"),
     "جاية منين"),
    ("الفضيحة بقت شكلها زي أي موقف عادي",
     lambda t: t.replace("  var bad = (sit.kind === 'scandal');", "  var bad = false;", 1),
     "مش مميّزة"),
    ("السياق فاضل على المحافظة بعد الخروج منها",
     lambda s: s.replace("  govFilter = (e.s === 'governorate') ? e.id : 'all';",
                         "  if (e.s === 'governorate') govFilter = e.id;", 1),
     "فضل على المحافظة"),
    ("ورقة البناء من جوّه المحافظة بتعرض غيرها",
     lambda s: s.replace("  var list = only ? [only] : GOV_IDS;", "  var list = GOV_IDS;", 1),
     "بتعرض محافظات تانية"),
]

CSS_CASES = [
    ("حالة على عنصر وليها قاعدة صندوق لوحدها",
     lambda t: t.replace(".mtr.alarm{", ".mtr.danger{", 1),
     "هيترسم بشكل الحاجة التانية"),
    ("كلاس اتعرّف مرتين لحاجتين مختلفتين",
     lambda t: t.replace(".sopt{width:100%", ".opt{width:100%", 1),
     "متعرّف 2 مرة"),
    ("مؤشر زيادة والشبكة زي ما هي",
     lambda t: t.replace("grid-template-columns:repeat(5,1fr)",
                         "grid-template-columns:repeat(4,1fr)", 1),
     "هينزل سطر تاني"),
    ("سطر راجع تحت حافة الشريط فبيتقص",
     lambda s: s.replace("bottom:8px;font-size:10px", "bottom:-2px;font-size:10px", 1),
     "هيتقص من غير ما حد ياخد باله"),
]


def required_file_missing():
    """A file the project cannot work without, deleted. This is not a mutation —
    there is nothing to change, only something to remove — and it is the exact
    accident that turned one build red with seven unreadable Python errors."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        (work / "index.html").unlink()
        env = dict(os.environ); env["CHECK_SKIP"] = "check_generated_files_match"
        r = subprocess.run([sys.executable, str(work / "tools" / "check.py")],
                           capture_output=True, text=True, env=env)
        return r.returncode != 0 and "مش موجود في المشروع خالص" in r.stdout


def retired_file_returns():
    """A deleted file coming back is its own kind of breakage: nothing to mutate,
    something to create."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        (work / "game" / "sw.js").write_text("// عاد من الموت\n", encoding="utf-8")
        env = dict(os.environ); env["CHECK_SKIP"] = "check_generated_files_match"
        r = subprocess.run([sys.executable, str(work / "tools" / "check.py")],
                           capture_output=True, text=True, env=env)
        return r.returncode != 0 and "رجع تاني" in r.stdout


def stray_root_copy():
    """And a tools/ script appearing at the repo root — the browser-upload
    mistake that turned the build red for two rounds while the real file in
    tools/ stayed stale."""
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        shutil.copy(work / "tools" / "check.py", work / "check.py")
        env = dict(os.environ); env["CHECK_SKIP"] = "check_generated_files_match"
        r = subprocess.run([sys.executable, str(work / "tools" / "check.py")],
                           capture_output=True, text=True, env=env)
        return r.returncode != 0 and "جذر المشروع" in r.stdout


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
        jobs.append((name, rel, mutate, True,
                     rel != "data/setup.json", None))
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

    extra = [("ملف أساسي اتمسح من المشروع", required_file_missing()),
             ("ملف من اللي اتشالوا رجع", retired_file_returns()),
             ("نسخة من ملف tools في جذر المشروع", stray_root_copy())]

    ok = True
    for (name, *_), caught in zip(jobs, results):
        print(f"  {'✓' if caught else '✗'} {name}")
        ok &= caught
    for name, caught in extra:
        print(f"  {'✓' if caught else '✗'} {name}")
        ok &= caught
    total = len(jobs) + len(extra)
    print()
    if ok:
        print(f"✓ الفاحص مسك كل الأخطاء المتعمدة ({total} خطأ).")
        return 0
    print("✗ فيه خطأ متعمد عدّى من غير ما الفاحص يمسكه — الفاحص نفسه محتاج تصليح.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
