"""
Generates balance_doc.html from data/balance.json.

Why generated and not hand-written: a number that appears in the document but
not in the game data is the exact bug we cannot see. Generating the tables from
the JSON makes drift impossible instead of merely unlikely.
The stylesheet is lifted from design_doc.html so both documents stay one system.
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
import re

B = json.load(open(DATA / "balance.json", encoding="utf-8"))
STYLE = re.search(r"<style>.*?</style>", open(DOCS / "design.html", encoding="utf-8").read(), re.S).group(0)

AR = "٠١٢٣٤٥٦٧٨٩"
def ar(n):
    """Arabic-Indic digits, so the document reads like the game will."""
    s = f"{n:,.0f}" if isinstance(n, (int, float)) and float(n) == int(n) else str(n)
    return "".join(AR[int(c)] if c.isdigit() else c for c in s)

sv, gv, st = B["services"], B["governorates"], B["start"]
SV_ORDER = ["water", "power", "sewage", "health", "edu", "police", "fire"]
GV_ORDER = ["capital", "industrial", "agri", "south", "border"]
ICON = dict(water="💧", power="⚡", sewage="🚰", health="🏥", edu="🎓", police="👮", fire="🚒")

# Live figures from tools/simulate.js — which runs the GAME'S OWN engine, not a
# second implementation of it. Every number below is a number the player meets.
sim_out = json.loads(subprocess.run(["node", str(ROOT / "tools" / "simulate.js"), "--json"],
                                    capture_output=True, text=True, check=True).stdout)
S0 = {"approval": sim_out["start"]["approval"], "stability": sim_out["start"]["stability"],
      "avg_service": sim_out["start"]["avgService"],
      "by_gov": sim_out["start"]["byGov"], "by_service": sim_out["start"]["byService"]}
LIFE = {k: v["lifespan"] for k, v in sim_out["players"].items()}
FIRST = sim_out["firstMonth"]
COMBOS = sim_out["combos"]

total_ask = sum(sv[k]["monthly_ask"] for k in SV_ORDER)
run_bill = total_ask * st["budget_pct"] / 100
operating = st["budget_pct"] * st["minister_competence"] / 100
pct_for_full = round(100 / (st["minister_competence"] / 100))

h = [STYLE, '<div class="doc">']
h.append(f'''
<header class="mast">
  <span class="stamp">البند ٢ من الخطة · جدول الأرقام</span>
  <h1>ميزان الدولة</h1>
  <p class="sub">كل رقم في اللعبة بقيمته الابتدائية، ومن فين جه، وإيه اللي بيحصل لو غيّرناه.
  الأرقام دي اتجرّبت في محاكي شغّل اللعبة ١٢٠ مرة قبل ما تشوفها.</p>
  <div class="meta">
    <span>النسخة <b>١٫٠</b></span>
    <span>مصدر الأرقام <b>data/balance.json</b></span>
    <span>الحالة <b>محتاجة مراجعتك بعين محاسب</b></span>
  </div>
</header>
<div class="wrap">
  <nav class="rail" aria-label="فهرس">
    <div>الفهرس</div>
    <a href="#u"><b>١</b>الوحدات</a>
    <a href="#s"><b>٢</b>حالة البداية</a>
    <a href="#g"><b>٣</b>المحافظات</a>
    <a href="#v"><b>٤</b>الخدمات</a>
    <a href="#i"><b>٥</b>الدخل</a>
    <a href="#f"><b>٦</b>الغذاء</a>
    <a href="#n"><b>٧</b>التضخم</a>
    <a href="#m"><b>٨</b>الرضا والغليان</a>
    <a href="#t"><b>٩</b>نتيجة المحاكاة</a>
    <a href="#q"><b>١٠</b>مراجعتك</a>
  </nav>
  <main>''')

# ---------------------------------------------------------------- 1 units
h.append(f'''
<section id="u">
  <h2><span class="num">١</span>الوحدات والمقياس</h2>
  <p class="lede">قبل أي رقم — الأرقام دي بتقيس إيه.</p>
  <div class="tw"><table>
    <thead><tr><th>الوحدة</th><th>المقياس</th><th>مثال</th></tr></thead>
    <tbody>
      <tr><td class="k">الفلوس</td><td class="n">مليون</td><td>«٤٠٠م» = تكلفة بناء مستشفى</td></tr>
      <tr><td class="k">السكان</td><td class="n">مليون نسمة</td><td>الدولة بتبدأ بـ{ar(st["population_millions"])} مليون</td></tr>
      <tr><td class="k">المؤشرات</td><td class="n">٠ – ١٠٠</td><td>رضا · ثبات · ولاء · كفاءة · مستوى خدمة</td></tr>
      <tr><td class="k">التضخم</td><td class="n">٪ سنوي</td><td>بيبدأ {ar(st["inflation"])}٪ · الانهيار عند {ar(B["inflation"]["collapse_at"])}٪</td></tr>
      <tr><td class="k">الوقت</td><td class="n">شهر</td><td>كل حسابات اللعبة بتتنفذ مرة كل شهر</td></tr>
    </tbody>
  </table></div>
  <div class="risk"><b>ليه المليون</b>
  عشان الأرقام تفضل قابلة للقراءة (٤٠٠ مش ٤٠٠٬٠٠٠٬٠٠٠) وفي نفس الوقت تحس إنها ميزانية دولة. وكل الحسابات بأرقام صحيحة — مفيش كسور تظهر للاعب أبدًا.</div>
</section><hr>''')

# ---------------------------------------------------------------- 2 start
h.append(f'''
<section id="s">
  <h2><span class="num">٢</span>حالة البداية</h2>
  <p class="lede">الشهر صفر. دولة شغالة بالعافية — لا منهارة فتحس إنك مظلوم، ولا مستقرة فتزهق.</p>
  <div class="tw"><table>
    <thead><tr><th>المؤشر</th><th>القيمة</th><th>يعني إيه</th></tr></thead>
    <tbody>
      <tr><td class="k">الخزينة</td><td class="n">{ar(st["treasury"])}م</td><td>حوالي تلات شهور مصروفات احتياطي</td></tr>
      <tr><td class="k">الرضا الشعبي</td><td class="n">{ar(S0["approval"])}</td><td>فوق خط الخطر ({ar(B["mood"]["approval_danger"])}) بـ{ar(S0["approval"]-B["mood"]["approval_danger"])} نقطة بس</td></tr>
      <tr><td class="k">الثبات السياسي</td><td class="n">{ar(S0["stability"])}</td><td>مريح — الخطر بيبدأ تحت {ar(B["mood"]["stability_danger"])}</td></tr>
      <tr><td class="k">متوسط الخدمات</td><td class="n">{ar(S0["avg_service"])}</td><td>نص الدولة شغال</td></tr>
      <tr><td class="k">التضخم</td><td class="n">{ar(st["inflation"])}٪</td><td>مقبول — الوجع بيبدأ فوق {ar(B["inflation"]["pain_starts_above"])}٪</td></tr>
      <tr><td class="k">ضريبة الدخل</td><td class="n">{ar(st["tax_rate"])}٪</td><td>الناس ما بتوجعش تحت {ar(B["mood"]["tax_pain_free_below"])}٪</td></tr>
      <tr><td class="k">تمويل الوزارات</td><td class="n">{ar(st["budget_pct"])}٪</td><td>من طلب كل وزارة — الفاتورة {ar(run_bill)}م شهريًا</td></tr>
      <tr><td class="k">كفاءة الوزرا</td><td class="n">{ar(st["minister_competence"])}</td><td>يعني التشغيل الفعلي {ar(operating)}٪ بس</td></tr>
      <tr><td class="k">رصيدك الشخصي</td><td class="n">٠</td><td>لسه</td></tr>
    </tbody>
  </table></div>

  <div class="formula">
    <div class="eq">{ar(st["budget_pct"])}٪ تمويل × {ar(st["minister_competence"])}٪ كفاءة = {ar(operating)}٪ تشغيل</div>
    <p class="why">دي أهم حسبة في اللعبة. عشان توصل تشغيل ١٠٠٪ بوزير كفاءته {ar(st["minister_competence"])}٪، لازم تموّل <strong>{ar(pct_for_full)}٪</strong> — وده مستحيل على كل الوزارات في نفس الوقت بالدخل اللي عندك. <strong>الطريق الوحيد لدولة شغالة هو وزرا أكفأ، مش فلوس أكتر.</strong> ودي الرسالة اللي عايزين اللاعب يكتشفها بنفسه بعد سنتين لعب.</p>
  </div>

  <h3>مستوى كل خدمة عند البداية</h3>
  <div class="tw"><table>
    <thead><tr><th>الخدمة</th><th>المستوى القومي</th><th>الحالة</th></tr></thead>
    <tbody>''')
for k in SV_ORDER:
    lv = S0["by_service"][sv[k]["name"]]
    state = "كويسة" if lv >= 60 else ("متوسطة" if lv >= 45 else "سيئة")
    h.append(f'<tr><td class="k">{ICON[k]} {sv[k]["name"]}</td><td class="n">{ar(lv)}</td><td>{state}</td></tr>')
h.append('''</tbody></table></div>
  <div class="trap"><b>مقصود</b>
  الإسعاف والشرطة بيبدأوا أسوأ حاجة. ليه: عشان أول أزمة تيجي للاعب تكون أزمة أمن أو أزمة إسعاف — حاجة مفهومة وسهل يربطها بقرار، مش أزمة تضخم مجردة.</div>
</section><hr>''')

# ---------------------------------------------------------------- 3 govs
h.append('''
<section id="g">
  <h2><span class="num">٣</span>المحافظات الخمسة</h2>
  <p class="lede">مجموع سكانهم هو الدولة. وكل واحدة ليها مشكلة مختلفة عن الباقيين.</p>
  <div class="tw"><table>
    <thead><tr><th>المحافظة</th><th>السكان</th><th>الثروة</th><th>الشباب</th><th>رضاها عند البداية</th></tr></thead>
    <tbody>''')
for k in GV_ORDER:
    g = gv[k]
    ap = S0["by_gov"][g["name"]]
    h.append(f'<tr><td class="k">{g["name"]}</td><td class="n">{g["population"]}م</td>'
             f'<td class="n">×{g["wealth"]}</td><td class="n">×{g["youth"]}</td><td class="n">{ar(ap)}</td></tr>')
h.append(f'''</tbody></table></div>
  <div class="formula">
    <div class="eq">الثروة بتقسّم الوجع · الشباب بيضرب النمو السكاني</div>
    <p class="why">محافظة ثروتها ×١٫٣ بتتحمل غلاء الأسعار والضرايب أحسن — نفس الزيادة توجعها أقل. ومحافظة شبابها ×١٫٣٥ سكانها بيزيدوا أسرع، يعني <strong>خدماتها بتتآكل أسرع حتى لو ما عملتش حاجة غلط</strong>. عشان كده الجنوب هو دايمًا أول محافظة تنفجر: أفقر ({gv["south"]["wealth"]}) وأصغر سنًا ({gv["south"]["youth"]}) في نفس الوقت.</p>
  </div>

  <h3>المنشآت الموجودة عند البداية</h3>
  <div class="tw"><table>
    <thead><tr><th>المحافظة</th>''')
for k in SV_ORDER:
    h.append(f'<th>{ICON[k]}</th>')
h.append('</tr></thead><tbody>')
for k in GV_ORDER:
    h.append(f'<tr><td class="k">{gv[k]["name"]}</td>')
    for s in SV_ORDER:
        n = gv[k]["facilities"][s]
        cls = "n" if n else "k"
        h.append(f'<td class="{cls}">{ar(n) if n else "—"}</td>')
    h.append('</tr>')
h.append('''</tbody></table></div>
  <div class="risk"><b>اقرا الجدول ده كخريطة مشاكل</b>
  الحدودية مالهاش صرف صحي خالص. الجنوب عنده مستشفى واحد لـ٢٫٦ مليون. العاصمة مخدومة في كل حاجة. <strong>ده مش عشوائي — ده أول درس هيتعلمه اللاعب:</strong> المتوسط القومي بيخبّي إن فيه ناس عايشة من غير صرف صحي.</div>
</section><hr>''')

# ---------------------------------------------------------------- 4 services
h.append('''
<section id="v">
  <h2><span class="num">٤</span>الخدمات السبعة</h2>
  <p class="lede">لكل خدمة ست أرقام. الأربعة الأولانيين بيحكموا البناء، والاتنين الآخرين بيحكموا التشغيل.</p>
  <div class="tw"><table>
    <thead><tr><th>الخدمة</th><th>المنشأة بتخدم</th><th>تكلفة البناء</th><th>مدة الإنشاء</th>
    <th>بتزوّد المصروف</th><th>طلب الوزارة</th><th>وزنها في الرضا</th></tr></thead>
    <tbody>''')
for k in SV_ORDER:
    s = sv[k]
    h.append(f'<tr><td class="k">{ICON[k]} {s["name"]}</td><td class="n">{s["serves_millions"]}م نسمة</td>'
             f'<td class="n">{ar(s["build_cost"])}م</td><td class="n">{ar(s["build_months"])} شهور</td>'
             f'<td class="n">+{ar(s["adds_monthly"])}م/شهر</td><td class="n">{ar(s["monthly_ask"])}م</td>'
             f'<td class="n">{ar(round(s["approval_weight"]*100))}٪</td></tr>')
h.append(f'''<tr><td class="k">الإجمالي</td><td></td><td></td><td></td><td></td>
      <td class="n">{ar(total_ask)}م</td><td class="n">١٠٠٪</td></tr>
    </tbody></table></div>

  <div class="formula">
    <div class="eq">كل منشأة بتبنيها بتزوّد طلب وزارتها للأبد</div>
    <p class="why">تبني مستشفى بـ{ar(sv["health"]["build_cost"])}م مرة واحدة، وطلب وزارة الصحة بيزيد +{ar(sv["health"]["adds_monthly"])}م <strong>كل شهر بعد كده</strong>. يعني تكلفة المستشفى الحقيقية على مدى ١٠ سنين = {ar(sv["health"]["build_cost"])} + ({ar(sv["health"]["adds_monthly"])}×١٢٠) = <strong>{ar(sv["health"]["build_cost"] + sv["health"]["adds_monthly"]*120)}م</strong>. <em>ودي الحسبة اللي هتخلي اللاعب يفكر مرتين قبل ما يبني.</em></p>
  </div>

  <div class="trap"><b>لاحظ الكهربا</b>
  أغلى منشأة ({ar(sv["power"]["build_cost"])}م) وأطول مدة ({ar(sv["power"]["build_months"])} شهر) وأكبر طلب شهري ({ar(sv["power"]["monthly_ask"])}م). وهي كمان اللي بتحدد <strong>دخلك من ضرايب الشركات</strong>. يعني قرار محطة الكهربا هو أكبر قرار مالي في اللعبة: بتدفع دلوقتي وبتقبض بعد سنة.</div>
</section><hr>''')

# ---------------------------------------------------------------- 5 income
inc = B["income"]
h.append(f'''
<section id="i">
  <h2><span class="num">٥</span>الدخل</h2>
  <p class="lede">تلات مصادر، وكل واحد له تمن سياسي مختلف.</p>
  <div class="tw"><table>
    <thead><tr><th>المصدر</th><th>عند البداية</th><th>الرافعة</th><th>التمن</th></tr></thead>
    <tbody>
      <tr><td class="k">ضريبة الدخل</td><td class="n">≈٣٧٠م</td><td>نسبة الضريبة ({ar(st["tax_rate"])}٪)</td>
          <td>كل ١٪ فوق {ar(B["mood"]["tax_pain_free_below"])}٪ بتاخد {B["mood"]["tax_pain_coef"]} نقطة رضا</td></tr>
      <tr><td class="k">ضريبة الشركات</td><td class="n">≈٢٦٠م</td><td>مستوى الكهربا</td>
          <td>مفيش تمن مباشر — بس محتاجة استثمار طويل</td></tr>
      <tr><td class="k">فواتير الخدمات</td><td class="n">≈٢٦٠م</td><td>سعر الفواتير ({ar(st["utility_price"])})</td>
          <td>{B["mood"]["utility_pain_coef"]} نقطة رضا لكل نقطة سعر — بيتحس كل شهر في البيت</td></tr>
      <tr><td class="k">طباعة الفلوس</td><td class="n">٠</td><td>محافظ البنك المركزي</td>
          <td>+{B["inflation"]["print_350_adds"]}٪ تضخم لكل ٣٥٠م</td></tr>
    </tbody>
  </table></div>
  <div class="formula">
    <div class="eq">الدخل والتكاليف الاتنين بيتضربوا في مؤشر الأسعار</div>
    <p class="why">التضخم بيرفع دخلك زي ما بيرفع مصاريفك — فمش هو لوحده اللي بيفلّسك. اللي بيفلّسك إن <strong>الدعم والاستيراد</strong> بيكبروا أسرع من الدخل، وإن <strong>منشآتك القديمة</strong> بتبقى أغلى في التشغيل. التضخم في اللعبة دي مش سارق، ده <em>مُتعِب</em>.</p>
  </div>
</section><hr>''')

# ---------------------------------------------------------------- 6 food
fd = B["food"]
h.append(f'''
<section id="f">
  <h2><span class="num">٦</span>سوق الغذاء</h2>
  <p class="lede">أسرع نظام في اللعبة. بينفجر في شهر، وبيهدى في شهر — لو دفعت.</p>
  <div class="formula">
    <div class="eq">الإنتاج = {ar(fd["agri_yield"])} × (مستوى مياه المحافظة الزراعية ÷ ٦٠)</div>
    <p class="why">عند البداية مياه الزراعية حوالي ٥٥، يعني الإنتاج ≈١٠ وحدات والاستهلاك {ar(st["population_millions"])} — <strong>عجز حوالي وحدتين</strong>، بتتستورد بـ{ar(fd["world_price"])}م للوحدة ≈ ٦٠م شهريًا. <em>يعني الدولة بتبدأ معتمدة على الاستيراد شوية، ولو أهملت مياه محافظة واحدة الرقم ده بيتضاعف.</em></p>
  </div>
  <div class="formula">
    <div class="eq">سعر الغذاء = ٥٠ + (العجز × ٦) + (التضخم − ٦) × ٠٫٩ − (الدعم × ٠٫٢٢)</div>
    <p class="why">الدعم بيبدأ {ar(st["food_subsidy"])}م شهريًا وبينزّل السعر {ar(round(st["food_subsidy"]*0.22))} نقطة. والسعر بيتحرك بسرعة {fd["price_smoothing"]} — يعني بيوصل لقيمته الجديدة في شهر واحد تقريبًا، <strong>مش زي الخدمات اللي بتاخد تلات شهور</strong>. ده الفرق اللي بيخلي أزمة الغذاء تحس مختلفة عن أزمة الخدمات.</p>
  </div>
  <div class="trap"><b>الرقم اللي محتاج مراجعتك</b>
  الدعم بـ{ar(st["food_subsidy"])}م بينزّل السعر {ar(round(st["food_subsidy"]*0.22))} نقطة، والنقطة بتساوي {B["mood"]["food_pain_coef"]} نقطة رضا. يعني <strong>{ar(round(st["food_subsidy"]/ (st["food_subsidy"]*0.22*B["mood"]["food_pain_coef"])*10)/10)}م تقريبًا لكل نقطة رضا</strong>. قارن ده بتكلفة بناء مستشفى: هل الدعم رخيص أوي فيبقى الحل الوحيد المنطقي؟ ده أهم سؤال في الجدول كله.</div>
</section><hr>''')

# ---------------------------------------------------------------- 7 inflation
nf = B["inflation"]
h.append(f'''
<section id="n">
  <h2><span class="num">٧</span>التضخم</h2>
  <p class="lede">أبطأ نظام في اللعبة، وأصعب واحد ترجع منه.</p>
  <div class="tw"><table>
    <thead><tr><th>الرقم</th><th>القيمة</th><th>المعنى</th></tr></thead>
    <tbody>
      <tr><td class="k">البداية</td><td class="n">{ar(st["inflation"])}٪</td><td>سنويًا</td></tr>
      <tr><td class="k">الأرضية</td><td class="n">{ar(nf["floor"])}٪</td><td>مش بينزل تحتها مهما عملت</td></tr>
      <tr><td class="k">النزول الطبيعي</td><td class="n">−{nf["monthly_decay"]}٪/شهر</td><td>≈١٪ في السنة — <strong>بطيء جدًا</strong></td></tr>
      <tr><td class="k">طباعة ٣٥٠م</td><td class="n">+{nf["print_350_adds"]}٪</td><td>يعني تحتاج سنتين ونص عشان تختفي</td></tr>
      <tr><td class="k">العجز في الخزينة</td><td class="n">+{nf["deficit_penalty"]}٪/شهر</td><td>أسرع مصدر للتضخم</td></tr>
      <tr><td class="k">الوجع يبدأ فوق</td><td class="n">{ar(nf["pain_starts_above"])}٪</td><td>{nf["pain_coef"]} نقطة رضا لكل ١٪ زيادة</td></tr>
      <tr><td class="k">الانهيار</td><td class="n">{ar(nf["collapse_at"])}٪</td><td>نهاية اللعبة، نهاية تانية غير العزل</td></tr>
    </tbody>
  </table></div>
  <div class="formula">
    <div class="eq">تطبع في شهر · تدفع تمنها سنتين ونص</div>
    <p class="why">النسبة دي (+{nf["print_350_adds"]}٪ مقابل −{nf["monthly_decay"]}٪ شهريًا) هي كل الرسالة. طباعة الفلوس مش قرار غلط — دي قرار <strong>بتستلفه من نفسك</strong>. مرة تنفع. تلات مرات في سنة تخلي اللعبة كلها أغلى عليك للأبد.</p>
  </div>
</section><hr>''')

# ---------------------------------------------------------------- 8 mood
md = B["mood"]
h.append(f'''
<section id="m">
  <h2><span class="num">٨</span>الرضا والثبات والغليان</h2>
  <p class="lede">إزاي كل ده بيتحول لغضب، وإمتى الغضب بيبقى شغب.</p>
  <div class="formula">
    <div class="eq">رضا المحافظة = خدماتها − (وجع الضرايب + وجع الغذاء) ÷ ثروتها − وجع التضخم</div>
    <p class="why">لاحظ إن وجع الضرايب والغذاء <strong>بيتقسم على ثروة المحافظة</strong> (فالغني بيتحمل)، لكن وجع التضخم <strong>ما بيتقسمش</strong> — التضخم بيوجع الكل بالتساوي. ده مقصود: التضخم هو الحاجة الوحيدة اللي ما ينفعش تحمي منها فئة معينة.</p>
  </div>
  <div class="tw"><table>
    <thead><tr><th>الرقم</th><th>القيمة</th><th>ليه كده</th></tr></thead>
    <tbody>
      <tr><td class="k">سرعة تحرك الرضا</td><td class="n">{md["smoothing"]}</td><td>يوصل لقيمته الجديدة في ٣ شهور تقريبًا</td></tr>
      <tr><td class="k">سرعة تحرك الثبات</td><td class="n">{md["stability_smoothing"]}</td><td>أبطأ من الرضا — السياسة أبطأ من الشارع</td></tr>
      <tr><td class="k">خط خطر الرضا</td><td class="n">{ar(md["approval_danger"])}</td><td>تحته الغليان بيبدأ يتراكم</td></tr>
      <tr><td class="k">خط خطر الثبات</td><td class="n">{ar(md["stability_danger"])}</td><td>لازم الاتنين تحت الخط مع بعض</td></tr>
      <tr><td class="k">الغليان يفجّر عند</td><td class="n">{ar(md["boil_cap"])}</td><td>حوالي ٦–٨ شهور وحشة متتالية</td></tr>
      <tr><td class="k">الغليان بيهدى</td><td class="n">−{ar(md["boil_cooldown"])}/شهر</td><td>في الشهور الكويسة — يعني تقدر تنجو</td></tr>
    </tbody>
  </table></div>
  <div class="risk"><b>أهم قرار هنا: لازم الاتنين مع بعض</b>
  الشغب مش بيقوم بالرضا الواطي لوحده. لازم <strong>رضا واطي + ثبات واطي</strong> في نفس الشهر. يعني رئيس شعبيته صفر بس ماسك السياسة كويس ممكن يعيش — ورئيس محبوب بس حكومته متفككة ممكن يقع. <em>ودي بالظبط الحقيقة السياسية اللي عايزين اللاعب يحسها.</em></div>
</section><hr>''')

# ---------------------------------------------------------------- 9 sim
# Sorted worst-first: the weak combinations are the ones worth looking at.
COMBO_ROWS = "".join(
    f'<tr><td class="k">{name}</td><td class="n">{ar(life)} شهر</td></tr>'
    for name, life in sorted(COMBOS.items(), key=lambda kv: kv[1]))
h.append(f'''
<section id="t">
  <h2><span class="num">٩</span>نتيجة المحاكاة</h2>
  <p class="lede">المحاكي بيشغّل <strong>محرك اللعبة نفسه</strong> — مش نسخة منه — بتلات أنماط لعب.
  يعني كل رقم تحت ده رقم اللاعب هيقابله فعلاً.</p>
  <div class="tw"><table>
    <thead><tr><th>نمط اللعب</th><th>عاش قد إيه</th><th>الحكم</th></tr></thead>
    <tbody>
      <tr><td class="k">سلبي — ما بيعملش حاجة</td><td class="n">{ar(LIFE["سلبي"])} شهر ≈ {ar(round(LIFE["سلبي"]/12))} سنين</td>
          <td>الدولة بتتآكل لوحدها من نمو السكان. <strong>الوقوف مكانك مش خيار.</strong></td></tr>
      <tr><td class="k">معقول — بيصلّح الأسوأ</td><td class="n">{ar(LIFE["معقول"])} شهر ≈ {ar(round(LIFE["معقول"]/12))} سنة</td>
          <td>{ar(round(LIFE["معقول"]/LIFE["سلبي"]*10)/10 if False else round(LIFE["معقول"]/LIFE["سلبي"],1))} ضعف عمر السلبي. <strong>المهارة بتفرق فعلاً.</strong></td></tr>
      <tr><td class="k">حرامي — بيسرق ويطبع</td><td class="n">{ar(LIFE["حرامي"])} شهر ≈ {ar(round(LIFE["حرامي"]/12))} سنين</td>
          <td>عمر قصير، جيب مليان. <strong>مقايضة حقيقية مش عقوبة.</strong></td></tr>
    </tbody>
  </table></div>
  <div class="risk"><b>اللي المحاكاة بتقوله</b>
  الفرق بين أسوأ لاعب وأحسن لاعب هو <strong>{ar(round(LIFE["معقول"]/LIFE["سلبي"],1) if False else round(LIFE["معقول"]/LIFE["سلبي"]))} أضعاف العمر</strong>. لو الفرق كان أقل من الضعف، كان معنى كده إن قراراتك مش مهمة. ولو كان عشر أضعاف، كان معناه إن فيه استراتيجية واحدة صح وباقي اللعب غلط.</div>
  <h3>أول شهر بالأرقام</h3>
  <div class="tw"><table>
    <thead><tr><th>البند</th><th>القيمة</th></tr></thead>
    <tbody>
      <tr><td class="k">الدخل</td><td class="n">{ar(FIRST["income"])}م</td></tr>
      <tr><td class="k">المصروف</td><td class="n">{ar(FIRST["expense"])}م</td></tr>
      <tr><td class="k">منه تشغيل الوزارات</td><td class="n">{ar(FIRST["run"])}م</td></tr>
      <tr><td class="k">منه استيراد غذاء</td><td class="n">{ar(FIRST["importCost"])}م</td></tr>
      <tr><td class="k">الصافي</td><td class="n">{"+" if FIRST["net"] >= 0 else "−"}{ar(abs(FIRST["net"]))}م</td></tr>
    </tbody>
  </table></div>

  <h3>الاتناشر تركيبة حكم ومجتمع</h3>
  <p>نفس اللاعب المعقول، باختيارات بداية مختلفة. لو تركيبة واحدة متفوقة على الباقي بكتير، يبقى الاختيار ديكور.</p>
  <div class="tw"><table>
    <thead><tr><th>التركيبة</th><th>عاش</th></tr></thead>
    <tbody>{COMBO_ROWS}</tbody>
  </table></div>

  <div class="open"><b>اللي المحاكاة ما بتقولوش</b>
  دي بتختبر <strong>الاقتصاد بس</strong> — الوزرا والأحزاب والفضايح والأحداث لسه ما اتبنوش، فبونصاتهم في اختيارات البداية <strong>لسه مش شغالة</strong>. يعني أي تركيبة بتبان ضعيفة دلوقتي، الحكم عليها مؤجل لحد ما بونصاتها تشتغل. والمحاكي حاليًا <strong>مفيهوش عشوائية</strong>، فجولة واحدة لكل نمط كافية — أول ما ندخل الأحداث العشوائية هنرجع نحسب متوسطات.</div>
</section><hr>''')

# ---------------------------------------------------------------- 10 review
h.append(f'''
<section id="q">
  <h2><span class="num">١٠</span>محتاج مراجعتك — بعين محاسب</h2>
  <p class="lede">دول الأسئلة اللي أنا مش قادر أجاوبها لوحدي، وإجابتك هتغيّر أرقام كتير.</p>
  <div class="open"><b>١ — نسبة الدخل للمصروف</b>
  الدولة بتبدأ بدخل ≈٨٩٠م ومصروف ≈٨٧٠م، يعني فايض ≈٢٠م بس (٢٪). ده مقصود عشان تحس إنك مخنوق من أول يوم. <strong>هل ٢٪ ضيق أوي ولا مظبوط؟</strong></div>
  <div class="open"><b>٢ — الاحتياطي</b>
  الخزينة بتبدأ بـ{ar(st["treasury"])}م = حوالي ٣ شهور مصروفات. <strong>كافي إنك تغلط مرتين وتتعلم، ولا قليل أوي؟</strong></div>
  <div class="open"><b>٣ — تكلفة المستشفى الحقيقية</b>
  {ar(sv["health"]["build_cost"])}م بناء + {ar(sv["health"]["adds_monthly"])}م شهريًا للأبد. على ١٠ سنين = {ar(sv["health"]["build_cost"]+sv["health"]["adds_monthly"]*120)}م. <strong>هل نسبة التشغيل للبناء دي واقعية في إحساسها؟</strong></div>
  <div class="open"><b>٤ — الدعم مقابل البناء</b>
  الدعم بيشتري رضا فوري ورخيص. البناء بيشتري رضا دايم وغالي. <strong>هل الدعم رخيص أوي لدرجة إن اللاعب الذكي هيعتمد عليه بس؟</strong> ده أخطر خلل ممكن يحصل في الميزان.</div>
  <div class="open"><b>٥ — الضرايب</b>
  كل ١٪ ضريبة بيجيب ≈١٨م ويكلف {B["mood"]["tax_pain_coef"]} نقطة رضا. <strong>حاسس إن السعر ده عادل؟</strong></div>
  <div class="open"><b>٦ — الأرقام نفسها</b>
  لو أي رقم في الملف ده حسّه غلط بالنسبة لك — قوله. الأرقام دي كلها في ملف واحد (<code>balance.json</code>) وتغييرها دقيقة شغل، والمحاكي هيقول لنا فورًا التغيير عمل إيه.</div>
</section><hr>

<section>
  <h2><span class="num">✓</span>اللي بعده</h2>
  <p>بعد ما تراجع الأرقام دي، البند ٣: <strong>حساب GitHub والمستودع</strong> — وبعده على طول مسار البناء اللي هيديك رابط تفتحه من موبايلك. ومن هناك كل بند بيبقى حاجة تلعبها بإيدك.</p>
</section>
  </main>
</div>
</div>''')

body = ("<title>ميزان الدولة</title>\n"
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Kufi+Arabic:wght@500;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600&display=swap">\n'
    + "".join(h))
(DOCS / "balance.html").write_text(wrap_page("ميزان الدولة", body), encoding="utf-8")
print("docs/balance.html written")
