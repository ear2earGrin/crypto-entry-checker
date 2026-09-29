import { sma } from "../indicators/sma.js";
import { atr } from "../indicators/atr.js";
import {
  EXCLUDE_IDS, EXCLUDE_SYMBOLS, EXCLUDE_NAME_PATTERN, GATES, VETOES, PICK_RULE,
} from "./config.js";

/**
 * Pure scoring logic for the Narrative Scout. No I/O here: the runner
 * (scripts/scout.mjs) fetches data and passes plain objects in.
 */

const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export function median(xs) {
  const v = xs.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Performance of a coin relative to BTC over the same window, in percent. */
export function relVsBtc(coinPct, btcPct) {
  if (coinPct === null || btcPct === null) return null;
  return ((1 + coinPct / 100) / (1 + btcPct / 100) - 1) * 100;
}

export function isExcluded(coin) {
  if (EXCLUDE_IDS.has(coin.id)) return true;
  if (EXCLUDE_SYMBOLS.has(String(coin.symbol || "").toUpperCase())) return true;
  if (EXCLUDE_NAME_PATTERN.test(coin.name || "")) return true;
  return false;
}

/**
 * Normalises CoinGecko /coins/markets rows and adds BTC-relative strength.
 * Rows must include price_change_percentage_{7d,30d,200d}_in_currency.
 */
export function enrichUniverse(markets) {
  const btc = markets.find((m) => m.id === "bitcoin");
  const b7 = num(btc?.price_change_percentage_7d_in_currency);
  const b30 = num(btc?.price_change_percentage_30d_in_currency);
  const b200 = num(btc?.price_change_percentage_200d_in_currency);
  const seenSymbols = new Set();
  return markets.map((m) => {
    const mcap = num(m.market_cap);
    const fdv = num(m.fully_diluted_valuation);
    const circ = num(m.circulating_supply);
    const total = num(m.total_supply) ?? num(m.max_supply);
    const vol = num(m.total_volume);
    const ch7 = num(m.price_change_percentage_7d_in_currency);
    const ch30 = num(m.price_change_percentage_30d_in_currency);
    const ch200 = num(m.price_change_percentage_200d_in_currency);
    const symbol = String(m.symbol || "").toUpperCase();
    // Markets arrive sorted by market cap, so the first coin with a symbol owns
    // it for Binance matching; later duplicates can't be priced reliably.
    const symbolOwner = !seenSymbols.has(symbol);
    seenSymbols.add(symbol);
    return {
      id: m.id,
      symbol,
      name: m.name,
      image: m.image || null,
      rank: num(m.market_cap_rank),
      price: num(m.current_price),
      mcap,
      fdv,
      vol,
      circ,
      total,
      float: circ && total ? clamp(circ / total, 0, 1) : null,
      fdvToMcap: fdv && mcap ? fdv / mcap : null,
      turnover: vol && mcap ? vol / mcap : null,
      ch7, ch30, ch200,
      rs7: relVsBtc(ch7, b7),
      rs30: relVsBtc(ch30, b30),
      rs200: relVsBtc(ch200, b200),
      athChangePct: num(m.ath_change_percentage),
      symbolOwner,
      excluded: isExcluded(m),
    };
  });
}

/** Percentile rank (0-100) of each value within the array; nulls get null. */
export function percentileRanks(values) {
  const valid = values.map((v, i) => [v, i]).filter(([v]) => v !== null && Number.isFinite(v));
  const out = new Array(values.length).fill(null);
  if (!valid.length) return out;
  if (valid.length === 1) { out[valid[0][1]] = 50; return out; }
  const sorted = [...valid].sort((a, b) => a[0] - b[0]);
  sorted.forEach(([v, i], k) => {
    // ties share the average rank
    let lo = k, hi = k;
    while (lo > 0 && sorted[lo - 1][0] === v) lo--;
    while (hi < sorted.length - 1 && sorted[hi + 1][0] === v) hi++;
    out[i] = (((lo + hi) / 2) / (sorted.length - 1)) * 100;
  });
  return out;
}

/**
 * Narrative lifecycle from BTC-relative returns.
 *   COLD          — losing to BTC on both 7d and 30d
 *   EMERGING      — 7d turning up while 30d still negative
 *   ACCELERATING  — winning on 7d and 30d, not yet a huge 200d run
 *   MAINSTREAM    — winning on 30d after already doubling vs BTC over 200d (late)
 *   EXHAUSTING    — 30d still up but 7d rolling over
 */
export function stageOf({ rs7, rs30, rs200 }) {
  if (rs7 === null || rs30 === null) return "UNKNOWN";
  if (rs30 > 0 && rs7 <= 0) return "EXHAUSTING";
  if (rs30 > 0 && rs200 !== null && rs200 > 100) return "MAINSTREAM";
  if (rs30 > 0 && rs7 > 0) return "ACCELERATING";
  if (rs7 > 0) return "EMERGING";
  return "COLD";
}

/**
 * Per-narrative basket stats. `attention` maps narrative key → count of news
 * items + trending hits in the lookback window.
 */
export function basketStats(narratives, coinsById, attention = {}) {
  const rows = narratives.map((n) => {
    const members = n.ids.map((id) => coinsById.get(id)).filter(Boolean);
    const missing = n.ids.filter((id) => !coinsById.has(id));
    const rs7 = mean(members.map((c) => c.rs7).filter((x) => x !== null));
    const rs30 = mean(members.map((c) => c.rs30).filter((x) => x !== null));
    const rs200 = mean(members.map((c) => c.rs200).filter((x) => x !== null));
    const withRs30 = members.filter((c) => c.rs30 !== null);
    const breadth30 = withRs30.length ? (withRs30.filter((c) => c.rs30 > 0).length / withRs30.length) * 100 : null;
    const leader = [...members].filter((c) => c.rs7 !== null).sort((a, b) => b.rs7 - a.rs7)[0] || null;
    return {
      key: n.key,
      name: n.name,
      members: members.map((c) => ({ id: c.id, symbol: c.symbol, rs7: c.rs7, rs30: c.rs30 })),
      missing,
      rs7, rs30, rs200, breadth30,
      attention: attention[n.key] || 0,
      leader: leader ? { id: leader.id, symbol: leader.symbol, rs7: leader.rs7 } : null,
      stage: stageOf({ rs7, rs30, rs200 }),
    };
  });
  const p7 = percentileRanks(rows.map((r) => r.rs7));
  const p30 = percentileRanks(rows.map((r) => r.rs30));
  const pb = percentileRanks(rows.map((r) => r.breadth30));
  const pa = percentileRanks(rows.map((r) => r.attention));
  rows.forEach((r, i) => {
    const parts = [p7[i], p30[i], pb[i], pa[i]].filter((x) => x !== null);
    r.heat = parts.length ? Math.round(mean(parts)) : null;
    // A single-coin spike (one member flying, the rest flat) shows as high rs7
    // with low breadth — worth knowing before buying "the narrative".
    r.singleCoinEvent = r.rs7 !== null && r.rs7 > 10 && r.breadth30 !== null && r.breadth30 < 40;
  });
  return rows.sort((a, b) => (b.heat ?? -1) - (a.heat ?? -1));
}

/**
 * Alt-season gauge over the top-N non-excluded coins: the share beating BTC
 * over 30d and 200d. Classic "alt season" is ≥ 75% of the top 50 beating BTC.
 */
export function altSeasonGauge(coins, topN = 100) {
  const top = coins.filter((c) => !c.excluded && c.rank !== null).sort((a, b) => a.rank - b.rank).slice(0, topN);
  const share = (key) => {
    const v = top.filter((c) => c[key] !== null);
    return v.length ? (v.filter((c) => c[key] > 0).length / v.length) * 100 : null;
  };
  const s30 = share("rs30");
  const s200 = share("rs200");
  const score = s30 !== null && s200 !== null ? Math.round((s30 + s200) / 2) : (s30 ?? s200);
  const label = score === null ? "UNKNOWN" : score >= 75 ? "ALT SEASON" : score >= 55 ? "ALTS LEADING" : score > 25 ? "MIXED" : "BTC SEASON";
  return { sample: top.length, share30: s30, share200: s200, medianRs30: median(top.map((c) => c.rs30)), score, label };
}

/** Liquidity/listing gates. Returns a list of failure reasons (empty = pass). */
export function gateReasons(coin, binanceSymbols, gates = GATES) {
  const r = [];
  if (coin.vol === null || coin.vol < gates.minVolumeUsd) r.push("volume below $5M/day");
  if (coin.mcap === null || coin.mcap < gates.minMarketCapUsd) r.push("market cap below $50M");
  if (gates.requireBinanceUsdt) {
    if (!coin.symbolOwner || !binanceSymbols.has(`${coin.symbol}USDT`)) r.push("no Binance USDT pair");
  }
  return r;
}

/** Technical snapshot from closed daily candles (oldest first). */
export function techFromDaily(daily) {
  if (!daily || daily.length < 55) return null;
  const closes = daily.map((c) => c.close);
  const i = daily.length - 1;
  const s20 = sma(closes, 20)[i];
  const s50 = sma(closes, 50)[i];
  const a14 = atr(daily, 14)[i];
  const close = closes[i];
  const close7 = closes[i - 7];
  const ret7 = close7 ? (close / close7 - 1) * 100 : null;
  return {
    close,
    sma20: s20,
    sma50: s50,
    atr14: a14,
    above50: s50 !== null ? close > s50 : null,
    atrAboveSma20: a14 ? (close - s20) / a14 : null,
    ret7,
  };
}

/** Hard vetoes. Returns reasons (empty = pass). `depthUsd` may be null (unknown). */
export function vetoReasons(coin, tech, depthUsd, testAmount, v = VETOES) {
  const r = [];
  if (coin.fdvToMcap !== null && coin.fdvToMcap > v.maxFdvToMcap) r.push(`FDV ${coin.fdvToMcap.toFixed(1)}× market cap (supply overhang)`);
  if (coin.float !== null && coin.float < v.minFloat) r.push(`only ${(coin.float * 100).toFixed(0)}% of supply circulating`);
  if (coin.turnover !== null && coin.turnover > v.maxTurnover) r.push(`volume ${coin.turnover.toFixed(1)}× market cap (frenzy/wash)`);
  if (tech) {
    const ext = (tech.atrAboveSma20 !== null && tech.atrAboveSma20 > v.extendedAtrMult) || (tech.ret7 !== null && tech.ret7 > v.extended7dPct);
    if (ext) r.push("EXTENDED — watch, don't chase");
  }
  if (depthUsd !== null && depthUsd !== undefined && depthUsd < v.minDepthMultiple * testAmount) {
    r.push(`thin order book ($${Math.round(depthUsd).toLocaleString("en-US")} bids within 2%)`);
  }
  return r;
}

/**
 * Four sub-scores for each gated coin, all 0-100. Strength and quality are
 * percentiles within the gated set, so they're relative to today's field.
 */
export function scoreCoins(coins, { narrativeHeatById = new Map(), trendingIds = new Set(), newsCountById = new Map() } = {}) {
  const pr7 = percentileRanks(coins.map((c) => c.rs7));
  const pr30 = percentileRanks(coins.map((c) => c.rs30));
  const pr200 = percentileRanks(coins.map((c) => c.rs200));
  const pVol = percentileRanks(coins.map((c) => (c.vol ? Math.log(c.vol) : null)));
  const pCap = percentileRanks(coins.map((c) => (c.mcap ? Math.log(c.mcap) : null)));
  return coins.map((c, i) => {
    const strengthParts = [pr7[i], pr30[i], pr200[i]].filter((x) => x !== null);
    const strength = strengthParts.length ? Math.round(mean(strengthParts)) : null;
    const base = narrativeHeatById.has(c.id) ? narrativeHeatById.get(c.id) : 30;
    const news = newsCountById.get(c.id) || 0;
    const heat = Math.round(clamp(base + (trendingIds.has(c.id) ? 20 : 0) + Math.min(30, news * 10), 0, 100));
    const qParts = [pVol[i], pCap[i], c.float !== null ? c.float * 100 : null].filter((x) => x !== null);
    const quality = qParts.length ? Math.round(mean(qParts)) : null;
    const riskParts = [
      c.fdvToMcap !== null ? clamp((c.fdvToMcap - 1) * 25, 0, 100) : null,
      c.float !== null ? (1 - c.float) * 100 : null,
    ].filter((x) => x !== null);
    const supplyRisk = riskParts.length ? Math.round(mean(riskParts)) : null;
    const pickScore = strength !== null && quality !== null
      ? Math.round((heat + strength + quality - (supplyRisk ?? 50)) / 3)
      : null;
    return { ...c, scores: { heat, strength, quality, supplyRisk, pickScore }, trending: trendingIds.has(c.id), newsCount: news };
  });
}

/**
 * The mechanical pick rule. Candidates are watchlist coins (passed gates and
 * vetoes). Returns them in pick order, each with the reason it qualified or
 * the first rule it failed.
 */
export function rankPicks(watchlist, { btcRegime }, rule = PICK_RULE) {
  return watchlist
    .map((c) => {
      const fails = [];
      if (rule.requireBtcRegimeLongOk && btcRegime !== "LONG_OK") fails.push("BTC regime not bullish");
      if ((c.scores.heat ?? 0) < rule.minHeat) fails.push(`heat ${c.scores.heat} < ${rule.minHeat}`);
      if ((c.scores.strength ?? 0) < rule.minStrength) fails.push(`strength ${c.scores.strength} < ${rule.minStrength}`);
      if (rule.requireAbove50dSma && c.tech && c.tech.above50 === false) fails.push("below its 50-day average");
      if (rule.requireAbove50dSma && !c.tech) fails.push("no daily price history");
      return { ...c, eligible: fails.length === 0, pickFails: fails };
    })
    .sort((a, b) => (b.eligible - a.eligible) || ((b.scores.pickScore ?? -999) - (a.scores.pickScore ?? -999)));
}
