import { describe, it, expect } from "vitest";
import {
  relVsBtc, enrichUniverse, percentileRanks, stageOf, basketStats, altSeasonGauge,
  gateReasons, vetoReasons, scoreCoins, rankPicks, techFromDaily, isExcluded,
} from "../metrics.js";

const row = (id, sym, o = {}) => ({
  id, symbol: sym, name: id, market_cap: 1e9, market_cap_rank: 10, fully_diluted_valuation: 1.2e9,
  total_volume: 5e7, circulating_supply: 8e8, total_supply: 1e9, current_price: 1,
  price_change_percentage_7d_in_currency: 0, price_change_percentage_30d_in_currency: 0,
  price_change_percentage_200d_in_currency: 0, ...o,
});
const btc = row("bitcoin", "btc", {
  market_cap_rank: 1, price_change_percentage_7d_in_currency: 10,
  price_change_percentage_30d_in_currency: 10, price_change_percentage_200d_in_currency: 10,
});

describe("relVsBtc", () => {
  it("is zero when the coin matches BTC", () => expect(relVsBtc(10, 10)).toBeCloseTo(0));
  it("uses ratio, not difference", () => expect(relVsBtc(21, 10)).toBeCloseTo(10));
  it("passes nulls through", () => expect(relVsBtc(null, 5)).toBeNull());
});

describe("enrichUniverse", () => {
  it("computes float, FDV/MC, turnover and BTC-relative returns", () => {
    const [, c] = enrichUniverse([btc, row("x", "xx", { price_change_percentage_30d_in_currency: 32 })]);
    expect(c.float).toBeCloseTo(0.8);
    expect(c.fdvToMcap).toBeCloseTo(1.2);
    expect(c.turnover).toBeCloseTo(0.05);
    expect(c.rs30).toBeCloseTo(20);
    expect(c.symbol).toBe("XX");
  });
  it("gives a duplicated symbol only to the larger coin", () => {
    const out = enrichUniverse([btc, row("big", "dup"), row("small", "dup")]);
    expect(out[1].symbolOwner).toBe(true);
    expect(out[2].symbolOwner).toBe(false);
  });
  it("excludes stablecoins, wrapped tokens and the majors", () => {
    expect(isExcluded({ id: "tether", symbol: "usdt", name: "Tether" })).toBe(true);
    expect(isExcluded({ id: "wrapped-bitcoin", symbol: "wbtc", name: "Wrapped Bitcoin" })).toBe(true);
    expect(isExcluded({ id: "bitcoin", symbol: "btc", name: "Bitcoin" })).toBe(true);
    expect(isExcluded({ id: "quant-network", symbol: "qnt", name: "Quant" })).toBe(false);
  });
});

describe("percentileRanks", () => {
  it("ranks 0..100 and shares ties", () => {
    expect(percentileRanks([1, 2, 3])).toEqual([0, 50, 100]);
    const t = percentileRanks([1, 1, 3]);
    expect(t[0]).toBe(t[1]);
  });
  it("keeps nulls null", () => expect(percentileRanks([null, 5])).toEqual([null, 50]));
});

describe("stageOf", () => {
  it("classifies the lifecycle", () => {
    expect(stageOf({ rs7: -1, rs30: -1, rs200: 0 })).toBe("COLD");
    expect(stageOf({ rs7: 3, rs30: -1, rs200: 0 })).toBe("EMERGING");
    expect(stageOf({ rs7: 3, rs30: 5, rs200: 20 })).toBe("ACCELERATING");
    expect(stageOf({ rs7: 3, rs30: 5, rs200: 150 })).toBe("MAINSTREAM");
    expect(stageOf({ rs7: -2, rs30: 5, rs200: 20 })).toBe("EXHAUSTING");
  });
});

describe("basketStats", () => {
  const coins = enrichUniverse([
    btc,
    row("a1", "a1", { price_change_percentage_7d_in_currency: 60, price_change_percentage_30d_in_currency: 80 }),
    row("a2", "a2", { price_change_percentage_7d_in_currency: 5, price_change_percentage_30d_in_currency: 0 }),
    row("a3", "a3", { price_change_percentage_7d_in_currency: 5, price_change_percentage_30d_in_currency: 0 }),
    row("b1", "b1", { price_change_percentage_7d_in_currency: 15, price_change_percentage_30d_in_currency: 20 }),
    row("b2", "b2", { price_change_percentage_7d_in_currency: 15, price_change_percentage_30d_in_currency: 20 }),
  ]);
  const byId = new Map(coins.map((c) => [c.id, c]));
  const narratives = [
    { key: "a", name: "A", ids: ["a1", "a2", "a3", "missing-id"] },
    { key: "b", name: "B", ids: ["b1", "b2"] },
  ];
  const rows = basketStats(narratives, byId, { a: 0, b: 3 });

  it("reports unresolved ids instead of guessing", () => {
    expect(rows.find((r) => r.key === "a").missing).toEqual(["missing-id"]);
  });
  it("flags a single-coin spike (high 7d, low breadth)", () => {
    const a = rows.find((r) => r.key === "a");
    expect(a.breadth30).toBeCloseTo(33.3, 0);
    expect(a.singleCoinEvent).toBe(true);
    expect(rows.find((r) => r.key === "b").singleCoinEvent).toBe(false);
  });
  it("sorts by heat and names the leader", () => {
    expect(rows[0].heat).toBeGreaterThanOrEqual(rows[1].heat);
    expect(rows.find((r) => r.key === "a").leader.id).toBe("a1");
  });
});

describe("altSeasonGauge", () => {
  it("counts the share of alts beating BTC", () => {
    const coins = enrichUniverse([
      btc,
      row("w", "w", { market_cap_rank: 2, price_change_percentage_30d_in_currency: 50, price_change_percentage_200d_in_currency: 50 }),
      row("l", "l", { market_cap_rank: 3, price_change_percentage_30d_in_currency: 0, price_change_percentage_200d_in_currency: 0 }),
    ]);
    const g = altSeasonGauge(coins);
    expect(g.sample).toBe(2);
    expect(g.share30).toBe(50);
    expect(g.score).toBe(50);
  });
});

describe("gates and vetoes", () => {
  const [, c] = enrichUniverse([btc, row("q", "qnt")]);
  it("requires a Binance USDT pair and liquidity", () => {
    expect(gateReasons(c, new Set(["QNTUSDT"]))).toEqual([]);
    expect(gateReasons(c, new Set())).toContain("no Binance USDT pair");
    expect(gateReasons({ ...c, vol: 1e6 }, new Set(["QNTUSDT"]))).toContain("volume below $5M/day");
  });
  it("vetoes supply overhang, low float, frenzy, extension and thin books", () => {
    expect(vetoReasons({ ...c, fdvToMcap: 8 }, null, null, 1000)[0]).toMatch(/FDV/);
    expect(vetoReasons({ ...c, float: 0.1 }, null, null, 1000)[0]).toMatch(/circulating/);
    expect(vetoReasons({ ...c, turnover: 2 }, null, null, 1000)[0]).toMatch(/frenzy/);
    expect(vetoReasons(c, { atrAboveSma20: 4, ret7: 10 }, null, 1000)[0]).toMatch(/EXTENDED/);
    expect(vetoReasons(c, { atrAboveSma20: 1, ret7: 75 }, null, 1000)[0]).toMatch(/EXTENDED/);
    expect(vetoReasons(c, null, 5000, 1000)[0]).toMatch(/thin order book/);
    expect(vetoReasons(c, { atrAboveSma20: 1, ret7: 5 }, 1e6, 1000)).toEqual([]);
  });
});

describe("techFromDaily", () => {
  it("needs 55 bars and reports trend + extension", () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i }));
    expect(techFromDaily(bars.slice(0, 50))).toBeNull();
    const t = techFromDaily(bars);
    expect(t.above50).toBe(true);
    expect(t.ret7).toBeCloseTo((159 / 152 - 1) * 100);
  });
});

describe("scoreCoins and rankPicks", () => {
  const coins = enrichUniverse([
    btc,
    row("hot", "hot", { price_change_percentage_7d_in_currency: 30, price_change_percentage_30d_in_currency: 40, price_change_percentage_200d_in_currency: 50 }),
    row("cold", "cold", { price_change_percentage_7d_in_currency: -10, price_change_percentage_30d_in_currency: -20, price_change_percentage_200d_in_currency: -30 }),
  ]).slice(1);
  const scored = scoreCoins(coins, { narrativeHeatById: new Map([["hot", 80]]), trendingIds: new Set(["hot"]) });

  it("scores strength from BTC-relative momentum and adds trending/narrative heat", () => {
    const hot = scored.find((c) => c.id === "hot");
    const cold = scored.find((c) => c.id === "cold");
    expect(hot.scores.strength).toBeGreaterThan(cold.scores.strength);
    expect(hot.scores.heat).toBe(100);
    expect(cold.scores.heat).toBe(30);
  });

  it("only picks when BTC's regime is bullish and the coin clears every rule", () => {
    const withTech = scored.map((c) => ({ ...c, tech: { above50: true } }));
    const bull = rankPicks(withTech, { btcRegime: "LONG_OK" });
    expect(bull[0].id).toBe("hot");
    expect(bull[0].eligible).toBe(true);
    expect(bull.find((c) => c.id === "cold").eligible).toBe(false);
    const bear = rankPicks(withTech, { btcRegime: "SHORT_OK" });
    expect(bear.every((c) => !c.eligible)).toBe(true);
    expect(bear[0].pickFails).toContain("BTC regime not bullish");
  });

  it("rejects a coin below its 50-day average", () => {
    const below = rankPicks(scored.map((c) => ({ ...c, tech: { above50: false } })), { btcRegime: "LONG_OK" });
    expect(below.find((c) => c.id === "hot").pickFails).toContain("below its 50-day average");
  });
});
