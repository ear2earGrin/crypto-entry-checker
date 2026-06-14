// Shared data loader for the Node harnesses (backtest.mjs, ablation.mjs).
// Hits api.binance.com directly — Node has no CORS, so no proxy is needed.

export const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const BINANCE = "https://api.binance.com";

function toCandles(raw) {
  return raw
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Math.floor(Number(k[6]) / 1000),
      takerBuyBase: Number(k[9]),
    }))
    .filter((c) => Number.isFinite(c.close));
}

async function fetchKlinesRange(symbol, interval, startMs, endMs = Date.now()) {
  const all = [];
  let cursor = startMs;
  for (let guard = 0; guard < 80; guard++) {
    const url = `${BINANCE}/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${cursor}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}: ${(await res.text()).slice(0, 120)}`);
    const batch = toCandles(await res.json());
    if (batch.length === 0) break;
    all.push(...batch);
    const lastMs = (batch[batch.length - 1].closeTime || batch[batch.length - 1].time) * 1000;
    if (batch.length < 1000 || lastMs >= endMs) break;
    cursor = lastMs + 1;
  }
  const seen = new Set();
  return all.filter((c) => (seen.has(c.time) ? false : (seen.add(c.time), true)));
}

function dropUnclosed(candles) {
  if (!candles.length) return candles;
  const now = Math.floor(Date.now() / 1000);
  const last = candles[candles.length - 1];
  return last.closeTime && last.closeTime > now ? candles.slice(0, -1) : candles;
}

export async function loadAsset(asset, fromYear) {
  const symbol = `${asset}USDT`;
  const start = Date.UTC(fromYear, 0, 1);
  const weeklyStart = start - 55 * 7 * 86400 * 1000; // warm the 50W SMA
  const [weekly, daily] = await Promise.all([
    fetchKlinesRange(symbol, "1w", weeklyStart),
    fetchKlinesRange(symbol, "1d", start),
  ]);
  return { weekly: dropUnclosed(weekly), daily: dropUnclosed(daily) };
}

// Synthetic data for --selftest (no network). Numbers are meaningless; this only
// proves the pipeline runs end to end.
export function synth(asset, seed, dn = 1500) {
  const ONE_DAY = 86400, ONE_WEEK = ONE_DAY * 7;
  const wn = Math.ceil(dn / 6.5);
  const wk = Array.from({ length: wn }, (_, i) => 100 + i * 2 + Math.sin(i / 4 + seed) * 9);
  const dl = Array.from({ length: dn }, (_, i) => 100 + i * 0.3 + Math.sin(i / 12 + seed) * 13);
  const t0 = Date.UTC(2020, 0, 1);
  const mk = (arr, step, base) => arr.map((c, i) => ({
    time: base + i * step, closeTime: base + (i + 1) * step - 1,
    open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1000, takerBuyBase: 550,
  }));
  return { weekly: mk(wk, ONE_WEEK, t0), daily: mk(dl, ONE_DAY, t0) };
}

export const f = (n, d = 2) => (Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: d }) : "-");
export const pct = (n, d = 1) => (Number.isFinite(n) ? `${n.toFixed(d)}%` : "-");
