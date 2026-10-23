import { browser } from "wxt/browser";

const NAME = "_execute_action";
// The key a user had before switching it off on Firefox, so on brings back
// their own binding rather than the manifest default.
const SAVED_KEY = "shortcutBeforeOff";

export const SHORTCUT_SETTINGS_URL = "chrome://extensions/shortcuts";

export interface Shortcut {
  /** The bound key as the browser spells it ("Alt+Shift+S", "⌥⇧S"); "" when
   *  unbound; null where there is no commands API. */
  read(): Promise<string | null>;
  /** Firefox only: Chrome gives an extension no way to change its own keys,
   *  so there the user goes to SHORTCUT_SETTINGS_URL. */
  canToggle: boolean;
  setEnabled(on: boolean): Promise<void>;
  /** Fires when the binding may have changed: Firefox's commands.onChanged,
   *  and the panel regaining focus after a visit to Chrome's shortcuts page. */
  watch(onChange: () => void): { stop: () => void };
}

async function read(): Promise<string | null> {
  const commands = browser?.commands;
  if (!commands?.getAll) return null;
  try {
    const all = await commands.getAll();
    return all.find((c) => c.name === NAME)?.shortcut ?? "";
  } catch {
    return null;
  }
}

// Firefox's additions; Chrome's types, which wxt/browser carries, lack both.
type FirefoxCommands = {
  update(detail: { name: string; shortcut: string }): Promise<void>;
  reset(name: string): Promise<void>;
};

async function setEnabled(on: boolean): Promise<void> {
  const commands = browser.commands as unknown as FirefoxCommands;
  const local = browser.storage?.local;
  if (on) {
    const saved = (await local?.get(SAVED_KEY))?.[SAVED_KEY];
    if (typeof saved === "string" && saved) await commands.update({ name: NAME, shortcut: saved });
    else await commands.reset(NAME);
    return;
  }
  const current = await read();
  if (current) await local?.set({ [SAVED_KEY]: current });
  await commands.update({ name: NAME, shortcut: "" });
}

type Event = { addListener(fn: () => void): void; removeListener(fn: () => void): void };

function watch(onChange: () => void): { stop: () => void } {
  const changed = (browser?.commands as { onChanged?: Event } | undefined)?.onChanged;
  changed?.addListener(onChange);
  const onVisible = () => { if (document.visibilityState === "visible") onChange(); };
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onVisible);
  return {
    stop() {
      changed?.removeListener(onChange);
      window.removeEventListener("focus", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    },
  };
}

export const shortcut: Shortcut = { read, canToggle: !!import.meta.env.FIREFOX, setEnabled, watch };
