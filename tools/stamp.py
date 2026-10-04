#!/usr/bin/env python3
"""Stamp every page's links to the site's own CSS and JS with a hash of the file they name.

Browsers keep a stylesheet or script for a while after loading it (GitHub Pages allows ten
minutes), so a page fresh from a deploy could arrive with the old CSS and fall apart. A link
whose ?v= changes with the file is a new address, fetched fresh. Run it before committing a
change to style.css or any script:

    python3 tools/stamp.py

Safe to run again: it only rewrites what is out of date.
"""
import hashlib, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSET = re.compile(r'((?:href|src)=")([^"#?]+\.(?:css|js))(?:\?v=[0-9a-f]*)?(")')

def stamp(page):
    text = page.read_text()
    def fix(m):
        target = (page.parent / m.group(2)) if not m.group(2).startswith("/") else ROOT / m.group(2).lstrip("/")
        if "://" in m.group(2) or not target.is_file():
            return m.group(0)
        v = hashlib.sha256(target.read_bytes()).hexdigest()[:10]
        return f"{m.group(1)}{m.group(2)}?v={v}{m.group(3)}"
    new = ASSET.sub(fix, text)
    if new != text:
        page.write_text(new)
        return True
    return False

changed = [str(p.relative_to(ROOT)) for p in sorted(ROOT.rglob("*.html"))
           if ".git" not in p.parts and p.name != "demo.html" and stamp(p)]
print("stamped: " + (", ".join(changed) if changed else "nothing out of date"))
