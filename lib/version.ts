// The manifest is the single source of the extension's version. A literal in
// the footer is a second place to remember to bump, and it is wrong the first
// time someone forgets (panel design D8).

import { browser } from "wxt/browser";

export function extensionVersion(): string {
  return browser?.runtime?.getManifest?.().version ?? "";
}
