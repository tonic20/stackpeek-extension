import { describe, it, expect, afterEach, vi } from "vitest";
import { reviewUrl } from "../lib/store_links";

afterEach(() => {
  vi.unstubAllEnvs();
});

// A review on the wrong store is a review nobody who could install the
// extension will read.
describe("reviewUrl", () => {
  it("points Chrome at the Web Store's review tab", () => {
    vi.stubEnv("FIREFOX", "");
    expect(reviewUrl()).toBe("https://chromewebstore.google.com/detail/membonhdocoehieifbkfkdjmpappflan/reviews");
  });

  it("points Firefox at the add-on's AMO reviews", () => {
    vi.stubEnv("FIREFOX", "true");
    expect(reviewUrl()).toBe("https://addons.mozilla.org/firefox/addon/shopify-theme-app-detector/reviews/");
  });
});
