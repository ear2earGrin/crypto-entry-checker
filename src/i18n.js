import { useEffect, useState } from "react";

/**
 * Language plumbing for the React pages.
 *
 * The desk does not own the language switch. When this bundle is served inside
 * pm-brief.com/trading/ the site's own toggle (js/i18n-site.js) writes the
 * choice to <html lang> plus localStorage['yf-lang'] and fires a
 * 'yf:langchange' event. The static pages translate themselves with duplicated
 * `data-lang` spans; React can't do that, so the pages read the language from
 * here instead and one toggle drives both.
 *
 * Standalone (the Mac's dev server) there is no toggle and no <html lang>
 * beyond "en", so everything stays English — nothing to configure.
 *
 * Anything a dictionary doesn't translate falls back to English. That is what
 * lets a single page ship in a new language before the rest of the desk does.
 */

const SUPPORTED = ["en", "bg", "el"];

export function currentLang() {
  const raw = (document.documentElement.getAttribute("lang") || "en").toLowerCase().slice(0, 2);
  return SUPPORTED.includes(raw) ? raw : "en";
}

/** Re-renders the calling page when the site toggle changes language. */
export function useLang() {
  const [lang, setLang] = useState(currentLang);
  useEffect(() => {
    const sync = () => setLang(currentLang());
    document.addEventListener("yf:langchange", sync);
    // The event is the site's contract, but the attribute is the truth: the
    // inline bootstrap in trading/index.html sets it before this bundle runs,
    // and a future toggle might set it without announcing. Watch both.
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    sync();
    return () => {
      document.removeEventListener("yf:langchange", sync);
      mo.disconnect();
    };
  }, []);
  return lang;
}

/**
 * Builds the `t` a page calls. A dictionary entry is `{ en, el, ... }` whose
 * value is a string, or a function when the phrase interpolates numbers:
 *
 *   const dict = { open: { en: (n) => `${n} open`, el: (n) => `${n} ανοιχτές` } };
 *   t("open", 3)
 *
 * A missing key returns the key itself rather than throwing — a typo shows up
 * as visible text instead of a blank page.
 */
export function translator(dict, lang) {
  return function t(key, ...args) {
    const entry = dict[key];
    if (!entry) return key;
    const value = entry[lang] !== undefined ? entry[lang] : entry.en;
    return typeof value === "function" ? value(...args) : value;
  };
}
