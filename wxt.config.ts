import { defineConfig } from "wxt";

// WXT config — https://wxt.dev
// Manifest is generated from this file; the sidepanel entrypoint auto-registers
// side_panel.default_path. Extension version comes from package.json (0.1.0).
export default defineConfig({
  modules: ["@wxt-dev/module-svelte", "@wxt-dev/i18n/module"],
  // Manifest is a function of the build env so the localhost host permission
  // can be dropped from anything that isn't a development build. The Chrome
  // Web Store build must not ask for access to the user's own machine, and
  // the privacy page (backend/app/views/pages/privacy.html.erb) discloses
  // only https://api.stackpeek.app — it says nothing about localhost, so the
  // manifest can't either. `npm run dev` runs WXT with mode "development"
  // (see ConfigEnv in wxt/dist/types.d.mts); every other command, including
  // `wxt build`, defaults to "production".
  manifest: (env) => {
    return {
      // Both strings are the Chrome Web Store listing title and summary,
      // decided in docs/launch-research.md §7.1. They now live in
      // locales/en.yml, but they still ship in the build -- __MSG_ placeholders
      // are resolved from _locales/ at install time, not fetched -- so changing
      // either still means another extension release, not a store-field edit.
      // What the move buys is the Chrome dashboard's language dropdown, which
      // offers only locales present as _locales/<code>/ in the upload.
      default_locale: "en",
      name: "__MSG_extName__",
      description: "__MSG_extDescription__",
      permissions: ["activeTab", "scripting", "sidePanel", "storage"],
      host_permissions:
        env.mode === "development"
          ? ["http://localhost:3070/*", "https://api.stackpeek.app/*"]
          : ["https://api.stackpeek.app/*"],
      // WXT copies public/ to the output root, so these resolve as-is. Filenames
      // match the design bundle's exactly, which keeps the byte-identity guard
      // legible: guard, source and destination all name the same file.
      icons: {
        16: "icon-16.png",
        32: "icon-32.png",
        48: "icon-48.png",
        128: "icon-128.png",
      },
      action: {
        default_title: "__MSG_actionTitle__",
        default_icon: {
          16: "icon-16.png",
          32: "icon-32.png",
          48: "icon-48.png",
          128: "icon-128.png",
        },
      },
    };
  },
});
