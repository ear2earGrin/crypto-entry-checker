#!/usr/bin/env python3
"""Daily USD candles from Bitfinex's public API, for the audit's pre-2020 holdout.

Bitfinex has multi-coin USD markets back to 2013-2016 (BTC, LTC, ETH, ETC, XMR,
ZEC, DASH, XRP, EOS, IOTA, NEO, ...), i.e. one more full crypto boom-bust cycle
(2014 bear, 2016-17 bubble, 2018 crash) than Binance's archive, which starts in
mid-2017. Runs on a GitHub Actions runner; public data, no keys.

Output:
  out/bitfinex-1d/<PAIR>.json.gz   rows [openTimeSec, open, high, low, close, volume(base)]
  out/MANIFEST.json                coverage + sha256 per pair

Candle API row order is [MTS, OPEN, CLOSE, HIGH, LOW, VOLUME]; reordered here
to OHLC. Public candle endpoints allow ~30 requests/minute, so requests are
paced at one every 2.2 s.
"""
import gzip
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://api-pub.bitfinex.com/v2"
PACE = 2.2

# Majors that traded on Bitfinex before 2020 and may since have been delisted
# (the live pair list only shows current markets). Missing ones just return [].
HISTORICAL = [
    "BTCUSD", "LTCUSD", "ETHUSD", "ETCUSD", "XMRUSD", "ZECUSD", "DSHUSD", "XRPUSD", "EOSUSD",
    "IOTUSD", "NEOUSD", "OMGUSD", "BCHUSD", "BABUSD", "BSVUSD", "BTGUSD", "ETPUSD", "QTMUSD",
    "SANUSD", "EDOUSD", "AVTUSD", "RRTUSD", "XLMUSD", "TRXUSD", "XTZUSD", "ZRXUSD", "BATUSD",
    "ELFUSD", "GNTUSD", "SNTUSD", "DATUSD", "QSHUSD", "YYWUSD", "FUNUSD", "MNAUSD", "TNBUSD",
    "SPKUSD", "RCNUSD", "REPUSD", "LRCUSD", "VETUSD", "ADAUSD", "IOSUSD", "AIDUSD", "SNGUSD",
    "LEOUSD", "DGBUSD", "BNTUSD", "WAXUSD", "ODEUSD", "UTKUSD", "ESSUSD", "ATMUSD", "ALGUSD",
]
STABLE = {"UST", "USDC", "USDT", "TUSD", "DAI", "PAX", "GUSD", "EUT", "XAUT", "EUR", "GBP", "JPY", "CNHT", "MIM", "UDC", "TSD"}


# Bitfinex sits behind Cloudflare, which rejects Python's default User-Agent.
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) crypto-entry-checker-audit/1.0", "Accept": "application/json"}
ERRORS = {}


def get_json(url, tries=6):
    for k in range(tries):
        try:
            req = urllib.request.Request(urllib.parse.quote(url, safe=":/?&=%"), headers=HEADERS)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read()[:200]
            if len(ERRORS) < 5:
                print(f"HTTP {e.code} for {url}: {body!r}", flush=True)
            ERRORS[e.code] = ERRORS.get(e.code, 0) + 1
            if e.code == 429 or e.code >= 500:
                time.sleep(30 * (k + 1))
                continue
            return None
        except Exception:
            if k == tries - 1:
                raise
            time.sleep(5 * (k + 1))
    return None


def candles(pair):
    """All daily candles for a pair, oldest first (paging forward by start time)."""
    out, start = [], 0
    for _ in range(10):
        rows = get_json(f"{API}/candles/trade:1D:t{pair}/hist?limit=10000&sort=1&start={start}")
        time.sleep(PACE)
        if not rows or not isinstance(rows, list) or not isinstance(rows[0], list):
            break
        out += rows
        if len(rows) < 10000:
            break
        start = rows[-1][0] + 1
    seen, clean = set(), []
    for r in sorted(out, key=lambda r: r[0]):
        if r[0] in seen:
            continue
        seen.add(r[0])
        mts, o, c, h, l, v = r[:6]
        clean.append([mts // 1000, float(o), float(h), float(l), float(c), float(v)])
    return clean


def base_of(pair):
    return pair.split(":")[0] if ":" in pair else pair[:-3]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    os.makedirs(os.path.join(out, "bitfinex-1d"), exist_ok=True)
    listed = get_json(f"{API}/conf/pub:list:pair:exchange") or [[]]
    probe = get_json(f"{API}/candles/trade:1D:tBTCUSD/hist?limit=3&sort=1&start=0")
    print(f"probe BTCUSD first candles: {probe}", flush=True)
    if not probe:
        sys.exit("Bitfinex API unreachable from this runner (see HTTP errors above)")
    usd = [p for p in listed[0] if p.endswith("USD") or p.endswith(":USD")]
    pairs = sorted({p for p in usd + HISTORICAL if base_of(p) not in STABLE})
    print(f"{len(usd)} listed USD pairs, {len(pairs)} to fetch incl. historical majors", flush=True)
    manifest = {"fetchedAt": datetime.now(timezone.utc).isoformat(), "source": "api-pub.bitfinex.com v2 candles 1D", "pairs": {}}
    for i, p in enumerate(pairs, 1):
        try:
            rows = candles(p)
        except Exception as e:  # noqa: BLE001
            manifest["pairs"][p] = {"error": f"{type(e).__name__}: {e}"[:200]}
            continue
        if not rows:
            continue
        blob = gzip.compress(json.dumps(rows, separators=(",", ":")).encode(), mtime=0)
        with open(os.path.join(out, "bitfinex-1d", f"{p.replace(':', '_')}.json.gz"), "wb") as fh:
            fh.write(blob)
        manifest["pairs"][p] = {"rows": len(rows), "first": rows[0][0], "last": rows[-1][0], "sha": hashlib.sha256(blob).hexdigest()[:16]}
        if i % 20 == 0 or p in ("BTCUSD", "ETHUSD", "LTCUSD", "XRPUSD"):
            print(f"{i}/{len(pairs)} {p} {manifest['pairs'][p]}", flush=True)
    with open(os.path.join(out, "MANIFEST.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, sort_keys=True)
    print(f"HTTP errors by status: {ERRORS}", flush=True)
    if "BTCUSD" not in manifest["pairs"] or "error" in manifest["pairs"]["BTCUSD"]:
        sys.exit("BTCUSD missing")
    print("done", flush=True)


if __name__ == "__main__":
    main()
