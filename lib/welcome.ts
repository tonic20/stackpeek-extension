import { browser } from "wxt/browser";
import { i18n } from "#i18n";

// The welcome page, opened once right after a fresh install:
// stackpeek.app/welcome. Its one job is a first scan -- open a Shopify store,
// click the toolbar icon, read the side panel -- and it needs two facts only
// the extension knows to get the reader there. Whether the icon is already on
// the toolbar: recent Chrome pins new extensions itself unless the user turned
// that off, and telling someone to find an icon they can already see is the
// mistake this avoids. And the name the browser's Extensions menu lists it
// under, which is the localized extName while the page is English.
//
// In Chromium the page also gets the extension's id and connects back to it
// for the pin state live: externally_connectable in wxt.config.ts lets it,
// and the onConnectExternal listener below answers.

/** Site the welcome page lives on. An empty string opens nothing on install.
 *  Keep the default in sync with externally_connectable in wxt.config.ts --
 *  test/welcome.test.ts holds the two together. */
export const WELCOME_BASE: string = import.meta.env.WXT_WELCOME_BASE ?? "https://stackpeek.app";

export type WelcomeBrowser = "chrome" | "firefox";

/** What the extension sends to the connected welcome page. */
export type PinMessage = { pinned: boolean };

/** The welcome page address. A fact that is not known is left out, and the
 *  page shows the steps that work either way. */
export function welcomeUrl(o: {
  base: string;
  pinned?: boolean;
  browser: WelcomeBrowser;
  id?: string;
  name?: string;
}): string {
  const url = new URL("/welcome", o.base);
  if (o.pinned !== undefined) url.searchParams.set("pinned", o.pinned ? "1" : "0");
  url.searchParams.set("browser", o.browser);
  if (o.id) url.searchParams.set("id", o.id);
  if (o.name) url.searchParams.set("name", o.name);
  return url.href;
}

/** Registers both listeners. Called synchronously from the background's main,
 *  as every MV3 worker listener must be. */
export function registerWelcomePage(): void {
  // Once, on a fresh install only: not on an update, and not when the browser
  // itself updates.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === "install") void openWelcomePage();
  });

  // Chromium only: Firefox has no externally_connectable, so its page keeps
  // the ?pinned= it was opened with. The change event is Chrome 130+; before
  // that the page hears the state once. The worker sleeps after 30 s of quiet
  // and the port closes with it, and the page then reconnects.
  if (import.meta.env.FIREFOX || !WELCOME_BASE) return;
  const welcomeOrigin = new URL(WELCOME_BASE).origin;
  browser.runtime.onConnectExternal.addListener((port) => {
    if (port.sender?.origin !== welcomeOrigin) {
      port.disconnect();
      return;
    }
    const send = (pinned: boolean | undefined) => {
      if (pinned === undefined) return;
      try {
        port.postMessage({ pinned } satisfies PinMessage);
      } catch {
        // The page closed between the question and the answer.
      }
    };
    browser.action.getUserSettings().then((s) => send(s.isOnToolbar), () => {});
    const changed = browser.action.onUserSettingsChanged as
      | typeof browser.action.onUserSettingsChanged
      | undefined;
    if (!changed) return;
    const onChange = (change: { isOnToolbar?: boolean }) => send(change.isOnToolbar);
    changed.addListener(onChange);
    port.onDisconnect.addListener(() => changed.removeListener(onChange));
  });
}

async function openWelcomePage(): Promise<void> {
  if (!WELCOME_BASE) return;
  let pinned: boolean | undefined;
  try {
    pinned = (await browser.action.getUserSettings()).isOnToolbar;
  } catch {
    // Not known in this browser: the page shows the steps that work either way.
  }
  await browser.tabs.create({
    url: welcomeUrl({
      base: WELCOME_BASE,
      pinned,
      browser: import.meta.env.FIREFOX ? "firefox" : "chrome",
      id: import.meta.env.FIREFOX ? undefined : browser.runtime.id,
      name: i18n.t("extName"),
    }),
  });
}
