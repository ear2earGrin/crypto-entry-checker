import { describe, it, expect } from "vitest";
import { buyAndHold, regimeHold } from "../benchmarks.js";
import { weekStart } from "../montecarlo.js";

const DAY = 86400, WEEK = 7 * DAY;
const MONDAY = Date.UTC(2024, 0, 1) / 1000;

function daily(closes, t0 = MONDAY) {
  return closes.map((c, i) => ({ time: t0 + i * DAY, closeTime: t0 + (i + 1) * DAY - 1, open: c, high: c, low: c, close: c }));
}
function weekly(closes, t0) {
  return closes.map((c, i) => ({ time: t0 + i * WEEK, closeTime: t0 + (i + 1) * WEEK - 1, open: c, high: c, low: c, close: c }));
}

describe("buyAndHold", () => {
  it("single asset: tracks the price after one entry cost", () => {
    const curve = buyAndHold({ dailyByAsset: { BTC: daily([100, 150, 200]) }, assets: ["BTC"], startEquity: 1000, feePct: 0.08, slippagePct: 0.05 });
    expect(curve.length).toBe(3);
    expect(curve[0].equity).toBeCloseTo(1000 * (1 - 0.0013), 8);
    expect(curve[2].equity).toBeCloseTo(2000 * (1 - 0.0013), 8);
  });

  it("equal-weight: a late-listing coin's sleeve stays in cash until its first bar", () => {
    const dailyByAsset = { A: daily([100, 100, 200, 200]), B: daily([10, 20], MONDAY + 2 * DAY) };
    const curve = buyAndHold({ dailyByAsset, startEquity: 1000, feePct: 0, slippagePct: 0 });
    expect(curve.map((p) => p.equity)).toEqual([1000, 1000, 1500, 2000]);
  });
});

describe("regimeHold", () => {
  // 60 weekly closes, rising → above the 50W SMA from week 50 on.
  const wT0 = MONDAY - 60 * WEEK;
  const rising = weekly(Array.from({ length: 60 }, (_, i) => 100 + i), wT0);
  const falling = weekly(Array.from({ length: 60 }, (_, i) => 200 - i), wT0);

  it("holds coins above their 50W SMA, equal weight, and charges cost on traded notional", () => {
    const d = daily(Array.from({ length: 14 }, (_, i) => 100 + i));
    const curve = regimeHold({
      dailyByAsset: { UP: d, DOWN: daily(new Array(14).fill(50)) },
      weeklyByAsset: { UP: rising, DOWN: falling },
      startEquity: 1000, feePct: 0.08, slippagePct: 0.05,
    });
    expect(weekStart(curve[0].time)).toBe(curve[0].time);
    // Day 0 (Monday): all-in UP at open 100 with 0.13% cost; DOWN stays out.
    const qty = 1000 / 100;
    expect(curve[0].equity).toBeCloseTo(1000 - 1000 * 0.0013 + qty * (100 - 100), 8);
    expect(curve[6].equity).toBeCloseTo(1000 - 1.3 + qty * 6, 8);
  });

  it("sits in cash when nothing is above its SMA (or SMA not warmed up)", () => {
    const curve = regimeHold({
      dailyByAsset: { DOWN: daily(Array.from({ length: 10 }, (_, i) => 50 - i)) },
      weeklyByAsset: { DOWN: falling },
      startEquity: 1000,
    });
    curve.forEach((p) => expect(p.equity).toBe(1000));
    const cold = regimeHold({
      dailyByAsset: { UP: daily([100, 120]) },
      weeklyByAsset: { UP: rising.slice(0, 30) },
      startEquity: 1000,
    });
    cold.forEach((p) => expect(p.equity).toBe(1000));
  });

  it("uses only weeks CLOSED before the Monday (no look-ahead into the current week)", () => {
    // Weekly closes rise until the last week, which collapses. That week is
    // still open on the Monday it starts, so it must not affect that decision.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    closes.push(1);
    const w = weekly(closes, MONDAY - 60 * WEEK);
    const curve = regimeHold({ dailyByAsset: { X: daily([100, 110]) }, weeklyByAsset: { X: w }, startEquity: 1000, feePct: 0, slippagePct: 0 });
    expect(curve[1].equity).toBeCloseTo(1100, 8);
  });

  it("rebalances weekly and exits to cash when the regime turns off", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i);
    closes.push(1); // week starting MONDAY closes far below SMA → out from next Monday
    const w = weekly(closes, MONDAY - 60 * WEEK);
    const curve = regimeHold({ dailyByAsset: { X: daily([100, 100, 100, 100, 100, 100, 100, 50, 50]) }, weeklyByAsset: { X: w }, startEquity: 1000, feePct: 0, slippagePct: 0 });
    // Day 7 is the next Monday: sold at its open (50) → equity 500 and flat after.
    expect(curve[7].equity).toBeCloseTo(500, 8);
    expect(curve[8].equity).toBeCloseTo(500, 8);
  });
});
