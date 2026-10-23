// One class per thing the panel says differently about a failed detect
// (TerminalState.svelte). They used to share one message, "Couldn't reach the
// detector", which sent someone whose wifi had dropped and someone looking at
// our own 500 to the same place -- and only one of them could do anything
// about it.
export class ApiError extends Error {}

// How long the panel holds off after a 429 when the response does not say.
//
// The limit is counted per install over a one-minute window, and one scan
// spends up to four requests of it (lib/detect_runner.ts), so the window
// clears anywhere from a moment to a minute after the refusal. Thirty seconds
// is the middle of that: long enough that the first retry usually lands,
// short enough not to make everyone wait out the worst case. A retry that is
// still early is refused again and starts another countdown, which costs one
// request rather than the four an unguarded rescan would.
export const RATE_LIMIT_COOLDOWN_MS = 30_000;

// A Retry-After further out than this is a clock problem, not advice: the
// HTTP-date form is read against the local clock, and a skewed one turns a
// minute into hours of a dead Retry button.
const MAX_COOLDOWN_MS = 10 * 60_000;

export class RateLimitError extends ApiError {
  constructor(message = "rate limited", readonly retryAfterMs = RATE_LIMIT_COOLDOWN_MS) {
    super(message);
  }
}

// Retry-After is either a number of seconds or an HTTP-date (RFC 9110
// §10.2.3). Readable here although it is not a CORS-safelisted header: the
// extension holds a host permission for the API, which lifts that restriction
// in both engines. null for an absent or unparseable value, which the caller
// replaces with the default rather than trusting.
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null;
  const value = header.trim();
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(Math.max(ms, 1000), MAX_COOLDOWN_MS);
}
// The detector did not answer in DETECT_TIMEOUT_MS. Its own class so the panel
// can say "took too long" rather than "couldn't reach": the request may well
// have arrived, and calling it unreachable would send the user off to check a
// connection that is fine.
export class TimeoutError extends ApiError {}
// fetch() itself rejected: DNS, a refused or reset connection, no route. The
// request never produced a response, so this is the one failure a user's own
// connection can explain.
export class NetworkError extends ApiError {}
// The same rejection, with the browser reporting no network at all. Only the
// false reading of navigator.onLine is trusted: true means merely "some
// interface is up", which a captive portal or a dead router also satisfy, so
// it never upgrades a failure to anything more specific than NetworkError.
export class OfflineError extends NetworkError {}
// The detector answered, and the answer was an error: a non-2xx other than 429,
// or a body that is not the JSON it promised. The user's connection is fine
// and the store is not at fault; the problem is ours.
export class ServerError extends ApiError {}

export interface DetectResponse {
  is_shopify: boolean;
  apps: unknown[];
  infrastructure?: unknown[];
  [key: string]: unknown;
}

// Without a bound, a detector that accepts the connection and never answers
// leaves the panel on its skeleton and "Scanning…" for as long as it stays
// open, with no Retry -- the error state is reached only by a rejection, and a
// hung fetch never rejects.
//
// 15 seconds, three times CONFIG_FETCH_TIMEOUT_MS below, because this request
// does the work: a detect is matched against the fingerprint database, where
// /config is a static list. A healthy answer takes well under a second, so the
// bound is not about the common case. It is sized for a slow connection on a
// cold start, while staying inside the time a person will actually sit
// watching a spinner -- past that they have already given up on it, and the
// honest thing is to say so and offer Retry.
//
// A round that times out after the first has rendered is dropped like any
// other failed round (lib/detect_runner.ts), which is what lets the header's
// "Scanning…" settle instead of spinning on a round that will never land.
export const DETECT_TIMEOUT_MS = 15_000;

export async function postDetect(
  payload: Record<string, unknown>,
): Promise<DetectResponse> {
  const base = import.meta.env.WXT_API_BASE ?? "http://localhost:3070";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);
  const timedOut = () => new TimeoutError(`detect timed out after ${DETECT_TIMEOUT_MS}ms`);
  try {
    let res: Response;
    try {
      res = await fetch(base + "/api/v1/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (e) {
      if (controller.signal.aborted) throw timedOut();
      // Classified by where it was thrown rather than by its type: both
      // engines reject a failed fetch with a TypeError, but the message differs
      // between them ("Failed to fetch", "NetworkError when attempting to fetch
      // resource.") and nothing else can reject here.
      const offline = typeof navigator !== "undefined" && navigator.onLine === false;
      throw new (offline ? OfflineError : NetworkError)(String(e));
    }
    if (res.status === 429) {
      throw new RateLimitError("rate limited", retryAfterMs(res.headers?.get("Retry-After")) ?? RATE_LIMIT_COOLDOWN_MS);
    }
    if (!res.ok) throw new ServerError(`detect failed: ${res.status}`);
    // Awaited here rather than returned as a bare promise, so the body read is
    // inside the bound too: a server that sends headers and then stalls is as
    // hung as one that sends nothing, and `finally` would otherwise clear the
    // timer the moment the headers arrived.
    try {
      return await res.json();
    } catch (e) {
      if (controller.signal.aborted) throw timedOut();
      // A SyntaxError means the detector's body is not JSON. Anything else is
      // the connection dropping mid-body, which is the network's doing, not ours.
      if (e instanceof SyntaxError) throw new ServerError(`detect answered with an unreadable body: ${e.message}`);
      throw new NetworkError(String(e));
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface ConfigResponse {
  window_globals: string[];
  [key: string]: unknown;
}

// Bounds how long a hung /config request can hold up collection. Callers
// (lib/window_globals_config.ts) already treat any rejection here as "fall
// back to the bundled list", so a slow or black-holed connection must not be
// allowed to stall a detect indefinitely waiting on it.
const CONFIG_FETCH_TIMEOUT_MS = 5_000;

export async function fetchConfig(): Promise<ConfigResponse> {
  const base = import.meta.env.WXT_API_BASE ?? "http://localhost:3070";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(base + "/api/v1/config", { signal: controller.signal });
    if (res.status === 429) throw new RateLimitError("rate limited");
    if (!res.ok) throw new ApiError(`config failed: ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}
