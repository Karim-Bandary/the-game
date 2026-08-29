#!/usr/bin/env python3
"""
Bundles game/src/* into a single self-contained game/index.html.

Why bundle: the game must run from a plain file with no server — in a browser,
opened from disk, and inside the Android WebView. Anything that fetches a JSON
file at runtime works in one of those and silently fails in another, which is
the worst possible bug for a project where neither of us can watch the screen.
The data is baked in at build time, so there is nothing left to fail.

Sources stay small and editable; this file is what makes them one artefact.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "game" / "src"
DATA = ROOT / "data"

balance = json.loads((DATA / "balance.json").read_text(encoding="utf-8"))
setup = json.loads((DATA / "setup.json").read_text(encoding="utf-8"))

engine = (SRC / "engine.js").read_text(encoding="utf-8")
engine = engine.replace("__BALANCE__", json.dumps(balance, ensure_ascii=False))
engine = engine.replace("__SETUP__", json.dumps(setup, ensure_ascii=False))

page = (SRC / "index.html").read_text(encoding="utf-8")
page = page.replace("__STYLE__", (SRC / "style.css").read_text(encoding="utf-8"))
page = page.replace("__ENGINE__", engine)
page = page.replace("__UI__", (SRC / "ui.js").read_text(encoding="utf-8"))

# A leftover placeholder means a source moved and the bundle is broken in a way
# that looks fine until someone opens it. Fail loudly here instead.
leftovers = [m for m in ["__STYLE__", "__ENGINE__", "__UI__", "__BALANCE__", "__SETUP__"] if m in page]
if leftovers:
    raise SystemExit(f"البناء فشل: علامات ما اتملتش — {leftovers}")

(ROOT / "game" / "index.html").write_text(page, encoding="utf-8")
print(f"game/index.html written ({len(page):,} bytes)")
