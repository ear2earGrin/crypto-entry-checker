import { describe, it, expect } from "vitest";
import { newBook, initialStop, openBlockers, openPosition, updatePosition, closePosition, bookSummary } from "../book.js";
import { BOOK } from "../config.js";

const DAY = 86400;
const T0 = 1_780_000_000 - (1_780_000_000 % DAY);

function bars(closes, start = T0) {
  return closes.map((c, i) => ({ time: start + i * DAY, open: c, high: c * 1.01, low: c * 0.99, close: c }));
}
const rising = bars(Array.from({ length: 40 }, (_, i) => 100 + i));
const coin = { id: "foo", symbol: "FOO", name: "Foo" };
const formingTime = T0 + 40 * DAY;

function opened() {
  const book = newBook(BOOK, "2026-09-29T00:00:00Z");
  const pos = openPosition(book, { coin, closedDaily: rising, formingOpen: 140, formingTime, btcPrice: 80000, todayKey: "2026-09-29", reason: "test" });
  return { book, pos };
}

describe("openPosition", () => {
  it("spends the test amount plus fee and sets a stop below entry", () => {
    const { book, pos } = opened();
    expect(pos.notional).toBe(BOOK.testAmount);
    expect(pos.entry).toBeCloseTo(140 * 1.001);
    expect(pos.qty * pos.entry).toBeCloseTo(BOOK.testAmount);
    expect(book.cash).toBeCloseTo(BOOK.startCash - BOOK.testAmount - BOOK.testAmount * 0.001);
    expect(pos.stop).toBeLessThan(pos.entry);
    expect(pos.stop).toBe(pos.initialStop);
  });

  it("uses the closer of the ATR stop and the 10-day close-low", () => {
    // Calm bars: ATR ≈ 2.5, so entry − 2.5×ATR (≈133.6) is closer than the 10-day low (130).
    const calm = initialStop(rising, 140, BOOK);
    expect(calm).toBeGreaterThan(130);
    expect(calm).toBeLessThan(140);
    // Wild bars: ATR is huge, so the 10-day close-low (130) is the closer stop.
    const wild = rising.map((b) => ({ ...b, high: b.close * 1.3, low: b.close * 0.7 }));
    expect(initialStop(wild, 140, BOOK)).toBeCloseTo(130);
  });
});

describe("openBlockers", () => {
  it("enforces one pick per day, max open, duplicates and cooldown", () => {
    const { book } = opened();
    expect(openBlockers(book, "bar", "2026-09-29", formingTime)).toContain("already picked today");
    expect(openBlockers(book, "foo", "2026-09-30", formingTime + DAY)).toContain("already holding");
    expect(openBlockers(book, "bar", "2026-09-30", formingTime + DAY)).toEqual([]);
    book.closed.push({ id: "baz", exitTime: formingTime });
    expect(openBlockers(book, "baz", "2026-09-30", formingTime + 5 * DAY)[0]).toMatch(/cooldown/);
    expect(openBlockers(book, "baz", "2026-10-30", formingTime + 20 * DAY)).toEqual([]);
  });
});

describe("updatePosition", () => {
  it("trails the stop up on closes and is idempotent", () => {
    const { pos } = opened();
    const after = [...rising, ...bars([141, 150, 160, 170, 180, 190, 200, 210, 220, 230, 240], formingTime)];
    const r1 = updatePosition(pos, after, BOOK);
    expect(r1.exited).toBe(false);
    expect(r1.stopRaised).toBe(true);
    const stop = pos.stop;
    const r2 = updatePosition(pos, after, BOOK);
    expect(r2.stopRaised).toBe(false);
    expect(pos.stop).toBe(stop);
  });

  it("exits at the stop when the low touches it", () => {
    const { pos } = opened();
    const day = { time: formingTime, open: 139, high: 140, low: pos.stop - 1, close: 135 };
    const r = updatePosition(pos, [...rising, day], BOOK);
    expect(r.exited).toBe(true);
    expect(pos.exitReason).toBe("stop hit");
    expect(pos.exit).toBeCloseTo(pos.stop * 0.999);
  });

  it("fills at the open when the day gaps below the stop", () => {
    const { pos } = opened();
    const gap = { time: formingTime, open: pos.stop - 5, high: pos.stop - 4, low: pos.stop - 8, close: pos.stop - 6 };
    updatePosition(pos, [...rising, gap], BOOK);
    expect(pos.exitReason).toBe("gapped through stop");
    expect(pos.exit).toBeCloseTo((pos.initialStop - 5) * 0.999);
  });
});

describe("closePosition and bookSummary", () => {
  it("books P&L, R-multiple and the BTC comparison", () => {
    const { book, pos } = opened();
    pos.exit = pos.entry * 1.2;
    pos.exitTime = formingTime + 10 * DAY;
    const t = closePosition(book, pos, 84000, BOOK);
    expect(t.retPct).toBeGreaterThan(19);
    expect(t.btcRetPct).toBeCloseTo(5);
    expect(t.vsBtcPct).toBeCloseTo(t.retPct - 5);
    expect(t.r).toBeGreaterThan(0);
    expect(book.open).toHaveLength(0);
    const s = bookSummary(book, {}, 84000);
    expect(s.stats.trades).toBe(1);
    expect(s.stats.beatBtcRate).toBe(100);
    expect(s.equity).toBeCloseTo(book.cash);
  });
});
