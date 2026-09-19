# jjpatric9.github.io

The TallmanGames website — served at <https://tallman-games.com/>.

Static, no build step, no dependencies, no external requests. Plain HTML and one stylesheet.

| File | Purpose |
|---|---|
| `index.html` | Landing page. Used as the Google Play **Website** field. |
| `privacy.html` | Privacy policy for BoxStacker. Used as the Play **Privacy policy** field. |
| `support.html` | Support contact and FAQ. |
| `style.css` | Shared styling — light and dark, system fonts, nothing fetched. |
| `404.html` | Fallback for mistyped URLs. |
| `app-ads.txt` | Names Google AdMob as the only seller of BoxStacker's ad inventory. |
| `CNAME` | The custom domain. Removing it unsets the domain on the next deploy. |

Links between pages are relative, so every page works under both hostnames.

## Deploying

GitHub Pages serves this repo's `main` branch from the root. A push is a deploy; the build takes
a minute or so.

The site is served from the custom domain in `CNAME`, with the `github.io` apex redirecting to it:

- <https://tallman-games.com/> — <https://jjpatric9.github.io/> 301s here
- <https://tallman-games.com/privacy.html>
- <https://tallman-games.com/support.html>

Links between pages stay relative so both hostnames work.

## app-ads.txt

AdMob will not serve BoxStacker's inventory at full value unless it can fetch
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

- [x] Gameplay GIF added to `index.html`
- [ ] Replace the `<!-- STORE LINK -->` comment in `index.html` once the listing is live
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

So the rule is not "update the policy when something changes". It is:

**`privacy.html` is a rendering of `docs/privacy-policy.md` in the Boxstack repository, which is
the only copy.** The app build copies that same file into its assets, so the About page inside the
game and the URL Play links to show the same words. When it changes there, re-render it here in
the same commit — and grep this whole site for the claim that changed, because the homepage and
the support page make privacy claims too and neither of them is the policy.
