// Access to every site, which the user can choose to give and take back.
//
// Without it the panel can read a tab only after a toolbar click (activeTab),
// so an automatic rescan on a tab switch lands on needs_permission. With it,
// the panel reads whichever tab is in front, and the background can mark
// Shopify stores on the toolbar icon (lib/shopify_badge.ts). Both are opt-in:
// the patterns are optional_host_permissions in wxt.config.ts, granted only by
// permissions.request from the panel's switch, and every caller here has to
// cope with the answer changing underneath it -- Chrome's site-access menu and
// Firefox's Permissions tab can both revoke it without the panel.
import { browser } from "wxt/browser";

export const ALL_SITES = ["https://*/*", "http://*/*"];

// On Firefox the switch also asks for the browsingActivity data-collection
// consent (see the data_collection_permissions note in wxt.config.ts): with
// auto-scan on, the origins of the tabs the user switches to reach the API as
// they browse. Firefox 140+ accepts data_collection in the same Permissions
// object as origins, so one request, one prompt, and one remove cover both.
// Read per call rather than once, so the tests can stub the browser.
const wanted = () =>
  import.meta.env.FIREFOX
    ? ({ origins: ALL_SITES, data_collection: ["browsingActivity"] } as { origins: string[] })
    : { origins: ALL_SITES };

export interface HostAccess {
  /** null where the browser has no permissions API (tests, the shots harness). */
  has(): Promise<boolean | null>;
  request(): Promise<boolean>;
  remove(): Promise<boolean>;
  watch(onChange: (granted: boolean) => void): { stop: () => void };
  /** True when an automatic scan must not send anything; see below. */
  blocksAutoScan(): Promise<boolean>;
}

// Both patterns, not either: the switch promises every page, and a user who
// revoked http:// on Firefox's Permissions tab has not got that. On Firefox,
// also the data-collection consent: a user who revoked it in about:addons has
// taken back exactly what the switch asked for, so the switch reads off.
async function has(): Promise<boolean | null> {
  const permissions = browser?.permissions;
  if (!permissions?.contains) return null;
  try {
    return await permissions.contains(wanted());
  } catch {
    return false;
  }
}

// Must be called synchronously from the click handler, before anything is
// awaited: both engines refuse permissions.request outside a user gesture,
// and the gesture ends at the first await.
function request(): Promise<boolean> {
  return Promise.resolve(browser.permissions.request(wanted())).catch(() => false);
}

function remove(): Promise<boolean> {
  return Promise.resolve(browser.permissions.remove(wanted())).catch(() => false);
}

// onAdded/onRemoved say that something changed, not whether the pair the
// switch is about is now complete, so each event re-asks.
function watch(onChange: (granted: boolean) => void): { stop: () => void } {
  const permissions = browser?.permissions;
  if (!permissions?.onAdded) return { stop: () => {} };
  const recheck = () => {
    has().then((granted) => onChange(granted === true));
  };
  permissions.onAdded.addListener(recheck);
  permissions.onRemoved.addListener(recheck);
  return {
    stop() {
      permissions.onAdded.removeListener(recheck);
      permissions.onRemoved.removeListener(recheck);
    },
  };
}

// The gap between the two halves of the Firefox grant. Access to all sites
// and the browsingActivity consent are asked for together, but about:addons
// lets the user withdraw the consent and keep the access -- and the access
// alone is enough for executeScript to read any tab. An automatic scan in
// that state would send the origins of the tabs the user switches to after
// they had said no to exactly that. So while it holds, an automatic rescan is
// treated as if the tab had no access at all: nothing is collected or sent,
// and the panel asks for a click, which is consent for that one page as it
// always was.
//
// Only that state. With neither half granted, automatic rescans behave as they
// always have, on whatever activeTab grant a click left behind; Chrome has no
// such consent and so no such gap. Asked per rescan rather than cached,
// because whether permissions.onRemoved fires for a data-collection consent is
// not something we have verified.
async function blocksAutoScan(): Promise<boolean> {
  if (!import.meta.env.FIREFOX) return false;
  const permissions = browser?.permissions;
  if (!permissions?.contains) return false;
  try {
    const sites = await permissions.contains({ origins: ALL_SITES });
    if (!sites) return false;
    const consent = await permissions.contains({ data_collection: ["browsingActivity"] } as { origins?: string[] });
    return !consent;
  } catch {
    // Unable to tell is not consent.
    return true;
  }
}

export const hostAccess: HostAccess = { has, request, remove, watch, blocksAutoScan };
