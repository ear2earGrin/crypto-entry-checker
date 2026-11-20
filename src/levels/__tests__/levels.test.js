import { describe, it, expect } from "vitest";
import { findPivots, clusterZones, computeLevels, suggestStops, defaultStop, planTakeProfits, pricePrecision } from "../levels.js";

const DAY = 86400;
const bar = (i, high, low, close = (high + low) / 2) => ({ time: 1_700_000_000 + i * DAY, open: close, high, low, close });

describe("findPivots", () => {
  it("finds a swing high and a swing low", () => {
    const c = [bar(0, 10, 9), bar(1, 11, 10), bar(2, 15, 12), bar(3, 12, 10), bar(4, 11, 8), bar(5, 12, 9), bar(6, 13, 10)];
    const p = findPivots(c, 2);
    expect(p).toContainEqual(expect.objectContaining({ type: "high", price: 15 }));
    expect(p).toContainEqual(expect.objectContaining({ type: "low", price: 8 }));
  });

  it("does not confirm a pivot without enough bars on the right", () => {
    const c = [bar(0, 10, 9), bar(1, 11, 10), bar(2, 12, 11), bar(3, 20, 12)];
    expect(findPivots(c, 2).find((p) => p.price === 20)).toBeUndefined();
  });

  it("counts an exact double top once per bar, not twice for one bar", () => {
    const c = [bar(0, 10, 9), bar(1, 15, 12), bar(2, 15, 12), bar(3, 10, 9), bar(4, 9, 8)];
    expect(findPivots(c, 1).filter((p) => p.type === "high")).toHaveLength(1);
  });
});

describe("clusterZones", () => {
  it("merges nearby pivots and keeps distant ones apart", () => {
    const z = clusterZones([{ price: 100 }, { price: 100.5 }, { price: 101 }, { price: 110 }], 1.5);
    expect(z).toHaveLength(2);
    expect(z[0].pivots).toHaveLength(3);
    expect(z[0].low).toBe(100);
    expect(z[0].high).toBe(101);
  });
});

// A market that ranges between ~90 and ~110 for a year, then sits at 100.
function rangeMarket() {
  const daily = [];
  for (let i = 0; i < 400; i++) {
    const phase = Math.sin((i / 40) * Math.PI); // ±1 every 80 days
    const mid = 100 + phase * 10;
    daily.push(bar(i, mid + 1, mid - 1, mid));
  }
  const weekly = [];
  for (let w = 0; w + 7 <= daily.length; w += 7) {
    const chunk = daily.slice(w, w + 7);
    weekly.push({ time: chunk[0].time, open: chunk[0].open, close: chunk.at(-1).close,
      high: Math.max(...chunk.map((c) => c.high)), low: Math.min(...chunk.map((c) => c.low)) });
  }
  return { daily, weekly };
}

describe("computeLevels", () => {
  const { daily, weekly } = rangeMarket();
  const nowSec = daily.at(-1).time;
  const lv = computeLevels({ daily, weekly, price: 100, nowSec });

  it("finds resistance near the range top and support near the range bottom", () => {
    expect(lv.resistances[0].low).toBeGreaterThan(105);
    expect(lv.resistances[0].low).toBeLessThan(112);
    expect(lv.supports[0].high).toBeLessThan(95);
    expect(lv.supports[0].high).toBeGreaterThan(88);
  });

  it("orders levels nearest first and scores them 0-100", () => {
    for (let i = 1; i < lv.supports.length; i++) expect(lv.supports[i].edge).toBeLessThanOrEqual(lv.supports[i - 1].edge);
    for (let i = 1; i < lv.resistances.length; i++) expect(lv.resistances[i].edge).toBeGreaterThanOrEqual(lv.resistances[i - 1].edge);
    for (const z of [...lv.supports, ...lv.resistances]) {
      expect(z.strength).toBeGreaterThanOrEqual(0);
      expect(z.strength).toBeLessThanOrEqual(100);
      expect(z.touches).toBeGreaterThanOrEqual(1);
    }
  });

  it("reports price discovery when nothing is above", () => {
    const top = computeLevels({ daily, weekly, price: 500, nowSec });
    expect(top.resistances).toHaveLength(0);
    expect(top.priceDiscovery).toBe(true);
  });

  it("returns the system's reference lines", () => {
    expect(lv.refs.trail10).toBeLessThan(lv.refs.breakout20);
    expect(lv.refs.sma50w).toBeGreaterThan(90);
    expect(lv.refs.sma50w).toBeLessThan(110);
  });
});

describe("suggestStops and planTakeProfits", () => {
  const levels = {
    atr: 2,
    priceDiscovery: false,
    supports: [{ low: 88, high: 90, touches: 4, weeklyTouches: 1 }],
    resistances: [
      { low: 104, high: 105, touches: 3, weeklyTouches: 0 },
      { low: 120, high: 122, touches: 5, weeklyTouches: 2 },
    ],
    refs: { trail10: 93 },
  };

  it("suggests support, 10-day and ATR stops and flags unusable ones", () => {
    const s = suggestStops(levels, 100);
    expect(s.map((x) => x.price)).toEqual([87, 93, 95]);
    expect(s[0].tooWide).toBe(true);   // 13 away > 4 ATR (8)
    expect(s[1].tooTight).toBe(false); // 7 away
    expect(defaultStop(s).price).toBe(93);
  });

  it("falls back to the ATR stop when the only other one is too tight", () => {
    const s = suggestStops({ ...levels, supports: [], refs: { trail10: 99.5 } }, 100);
    expect(s[0].tooTight).toBe(true);
    expect(defaultStop(s).price).toBe(95);
  });

  it("picks sensible price precision", () => {
    expect(pricePrecision(65000)).toBe(0);
    expect(pricePrecision(140)).toBe(2);
    expect(pricePrecision(0.5)).toBe(4);
    expect(pricePrecision(0.00001234)).toBe(8);
  });

  it("skips a resistance that pays less than 1.5R and targets the next one", () => {
    // entry 100, stop 95 → R = 5. Resistance at 104 pays 0.8R (warned, skipped);
    // the one at 120 pays (119.6 − 100)/5 = 3.9R.
    const plan = planTakeProfits({ entry: 100, stop: 95, levels });
    expect(plan.warnings[0]).toMatch(/only 0\.8R/);
    expect(plan.targets[0].price).toBeCloseTo(119.6);
    expect(plan.targets[0].note).toMatch(/120/);
    expect(plan.targets[1].price).toBeGreaterThan(plan.targets[0].price);
    expect(plan.targets[2].name).toBe("Runner");
  });

  it("uses the first resistance as TP1 when it pays enough", () => {
    const plan = planTakeProfits({ entry: 100, stop: 98, levels }); // R = 2 → 104 pays 1.8R
    expect(plan.warnings).toHaveLength(0);
    expect(plan.targets[0].price).toBeCloseTo(103.6);
    expect(plan.targets[1].note).toMatch(/120/);
  });

  it("falls back to R-multiples in price discovery", () => {
    const open = { ...levels, resistances: [], priceDiscovery: true };
    const plan = planTakeProfits({ entry: 100, stop: 95, levels: open });
    expect(plan.targets[0].price).toBe(110);
    expect(plan.targets[1].price).toBe(115);
    expect(plan.targets[0].note).toMatch(/price discovery/);
  });

  it("flags R-multiple targets that sit beyond a resistance", () => {
    const plan = planTakeProfits({ entry: 100, stop: 95, levels });
    // 1R = 105 is beyond the 104 resistance; nothing below 104 would be clear.
    expect(plan.rTargets[0].blockedBy.low).toBe(104);
    const tight = planTakeProfits({ entry: 100, stop: 99, levels }); // 1R = 101
    expect(tight.rTargets[0].blockedBy).toBeNull();
  });

  it("rejects a stop above the entry", () => {
    expect(planTakeProfits({ entry: 100, stop: 101, levels }).error).toMatch(/below the entry/);
  });
});
