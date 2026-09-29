#!/usr/bin/env node
/**
 * Narrative Scout runner. launchd runs it hourly on the Mac mini
 * (scripts/scout-install.mjs):
 *   - every run: fetch news feeds, tag them, alert on Grade-A news about coins
 *     we hold or watch
 *   - once per UTC day (first run after 00:00 UTC): full market scan →
 *     narratives, alt-season gauge, gates, vetoes, scores, watchlist, the
 *     mechanical pick, and the paper test book (entries, stops, exits)
 *
 * Data sources (all free; each one may fail without stopping the others):
 *   CoinGecko   markets, trending searches, categories, coin descriptions
 *               (optional free demo key in data/scout/coingecko.txt)
 *   Binance     USDT pairs, daily candles, order-book depth, BTC weekly regime
 *   RSS         CoinDesk, Cointelegraph, Decrypt, The Block, Blockworks, CryptoSlate
 *   Claude      optional explainers (ANTHROPIC_API_KEY or data/scout/anthropic.txt)
 *
 * Files (data/scout/, gitignored):
 *   state.json     book, news history, notification memory
 *   latest.json    what the SCOUT tab shows
 *   journal.jsonl  one line per daily scan: every pick, watchlist and reject
 *   status.md      human-readable summary
 *
 * Usage:
 *   node scripts/scout.mjs              # normal run
 *   node scripts/scout.mjs --force      # rescan even if today's scan is done
 *   node scripts/scout.mjs --selftest   # synthetic data, no network
 */

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { NARRATIVES, NEWS_FEEDS, BOOK, VETOES } from "../src/scout/config.js";
import {
  enrichUniverse, basketStats, altSeasonGauge, gateReasons, techFromDaily, vetoReasons, scoreCoins, rankPicks,
} from "../src/scout/metrics.js";
import { parseFeed, buildMatchers, tagItem, mergeNews } from "../src/scout/news.js";
import { newBook, openBlockers, openPosition, updatePosition, closePosition, bookSummary } from "../src/scout/book.js";
import { computeRegime } from "../src/strategy/regime.js";
import { PRESET_V2 } from "../src/strategy/presets.js";
import { fetchKlinesRange, dropUnclosed, binanceGet } from "./lib/data.mjs";
import { explainCoin } from "./lib/explainer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DIR = join(ROOT, "data", "scout");
const SELFTEST = process.argv.includes("--selftest");
const FORCE = process.argv.includes("--force");
const P = (name) => join(DIR, SELFTEST ? `selftest-${name}` : name);

const CG = "https://api.coingecko.com/api/v3";
const DAY = 86400;
const SHORTLIST = 40;
const DETAIL_CALLS_PER_RUN = 6;
const EXPLAINER_MAX_AGE_DAYS = 30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const todayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const readText = (p) => { try { return readFileSync(p, "utf8").trim() || null; } catch { return null; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const writeJson = (p, o) => { mkdirSync(DIR, { recursive: true }); writeFileSync(p, JSON.stringify(o, null, 2)); };

// ---------- network ----------
async function fetchJson(url, headers = {}, tries = 3) {
  let last;
  for (let k = 0; k < tries; k++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (res.status === 429) { await sleep(15000 * (k + 1)); last = new Error(`429 rate limited: ${url}`); continue; }
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`HTTP ${res.status} for ${url.split("?")[0]}`), { fatal: true });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
      return await res.json();
    } catch (e) { if (e.fatal) throw e; last = e; await sleep(1500 * (k + 1)); }
  }
  throw last;
}

// CoinGecko sits behind Cloudflare, which answers 403 to requests that don't
// identify themselves. A free "Demo" key (coingecko.com/en/developers/dashboard)
// in data/scout/coingecko.txt is the reliable fix.
function cgHeaders() {
  const key = readText(join(DIR, "coingecko.txt"));
  return {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) NarrativeScout/1.0",
    ...(key ? { "x-cg-demo-api-key": key } : {}),
  };
}

async function loadMarkets() {
  const all = [];
  for (let page = 1; page <= 4; page++) {
    const rows = await fetchJson(
      `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&price_change_percentage=7d,30d,200d`,
      cgHeaders(),
    );
    all.push(...rows);
    await sleep(2500);
  }
  return all;
}
async function loadTrending() {
  const j = await fetchJson(`${CG}/search/trending`, cgHeaders());
  return (j.coins || []).map((c) => c.item?.id).filter(Boolean);
}
async function loadCategories() {
  const rows = await fetchJson(`${CG}/coins/categories`, cgHeaders());
  return rows
    .filter((r) => Number(r.market_cap) > 5e8 && Number.isFinite(Number(r.market_cap_change_24h)))
    .map((r) => ({ id: r.id, name: r.name, mcap: Number(r.market_cap), change24h: Number(r.market_cap_change_24h) }));
}
async function loadCoinDetail(id) {
  const j = await fetchJson(
    `${CG}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
    cgHeaders(),
  );
  const strip = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return {
    description: strip(j.description?.en),
    homepage: (j.links?.homepage || []).find(Boolean) || null,
    whitepaper: j.links?.whitepaper || null,
    categories: (j.categories || []).filter(Boolean),
  };
}
async function loadBinancePrices() {
  const rows = await binanceGet("/api/v3/ticker/price");
  const map = new Map();
  for (const r of rows) if (r.symbol.endsWith("USDT")) map.set(r.symbol, Number(r.price));
  return map;
}
async function loadDaily(symbol, days = 120) {
  const raw = await fetchKlinesRange(symbol, "1d", Date.now() - days * DAY * 1000);
  const closed = dropUnclosed(raw);
  const forming = raw.length > closed.length ? raw[raw.length - 1] : null;
  return { closed, forming };
}
async function loadBidDepthUsd(symbol) {
  const j = await binanceGet(`/api/v3/depth?symbol=${symbol}&limit=500`);
  const bids = (j.bids || []).map(([p, q]) => [Number(p), Number(q)]);
  if (!bids.length) return 0;
  const floor = bids[0][0] * 0.98;
  return bids.filter(([p]) => p >= floor).reduce((s, [p, q]) => s + p * q, 0);
}
async function loadBtcRegime() {
  const weekly = dropUnclosed(await fetchKlinesRange("BTCUSDT", "1w", Date.now() - 70 * 7 * DAY * 1000));
  return computeRegime(weekly, PRESET_V2.regimeParams).latest;
}
async function loadNews() {
  const items = [];
  const health = [];
  for (const f of NEWS_FEEDS) {
    try {
      const res = await fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) NarrativeScout/1.0" }, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = parseFeed(await res.text(), f.name);
      items.push(...parsed);
      health.push({ name: f.name, ok: parsed.length > 0, items: parsed.length });
    } catch (e) {
      health.push({ name: f.name, ok: false, error: String(e.message || e).slice(0, 80) });
    }
  }
  return { items, health };
}

// ---------- notifications (same channels as the paper robot) ----------
function notifyMac(title, body) {
  if (SELFTEST) return;
  const esc = (x) => String(x).replace(/"/g, "'");
  try { execFile("osascript", ["-e", `display notification "${esc(body)}" with title "${esc(title)}"`], () => {}); } catch { /* not macOS */ }
}
async function notifyPhone(title, body) {
  if (SELFTEST) return;
  const topic = readText(join(ROOT, "data", "paper", "ntfy.txt"));
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: "POST", headers: { Title: title.replace(/[^\x20-\x7E]/g, ""), Priority: "default" }, body,
    });
  } catch { /* best-effort */ }
}
function log(line) {
  mkdirSync(DIR, { recursive: true });
  appendFileSync(P("log.md"), `${line}\n`);
  console.log(line);
}

// ---------- selftest fixtures ----------
function mulberry(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function synthDaily(seed, drift, days = 120) {
  const rnd = mulberry(seed);
  const start = Math.floor(Date.now() / 1000 / DAY) * DAY - (days - 1) * DAY;
  const out = [];
  let px = 10 + rnd() * 5;
  for (let i = 0; i < days; i++) {
    const open = px;
    px = Math.max(0.01, px * (1 + drift + (rnd() - 0.5) * 0.06));
    const hi = Math.max(open, px) * (1 + rnd() * 0.02);
    const lo = Math.min(open, px) * (1 - rnd() * 0.02);
    out.push({ time: start + i * DAY, open, high: hi, low: lo, close: px, volume: 1000, closeTime: start + (i + 1) * DAY - 1 });
  }
  const forming = out.pop();
  return { closed: out, forming: { ...forming, high: forming.open, low: forming.open, close: forming.open } };
}
function selftestSources() {
  const rnd = mulberry(7);
  const ids = [...new Set(["bitcoin", "ethereum", "tether", ...NARRATIVES.flatMap((n) => n.ids)])];
  const markets = ids.map((id, i) => {
    const mcap = id === "bitcoin" ? 1.6e12 : 3e9 / (i + 1) + 6e7;
    const sym = id === "bitcoin" ? "btc" : id === "ethereum" ? "eth" : id === "tether" ? "usdt" : id.replace(/[^a-z]/g, "").slice(0, 4) + i;
    const hot = NARRATIVES[0].ids.includes(id);
    return {
      id, symbol: sym, name: id.replace(/-/g, " "), market_cap: mcap, market_cap_rank: i + 1,
      fully_diluted_valuation: mcap * (1 + rnd() * (i % 9 === 0 ? 8 : 1.5)), total_volume: mcap * (0.02 + rnd() * 0.1),
      circulating_supply: 1e9, total_supply: 1e9 / (0.3 + rnd() * 0.7), current_price: 1 + rnd() * 10,
      price_change_percentage_7d_in_currency: id === "bitcoin" ? 2 : (hot ? 15 : -5) + rnd() * 20,
      price_change_percentage_30d_in_currency: id === "bitcoin" ? 5 : (hot ? 25 : -10) + rnd() * 30,
      price_change_percentage_200d_in_currency: id === "bitcoin" ? 10 : -20 + rnd() * 80,
      ath_change_percentage: -50,
    };
  });
  const binance = new Map(markets.map((m, i) => [`${m.symbol.toUpperCase()}USDT`, m.current_price + i]));
  const rss = `<rss><channel>
    <item><title>The Clearing House selects Quant Network for tokenized deposit interoperability</title><link>https://example.test/a</link><pubDate>${new Date().toUTCString()}</pubDate><description>Banks pick Overledger ($QNT).</description></item>
    <item><title>XRP price prediction: could it hit $10?</title><link>https://example.test/b</link><pubDate>${new Date().toUTCString()}</pubDate><description>Analyst says...</description></item>
    <item><title>Hedera launches tokenization toolkit for banks</title><link>https://example.test/c</link><pubDate>${new Date().toUTCString()}</pubDate><description>ISO 20022 messaging support.</description></item>
  </channel></rss>`;
  return {
    markets, binance,
    trending: [NARRATIVES[0].ids[0], NARRATIVES[1].ids[0]],
    categories: [{ id: "rwa", name: "Real World Assets (RWA)", mcap: 2e10, change24h: 6.1 }],
    daily: (symbol) => synthDaily(symbol.length * 131 + symbol.charCodeAt(0), symbol.startsWith("QUAN") || symbol.startsWith("RIPP") ? 0.012 : 0.001),
    depth: () => 500000,
    btcRegime: { state: "LONG_OK", close: 84467, sma: 80400 },
    news: { items: parseFeed(rss, "Selftest"), health: [{ name: "Selftest", ok: true, items: 3 }] },
    detail: (id) => ({ description: `${id} is a synthetic selftest project.`, homepage: null, whitepaper: null, categories: ["Selftest"] }),
  };
}

// ---------- main ----------
async function main() {
  const now = new Date();
  const nowSec = Math.floor(now.getTime() / 1000);
  const day = todayKey(now);
  const fx = SELFTEST ? selftestSources() : null;
  const health = {};

  let state = readJson(P("state.json"));
  if (!state) {
    state = { createdAt: now.toISOString(), book: newBook(BOOK, now.toISOString()), news: [], notified: {}, explainers: {}, universe: [], lastScanDay: null, stages: {} };
    log(`\n## Scout initialized ${now.toISOString()} — test book $${BOOK.startCash.toLocaleString("en-US")}, $${BOOK.testAmount} per pick\n`);
  }
  const alerts = [];
  const alertOnce = (key, title, body) => {
    if (state.notified[key]) return;
    state.notified[key] = now.toISOString();
    alerts.push({ title, body });
  };

  // 1) News — every run.
  let newsRes;
  try { newsRes = fx ? fx.news : await loadNews(); } catch (e) { newsRes = { items: [], health: [{ name: "all feeds", ok: false, error: String(e.message) }] }; }
  health.news = newsRes.health;

  const scanDue = FORCE || state.lastScanDay !== day;
  let snapshot = readJson(P("latest.json"));

  if (scanDue) {
    // 2) Market scan — once per UTC day.
    let markets = [];
    try { markets = fx ? fx.markets : await loadMarkets(); health.coingecko = { ok: true, coins: markets.length }; }
    catch (e) { health.coingecko = { ok: false, error: String(e.message).slice(0, 120) }; }
    let binance = new Map();
    try { binance = fx ? fx.binance : await loadBinancePrices(); health.binance = { ok: true, pairs: binance.size }; }
    catch (e) { health.binance = { ok: false, error: String(e.message).slice(0, 120) }; }

    if (!markets.length || !binance.size) {
      log(`- ${now.toISOString()} scan skipped: market data unavailable (${JSON.stringify({ coingecko: health.coingecko, binance: health.binance })})`);
      if (state.universe?.length) {
        state.news = mergeNews(state.news, newsRes.items.map((it) => tagItem(it, buildMatchers(state.universe), NARRATIVES)), now.getTime());
      } else {
        state.news = mergeNews(state.news, newsRes.items.map((it) => tagItem(it, [], NARRATIVES)), now.getTime());
      }
      snapshot = {
        ...(snapshot || { narratives: [], watchlist: [], rejects: [], categories: [], funnel: {}, gauge: null, btcRegime: null, picksToday: [], explainers: {} }),
        generatedAt: snapshot?.generatedAt || now.toISOString(),
        scanDay: snapshot?.scanDay || null,
        selftest: SELFTEST,
        scanError: { at: now.toISOString(), coingecko: health.coingecko, binance: health.binance },
        health: { ...(snapshot?.health || {}), coingecko: health.coingecko, binance: health.binance },
        book: bookSummary(state.book, {}, null),
        bookConfig: BOOK,
      };
    } else {
      let trending = [], categories = [], btcRegime = null;
      try { trending = fx ? fx.trending : await loadTrending(); } catch { /* optional */ }
      try { categories = fx ? fx.categories : await loadCategories(); } catch { /* optional */ }
      try { btcRegime = fx ? fx.btcRegime : await loadBtcRegime(); health.btcRegime = { ok: true }; }
      catch (e) { health.btcRegime = { ok: false, error: String(e.message).slice(0, 120) }; }
      const btcState = btcRegime?.state || "UNKNOWN";

      const coins = enrichUniverse(markets);
      const coinsById = new Map(coins.map((c) => [c.id, c]));
      state.universe = coins.filter((c) => !c.excluded && c.rank !== null && c.rank <= 400).map((c) => ({ id: c.id, symbol: c.symbol, name: c.name }));

      // Tag news against today's universe before using it for attention.
      const matchers = buildMatchers(state.universe);
      state.news = mergeNews(state.news, newsRes.items.map((it) => tagItem(it, matchers, NARRATIVES)), now.getTime());

      const recent = state.news.filter((n) => n.grade !== "C");
      const trendingSet = new Set(trending);
      const attention = {};
      const newsCountById = new Map();
      for (const n of recent) {
        for (const k of n.narratives || []) attention[k] = (attention[k] || 0) + 1;
        for (const id of n.coins || []) newsCountById.set(id, (newsCountById.get(id) || 0) + 1);
      }
      for (const nar of NARRATIVES) for (const id of nar.ids) if (trendingSet.has(id)) attention[nar.key] = (attention[nar.key] || 0) + 1;

      const baskets = basketStats(NARRATIVES, coinsById, attention);
      const narrativeHeatById = new Map();
      const narrativesById = new Map();
      for (const b of baskets) for (const m of b.members) {
        narrativeHeatById.set(m.id, Math.max(narrativeHeatById.get(m.id) ?? 0, b.heat ?? 0));
        narrativesById.set(m.id, [...(narrativesById.get(m.id) || []), b.name]);
      }
      const gauge = altSeasonGauge(coins);

      // Gates.
      const binanceSymbols = new Set(binance.keys());
      const gateFails = {};
      const gated = [];
      for (const c of coins) {
        if (c.excluded) continue;
        const r = gateReasons(c, binanceSymbols);
        if (r.length) { for (const x of r) gateFails[x] = (gateFails[x] || 0) + 1; continue; }
        gated.push(c);
      }
      const scored = scoreCoins(gated, { narrativeHeatById, trendingIds: trendingSet, newsCountById })
        .sort((a, b) => (b.scores.pickScore ?? -999) - (a.scores.pickScore ?? -999));

      // Daily candles for the shortlist, open positions and BTC.
      const book = state.book;
      const heldIds = new Set(book.open.map((p) => p.id));
      const shortlist = scored.slice(0, SHORTLIST);
      for (const c of scored) if (heldIds.has(c.id) && !shortlist.includes(c)) shortlist.push(c);
      const dailyById = new Map();
      const loadDailyFor = async (sym) => (fx ? fx.daily(sym) : loadDaily(sym));
      let dailyFails = 0;
      for (const c of shortlist) {
        try { dailyById.set(c.id, await loadDailyFor(`${c.symbol}USDT`)); } catch { dailyFails++; }
      }
      for (const p of book.open) {
        if (!dailyById.has(p.id)) {
          try { dailyById.set(p.id, await loadDailyFor(`${p.symbol}USDT`)); } catch { dailyFails++; }
        }
      }
      let btcDaily = null;
      try { btcDaily = await loadDailyFor("BTCUSDT"); } catch { /* benchmark unavailable */ }
      health.candles = { ok: dailyFails === 0, failed: dailyFails };
      const btcCloseAt = (t) => btcDaily?.closed.find((b) => b.time === t)?.close ?? binance.get("BTCUSDT") ?? null;
      const btcNow = btcDaily?.forming?.open ?? binance.get("BTCUSDT") ?? null;

      // Vetoes (depth only for coins that pass everything else — it's one call each).
      const watch = [];
      const rejects = [];
      for (const c of shortlist) {
        const d = dailyById.get(c.id);
        c.tech = d ? techFromDaily(d.closed) : null;
        c.narratives = narrativesById.get(c.id) || [];
        let reasons = vetoReasons(c, c.tech, null, BOOK.testAmount);
        if (!reasons.length) {
          try {
            c.depthUsd = fx ? fx.depth(c.symbol) : await loadBidDepthUsd(`${c.symbol}USDT`);
            reasons = vetoReasons(c, c.tech, c.depthUsd, BOOK.testAmount);
          } catch { c.depthUsd = null; }
        }
        if (reasons.length) rejects.push({ ...c, vetoes: reasons });
        else watch.push(c);
      }
      const ranked = rankPicks(watch, { btcRegime: btcState });

      // Manage open test positions first (exits free up slots and cash).
      for (const pos of [...book.open]) {
        const d = dailyById.get(pos.id);
        if (!d) continue;
        const { exited, stopRaised } = updatePosition(pos, d.closed, BOOK);
        if (exited) {
          const t = closePosition(book, pos, btcCloseAt(pos.exitTime), BOOK);
          alertOnce(`X|${t.id}|${t.entryTime}`, `Scout exit ${t.symbol}`,
            `${t.exitReason} at ${t.exit}. Result ${t.retPct >= 0 ? "+" : ""}${t.retPct}% ($${t.pnl}), ${t.r ?? "?"}R. BTC over the same days: ${t.btcRetPct ?? "?"}%.`);
        } else if (stopRaised) {
          log(`- ${day} ${pos.symbol} stop raised to ${pos.stop}`);
        }
      }

      // The pick.
      const picked = [];
      for (const c of ranked.filter((x) => x.eligible)) {
        const blockers = openBlockers(book, c.id, day, nowSec, BOOK);
        if (blockers.length) { c.bookBlockers = blockers; continue; }
        const d = dailyById.get(c.id);
        if (!d?.forming) { c.bookBlockers = ["no opening price yet"]; continue; }
        const reason = `heat ${c.scores.heat}, strength ${c.scores.strength}, quality ${c.scores.quality}, supply risk ${c.scores.supplyRisk}${c.narratives.length ? ` · ${c.narratives.join(", ")}` : ""}`;
        const pos = openPosition(book, {
          coin: c, closedDaily: d.closed, formingOpen: d.forming.open, formingTime: d.forming.time,
          btcPrice: btcNow, todayKey: day, reason, scores: c.scores,
        }, BOOK);
        picked.push(pos);
        alertOnce(`E|${pos.id}|${pos.entryTime}`, `Scout pick: ${pos.symbol}`,
          `Test buy $${BOOK.testAmount} at ${pos.entry}, stop ${pos.initialStop}. Why: ${reason}.`);
      }

      // Narrative stage changes worth a ping.
      for (const b of baskets) {
        const prev = state.stages?.[b.key];
        if (prev && prev !== b.stage && (b.stage === "ACCELERATING" || b.stage === "EMERGING")) {
          alertOnce(`S|${b.key}|${day}|${b.stage}`, `Narrative ${b.stage.toLowerCase()}: ${b.name}`,
            `7d vs BTC ${b.rs7?.toFixed(1)}%, 30d ${b.rs30?.toFixed(1)}%, breadth ${b.breadth30?.toFixed(0)}%. Leader: ${b.leader?.symbol ?? "?"}.`);
        }
        state.stages = { ...(state.stages || {}), [b.key]: b.stage };
      }

      // Explainers for new picks and the top of the watchlist.
      const apiKey = SELFTEST ? null : (process.env.ANTHROPIC_API_KEY || readText(join(DIR, "anthropic.txt")));
      health.claude = { ok: !!apiKey, note: apiKey ? "explainers on" : "no API key — showing project descriptions" };
      const needExplain = [...picked.map((p) => coinsById.get(p.id)), ...ranked.slice(0, 5)].filter(Boolean);
      let detailCalls = 0;
      for (const c of needExplain) {
        const cached = state.explainers[c.id];
        const fresh = cached && (now.getTime() - Date.parse(cached.at)) / 86400000 < EXPLAINER_MAX_AGE_DAYS && (cached.ai || !apiKey);
        if (fresh || detailCalls >= DETAIL_CALLS_PER_RUN) continue;
        detailCalls++;
        try {
          const detail = fx ? fx.detail(c.id) : await loadCoinDetail(c.id);
          if (!fx) await sleep(2500);
          let entry = { at: now.toISOString(), ai: false, text: detail.description.slice(0, 900), homepage: detail.homepage, whitepaper: detail.whitepaper, categories: detail.categories };
          if (apiKey) {
            try {
              const ex = await explainCoin(apiKey, c, detail);
              entry = { ...entry, ai: true, text: ex.text, model: ex.model };
            } catch (e) { health.claude = { ok: false, error: String(e.message || e).slice(0, 120) }; }
          }
          state.explainers[c.id] = entry;
        } catch { /* CoinGecko detail optional */ }
      }

      // Grade-A news about coins we hold or watch.
      const watchIds = new Set([...book.open.map((p) => p.id), ...ranked.slice(0, 12).map((c) => c.id)]);
      for (const n of state.news) {
        if (n.grade === "A" && (n.coins || []).some((id) => watchIds.has(id))) {
          alertOnce(`N|${n.link}`, `News (A): ${(n.coins || []).map((id) => coinsById.get(id)?.symbol || id).join(", ")}`, n.title);
        }
      }

      const prices = Object.fromEntries(book.open.map((p) => [p.id, dailyById.get(p.id)?.forming?.open ?? binance.get(`${p.symbol}USDT`) ?? null]));
      const summary = bookSummary(book, prices, btcNow);
      const slim = (c) => ({
        id: c.id, symbol: c.symbol, name: c.name, rank: c.rank, price: c.price, mcap: c.mcap, fdv: c.fdv, vol: c.vol,
        float: c.float, fdvToMcap: c.fdvToMcap, turnover: c.turnover, rs7: c.rs7, rs30: c.rs30, rs200: c.rs200,
        scores: c.scores, trending: c.trending, newsCount: c.newsCount, narratives: c.narratives || [],
        tech: c.tech, depthUsd: c.depthUsd ?? null, eligible: c.eligible ?? false, pickFails: c.pickFails || [],
        bookBlockers: c.bookBlockers || [], vetoes: c.vetoes || [],
      });

      snapshot = {
        generatedAt: now.toISOString(),
        scanDay: day,
        selftest: SELFTEST,
        health,
        btcRegime: btcRegime ? { state: btcState, close: btcRegime.close ?? null, sma: btcRegime.sma ?? null } : null,
        gauge,
        narratives: baskets,
        categories: categories.sort((a, b) => b.change24h - a.change24h).slice(0, 12),
        funnel: {
          universe: coins.length,
          excluded: coins.filter((c) => c.excluded).length,
          gated: gated.length,
          gateFails,
          shortlisted: shortlist.length,
          watchlist: watch.length,
          eligible: ranked.filter((c) => c.eligible).length,
          picked: picked.length,
        },
        watchlist: ranked.slice(0, 25).map(slim),
        rejects: rejects.slice(0, 40).map(slim),
        picksToday: picked.map((p) => p.id),
        book: summary,
        bookConfig: BOOK,
        vetoConfig: VETOES,
        explainers: Object.fromEntries([...ranked.slice(0, 25), ...book.open, ...picked].map((c) => [c.id, state.explainers[c.id]]).filter(([, v]) => v)),
      };

      appendFileSync(P("journal.jsonl"), JSON.stringify({
        day, at: now.toISOString(), btcRegime: btcState, gauge: gauge.score,
        picked: picked.map((p) => ({ id: p.id, entry: p.entry, stop: p.initialStop, reason: p.reason })),
        watchlist: ranked.slice(0, 25).map((c) => ({ id: c.id, price: c.price, scores: c.scores, eligible: c.eligible })),
        rejects: rejects.map((c) => ({ id: c.id, price: c.price, vetoes: c.vetoes })),
        narratives: baskets.map((b) => ({ key: b.key, heat: b.heat, stage: b.stage, rs7: b.rs7, rs30: b.rs30 })),
      }) + "\n");

      state.lastScanDay = day;
      log(`- ${now.toISOString()} scan: ${coins.length} coins → ${gated.length} liquid → ${watch.length} watchlist → ${picked.length} picked · BTC ${btcState} · gauge ${gauge.score ?? "?"} (${gauge.label})`);
    }
  } else if (state.universe?.length) {
    const matchers = buildMatchers(state.universe);
    state.news = mergeNews(state.news, newsRes.items.map((it) => tagItem(it, matchers, NARRATIVES)), now.getTime());
    const watchIds = new Set([...state.book.open.map((p) => p.id), ...(snapshot?.watchlist || []).slice(0, 12).map((c) => c.id)]);
    for (const n of state.news) {
      if (n.grade === "A" && (n.coins || []).some((id) => watchIds.has(id))) alertOnce(`N|${n.link}`, `News (A): ${(n.coins || []).join(", ")}`, n.title);
    }
  }

  if (snapshot) {
    snapshot.newsUpdatedAt = now.toISOString();
    snapshot.newsHealth = health.news;
    snapshot.news = state.news.slice(0, 80);
    writeJson(P("latest.json"), snapshot);
    writeFileSync(P("status.md"), statusMarkdown(snapshot));
  }

  for (const a of alerts) {
    log(`- ${now.toISOString()} ALERT ${a.title}: ${a.body}`);
    notifyMac(a.title, a.body);
    await notifyPhone(a.title, a.body);
  }

  // Keep notification memory bounded.
  const keys = Object.keys(state.notified);
  if (keys.length > 3000) for (const k of keys.slice(0, keys.length - 3000)) delete state.notified[k];
  writeJson(P("state.json"), state);
}

function statusMarkdown(s) {
  const pct = (x) => (x === null || x === undefined ? "?" : `${x >= 0 ? "+" : ""}${Number(x).toFixed(1)}%`);
  const lines = [
    `# Narrative Scout — ${s.generatedAt}`,
    "",
    `BTC regime: **${s.btcRegime?.state ?? "unknown"}** · Alt-season gauge: **${s.gauge?.score ?? "?"}** (${s.gauge?.label ?? "?"})`,
    `Funnel: ${s.funnel.universe} coins → ${s.funnel.gated} liquid → ${s.funnel.watchlist} watchlist → ${s.funnel.eligible} eligible → ${s.funnel.picked} picked`,
    "",
    "## Narratives (vs BTC)",
    "| Narrative | 7d | 30d | Breadth | Heat | Stage |",
    "|---|---|---|---|---|---|",
    ...s.narratives.map((b) => `| ${b.name} | ${pct(b.rs7)} | ${pct(b.rs30)} | ${b.breadth30?.toFixed(0) ?? "?"}% | ${b.heat ?? "?"} | ${b.stage}${b.singleCoinEvent ? " (single-coin move)" : ""} |`),
    "",
    "## Test book",
    `Equity $${s.book.equity} (${pct(s.book.returnPct)}) · cash $${s.book.cash} · closed trades ${s.book.stats.trades}, win rate ${s.book.stats.winRate ?? "–"}%, beat BTC ${s.book.stats.beatBtcRate ?? "–"}%`,
    ...s.book.open.map((p) => `- ${p.symbol}: entry ${p.entry}, stop ${p.stop}, now ${pct(p.retPct)} (BTC ${pct(p.btcRetPct)})`),
    "",
    "## Watchlist (top 10)",
    ...s.watchlist.slice(0, 10).map((c) => `- ${c.symbol} ${c.eligible ? "✅ eligible" : `— ${c.pickFails.join("; ")}`} · heat ${c.scores.heat} · strength ${c.scores.strength} · quality ${c.scores.quality} · supply risk ${c.scores.supplyRisk}`),
    "",
    "## Source health",
    `CoinGecko ${s.health.coingecko?.ok ? "ok" : "FAILED"} · Binance ${s.health.binance?.ok ? "ok" : "FAILED"} · news ${(s.health.news || []).filter((h) => h.ok).length}/${(s.health.news || []).length} feeds · Claude ${s.health.claude?.ok ? "on" : "off"}`,
  ];
  return lines.join("\n") + "\n";
}

main().catch((e) => {
  log(`- ${new Date().toISOString()} ERROR ${e.stack || e}`);
  process.exit(1);
});
