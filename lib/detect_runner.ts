import type { DetectResponse } from "./api";
import { InjectionDeniedError } from "./errors";

// Sized against the measured completeness curve on spotonfence.com: 61% of the
// collectable surface exists at 800ms, 79% at 3s, 89% at 8s, and it plateaus at
// 10s. See docs/superpowers/specs/2026-07-29-detect-latency-design.md.
export const ROUND_DELAYS_MS = [0, 1500, 4000, 8000];

export interface RunRoundsOptions {
  collect: () => Promise<{ signals: unknown; url: string | undefined }>;
  send: (payload: Record<string, unknown>) => Promise<DetectResponse>;
  installId: string;
  // The URL rides along because the panel header names the store being scanned
  // and the API response carries no domain of its own -- only
  // unknown_domain_count. Nothing new is collected: this is the same tab URL
  // already sent with every round.
  onUpdate: (result: DetectResponse, url: string | undefined) => void;
  onNoSignals: () => void;
  delays?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Identity of a collected signal set, for deciding whether anything changed.
function signalKey(signals: any): string {
  return JSON.stringify([
    [...(signals.script_urls ?? [])].sort(),
    [...(signals.window_globals ?? [])].sort(),
    [...(signals.meta_tags ?? [])].sort(),
    signals.shopify ?? null,
  ]);
}

export async function runRounds(opts: RunRoundsOptions): Promise<void> {
  const delays = opts.delays ?? ROUND_DELAYS_MS;
  const sleep = opts.sleep ?? defaultSleep;

  let previousRoundKey: string | null = null;
  let lastCollected: { signals: unknown; url: string | undefined } | null = null;
  let hasResult = false;

  // Sends one round and reports it via onUpdate. Returns true when the caller
  // should stop looping: either this round was final, or the send failed and
  // there's already a rendered result to preserve rather than blow away. A
  // send failure is only re-thrown when nothing has ever succeeded yet — at
  // that point there is no result to fall back to, so the caller (App.svelte)
  // must still surface it as an error, exactly as it always has.
  async function sendRound(signals: unknown, url: string | undefined, isFinal: boolean): Promise<boolean> {
    let result: DetectResponse;
    try {
      result = await opts.send({
        install_id: opts.installId,
        url,
        final: isFinal,
        ...(signals as Record<string, unknown>),
      });
    } catch (e) {
      if (!hasResult) throw e;
      return true;
    }
    hasResult = true;
    opts.onUpdate(result, url);
    return isFinal;
  }

  // Iterating entries() rather than an index keeps `delay` a plain number under
  // noUncheckedIndexedAccess; `delays[i - 1]` is undefined only on the first
  // round, which is exactly the round that must not sleep.
  for (const [i, delay] of delays.entries()) {
    const previous = delays[i - 1];
    if (previous !== undefined) await sleep(delay - previous);

    // A dropped tab (closed, discarded, navigated to a chrome:// page mid-scan)
    // makes collect() reject rather than resolve with null signals. Treat both
    // the same way: it's just a round with nothing new, not a fatal error.
    let collected: { signals: unknown; url: string | undefined };
    try {
      collected = await opts.collect();
    } catch (e) {
      // A refusal is re-thrown only while nothing has succeeded yet, which is
      // the same rule sendRound already applies to a failing send: once there
      // is a result on screen it is worth more than the error, and a later
      // round losing access (the user navigated away mid-scan) should not blow
      // it away. With no result yet, the panel must be able to tell this apart
      // from an unscannable page.
      if (e instanceof InjectionDeniedError && !hasResult) throw e;
      collected = { signals: null, url: undefined };
    }
    const { signals, url } = collected;

    if (!signals) {
      if (i === 0) { opts.onNoSignals(); return; }
      continue;
    }
    lastCollected = { signals, url };

    const key = signalKey(signals);
    const settled = key === previousRoundKey;
    const isFinal = settled || i === delays.length - 1;
    previousRoundKey = key;

    // No separate "skip if unchanged from what we last sent" guard here:
    // settling (key === previousRoundKey, checked above) already forces
    // isFinal, so an unsent duplicate never reaches this point — a round can
    // only repeat a signal set after having already been finalized once.
    // The settle-and-finalize path above is what actually avoids redundant
    // sends.
    if (await sendRound(signals, url, isFinal)) return;
  }

  // The loop ran out of rounds without ever sending a final: the last round's
  // collect() came back empty (or threw), so it got skipped rather than
  // finalized. Re-send the last signals we did manage to collect, marked
  // final, so the scan still gets recorded exactly once instead of never.
  if (lastCollected) {
    await sendRound(lastCollected.signals, lastCollected.url, true);
  }
}
