# Stackpeek extension

[![CI](https://github.com/tonic20/stackpeek-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/tonic20/stackpeek-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A Chrome MV3 side-panel extension that detects what a Shopify store is built
with — its theme, its apps, and its tracking pixels — on the currently active
tab.

## Why this is public

Stackpeek asks you to install something that reads the page you are looking at.
"Trust us" is not an answer to that, and an extension bundle is half-readable
anyway once you unpack it. So the whole thing is here, MIT licensed: read what
it collects, when it fires, and where it sends the result before you install
it.

What it sends: the page's origin — scheme, host, and port, for example
`https://store.example` — the detection signals found on the page, and a
random per-install identifier. The rest of the page's own URL never leaves
the browser: path, query string, and fragment are all cut before the payload
is built.

Asset URLs — `script[src]` and `link[href]` — are handled differently,
because some app fingerprints match on a path with no fixed host at all (for
example `add-to-cart.js`, matched only when it's served from the merchant's
own origin), and dropping the path would stop detecting those apps:

- **Same-origin assets** keep their path but have their query string and
  fragment stripped, so search terms, discount codes, UTM parameters, and
  cart tokens carried in an asset URL's query string never leave the browser
  either.
- **Third-party assets** are sent whole, query string included, because the
  backend matches app and pixel signatures against the full URL.
- **Page-identity links** — `rel="canonical"`, `"next"`, `"prev"`,
  `"alternate"`, `"shortlink"`, `"amphtml"` — are never collected, at any
  origin, because they disclose which page was viewed rather than what the
  store runs.

One consequence of this is worth stating plainly: any other same-origin
asset — a `script[src]`, or a `link[href]` whose `rel` isn't one of the six
kinds excluded above (this includes `preload`, `prefetch`, and
`modulepreload`) — can still carry a page-specific path. So a page-specific
asset path can reach the server even though the page's own URL never does.

The identifier is a
`crypto.randomUUID()` generated once and stored in `chrome.storage.local` —
it is not derived from you, your machine, or the page, so it identifies this
installation, not a person; see `lib/install_id.ts` for how it's made. What
it does not send: your browsing history, page contents, form data, or
anything from a tab you did not click the toolbar icon on. The permissions
are `activeTab`, `scripting`, `sidePanel`, and `storage` — no broad host
access. `lib/collector.ts` is what gets read from the page,
`lib/collect_bridge.ts` is where the tab's URL is cut down to an origin
before it joins the payload, `lib/install_id.ts` is where the identifier
above comes from, and `lib/api.ts` is what actually leaves the browser —
check those four for what this section claims.

The backend this talks to (the store corpus, the app fingerprint database, the
Rails API) is not open source. This repository is the client, so one claim
above is about code you cannot read here and have to take on the backend's
word rather than check yourself: it drops the install identifier before
archiving a detection, so what's recorded isn't linked back to an install.

## About this repository

This is a read-only mirror. The extension is developed in a private monorepo
alongside the backend, and each release here is one commit holding that
directory's current state — so this repository can lag the monorepo, and its
history is a list of publications rather than of individual changes.

Pull requests are welcome and get merged upstream by hand, so expect a reply
rather than a merge button. Two test blocks — the design-bundle comparison in
`test/design_system_sync.test.ts` and the best-sellers replay in
`test/shots_best_sellers_fixture.test.ts` — skip here by design: they read
fixtures that live in the monorepo. Everything else runs, and CI above is the
proof.

## Requirements

- Node.js + npm
- Chrome (or any Chromium-based browser with MV3 support) for loading/testing
  the built extension
- For local development, a running Stackpeek backend on `http://localhost:3070`.
  The backend is not part of this repository (see About this repository, above);
  without it the panel builds and runs but every detect request fails. Working
  in the monorepo, it is at `../backend`.

## Development

This project is built with [WXT](https://wxt.dev). For day-to-day
development, run:

```bash
npm run dev
```

This starts WXT in watch mode, builds the extension, and **auto-launches a
Chrome window with the extension already installed**, with hot-reload on
source changes. With no `WXT_API_BASE` set, the extension talks to
`http://localhost:3070` — start the backend before clicking around (see
Requirements, above). Stop with Ctrl-C.

For Firefox instead of Chrome:

```bash
npm run dev:firefox
```

## Build

```bash
npm run build
```

`wxt build` always runs in `production` mode, so the manifest's
`host_permissions` never includes `http://localhost:3070/*` (see
`wxt.config.ts`) -- only `https://api.stackpeek.app/*`. The extension code
still defaults to `http://localhost:3070` when `WXT_API_BASE` is unset, so a
plain `npm run build` produces an extension that cannot reach a local
backend; use `npm run dev` for that (see Development, above). For a
production build pointed at your deployed backend, set `WXT_API_BASE`:

```bash
WXT_API_BASE=https://api.stackpeek.app npm run build
```

The build writes a loadable unpacked extension to `.output/chrome-mv3/`:

- `.output/chrome-mv3/manifest.json` — generated by WXT from `wxt.config.ts`
- `.output/chrome-mv3/background.js` — MV3 service worker (opens the side
  panel on toolbar-icon click)
- `.output/chrome-mv3/sidepanel.html` + `chunks/` — the Svelte side-panel UI,
  bundled with the collector/injection bridge; the API base URL is read from
  `import.meta.env.WXT_API_BASE` at call time (see `lib/api.ts`)

To load it manually: open `chrome://extensions`, enable **Developer mode**,
click **Load unpacked**, and select `extension/.output/chrome-mv3`.

## Test

```bash
npm test
```

Runs the full Vitest suite — 40 files, 336 tests as of August 2026 — covering
the collector, install_id, the API client, the `App` state machine, the
collect bridge, and every panel component. No build step is required.

Two blocks skip in this repository and run in the monorepo: the design-bundle
byte-comparison and the best-sellers replay both read fixtures from outside
this directory. A skip there is expected; a failure is not.

Type-check the Svelte/TypeScript sources with:

```bash
npm run compile
```

## Deploying to production

`wxt.config.ts`'s `manifest.host_permissions` is a function of the build
mode, so the localhost grant is dev-only and automatic -- there is nothing
to manage by hand:

```ts
host_permissions:
  env.mode === "development"
    ? ["http://localhost:3070/*", "https://api.stackpeek.app/*"]
    : ["https://api.stackpeek.app/*"],
```

Any build that isn't `npm run dev` (or `npm run dev:firefox`) -- including a
plain `npm run build` -- runs in `production` mode and drops the localhost
entry automatically. Before shipping a production build:

1. Confirm `https://api.stackpeek.app/*` in `wxt.config.ts` matches your real
   backend host (update it if it doesn't).
2. Run the prod build with a matching `WXT_API_BASE` (see above) so the
   API URL used at runtime and the granted host permission agree.

The extension's only other permissions are `activeTab`, `scripting`,
`sidePanel`, and `storage` — no broad host permissions, no background
browsing history access.

## Manual smoke checklist

The steps below require a real Chrome instance and cannot be automated
headlessly — run them yourself after building:

1. **Start the backend.** From the monorepo's `backend/` (not part of this
   repository):
   ```bash
   bin/rails server
   bin/rails seed:fingerprints   # if not already seeded
   ```
   Confirm it's serving on `http://localhost:3070`.

2. **Run the extension against the local API** (from `extension/`) with
   `npm run dev` for hot-reload dev mode (auto-launches Chrome with the
   extension loaded). This is the only build mode whose manifest grants the
   `http://localhost:3070/*` host permission (see Deploying to production,
   above); a plain `npm run build` runs in production mode, drops that
   grant, and cannot reach a local backend even though its code still
   defaults to `http://localhost:3070` -- don't use it for this checklist.

3. **Load unpacked** (skip this -- `npm run dev` does it for you).

4. **Smoke on live stores.** Click the toolbar icon on each of the following
   tabs and confirm the side panel renders the expected state:
   - `https://www.allbirds.com` → Shopify detected, custom theme, apps
     (e.g. Judge.me/Yotpo), some tracking pixels listed.
   - `https://www.gymshark.com` → Shopify detected, headless theme state,
     apps still listed.
   - `https://example.com` (or any non-Shopify site) → "Not a Shopify
     store."
   - a `chrome://extensions` tab (or any other `chrome://` page) → "Can't
     scan this page."

5. **Confirm the flywheel is live.** After the clicks above, check that the
   backend's store/domain tables grew. From the monorepo's `backend/` (not
   part of this repository):
   ```bash
   bin/rails runner "puts Store.count; puts UnknownDomain.count"
   ```
   Counts should reflect the sites visited in step 4 (Shopify stores land in
   `Store`, non-Shopify/unclassified domains land in `UnknownDomain`).

These are the only steps in the extension's acceptance criteria that require
a live browser and live stores; everything else (build, manifest, unit
tests) is verified automatically as part of the build/test commands above.
