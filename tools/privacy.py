#!/usr/bin/env python3
"""Build the translated privacy policies, privacy.<tag>.html, from the game's own translations.

The game ships its policy in every language it is played in (`docs/privacy-policy.<tag>.md` in the
Boxstack repository, shown in the app's About sheet). The App Store asks for a policy address per
language, so each translation is also a page here, under the same top bar and footer as
privacy.html. privacy.html itself stays hand-written English; this only rewrites the list of
languages between its <!-- languages --> markers. Run it after a translation changes:

    python3 tools/privacy.py ../Boxstack/docs

then `python3 tools/stamp.py`. Safe to run again.
"""
import html, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

# Each language's name in itself, in the order the list shows them. English is privacy.html.
LANGUAGES = {
    "en": "English", "ar": "العربية", "de": "Deutsch", "es": "Español", "fr": "Français",
    "hi": "हिन्दी", "id": "Bahasa Indonesia", "it": "Italiano", "ja": "日本語", "ko": "한국어",
    "pt-BR": "Português (Brasil)", "tr": "Türkçe",
}
RTL = {"ar"}
# privacy.html's anchors, by section number, so a link to #website works in every language.
ANCHORS = {7: "delete", 8: "website", 10: "rights", 11: "contact"}


def page_of(tag):
    return "privacy.html" if tag == "en" else f"privacy.{tag}.html"


def inline(text):
    out = html.escape(text, quote=False)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2" rel="noopener">\1</a>', out)
    out = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"\*(.+?)\*", r"<em>\1</em>", out)
    out = re.sub(r"<strong>([^<\s]+@[^<\s]+)</strong>", r'<a href="mailto:\1">\1</a>', out)
    return out


def body(md):
    """The small Markdown the policies use: headings, paragraphs, flat lists, bold, italic, links."""
    blocks, title, effective = [], None, None
    for chunk in re.split(r"\n\s*\n", md.strip()):
        lines = chunk.splitlines()
        if lines[0].startswith("# "):
            title = lines[0][2:].strip()
        elif lines[0].startswith("## "):
            head = lines[0][3:].strip()
            m = re.match(r"(\d+)\.", head)
            anchor = ANCHORS.get(int(m.group(1))) if m else None
            attr = f' id="{anchor}"' if anchor else ""
            blocks.append(f"  <h2{attr}>{inline(head)}</h2>")
        elif lines[0].startswith("- "):
            items, cur = [], []
            for line in lines:
                if line.startswith("- "):
                    if cur:
                        items.append(" ".join(cur))
                    cur = [line[2:].strip()]
                else:
                    cur.append(line.strip())
            items.append(" ".join(cur))
            blocks.append("  <ul>\n" + "\n".join(f"    <li>{inline(i)}</li>" for i in items) + "\n  </ul>")
        elif effective is None and re.fullmatch(r"\*\*[^*]+\*\*", chunk.strip()):
            effective = chunk.strip().strip("*")
        else:
            text = " ".join(l.strip() for l in lines)
            if re.fullmatch(r"\*[^*]+\*", text):
                blocks.append(f'  <p class="callout">{inline(text.strip("*"))}</p>')
            else:
                blocks.append(f"  <p>{inline(text)}</p>")
    return title, effective, "\n\n".join(blocks)


def language_list(current):
    links = []
    for tag, name in LANGUAGES.items():
        if tag == current:
            links.append(f'<a href="{page_of(tag)}" lang="{tag}" hreflang="{tag}" aria-current="page">{name}</a>')
        else:
            links.append(f'<a href="{page_of(tag)}" lang="{tag}" hreflang="{tag}">{name}</a>')
    return ('<!-- languages -->\n  <nav class="meta languages" aria-label="Languages" dir="ltr">'
            + " · ".join(links) + "</nav>\n  <!-- /languages -->")


def alternates():
    lines = [f'<link rel="alternate" hreflang="{t}" href="https://tallman-games.com/{page_of(t)}">'
             for t in LANGUAGES]
    lines.append('<link rel="alternate" hreflang="x-default" href="https://tallman-games.com/privacy.html">')
    return "\n".join(lines)


def build(docs):
    english = (ROOT / "privacy.html").read_text()
    head = english[:english.index("<title>")]
    shell_top = english[english.index("<link rel=\"icon\""):english.index('<main id="main" class="page">')]
    shell_bottom = english[english.index("</main>"):]
    for tag in LANGUAGES:
        if tag == "en":
            continue
        src = docs / f"privacy-policy.{tag}.md"
        title, effective, content = body(src.read_text())
        direction = ' dir="rtl"' if tag in RTL else ""
        page = (head.replace('<html lang="en">', f'<html lang="{tag}">')
                + f"<title>{html.escape(title)}</title>\n"
                + f'<link rel="canonical" href="https://tallman-games.com/{page_of(tag)}">\n'
                + alternates() + "\n"
                + '<meta name="theme-color" content="#230d30">\n'
                + shell_top
                + '<main id="main" class="page">\n'
                + f'<div class="wrap narrow"{direction}>\n\n'
                + f"  {language_list(tag)}\n\n"
                + f"  <h1>{inline(title)}</h1>\n"
                + (f'  <p class="meta">{inline(effective)}</p>\n\n' if effective else "\n")
                + content + "\n\n</div>\n"
                + shell_bottom)
        (ROOT / page_of(tag)).write_text(page)

    # privacy.html: the language list, and the alternates in its head.
    english = re.sub(r"<!-- languages -->.*?<!-- /languages -->", lambda _: language_list("en"),
                     english, flags=re.S)
    english = re.sub(r'(<link rel="alternate" hreflang="[^"]+" href="[^"]+">\n)+', "", english)
    english = english.replace('<meta name="theme-color"', alternates() + '\n<meta name="theme-color"', 1)
    (ROOT / "privacy.html").write_text(english)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python3 tools/privacy.py <Boxstack>/docs")
    build(pathlib.Path(sys.argv[1]))
    print("built: " + ", ".join(page_of(t) for t in LANGUAGES if t != "en"))
