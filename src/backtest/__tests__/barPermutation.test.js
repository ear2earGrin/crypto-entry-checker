import { describe, it, expect } from "vitest";
import {
  weekStart, deriveWeekly, permuteBars, barPermutationTest,
  blockBootstrapMaxDrawdown, probMaxDDAtLeast, permutationEdgeTest,
} from "../montecarlo.js";
import { backtestPortfolio } from "../portfolio.js";

const DAY = 86400;
const MONDAY = Date.UTC(2024, 0, 1) / 1000; // 2024-01-01 was a Monday

// Small seeded PRNG + normal draws so fixtures are deterministic.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(rand) {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

// Daily candles from a list of daily log returns (close-to-close), with a small
// overnight gap and an intraday range so all four log-relatives are non-trivial.
function candlesFromReturns(rets, { t0 = MONDAY, p0 = 100, seed = 1 } = {}) {
  const rand = rng(seed);
  const out = [];
  let prev = p0;
  rets.forEach((r, i) => {
    const gap = (rand() - 0.5) * 0.002;
    const open = prev * Math.exp(gap);
    const close = prev * Math.exp(r);
    const high = Math.max(open, close) * (1 + rand() * 0.01);
    const low = Math.min(open, close) * (1 - rand() * 0.01);
    out.push({ time: t0 + i * DAY, closeTime: t0 + (i + 1) * DAY - 1, open, high, low, close, volume: 1000 + i, takerBuyBase: 500 });
    prev = close;
  });
  return out;
}

function iidReturns(n, seed, sd = 0.02, drift = 0) {
  const rand = rng(seed);
  return Array.from({ length: n }, () => drift + sd * normal(rand));
}

// Strong serial dependence: AR(1) daily returns.
function trendyReturns(n, seed, phi = 0.6, sd = 0.02) {
  const rand = rng(seed);
  const out = [];
  let prev = 0;
  for (let i = 0; i < n; i++) { prev = phi * prev + sd * normal(rand); out.push(prev); }
  return out;
}

// Order-sensitive toy statistic: follow yesterday's close-to-close direction.
function momentumStat({ dailyByAsset }) {
  let sum = 0, n = 0;
  for (const d of Object.values(dailyByAsset)) {
    for (let i = 2; i < d.length; i++) {
      const prev = Math.log(d[i - 1].close / d[i - 2].close);
      sum += Math.sign(prev) * Math.log(d[i].close / d[i - 1].close);
      n++;
    }
  }
  return sum / n;
}

const logRet = (a, b) => Math.log(b / a);

describe("weekStart / deriveWeekly", () => {
  it("anchors weeks to Monday 00:00 UTC", () => {
    expect(weekStart(MONDAY)).toBe(MONDAY);
    expect(weekStart(MONDAY + 3 * DAY + 5 * 3600)).toBe(MONDAY);
    expect(weekStart(MONDAY + 7 * DAY)).toBe(MONDAY + 7 * DAY);
    expect(weekStart(MONDAY - 1)).toBe(MONDAY - 7 * DAY);
  });

  it("aggregates OHLC and closes weeks at Sunday 23:59:59", () => {
    const daily = candlesFromReturns(iidReturns(16, 3), { t0: MONDAY + 2 * DAY }); // starts Wednesday
    const w = deriveWeekly(daily);
    expect(w.length).toBe(3);
    expect(w[0].time).toBe(MONDAY);
    expect(w[0].closeTime).toBe(MONDAY + 7 * DAY - 1);
    const firstWeek = daily.slice(0, 5); // Wed..Sun
    expect(w[0].open).toBe(firstWeek[0].open);
    expect(w[0].close).toBe(firstWeek[4].close);
    expect(w[0].high).toBe(Math.max(...firstWeek.map((d) => d.high)));
    expect(w[0].low).toBe(Math.min(...firstWeek.map((d) => d.low)));
    expect(w[1].open).toBe(daily[5].open);
  });
});

describe("permuteBars", () => {
  const n = 300;
  const startTime = MONDAY + 60 * DAY;
  const lateStart = MONDAY + 150 * DAY;
  const A = candlesFromReturns(iidReturns(n, 11), { seed: 1 });
  const B = candlesFromReturns(iidReturns(n, 12), { seed: 2, p0: 30 });
  // C lists mid-window.
  const C = candlesFromReturns(iidReturns(n - 150, 13), { seed: 3, t0: lateStart, p0: 5 });
  const dailyByAsset = { A, B, C };
  const idxOf = (arr, t) => arr.findIndex((d) => d.time === t);
  // C's first bar has no previous close, so it is C's anchor; the segment
  // boundary is C's first permutable day (its 2nd bar).
  const boundary = C[1].time;

  it("identity rebuild (seed=null) reproduces the input prices", () => {
    const out = permuteBars({ dailyByAsset, startTime, seed: null });
    for (const [asset, d] of Object.entries(dailyByAsset)) {
      out.dailyByAsset[asset].forEach((c, i) => {
        expect(c.close).toBeCloseTo(d[i].close, 8);
        expect(c.low).toBeCloseTo(d[i].low, 8);
      });
    }
  });

  it("actually reorders the window and leaves pre-window bars untouched", () => {
    const out = permuteBars({ dailyByAsset, startTime, seed: 7 }).dailyByAsset.A;
    const w = idxOf(A, startTime);
    for (let i = 0; i < w; i++) expect(out[i]).toEqual(A[i]);
    const moved = out.slice(w).filter((c, k) => Math.abs(c.close - A[w + k].close) > 1e-9).length;
    expect(moved).toBeGreaterThan(50);
  });

  it("preserves each asset's total log return within every segment", () => {
    const out = permuteBars({ dailyByAsset, startTime, seed: 7 }).dailyByAsset;
    const w = idxOf(A, startTime), cut = idxOf(A, boundary);
    for (const asset of ["A", "B"]) {
      const o = out[asset], d = dailyByAsset[asset];
      // segment 1: [startTime, boundary), segment 2: [boundary, end]
      expect(logRet(o[w - 1].close, o[cut - 1].close)).toBeCloseTo(logRet(d[w - 1].close, d[cut - 1].close), 9);
      expect(logRet(o[w - 1].close, o[n - 1].close)).toBeCloseTo(logRet(d[w - 1].close, d[n - 1].close), 9);
    }
    // C's first bar is its anchor; its total return from there is preserved.
    expect(logRet(out.C[0].close, out.C.at(-1).close)).toBeCloseTo(logRet(C[0].close, C.at(-1).close), 9);
  });

  it("moves each day's cross-asset vector together (one common permutation)", () => {
    const out = permuteBars({ dailyByAsset, startTime, seed: 9 }).dailyByAsset;
    const rel = (d, i) => logRet(d[i].open, d[i].close);
    // Index original days by A's intraday relative (continuous → unique).
    const byA = new Map(A.map((_, i) => [rel(A, i).toFixed(10), i]));
    const w = idxOf(A, startTime);
    for (let i = w; i < n; i++) {
      const src = byA.get(rel(out.A, i).toFixed(10));
      expect(src).toBeDefined();
      expect(rel(out.B, i)).toBeCloseTo(rel(B, src), 10);
      expect(logRet(out.B[i - 1].close, out.B[i].open)).toBeCloseTo(logRet(B[src - 1].close, B[src].open), 10);
      // never borrows a day across the C-listing boundary
      expect(A[src].time >= boundary).toBe(A[i].time >= boundary);
    }
  });

  it("block permutation keeps contiguous runs of `block` days together", () => {
    const out = permuteBars({ dailyByAsset: { A }, startTime, seed: 5, block: 10 }).dailyByAsset.A;
    const rel = (d, i) => logRet(d[i].open, d[i].close);
    const byA = new Map(A.map((_, i) => [rel(A, i).toFixed(10), i]));
    const w = idxOf(A, startTime);
    const src = [];
    for (let i = w; i < n; i++) src.push(byA.get(rel(out, i).toFixed(10)));
    const breaks = src.filter((s, k) => k > 0 && s !== src[k - 1] + 1).length;
    expect(breaks).toBeLessThanOrEqual(Math.ceil((n - w) / 10));
    expect(breaks).toBeGreaterThan(5);
  });

  it("rebuilds weekly bars with deriveWeekly; keeps original weeks closed before the window", () => {
    const weekly = deriveWeekly(A).map((w) => ({ ...w, tag: "orig" }));
    const derivedOnly = permuteBars({ dailyByAsset: { A }, startTime, seed: 3 });
    expect(derivedOnly.weeklyByAsset.A).toEqual(deriveWeekly(derivedOnly.dailyByAsset.A));

    const withWeekly = permuteBars({ dailyByAsset: { A }, weeklyByAsset: { A: weekly }, startTime, seed: 3 });
    const cut = weekStart(startTime);
    const kept = withWeekly.weeklyByAsset.A.filter((w) => w.tag === "orig");
    expect(kept.length).toBeGreaterThan(0);
    kept.forEach((w) => expect(w.closeTime).toBeLessThan(cut));
    const rest = withWeekly.weeklyByAsset.A.filter((w) => w.tag !== "orig");
    expect(rest).toEqual(deriveWeekly(withWeekly.dailyByAsset.A.filter((d) => d.time >= cut)));
  });
});

describe("barPermutationTest", () => {
  it("rejects the null when returns are strongly serially dependent", () => {
    const dailyByAsset = {
      X: candlesFromReturns(trendyReturns(500, 21), { seed: 4 }),
      Y: candlesFromReturns(trendyReturns(500, 22), { seed: 5 }),
    };
    const res = barPermutationTest({ dailyByAsset, runStat: momentumStat, runs: 99, seed: 1, startTime: MONDAY + 10 * DAY });
    expect(res.observed).toBeGreaterThan(res.nullP95);
    expect(res.timing).toBeGreaterThan(0);
    expect(res.p).toBeLessThan(0.05);
    expect(res.p).toBeGreaterThan(0); // (k+1)/(n+1): never exactly 0
    expect(res.p).toBeCloseTo(1 / 100, 10);
  });

  it("does not find timing skill in an iid random walk with drift", () => {
    const dailyByAsset = {
      X: candlesFromReturns(iidReturns(500, 31, 0.02, 0.002), { seed: 6 }),
      Y: candlesFromReturns(iidReturns(500, 32, 0.02, 0.002), { seed: 7 }),
    };
    const res = barPermutationTest({ dailyByAsset, runStat: momentumStat, runs: 99, seed: 2, startTime: MONDAY + 10 * DAY });
    expect(res.p).toBeGreaterThan(0.05);
  });

  it("is reproducible with a seed and drops non-finite null values", () => {
    const dailyByAsset = { X: candlesFromReturns(iidReturns(120, 41)) };
    let calls = 0;
    const runStat = (d) => (++calls === 3 ? NaN : momentumStat(d));
    const a = barPermutationTest({ dailyByAsset, runStat, runs: 20, seed: 3 });
    const b = barPermutationTest({ dailyByAsset, runStat: momentumStat, runs: 20, seed: 3 });
    expect(a.invalid).toBe(1);
    expect(a.nulls.length).toBe(19);
    const c = barPermutationTest({ dailyByAsset, runStat: momentumStat, runs: 20, seed: 3 });
    expect(c.nulls).toEqual(b.nulls);
    expect(c.p).toBe(b.p);
  });

  it("runs end-to-end with backtestPortfolio as the statistic", () => {
    const dailyByAsset = {
      X: candlesFromReturns(trendyReturns(700, 51, 0.3, 0.02), { seed: 8 }),
      Y: candlesFromReturns(trendyReturns(700, 52, 0.3, 0.02), { seed: 9 }),
    };
    const runStat = (d) => {
      const trades = backtestPortfolio({ ...d, feePct: 0.08 }).trades.filter((t) => t.exitReason !== "end of data");
      return trades.length ? trades.reduce((s, t) => s + t.rMultiple, 0) / trades.length : 0;
    };
    const res = barPermutationTest({ dailyByAsset, runStat, runs: 5, seed: 1, startTime: MONDAY + 30 * DAY });
    expect(Number.isFinite(res.observed)).toBe(true);
    expect(res.nulls.length).toBe(5);
    expect(res.p).toBeGreaterThan(0);
    expect(res.p).toBeLessThanOrEqual(1);
  });
});

describe("permutationEdgeTest p-value", () => {
  it("is never exactly 0", () => {
    const trades = Array.from({ length: 50 }, () => ({ pnl: 100 }));
    const res = permutationEdgeTest(trades, { runs: 99, seed: 1 });
    expect(res.p).toBeCloseTo(1 / 100, 12);
  });
});

describe("blockBootstrapMaxDrawdown", () => {
  const rets = iidReturns(800, 61, 0.02, 0.001);

  it("is deterministic for a seed and returns ordered percentiles", () => {
    const a = blockBootstrapMaxDrawdown(rets, { runs: 500, seed: 4 });
    const b = blockBootstrapMaxDrawdown(rets, { runs: 500, seed: 4 });
    expect(a.maxDDPct).toEqual(b.maxDDPct);
    const { p50, p90, p95, p99 } = a.maxDDPct;
    expect(p50).toBeGreaterThan(0);
    expect(p50).toBeLessThanOrEqual(p90);
    expect(p90).toBeLessThanOrEqual(p95);
    expect(p95).toBeLessThanOrEqual(p99);
    expect(a.horizon).toBe(800);
  });

  it("meanScale < 1 raises drawdown", () => {
    const full = blockBootstrapMaxDrawdown(rets, { runs: 500, seed: 4 });
    const half = blockBootstrapMaxDrawdown(rets, { runs: 500, seed: 4, meanScale: 0.5 });
    const none = blockBootstrapMaxDrawdown(rets, { runs: 500, seed: 4, meanScale: 0 });
    expect(half.maxDDPct.p50).toBeGreaterThan(full.maxDDPct.p50);
    expect(none.maxDDPct.p95).toBeGreaterThan(half.maxDDPct.p95);
  });

  it("all-positive returns never draw down; empty input is handled", () => {
    const up = blockBootstrapMaxDrawdown(new Array(100).fill(0.01), { runs: 50 });
    expect(up.maxDDPct.p99).toBe(0);
    const empty = blockBootstrapMaxDrawdown([]);
    expect(empty.runs).toBe(0);
    expect(probMaxDDAtLeast(empty, 10)).toBe(0);
  });

  it("probMaxDDAtLeast is a decreasing tail probability", () => {
    const res = blockBootstrapMaxDrawdown(rets, { runs: 500, seed: 2, horizon: 365 });
    expect(res.horizon).toBe(365);
    expect(probMaxDDAtLeast(res, 0)).toBe(1);
    expect(probMaxDDAtLeast(res, res.maxDDPct.p50)).toBeGreaterThanOrEqual(0.5);
    expect(probMaxDDAtLeast(res, 10)).toBeGreaterThanOrEqual(probMaxDDAtLeast(res, 30));
    expect(probMaxDDAtLeast(res, 1000)).toBe(0);
  });
});
