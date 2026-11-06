# 40L Sprint Lab (beta)

Practice tools for TETR.IO's 40 LINES mode, as a static site for GitHub Pages:

- **Trainer**: a finesse drill that times every placement and keeps serving the ones you miss or place slowly.
- **Sprint**: 40-line runs in the browser with a suggested spot for every piece, then a breakdown of where the time went.
- **Run log**: enter a TETR.IO username to pull in that player's 40L history, with trends and a monthly table.
- **Plan**: goals and a weekly routine built from the runs, plus an optional plan written by Claude with your own Anthropic API key.
- **Finesse chart** and **Settings** (handling, keys, board size, theme, backups).

Live site: https://mithilmishra.github.io/40Lsprintlab/

## Site Structure

The files at the top level are the built site. The readable sources are in `src/`:

| File | What it holds |
| --- | --- |
| `src/body.html` | All page markup |
| `src/styles.css` | All styles, with light and dark themes |
| `src/engine.js` | Pieces, SRS+ rotation and kicks, and the finesse solver |
| `src/app.js` | Trainer, Sprint, Run log analysis, Plan, Finesse chart and Settings |
| `src/data.js` | Fetching runs from TETR.IO (direct, relay, or copy-and-paste) |
| `src/plan.js` | The Claude plan (bring your own Anthropic API key) |
| `src/site.js` | Welcome box, theme, effects, backups, offline support and update notice |
| `src/index.html`, `src/boot.js`, `src/sw.js` | Page template, pre-paint theme script, service worker template |

After editing anything in `src/`:

```sh
npm install        # once
npm run build      # writes index.html, sw.js and assets/app.<hash>.js/.css
npm run serve      # preview at http://localhost:8080/40Lsprintlab/
```

Commit the rebuilt files. `config.js` is the one file you can edit without rebuilding.

`npm run images` regenerates the icons and `og-image.png` (link preview) if you change the logo. It needs Playwright: `npm i -D playwright && npx playwright install chromium`.

**If you rename the repository or add a custom domain**, update the address in `tools/build.mjs` (`SITE_URL`), `404.html`, `sitemap.xml` and the relay's `ALLOWED_ORIGINS`, then rebuild. If the relay is on your own domain instead of `workers.dev`, also add that domain to `connect-src` in `src/index.html`.

## Features

- **Exact input timing.** Key presses use the browser's own event timestamps, and the game clock is brought up to that moment before the input is applied. DAS, ARR, DCD, gravity and lock delay behave the same at 60 Hz, 144 Hz or 240 Hz, and a hard drop right after DAS charges always lands at the wall.
- **Cheap frames.** The well, grid and column numbers are drawn once per size and theme and reused. A frame is only repainted when something on the board changed or an effect is playing.
- **Effects.** Short drop trails, lock flashes and line-clear flashes are drawn after the game state has already moved on, so they never delay a piece. They can be turned off in Settings → Display, and they're always off when the device asks for reduced motion.
- **No flashes on load.** A tiny inline script applies the saved theme and the first-visit box before the first paint. Fonts are self-hosted, preloaded and use `font-display: swap`.
- **Small and cacheable.** The script and stylesheet are minified and content-hashed (about 92 KB and 37 KB before compression), so browsers cache them indefinitely.
- **Works offline.** A service worker caches the app. When you deploy a new version, open tabs show a "new version is ready" notice with a Reload button.
- **Locked down.** A strict Content-Security-Policy only allows the site's own scripts. Network requests can only go to TETR.IO, Anthropic and `*.workers.dev`.

## Privacy

- Everything a player saves (settings, keys, Trainer progress, runs, plans) stays in their own browser. Settings → About has backup, restore and erase.
- Runs come from TETR.IO's public API for the username entered. The site follows TETR.IO's guidance of about one request per second.
- The Claude plan sends a stats summary from the player's browser to `api.anthropic.com` with their own API key. The key stays in that browser: only for the tab session unless they tick Remember. One plan uses roughly 1,500 input and 1,500 output tokens.

## Credits

40L Sprint Lab is a fan-made tool. It isn't affiliated with or endorsed by TETR.IO. Run data comes from the public [TETRA CHANNEL API](https://tetr.io/about/api).

IBM Plex Sans, IBM Plex Mono and Chakra Petch are used under the SIL Open Font License; see `assets/fonts/OFL.txt`.
