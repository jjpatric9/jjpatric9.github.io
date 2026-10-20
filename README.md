# jjpatric9.github.io

The TallmanGames website — served at <https://tallman-games.com/>.

Static, no build step, no dependencies (one small script, `tools/stamp.py`, keeps asset links fresh). Plain HTML, one stylesheet and a little script. Nothing is
fetched from anyone else, fonts included; the one exception is the colour vote,
`box-stack/colours/`, which talks to one Cloudflare Worker, described below.

| File | Purpose |
|---|---|
| `index.html` | Landing page, kept to one screen: who makes the games, and the way to Box Stack. Used as the Google Play **Website** field. Its hero is a crane building a tower (`home.js`) until somebody taps it over. An old `#play` link forwards to `play/`. |
| `box-stack/` | The Box Stack page: a short pitch, three hooks and the tips. The page search engines should send "box stack" searches to. Deliberately light on detail: the game explains itself. |
| `privacy.html` | Privacy policy for Box Stack. Used as the Play **Privacy policy** field. |
| `support.html` | Support contact and every FAQ. |
| `style.css` | Shared styling, light and dark. Headings and buttons use the game's Chakra Petch from `fonts/`. |
| `site.js` | What every page shares: copy buttons, the footer year, sections rising into view, and the "Coming soon" popup for any link marked `data-soon`. |
| `home.js` | The homepage's crane. It plays the game's own pieces, three to a hand, in a frame about as many rows tall as a phone shows, under the game's balance bar, and keeps to the game's balance rule so it never topples itself; the view climbs with the tower, and a tap pulls it back to the whole tower and tips it over, as a run ends in the game. Each boat is dealt one of the game's dark-sky palettes. |
| `play/` | The Play page: the demo and the two store badges under it, nothing else. The demo fills the screen under the bar on a phone, edge to edge with the badges shrunk to the stores' 40px minimum under it, and sits in a phone frame on a big screen. `play.js` listens for how a run went and answers above the badges. |
| `pong/` | Pong on a 1970s TV over a paddle controller: turn the knob to move, the red button serves. Eight home-console games on the GAME switch (Pong, Catch, Doubles, Hockey, Soccer, Handball, Volleyball, Quadrapong), against the computer or two players with a knob and button each; LEFT and RIGHT difficulty switches as on the Atari 2600, where A gives that player a half-size paddle (the right one is the computer's in one-player games); a sound switch that starts on at every visit. DIAL/SLIDE chooses whether the knob turns or rides a straight groove (side to side in Volleyball, up and down otherwise), which is easier on a touch screen. The computer misjudges a set share of returns so every game can be won; `window.__pong.perfect` lets a flawless robot take a side for balance tests. One self-contained page (canvas, Web Audio, no files fetched but the font), with a manifest so it can be added to an Android home screen and run full-screen. Deliberately not linked from any page or the sitemap: it is there only for whoever goes straight to `/pong/`. |
| `demo.html` | Box Stack's playable ad, copied from `playable/index.html` in the Boxstack repository. The Play page loads it as `demo.html?host=web`; the colour vote's feed as `demo.html?host=palette&bot=1`, wearing each palette on a built tower that shows every colour in exactly its share of the palette, played by the game's own bot; the maker as `demo.html?host=palette&pick=1`, with a hand to play from so a crate can be seen on the crane and over its landing outline. Re-copy it after the playable is rebuilt. |
| `fonts/` | Chakra Petch semibold and bold, subset to Latin as WOFF2, with its licence (`OFL.txt`). |
| `img/` | The studio's marks, app icon, favicon, the share card (`og.png`, from the Play feature graphic) and the demo's poster frame. `tallman-games.png` is the wordmark from the game's launch curtain (`ui/src/androidMain/res/drawable-nodpi/tallman_games.png` in the Boxstack repository), kept as a silhouette and used as a CSS mask so it takes the colour of wherever it sits; `tallman-tower.png` is its tower alone for the top bar, drawn as the wordmark draws it inside a new outer line: the right side's, mirrored, because in the wordmark the tower's left side is the edge of the L. It keeps its own colours, with a pale rim so it holds on light and dark grounds. |
| `boxstacker.gif` | The original gameplay capture. No page loads it any more: the live demo replaced it, at a tenth of the weight. |
| `404.html` | Fallback for mistyped URLs. |
| `box-stack/colours/` | The colour vote: one feed of every palette, the ones in the game and the new ones players made, a screen each, swiped like a reel (or scrolled, or the arrow keys on a computer). Each is the real game played on that palette by its bot, tagged *In the game* or *New*, with a thumbs up and a thumbs down beside it showing how many people gave each. A palette with five more thumbs down than up is no longer shown (`HIDE_AT`). `feed.js` is its script. |
| `box-stack/colours/make/` | Make your own palette, by hand or with an eyedropper from any picture, on the real game, and add it to the vote. It is the vote's old tabbed page held to its maker; `maker.js` is its script. |
| `palettes.html` | Where the colour vote used to be. It forwards to `box-stack/colours/`, and an old `#make` link to the maker, because the app and older links still point here. |
| `palettes.json` | Generated by `tools/palette-votes/export.py` in the Boxstack repository. Never edited by hand. |
| `app-ads.txt` | Names Google AdMob as the only seller of Box Stack's ad inventory. |
| `robots.txt`, `sitemap.xml` | Tell search engines what to crawl. The bare `demo.html` is kept out: it's only meant to be seen inside the Play page. |
| `CNAME` | The custom domain. Removing it unsets the domain on the next deploy. |

Every page carries the same top bar (Box Stack, Play, Colours, Support, with the tower for home).
Every page but the colour vote, which is a full-screen app with no room under it, also carries the
same footer, which adds Privacy and Google Play. When a page is added, add it to both everywhere.

Links between pages are relative, so every page works under both hostnames.

## The App Store badge

The App Store badges (homepage, Box Stack page twice, Play page) link to the listing,
https://apps.apple.com/us/app/box-stack-tower-block-puzzle/id6818697355. The Support page's "Is it on iPhone?" answer, its JSON-LD and the game's `sameAs`
carry the same address; change them together. `data-soon` still makes any link show "Coming soon".

## Fresh CSS and scripts after a deploy

Browsers keep a stylesheet or script for up to ten minutes, so a page fresh from a push could
arrive with the old CSS and come out broken. Every link to the site's own CSS and JS carries
`?v=` and a hash of the file. **After changing `style.css` or any script, run
`python3 tools/stamp.py`** and commit what it changes with it.

## Deploying

GitHub Pages serves this repo's `main` branch from the root. A push is a deploy; the build takes
a minute or so.

The site is served from the custom domain in `CNAME`, with the `github.io` apex redirecting to it:

- <https://tallman-games.com/> — <https://jjpatric9.github.io/> 301s here
- <https://tallman-games.com/play/>
- <https://tallman-games.com/privacy.html>
- <https://tallman-games.com/support.html>
- <https://tallman-games.com/box-stack/colours/>
- <https://tallman-games.com/box-stack/colours/make/>

Links between pages stay relative so both hostnames work.

## Search

Every page names itself in its `<title>` and description, carries a `<link rel="canonical">` to its
`https://tallman-games.com/` address, and has Open Graph tags for link previews. Structured data
(JSON-LD) says who's who: the homepage describes TallmanGames (also "Tallman Games"), Joshua and
Box Stack; `box-stack/` describes the game; `support.html` its questions. When a
question changes on the page, change it in that page's JSON-LD too.

The `<title>` and description are the search result itself, so the homepage, `box-stack/` and
`play/` lead with what people actually search ("box stacking game", "stack boxes", per Search
Console) and with the offer that earns the click: free, and playable in the browser now. Titles
stay under 60 characters and descriptions under 155, or Google cuts them off. Open Graph text is
for link previews, where the person already knows the name, and can stay short.

When a page is added, or one changes meaningfully, add it to `sitemap.xml` or bump its `lastmod`.
Google Search Console and Bing Webmaster Tools are where to submit the sitemap and see what's
indexed; both are set up in the owner's accounts, not here.

Links to the homepage are `./` or `../`, never `index.html`, so crawlers only meet the canonical
address. Two of Search Console's "not indexed" reasons are expected and need no action:

- **Page with redirect**: `http://`, `www.`, `jjpatric9.github.io` and folder addresses without
  their trailing slash all 301 to the canonical one (GitHub Pages does this), and `palettes.html`
  forwards to `box-stack/colours/`. Only the addresses they land on should be indexed.
- **Excluded by 'noindex' tag**: `404.html` only. `palettes.html` deliberately has no `noindex`:
  it is a redirect, and a `noindex` on it reported it as an excluded page instead of letting
  Google follow it to the colour vote.

## The palette vote

`box-stack/colours/` and its maker are the only pages that send anything anywhere. They post
votes and player-made palettes to a Cloudflare Worker whose address is the `API` constant at the
top of `feed.js` and of `make/maker.js`, and read back players' palettes and every palette's
thumbs up and down, which the feed shows to everyone. The Worker's source, its setup steps and the tools that read the results all live
in the Boxstack repository under `tools/palette-votes/`; this repository has only the page.

What it sends is the colours, the choice and a random ID the browser made up — no name, no
cookies, no IP address stored — and the page's own "What this page saves" note, in its **?** sheet,
says so, and that the counts are public but never who gave them. A picture opened in the maker to take colours from is read in the browser and never sent
or saved; the note says that too, and so does the picker itself, in full before a picture is
chosen and as a badge on it while it is open. That note
is this page's privacy statement; `privacy.html` is the app's policy and is not about the website.
If the page ever sends anything more, the note changes in the same commit.

After the game's palette bank changes, re-run `export.py` there so the new palettes are tagged
*In the game* in the feed.

**The Worker has to be pasted again for the counts.** The feed asks `/health` whether the Worker
keeps a tally (`"tally":true`); until it does, the thumbs work but show no numbers, and a second tap
does not take a vote back. `SETUP.md` in `tools/palette-votes/` says how to paste it.

## app-ads.txt

AdMob will not serve Box Stack's inventory at full value unless it can fetch
<https://tallman-games.com/app-ads.txt> and find its own publisher id there. It looks at the
**developer website on the Play listing** — which is this site — and not at anything in the app,
so three things have to agree and all three live outside this file:

1. The Play listing's website field is `https://tallman-games.com`.
2. `CNAME` still holds that domain, so the file is reachable at the apex.
3. The publisher id matches the live AdMob ids in `app/build.gradle.kts` in the Boxstack
   repository — the `ca-app-pub-<publisher>~<app>` block used when `ads.live=true`, not Google's
   test ids.

`f08c47fec0942fa0` is Google's certification authority id and is the same for every AdMob
publisher; only the `pub-` number is ours. Re-verification is Google's, on its own schedule —
AdMob's app-ads.txt page reports what it last found, and a crawl can be a day behind a push.

## Before submitting to Google Play

- [x] Gameplay GIF added to `index.html` (since replaced by the live demo)
- [x] Store links point at the live listing
- [ ] Open every page signed out, in a private window, on a phone
- [ ] Check `privacy.html` against the Play Data safety form line by line
- [ ] Confirm `joshua@tallman-games.com` actually receives mail — it is the contact in the
      published policy, so Play and players both use it

## Keeping the policy honest

**This warning came true, and the pages were fixed late.** It used to say that `privacy.html`
claimed the app collects nothing and cannot transmit data, that this was verifiable because the
app requested no Android permissions at all, and that adding an ad SDK would invalidate every one
of those claims at once — so the policy and the Data safety form both had to be updated *before*
that build was submitted.

AdMob went in, and these pages were not updated with it. For a while the site told visitors the
app had no network access, no advertising and no permissions while the shipping binary declared
`INTERNET`, `ACCESS_NETWORK_STATE`, `AD_ID` and three AdServices permissions and served Google
adverts. That is a false public statement about the app and a Play policy violation in its own
right, and `index.html` and `support.html` were carrying versions of it too.

Tenjin campaign attribution is now the second network use, and that addition was updated here and
in the app policy together. The same rule applies to every future SDK change:

**`privacy.html` is a rendering of `docs/privacy-policy.md` in the Boxstack repository, which is
the only copy.** The app build copies that same file into its assets, so the About page inside the
game and the URL Play links to show the same words. When it changes there, re-render it here in
the same commit — and grep this whole site for the claim that changed, because the Box Stack page and
the support page make privacy claims too and neither of them is the policy.
