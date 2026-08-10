export class ApiError extends Error {}
export class RateLimitError extends ApiError {}

export interface DetectResponse {
  is_shopify: boolean;
  apps: unknown[];
  infrastructure?: unknown[];
  [key: string]: unknown;
}

export async function postDetect(
  payload: Record<string, unknown>,
): Promise<DetectResponse> {
  const base = import.meta.env.WXT_API_BASE ?? "http://localhost:3070";
  const res = await fetch(base + "/api/v1/detect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status === 429) throw new RateLimitError("rate limited");
  if (!res.ok) throw new ApiError(`detect failed: ${res.status}`);
  return res.json();
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
