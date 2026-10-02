import { describe, it, expect } from "vitest";
import { withOpenOnlyFormingBar, todaysOrders, scaleToAccount, paperEpochSec } from "../paperReplay.js";

const DAY = 86400;

describe("withOpenOnlyFormingBar", () => {
  it("turns the forming candle into an open-only bar and leaves closed bars alone", () => {
    const closed = [{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5 }];
    const raw = [...closed, { time: DAY, closeTime: 2 * DAY - 1, open: 1.6, high: 9, low: 0.1, close: 3 }];
    const out = withOpenOnlyFormingBar(raw, closed);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(closed[0]);
    expect(out[1]).toMatchObject({ time: DAY, open: 1.6, high: 1.6, low: 1.6, close: 1.6 });
  });
  it("returns the closed bars unchanged when nothing is forming", () => {
    const closed = [{ time: 0, open: 1, high: 1, low: 1, close: 1 }];
    expect(withOpenOnlyFormingBar(closed, closed)).toBe(closed);
  });
});

describe("todaysOrders", () => {
  const epochSec = paperEpochSec("2026-07-18");
  const today = epochSec + 80 * DAY;
  const res = {
    openPositions: [
      { asset: "SOL", entryTime: today - 10 * DAY, entry: 100, stop: 95, initialStop: 90, qty: 10, riskAmount: 100 },
      { asset: "LINK", entryTime: today, entry: 14, stop: 12.5, initialStop: 12.5, qty: 600, riskAmount: 900 },
      { asset: "BTC", entryTime: epochSec - 5 * DAY, entry: 1, stop: 1, initialStop: 1, qty: 1, riskAmount: 1 }, // pre-epoch: hidden
    ],
    trades: [
      { asset: "AVAX", entryTime: today - 20 * DAY, exitTime: today - DAY, exitReason: "trailing stop hit" },
      { asset: "ADA", entryTime: today - 30 * DAY, exitTime: today - 3 * DAY, exitReason: "trailing stop hit" },
      { asset: "DOGE", entryTime: today - 2 * DAY, exitTime: today, exitReason: "end of data" },
    ],
  };
  const o = todaysOrders({ res, epochSec, todayTime: today });

  it("buys = positions the engine opened at today's open", () => {
    expect(o.buys.map((p) => p.asset)).toEqual(["LINK"]);
  });
  it("stops = every open position since the epoch, flagging new ones", () => {
    expect(o.stops.map((s) => [s.asset, s.stop, s.isNew])).toEqual([["SOL", 95, false], ["LINK", 12.5, true]]);
  });
  it("stoppedOut = trades closed on yesterday's bar, never end-of-data marks", () => {
    expect(o.stoppedOut.map((t) => t.asset)).toEqual(["AVAX"]);
  });
});

describe("scaleToAccount", () => {
  it("scales quantity by your dollar risk over the paper position's", () => {
    // paper risked 1000 on 10 units; you risk 0.35% of 50k = 175 → 1.75 units
    expect(scaleToAccount({ qty: 10, riskAmount: 1000 }, { equity: 50000, riskPct: 0.35 })).toBeCloseTo(1.75, 12);
  });
  it("returns null on bad inputs", () => {
    expect(scaleToAccount({ qty: 10, riskAmount: 0 }, { equity: 50000, riskPct: 0.35 })).toBeNull();
    expect(scaleToAccount({ qty: 10, riskAmount: 1000 }, { equity: 0, riskPct: 0.35 })).toBeNull();
  });
});
