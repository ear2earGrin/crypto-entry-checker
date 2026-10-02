import { describe, it, expect } from "vitest";
import { beforeEnd, hashData, synth } from "../data.mjs";

const DAY = 86400;

describe("beforeEnd (--to clipping)", () => {
  const to = Date.UTC(2021, 0, 1) / 1000;

  it("keeps only candles that CLOSED before the exclusive end date", () => {
    const { daily, weekly } = synth("BTC", 0);
    const d = beforeEnd(daily, to);
    expect(d.at(-1).time).toBe(to - DAY);
    expect(d.every((c) => c.closeTime < to)).toBe(true);
    // A weekly bar straddling the end date is dropped, not truncated.
    const w = beforeEnd(weekly, to);
    expect(w.every((c) => c.closeTime < to)).toBe(true);
    expect(weekly[w.length].time).toBeLessThan(to);
  });

  it("clips funding records by time and is a no-op without an end date", () => {
    const funding = [{ time: to - 1, fundingRate: 0.1 }, { time: to, fundingRate: 0.2 }];
    expect(beforeEnd(funding, to)).toEqual([funding[0]]);
    expect(beforeEnd(funding, null)).toBe(funding);
  });
});

describe("hashData", () => {
  it("is stable, asset-order independent and sensitive to any value", () => {
    const a = synth("BTC", 0), b = synth("ETH", 1.7);
    const h1 = hashData({ BTC: a, ETH: b }, { BTC: [] });
    const h2 = hashData({ ETH: b, BTC: a }, { BTC: [] });
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h2).toBe(h1);
    const changed = { ...a, daily: a.daily.map((c, i) => (i === 10 ? { ...c, close: c.close + 1e-9 } : c)) };
    expect(hashData({ BTC: changed, ETH: b }, { BTC: [] })).not.toBe(h1);
  });
});
