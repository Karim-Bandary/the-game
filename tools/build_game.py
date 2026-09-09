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
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "game" / "src"
DATA = ROOT / "data"

# One table instead of three parallel lists. Adding a data file used to mean
# editing the read, the replace AND the leftovers check, and forgetting the
# third produced a bundle with an unfilled placeholder in it — valid HTML that
# throws the moment the game starts.
DATA_FILES = {
    "__BALANCE__": "balance.json",
    "__SETUP__": "setup.json",
    "__MINISTERS__": "ministers.json",
    "__PARLIAMENT__": "parliament.json",
    "__BANK__": "bank.json",
    "__SITUATIONS__": "situations.json",
    "__ARMY__": "army.json",
    "__CRACKDOWN__": "crackdown.json",
}

engine = (SRC / "engine.js").read_text(encoding="utf-8")
for mark, name in DATA_FILES.items():
    blob = json.loads((DATA / name).read_text(encoding="utf-8"))
    engine = engine.replace(mark, json.dumps(blob, ensure_ascii=False))

# A fingerprint of everything the save file depends on. A save carries this,
# and a save whose fingerprint does not match is refused rather than loaded.
# The alternative is worse than losing a game: a save from an older build can
# name a minister post or a situation id that no longer exists, and the game
# either crashes on load or — the bad case — runs on half-old numbers with
# nothing on screen saying so.
fingerprint = hashlib.sha256()
for name in sorted(DATA_FILES.values()):
    fingerprint.update((DATA / name).read_bytes())
fingerprint.update((SRC / "engine.js").read_bytes())
engine = engine.replace("__BUILD__", fingerprint.hexdigest()[:12])

page = (SRC / "index.html").read_text(encoding="utf-8")
page = page.replace("__STYLE__", (SRC / "style.css").read_text(encoding="utf-8"))
page = page.replace("__ART__", (SRC / "art.js").read_text(encoding="utf-8"))
page = page.replace("__ENGINE__", engine)
page = page.replace("__UI__", (SRC / "ui.js").read_text(encoding="utf-8"))

# A leftover placeholder means a source moved and the bundle is broken in a way
# that looks fine until someone opens it. Fail loudly here instead.
leftovers = [m for m in ["__STYLE__", "__ART__", "__ENGINE__", "__UI__", "__BUILD__"]
             + list(DATA_FILES) if m in page]
if leftovers:
    raise SystemExit(f"البناء فشل: علامات ما اتملتش — {leftovers}")

(ROOT / "game" / "index.html").write_text(page, encoding="utf-8")
print(f"game/index.html written ({len(page):,} bytes)")
