// The manifest is the single source of the extension's version. A literal in
// the footer is a second place to remember to bump, and it is wrong the first
// time someone forgets (panel design D8).
//
// Read through globalThis, not as a bare `chrome`: under Vitest the identifier
// is not merely undefined, it is undeclared, and `chrome?.runtime` would throw
// a ReferenceError that optional chaining cannot catch. Property access on
// globalThis is safe either way.
export function extensionVersion(): string {
  return globalThis.chrome?.runtime?.getManifest?.().version ?? "";
}
