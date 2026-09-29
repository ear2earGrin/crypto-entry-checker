/**
 * News radar: parse RSS/Atom feeds, find which coins and narratives each
 * headline is about, classify the event type, and grade it.
 *
 *   A — a concrete event (partnership, listing, ETF filing, launch, hack)
 *       reported as news
 *   B — relevant coverage without a concrete event
 *   C — opinion, prediction or price commentary
 *
 * Keyword rules, not AI: fast, free, and the same input always gives the same
 * grade. The optional AI explainer lives elsewhere and never changes grades.
 */

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function clean(s) {
  if (!s) return "";
  const noCdata = String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return decodeEntities(noCdata.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}

/** Parses RSS 2.0 <item> or Atom <entry> blocks into plain objects. */
export function parseFeed(xml, source) {
  const out = [];
  const blocks = String(xml).match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks) {
    const title = clean(tag(b, "title"));
    let link = clean(tag(b, "link"));
    if (!link) {
      const href = b.match(/<link[^>]*href="([^"]+)"/i);
      link = href ? href[1] : "";
    }
    const dateRaw = clean(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    const t = Date.parse(dateRaw);
    const summary = clean(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400);
    if (!title || !link) continue;
    out.push({ title, link, source, published: Number.isFinite(t) ? new Date(t).toISOString() : null, summary });
  }
  return out;
}

// Names and tickers that are ordinary words; matching them would tag half the
// news feed with the wrong coin.
const AMBIGUOUS_NAMES = new Set([
  "maker", "render", "graph", "the graph", "flow", "gas", "one", "sun", "act", "ai", "near", "sei", "sui",
  "core", "celo", "mask", "pepe", "ondo", "aave", "dash", "safe", "move", "portal", "degen", "dog",
  "cat", "trump", "official trump", "status", "zeta", "jupiter", "pendle", "stacks", "theta", "helium",
]);
const AMBIGUOUS_TICKERS = new Set([
  "ONE", "SUN", "ACT", "GAS", "FLOW", "MASK", "CORE", "SAFE", "MOVE", "DOG", "CAT", "ETH", "BTC", "USD",
  "SEC", "CEO", "ETF", "NFT", "API", "AI", "ME", "IO", "OM", "S", "T", "GT", "HT", "ID", "IQ", "UP",
  "NOT", "PEOPLE", "TRUMP", "WIN", "HOT", "BIG", "REAL", "OK", "SO", "AT", "NEAR", "SEI", "SUI", "ZK",
]);

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/**
 * Builds matchers for coins. A coin matches a headline by full name (case
 * insensitive, word-bounded, unless the name is ambiguous) or by ticker written
 * as $TICK, (TICK) or a standalone uppercase TICK of 3+ letters.
 */
export function buildMatchers(coins) {
  return coins.map((c) => {
    const name = String(c.name || "").trim();
    const sym = String(c.symbol || "").toUpperCase();
    const res = [];
    if (name.length >= 4 && !AMBIGUOUS_NAMES.has(name.toLowerCase())) {
      res.push(new RegExp(`\\b${escapeRe(name)}\\b`, "i"));
    }
    if (sym && /^[A-Z0-9]+$/.test(sym)) {
      res.push(new RegExp(`(\\$${sym}\\b|\\(${sym}\\))`));
      if (sym.length >= 3 && !AMBIGUOUS_TICKERS.has(sym)) res.push(new RegExp(`(^|[^A-Za-z0-9$])${sym}([^A-Za-z0-9]|$)`));
    }
    return { id: c.id, symbol: sym, res };
  }).filter((m) => m.res.length);
}

const EVENT_KEYWORDS = {
  partnership: ["partner", "selects", "selected", "chooses", "integrat", "collaborat", "teams up", "adopts"],
  listing: ["will list", "lists ", "listing", "to list", "adds support"],
  etf: [" etf", "s-1", "19b-4", "exchange-traded"],
  launch: ["mainnet", "launches", "launched", "goes live", "upgrade", "hard fork"],
  unlock: ["token unlock", "unlocks", "vesting"],
  hack: ["hack", "exploit", "drained", "breach", "stolen"],
  regulation: ["sec ", "lawsuit", "regulator", "mica", "cftc", "court", "settlement", "approval"],
  funding: ["raises", "funding round", "series a", "series b", "treasury"],
  opinion: ["price prediction", "predicts", "analyst", "could ", "might ", "will it", "why ", "here's", "what's next", "price analysis", "can ", "should you"],
};
const CONCRETE = ["partnership", "listing", "etf", "launch", "hack", "unlock", "funding"];

export function eventTypes(text) {
  const t = ` ${text.toLowerCase()} `;
  return Object.entries(EVENT_KEYWORDS).filter(([, kws]) => kws.some((k) => t.includes(k))).map(([k]) => k);
}

export function gradeOf(types) {
  if (types.includes("opinion")) return "C";
  if (types.some((t) => CONCRETE.includes(t))) return "A";
  return "B";
}

/**
 * Tags one item: coins mentioned, narratives (by keyword or by a member coin),
 * event types, grade.
 */
export function tagItem(item, matchers, narratives) {
  const text = `${item.title} ${item.summary || ""}`;
  const headline = item.title;
  // Coins are matched on the headline first; summaries are only used when the
  // headline names nothing, to keep passing mentions out.
  let coins = matchers.filter((m) => m.res.some((re) => re.test(headline))).map((m) => m.id);
  if (!coins.length) coins = matchers.filter((m) => m.res.some((re) => re.test(item.summary || ""))).map((m) => m.id);
  const lower = ` ${text.toLowerCase()} `;
  const narr = narratives
    .filter((n) => n.keywords.some((k) => lower.includes(k)) || n.ids.some((id) => coins.includes(id)))
    .map((n) => n.key);
  const types = eventTypes(headline);
  return { ...item, coins: [...new Set(coins)], narratives: narr, types, grade: gradeOf(types) };
}

/** Merge newly fetched items into the stored list: dedupe by link, keep `days` of history. */
export function mergeNews(existing, incoming, nowMs, days = 7) {
  const cutoff = nowMs - days * 86400 * 1000;
  const byLink = new Map();
  for (const it of [...existing, ...incoming]) {
    if (!it.link) continue;
    const t = it.published ? Date.parse(it.published) : nowMs;
    if (t < cutoff) continue;
    if (!byLink.has(it.link)) byLink.set(it.link, { ...it, firstSeen: it.firstSeen || new Date(nowMs).toISOString() });
  }
  return [...byLink.values()].sort((a, b) => String(b.published || b.firstSeen).localeCompare(String(a.published || a.firstSeen)));
}
