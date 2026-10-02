import { describe, it, expect } from "vitest";
import { dailyReturns, equityCurveStats } from "../metrics.js";

const DAY = 86400;
const curve = (eqs) => eqs.map((equity, i) => ({ time: i * DAY, equity }));

describe("dailyReturns", () => {
  it("computes simple returns between consecutive points", () => {
    const r = dailyReturns(curve([100, 110, 99]));
    expect(r.length).toBe(2);
    expect(r[0]).toBeCloseTo(0.1, 12);
    expect(r[1]).toBeCloseTo(-0.1, 12);
    expect(dailyReturns([])).toEqual([]);
  });
});

describe("equityCurveStats", () => {
  it("computes Sharpe (sample sd, ×√365) and annualised vol", () => {
    const eqs = [100, 102, 101, 104, 103];
    const r = dailyReturns(curve(eqs));
    const mean = r.reduce((s, x) => s + x, 0) / r.length;
    const sd = Math.sqrt(r.reduce((s, x) => s + (x - mean) ** 2, 0) / (r.length - 1));
    const s = equityCurveStats(curve(eqs), 100);
    expect(s.sharpe).toBeCloseTo((mean / sd) * Math.sqrt(365), 10);
    expect(s.annVolPct).toBeCloseTo(sd * Math.sqrt(365) * 100, 10);
    expect(s.totalReturnPct).toBeCloseTo(3, 10);
    expect(s.maxDDPct).toBeCloseTo((1 / 102) * 100, 10);
  });

  it("returns null Sharpe/vol with zero variance or too few points", () => {
    expect(equityCurveStats(curve([100, 100, 100]), 100).sharpe).toBeNull();
    const one = equityCurveStats(curve([100]), 100);
    expect(one.sharpe).toBeNull();
    expect(one.annVolPct).toBeNull();
    expect(one.cagr).toBe(0);
  });

  it("measures drawdown from startEquity and computes CAGR", () => {
    const yearCurve = [{ time: 0, equity: 100 }, { time: 365.25 * DAY, equity: 121 }];
    expect(equityCurveStats(yearCurve, 100).cagr).toBeCloseTo(21, 8);
    // Curve starting below startEquity counts as a drawdown from start.
    expect(equityCurveStats(curve([90, 95]), 100).maxDDPct).toBeCloseTo(10, 10);
  });
});
