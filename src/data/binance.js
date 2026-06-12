const SPOT = "/binance-spot";

function tfToBinanceInterval(tf) {
  const map = {
    "5m": "5m", "15m": "15m",
    "1H": "1h", "2H": "2h", "4H": "4h", "8H": "8h", "12H": "12h",
    "1D": "1d", "3D": "3d", "1W": "1w",
  };
  return map[tf] || tf;
}

export function binanceSymbol(asset, quote = "USDT") {
  return `${asset}${quote}`.toUpperCase();
}

async function fetchJson(url) {
  const res = await fetch(url, { method: "GET" });
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();
  if (!res.ok) {
    const snippet = text.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new Error(`HTTP ${res.status} for ${url}. CT=${ct}. Body: ${snippet}`);
  }
  if (!ct.includes("application/json")) {
    const snippet = text.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new Error(`Non-JSON response for ${url}. CT=${ct}. Body: ${snippet}`);
  }
  return JSON.parse(text);
}

function toCandles(raw) {
  if (!Array.isArray(raw)) throw new Error("Klines response invalid.");
  return raw
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: Math.floor(Number(k[6]) / 1000),
    }))
    .filter(
      (c) =>
        Number.isFinite(c.time) &&
        Number.isFinite(c.open) &&
        Number.isFinite(c.high) &&
        Number.isFinite(c.low) &&
        Number.isFinite(c.close),
    );
}

export async function fetchKlines({ asset, quote = "USDT", timeframe, limit = 300 }) {
  const symbol = binanceSymbol(asset, quote);
  const interval = tfToBinanceInterval(timeframe);
  const url = `${SPOT}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const raw = await fetchJson(url);
  return toCandles(raw);
}

export function dropUnclosedCandle(candles) {
  if (candles.length === 0) return candles;
  const now = Math.floor(Date.now() / 1000);
  const last = candles[candles.length - 1];
  if (last.closeTime && last.closeTime > now) return candles.slice(0, -1);
  return candles;
}
