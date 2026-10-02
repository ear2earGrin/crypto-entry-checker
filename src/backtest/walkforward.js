import { backtestOne } from "./engine.js";
import { computeMetrics } from "./metrics.js";
import { SIGNAL_PARAMS } from "../strategy/signal.js";

const ONE_DAY = 86400;

function sliceCandles(candles, fromUnix, toUnix) {
  return candles.filter((c) => c.time >= fromUnix && c.time <= toUnix);
}

// Cartesian product of a parameter grid, lazily — returns an array of param objects.
function paramGrid(grid) {
  const keys = Object.keys(grid);
  if (keys.length === 0) return [{}];
  const out = [];
  function step(i, acc) {
    if (i === keys.length) { out.push({ ...acc }); return; }
    const k = keys[i];
    for (const v of grid[k]) {
      acc[k] = v;
      step(i + 1, acc);
    }
  }
  step(0, {});
  return out;
}

function objective(metrics, kind = "expectancyR") {
  if (!metrics || metrics.numTrades === 0) return -Infinity;
  // We deliberately do NOT optimize for raw return — that overfits to the bull run.
  // Default objective is expectancy in R-multiples, which rewards consistent edge.
  if (kind === "expectancyR") return metrics.expectancyR;
  if (kind === "profitFactor") return metrics.profitFactor === Infinity ? 999 : metrics.profitFactor;
  if (kind === "sortino") {
    // crude: expectancy / |avgLoss in R| — discourages systems that win big but lose bigger
    return metrics.expectancyR / Math.max(0.5, Math.abs(metrics.avgLoss / 1000));
  }
  if (kind === "totalReturnPct") return metrics.totalReturnPct;
  return metrics.expectancyR;
}

/**
 * Walk-forward backtest.
 *
 * With a `paramGrid`, each fold (1) picks the best parameters on an in-sample
 * window, (2) freezes them, (3) runs them on the following window.
 *
 * WITHOUT a paramGrid (how scripts/backtest.mjs calls it) nothing is fitted:
 * every fold just runs the frozen configuration on consecutive periods. That
 * is SUB-PERIOD STABILITY, not out-of-sample evidence — the production rules
 * were selected on this same history. The "oos*" fields then simply mean
 * "the later window of each fold".
 *
 * Defaults are conservative: 2-year in-sample, 6-month out-of-sample, step forward
 * 6 months. This matches academic walk-forward conventions and gives crypto data
 * (where regime shifts every 12-24 months) a fair shot.
 *
 * @param {object} opts
 * @param {Array} opts.weekly                    Weekly candles (entire history).
 * @param {Array} opts.daily                     Daily candles (entire history).
 * @param {object} [opts.paramGrid]              { donchianEntry: [15, 20, 25], donchianExit: [7, 10, 14] } etc.
 *                                               Omit to skip optimization (frozen params → sub-period stability only).
 * @param {string} [opts.objective="expectancyR"]
 * @param {number} [opts.inSampleDays=730]       2 years
 * @param {number} [opts.outSampleDays=183]      ~6 months
 * @param {number} [opts.stepDays=183]           Step forward each fold
 * @param {number} [opts.startEquity=100000]
 * @param {number} [opts.riskPct=1]
 * @param {number} [opts.feePct=0.08]
 * @returns {{ folds: Array, oosEquityCurve: Array, oosMetrics: object, summary: object }}
 */
export function walkForward({
  weekly,
  daily,
  paramGrid: grid = null,
  objective: objKind = "expectancyR",
  inSampleDays = 730,
  outSampleDays = 183,
  stepDays = 183,
  startEquity = 100000,
  riskPct = 1,
  feePct = 0.08,
  slippagePct = 0,
  funding = null,
  // Base strategy configuration. Grid entries in paramGrid override on top of
  // signalParams, so e.g. a long-only base stays long-only across the sweep.
  signalParams = SIGNAL_PARAMS,
  regimeParams = undefined,
  exitOnRegimeFlip = true,
  asset = "ASSET",
}) {
  if (!daily?.length || !weekly?.length) {
    return { folds: [], oosEquityCurve: [], oosMetrics: computeMetrics({ trades: [], equityCurve: [], startEquity }), summary: { degradation: null } };
  }

  const firstT = daily[0].time;
  const lastT = daily[daily.length - 1].time;
  const totalSpan = lastT - firstT;
  const minSpan = (inSampleDays + outSampleDays) * ONE_DAY;
  if (totalSpan < minSpan) {
    return { folds: [], oosEquityCurve: [], oosMetrics: computeMetrics({ trades: [], equityCurve: [], startEquity }), summary: { degradation: null, error: `Need ${(minSpan/ONE_DAY)|0} days, have ${(totalSpan/ONE_DAY)|0}.` } };
  }

  const params = grid ? paramGridFromObject(grid) : [{}];
  const folds = [];
  let equity = startEquity;
  let oosCurve = [];
  let oosTrades = [];

  let isStart = firstT;
  for (;;) {
    const isEnd = isStart + inSampleDays * ONE_DAY;
    const oosEnd = isEnd + outSampleDays * ONE_DAY;
    if (oosEnd > lastT) break;

    const weeklyIS = sliceCandles(weekly, isStart - 60 * 7 * ONE_DAY, isEnd);
    const dailyIS = sliceCandles(daily, isStart, isEnd);
    const weeklyOOS = sliceCandles(weekly, isStart - 60 * 7 * ONE_DAY, oosEnd);
    const dailyOOS = sliceCandles(daily, isEnd, oosEnd);

    let best = { params: {}, score: -Infinity, metrics: null };
    for (const p of params) {
      const sp = { ...signalParams, ...p };
      const bt = backtestOne({
        asset, weekly: weeklyIS, daily: dailyIS,
        startEquity: equity, riskPct, feePct, slippagePct, funding, signalParams: sp,
        regimeParams, exitOnRegimeFlip,
      });
      const m = computeMetrics(bt);
      const score = objective(m, objKind);
      if (score > best.score) best = { params: p, score, metrics: m };
    }

    const oosSp = { ...signalParams, ...best.params };
    const oosBt = backtestOne({
      asset, weekly: weeklyOOS, daily: dailyOOS,
      startEquity: equity, riskPct, feePct, slippagePct, funding, signalParams: oosSp,
      regimeParams, exitOnRegimeFlip,
    });
    const oosMetrics = computeMetrics(oosBt);

    equity = oosBt.finalEquity;
    folds.push({
      isStart, isEnd, oosEnd,
      params: best.params,
      isScore: best.score,
      isMetrics: best.metrics,
      oosMetrics,
      oosTrades: oosBt.trades,
      oosEquityCurve: oosBt.equityCurve,
    });
    oosCurve = oosCurve.concat(oosBt.equityCurve);
    oosTrades = oosTrades.concat(oosBt.trades);

    isStart += stepDays * ONE_DAY;
  }

  const oosMetrics = computeMetrics({ trades: oosTrades, equityCurve: oosCurve, startEquity });

  // Degradation: relative drop from in-sample to "oos" objective, averaged across
  // folds. Only meaningful when a paramGrid was fitted; with frozen params it is
  // just the difference between two sub-periods and carries no overfit verdict.
  const validFolds = folds.filter((f) => f.isMetrics && f.oosMetrics && f.isMetrics.numTrades > 0);
  let degradation = null;
  if (validFolds.length) {
    // A fold with zero trades expressed no edge — score it 0, not -Infinity,
    // or one empty OOS window poisons the whole average.
    const objOrZero = (m) => (m && m.numTrades > 0 ? objective(m, objKind) : 0);
    const avgIs = validFolds.reduce((s, f) => s + objOrZero(f.isMetrics), 0) / validFolds.length;
    const avgOos = validFolds.reduce((s, f) => s + objOrZero(f.oosMetrics), 0) / validFolds.length;
    if (Number.isFinite(avgIs) && Number.isFinite(avgOos) && avgIs !== 0) {
      degradation = ((avgIs - avgOos) / Math.abs(avgIs)) * 100;
    }
  }

  return {
    folds,
    oosEquityCurve: oosCurve,
    oosMetrics,
    summary: {
      numFolds: folds.length,
      degradation,
      finalEquity: equity,
      oosTotalReturnPct: oosMetrics.totalReturnPct,
      oosMaxDDPct: oosMetrics.maxDDPct,
      oosExpectancyR: oosMetrics.expectancyR,
    },
  };
}

function paramGridFromObject(grid) {
  return paramGrid(grid);
}

export { paramGrid };
