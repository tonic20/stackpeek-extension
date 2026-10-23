// Where the panel sends someone who wants to say something about it. The
// footer is the only way back to the product from inside it, and a review on
// the store is the only feedback most users will ever give.
//
// Read at call time rather than as a module constant so a test can stub the
// browser; in a build, WXT replaces import.meta.env.FIREFOX with a literal and
// the other branch is dead code either way.
const CHROME_REVIEWS = "https://chromewebstore.google.com/detail/membonhdocoehieifbkfkdjmpappflan/reviews";
const FIREFOX_REVIEWS = "https://addons.mozilla.org/firefox/addon/shopify-theme-app-detector/reviews/";

export function reviewUrl(): string {
  return import.meta.env.FIREFOX ? FIREFOX_REVIEWS : CHROME_REVIEWS;
}

// Mail rather than a form: it needs nothing of ours to work, and it is the
// contact address stackpeek.app already publishes.
export const FEEDBACK_URL = "mailto:hello@stackpeek.app";

export const SITE_URL = "https://stackpeek.app";
