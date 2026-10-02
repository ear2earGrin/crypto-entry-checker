import { sma } from "../indicators/sma.js";
import { weekStart } from "./montecarlo.js";

/**
 * Passive benchmarks the system must beat on a risk-adjusted basis. Each returns
 * a daily mark-to-market equity curve [{ time, equity }] on the union timeline
 * of the given assets, so it can be scored with equityCurveStats exactly like
 * the portfolio. Costs are charged on traded notional: feePct per side plus
 * slippagePct. Final holdings are marked at the last close (no exit cost).
 *
 *   buyAndHold   — equal-weight sleeves, one per asset; a sleeve sits in cash
 *                  until its asset's first bar, then buys at that close and holds.
 *                  With assets = ["BTC"] this is BTC buy-and-hold.
 *   regimeHold   — the regime filter WITHOUT the Donchian timing: each Monday,
 *                  hold every coin whose last CLOSED weekly close is above its
 *                  50-week SMA, equal weight among those held, rebalanced weekly
 *                  at Monday's open; cash otherwise.
 */

function unionTimeline(dailyByAsset, assets) {
  const set = new Set();
  for (const a of assets) for (const c of dailyByAsset[a] || []) set.add(c.time);
  return [...set].sort((x, y) => x - y);
}

function barMaps(dailyByAsset, assets) {
  const maps = {};
  for (const a of assets) maps[a] = new Map((dailyByAsset[a] || []).map((c) => [c.time, c]));
  return maps;
}

function lastClosedIdx(weekly, t) {
  let lo = 0, hi = weekly.length - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((weekly[mid].closeTime ?? weekly[mid].time) <= t) { best = mid; lo = mid + 1; }
    else hi = mid - 1;
  }
  return best;
}

export function buyAndHold({ dailyByAsset, assets = Object.keys(dailyByAsset), startEquity = 100000, feePct = 0.08, slippagePct = 0.05 }) {
  const held = assets.filter((a) => dailyByAsset[a]?.length);
  if (!held.length) return [];
  const cost = (feePct + slippagePct) / 100;
  const bars = barMaps(dailyByAsset, held);
  const sleeve = startEquity / held.length;
  let cash = startEquity;
  const qty = {}, lastClose = {};
  const curve = [];
  for (const t of unionTimeline(dailyByAsset, held)) {
    for (const a of held) {
      const bar = bars[a].get(t);
      if (!bar) continue;
      lastClose[a] = bar.close;
      if (qty[a] === undefined) {
        qty[a] = (sleeve * (1 - cost)) / bar.close;
        cash -= sleeve;
      }
    }
    const value = held.reduce((s, a) => s + (qty[a] ? qty[a] * lastClose[a] : 0), 0);
    curve.push({ time: t, equity: cash + value });
  }
  return curve;
}

export function regimeHold({ dailyByAsset, weeklyByAsset, assets = Object.keys(dailyByAsset), startEquity = 100000, feePct = 0.08, slippagePct = 0.05, smaPeriod = 50 }) {
  const universe = assets.filter((a) => dailyByAsset[a]?.length && weeklyByAsset?.[a]?.length);
  if (!universe.length) return [];
  const cost = (feePct + slippagePct) / 100;
  const bars = barMaps(dailyByAsset, universe);
  const weekly = {};
  for (const a of universe) {
    const w = weeklyByAsset[a];
    weekly[a] = { bars: w, sma: sma(w.map((c) => c.close), smaPeriod) };
  }
  const aboveSma = (a, t) => {
    const i = lastClosedIdx(weekly[a].bars, t);
    const s = i >= 0 ? weekly[a].sma[i] : null;
    return s !== null && s !== undefined && weekly[a].bars[i].close > s;
  };

  let cash = startEquity;
  const qty = Object.fromEntries(universe.map((a) => [a, 0]));
  const lastClose = {};
  const curve = [];
  for (const t of unionTimeline(dailyByAsset, universe)) {
    if (weekStart(t) === t) {
      // Rebalance at Monday's open among the coins that trade today.
      const tradable = universe.filter((a) => bars[a].has(t));
      const open = (a) => bars[a].get(t).open;
      const tradableValue = cash + tradable.reduce((s, a) => s + qty[a] * open(a), 0);
      const picks = tradable.filter((a) => aboveSma(a, t));
      for (const a of tradable) {
        const target = picks.includes(a) ? tradableValue / picks.length : 0;
        const delta = target - qty[a] * open(a);
        cash -= delta + Math.abs(delta) * cost;
        qty[a] = target / open(a);
      }
    }
    for (const a of universe) {
      const bar = bars[a].get(t);
      if (bar) lastClose[a] = bar.close;
    }
    const value = universe.reduce((s, a) => s + (qty[a] ? qty[a] * lastClose[a] : 0), 0);
    curve.push({ time: t, equity: cash + value });
  }
  return curve;
}
