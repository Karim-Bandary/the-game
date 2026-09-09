#!/usr/bin/env python3
"""
Checks the Android project WITHOUT building it.

The container has no Android SDK and the network blocks Google's servers, so
this is the one part of the project that cannot be compiled or run here. These
checks catch the mistakes that a compiler would have caught — mismatched
package names, malformed XML, a manifest pointing at a class that is not there,
an icon that needs a PNG we do not have — so the CI build fails for real
reasons rather than typos.

Called from tools/check.py.
"""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / "android"


def check(problems):
    if not A.exists():
        problems.append("مجلد android مش موجود")
        return

    # 1. every XML file must parse — a stray character here fails the build
    #    minutes into CI with an unhelpful message
    for f in sorted(A.rglob("*.xml")):
        try:
            ET.parse(f)
        except ET.ParseError as e:
            problems.append(f"أندرويد: {f.relative_to(ROOT)} فيه XML غلط — {e}")

    manifest = A / "app/src/main/AndroidManifest.xml"
    app_gradle = (A / "app/build.gradle").read_text(encoding="utf-8")

    # 2. namespace, applicationId and the java package must agree, or the
    #    activity cannot be found at launch
    ns = re.search(r"namespace\s+'([\w.]+)'", app_gradle)
    app_id = re.search(r'applicationId\s+"([\w.]+)"', app_gradle)
    if not ns or not app_id:
        problems.append("أندرويد: مش لاقي namespace أو applicationId في app/build.gradle")
        return
    if ns.group(1) != app_id.group(1):
        problems.append(f"أندرويد: namespace ({ns.group(1)}) مش زي applicationId ({app_id.group(1)})")

    pkg_dir = A / "app/src/main/java" / Path(*ns.group(1).split("."))
    if not pkg_dir.exists():
        problems.append(f"أندرويد: مفيش مجلد للكود على المسار {pkg_dir.relative_to(ROOT)}")
        return

    # 3. the activity named in the manifest must exist as a class in that package
    tree = ET.parse(manifest)
    android = "{http://schemas.android.com/apk/res/android}"
    for act in tree.iter("activity"):
        name = act.get(android + "name", "")
        cls = name.lstrip(".").split(".")[-1]
        src = pkg_dir / (cls + ".java")
        if not src.exists():
            problems.append(f"أندرويد: المانيفست بيشاور على {name} ومفيش ملف {cls}.java")
            continue
        body = src.read_text(encoding="utf-8")
        if not re.search(r"package\s+" + re.escape(ns.group(1)) + r"\s*;", body):
            problems.append(f"أندرويد: {cls}.java اسم الحزمة جواه مش {ns.group(1)}")
        if not re.search(r"class\s+" + cls + r"\b", body):
            problems.append(f"أندرويد: {cls}.java مفيهوش كلاس اسمه {cls}")
        if body.count("{") != body.count("}"):
            problems.append(f"أندرويد: {cls}.java الأقواس مش متوازنة")

    # 4. every drawable/color/string the manifest and icon reference must exist
    values = " ".join(f.read_text(encoding="utf-8") for f in (A / "app/src/main/res/values").glob("*.xml"))
    refs = set()
    for f in list(A.rglob("*.xml")):
        refs |= set(re.findall(r'"@(string|color|drawable|mipmap)/([\w]+)"', f.read_text(encoding="utf-8")))
    for kind, name in refs:
        if kind in ("string", "color"):
            if f'name="{name}"' not in values:
                problems.append(f"أندرويد: @{kind}/{name} مستخدم ومش معرّف في res/values")
        else:
            folder = "drawable" if kind == "drawable" else "mipmap-anydpi-v26"
            if not list((A / "app/src/main/res" / folder).glob(name + ".*")):
                problems.append(f"أندرويد: @{kind}/{name} مستخدم والملف مش موجود")

    # 5. XML-only launcher icons need API 26+. Below that Android wants PNGs.
    has_raster = any(A.rglob("ic_launcher.png"))
    min_sdk = re.search(r"minSdk\s+(\d+)", app_gradle)
    if not has_raster and min_sdk and int(min_sdk.group(1)) < 26:
        problems.append(f"أندرويد: الأيقونة XML بس و minSdk {min_sdk.group(1)} — "
                        "لازم ٢٦ أو أعلى، أو تضيف أيقونة PNG")

    # 6. The build itself must copy the game into assets, or the app ships an
    #    empty page. This lives in Gradle on purpose: a check that depended on
    #    the CI file would force two files to change in one commit.
    # Look for the task being REGISTERED, not merely mentioned: a dependsOn line
    # referring to a task that no longer exists still contains the name.
    if "game/index.html" not in app_gradle or "tasks.register('copyGame'" not in app_gradle:
        problems.append("أندرويد: مفيش مهمة بتنسخ game/index.html لمجلد assets في app/build.gradle")
    if "dependsOn 'copyGame'" not in app_gradle:
        problems.append("أندرويد: مهمة نسخ اللعبة مش مربوطة بالبناء — التطبيق هيتبني بلعبة قديمة")

    # 7. the shell calls into the page on back; the page must answer
    ui = (ROOT / "game/src/ui.js").read_text(encoding="utf-8")
    java = (pkg_dir / "MainActivity.java").read_text(encoding="utf-8")
    if "onAndroidBack" in java and "function onAndroidBack" not in ui:
        problems.append("أندرويد: التطبيق بينده على onAndroidBack() واللعبة مش معرّفاها")

    # 8. and the other direction: the page calls into the shell to close the
    #    app. Three names have to line up — the object the shell exposes, the
    #    method on it, and what the page calls. A rename on one side leaves a
    #    button that looks alive and does nothing, which is the one failure
    #    neither of us can see from here.
    obj = re.search(r'addJavascriptInterface\(\s*new\s+\w+\(\)\s*,\s*"(\w+)"\s*\)', java)
    # Only names that start with a capital letter: window.localStorage and
    # friends are the browser, and a bridge object is ours. The convention is
    # the check — without it every localStorage call read as a broken bridge.
    called = re.findall(r"window\.([A-Z]\w*)\.(\w+)", ui)
    names = set(called)
    if not obj:
        if names:
            problems.append("أندرويد: اللعبة بتنده على التطبيق والتطبيق مش مضيف أي جسر "
                            "(addJavascriptInterface) — الزرار هيبان شغال ومش هيعمل حاجة")
    else:
        exposed = obj.group(1)
        methods = set(re.findall(r"@JavascriptInterface\s+public\s+\w+\s+(\w+)\s*\(", java))
        if not methods:
            problems.append("أندرويد: الجسر مضاف ومفيش فيه ولا دالة عليها @JavascriptInterface — "
                            "من غير الوسم ده الدالة مش بتتشاف من الصفحة خالص")
        for holder, method in names:
            if holder != exposed:
                problems.append(f"أندرويد: اللعبة بتنده على window.{holder} والتطبيق مضيف "
                                f"«{exposed}» — الاسمين مش متطابقين")
            elif method not in methods:
                problems.append(f"أندرويد: اللعبة بتنده على {holder}.{method}() والتطبيق "
                                f"مش مضيف الدالة دي")
        for method in methods:
            if not any(m == method for _, m in names):
                problems.append(f"أندرويد: التطبيق مضيف {exposed}.{method}() ومحدش بينده "
                                f"عليها من اللعبة")
