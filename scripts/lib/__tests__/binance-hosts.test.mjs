import { describe, it, expect } from "vitest";
import { binanceGet, BINANCE_HOSTS } from "../data.mjs";

const reply = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

describe("binanceGet host fallback", () => {
  it("falls back to the market-data mirror when the main host answers 451", async () => {
    const seen = [];
    const fake = async (url) => {
      seen.push(url);
      return url.startsWith(BINANCE_HOSTS[0]) ? reply(451) : reply(200, { ok: 1 });
    };
    expect(await binanceGet("/api/v3/ping", fake)).toEqual({ ok: 1 });
    expect(seen[1].startsWith(BINANCE_HOSTS[1])).toBe(true);
    // the working host is remembered for the next call
    seen.length = 0;
    await binanceGet("/api/v3/ping", fake);
    expect(seen).toHaveLength(1);
    expect(seen[0].startsWith(BINANCE_HOSTS[1])).toBe(true);
  });

  it("throws the block error when every host refuses", async () => {
    await expect(binanceGet("/api/v3/ping", async () => reply(451))).rejects.toThrow(/451/);
  });

  it("does not hide ordinary errors behind the fallback", async () => {
    await expect(binanceGet("/api/v3/klines?symbol=NOPE", async () => reply(400, { msg: "Invalid symbol" }))).rejects.toThrow(/400/);
  });
});
