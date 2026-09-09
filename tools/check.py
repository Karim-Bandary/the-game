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


# The files the project cannot work without. When one of these goes missing,
# every check that reads it crashes, and the build prints seven variations of
# "the check itself fell over" with a Python path in them — which tells Karim
# nothing about what he actually has to do. This runs first and says the one
# thing that matters: which file is gone.
REQUIRED = [
    ("index.html", "الصفحة الرئيسية للمشروع"),
    ("game/index.html", "اللعبة الملزوقة"),
    ("game/src/index.html", "قالب اللعبة"),
    ("game/src/engine.js", "المحرك"),
    ("game/src/ui.js", "الشاشات"),
    ("game/src/style.css", "التنسيق"),
    ("game/src/art.js", "الرسومات"),
    ("docs/design.html", "وثيقة التصميم"),
    ("docs/balance.html", "وثيقة الميزان"),
    ("docs/app-mockup.html", "ماكيت التطبيق"),
    ("docs/setup-mockup.html", "ماكيت شاشة البداية"),
    ("docs/budget-mockup.html", "ماكيت الميزانية"),
]


def check_required_files(problems):
    """Nothing clever — just names the missing file in one sentence.

    Without this, a file deleted by accident on GitHub turns into a wall of
    FileNotFoundError from seven other checks, and the message the build ends
    with is about Python, not about the file. That happened, and it cost a round
    of «I don't understand what to upload»."""
    for rel, what in REQUIRED:
        if not (ROOT / rel).exists():
            problems.append(f"الملف «{rel}» ({what}) مش موجود في المشروع خالص — "
                            f"غالبًا اتمسح بالغلط. ارفعه تاني وكل الباقي هيمشي.")


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


def check_situations(problems):
    """Situations stop the clock, so every one of them is an interruption the
    player did not ask for. Three things must hold or the feature turns against
    the game: a condition must name something real (otherwise the card waits for
    a state that can never happen and is dead content), an effect must name
    something real (otherwise the player spends AP on a button that does
    nothing), and the rate must be bounded (otherwise the game nags)."""
    try:
        s = json.loads((DATA / "situations.json").read_text(encoding="utf-8"))
        b = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
        m = json.loads((DATA / "ministers.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"situations.json مش بيتقري — {e}")
        return
    src = strip_js_comments((ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8"))

    def names(block):
        body = src.split("var " + block + " = {", 1)[1].split("\n};", 1)[0]
        return set(re.findall(r"^\s{2}([a-zA-Z]+):", body, re.M))

    probes, effects = names("PROBES"), names("EFFECTS")
    services, govs = set(b["services"]), set(b["governorates"])
    posts = {p["id"] for p in m["posts"]}

    def probe_ok(k):
        if k in probes:
            return True
        p = k.split(".")
        return ((p[0] == "service" and p[1] in services)
                or (p[0] == "gov" and p[1] in govs)
                or (p[0] == "minister" and len(p) == 3 and p[1] in posts
                    and p[2] in ("loyalty", "competence")))

    def effect_ok(k):
        if k in effects:
            return True
        p = k.split(".")
        return ((p[0] == "pct" and p[1] in services)
                or (p[0] == "build" and len(p) == 3 and p[1] in services and p[2] in govs)
                or (p[0] == "minister" and len(p) == 3 and p[1] in posts
                    and p[2] in ("loyalty", "competence")))

    ids = [x["id"] for x in s["situations"]]
    if len(ids) != len(set(ids)):
        problems.append("فيه موقفين بنفس الـ id")

    for sit in s["situations"]:
        for c in sit.get("when", []):
            if not probe_ok(c[0]):
                problems.append(f"موقف «{sit['id']}» شرطه على «{c[0]}» وهي مش موجودة — "
                                f"الموقف ده مش هيظهر أبدًا")
            if c[1] not in ("<", ">", "<=", ">=", "=="):
                problems.append(f"موقف «{sit['id']}»: مقارنة مش معروفة «{c[1]}»")
        if len(sit.get("choices", [])) < 2:
            problems.append(f"موقف «{sit['id']}» فيه اختيار واحد — ده مش قرار")
        for ch in sit.get("choices", []):
            for k in ch.get("effects", {}):
                if not effect_ok(k):
                    problems.append(f"موقف «{sit['id']}» اختيار «{ch['nm']}» بيغيّر «{k}» "
                                    f"وهي مش موجودة — الزرار ده مش هيعمل حاجة")
            for k in ch.get("cost", {}):
                if k not in ("ap", "treasury", "personal"):
                    problems.append(f"موقف «{sit['id']}»: تمن مش معروف «{k}»")
            paid = sum(abs(v) for v in ch.get("cost", {}).values())
            if not ch.get("effects") and paid:
                problems.append(f"موقف «{sit['id']}» اختيار «{ch['nm']}» بيدفع من غير ما يعمل حاجة")
        free = [ch for ch in sit.get("choices", []) if not ch.get("cost")]
        if not free:
            problems.append(f"موقف «{sit['id']}» كل اختياراته ليها تمن — لاعب مفلس "
                            f"مش هيقدر يجاوب، والوقت واقف لحد ما يجاوب: اللعبة هتتقفل")
        if sit.get("weight", 0) <= 0:
            problems.append(f"موقف «{sit['id']}» وزنه صفر — مش هيتختار أبدًا")
        if sit.get("cooldown_months", 0) < 1:
            problems.append(f"موقف «{sit['id']}» ممكن يتكرر شهر ورا شهر")

    # ---- scandals ---------------------------------------------------------
    # A scandal is an ordinary situation with kind:"scandal". Everything above
    # applies to it unchanged; these are the extra promises the heat system
    # makes, and every one of them is a way the feature turns into nonsense.
    heat = b["heat"]
    scandals = [x for x in s["situations"] if x.get("kind") == "scandal"]
    if not scandals:
        problems.append("مفيش ولا فضيحة — نظام الشبهة بيعلى ومحصلش حاجة")
    over = [x for x in scandals if any(c[0] == "heat" for c in x.get("when", []))]
    for sit in scandals:
        if sit not in over:
            problems.append(f"فضيحة «{sit['id']}» شرطها مش على الشبهة — "
                            f"هتحصل لرئيس نضيف من غير سبب يشوفه")
        # The heat line the player watches is scandal_at. A scandal that can
        # only fire above the cap can never fire at all.
        for c in sit.get("when", []):
            if c[0] == "heat" and c[2] >= heat["cap"]:
                problems.append(f"فضيحة «{sit['id']}» عايزة شبهة {c[2]} والسقف "
                                f"{heat['cap']} — مش هتحصل أبدًا")
    # At least one scandal must be reachable at the line the game advertises,
    # or scandal_at is a number that means nothing.
    lines = [c[2] for x in scandals for c in x.get("when", []) if c[0] == "heat"]
    if lines and min(lines) > heat["scandal_at"]:
        problems.append(f"أقل فضيحة عايزة شبهة {min(lines)} والخط المعلن "
                        f"{heat['scandal_at']} — الخط بيكدب على اللاعب")
    # Both kinds of president must have content. A set of scandals that all
    # require theft leaves a failing-but-honest government with a suspicion
    # meter and nothing at the end of it; a set where none does means an honest
    # president gets accused of taking money he never took.
    theft = [x for x in scandals
             if any(c[0] == "stolenTotal" for c in x.get("when", []))]
    if scandals and not theft:
        problems.append("مفيش ولا فضيحة شرطها إن اللاعب سرق فعلاً — "
                        "يعني ممكن يتفتح ملف فلوس على رئيس ما خدش مليم")
    if scandals and len(theft) == len(scandals):
        problems.append("كل الفضايح عايزة سرقة — يعني رئيس نضيف حكومته بتنهار "
                        "الشبهة بتعلى عنده ومفيش حاجة بتحصل")
    for sit in s["situations"]:
        if sit.get("kind") not in (None, "situation", "scandal"):
            problems.append(f"موقف «{sit['id']}» نوعه «{sit['kind']}» مش معروف")

    sr = s.get("scandal_rate")
    if not sr:
        problems.append("مفيش بوابة معدّل للفضايح — الفضيحة هتحصل كل شهر")
        return
    # The two gates are independent, so the worst year is their sum. The player
    # asked for situations to stop the clock; five interruptions a year is
    # already one every ten weeks, and past that the game is nagging him.
    worst = s["rate"]["max_per_year"] + sr["max_per_year"]
    if worst > 5:
        problems.append(f"أسوأ سنة فيها {worst} مقاطعة (مواقف + فضايح) — ده كتير، "
                        f"وكل واحدة بتوقف الوقت")
    if sr["min_gap_months"] < s["rate"]["min_gap_months"]:
        problems.append("الفضايح بتيجي ورا بعض أسرع من المواقف العادية — "
                        "الرئيس اللي في ورطة هيتحاصر")
    if not (0 < sr["chance_per_month"] <= 1):
        problems.append(f"احتمال الفضيحة الشهري {sr['chance_per_month']} غلط")

    r = s["rate"]
    if r["min_gap_months"] < 2:
        problems.append("المواقف ممكن تيجي ورا بعض — واللاعب اختار إن كل موقف يوقف الوقت، "
                        "يعني اللعبة هتبقى مقاطعة مستمرة")
    if not (0 < r["chance_per_month"] <= 1):
        problems.append(f"احتمال الموقف الشهري {r['chance_per_month']} غلط")
    if r["max_per_year"] > 6:
        problems.append(f"{r['max_per_year']} موقف في السنة كتير — كل واحد بيوقف الوقت")
    if r["max_per_year"] < 1:
        problems.append("مفيش مواقف في السنة خالص — النظام كله ميت")


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
        # Either as its own global, or hung off the fake window — which is how
        # the page reaches localStorage, so the fake has to be allowed to put it
        # in the same place.
        if (not re.search(r"global\." + g + r"\s*=", test)
                and not re.search(r"^\s*" + g + r"\s*:", test, re.M)):
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
        "el('artdefs').innerHTML": "تركيب تعريفات الرسومات",
        "function drawView()": "دالة رسم الشاشة",
        "document.addEventListener('click'": "مستقبل الضغطات",
    }
    for needle, name in once.items():
        n = src.count(needle)
        if n != 1:
            problems.append(f"ui.js: «{name}» مكرر {n} مرة والمفروض مرة واحدة بس")


def check_no_duplicated_block(problems):
    """A whole block of code pasted in twice. It has happened twice already —
    a scripted edit put the service-worker block in three times, and a retried
    edit added the defence minister's explanation to the same function twice —
    and neither one breaks anything visibly: the game runs, it just does the
    work again, or silently uses the first of two branches and leaves the second
    unreachable.

    check_ui_once_only watches three specific lines by name, which only ever
    catches the duplications we already know about. This is the general form:
    no run of six or more identical non-trivial lines may appear twice in the
    same file. Six is high enough that a repeated `}` or a shared two-line
    pattern does not trip it."""
    RUN = 6
    for rel in ("game/src/ui.js", "game/src/engine.js"):
        src = strip_js_comments((ROOT / rel).read_text(encoding="utf-8"))
        lines = [ln.rstrip() for ln in src.splitlines()]
        # Trivial lines (a lone brace, a blank) are not evidence of anything.
        def solid(i):
            return len(lines[i].strip()) > 4
        seen, reported = {}, set()
        for i in range(len(lines) - RUN + 1):
            window = lines[i:i + RUN]
            if sum(1 for j in range(i, i + RUN) if solid(j)) < RUN:
                continue
            key = "\n".join(window)
            if key in seen and key not in reported:
                reported.add(key)
                problems.append(
                    f"{rel}: نفس الـ{RUN} سطور مكرّرة (السطر {seen[key] + 1} "
                    f"والسطر {i + 1}) — «{window[0].strip()[:60]}». نسخة تانية من "
                    f"نفس الكود مش بتكسر حاجة، هي بس بتشتغل مرتين أو بتسيب النسخة "
                    f"التانية ميتة، ومفيش حاجة بتشتكي")
            elif key not in seen:
                seen[key] = i


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


def check_meters_fit_their_grid(problems):
    """The top bar is a fixed grid. Adding a meter without widening the grid
    wraps the last one onto a second row, which on a phone reads as a rendering
    bug — and nothing in the code is wrong, so nothing fails. The count is read
    from the two files that have to agree instead of being written down."""
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    css = (ROOT / "game" / "src" / "style.css").read_text(encoding="utf-8")
    block = ui.split("function drawTop()", 1)
    if len(block) < 2:
        problems.append("ui.js: مفيش دالة drawTop")
        return
    arr = block[1].split("var m = [", 1)
    if len(arr) < 2:
        problems.append("ui.js: مش لاقي قايمة المؤشرات في drawTop")
        return
    meters = len(re.findall(r"^\s{4}\['", arr[1].split("\n  ];", 1)[0], re.M))
    m = re.search(r"\.meters\{[^}]*repeat\((\d+),\s*1fr\)", css)
    if not m:
        problems.append("style.css: شبكة الشريط العلوي مش مكتوبة بـ repeat(N,1fr)")
        return
    cols = int(m.group(1))
    if meters != cols:
        problems.append(f"الشريط العلوي فيه {meters} مؤشر والشبكة {cols} خانة — "
                        f"الأخير هينزل سطر تاني على الموبايل")


def strip_css_comments(css):
    """Selectors are read by taking whatever sits between } and {, so a comment
    written above a rule becomes part of that rule's "selector" and the rule
    stops being recognised. Three CSS checks were reading the file that way and
    silently skipping every rule that had an explanation above it — which is to
    say, exactly the rules somebody thought were worth explaining."""
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def check_no_class_defined_twice(problems):
    """One bare class, one block. Reusing a class name for a second, unrelated
    thing on a different screen already happened: the situation card's choice
    buttons were called .opt, the setup screen's government cards were also
    .opt, and the later block silently restyled a screen nobody was looking at.
    Nothing errors, nothing logs, and it only shows up on a phone.

    Compound selectors (.opt.sel, .opt .hd) are how a class is meant to be
    extended, so they do not count — only a second plain `.x { }`."""
    css = strip_css_comments((ROOT / "game" / "src" / "style.css").read_text(encoding="utf-8"))
    seen = {}
    for sel, _ in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        for one in sel.split(","):
            one = one.strip()
            if re.fullmatch(r"\.[A-Za-z][\w-]*", one):
                seen[one] = seen.get(one, 0) + 1
    for name, n in sorted(seen.items()):
        if n > 1:
            problems.append(f"style.css: الكلاس «{name}» متعرّف {n} مرة كقاعدة لوحدها — "
                            f"يعني شاشتين مختلفين بيستخدموا نفس الاسم، والتانية بتغيّر "
                            f"شكل الأولى من غير ما حد ياخد باله")


def check_modifier_is_not_a_block(problems):
    """A rule written as `.mtr.danger { }` means "danger modifies a meter". If a
    bare `.danger { }` also exists and gives something a box — width, border,
    background, padding — then every meter that goes into the red also gets
    drawn as that box.

    That exact thing shipped: `.danger` is the big red action button, the meters
    reused the name for their alarm state, and a country in trouble rendered its
    top bar as a button-shaped red rectangle. Nothing in the markup is wrong and
    no test fails; it is only visible on a screen, in a state neither of us
    normally looks at.

    Colour-only and display:none utilities are not flagged — extending those on
    purpose is how CSS is meant to work, and a check that cries wolf gets
    ignored instead of obeyed."""
    css = strip_css_comments((ROOT / "game" / "src" / "style.css").read_text(encoding="utf-8"))
    rules = re.findall(r"([^{}]+)\{([^{}]*)\}", css)
    boxy = re.compile(r"\b(background|border|padding|margin|width|height|box-shadow|position)\b")
    bare = {}
    compound = []
    for sel, body in rules:
        for one in sel.split(","):
            one = " ".join(one.split())
            if re.fullmatch(r"\.[A-Za-z][\w-]*", one):
                bare[one[1:]] = bare.get(one[1:], "") + body
            m = re.fullmatch(r"\.([A-Za-z][\w-]*)\.([A-Za-z][\w-]*)", one)
            if m:
                compound.append((m.group(1), m.group(2)))
    for base, mod in compound:
        body = bare.get(mod)
        if body and boxy.search(body):
            problems.append(
                f"style.css: «{mod}» مستخدم كحالة على «{base}» (‏.{base}.{mod}) وكمان ليه "
                f"قاعدة لوحده بتديله شكل صندوق — يعني أي «{base}» بيدخل الحالة دي "
                f"هيترسم بشكل الحاجة التانية خالص")


def check_clipped_text(problems):
    """A line placed at bottom:-2px inside an overflow:hidden box has its lower
    half sliced off. It shipped that way for weeks: nothing in the HTML is
    wrong, no test fails, and it only shows up if somebody looks at the screen.
    So the rule is mechanical instead — nothing inside a clipping box may be
    positioned outside it."""
    css = strip_css_comments((ROOT / "game" / "src" / "style.css").read_text(encoding="utf-8"))
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


def check_crackdown(problems):
    """Repression is a button the player presses in a bad month, so the one way
    it can be wrong is by not being a decision at all: if the worst outcome of
    pressing it is "nothing happened", there is no reason ever not to press it,
    and the screen becomes a chore instead of a choice. Everything below is a
    way that happens without anything looking broken."""
    try:
        c = json.loads((DATA / "crackdown.json").read_text(encoding="utf-8"))
        setup = json.loads((DATA / "setup.json").read_text(encoding="utf-8"))
        b = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"crackdown.json مش بيتقري — {e}")
        return
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))

    win, fail = c["win"], c["fail"]
    # The failure has to hurt more than standing still, in the direction that
    # matters: the boil is what kills you.
    if fail["boil"] <= 0:
        problems.append("القمع الفاشل مش بيزوّد الغليان — يبقى أسوأ حاجة ممكن تحصل "
                        "هي «مفيش فايدة»، ومفيش سبب واحد إن اللاعب ما يدوسش الزرار كل مرة")
    if fail["approval"] >= win["approval"]:
        problems.append("القمع الفاشل تمنه على الرضا زي الناجح أو أقل — الفشل مالوش معنى")
    if win["boil"] >= 0:
        problems.append("القمع الناجح مش بينزّل الغليان — الزرار ده مالوش لازمة")
    # And the success has to cost something, or it is a free reset button.
    if win["approval"] >= 0 and win["heat"] <= 0:
        problems.append("القمع الناجح ببلاش — يبقى زرار بيصفّر الغليان من غير تمن")

    if c["boil_floor"] <= 0:
        problems.append("ينفع تقمع شارع هادي — يبقى القمع صيانة دورية مش قرار في أزمة")
    if c["boil_floor"] >= b["mood"]["boil_cap"]:
        problems.append(f"القمع مش مسموح غير عند غليان {c['boil_floor']} والانفجار عند "
                        f"{b['mood']['boil_cap']} — الزرار هيفتح بعد ما الأوان يفوت")
    if c["cost"]["once_per_months"] < 1:
        problems.append("ينفع تقمع كل شهر — الشارع هيبقى ماكينة بتتصفّر بزرار")

    # The setup screen sells the dictatorship partly on this. Same rule as the
    # army: a promise on that screen has to be a number in the data.
    by_gov = c.get("success_by_government", {})
    for g in setup["government_types"]:
        if g["id"] not in by_gov:
            problems.append(f"نظام الحكم «{g['nm']}» مالوش رقم في نجاح القمع — "
                            f"وشاشة البداية بتقارن الأنظمة بالحاجة دي")
    if by_gov and len(set(by_gov.values())) == 1:
        problems.append("كل أنظمة الحكم القمع بينجح عندهم بنفس النسبة — "
                        "يبقى اختيار النظام مالوش أثر على القمع")
    if by_gov.get("dictator") is not None and by_gov["dictator"] <= max(
            v for k, v in by_gov.items() if k != "dictator"):
        problems.append("القمع مش بينجح عند الديكتاتوري أكتر من غيره — "
                        "وشاشة البداية بتوعده بالعكس")

    s = c["success"]
    if not (0 < s["min_pct"] < s["max_pct"] <= 100):
        problems.append("مدى نجاح القمع غلط")
    if s["min_pct"] >= 50:
        problems.append(f"أقل احتمال نجاح للقمع {s['min_pct']}٪ — يعني حتى أسوأ وزير "
                        f"داخلية القمع عنده مضمون تقريبًا، والمنصب مالوش لازمة")

    if "crackdownChance" not in ui:
        problems.append("ui.js: احتمال نجاح القمع مش مكتوب على الشاشة — "
                        "قرار بتمن مستخبي")
    if "'data-crack'" not in ui.split("var CLICKABLE = [")[-1].split("]")[0]:
        problems.append("ui.js: زرار القمع مش مسجّل في قايمة الضغطات — هيبان وميعملش حاجة")
    # Both outcomes must be on the card before the tap, not just the good one.
    panel = ui.split("function streetPanel()")[-1].split("\n}")[0]
    if "fail" not in panel:
        problems.append("ui.js: كارت القمع مش بيقول بيحصل إيه لو فشل — "
                        "زرار بيعلن نتيجته الحلوة بس")


def check_army(problems):
    """The army is the one system that can end a game outright, and it is the
    one the player asked to have NO meter of its own — the defence minister's
    loyalty is the army. That makes three things load-bearing, and all three are
    invisible if they break: the risk must be escapable, the bribe must be
    priced before it is pressed, and the whole thing must be reachable on a
    screen."""
    try:
        a = json.loads((DATA / "army.json").read_text(encoding="utf-8"))
        m = json.loads((DATA / "ministers.json").read_text(encoding="utf-8"))
        setup = json.loads((DATA / "setup.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"army.json مش بيتقري — {e}")
        return
    src = strip_js_comments((ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8"))
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))

    if not any(p["id"] == "defence" for p in m["posts"]):
        problems.append("مفيش وزير دفاع — والجيش كله مبني على ولاؤه")
        return

    # One capped adder for the risk, exactly like the suspicion meter. A bare
    # `S.coupRisk +=` outside the month is how a capped number stops being
    # capped, and here that means an ending that fires at the wrong time.
    bumps = re.findall(r"S\.coupRisk\s*\+=", src)
    if bumps:
        problems.append("engine.js: فيه سطر بيزوّد خطر الانقلاب من غير سقف")

    if a["risk_decay_above"] <= 0:
        problems.append("خطر الانقلاب مبينزلش أبدًا — يعني أول ما ولاء وزير الدفاع "
                        "ينزل مرة واحدة، اللعبة خلصت مهما اللاعب عمل إيه")
    if not (0 < a["loyalty_line"] < 100):
        problems.append(f"خط الجيش {a['loyalty_line']} برّه المدى ٠..١٠٠")

    # The line differs by government, and the setup screen sells the
    # dictatorship on exactly that. A government with no entry would quietly
    # fall back to the default and the screen would be promising a danger the
    # engine does not apply.
    by_gov = a.get("line_by_government", {})
    for g in setup["government_types"]:
        if g["id"] not in by_gov:
            problems.append(f"نظام الحكم «{g['nm']}» مالوش خط جيش في army.json — "
                            f"هياخد الخط العام، وشاشة البداية بتبيع خطر مختلف")
        elif not (0 < by_gov[g["id"]] < 100):
            problems.append(f"خط جيش «{g['nm']}» ({by_gov[g['id']]}) برّه المدى ٠..١٠٠")
    if by_gov and len(set(by_gov.values())) == 1:
        problems.append("كل أنظمة الحكم ليها نفس خط الجيش — يبقى اختيار النظام "
                        "مالوش أي أثر على الجيش، وشاشة البداية بتقول العكس")
    # The dictator's legitimacy comes FROM the army, so his line has to be the
    # strictest, or the screen that says the army is the one thing he fears is
    # simply wrong.
    if by_gov.get("dictator") is not None and by_gov["dictator"] <= max(
            v for k, v in by_gov.items() if k != "dictator"):
        problems.append("خط الجيش عند الديكتاتوري مش أعلى واحد — وشاشة البداية "
                        "بتقول إن الجيش هو الحاجة الوحيدة اللي بيخاف منها")

    # And every screen must read the line through the same function, or two
    # screens will quote two different numbers for the same rule.
    if "ARMY.loyalty_line" in ui:
        problems.append("ui.js: فيه شاشة بتقرا الخط العام مش خط نظام الحكم — "
                        "هتكتب رقم غير اللي المحرك بيحسب بيه")

    # The bribe must be able to lift a minister who is under the line back over
    # it inside the cooldown, or it is a button that cannot save anybody.
    b = a["bribe"]
    if b["loyalty_gain"] <= 0:
        problems.append("الرشوة مش بترفع ولاء حد — الزرار ده مالوش لازمة")
    if b["once_per_months"] < 1:
        problems.append("ينفع تدفع للجيش كل شهر — يبقى الجيش مجرد اشتراك شهري")
    # And it must cost something that is not free to get. Personal money is the
    # whole point: it is the money you had to steal for.
    if not b.get("cost"):
        problems.append("الرشوة ببلاش — والدايرة اللي اللعبة مبنية عليها (تسرق عشان "
                        "تدفع للجيش) مش هتقفل")
    if b["lost_loyalty_gain"] >= b["loyalty_gain"]:
        problems.append("لما الوزير ياخد الرشوة ويسرقها اللاعب بياخد نفس النتيجة — "
                        "يعني احتمال الضياع اللي مكتوب على الزرار مالوش أي معنى")
    if b["lost_max_pct"] >= 100:
        problems.append("ممكن الرشوة تضيع بنسبة ١٠٠٪ — يبقى فيه حالة اللاعب مالهوش "
                        "أي طريقة يرجّع بيها الجيش")

    # Reachable, and priced before the tap — the same rule the treasury screen
    # follows for the leak chance.
    if "bribeArmy" not in ui:
        problems.append("ui.js: مفيش زرار للرشوة — الجيش بيخسر واللاعب مالوش أي رد")
    if "bribeLostChance" not in ui:
        problems.append("ui.js: احتمال ضياع الرشوة مش مكتوب على الزرار — "
                        "خطر مستخبي، وده بالظبط اللي بنتجنّبه في اللعبة كلها")
    if "'data-bribe'" not in ui.split("var CLICKABLE = [")[-1].split("]")[0]:
        problems.append("ui.js: زرار الرشوة مش مسجّل في قايمة الضغطات — هيبان وميعملش حاجة")
    if "S.coupRisk" not in ui:
        problems.append("ui.js: خطر الانقلاب مش ظاهر في أي شاشة — نهاية من رقم "
                        "اللاعب ما شافوش")

    # The setup screen sells the dictatorship on this exact number. If it names
    # a mechanic the engine does not have, the player is choosing a government
    # on a promise that will not be kept.
    # Both copies of that screen: the generated data AND the game's own summary
    # step, which is a separate block of text in ui.js. Checking only the data
    # let the game keep quoting a retired rule for a whole item.
    blob = json.dumps(setup, ensure_ascii=False)
    for where, text in (("setup.json", blob), ("ui.js", ui)):
        if "رضا الجيش" in text:
            problems.append(f"{where}: لسه بيتكلم عن «رضا الجيش» وهو مش موجود في "
                            f"اللعبة — الجيش بقى ولاء وزير الدفاع")
    # And the line itself must be quoted from the data wherever it is shown, not
    # typed out, or it goes stale the next time it moves.
    for m in re.finditer(r"وزير الدفاع تحت (\d+)", ui + blob):
        problems.append(f"فيه نص مكتوب فيه خط الجيش بالإيد ({m.group(1)}) — "
                        f"لازم يتقري من army.json وإلا هيقدم لوحده")


def check_minister_notes_match_the_rules(problems):
    """Each post carries a one-line note saying what he is for, and the game
    prints it under his name. The media minister's said his LOYALTY slowed
    scandals down while the engine was reading his COMPETENCE — two lines on the
    same screen contradicting each other, and the player has no way to know
    which one to believe.

    So: a note that names a stat must name the stat the engine actually reads
    for that post. Which stat that is comes from the engine, not from a list
    here, so wiring a post up differently later moves this check with it."""
    try:
        m = json.loads((DATA / "ministers.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"ministers.json مش بيتقري — {e}")
        return
    src = strip_js_comments((ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8"))
    for post in m["posts"]:
        pid, note = post["id"], post.get("note", "")
        # A post that owns services is read through ministerComp() by the
        # generic funding rule, so competence always counts for those.
        reads_comp = bool(post["services"]) or bool(
            re.search(r"ministerComp\(\s*S\s*,\s*'" + pid + r"'\s*\)", src)
            or re.search(r"ministers\." + pid + r"\.competence", src)
            or re.search(r"ministers\['" + pid + r"'\]\.competence", src))
        if "كفاء" in note and not reads_comp:
            problems.append(f"«{post['name']}»: الوصف بيقول كفاءته بتعمل حاجة، "
                            f"والمحرك مش بيقرا كفاءته أصلاً")

    # And the other direction: a post the engine treats specially must have a
    # line on his own screen explaining it. Loyalty is deliberately NOT checked
    # the same way — every minister's loyalty feeds the suspicion meter now, so
    # "his loyalty matters" is true of all nine and the check would prove
    # nothing.
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    effect = ui.split("function ministerEffect(", 1)
    if len(effect) < 2:
        problems.append("ui.js: مفيش دالة بتشرح تأثير الوزير")
        return
    effect = effect[1].split("\n}", 1)[0]
    for post in m["posts"]:
        pid = post["id"]
        special = bool(re.search(r"'" + pid + r"'", src)) and not post["services"]
        if special and ("'" + pid + "'") not in effect:
            problems.append(f"«{post['name']}» ليه قاعدة خاصة في المحرك ومفيش سطر "
                            f"على شاشته بيشرحها — اللاعب هيقرا «تأثيره لسه ما اتوصّلش»")


def check_heat(problems):
    """Suspicion is the one number in the game that the player cannot see the
    cause of by looking at a screen — it is a running total. So the rules are
    about keeping it honest: it must be able to go down as well as up (a number
    that only rises is a countdown, not a choice), the media minister must
    actually be able to hold a normal cabinet, and every source must go through
    the one capped adder."""
    try:
        b = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
        m = json.loads((DATA / "ministers.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"balance.json مش بيتقري — {e}")
        return
    h = b.get("heat")
    if not h:
        problems.append("مفيش قسم heat في balance.json")
        return
    src = strip_js_comments((ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8"))

    # One capped adder. A bare `S.heat +=` anywhere else is how a capped number
    # quietly stops being capped, and nothing looks wrong until a scandal fires
    # at a suspicion of 400.
    for mm in re.finditer(r"S\.heat\s*(\+=|-=)", src):
        problems.append("engine.js: فيه سطر بيزوّد الشبهة من غير ما يعدي على addHeat — "
                        "السقف بيتلغي من غير ما حد ياخد باله")
    if "function addHeat(" not in src:
        problems.append("engine.js: مفيش addHeat — الشبهة مش هيبقى ليها سقف")

    if h["monthly_decay"] <= 0:
        problems.append("الشبهة مبتنزلش لوحدها — يبقى الرقم عدّاد للموت مش قرار")

    # The media minister must be able to hold a cabinet that is merely ordinary.
    # If he cannot, suspicion rises forever on its own and every game ends the
    # same way whatever the player does.
    posts = len(m["posts"])
    # Six points under the floor, not twelve: the intended shape is that a
    # slightly disloyal cabinet is something a good media minister can carry,
    # and a collapsing one is not. Testing against a collapsing cabinet would
    # make the check demand a media minister who cancels any failure at all.
    ordinary_gap = 6
    talk = posts * ordinary_gap * h["disloyal_coef"]
    best_media = (100 - h["media_floor"]) * h["media_coef"]
    if talk > best_media + h["monthly_decay"]:
        problems.append(
            f"حكومة عادية بتطلّع {talk:.1f} شبهة في الشهر، وأحسن وزير إعلام + "
            f"النزول الطبيعي بيشيلوا {best_media + h['monthly_decay']:.1f} بس — "
            f"يعني حتى حكومة ولاؤها واطي شوية بتطلّع شبهة مفيش طريقة توقّفها")
    # And the reverse: a media minister who can cancel a whole corrupt cabinet
    # makes the post the only decision in the game.
    if best_media > talk * 2.5:
        problems.append("وزير إعلام واحد بيلغي حكومة كاملة مش موالية — "
                        "المنصب ده بقى الحل الوحيد لكل حاجة")

    if not (0 < h["scandal_at"] < h["cap"]):
        problems.append(f"خط الفضيحة {h['scandal_at']} برّه المدى ٠..{h['cap']}")

    # Stealing must be the expensive one, or the corruption screen and the heat
    # screen tell the player opposite things.
    if h["steal_per_100m"] <= h["print_per_100m"]:
        problems.append("السرقة شبهتها أقل من طباعة الفلوس أو زيها — "
                        "يبقى مفيش سبب تطبع أصلاً")

    # The heat must reach the screen. A number the player is punished by and
    # never shown is exactly what this whole system was built not to be.
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    if "S.heat" not in ui:
        problems.append("ui.js: الشبهة مش ظاهرة في أي شاشة — رقم بيعاقب اللاعب وهو مش شايفه")
    if "heatSources" not in ui:
        problems.append("ui.js: الشاشة مش بتوري الشبهة جاية منين — "
                        "القاعدة إن مفيش رقم من غير سبب مقروء")


def check_save(problems):
    """The save is the only thing in the project that can silently run the game
    on numbers from a build that no longer exists. That is worse than losing a
    game: nothing on screen says the rules changed underneath you.

    So: every save carries the build fingerprint, the loader refuses one that
    does not match, the save is written from the one place no branch can skip,
    it dies with the president, and no touch of storage is left unguarded."""
    engine = strip_js_comments((ROOT / "game" / "src" / "engine.js").read_text(encoding="utf-8"))
    ui = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    builder = (TOOLS / "build_game.py").read_text(encoding="utf-8")

    if "__BUILD__" not in builder or "sha256" not in builder:
        problems.append("build_game.py مش بيحط بصمة بناء في اللعبة — "
                        "الحفظ مش هيقدر يعرف إنه من نسخة قديمة")
    if "var BUILD" not in engine:
        problems.append("engine.js: مفيش بصمة بناء")

    if "function loadBlob(" not in engine or "function saveBlob(" not in engine:
        problems.append("engine.js: مفيش دوال حفظ/تحميل")
        return
    loader = engine.split("function loadBlob(", 1)[1].split("\n}", 1)[0]
    if "BUILD" not in loader:
        problems.append("engine.js: التحميل مش بيقارن بصمة البناء — حفظ من نسخة قديمة "
                        "هيتحمّل، واللعبة هتشتغل بأرقام نص/نص من غير ما حد ياخد باله")
    if "SAVE_VERSION" not in loader:
        problems.append("engine.js: التحميل مش بيقارن إصدار الحفظ")
    # It must be able to say no. A loader that always returns a state is not a
    # guard, whatever it checks on the way.
    if "return '" not in loader:
        problems.append("engine.js: التحميل مش بيرجّع سبب رفض أبدًا — يعني مفيش حفظ "
                        "هيترفض مهما كان")

    # Written from the redraw, so no branch of the click handler can forget it.
    draw = ui.split("function drawGame()", 1)
    if len(draw) < 2 or "persist()" not in draw[1].split("\n}", 1)[0]:
        problems.append("ui.js: الحفظ مش بيتكتب من drawGame — يعني فيه أفعال هتضيع، "
                        "وكل واحدة منها هتبقى «اللعبة أكلت حركتي»")
    persist = ui.split("function persist()", 1)
    if len(persist) < 2 or "S.dead" not in persist[1].split("\n}", 1)[0]:
        problems.append("ui.js: الحفظ مش بيتمسح لما اللاعب يموت — يعني الموت بقى "
                        "«اقفل التطبيق وافتحه تاني»، والعشوائية المحفوظة بالبذرة "
                        "مبقاش ليها لازمة")

    # Storage can be missing, full or switched off. Every touch goes through the
    # two guarded helpers, or a phone with site data blocked gets a dead app.
    if "function storeGet(" not in ui or "function storeSet(" not in ui:
        problems.append("ui.js: مفيش دوال آمنة للتخزين")
    else:
        for name in ("storeGet", "storeSet"):
            body = ui.split("function " + name + "(", 1)[1].split("\n}", 1)[0]
            if "try" not in body or "catch" not in body:
                problems.append(f"ui.js: {name} مش متغلّفة بـ try/catch — "
                                f"موبايل مقفّل عليه التخزين هياخد تطبيق ميت")
    stray = [m.start() for m in re.finditer(r"localStorage", ui)]
    guarded = ui.split("function storeGet(")[1].split("function loadPrefs")[0]
    if len(stray) > guarded.count("localStorage"):
        problems.append("ui.js: فيه استخدام لـ localStorage برّه storeGet/storeSet — "
                        "ده اللي بيقع التطبيق على موبايل مقفّل عليه التخزين")

    # And the log, which is written whole on every save.
    if "LOG_KEEP" not in engine:
        problems.append("engine.js: السجل مالوش حد — الحفظ هيكبر كل شهر في لعبة طويلة")
    elif re.search(r"S\.log\.push", ui):
        problems.append("ui.js: فيه سطر بيزوّد السجل من غير ما يعدي على logLine — "
                        "الحد بتاع السجل بيتلغي من غير ما حد ياخد باله")


def check_situation_card_is_compulsory(problems):
    """The player asked for every situation to stop the clock. That only holds if
    the card he answers on has no way out — and "no way out" is exactly the kind
    of promise that rots: somebody adds a ✕ for symmetry with the other sheets,
    or the phone's back key walks the stack and the card goes with it.

    So the rules are mechanical. The card is drawn from S.pendingSituation on
    every redraw, only the engine clears that field, and every route out of a
    screen — the back key, the sheet's close, the play button — is checked here
    by name. Each of these has a matching deliberate breakage in test_check.py."""
    src = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    shell = (ROOT / "game" / "src" / "index.html").read_text(encoding="utf-8")

    if 'id="sit"' not in shell:
        problems.append("index.html: مفيش مكان لكارت الموقف — الموقف هيوقف الوقت من غير ما يبان")
    if "function drawSituation()" not in src:
        problems.append("ui.js: مفيش دالة بترسم كارت الموقف")
        return
    # Drawn on every redraw, not once when the situation lands: a card drawn once
    # disappears the moment anything else redraws the screen, and the clock stays
    # frozen with nothing on screen to explain why.
    # The whole function body, not its first line: drawGame grew past one line
    # when it started saving, and reading only the first line would have said
    # the card was gone when it was not.
    body = src.split("function drawGame()")[-1].split("\n}")[0]
    if "drawSituation()" not in body:
        problems.append("ui.js: drawGame ما بينداش drawSituation — الكارت مش هيترسم مع كل تحديث")

    # The engine owns the field. If the screen could clear it, every guard below
    # is decoration.
    if re.search(r"\.pendingSituation\s*=", src):
        problems.append("ui.js: الواجهة بتمسح الموقف بنفسها — ده باب هروب من قرار المفروض إجباري، "
                        "المحرك بس هو اللي يقفل الموقف")

    back = src.split("function onAndroidBack()")[-1].split("\n}")[0]
    if "pendingSituation" not in back:
        problems.append("ui.js: زرار الرجوع بتاع الموبايل مش بيحسب حساب الموقف المفتوح — "
                        "ضغطة واحدة هتطلّع اللاعب من قرار مفروض إجباري")

    run = src.split("function setRunning(")[-1].split("\n}")[0]
    if "pendingSituation" not in run:
        problems.append("ui.js: الوقت ينفع يمشي والموقف لسه مفتوح — الوقف بيتلغي من غير قرار")

    # The card must not carry a close button of any kind.
    card = src.split("function drawSituation()")[-1].split("\nfunction ")[0]
    for escape in ("data-close", "data-back", "data-tab", "data-open"):
        if escape in card:
            problems.append(f"ui.js: كارت الموقف فيه «{escape}» — ده باب خروج من غير قرار")

    if "data-answer" not in src:
        problems.append("ui.js: مفيش زرار إجابة على الموقف — اللاعب هيتقفل عليه")
    elif "'data-answer'" not in src.split("var CLICKABLE = [")[-1].split("]")[0]:
        problems.append("ui.js: زرار الإجابة مش مسجّل في قايمة الضغطات — هيبان وميعملش حاجة")


def check_situation_costs_are_shown(problems):
    """A choice whose price the screen has no wording for renders as a blank —
    a button that reads as free and then takes the money. The screen must know
    how to write out every kind of cost the data can ask for, in both
    directions: an unknown key in the data, and a wording in the screen for a
    key the checker would reject."""
    try:
        s = json.loads((DATA / "situations.json").read_text(encoding="utf-8"))
    except Exception as e:
        problems.append(f"situations.json مش بيتقري — {e}")
        return
    src = strip_js_comments((ROOT / "game" / "src" / "ui.js").read_text(encoding="utf-8"))
    if "var COST_LABEL = {" not in src:
        problems.append("ui.js: مفيش جدول بيكتب تمن الاختيارات — الأتمان هتظهر فاضية")
        return
    block = src.split("var COST_LABEL = {", 1)[1].split("\n};", 1)[0]
    labelled = set(re.findall(r"^\s{2}([a-zA-Z]+):", block, re.M))
    for sit in s["situations"]:
        for ch in sit.get("choices", []):
            for k in ch.get("cost", {}):
                if k not in labelled:
                    problems.append(f"موقف «{sit['id']}» اختيار «{ch['nm']}» بيدفع «{k}» "
                                    f"والشاشة مش عارفة تكتبها — الزرار هيبان مجاني وياخد الفلوس")
    for k in labelled - {"ap", "treasury", "personal"}:
        problems.append(f"ui.js: الشاشة بتكتب تمن «{k}» والمحرك مش بيخصمه — هتقول للاعب "
                        f"إنه دفع حاجة ما اتدفعتش")


def check_dead_asset_links(problems):
    """A file the page asks the browser for and that is not there fails
    silently: no error the player sees, just a missing icon. Three of these were
    left behind when the web-app files were retired, and nothing noticed."""
    for rel in ("game/src/index.html", "game/index.html", "index.html"):
        p = ROOT / rel
        if not p.exists():
            continue
        src = p.read_text(encoding="utf-8")
        for m in re.finditer(r'(?:href|src)="([^"#:?]+)"', src):
            target = m.group(1)
            if target.startswith(("http", "//", "data:", "mailto:")) or target.endswith("/"):
                continue
            if not (p.parent / target).exists():
                problems.append(f"{rel}: بيطلب الملف «{target}» وهو مش موجود")


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

    # ---- suspicion, measured on the four bots ----------------------------
    # The whole point of the meter is that it separates ways of playing. These
    # are the two ways it stops doing that, and neither shows up anywhere else.
    heat = sim["heat"]
    hb = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))["heat"]
    if heat["معقول"]["peak"] >= hb["scandal_at"]:
        problems.append(f"اللاعب المعقول — اللي ما سرقش ولا مليم — وصل شبهة "
                        f"{heat['معقول']['peak']} والخط {hb['scandal_at']}. "
                        f"يعني الشبهة بتقيس الوقت مش الفساد")
    if heat["معقول"]["scandals"] > 1:
        problems.append(f"اللاعب المعقول شاف {heat['معقول']['scandals']} فضيحة — "
                        f"اللعب الصح المفروض يعدّي من غيرها")
    if heat["حرامي"]["peak"] < hb["scandal_at"]:
        problems.append(f"الحرامي سرق {heat['حرامي']['stolen']}م وشبهته أعلى حاجة وصلتها "
                        f"{heat['حرامي']['peak']} والخط {hb['scandal_at']} — السرقة ببلاش")
    if heat["حرامي"]["stolen"] <= 0:
        problems.append("الحرامي سرق طول عمره واللي اتسجّل صفر — "
                        "مجموع اللي اتسرق مش بيتسجّل، والفضايح المبنية عليه مش هتحصل أبدًا")
    if heat["حرامي"]["scandals"] < 1:
        problems.append("الحرامي عاش عمره كله من غير ولا فضيحة — النظام كله مش شغال")
    # And the interruptions the two systems together produce, per bot. The gates
    # bound the worst case on paper; this is what actually happened.
    for name, x in sim["interruptions"].items():
        if x["everyMonths"] and x["everyMonths"] < 4:
            problems.append(f"«{name}» بيتقاطع كل {x['everyMonths']} شهر — "
                            f"دي مش لعبة، دي مقاطعة مستمرة")

    # ---- repression ------------------------------------------------------
    # Two edges, and the feature is worthless outside them: a button that buys
    # nothing is a screen the player learns to ignore, and one that buys years
    # turns the game into "beat people up until it works".
    k = sim["crackdown"]
    if k["used"] < 1:
        problems.append("رئيس فاشل بيدوس زرار القمع كل ما يقدر واستخدمه صفر مرة — "
                        "يعني الشرط بتاع الغليان بيفتح الزرار بعد ما الأوان يفوت")
    bought = k["failingWithBaton"] - k["failingPlain"]
    if bought <= 0:
        problems.append(f"القمع اشترى {bought} شهر لرئيس فاشل — الزرار ده ديكور")
    if k["failingWithBaton"] > k["failingPlain"] * 1.6:
        problems.append(f"القمع مدّ عمر رئيس فاشل من {k['failingPlain']} لـ"
                        f"{k['failingWithBaton']} شهر — بقى استراتيجية مش تأجيل")
    # And the promise the setup screen makes to the dictator.
    dict_bought = k["dictatorWithBaton"] - k["dictatorPlain"]
    if dict_bought <= bought:
        problems.append(f"القمع اشترى للديكتاتوري {dict_bought} شهر وللجمهوري {bought} — "
                        f"وشاشة البداية بتوعد الديكتاتوري إن القمع بينجح عنده أكتر")

    # ---- the army --------------------------------------------------------
    # The only measurement that matters: how long a president who lets the army
    # go actually has. Too short and one bad appointment ends a twenty-year run
    # from a card he tapped once; too long and the whole meter is decoration.
    neglect = sim["army"]["neglect"]
    if neglect["died"] != "coup":
        problems.append(f"رئيس سايب الجيش تحت الخط عاش {neglect['months']} شهر ومماتش "
                        f"بانقلاب — يعني الجيش نظام مالوش نهاية")
    elif not 24 <= neglect["months"] <= 90:
        problems.append(f"رئيس سايب الجيش تحت الخط بينقلب عليه بعد {neglect['months']} شهر — "
                        f"المفروض بين سنتين وسبع سنين، عشان يبقى فيه وقت يشوف التنبيهات "
                        f"ويتصرف من غيرها ما تبقاش تهديد")
    # And the bots that DO watch the defence chair must not be dying of it: if
    # they were, the number above would be measuring the wrong thing.
    for name, x in sim["army"].items():
        if name == "neglect":
            continue
        if x["died"] == "coup":
            problems.append(f"«{name}» بيراقب وزير الدفاع وبرضه اتنقلب عليه — "
                            f"يعني الجيش بياخد لاعبين مش مهملينه")

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


def check_no_retired_files(problems):
    """Files we deliberately removed must stay removed, and files that belong in
    tools/ must not appear at the repo root.

    Both have already happened: the game shipped as an installable web app for a
    while before Karim said he wanted an APK only, and a browser upload once
    dropped three copies of tools/ scripts into the root while the real ones in
    tools/ stayed stale — the build went red and looked like a code bug for two
    rounds. Neither leaves any other trace."""
    retired = ["game/manifest.webmanifest", "game/sw.js", "game/icon-192.png",
               "game/icon-512.png", "game/icon-maskable.png", "tools/sim.py",
               "tools/export_balance.py"]
    for rel in retired:
        if (ROOT / rel).exists():
            problems.append(f"«{rel}» اتشال من المشروع ورجع تاني — امسحه")

    for f in TOOLS.glob("*"):
        if f.suffix not in (".py", ".js"):
            continue
        stray = ROOT / f.name
        if stray.exists() and stray.is_file():
            problems.append(f"«{f.name}» موجود في جذر المشروع والمفروض في tools/ بس — "
                            f"غالبًا رفعة وقعت في المكان الغلط، والنسخة الحقيقية في tools/ "
                            f"ممكن تكون لسه قديمة")

    page = (ROOT / "game" / "index.html").read_text(encoding="utf-8")
    for gone in ("serviceWorker", 'rel="manifest"'):
        if gone in page:
            problems.append(f"اللعبة لسه فيها «{gone}» — ده بقايا نسخة الويب اللي اتشالت")


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
    check_required_files, check_html_structure, check_anchors, check_tables, check_theme, check_svg,
    check_javascript, check_balance_json, check_setup_json, check_situations, check_ministers_json, check_treasury, check_parliament, check_bank,
    check_browser_globals_are_faked, check_engine_is_repeatable,
    check_simulator_has_no_rules,
    check_ui_once_only, check_no_duplicated_block, check_navigation, check_clipped_text,
    check_no_class_defined_twice, check_modifier_is_not_a_block,
    check_meters_fit_their_grid,
    check_army, check_crackdown, check_minister_notes_match_the_rules,
    check_save,
    check_heat, check_situation_card_is_compulsory, check_situation_costs_are_shown,
    check_dead_asset_links,
    check_every_class_is_styled,
    check_generated_files_match, check_android, check_no_retired_files, check_progress_bar, check_game_runs, check_simulator,
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
