# Stackpeek extension

[![CI](https://github.com/tonic20/stackpeek-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/tonic20/stackpeek-extension/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An MV3 side-panel extension that detects what a Shopify store is built
with — its theme, its apps, and its tracking pixels — on the currently active
tab.

**[stackpeek.app](https://stackpeek.app)** — what it detects, the permissions
it asks for, and how to install it.

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
`crypto.randomUUID()`, generated once and stored in `browser.storage.local` on
Chrome. On Firefox, storing it is gated behind the optional
`technicalAndInteraction` data-collection grant: decline it and the ID is
instead generated fresh in memory each panel session and never written to
storage. Either way it is not derived from you, your machine, or the page, so
it identifies this installation (or, on Firefox with the grant declined, this
session), not a person; see `lib/install_id.ts` for how it's made. What it
does not send: your browsing history, page contents, form data, or anything
from a tab you did not click the toolbar icon on. The permissions are
`activeTab`, `scripting`, and `storage` on both browsers, plus `sidePanel` on
Chrome — Firefox draws the same panel via `sidebar_action`, which needs no
permission at all, so it has one fewer. No broad host access on either
browser. `lib/collector.ts` is what gets read from the page,
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

The product itself lives at [stackpeek.app](https://stackpeek.app), and the
privacy policy the claims above are written against is at
[stackpeek.app/privacy](https://stackpeek.app/privacy).

## Reproducing the reviewed build (Mozilla Add-ons)

This section exists for AMO source-code review. It is the complete, ordered
procedure for producing a byte-identical copy of the submitted extension.

### Build environment

| | |
|---|---|
| **Node.js** | **24.18.1** — the submitted build used exactly this. The `24` line is what the project targets; `package.json` pins no engine, so use 24.18.1 to reproduce the hashes below exactly. |
| **npm** | **11.16.0** (ships with Node 24.18.1) |
| **Operating system** | Built on **macOS 26.4.1**. No step is OS-specific: the toolchain is Node and npm only, with no native modules, no system libraries and no shell beyond npm scripts. Linux and Windows running the same Node should reproduce it. |
| **Network** | `npm ci` needs registry access. The build itself makes no network calls. |

Installing Node 24.18.1, if you do not have it:

```bash
# with nvm (https://github.com/nvm-sh/nvm)
nvm install 24.18.1 && nvm use 24.18.1

# or download it directly from https://nodejs.org/dist/v24.18.1/
node --version   # must print v24.18.1
npm --version    # must print 11.16.0
```

### Build steps

From the **root of this source archive** — every path below is relative to
where `package.json` sits, and there is no `extension/` directory inside the
archive:

```bash
npm ci                          # 1. install the pinned dependency tree
npm run zip:release:firefox     # 2. build and package the Firefox extension
```

That is the whole procedure. `npm ci` is required rather than `npm install`:
it installs exactly what `package-lock.json` specifies, which is what makes
the output reproducible.

### The build script

Step 2 runs `zip:release:firefox`, defined in `package.json`:

```
"zip:release:firefox": "WXT_API_BASE=https://api.stackpeek.app wxt zip -b firefox"
```

It performs every technical step needed, in this order:

1. Sets `WXT_API_BASE=https://api.stackpeek.app`. **This is load-bearing.**
   The API base is baked into the bundle at build time (`lib/api.ts` reads
   `import.meta.env.WXT_API_BASE`), so building without it produces a
   different, non-matching bundle. `scripts/assert-release-safe.mjs` guards
   the `build`/`zip` scripts against exactly that mistake.
2. Runs WXT, which builds through Vite — rollup bundles the modules into
   hashed chunks, esbuild transforms and minifies, and the Svelte compiler
   turns `.svelte` components into JavaScript.
3. Emits the loadable extension to `.output/firefox-mv3/` and packages it as
   `.output/extension-<version>-firefox.zip`, alongside a sources archive.

No other command, environment variable or manual step is involved.

### Expected output, and how to verify it

```
.output/firefox-mv3/                       loadable unpacked extension
.output/extension-0.4.1-firefox.zip        the submitted package
.output/extension-0.4.1-sources.zip        this archive
```

Two clean builds run in the same shell produce byte-identical output —
verified 2026-08-18 by building, deleting `.output/`, and rebuilding. Both
runs produced the same chunk filename and the same hashes:

```
b63f32a5bd5006d68216fee627dddc8ba2c83eca91dcaddf7813d1894cfcee76  .output/firefox-mv3/background.js
429053d92270fe2cb3323e42e8dcd5b1f5db707b0eeba619b7c0ff4f0bb4fa92  .output/firefox-mv3/chunks/sidepanel-Cbg6EO7m.js
```

Check yours with:

```bash
shasum -a 256 .output/firefox-mv3/background.js .output/firefox-mv3/chunks/*.js
```

If they differ, the two likely causes are `WXT_API_BASE` not being set to
`https://api.stackpeek.app` (which changes a string baked into the bundle),
or having run `npm install` rather than `npm ci`.

### Source files are not machine-generated

Everything in this archive is original source as written: TypeScript under
`lib/` and `entrypoints/`, Svelte components, YAML message catalogues under
`locales/`, and PNG icons under `public/`. Nothing here is transpiled,
concatenated or minified — that all happens during the build, into `.output/`,
which is not part of this archive. The only third-party code is the
dependency tree `package-lock.json` pins, fetched by `npm ci`.

You can also run the test suite and type-checker against these sources:

```bash
npm test        # Vitest
npm run compile # svelte-check
```

Two test blocks skip outside the development monorepo, by design — they read
fixtures that live outside this directory. Everything else runs.

---

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
click **Load unpacked**, and select `.output/chrome-mv3`.

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

The extension's only other permissions are `activeTab`, `scripting`, and
`storage` on both browsers, plus `sidePanel` on Chrome (Firefox draws the same
panel via `sidebar_action`, which needs no permission) — no broad host
permissions, no background browsing history access.

## Manual smoke checklist

The steps below are written against Chrome and require a real browser
instance — they cannot be automated headlessly. The same checks apply on
Firefox with `npm run dev:firefox` in step 2 and `about:debugging#/runtime/this-firefox`
in place of `chrome://extensions`; run them yourself after building:

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
