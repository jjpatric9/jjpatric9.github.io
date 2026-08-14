# tallmangames.github.io

The TallmanGames website — served at <https://jjpatric9.github.io/>.

Static, no build step, no dependencies, no external requests. Plain HTML and one stylesheet.

| File | Purpose |
|---|---|
| `index.html` | Landing page. Used as the Google Play **Website** field. |
| `privacy.html` | Privacy policy for BoxStacker. Used as the Play **Privacy policy** field. |
| `support.html` | Support contact and FAQ. |
| `style.css` | Shared styling — light and dark, system fonts, nothing fetched. |
| `404.html` | Fallback for mistyped URLs. |

Links between pages are relative, so the site works unchanged if it later moves to a custom
domain.

## Deploying

GitHub Pages serves this repo's `main` branch from the root. A push is a deploy; the build takes
a minute or so.

Because the repo is named `jjpatric9.github.io`, it serves at the apex:

- <https://jjpatric9.github.io/>
- <https://jjpatric9.github.io/privacy.html>
- <https://jjpatric9.github.io/support.html>

### Adding a custom domain later

Add a `CNAME` file containing the domain, point DNS at GitHub's Pages IPs, and set the domain in
Settings → Pages. The `github.io` URLs keep redirecting, so nothing already submitted to Play
breaks.

## Before submitting to Google Play

- [x] Gameplay GIF added to `index.html`
- [ ] Replace the `<!-- STORE LINK -->` comment in `index.html` once the listing is live
- [ ] Open every page signed out, in a private window, on a phone
- [ ] Check `privacy.html` against the Play Data safety form line by line

## Keeping the policy honest

`privacy.html` states that BoxStacker collects nothing and cannot transmit data. That is
currently accurate and verifiable: the app requests **no Android permissions at all**, including
no internet permission, and ships no advertising, analytics or crash-reporting SDKs.

Adding an ad SDK invalidates every one of those claims at once. If that happens, this policy and
the Play Data safety form must both be updated **before** that build is submitted.
