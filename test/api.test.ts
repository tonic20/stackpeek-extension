import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { postDetect, fetchConfig, RateLimitError } from "../lib/api";

beforeEach(() => {
  vi.stubEnv("WXT_API_BASE", "http://test.local");
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("postDetect", () => {
  it("POSTs JSON to /api/v1/detect and returns parsed body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ is_shopify: true, apps: [] }),
    });
    const out = await postDetect({ install_id: "k" });
    expect(fetch).toHaveBeenCalledWith(
      "http://test.local/api/v1/detect",
      expect.objectContaining({ method: "POST" }),
    );
    expect(out.is_shopify).toBe(true);
  });

  it("throws RateLimitError on 429", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(postDetect({ install_id: "k" })).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws on other errors", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(postDetect({ install_id: "k" })).rejects.toThrow();
  });
});

describe("fetchConfig", () => {
  it("GETs /api/v1/config and returns parsed body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true, status: 200, json: async () => ({ window_globals: ["dataLayer", "fbq"] }),
    });
    const out = await fetchConfig();
    expect(fetch).toHaveBeenCalledWith(
      "http://test.local/api/v1/config",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(out.window_globals).toEqual(["dataLayer", "fbq"]);
  });

  it("throws RateLimitError on 429", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(fetchConfig()).rejects.toBeInstanceOf(RateLimitError);
  });

  it("throws on other errors", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchConfig()).rejects.toThrow();
  });
});
