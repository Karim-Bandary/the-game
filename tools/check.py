#!/usr/bin/env python3
"""
The permanent checker. Runs on every push and fails the build on any problem.

The rule this file exists for: any bug that shows up once becomes a check here,
so it can never come back silently. Neither of us can see the screen — this is
what looks instead.

Add a new check by writing a function named check_* and appending it to CHECKS.
Every check appends a human-readable Arabic string to `problems` for each fault.
"""
import json, re, subprocess, sys, shutil, tempfile, html.parser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA, DOCS, TOOLS = ROOT / "data", ROOT / "docs", ROOT / "tools"

# Pages that use the light/dark token system. The game mockups are deliberately
# single-theme dark, so the theme rules below must not be applied to them.
THEMED = {"design.html", "balance.html", "index.html"}

VOID = {"meta", "link", "br", "hr", "img", "input", "source",
        "path", "rect", "circle", "line", "polygon", "polyline", "use", "marker", "stop"}


def html_files():
    return sorted(list(DOCS.glob("*.html")) + [ROOT / "index.html"])


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
            problems.append(f"{f.name}: وسم غلط — {e}")
        if p.stack:
            problems.append(f"{f.name}: وسوم مفتوحة ما اتقفلتش — {p.stack}")


def check_anchors(problems):
    """A dead in-page link is a silent dead end for the reader."""
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        anchors = set(re.findall(r'href="#([\w-]+)"', src))
        ids = set(re.findall(r'id="([\w-]+)"', src))
        for a in anchors - ids:
            problems.append(f"{f.name}: رابط داخلي #{a} مش موجود")


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
        if f.name not in THEMED:
            continue
        css_m = re.search(r"<style>(.*?)</style>", f.read_text(encoding="utf-8"), re.S)
        if not css_m:
            problems.append(f"{f.name}: مفيش بلوك <style>")
            continue
        css = css_m.group(1)
        m = re.search(r":root\{(.*?)\}", css, re.S)
        if not m:
            problems.append(f"{f.name}: مفيش :root فيه ألوان الوضع الفاتح")
            continue
        defined = set(re.findall(r"(--[\w-]+)\s*:", m.group(1)))
        for v in set(re.findall(r"var\((--[\w-]+)\)", css)) - defined:
            problems.append(f"{f.name}: المتغير {v} مستخدم ومش معرّف في :root الفاتح")
        for label, marker in [("الوضع الداكن التلقائي", r':root:not\(\[data-theme="light"\]\)\{(.*?)\}'),
                              ("الوضع الداكن اليدوي", r':root\[data-theme="dark"\]\{(.*?)\}')]:
            mm = re.search(marker, css, re.S)
            if not mm:
                problems.append(f"{f.name}: {label} مش موجود")
                continue
            missing = defined - set(re.findall(r"(--[\w-]+)\s*:", mm.group(1)))
            if missing:
                problems.append(f"{f.name}: {label} ناقصه ألوان — {sorted(missing)}")


def check_svg(problems):
    """A box drawn outside the viewBox is simply invisible; a marker reference
    with no definition silently drops every arrowhead."""
    for f in html_files():
        src = f.read_text(encoding="utf-8")
        defined = set(re.findall(r'<marker id="([\w-]+)"', src))
        for ref in set(re.findall(r"url\(#([\w-]+)\)", src)):
            if ref not in defined:
                problems.append(f"{f.name}: السهم url(#{ref}) مالوش تعريف")
        for m in re.finditer(r'<svg viewBox="0 0 (\d+) (\d+)"(.*?)</svg>', src, re.S):
            W, H, body = int(m.group(1)), int(m.group(2)), m.group(3)
            for r in re.finditer(r'<rect[^>]*?x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"', body):
                x, y, w, h = map(int, r.groups())
                if x + w > W or y + h > H:
                    problems.append(f"{f.name}: مربع في الرسمة برّه حدودها ({x},{y} {w}×{h} في {W}×{H})")


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
                problems.append(f"{f.name}: خطأ في الجافاسكريبت — {r.stderr.strip().splitlines()[-1]}")
        # Handlers are checked against every script on the page, not one at a time.
        called = set()
        for attr in re.findall(r'on(?:click|input|change)=("[^"]*"|\'[^\']*\')', src):
            called |= set(re.findall(r"([A-Za-z_]\w*)\s*\(", attr))
        defined = set()
        for js in scripts:
            defined |= set(re.findall(r"function\s+([A-Za-z_]\w*)", js))
            defined |= set(re.findall(r"(?:var|let|const)\s+([A-Za-z_]\w*)\s*=\s*function", js))
        for h in called - defined - BUILTIN:
            problems.append(f"{f.name}: زرار بينده على {h}() وهي مش معرّفة")


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


# ---------------------------------------------------------------- generated
def check_generated_files_match(problems):
    """docs/balance.html and the two mockups are generated. If someone edits one
    by hand, the document and the game stop agreeing — which is exactly the kind
    of drift nobody notices until it is expensive."""
    generated = ["docs/balance.html", "docs/app-mockup.html", "docs/setup-mockup.html"]
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp) / "repo"
        shutil.copytree(ROOT, work, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        for script in ["build_balance_doc.py", "build_mockup.py", "build_setup_mockup.py"]:
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
    """A balance edit that quietly makes the game unplayable is invisible in a
    diff. These are the three numbers that say the game still works at all."""
    sys.path.insert(0, str(TOOLS))
    import sim
    sim.reset_reqs()
    st = sim.State()
    if not 45 <= st.approval <= 65:
        problems.append(f"الرضا عند البداية {st.approval:.0f} — المفروض بين ٤٥ و٦٥")
    if not 55 <= st.stability <= 80:
        problems.append(f"الثبات عند البداية {st.stability:.0f} — المفروض بين ٥٥ و٨٠")
    if not 40 <= st.avg_service() <= 70:
        problems.append(f"متوسط الخدمات {st.avg_service():.0f} — المفروض بين ٤٠ و٧٠")

    def median_life(player, n=12):
        lives = []
        for seed in range(n):
            r = sim.run(player, seed=seed)
            lives.append(r.month if r.dead else 300)
        return sorted(lives)[n // 2]

    passive, good = median_life(sim.passive), median_life(sim.reasonable)
    if passive > 200:
        problems.append(f"اللاعب السلبي عايش {passive} شهر — الوقوف مكانك المفروض يخسّر")
    if good < passive * 1.5:
        problems.append(f"اللاعب الكويس عايش {good} شهر والسلبي {passive} — الفرق صغير، "
                        "يعني قرارات اللاعب مش مهمة")
    if good > passive * 6:
        problems.append(f"اللاعب الكويس عايش {good} شهر والسلبي {passive} — الفرق كبير أوي، "
                        "يعني فيه استراتيجية واحدة صح وباقي اللعب غلط")


CHECKS = [
    check_html_structure, check_anchors, check_tables, check_theme, check_svg,
    check_javascript, check_balance_json, check_setup_json,
    check_generated_files_match, check_simulator,
]


def main():
    problems = []
    for fn in CHECKS:
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
