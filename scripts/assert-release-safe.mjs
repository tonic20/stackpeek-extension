#!/usr/bin/env node
// Preflight for `npm run build` / `npm run zip`.
//
// lib/api.ts falls back to LOCALHOST_API_BASE whenever WXT_API_BASE isn't
// baked into the bundle at build time (import.meta.env.WXT_API_BASE ?? "..."),
// and that fallback is correct for `npm run dev`. The hazard is a *production*
// build made the same way: `npm run build` or `npm run zip` with WXT_API_BASE
// unset produces a bundle that looks completely normal -- right manifest,
// right permissions, right file count -- but whose API base is the
// developer's own machine. Nothing fails until a real user installs it: every
// detect request silently 000s against a laptop that isn't listening, and
// fixing it means shipping a whole new extension release. So this preflight
// fails the build itself rather than trusting a human to remember the flag
// every time. `WXT_ALLOW_LOCALHOST=1` is the deliberate escape hatch for CI's
// `npm run build` smoke test (.github/workflows/extension-ci.yml), which
// exists only to catch bad dependency resolution and is never uploaded
// anywhere -- see that step's comment.
//
// This used to live inside wxt.config.ts's `manifest(env)` function, but that
// function is evaluated by every WXT command, including `wxt prepare` -- which
// runs as this package's `postinstall`. That made the guard fire on plain
// `npm install` / `npm ci`, before any release artifact existed to guard.
// Living here, it only runs from the scripts that actually produce one.
const LOCALHOST_API_BASE = "http://localhost:3070";

const isLocalhost = (value) => value.includes("localhost") || value.includes("127.0.0.1");

export function assertReleaseSafe(env = process.env) {
  if (env.WXT_ALLOW_LOCALHOST) return;

  const apiBase = env.WXT_API_BASE;

  if (!apiBase) {
    throw new Error(
      "Production build with no WXT_API_BASE set: the bundle would silently " +
        `fall back to ${LOCALHOST_API_BASE} (extension/lib/api.ts), which is ` +
        "only correct for local dev. Use `npm run build:release` (or " +
        "`npm run zip:release`), which sets WXT_API_BASE=https://api.stackpeek.app. " +
        "If this really is a non-releasable compile check (e.g. CI), set " +
        "WXT_ALLOW_LOCALHOST=1 explicitly.",
    );
  }

  if (isLocalhost(apiBase)) {
    throw new Error(
      `Production build with WXT_API_BASE="${apiBase}", which points at ` +
        "localhost -- a half-typed API base is as bad as a missing one. Use " +
        "`npm run build:release` (or `npm run zip:release`), which sets " +
        "WXT_API_BASE=https://api.stackpeek.app. If this really is a " +
        "non-releasable compile check (e.g. CI), set WXT_ALLOW_LOCALHOST=1 explicitly.",
    );
  }
}

// Only run as a CLI check when executed directly -- importing this module
// (as the test suite does) must not have the side effect of validating the
// current process's environment.
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    assertReleaseSafe();
  } catch (err) {
    console.error(`[error] ${err.message}`);
    process.exit(1);
  }
}
