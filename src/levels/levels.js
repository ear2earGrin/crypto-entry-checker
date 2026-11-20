import { atr } from "../indicators/atr.js";
import { sma } from "../indicators/sma.js";
import { donchianCloses } from "../indicators/donchian.js";

/**
 * Support/resistance zones and take-profit planning for discretionary trades.
 *
 * Method (deliberately simple, so a level can always be traced back to bars):
 *   1. Swing highs and lows ("pivots") on weekly and daily candles: a bar whose
 *      high (low) is the extreme of the `span` bars on each side.
 *   2. Pivots within ~one daily ATR of each other merge into a zone.
 *   3. Zone strength = sum of its pivots' weights: weekly pivots count 3×, and
 *      older pivots fade (half-life 1 year weekly, 6 months daily). A zone that
 *      has acted as both support and resistance ("flip") gets a bonus.
 *
 * The mechanical v2.0 system ignores all of this — it exits on the 10-day low.
 * These levels are for the discretionary lane: where to take profit, where a
 * stop sits safely below support.
 */

const DAY = 86400;
export const LEVEL_PARAMS = {
  dailyLookback: 365,     // daily bars scanned for pivots
  weeklyLookback: 156,    // weekly bars (3 years)
  dailySpan: 3,
  weeklySpan: 2,
  weeklyWeight: 3,
  dailyHalfLifeDays: 182,
  weeklyHalfLifeDays: 365,
  flipBonus: 1.5,
  zoneAtrWidth: 1.0,      // pivots within this × daily ATR merge
  minZonePct: 0.8,        // ...but never narrower than 0.8% of price
  maxPerSide: 5,
};

/** Confirmed swing highs/lows: the extreme of `span` bars on both sides. */
export function findPivots(candles, span = 3) {
  const out = [];
  for (let i = span; i < candles.length - span; i++) {
    const c = candles[i];
    let isHigh = true;
    let isLow = true;
    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      const o = candles[j];
      // Strict on the right, non-strict on the left: of two equal highs only
      // the later one counts, so a double top isn't double-counted as one bar.
      if (j < i ? o.high > c.high : o.high >= c.high) isHigh = false;
      if (j < i ? o.low < c.low : o.low <= c.low) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) out.push({ type: "high", price: c.high, time: c.time });
    if (isLow) out.push({ type: "low", price: c.low, time: c.time });
  }
  return out;
}

/**
 * Greedy 1-D clustering: walk pivots in price order, start a new zone when
 * the next pivot is more than `width` above the current zone's low edge.
 */
export function clusterZones(pivots, width) {
  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const zones = [];
  let cur = null;
  for (const p of sorted) {
    if (cur && p.price - cur.low <= width) {
      cur.pivots.push(p);
      cur.high = Math.max(cur.high, p.price);
    } else {
      cur = { low: p.price, high: p.price, pivots: [p] };
      zones.push(cur);
    }
  }
  return zones;
}

function pivotWeight(p, nowSec, params) {
  const weekly = p.tf === "W";
  const halfLife = (weekly ? params.weeklyHalfLifeDays : params.dailyHalfLifeDays) * DAY;
  const age = Math.max(0, nowSec - p.time);
  return (weekly ? params.weeklyWeight : 1) * Math.pow(0.5, age / halfLife);
}

/**
 * Supports below the price and resistances above it, nearest first, plus the
 * reference lines the system itself uses.
 * weekly/daily: closed candles (oldest first). price: the live price.
 */
export function computeLevels({ weekly, daily, price, nowSec = Math.floor(Date.now() / 1000), params = LEVEL_PARAMS }) {
  if (!daily?.length || !weekly?.length || !Number.isFinite(price)) return null;

  const d = daily.slice(-params.dailyLookback);
  const w = weekly.slice(-params.weeklyLookback);
  const dAtr = atr(daily, 14).at(-1) ?? null;
  const width = Math.max((dAtr ?? 0) * params.zoneAtrWidth, price * (params.minZonePct / 100));

  const pivots = [
    ...findPivots(w, params.weeklySpan).map((p) => ({ ...p, tf: "W" })),
    ...findPivots(d, params.dailySpan).map((p) => ({ ...p, tf: "D" })),
  ];

  const raw = clusterZones(pivots, width).map((z) => {
    const highs = z.pivots.filter((p) => p.type === "high").length;
    const lows = z.pivots.length - highs;
    const flip = highs > 0 && lows > 0;
    const score = z.pivots.reduce((s, p) => s + pivotWeight(p, nowSec, params), 0) * (flip ? params.flipBonus : 1);
    const mid = z.pivots.reduce((s, p) => s + p.price, 0) / z.pivots.length;
    return {
      low: z.low,
      high: z.high,
      mid,
      touches: z.pivots.length,
      weeklyTouches: z.pivots.filter((p) => p.tf === "W").length,
      flip,
      lastTouch: Math.max(...z.pivots.map((p) => p.time)),
      score,
    };
  });

  // A single daily pivot is noise, not a level.
  const meaningful = raw.filter((z) => z.touches >= 2 || z.weeklyTouches >= 1);
  const maxScore = Math.max(1e-9, ...meaningful.map((z) => z.score));
  for (const z of meaningful) z.strength = Math.round((z.score / maxScore) * 100);

  const withDist = (z, edge) => ({ ...z, edge, distPct: ((edge - price) / price) * 100 });
  const supports = meaningful
    .filter((z) => z.high < price)
    .map((z) => withDist(z, z.high))
    .sort((a, b) => b.edge - a.edge)
    .slice(0, params.maxPerSide);
  const resistances = meaningful
    .filter((z) => z.low > price)
    .map((z) => withDist(z, z.low))
    .sort((a, b) => a.edge - b.edge)
    .slice(0, params.maxPerSide);
  const atPrice = meaningful.filter((z) => z.low <= price && z.high >= price).map((z) => withDist(z, z.mid));

  const closes = daily.map((c) => c.close);
  const dc = donchianCloses(closes, 20);
  const d10 = donchianCloses(closes, 10);
  const weeklySma = sma(weekly.map((c) => c.close), 50).at(-1) ?? null;
  const allTimeHigh = Math.max(...weekly.map((c) => c.high), ...daily.map((c) => c.high));

  return {
    price,
    atr: dAtr,
    zoneWidth: width,
    supports,
    resistances,
    atPrice,
    refs: {
      sma50w: weeklySma,
      breakout20: dc.upper.at(-1) ?? null,  // the system's entry line (20-day close high)
      trail10: d10.lower.at(-1) ?? null,    // the system's exit line (10-day close low)
      allTimeHigh,
    },
    priceDiscovery: resistances.length === 0,
  };
}

/**
 * Stop suggestions for a long entry, nearest-support first:
 *   - just under the nearest support zone (half an ATR of room, so a wick
 *     into the zone doesn't take you out)
 *   - the system's 10-day close-low line
 *   - 2.5× daily ATR below entry (the system's own initial stop)
 * Each is flagged tooTight (< 1 ATR away: noise will hit it) or tooWide
 * (> 4 ATR: the position gets tiny). defaultStop() picks the first usable one.
 */
export function suggestStops(levels, entry) {
  if (!levels || !Number.isFinite(entry)) return [];
  const a = levels.atr ?? 0;
  const tag = (s) => {
    const dist = entry - s.price;
    return { ...s, tooTight: a > 0 && dist < a, tooWide: a > 0 && dist > 4 * a };
  };
  const out = [];
  const below = levels.supports.filter((z) => z.high < entry);
  if (below.length) out.push(tag({ label: "Below nearest support", price: below[0].low - 0.5 * a, zone: below[0] }));
  if (levels.refs.trail10 && levels.refs.trail10 < entry) out.push(tag({ label: "System 10-day low", price: levels.refs.trail10 }));
  if (a > 0) out.push(tag({ label: "2.5× ATR (system's initial stop)", price: entry - 2.5 * a }));
  return out;
}

export function defaultStop(stops) {
  return stops.find((s) => !s.tooTight && !s.tooWide) || stops.find((s) => s.label.startsWith("2.5×")) || stops[0] || null;
}

/**
 * Take-profit ladder for a long trade.
 *   TP1: just under the first resistance that pays ≥ 1.5R; 2R if there is none.
 *   TP2: just under the next resistance at ≥ 2.5R; 3R if there is none.
 *   Runner: trail the rest with the 10-day close-low, as the system does.
 * "Just under" = a fifth of an ATR below the zone's lower edge, because
 * sellers show up before the exact level.
 */
export function planTakeProfits({ entry, stop, levels, split = [30, 30, 40] }) {
  const warnings = [];
  if (!levels || !Number.isFinite(entry) || !Number.isFinite(stop)) return null;
  if (stop >= entry) return { error: "The stop must be below the entry for a long trade." };

  const R = entry - stop;
  const a = levels.atr ?? 0;
  const rOf = (px) => (px - entry) / R;
  const above = levels.resistances.filter((z) => z.low > entry);

  const first = above[0];
  if (first && rOf(first.low) < 1) {
    warnings.push(`The first resistance (${fmt(first.low)}–${fmt(first.high)}) is only ${rOf(first.low).toFixed(1)}R away. Poor reward for the risk: wait for a close above it, or tighten the stop.`);
  }

  const zoneTarget = (minR, exclude) => {
    const z = above.find((x) => x !== exclude && rOf(x.low - 0.2 * a) >= minR);
    return z ? { price: z.low - 0.2 * a, zone: z } : null;
  };
  const t1 = zoneTarget(1.5) || { price: entry + 2 * R, zone: null };
  const t2 = zoneTarget(Math.max(2.5, rOf(t1.price) + 0.75), t1.zone) || { price: Math.max(entry + 3 * R, t1.price + R), zone: null };

  const why = (t, fallbackR) => (t.zone
    ? `just under resistance ${fmt(t.zone.low)}–${fmt(t.zone.high)} (${t.zone.touches} touches${t.zone.weeklyTouches ? `, ${t.zone.weeklyTouches} weekly` : ""})`
    : `${fallbackR}R: no resistance ${levels.priceDiscovery ? "above (price discovery)" : "in range"}`);

  const targets = [
    { name: "TP1", price: t1.price, r: rOf(t1.price), pct: (t1.price / entry - 1) * 100, sell: split[0], note: why(t1, 2) },
    { name: "TP2", price: t2.price, r: rOf(t2.price), pct: (t2.price / entry - 1) * 100, sell: split[1], note: why(t2, 3) },
    { name: "Runner", price: null, r: null, pct: null, sell: split[2], note: "trail with the 10-day close-low; no fixed target" },
  ];

  // Plain R-multiples, flagged when a resistance sits in the way.
  const rTargets = [1, 2, 3].map((m) => {
    const px = entry + m * R;
    const blocking = above.filter((z) => z.low < px);
    return { r: m, price: px, pct: (px / entry - 1) * 100, blockedBy: blocking.length ? blocking[blocking.length - 1] : null };
  });

  return { R, riskPct: (R / entry) * 100, targets, rTargets, warnings };
}

/** Decimal places that suit the price (BTC 0, SOL 2, small caps more). */
export function pricePrecision(price) {
  if (!Number.isFinite(price) || price <= 0) return 2;
  if (price >= 1000) return 0;
  if (price >= 10) return 2;
  if (price >= 1) return 3;
  return Math.min(8, Math.max(4, Math.ceil(-Math.log10(price)) + 3));
}

export function fmt(x) {
  if (!Number.isFinite(x)) return "–";
  if (x >= 1000) return x.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (x >= 1) return x.toLocaleString("en-US", { maximumFractionDigits: 3 });
  return x.toPrecision(4);
}
