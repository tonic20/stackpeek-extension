import { defineConfig } from "wxt";

// WXT config — https://wxt.dev
// Manifest is generated from this file; the sidepanel entrypoint auto-registers
// side_panel.default_path on Chromium and sidebar_action on Firefox. Extension
// version comes from package.json.
export default defineConfig({
  modules: ["@wxt-dev/module-svelte", "@wxt-dev/i18n/module"],
  // WXT defaults Firefox to MV2. Force MV3 so both stores ship the same
  // background and API semantics and there is no MV2 code path to maintain.
  // Chrome is already MV3, so its manifest must come out unchanged — the test
  // suite checks that rather than assuming it.
  //
  // The usual objection to Firefox MV3 is that host_permissions are opt-in, so
  // https://api.stackpeek.app/* would need granting by hand before any detect
  // works. That applies only to Firefox 121-126; from 127 they are granted at
  // install, and strict_min_version below excludes those releases anyway.
  manifestVersion: 3,
  // Manifest is a function of the build env twice over.
  //
  // On mode, so the localhost host permission can be dropped from anything that
  // isn't a development build. The Chrome Web Store build must not ask for
  // access to the user's own machine, and the privacy page
  // (backend/app/views/pages/privacy.html.erb) discloses only
  // https://api.stackpeek.app — it says nothing about localhost, so the
  // manifest can't either. `npm run dev` runs WXT with mode "development" (see
  // ConfigEnv in wxt/dist/types.d.mts); every other command, including
  // `wxt build`, defaults to "production".
  //
  // On browser, because two keys in the returned object differ between the
  // stores and WXT strips neither on its own: `permissions` (Firefox rejects
  // `sidePanel`, which it does not implement) and `browser_specific_settings`
  // (Chrome logs it as an unrecognized manifest key).
  //
  // The sidebar icon is deliberately NOT a third: WXT's addEntrypoints
  // reassigns manifest.sidebar_action wholesale after this object is merged,
  // so anything set here for that key is discarded. It is declared on the
  // entrypoint instead -- see entrypoints/sidepanel/index.html.
  manifest: (env) => {
    const firefox = env.browser === "firefox";

    // Firefox needs no permission to draw a sidebar and addons-linter rejects
    // the string outright (MANIFEST_PERMISSIONS). Chrome needs it.
    const permissions = firefox
      ? ["activeTab", "scripting", "storage"]
      : ["activeTab", "scripting", "sidePanel", "storage"];

    // The four rasterisations the action already uses. WXT copies public/ to
    // the output root, so these resolve as-is, and the filenames match the
    // design bundle's exactly — which keeps the byte-identity guard legible:
    // guard, source and destination all name the same file.
    const icons = {
      16: "icon-16.png",
      32: "icon-32.png",
      48: "icon-48.png",
      128: "icon-128.png",
    };

    // The welcome page (lib/welcome.ts) connects back for the live pin state.
    // Chromium only: Firefox does not support externally_connectable. It is
    // not a permission and adds no install warning. The default must match
    // WELCOME_BASE there, which cannot be imported here: it reads
    // import.meta.env, and this file runs in Node.
    const welcomeBase = process.env.WXT_WELCOME_BASE ?? "https://stackpeek.app";

    return {
      // Both strings are the store listing title and summary. They now live in
      // locales/*.yml, generated from docs/store-listing/_locales by
      // scripts/build-extension-locales.ts, but they still ship in the build
      // -- __MSG_ placeholders are resolved from _locales/ at install time,
      // not fetched -- so changing either still means another extension
      // release, not a store-field edit. What the move buys is the store
      // dashboards' language dropdown, which offers only locales present as
      // _locales/<code>/ in the upload.
      default_locale: "en",
      name: "__MSG_extName__",
      description: "__MSG_extDescription__",
      permissions,
      host_permissions:
        env.mode === "development"
          ? ["http://localhost:3070/*", "https://api.stackpeek.app/*"]
          : ["https://api.stackpeek.app/*"],
      // Every site, but only if the user asks for it: the panel's "Scan
      // automatically as I switch tabs" switch requests these at runtime
      // (lib/host_access.ts) and can hand them back. Optional host
      // permissions add no install-time warning -- checked against Chrome's
      // own chrome.management.getPermissionWarningsByManifest, which lists
      // only the api.stackpeek.app line with these present and "Read and
      // change all your data on all websites" with the same patterns made
      // required. Nobody who leaves the switch off is asked for anything new.
      //
      // Same key on both browsers. Firefox has read it in MV3 since 128,
      // below strict_min_version, and lists it on the add-on's Permissions
      // tab, where the user can grant or revoke it without the panel.
      optional_host_permissions: ["https://*/*", "http://*/*"],
      icons,
      action: {
        default_title: "__MSG_actionTitle__",
        default_icon: icons,
      },
      ...(!firefox && welcomeBase
        ? { externally_connectable: { matches: [`${new URL(welcomeBase).origin}/*`] } }
        : {}),
      // A keyboard way to do what the toolbar click does. _execute_action,
      // not a named command: with no popup it dispatches action.onClicked,
      // so the panel opens through the same handler, the shortcut grants
      // activeTab exactly as the click does ("executing a keyboard shortcut
      // from the commands API" is one of activeTab's gestures), and an
      // already-open panel rescans through lib/action_click.ts. A named
      // command would need its own path to all three, and commands.onCommand
      // never fires for _execute_action anyway.
      //
      // Alt+Shift+S: Chrome's own Alt+Shift shortcuts are T, I, A and N, and
      // the Mac Option+Shift ones also need Command; Firefox has none on S.
      // Only a suggestion -- both browsers let the user rebind it, and drop
      // it silently if another extension already holds it. Which is also why
      // actionTitle does not name it: the tooltip would go on saying
      // Alt+Shift+S after the user had changed it.
      commands: {
        _execute_action: {
          suggested_key: { default: "Alt+Shift+S" },
        },
      },
      // Firefox-only, and it must stay that way: WXT does NOT strip
      // browser_specific_settings from the Chromium builds, where Chrome logs
      // "Unrecognized manifest key".
      ...(firefox
        ? {
            browser_specific_settings: {
              gecko: {
                // Permanent. Once AMO has accepted a submission under this id
                // it can never change.
                id: "stackpeek@kopylov.net",
                // Two independent floors, the higher wins. 127 is where MV3
                // host_permissions start being granted at install; 140 is where
                // data_collection_permissions below exists at all — under it the
                // key is silently ignored, users see no consent UI, and
                // addons-linter reports KEY_FIREFOX_UNSUPPORTED_BY_MIN_VERSION.
                // ESR 140 clears both.
                strict_min_version: "140.0",
                // Required of every new AMO submission since 2025-11-03, and
                // the text Firefox shows at install — so it has to agree with
                // /privacy.
                //
                // websiteContent (required): the store origin, script URLs,
                // JavaScript globals and theme metadata that lib/detect_runner.ts
                // sends every round. Page content by any reading.
                //
                // technicalAndInteraction (optional, and it can ONLY be
                // optional — Mozilla's rule is that this type must not be
                // required): the anonymous install_id. lib/install_id.ts honours
                // a refusal by falling back to an id that is never persisted.
                //
                // browsingActivity (optional, and asked for only by the
                // auto-scan switch): "information about the websites users
                // visit, such as specific URLs, domains". With auto-scan on,
                // every tab the user switches to while the panel is open is
                // scanned without a click, so the origins of pages they visit
                // reach the API as they browse -- which is that, even though
                // observations still carry the store and not the install.
                // lib/host_access.ts requests it at runtime in the same
                // permissions.request as the all-sites origins (Firefox 140+
                // takes data_collection there), treats the switch as on only
                // when both are granted, and removes both when it is turned
                // off. A user who never turns auto-scan on is never asked, and
                // a scan they start with a click sends nothing it did not
                // send before.
                //
                // Not websiteActivity, which an earlier version of this note
                // named for the same worry: Firefox defines it as "interactions
                // and mouse and keyboard activity, such as scrolling, clicking,
                // typing", none of which is collected in any mode.
                data_collection_permissions: {
                  required: ["websiteContent"],
                  optional: ["technicalAndInteraction", "browsingActivity"],
                },
              },
              // No gecko_android: Firefox for Android does not implement
              // sidebar_action, so the panel would have nowhere to render.
            },
            // No sidebar_action here: WXT's addEntrypoints reassigns it
            // wholesale from the sidepanel entrypoint's own options AFTER this
            // object is merged in, so anything set here is silently discarded.
            // The sidebar's icon comes from a meta tag in
            // entrypoints/sidepanel/index.html instead -- see the comment
            // there.
          }
        : {}),
    };
  },
});
