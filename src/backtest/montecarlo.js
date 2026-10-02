/**
 * Monte Carlo analysis for backtest results.
 *
 * 1. `bootstrapTradeSequence` — resamples closed-trade DOLLAR P&L iid on a fixed
 *    equity base. Quick, but it understates tail drawdown (it ignores open-trade
 *    mark-to-market swings and serial dependence). Prefer `blockBootstrapMaxDrawdown`.
 *
 * 2. `permutationEdgeTest` — sign-flip test of "mean trade P&L > 0". It does NOT
 *    separate timing skill from market drift: a long-only system with zero timing
 *    skill passes it whenever the market drifted up.
 *
 * 3. `barPermutationTest` — drift-preserving joint permutation of daily bars. Keeps
 *    each asset's total return and each day's cross-asset move, destroys the time
 *    ORDER. Asks: "does the strategy's timing beat the same rules run on the same
 *    days shuffled?" This is the timing-skill test.
 *
 * 4. `blockBootstrapMaxDrawdown` — stationary block bootstrap of DAILY
 *    mark-to-market returns; the drawdown distribution to plan around.
 *
 * Note on RNG: uses a mulberry32 seeded PRNG for reproducibility. Same seed →
 * identical results across runs. Default seed = 1.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * sortedAsc.length)));
  return sortedAsc[idx];
}

function simulatePath(trades, startEquity) {
  let equity = startEquity;
  let peak = startEquity;
  let maxDDPct = 0;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDDPct) maxDDPct = dd;
  }
  return { finalEquity: equity, returnPct: ((equity - startEquity) / startEquity) * 100, maxDDPct };
}

/**
 * Resample the trade sequence with replacement N times. Returns distribution
 * of total returns and max drawdowns.
 *
 * @param {Array}  trades       Real trades, each with at minimum { pnl: number }
 * @param {object} opts
 * @param {number} [opts.startEquity=100000]
 * @param {number} [opts.runs=2000]
 * @param {number} [opts.seed=1]
 * @returns {{ runs: number, returnsPct: object, maxDDPct: object, samples: Array }}
 */
export function bootstrapTradeSequence(trades, { startEquity = 100000, runs = 2000, seed = 1 } = {}) {
  if (!trades?.length) {
    return { runs: 0, returnsPct: empty(), maxDDPct: empty(), samples: [] };
  }
  const rand = mulberry32(seed);
  const samples = new Array(runs);
  for (let r = 0; r < runs; r++) {
    const shuffled = new Array(trades.length);
    for (let i = 0; i < trades.length; i++) {
      shuffled[i] = trades[Math.floor(rand() * trades.length)];
    }
    samples[r] = simulatePath(shuffled, startEquity);
  }
  const returns = samples.map((s) => s.returnPct).sort((a, b) => a - b);
  const dds = samples.map((s) => s.maxDDPct).sort((a, b) => a - b);
  return {
    runs,
    returnsPct: distribution(returns),
    maxDDPct: distribution(dds),
    samples,
  };
}

function empty() {
  return { mean: 0, median: 0, p05: 0, p25: 0, p75: 0, p95: 0, min: 0, max: 0 };
}

function distribution(sortedAsc) {
  if (sortedAsc.length === 0) return empty();
  const mean = sortedAsc.reduce((s, x) => s + x, 0) / sortedAsc.length;
  return {
    mean,
    median: percentile(sortedAsc, 0.5),
    p05: percentile(sortedAsc, 0.05),
    p25: percentile(sortedAsc, 0.25),
    p75: percentile(sortedAsc, 0.75),
    p95: percentile(sortedAsc, 0.95),
    min: sortedAsc[0],
    max: sortedAsc[sortedAsc.length - 1],
  };
}

/**
 * Sign-flip test of mean trade P&L > 0; does NOT separate timing skill from drift.
 *
 * Method: for each run, flip the sign of every trade's pnl with prob 0.5 and take
 * the mean. The null is "trade P&L is symmetric around zero", so a small p only
 * says the average trade made money. A long-only system with no timing skill at
 * all passes whenever the market drifted up over the sample. For timing skill
 * use `barPermutationTest`.
 *
 * p = (1 + #{permuted mean >= real mean}) / (1 + runs) — never exactly 0.
 *
 * @param {Array}  trades
 * @param {object} opts
 * @param {number} [opts.runs=2000]
 * @param {number} [opts.seed=1]
 * @returns {{ runs: number, realExpectancy: number, p: number, permutedMean: number, permutedP95: number }}
 */
export function permutationEdgeTest(trades, { runs = 2000, seed = 1 } = {}) {
  if (!trades?.length) return { runs: 0, realExpectancy: 0, p: 1, permutedMean: 0, permutedP95: 0 };

  const realExp = trades.reduce((s, t) => s + t.pnl, 0) / trades.length;
  const rand = mulberry32(seed);
  const perms = new Array(runs);

  for (let r = 0; r < runs; r++) {
    let sum = 0;
    for (const t of trades) {
      const sign = rand() < 0.5 ? -1 : 1;
      sum += sign * t.pnl;
    }
    perms[r] = sum / trades.length;
  }

  perms.sort((a, b) => a - b);
  let geCount = 0;
  for (const v of perms) if (v >= realExp) geCount++;
  const p = (geCount + 1) / (runs + 1);

  const mean = perms.reduce((s, x) => s + x, 0) / perms.length;
  return { runs, realExpectancy: realExp, p, permutedMean: mean, permutedP95: percentile(perms, 0.95) };
}

// ---------------------------------------------------------------------------
// Drift-preserving joint bar permutation (timing-skill test)
// ---------------------------------------------------------------------------

const ONE_DAY = 86400;
const ONE_WEEK = 7 * ONE_DAY;
const MONDAY_OFFSET = 4 * ONE_DAY; // 1970-01-01 was a Thursday; +4 days = Monday

/** Unix-seconds start (Monday 00:00 UTC) of the week containing `t`. */
export function weekStart(t) {
  return Math.floor((t - MONDAY_OFFSET) / ONE_WEEK) * ONE_WEEK + MONDAY_OFFSET;
}

/**
 * Aggregate daily candles into Monday-anchored weekly candles (Binance's 1w
 * convention). closeTime = weekStart + 1 week − 1s, so a week that the data
 * ends inside is never treated as closed by the engines.
 */
export function deriveWeekly(daily) {
  const out = [];
  for (const d of daily || []) {
    const ws = weekStart(d.time);
    const w = out[out.length - 1];
    if (w && w.time === ws) {
      w.high = Math.max(w.high, d.high);
      w.low = Math.min(w.low, d.low);
      w.close = d.close;
      w.volume += d.volume || 0;
      w.takerBuyBase += d.takerBuyBase || 0;
    } else {
      out.push({
        time: ws, closeTime: ws + ONE_WEEK - 1,
        open: d.open, high: d.high, low: d.low, close: d.close,
        volume: d.volume || 0, takerBuyBase: d.takerBuyBase || 0,
      });
    }
  }
  return out;
}

function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// A permutation of 0..len-1 that moves contiguous blocks of `block` positions.
function blockOrder(len, block, rand) {
  const starts = [];
  for (let s = 0; s < len; s += block) starts.push(s);
  shuffleInPlace(starts, rand);
  const order = [];
  for (const s of starts) for (let k = s; k < Math.min(s + block, len); k++) order.push(k);
  return order;
}

// One-time setup: per-asset log-relatives and the window's permutable segments.
function preparePermutation(dailyByAsset, startTime) {
  const perAsset = {};
  const inWindow = new Set();
  const boundaries = new Set();
  for (const [asset, daily] of Object.entries(dailyByAsset)) {
    if (!daily?.length) continue;
    // First in-window bar that has a previous close to anchor from.
    const entryIdx = daily.findIndex((d, i) => i >= 1 && d.time >= startTime);
    const rel = daily.map((d, i) => (i === 0 ? null : {
      o: Math.log(d.open / daily[i - 1].close),
      h: Math.log(d.high / d.open),
      l: Math.log(d.low / d.open),
      c: Math.log(d.close / d.open),
    }));
    const idxByTime = new Map();
    if (entryIdx >= 0) {
      for (let i = entryIdx; i < daily.length; i++) {
        idxByTime.set(daily[i].time, i);
        inWindow.add(daily[i].time);
      }
      boundaries.add(daily[entryIdx].time);
    }
    perAsset[asset] = { daily, entryIdx, rel, idxByTime };
  }

  const timeline = [...inWindow].sort((a, b) => a - b);
  const cuts = [...boundaries].sort((a, b) => a - b).map((t) => timeline.indexOf(t));
  if (cuts[0] !== 0 && timeline.length) cuts.unshift(0);
  cuts.push(timeline.length);

  // Segment k = timeline[cuts[k] .. cuts[k+1]); members = assets with a bar on
  // every day of it. Everyone else keeps that stretch in its original order.
  const segments = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const times = timeline.slice(cuts[k], cuts[k + 1]);
    if (times.length < 2) continue;
    const members = Object.keys(perAsset).filter((a) => times.every((t) => perAsset[a].idxByTime.has(t)));
    if (members.length) segments.push({ times, members });
  }
  return { perAsset, segments };
}

// Rebuild one asset's prices: bar i takes the log-relatives of bar src[i].
function rebuildDaily({ daily, entryIdx, rel }, src) {
  if (entryIdx < 0) return daily;
  const out = daily.slice(0, entryIdx);
  for (let i = entryIdx; i < daily.length; i++) {
    const r = rel[src[i]];
    const from = daily[src[i]];
    const open = out[i - 1].close * Math.exp(r.o);
    out.push({
      ...daily[i],
      open,
      high: open * Math.exp(r.h),
      low: open * Math.exp(r.l),
      close: open * Math.exp(r.c),
      volume: from.volume,
      takerBuyBase: from.takerBuyBase,
    });
  }
  return out;
}

// Weekly bars: originals that closed before the permuted stretch, then weeks
// re-aggregated from the (permuted) dailies.
function rebuildWeekly(asset, rebuilt, prep, weeklyByAsset) {
  const original = weeklyByAsset?.[asset];
  const { entryIdx, daily } = prep;
  if (!original?.length) return deriveWeekly(rebuilt);
  if (entryIdx < 0) return original;
  const cut = weekStart(daily[entryIdx].time);
  const kept = original.filter((w) => (w.closeTime ?? w.time + ONE_WEEK - 1) < cut);
  return kept.concat(deriveWeekly(rebuilt.filter((d) => d.time >= cut)));
}

function buildPermutedData(prep, weeklyByAsset, rand, block) {
  const src = {};
  for (const [asset, p] of Object.entries(prep.perAsset)) src[asset] = p.daily.map((_, i) => i);
  if (rand) {
    for (const seg of prep.segments) {
      const order = blockOrder(seg.times.length, block, rand);
      for (const asset of seg.members) {
        const { idxByTime } = prep.perAsset[asset];
        for (let k = 0; k < seg.times.length; k++) {
          src[asset][idxByTime.get(seg.times[k])] = idxByTime.get(seg.times[order[k]]);
        }
      }
    }
  }
  const dailyByAsset = {}, weekly = {};
  for (const [asset, p] of Object.entries(prep.perAsset)) {
    dailyByAsset[asset] = rebuildDaily(p, src[asset]);
    weekly[asset] = rebuildWeekly(asset, dailyByAsset[asset], p, weeklyByAsset);
  }
  return { dailyByAsset, weeklyByAsset: weekly };
}

/**
 * Drift-preserving joint daily permutation test — "is there timing skill?"
 *
 * Inside the test window (bars with time >= startTime) ONE common random
 * permutation of days (or of contiguous blocks of `block` days) is applied to
 * every asset, permuting each day's vector of log-relatives (open/prevClose,
 * high/open, low/open, close/open). Prices are rebuilt cumulatively from the
 * last pre-window close, so each asset's total return over the window and each
 * day's cross-asset move are preserved exactly; only the ORDER is destroyed.
 * Weekly bars are re-aggregated (Monday-anchored) from the permuted dailies.
 * Bars before startTime stay as they are (warm-up).
 *
 * Assets entering mid-window split the window into segments at each asset's
 * first in-window day; permutation happens only within a segment, among the
 * assets present on every day of that segment.
 *
 * The observed statistic is computed on the identity rebuild (same weekly
 * construction as the nulls), so observed and null are directly comparable.
 *
 * @param {object} opts
 * @param {Object<string, Array>} opts.dailyByAsset
 * @param {Object<string, Array>} [opts.weeklyByAsset]  Pre-window weekly bars are kept from here (warm-up)
 * @param {(data: {dailyByAsset, weeklyByAsset}) => number} opts.runStat
 * @param {number} [opts.runs=199]
 * @param {number} [opts.seed=1]
 * @param {number} [opts.block=1]       Days per permuted block (1 = plain day permutation)
 * @param {number} [opts.startTime=-Infinity]  Unix seconds; earlier bars are not permuted
 * @returns {{ runs, block, observed, nullMedian, nullMean, nullP95, timing, p, invalid, nulls }}
 *   timing = observed − median(null): the part of the statistic attributable to ORDER.
 *   p = (1 + #{null >= observed}) / (1 + valid runs).
 */
export function barPermutationTest({ dailyByAsset, weeklyByAsset = null, runStat, runs = 199, seed = 1, block = 1, startTime = -Infinity }) {
  const prep = preparePermutation(dailyByAsset, startTime);
  const blk = Math.max(1, Math.floor(block));
  const observed = runStat(buildPermutedData(prep, weeklyByAsset, null, blk));
  const rand = mulberry32(seed);
  const nulls = [];
  let invalid = 0;
  for (let r = 0; r < runs; r++) {
    const v = runStat(buildPermutedData(prep, weeklyByAsset, rand, blk));
    if (Number.isFinite(v)) nulls.push(v); else invalid++;
  }
  nulls.sort((a, b) => a - b);
  const ge = nulls.filter((v) => v >= observed).length;
  const nullMedian = percentile(nulls, 0.5);
  return {
    runs, block: blk, observed,
    nullMedian,
    nullMean: nulls.length ? nulls.reduce((s, x) => s + x, 0) / nulls.length : null,
    nullP95: percentile(nulls, 0.95),
    timing: Number.isFinite(observed) && nullMedian !== null ? observed - nullMedian : null,
    p: Number.isFinite(observed) ? (1 + ge) / (1 + nulls.length) : null,
    invalid,
    nulls,
  };
}

/** Exposed for tests: the permuted data for one seeded draw (seed=null → identity rebuild). */
export function permuteBars({ dailyByAsset, weeklyByAsset = null, seed = 1, block = 1, startTime = -Infinity }) {
  const prep = preparePermutation(dailyByAsset, startTime);
  return buildPermutedData(prep, weeklyByAsset, seed === null ? null : mulberry32(seed), Math.max(1, Math.floor(block)));
}

// ---------------------------------------------------------------------------
// Stationary block bootstrap of daily returns (drawdown planning)
// ---------------------------------------------------------------------------

/**
 * Politis–Romano stationary block bootstrap of DAILY mark-to-market returns.
 * Each path starts at a random day, continues to the next day with prob
 * 1 − 1/meanBlock and jumps to a random day otherwise (circular wrap), so
 * volatility clustering and open-trade swings survive inside blocks.
 *
 * `meanScale` = k rescales the mean return: r' = r − (1 − k)·mean(r). k = 1 is
 * the history as-is; k = 0.5 assumes only half the historical drift persists.
 *
 * @param {number[]} dailyReturns  Simple daily returns (0.01 = +1%)
 * @param {object} [opts]
 * @param {number} [opts.runs=5000]
 * @param {number} [opts.meanBlock=30]   Expected block length in days
 * @param {number} [opts.horizon]        Days per path (default: length of the history)
 * @param {number} [opts.seed=1]
 * @param {number} [opts.meanScale=1]
 * @returns {{ runs, horizon, meanBlock, meanScale, maxDDPct: { mean, p50, p90, p95, p99 }, samples: number[] }}
 *   samples = sorted max drawdowns (%) — pass to probMaxDDAtLeast.
 */
export function blockBootstrapMaxDrawdown(dailyReturns, { runs = 5000, meanBlock = 30, horizon, seed = 1, meanScale = 1 } = {}) {
  const base = (dailyReturns || []).filter(Number.isFinite);
  const n = base.length;
  const H = horizon ?? n;
  if (!n || !H) {
    return { runs: 0, horizon: 0, meanBlock, meanScale, maxDDPct: { mean: 0, p50: 0, p90: 0, p95: 0, p99: 0 }, samples: [] };
  }
  const mean = base.reduce((s, x) => s + x, 0) / n;
  const r = base.map((x) => x - (1 - meanScale) * mean);
  const pJump = 1 / Math.max(1, meanBlock);
  const rand = mulberry32(seed);
  const samples = new Array(runs);
  for (let run = 0; run < runs; run++) {
    let idx = Math.floor(rand() * n);
    let eq = 1, peak = 1, mdd = 0;
    for (let step = 0; step < H; step++) {
      if (step > 0) idx = rand() < pJump ? Math.floor(rand() * n) : (idx + 1) % n;
      eq = Math.max(0, eq * (1 + r[idx]));
      if (eq > peak) peak = eq;
      const dd = (peak - eq) / peak;
      if (dd > mdd) mdd = dd;
    }
    samples[run] = mdd * 100;
  }
  samples.sort((a, b) => a - b);
  return {
    runs, horizon: H, meanBlock, meanScale,
    maxDDPct: {
      mean: samples.reduce((s, x) => s + x, 0) / runs,
      p50: percentile(samples, 0.5),
      p90: percentile(samples, 0.9),
      p95: percentile(samples, 0.95),
      p99: percentile(samples, 0.99),
    },
    samples,
  };
}

/** P(max drawdown >= xPct) from a blockBootstrapMaxDrawdown result. */
export function probMaxDDAtLeast(result, xPct) {
  const s = result?.samples || [];
  if (!s.length) return 0;
  return s.filter((v) => v >= xPct).length / s.length;
}
