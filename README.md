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
