import { describe, it, expect } from "vitest";
import { backtestPortfolio } from "../portfolio.js";
import { markOpenPosition } from "../markToMarket.js";
import { PRODUCTION_PRESET } from "../../strategy/presets.js";

const ONE_DAY = 86400, ONE_WEEK = ONE_DAY * 7;
const bars = (closes, step, start = 1577836800) => closes.map((c, i) => ({
  time: start + i * step, closeTime: start + (i + 1) * step - 1,
  open: c, high: c * 1.01, low: c * 0.99, close: c,
}));

// An uptrend whose last 60 days rally hard, so breakouts are still open when the data ends.
function fixture(seed) {
  const weekly = bars(Array.from({ length: 150 }, (_, i) => 100 + i * 2 + Math.sin(i / 4 + seed) * 8), ONE_WEEK);
  const wave = (i) => 100 + i * 0.3 + Math.sin(i / 12 + seed) * 12;
  const closes = Array.from({ length: 700 }, (_, i) => (i < 640 ? wave(i) : wave(639) + (i - 639) * 2));
  const daily = bars(closes, ONE_DAY, weekly[0].time);
  return { weekly, daily };
}

describe("markOpenPosition", () => {
  it("matches the engine's own end-of-data settlement at the last close", () => {
    const a = fixture(0), b = fixture(2);
    // Same engine config the Paper tab replays with.
    const cfg = {
      startEquity: 100000, riskPct: 1, feePct: 0.08, slippagePct: 0.05,
      signalParams: PRODUCTION_PRESET.signalParams,
      regimeParams: PRODUCTION_PRESET.regimeParams,
      exitOnRegimeFlip: PRODUCTION_PRESET.exitOnRegimeFlip,
    };
    const res = backtestPortfolio({ dailyByAsset: { BTC: a.daily, ETH: b.daily }, weeklyByAsset: { BTC: a.weekly, ETH: b.weekly }, ...cfg });
    expect(res.openPositions.length).toBeGreaterThan(0);
    for (const pos of res.openPositions) {
      const last = (pos.asset === "BTC" ? a : b).daily.at(-1);
      const settled = res.trades.find((t) => t.asset === pos.asset && t.exitReason === "end of data");
      const m = markOpenPosition({ pos, price: last.close, feePct: cfg.feePct, slippagePct: cfg.slippagePct });
      expect(m.net).toBeCloseTo(settled.pnl, 6);
      expect(m.r).toBeCloseTo(settled.rMultiple, 9);
    }
  });

  it("charges fees and slippage, so a flat mark is a small loss", () => {
    const pos = { direction: "LONG", entry: 100, qty: 10, riskAmount: 50 };
    const m = markOpenPosition({ pos, price: 100, feePct: 0.08, slippagePct: 0.05 });
    expect(m.net).toBeLessThan(0);
    expect(m.movePct).toBe(0);
  });

  it("subtracts accrued funding and reports R against the initial risk", () => {
    const pos = { direction: "LONG", entry: 100, qty: 10, riskAmount: 50, fundingCost: 5 };
    const m = markOpenPosition({ pos, price: 110, feePct: 0, slippagePct: 0 });
    expect(m.net).toBeCloseTo(95, 9);
    expect(m.r).toBeCloseTo(1.9, 9);
    expect(m.movePct).toBeCloseTo(10, 9);
  });

  it("returns null without a usable price", () => {
    const pos = { direction: "LONG", entry: 100, qty: 1, riskAmount: 5 };
    expect(markOpenPosition({ pos, price: NaN })).toBeNull();
    expect(markOpenPosition({ pos, price: 0 })).toBeNull();
  });
});
