import { describe, it, expect } from "vitest";
import { spotJson, SPOT_HOSTS } from "../binance.js";

const reply = (status, body = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: () => "application/json" },
  text: async () => JSON.stringify(body),
});

describe("spotJson", () => {
  it("falls back to the market-data mirror on 451 and remembers it", async () => {
    const seen = [];
    const fake = async (url) => { seen.push(url); return url.startsWith(SPOT_HOSTS[0]) ? reply(451) : reply(200, { price: "1" }); };
    expect(await spotJson("/api/v3/ticker/price?symbol=BTCUSDT", fake)).toEqual({ price: "1" });
    expect(seen[1].startsWith(SPOT_HOSTS[1])).toBe(true);
    seen.length = 0;
    await spotJson("/api/v3/ticker/price?symbol=BTCUSDT", fake);
    expect(seen).toEqual([`${SPOT_HOSTS[1]}/api/v3/ticker/price?symbol=BTCUSDT`]);
  });

  it("tries the next host when the request itself fails (network or CORS)", async () => {
    let n = 0;
    const fake = async () => { n++; if (n === 1) throw new TypeError("Failed to fetch"); return reply(200, [1]); };
    expect(await spotJson("/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=1", fake)).toEqual([1]);
  });

  it("reports ordinary errors instead of hiding them", async () => {
    await expect(spotJson("/api/v3/klines?symbol=NOPE", async () => reply(400, { msg: "Invalid symbol" }))).rejects.toThrow(/400/);
  });
});
