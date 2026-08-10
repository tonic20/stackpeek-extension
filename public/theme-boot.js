// Applies the stored scheme before the panel's first paint.
//
// A classic script on purpose. main.ts is a module, so it is deferred and runs
// after parsing; chrome.storage.local is async on top of that. Between those
// two the document can paint with no data-sp-theme attribute, and panel.css
// reads an absent attribute as "follow the system" -- so a user who chose light
// under a dark OS saw the panel open dark and then flip. This file closes that
// gap by running synchronously, before the body is parsed.
//
// It lives in public/ rather than inline in index.html because this extension
// declares no content_security_policy, so MV3's default `script-src 'self'`
// applies and inline scripts are blocked on extension pages. WXT copies
// public/ to the output root verbatim, so the path is stable.
//
// localStorage, not chrome.storage.local, for the one reason that matters here:
// it is synchronous. chrome.storage.local remains the source of truth -- main.ts
// still applies what it holds, and reconciles this if the two ever disagree.
(function () {
  try {
    var stored = localStorage.getItem("sp-theme");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-sp-theme", stored);
    }
  } catch (e) {
    // Storage can be denied outright. Throwing here would abort the parser
    // before the panel's own script loads, trading a wrong colour for a blank
    // panel. Following the system scheme is the correct fallback.
  }
})();
