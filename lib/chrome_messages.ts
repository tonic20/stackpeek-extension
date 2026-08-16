import type { ChromeMessage } from "@wxt-dev/i18n/build";

// Chrome's browser.i18n.getMessage lookup and $n substitution, factored out
// so test/setup.ts and shots/i18n_shim.ts share one implementation of
// Chrome's behaviour instead of drifting copies of it. (The library itself
// is not a third copy: t() in @wxt-dev/i18n hands the substitutions array
// straight to browser.i18n.getMessage and only does the " | " plural split
// itself -- the $n substitution is Chrome's job, which is why both shims have
// to reproduce it.)
//
// No Node dependencies: shots/i18n_shim.ts imports this and is bundled for
// the browser, so anything here has to stay importable there.

// Matches the library's own substitution regex: "$$1" is an escaped literal,
// not a placeholder -- the negative lookbehind is what keeps "$" followed by
// "$1" from being read as a substitution. No message uses the escape today;
// one that did would need a case here.
export function substitute(message: string, subs: string[]): string {
  return message.replace(/(?<!\$)\$(\d)/g, (_m, d) => subs[Number(d) - 1] ?? "");
}

// Builds a function matching browser.i18n.getMessage's signature. `onMissing`
// is where the two callers deliberately diverge: a missing key means a typo
// in test/setup.ts, so it throws there and fails the suite; a missing key in
// shots/i18n_shim.ts means the real Chrome behaviour for a message it does
// not have, so it returns "" there, blanking one label rather than crashing
// the whole mount -- t() is called during component initialization, so a
// throw in the harness would take the entire render down instead of one slot.
export function makeGetMessage(
  messages: Record<string, ChromeMessage | undefined>,
  onMissing: (name: string) => string,
): (name: string, substitutions?: string[]) => string {
  return (name, substitutions) => {
    const entry = messages[name];
    if (entry === undefined) return onMissing(name);
    return substitute(entry.message, substitutions ?? []);
  };
}
