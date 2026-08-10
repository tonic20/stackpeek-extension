// Chrome refused to inject the collector because the extension has no access to
// this tab. That is a different fact from "this page cannot be scanned", and
// the panel says a different thing about each: a refusal is recoverable by
// clicking the toolbar icon, which is the only thing that grants activeTab.
//
// Shared by collect_bridge (throws it), detect_runner (propagates it) and
// App.svelte (renders it), which is why it lives in a module of its own rather
// than in any of the three.
export class InjectionDeniedError extends Error {}
