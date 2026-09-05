#!/usr/bin/env python3
"""
The permanent checker. Runs on every push and fails the build on any problem.

The rule this file exists for: any bug that shows up once becomes a check here,
so it can never come back silently. Neither of us can see the screen — this is
what looks instead.

Add a new check by writing a function named check_* and appending it to CHECKS.
Every check appends a human-readable Arabic string to `problems` for each fault.
"""
import json, os, re, subprocess, sys, shutil, tempfile, html.parser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, DOCS, TOOLS = ROOT / "data", ROOT / "docs", ROOT / "tools"

# Pages that use the light/dark token system, keyed by path from the repo root.
# Keyed by path and not by file name because game/index.html and index.html
# share a name and only one of them is themed — the game is deliberately
# single-theme dark.
THEMED = {"docs/design.html", "docs/balance.html", "index.html"}


def rel(f):
    return f.relative_to(ROOT).as_posix()

VOID = {"meta", "link", "br", "hr", "img", "input", "source",
        "path", "rect", "circle", "line", "polygon", "polyline", "use", "marker", "stop"}


def html_files():
    return sorted(list(DOCS.glob("*.html")) + [ROOT / "index.html", ROOT / "game" / "index.html"])


# --------------------------------------------------------------------- HTML
class Balance(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.errors = [], []

    def handle_starttag(self, tag, attrs):
        if tag not in VOID:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"</{tag}> زيادة")
        elif self.stack[-1] != tag:
            self.errors.append(f"<{self.stack[-1]}> مفتوح واتقفل بـ</{tag}>")
        else:
            self.stack.pop()


def check_html_structure(problems):
    """Unclosed tags render as a blank or scrambled page — invisible to us."""
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        p = Balance()
        p.feed(src)
        for e in p.errors:
            problems.append(f"{rel(f)}: وسم غلط — {e}")
        if p.stack:
            problems.append(f"{rel(f)}: وسوم مفتوحة ما اتقفلتش — {p.stack}")


def check_anchors(problems):
    """A dead in-page link is a silent dead end for the reader."""
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        anchors = set(re.findall(r'href="#([\w-]+)"', src))
        ids = set(re.findall(r'id="([\w-]+)"', src))
        for a in anchors - ids:
            problems.append(f"{rel(f)}: رابط داخلي #{a} مش موجود")


def check_tables(problems):
    """A row with fewer cells than its header shifts every column after it."""
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        for i, tbl in enumerate(re.findall(r"<table>.*?</table>", src, re.S)):
            head = len(re.findall(r"<th[ >]", tbl))
            for row in re.findall(r"<tr>.*?</tr>", tbl, re.S):
                cells = len(re.findall(r"<td[ >]", row))
                if cells and cells != head:
                    problems.append(
                        f"{f.name}: جدول {i+1} عناوينه {head} وفيه صف بـ{cells} خانة")


def check_theme(problems):
    """The classic unreadable-artifact bug: a colour defined only inside a dark
    block leaves the un-stamped default theme rendering one theme on the other."""
    for f in html_files():
        if rel(f) not in THEMED:
            continue
        css_m = re.search(r"<style>(.*?)</style>", f.read_text(encoding="utf-8"), re.S)
        if not css_m:
            problems.append(f"{rel(f)}: مفيش بلوك <style>")
            continue
        css = css_m.group(1)
        m = re.search(r":root\{(.*?)\}", css, re.S)
        if not m:
            problems.append(f"{rel(f)}: مفيش :root فيه ألوان الوضع الفاتح")
            continue
        defined = set(re.findall(r"(--[\w-]+)\s*:", m.group(1)))
        for v in set(re.findall(r"var\((--[\w-]+)\)", css)) - defined:
            problems.append(f"{rel(f)}: المتغير {v} مستخدم ومش معرّف في :root الفاتح")
        for label, marker in [("الوضع الداكن التلقائي", r':root:not\(\[data-theme="light"\]\)\{(.*?)\}'),
                              ("الوضع الداكن اليدوي", r':root\[data-theme="dark"\]\{(.*?)\}')]:
            mm = re.search(marker, css, re.S)
            if not mm:
                problems.append(f"{rel(f)}: {label} مش موجود")
                continue
            missing = defined - set(re.findall(r"(--[\w-]+)\s*:", mm.group(1)))
            if missing:
                problems.append(f"{rel(f)}: {label} ناقصه ألوان — {sorted(missing)}")


def check_svg(problems):
    """A box drawn outside the viewBox is simply invisible; a marker reference
    with no definition silently drops every arrowhead."""
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        # Any element can be referenced by url(#id) — markers, gradients, patterns,
        # clip paths. Collect every id the way the browser resolves them.
        defined = set(re.findall(r'\bid="([\w-]+)"', src))
        for ref in set(re.findall(r"url\(#([\w-]+)\)", src)):
            if ref not in defined:
                problems.append(f"{rel(f)}: url(#{ref}) مستخدم ومالوش تعريف في الملف")
        for m in re.finditer(r'<svg viewBox="0 0 (\d+) (\d+)"(.*?)</svg>', src, re.S):
            W, H, body = int(m.group(1)), int(m.group(2)), m.group(3)
            for r in re.finditer(r'<rect[^>]*?x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"', body):
                x, y, w, h = map(int, r.groups())
                if x + w > W or y + h > H:
                    problems.append(f"{rel(f)}: مربع في الرسمة برّه حدودها ({x},{y} {w}×{h} في {W}×{H})")


def check_javascript(problems):
    """Inline scripts are never syntax-checked by a browser until they run, and
    a handler named in generated markup but never defined does nothing on tap."""
    if not shutil.which("node"):
        problems.append("تحذير: node مش متثبت — فحص الجافاسكريبت اتخطى")
        return
    # Names that appear before "(" in a handler but are language or browser
    # built-ins, not functions we define. Without this the checker flags `if(...)`.
    BUILTIN = {"if", "for", "while", "switch", "return", "typeof", "function", "catch",
               "alert", "confirm", "setTimeout", "parseInt", "parseFloat", "Number",
               "String", "Math", "console", "Array", "Object", "JSON"}
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        scripts = re.findall(r"<script>(.*?)</script>", src, re.S)
        for js in scripts:
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as t:
                t.write(js)
                tmp = t.name
            r = subprocess.run(["node", "--check", tmp], capture_output=True, text=True)
            if r.returncode:
                problems.append(f"{rel(f)}: خطأ في الجافاسكريبت — {r.stderr.strip().splitlines()[-1]}")
        # Handlers are checked against every script on the page, not one at a time.
        called = set()
        for attr in re.findall(r'on(?:click|input|change)=("[^"]*"|\'[^\']*\')', src):
            called |= set(re.findall(r"([A-Za-z_]\w*)\s*\(", attr))
        defined = set()
        for js in scripts:
            defined |= set(re.findall(r"function\s+([A-Za-z_]\w*)", js))
            defined |= set(re.findall(r"(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*function", js))
        for h in called - defined - BUILTIN:
            problems.append(f"{rel(f)}: زرار بينده على {h}() وهي مش معرّفة")


# --------------------------------------------------------------------- data
def check_balance_json(problems):
    try:
        b = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"balance.json مش بيتقري — {e}")
        return
    for key in ["start", "governorates", "services", "income", "food", "inflation", "mood"]:
        if key not in b:
            problems.append(f"balance.json ناقصه قسم «{key}»")
    if "services" in b:
        weights = sum(s["approval_weight"] for s in b["services"].values())
        if abs(weights - 1.0) > 0.001:
            problems.append(f"مجموع أوزان الخدمات في الرضا = {weights:.3f} والمفروض ١٫٠٠٠")
        for k, s in b["services"].items():
            for field in ["serves_millions", "monthly_ask", "build_cost", "build_months", "adds_monthly"]:
                if field not in s:
                    problems.append(f"خدمة {k} ناقصها {field}")
                elif s[field] <= 0:
                    problems.append(f"خدمة {k}: {field} لازم يكون أكبر من صفر")
    # A facility that covers most of a province turns "where do I build" into a
    # single obvious click, which is the one thing the governorate system exists
    # to avoid. Keep every build a step, never a switch.
    if "governorates" in b and "services" in b:
        for sk, sv in b["services"].items():
            for gk, gv in b["governorates"].items():
                jump = sv["serves_millions"] / gv["population"] * 100
                if jump > 45:
                    problems.append(
                        f"منشأة {sv['name']} الواحدة بتغطي {jump:.0f}٪ من {gv['name']} — "
                        "كده البناء بيحل المحافظة بضغطة واحدة، والقرار بيضيع")

    if "governorates" in b and "services" in b:
        for g, gv in b["governorates"].items():
            if gv["population"] <= 0:
                problems.append(f"محافظة {g}: السكان لازم يكونوا أكبر من صفر")
            for s in b["services"]:
                if s not in gv["facilities"]:
                    problems.append(f"محافظة {g} مالهاش عدد منشآت لخدمة {s}")


def check_setup_json(problems):
    """A modifier aimed at a key that does not exist would silently do nothing —
    the player would pick a government type and get no government type."""
    try:
        s = json.loads((DATA / "setup.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"setup.json مش بيتقري — {e}")
        return
    base = s["base_start"]
    govs, socs = s["government_types"], s["society_types"]
    for group in (govs, socs):
        for o in group:
            for k in o["mods"]:
                if k not in base:
                    problems.append(f"«{o['nm']}» بيعدّل «{k}» وهي مش موجودة في حالة البداية")
            if not o["good"] or not o["bad"]:
                problems.append(f"«{o['nm']}» لازم يكون له بونص ونجتف — مفيش اختيار من غير تمن")
    limits = {"approval": (10, 95), "stability": (10, 95), "competence": (20, 95),
              "loyalty": (20, 95), "ap": (3, 10), "inflation": (0, 40)}
    for g in govs:
        for c in socs:
            v = dict(base)
            for o in (g, c):
                for k, d in o["mods"].items():
                    v[k] += d
            for k, (lo, hi) in limits.items():
                if k in v and not (lo <= v[k] <= hi):
                    problems.append(f"تركيبة «{g['nm']} + {c['nm']}»: {k} = {v[k]} برّه المدى {lo}–{hi}")


def check_treasury(problems):
    """The levers on the finance minister's desk, and the price of stealing.
    A starting value outside its own slider's range can never be returned to
    once the player moves it, and a theft with no risk makes every other way of
    getting money pointless."""
    b = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
    st, lv, c = b["start"], b["levers"], b["corruption"]

    for key, start_key, label in (("tax", "tax_rate", "ضريبة الدخل"),
                                  ("utility", "utility_price", "سعر المرافق"),
                                  ("subsidy", "food_subsidy", "دعم الغذاء")):
        r = lv[key]
        if r["min"] >= r["max"]:
            problems.append(f"مقبض «{label}»: المدى {r['min']}–{r['max']} مقلوب")
        if not (r["min"] <= st[start_key] <= r["max"]):
            problems.append(f"مقبض «{label}»: القيمة الابتدائية {st[start_key]} برّه المدى "
                            f"{r['min']}–{r['max']} — اللاعب مش هيقدر يرجّعها لمكانها")
        if r["step"] <= 0 or (r["max"] - r["min"]) / r["step"] < 5:
            problems.append(f"مقبض «{label}»: الخطوة {r['step']} كبيرة أوي — مفيش مواضع تتحرك بينها")

    if not (0 < c["max_share_per_month"] <= 0.5):
        problems.append(f"السرقة: نسبة {c['max_share_per_month']} من الخزينة في الشهر غلط — "
                        f"لازم بين صفر ونص")
    if c["hard_cap"] <= 0:
        problems.append("السرقة: مفيش سقف — اللاعب هيفضّي الخزينة بضغطة")
    if c["approval_hit"] <= 0 and c["stability_hit"] <= 0:
        problems.append("السرقة من غير تمن لما تتكشف — بقت فلوس ببلاش والباقي بلا لازمة")
    if not (0 < c["leak_min_pct"] < c["leak_max_pct"] <= 100):
        problems.append(f"السرقة: احتمال التسريب {c['leak_min_pct']}–{c['leak_max_pct']}٪ غلط")
    if c["leak_loyalty_coef"] <= 0:
        problems.append("السرقة: ولاء وزير المالية مالوش تأثير على التسريب — المنصب بقى ديكور")


def check_parliament(problems):
    """The chamber. Seats must add up, every party must watch something the game
    actually has, and the social blocs must cover the whole population — a bloc
    system that adds up to 80% of the people is quietly ignoring a fifth of the
    country while claiming to explain the approval rating."""
    try:
        p = json.loads((DATA / "parliament.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"parliament.json مش بيتقري — {e}")
        return
    src = strip_js_comments((ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8"))
    known = set(re.findall(r"^  ([a-zA-Z]+):\s*function \(S\)", src, re.M))

    seats = sum(q["seats"] for q in p["parties"])
    if seats != 100:
        problems.append(f"مجموع مقاعد الأحزاب {seats} والمفروض ١٠٠")
    ids = [q["id"] for q in p["parties"]]
    if len(ids) != len(set(ids)):
        problems.append("فيه حزبين بنفس الـ id")
    for q in p["parties"]:
        w = sum(d["w"] for d in q["drivers"])
        if abs(w - 1) > 0.001:
            problems.append(f"«{q['nm']}»: مجموع أوزانه {w:.2f} والمفروض ١")
        for d in q["drivers"]:
            if d["k"] not in known:
                problems.append(f"«{q['nm']}» بيهتم بـ«{d['k']}» وهي مش موجودة في اللعبة — "
                                f"الحزب ده هيبقى بيزعل من حاجة مش متحسوبة")
        if q["seats"] <= 0:
            problems.append(f"«{q['nm']}» مالوش مقاعد — حزب مش موجود في المجلس")

    share = sum(b["share"] for b in p["blocs"])
    if abs(share - 1) > 0.001:
        problems.append(f"مجموع نسب الكتل الاجتماعية {share:.2f} والمفروض ١ — "
                        f"يعني فيه ناس مش محسوبين وإحنا بنقول إن دول كل الشعب")
    for b in p["blocs"]:
        for k in ("service", "food", "tax", "inflation"):
            if k not in b["sens"]:
                problems.append(f"كتلة «{b['nm']}» ناقصها حساسية «{k}»")
    # Blocs that all feel the same thing the same way are five copies of one row.
    for k in ("food", "tax"):
        vals = [b["sens"][k] for b in p["blocs"]]
        if max(vals) - min(vals) < 0.4:
            problems.append(f"كل الكتل بتحس بـ«{k}» بنفس الدرجة تقريبًا — "
                            f"الشاشة بقت خمس صفوف بنفس الرقم")

    bk = p["backing"]
    if not (0 < bk["floor"] < 100):
        problems.append(f"خط أمان المجلس {bk['floor']} غلط")
    if bk["stability_coef"] <= 0:
        problems.append("تأييد المجلس مالوش أي أثر على الثبات — الشاشة بقت ديكور")
    if p["minister_bonus"] <= 0:
        problems.append("تعيين وزير من حزب مالوش أثر على الحزب — "
                        "شاشة الوزرا وشاشة المجلس مش مربوطين")
    # The cabinet must not be able to buy a party outright, or every other
    # reason a party is happy or angry stops mattering.
    m = json.loads((DATA / "ministers.json").read_text(encoding="utf-8"))
    posts = len(m["posts"])
    if p["minister_bonus"] * posts > 45:
        problems.append(f"مكافأة الوزير {p['minister_bonus']} × {posts} منصب = "
                        f"{p['minister_bonus'] * posts} نقطة — تعيين وزرا بيلغي كل "
                        f"الأسباب التانية اللي بتخلي الحزب راضي أو زعلان")

    # Every minister's party must be a party that exists. The two files used to
    # keep separate lists of party NAMES that did not match, so the chamber
    # reported that no party had any ministers while the cabinet was full of
    # them — nothing errored, the screen simply said the opposite of the truth.
    known = {q["id"] for q in p["parties"]}
    for post in m["posts"]:
        if post["start"]["party"] not in known:
            problems.append(f"«{post['name']}» حزبه «{post['start']['party']}» مش موجود في "
                            f"parliament.json — المجلس مش هيعرف إنه من حزبه")


def check_bank(problems):
    """The central bank. The whole tab is one trade — a governor of your own
    signs for more but makes each printed pound burn hotter. If either half of
    that stops being true, the screen is a button with no decision behind it."""
    try:
        b = json.loads((DATA / "bank.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"bank.json مش بيتقري — {e}")
        return
    st, pr, sw = b["start"], b["print"], b["swap"]

    if not (0 <= st["independence"] <= 100):
        problems.append(f"استقلال المحافظ {st['independence']} برّه ٠–١٠٠")
    lo, hi = sw["new_independence"]
    if not (0 <= lo < hi <= 100):
        problems.append(f"مدى استقلال المحافظ الجديد {lo}–{hi} مقلوب أو برّه ٠–١٠٠")
    # The swap must always point the same way, or it is not a trade.
    if hi >= st["independence"]:
        problems.append(f"المحافظ الجديد ممكن يطلع أكتر استقلالًا ({hi}) من الأصلي "
                        f"({st['independence']}) — المقايضة مش ماشية في اتجاه واحد")
    if pr["cap_per_lost_independence"] <= 0:
        problems.append("استقلال المحافظ مش بيغيّر السقف — نص المقايضة ضاع")
    if pr["inflation_per_lost_independence"] <= 0:
        problems.append("استقلال المحافظ مش بيغيّر تكلفة التضخم — "
                        "يبقى تعيين محافظ من عندك مكسب مجاني")
    if pr["once_per_months"] < 1:
        problems.append("الطباعة كل شهر — اللاعب هيحوّل التضخم لعملة")
    if sw["ap_cost"] <= 0 or sw["cooldown_months"] < 1:
        problems.append("تغيير المحافظ ببلاش أو من غير مدة انتظار")

    # A print big enough to matter must also hurt enough to think about: one
    # print at the cap should not be free, and should not end the game either.
    def infl(ind, amount):
        per = pr["inflation_per_350"] * (1 + (100 - ind) * pr["inflation_per_lost_independence"])
        return per * (amount / 350)

    def cap(ind):
        return pr["base_cap"] + (100 - ind) * pr["cap_per_lost_independence"]

    start_ind = st["independence"]
    puppet = (lo + hi) / 2
    if cap(puppet) <= cap(start_ind):
        problems.append("محافظ من عندك مش بيوقّع على أكتر — مفيش سبب تغيّره")
    if infl(puppet, cap(puppet)) <= infl(start_ind, cap(start_ind)):
        problems.append("طبعة المحافظ بتاعك مش بتوجع أكتر — التغيير بقى مكسب من غير تمن")
    bal = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
    one = infl(start_ind, cap(start_ind))
    if one < 1:
        problems.append(f"طبعة كاملة بتزوّد التضخم {one:.2f}٪ بس — الطباعة تقريبًا ببلاش")
    if one > bal["inflation"]["collapse_at"] / 4:
        problems.append(f"طبعة واحدة بتزوّد التضخم {one:.1f}٪ — دي مش مقايضة، دي زرار انتحار")


def check_ministers_json(problems):
    """Control runs through the ministers now, so the map from post to service is
    load-bearing. A service with no minister runs on an undefined competence and
    sits at zero; a service with two ministers means the player fixes it from one
    screen and it changes on another. Neither is visible on screen."""
    try:
        m = json.loads((DATA / "ministers.json").read_text(encoding="utf-8"))
        b = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
        st = json.loads((DATA / "setup.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"ministers.json مش بيتقري — {e}")
        return

    posts = m["posts"]
    ids = [p["id"] for p in posts]
    if len(ids) != len(set(ids)):
        problems.append("فيه منصبين بنفس الـ id في ministers.json")
    if "pm" not in ids:
        problems.append("مفيش رئيس وزراء — معامل الحكومة كلها هيقع")
    if "finance" not in ids:
        problems.append("مفيش وزير مالية — تحصيل الضرايب هيقع")

    owner = {}
    for p in posts:
        for s in p["services"]:
            if s not in b["services"]:
                problems.append(f"«{p['name']}» مربوط بخدمة مش موجودة: {s}")
            elif s in owner:
                problems.append(f"خدمة «{b['services'][s]['name']}» عند وزيرين: {owner[s]} و{p['id']}")
            else:
                owner[s] = p["id"]
        for k in ("competence", "loyalty"):
            v = p["start"][k]
            if not (10 <= v <= 95):
                problems.append(f"«{p['name']}»: {k} = {v} برّه المدى ١٠–٩٥")
    for s in b["services"]:
        if s not in owner:
            problems.append(f"خدمة «{b['services'][s]['name']}» مالهاش وزير — هتفضل صفر للأبد")

    # Dismissal. A candidate range that can beat every sitting minister makes
    # sacking people free money; one that can never beat them makes the button
    # pointless. It has to straddle the cabinet you start with.
    d = m.get("dismiss", {})
    for k in ("comp_range", "loy_range"):
        lo, hi = d.get(k, [0, 0])
        if not (0 <= lo < hi <= 100):
            problems.append(f"إقالة: مدى {k} = {lo}–{hi} مقلوب أو برّه ٠–١٠٠")
    if d.get("candidates", 0) < 2:
        problems.append("إقالة: مرشح واحد مش اختيار — لازم اتنين على الأقل")
    if d.get("candidates", 0) > len(m.get("candidate_names", [])):
        problems.append("إقالة: المرشحين أكتر من الأسامي المتاحة")
    if d.get("ap_cost", 0) <= 0:
        problems.append("إقالة ببلاش — اللاعب هيقلّب الحكومة كل شهر")
    if d.get("min_months_in_post", 0) < 1:
        problems.append("إقالة: ينفع تقيل الوزير أول شهر — الاختيار بقى بلا تمن")
    comps = [p["start"]["competence"] for p in posts]
    lo, hi = d.get("comp_range", [0, 0])
    if lo >= min(comps):
        problems.append(f"إقالة: أسوأ مرشح ({lo}) أحسن من أسوأ وزير ({min(comps)}) — الإقالة بقت مكسب مضمون")
    if hi <= max(comps):
        problems.append(f"إقالة: أحسن مرشح ({hi}) أوحش من أحسن وزير ({max(comps)}) — الزرار مالوش لازمة")

    # The reshuffle. It has to be worse per head than choosing people one by
    # one, or nobody would ever choose; and it has to be cheaper overall, or
    # nobody would ever reshuffle. Those two together are the whole decision.
    r = m.get("reshuffle", {})
    heads = len(posts) - 1
    if r.get("ap_cost", 0) <= 0:
        problems.append("التعديل الوزاري ببلاش")
    if r.get("ap_cost", 0) >= d.get("ap_cost", 0) * heads:
        problems.append(f"التعديل الوزاري بيكلّف {r.get('ap_cost')} طاقة وإقالتهم واحد واحد "
                        f"{d.get('ap_cost', 0) * heads} — مفيش سبب تعمله")
    if r.get("stability_hit", 0) <= d.get("stability_hit", 0):
        problems.append(f"التعديل الوزاري بيهزّ الثبات {r.get('stability_hit')} وإقالة واحد "
                        f"{d.get('stability_hit')} — قلب الحكومة كلها لازم يوجع أكتر")
    if r.get("cooldown_months", 0) < 1:
        problems.append("التعديل الوزاري من غير مدة انتظار — اللاعب هيلف على حكومة مثالية")
    if r.get("pm_quality_coef", 0) <= 0:
        problems.append("كفاءة رئيس الوزراء مالهاش تأثير على التعديل — المنصب بقى ديكور")

    # Every minister is a person, at the start as much as later.
    names = [p["start"].get("name") for p in posts]
    if any(not n for n in names):
        problems.append("فيه منصب من غير اسم صاحبه في البداية")
    if len(set(names)) != len(names):
        problems.append("فيه اسمين وزرا متكررين في البداية")

    # The labels on the cabinet screen. A band with reversed ends matches
    # nobody, and a label nobody can read is a feature that quietly does not
    # exist — so the starting cabinet must contain both tagged and untagged men.
    tagged = untagged = 0
    for t in m.get("tags", []):
        if t.get("tone") not in ("good", "warn", "bad"):
            problems.append(f"وصف «{t.get('nm')}» لونه مش معروف: {t.get('tone')}")
        for k in ("comp", "loy"):
            lo, hi = t[k]
            if not (0 <= lo <= hi <= 100):
                problems.append(f"وصف «{t['nm']}»: مدى {k} = {lo}–{hi} مقلوب أو برّه ٠–١٠٠")
    for p in posts:
        c, l = p["start"]["competence"], p["start"]["loyalty"]
        hit = any(t["comp"][0] <= c <= t["comp"][1] and t["loy"][0] <= l <= t["loy"][1]
                  for t in m.get("tags", []))
        tagged += hit
        untagged += not hit
    if not tagged:
        problems.append("مفيش وزير واحد بيطابق أي وصف — الأوصاف في الشاشة ميتة")
    if not untagged:
        problems.append("كل الوزرا بياخدوا وصف — الوصف مش بيميّز حد وقتها")

    # The cabinet the player actually gets must be roughly the cabinet the
    # balance document was written about, or every number in it is a lie.
    weighted = sum(b["services"][s]["approval_weight"] * posts[ids.index(owner[s])]["start"]["competence"]
                   for s in owner if s in b["services"])
    total_w = sum(b["services"][s]["approval_weight"] for s in owner if s in b["services"])
    if total_w:
        avg = weighted / total_w
        base = st["base_start"]["competence"]
        if abs(avg - base) > 8:
            problems.append(f"متوسط كفاءة الوزرا المرجّح {avg:.1f} والأساس في setup.json {base} — "
                            f"الفرق أكبر من ٨، التوازن كله مبني على الرقم ده")


def check_simulator_has_no_rules(problems):
    """The simulator must PLAY the game, not reimplement it. The moment it does
    its own arithmetic on the state, it starts measuring a game nobody plays —
    and it did exactly that with stealing and printing money for weeks. Setting
    a lever (pct, tax, subsidy, utility price) is a player's move and is fine;
    writing to the treasury, the pocket, the mood or inflation is a rule."""
    src = strip_js_comments((ROOT / "tools" / "simulate.js").read_text(encoding="utf-8"))
    owned = ["treasury", "personal", "approval", "stability", "inflation", "priceIndex",
             "boil", "foodPrice", "ap"]
    for field in owned:
        for m in re.finditer(r"\bS\." + field + r"\s*(\+=|-=|\*=|/=|=[^=])", src):
            line = src[:m.start()].count("\n") + 1
            problems.append(f"simulate.js سطر {line}: بيكتب في S.{field} بنفسه — "
                            f"ده قاعدة، مكانها engine.js والمحاكي ينده عليها")


def strip_js_comments(src):
    """Checks that look for a forbidden call must not trip over a comment
    explaining why it is forbidden — that makes the check impossible to satisfy
    and the next person deletes it instead of fixing the code."""
    src = re.sub(r"/\*[\s\S]*?\*/", " ", src)
    return re.sub(r"(?m)//.*$", " ", src)


def check_browser_globals_are_faked(problems):
    """The game runs in a browser; the test runs it in Node with a hand-built
    fake browser. Every browser global the screens touch must be in that fake.

    This is not theoretical: `navigator` only became a Node global in version 21,
    so the test passed on the Node here and died on CI's Node 20 with
    "navigator is not defined" — green locally, red for Karim, which is the one
    failure mode this whole checker exists to prevent."""
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    ui = re.sub(r"'(?:[^'\\]|\\.)*'", "''", ui)          # drop string contents
    test = (TOOLS / "test_game.js").read_text(encoding="utf-8")

    BROWSER = ["navigator", "location", "window", "localStorage", "sessionStorage",
               "fetch", "alert", "confirm", "screen", "history", "matchMedia"]
    for g in BROWSER:
        if not re.search(r"\b" + g + r"\b", ui):
            continue
        if not re.search(r"global\." + g + r"\s*=", test):
            problems.append(f"ui.js بيستخدم «{g}» و tools/test_game.js مش معرّفه — "
                            f"الاختبار هيعدّي على نسخة نود عندها الحاجة دي ويقع على غيرها")


def check_engine_is_repeatable(problems):
    """The engine must roll dice from the game's own seed, never Math.random.
    One Math.random in here and the same game stops giving the same result:
    the balance simulator measures a different game every run, and the player
    can reroll an offer he did not like by leaving the screen and coming back.
    The screens may use it freely — a suggested name is not a rule."""
    src = (ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8")
    if "Math.random" in strip_js_comments(src):
        problems.append("engine.js فيه Math.random — اللعبة مبقتش قابلة للإعادة "
                        "والمحاكي هيقيس لعبة مختلفة كل مرة. استخدم rngFrom(hashStr(...))")
    for needed in ("function rngFrom(", "function hashStr(", "seed:"):
        if needed not in src:
            problems.append(f"engine.js: «{needed}» ناقص — مصدر العشوائية المحفوظة مش موجود")


def check_ui_once_only(problems):
    """A scripted edit that replaces ALL occurrences instead of one has already
    duplicated a block in this file three times. Duplicates of these are silent:
    the game still runs, it just does the work again on every click."""
    src = (ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8")
    once = {
        "navigator.serviceWorker.register": "تسجيل عامل الخدمة",
        "el('artdefs').innerHTML": "تركيب تعريفات الرسومات",
        "function drawView()": "دالة رسم الشاشة",
        "document.addEventListener('click'": "مستقبل الضغطات",
    }
    for needle, name in once.items():
        n = src.count(needle)
        if n != 1:
            problems.append(f"ui.js: «{name}» مكرر {n} مرة والمفروض مرة واحدة بس")


def check_every_class_is_styled(problems):
    """A class the screens emit that no rule in style.css ever mentions is a
    block of markup with no design on it. Nothing errors, nothing logs — it just
    looks wrong on a phone neither of us is holding."""
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    css = (ROOT / "game" / "src" / "style.css").read_text(encoding="utf-8")
    styled = set(re.findall(r"\.([a-zA-Z][\w-]*)", css))
    # Classes are built by string concatenation, so a capture can run into the
    # JavaScript that follows it. Only the literal part before the first quote
    # is really a class name; guessing past that produced false alarms, and a
    # check that cries wolf gets deleted instead of obeyed.
    used = set()
    for m in re.finditer(r'class="([^"]*)"', ui):
        for c in m.group(1).split("'")[0].split():
            if re.fullmatch(r"[a-z][a-z0-9]*(?:-[a-z0-9]+)*", c):
                used.add(c)
    for c in sorted(used - styled):
        problems.append(f"style.css: الكلاس «{c}» مستخدم في الشاشات ومالوش أي تنسيق")


def check_clipped_text(problems):
    """A line placed at bottom:-2px inside an overflow:hidden box has its lower
    half sliced off. It shipped that way for weeks: nothing in the HTML is
    wrong, no test fails, and it only shows up if somebody looks at the screen.
    So the rule is mechanical instead — nothing inside a clipping box may be
    positioned outside it."""
    css = (ROOT / "game" / "src" / "style.css").read_text(encoding="utf-8")
    rules = re.findall(r"([^{}]+)\{([^{}]*)\}", css)
    clippers = [sel.strip() for sel, body in rules
                if re.search(r"overflow\s*:\s*hidden", body)
                and re.match(r"^\.[a-zA-Z0-9_-]+$", sel.strip())]
    for sel, body in rules:
        sel = sel.strip()
        for c in clippers:
            if not sel.startswith(c + " "):
                continue
            for m in re.finditer(r"\b(top|bottom|left|right)\s*:\s*(-[\d.]+)px", body):
                problems.append(
                    f"style.css: «{sel}» متحطّط {m.group(1)}:{m.group(2)}px جوّه «{c}» "
                    f"اللي بيقص اللي برّه — الكلام هيتقص من غير ما حد ياخد باله")


def check_navigation(problems):
    """Control runs through sub-screens now, so the back button is load-bearing.
    These are the wiring mistakes that leave a player stuck on a screen with no
    way out — and none of them look wrong in a diff."""
    src = (ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8")

    if "var stack = [" not in src:
        problems.append("ui.js: مفيش مكدّس شاشات — الرجوع مش هيشتغل")
        return
    if "function backScreen()" not in src:
        problems.append("ui.js: مفيش دالة رجوع")
    # The phone's back key must walk the stack before it treats the press as
    # "leave the game". If this line goes, the player gets thrown out.
    if "backScreen()" not in src.split("function onAndroidBack()")[-1].split("\n}")[0]:
        problems.append("ui.js: زرار الرجوع بتاع الموبايل مش بيمشي على المكدّس — هيطلّع اللاعب برّه اللعبة")

    # Every screen the code can open must exist in the routing table, and every
    # screen in the table must be reachable — a tab, or opened from somewhere.
    screens = set(re.findall(r"^  ([a-z_]+):\s*\{ art:", src, re.M))
    tabs = set(re.findall(r"\['([a-z]+)', '[^']+', '", src))
    opened = set(re.findall(r'data-open="([a-z]+)"', src))
    for t in tabs:
        if "tab_" + t not in screens:
            problems.append(f"ui.js: تاب «{t}» مالوش شاشة في جدول الشاشات")
    for s in screens:
        if s.startswith("tab_"):
            if s[4:] not in tabs:
                problems.append(f"ui.js: شاشة «{s}» مش في شريط التابات")
        elif s not in opened:
            problems.append(f"ui.js: شاشة «{s}» موجودة في الجدول بس مفيش زرار بيفتحها — اللاعب مش هيوصلها")
    for s in opened:
        if s not in screens:
            problems.append(f"ui.js: زرار بيفتح شاشة «{s}» وهي مش في جدول الشاشات — هيرسم فاضي")

    # Every screen must have a body function or a "still being built" card.
    # Having neither means an empty page with a title on it.
    bodies = set(re.findall(r"[{,]\s*([a-z_]+):\s*\w+Body\b|[{,]\s*([a-z_]+):\s*servView",
                            src.split("var BODY = {")[-1].split("}")[0] if "var BODY = {" in src else ""))
    bodies = {a or b for a, b in bodies}
    soon = set(re.findall(r"^  ([a-z_]+): \['", src, re.M))
    for s in screens:
        key = s[4:] if s.startswith("tab_") else s
        if key not in bodies and key not in soon:
            problems.append(f"ui.js: شاشة «{key}» مالهاش دالة رسم ولا كارت «لسه بيتبني» — هتطلع صفحة فاضية")


# ---------------------------------------------------------------- generated
def check_generated_files_match(problems):
    """docs/balance.html and the two mockups are generated. If someone edits one
    by hand, the document and the game stop agreeing — which is exactly the kind
    of drift nobody notices until it is expensive."""
    generated = ["docs/balance.html", "docs/app-mockup.html", "docs/setup-mockup.html",
                 "game/index.html"]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        for script in ["build_balance_doc.py", "build_mockup.py", "build_setup_mockup.py",
                       "build_game.py"]:
            r = subprocess.run([sys.executable, str(work / "tools" / script)],
                               capture_output=True, text=True, cwd=work)
            if r.returncode:
                problems.append(f"{script} وقع — {r.stderr.strip().splitlines()[-1] if r.stderr else ''}")
                return
        for rel in generated:
            a, b = (ROOT / rel).read_text(encoding="utf-8"), (work / rel).read_text(encoding="utf-8")
            if a != b:
                problems.append(f"{rel} اتعدّل بالإيد — لازم يتولّد من tools/ عشان الأرقام ما تختلفش")


def check_simulator(problems):
    """Runs the balance simulator — which runs the game's own engine — and
    asserts the shape of the game still holds. A balance edit that quietly makes
    the game unplayable, or pointless, is invisible in a diff."""
    if not shutil.which("node"):
        problems.append("تحذير: node مش متثبت — المحاكي اتخطى")
        return
    r = subprocess.run(["node", str(TOOLS / "simulate.js"), "--json"], capture_output=True, text=True)
    if r.returncode:
        problems.append("المحاكي وقع — " + (r.stderr or r.stdout).strip()[:200])
        return
    sim = json.loads(r.stdout)
    st = sim["start"]
    if not 45 <= st["approval"] <= 68:
        problems.append(f"الرضا عند البداية {st['approval']} — المفروض بين ٤٥ و٦٨")
    if not 55 <= st["stability"] <= 85:
        problems.append(f"الثبات عند البداية {st['stability']} — المفروض بين ٥٥ و٨٥")
    if not 40 <= st["avgService"] <= 72:
        problems.append(f"متوسط الخدمات {st['avgService']} — المفروض بين ٤٠ و٧٢")

    fm = sim["firstMonth"]
    if abs(fm["net"]) > 200:
        problems.append(f"صافي أول شهر {fm['net']}م — المفروض قريب من الصفر عشان اللاعب يبدأ مخنوق")

    passive = sim["players"]["سلبي"]["lifespan"]
    good = sim["players"]["معقول"]["lifespan"]
    if passive > 220:
        problems.append(f"اللاعب السلبي عايش {passive} شهر — الوقوف مكانك المفروض يخسّر")
    if good < passive * 1.5:
        problems.append(f"اللاعب الكويس عايش {good} شهر والسلبي {passive} — "
                        "الفرق صغير، يعني قرارات اللاعب مش مهمة")

    # Managing the cabinet must help, but it must not BE the game. The first
    # version of the minister screens let a player who only shuffled ministers
    # outlive everyone and never die — invisible in every other number.
    shuffler = sim["players"]["مقلّب"]["lifespan"]
    if shuffler <= good:
        problems.append(f"المقلّب عايش {shuffler} شهر والمعقول {good} — "
                        "إدارة الوزرا مش بتفيد بحاجة، الشاشات دي بقت ديكور")
    if shuffler > good * 1.45:
        problems.append(f"المقلّب عايش {shuffler} شهر والمعقول {good} — "
                        "تقليب الوزرا لوحده بقى أقوى من إدارة الدولة")
    # The simulator stops at a fixed horizon, so a player who reaches it never
    # died. That ceiling is what hid the problem the first time.
    horizon = int(re.search(r"const MONTHS = (\d+);",
                            (TOOLS / "simulate.js").read_text(encoding="utf-8")).group(1))
    for name in ("معقول", "مقلّب"):
        if sim["players"][name]["lifespan"] >= horizon:
            problems.append(f"«{name}» وصل آخر المحاكاة ({horizon} شهر) وما ماتش — "
                            "يعني فيه طريقة لعب بتخلّيك خالد، وإحنا مش شايفينها")

    # No starting combination may be hopeless. Anything under a third of the best
    # is not a hard mode, it is a trap for whoever picks it.
    combos = sim["combos"]
    best = max(combos.values())
    for name, life in combos.items():
        if life < best / 3:
            problems.append(f"تركيبة «{name}» عايشة {life} شهر مقابل {best} لأحسن تركيبة — "
                            "دي مش صعوبة، دي فخ")


def check_android(problems):
    """The Android project cannot be compiled here — no SDK, and the network
    blocks Google's servers. tools/check_android.py stands in for the compiler."""
    sys.path.insert(0, str(TOOLS))
    import check_android
    check_android.check(problems)


def check_installable(problems):
    """The game installs on a phone as an app. That needs a manifest, icons and
    a service worker that all agree with each other — and a missing icon or a
    typo'd path fails silently, leaving the install button simply absent."""
    game = ROOT / "game"
    mf = game / "manifest.webmanifest"
    if not mf.exists():
        problems.append("مفيش ملف manifest — اللعبة مش هتتثبت على الموبايل")
        return
    try:
        m = json.loads(mf.read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"manifest مش بيتقري — {e}")
        return
    for key in ("name", "start_url", "scope", "display", "icons", "background_color"):
        if key not in m:
            problems.append(f"manifest ناقصه «{key}»")
    for ic in m.get("icons", []):
        if not (game / ic["src"]).exists():
            problems.append(f"manifest بيشاور على أيقونة مش موجودة: {ic['src']}")
    if not any(i.get("purpose") == "maskable" for i in m.get("icons", [])):
        problems.append("مفيش أيقونة maskable — الأندرويد هيقص الأيقونة غلط")
    if m.get("display") != "standalone":
        problems.append("manifest لازم display يكون standalone عشان تفتح من غير المتصفح")

    sw = game / "sw.js"
    if not sw.exists():
        problems.append("مفيش sw.js — اللعبة مش هتشتغل من غير نت")
        return
    swt = sw.read_text(encoding="utf-8")
    # everything the worker promises to cache must actually be there
    for rel in re.findall(r"'\./([\w.-]+)'", swt):
        if rel and not (game / rel).exists():
            problems.append(f"sw.js بيحاول يخزّن ملف مش موجود: {rel}")
    page = (game / "index.html").read_text(encoding="utf-8")
    if 'rel="manifest"' not in page:
        problems.append("game/index.html مش رابط الـmanifest — الموبايل مش هيعرض زرار التثبيت")
    if "serviceWorker" not in page:
        problems.append("اللعبة مش بتسجّل الـservice worker — مفيش تشغيل من غير نت")


def check_progress_bar(problems):
    """The plan has 26 items and the home page draws one slot each. A patched
    bar quietly grows or shrinks, and then the page lies about where we are."""
    src = (ROOT / "index.html").read_text(encoding="utf-8")
    m = re.search(r'<div class="prog">(.*?)</div>', src, re.S)
    if not m:
        problems.append("index.html: شريط التقدم مش موجود")
        return
    slots = m.group(1).count("<i")
    if slots != 26:
        problems.append(f"index.html: شريط التقدم فيه {slots} خانة والخطة ٢٦ بند")
    if not re.search(r'href="game/"', src):
        problems.append("index.html: رابط اللعبة مش موجود في الصفحة الرئيسية")


def check_game_runs(problems):
    """Drives the real bundle through a fake DOM: setup, all 12 government and
    society combinations, five years of months, every tab. This is what looks at
    the game, since neither of us can."""
    if not shutil.which("node"):
        problems.append("تحذير: node مش متثبت — اختبار اللعبة اتخطى")
        return
    r = subprocess.run(["node", str(TOOLS / "test_game.js")], capture_output=True, text=True)
    if r.returncode:
        for line in (r.stdout + r.stderr).strip().splitlines():
            line = line.strip()
            if line.startswith("•"):
                problems.append("اللعبة: " + line[1:].strip())
        if not any(p.startswith("اللعبة:") for p in problems):
            problems.append("اللعبة: الاختبار وقع — " + (r.stderr or r.stdout).strip()[:200])


CHECKS = [
    check_html_structure, check_anchors, check_tables, check_theme, check_svg,
    check_javascript, check_balance_json, check_setup_json, check_ministers_json, check_treasury, check_parliament, check_bank,
    check_browser_globals_are_faked, check_engine_is_repeatable,
    check_simulator_has_no_rules,
    check_ui_once_only, check_navigation, check_clipped_text,
    check_every_class_is_styled,
    check_generated_files_match, check_android, check_installable, check_progress_bar, check_game_runs, check_simulator,
]


def main():
    problems = []
    # tools/test_check.py runs this ~90 times, once per deliberate breakage.
    # The generated-files check copies the repo and rebuilds four documents, so
    # it alone is half the runtime. It has its own breakage cases, so the others
    # may skip it. Never set this in CI — the real push runs everything.
    skip = set(filter(None, os.environ.get("CHECK_SKIP", "").split(",")))
    for fn in CHECKS:
        if fn.__name__ in skip:
            continue
        before = len(problems)
        try:
            fn(problems)
        except Exception as e:
            problems.append(f"الفحص {fn.__name__} نفسه وقع — {type(e).__name__}: {e}")
        mark = "✗" if len(problems) > before else "✓"
        print(f"  {mark} {fn.__name__}")

    print()
    if problems:
        print(f"✗ فيه {len(problems)} مشكلة:\n")
        for p in problems:
            print(f"   • {p}")
        print("\nالبناء اتوقف. صلّح المشاكل دي وارفع تاني.")
        return 1
    print(f"✓ كل الفحوصات عدّت ({len(CHECKS)} فحص).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
