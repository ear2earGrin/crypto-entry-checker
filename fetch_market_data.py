#!/usr/bin/env python3
"""Snapshot Binance's public market-data archive for the strategy audit.

Runs on a GitHub Actions runner (the audit sandbox cannot reach Binance).
Everything comes from data.binance.vision, Binance's public archive, which
keeps DELISTED symbols too (LUNA, FTT, ...), so a backtest can include the coins
that died instead of only today's survivors.

Output (one gzip JSON per symbol, compact rows):
  out/spot-1d/<SYMBOL>.json.gz   rows [openTimeSec, open, high, low, close, volume, quoteVolume, takerBuyBase]
  out/spot-1w/<SYMBOL>.json.gz   same, weekly — only for the strategy universe (cross-check for derived weeks)
  out/funding/<SYMBOL>.json.gz   rows [fundingTimeSec, rate]  (USDT-M perpetuals)
  out/MANIFEST.json              per-symbol coverage + sha256

Archive files switched to MICROSECOND timestamps from 2025-01; normalised here.
The current, not-yet-archived month comes from data-api.binance.vision (spot)
and fapi.binance.com (funding, best effort — may be geo-restricted on the runner).
"""
import concurrent.futures as cf
import csv
import gzip
import hashlib
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

BUCKET = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
ARCHIVE = "https://data.binance.vision"
SPOT_API = "https://data-api.binance.vision/api/v3/klines"
FAPI = "https://fapi.binance.com/fapi/v1/fundingRate"
UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"]

# Not tradable risk assets for a trend system: stablecoins, fiat, pegged/wrapped
# tokens and Binance's leveraged tokens.
STABLE_OR_FIAT = {
    "USDC", "BUSD", "TUSD", "USDP", "PAX", "DAI", "FDUSD", "UST", "USTC", "USDS", "USDSB", "SUSD",
    "EUR", "GBP", "AUD", "TRY", "BRL", "RUB", "UAH", "NGN", "BIDR", "IDRT", "BVND", "ZAR", "JPY",
    "AEUR", "EURI", "USDE", "XUSD", "PAXG", "WBTC", "WBETH", "BETH", "BKRW", "USD1", "RLUSD",
}
LEVERAGED_SUFFIX = re.compile(r"^(.+?)(UP|DOWN|BULL|BEAR)$")


def is_leveraged(base, all_bases):
    """BTCUP / ETHDOWN / BNBBULL: a listed coin plus a leveraged suffix.
    Real coins that merely end in those letters (JUP, SYRUP) are kept."""
    m = LEVERAGED_SUFFIX.match(base)
    return bool(m) and m.group(1) in all_bases

S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"


def get(url, tries=5):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404, 451, 403):
                return None
            if k == tries - 1:
                raise
        except Exception:
            if k == tries - 1:
                raise
        time.sleep(2 * (k + 1))
    return None


def s3_list(prefix, delimiter=True):
    """All keys (or common prefixes) under prefix, following pagination."""
    out, marker = [], ""
    while True:
        q = {"prefix": prefix, "marker": marker}
        if delimiter:
            q["delimiter"] = "/"
        root = ET.fromstring(get(f"{BUCKET}?{urllib.parse.urlencode(q)}"))
        if delimiter:
            items = [p.find(f"{S3_NS}Prefix").text for p in root.findall(f"{S3_NS}CommonPrefixes")]
        else:
            items = [c.find(f"{S3_NS}Key").text for c in root.findall(f"{S3_NS}Contents")]
        out += items
        truncated = root.find(f"{S3_NS}IsTruncated").text == "true"
        if not truncated or not items:
            return out
        nxt = root.find(f"{S3_NS}NextMarker")
        marker = nxt.text if nxt is not None else items[-1]


def to_sec(t):
    t = int(float(t))
    if t > 10**14:  # microseconds
        t //= 1000
    return t // 1000


def read_zip_rows(blob):
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        return list(csv.reader(io.StringIO(z.read(z.namelist()[0]).decode())))


def kline_row(k):
    return [to_sec(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5]), float(k[7]), float(k[9])]


def is_num(s):
    return bool(s) and str(s).strip().lstrip("-").isdigit()


def spot_klines(sym, interval):
    keys = [k for k in s3_list(f"data/spot/monthly/klines/{sym}/{interval}/", delimiter=False) if k.endswith(".zip")]
    rows = []
    for k in keys:
        blob = get(f"{ARCHIVE}/{k}")
        if blob:
            rows += [kline_row(r) for r in read_zip_rows(blob) if r and is_num(r[0])]
    # Current month (and anything after the last archived file) from the live API.
    if rows:
        cursor = (rows[-1][0] + 1) * 1000
        for _ in range(5):
            blob = get(f"{SPOT_API}?symbol={sym}&interval={interval}&startTime={cursor}&limit=1000")
            batch = json.loads(blob) if blob else []
            if not batch:
                break
            rows += [kline_row(k) for k in batch]
            if len(batch) < 1000:
                break
            cursor = int(batch[-1][6]) + 1
    seen, out = set(), []
    for r in sorted(rows, key=lambda r: r[0]):
        if r[0] not in seen:
            seen.add(r[0])
            out.append(r)
    return out


def funding(sym):
    keys = [k for k in s3_list(f"data/futures/um/monthly/fundingRate/{sym}/", delimiter=False) if k.endswith(".zip")]
    rows = []
    for k in keys:
        blob = get(f"{ARCHIVE}/{k}")
        if blob:
            rows += [[to_sec(r[0]), float(r[2])] for r in read_zip_rows(blob) if r and is_num(r[0])]
    if rows:
        blob = get(f"{FAPI}?symbol={sym}&startTime={(rows[-1][0] + 1) * 1000}&limit=1000")
        if blob:
            rows += [[to_sec(r["fundingTime"]), float(r["fundingRate"])] for r in json.loads(blob)]
    return sorted({r[0]: r for r in rows}.values())


def write(path, rows):
    blob = gzip.compress(json.dumps(rows, separators=(",", ":")).encode(), mtime=0)
    with open(path, "wb") as fh:
        fh.write(blob)
    return hashlib.sha256(blob).hexdigest()[:16]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "out"
    for d in ("spot-1d", "spot-1w", "funding"):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    now = datetime.now(timezone.utc)

    spot_syms = sorted({p.rstrip("/").split("/")[-1] for p in s3_list("data/spot/monthly/klines/")})
    usdt = [s for s in spot_syms if s.endswith("USDT")]
    bases = [s[:-4] for s in usdt]
    base_set = set(bases)
    keep = [b for b in bases if b and b not in STABLE_OR_FIAT and not is_leveraged(b, base_set)]
    perp_syms = {p.rstrip("/").split("/")[-1] for p in s3_list("data/futures/um/monthly/fundingRate/")}
    print(f"archive: {len(spot_syms)} spot symbols, {len(usdt)} USDT pairs, {len(keep)} kept; {len(perp_syms)} perps with funding", flush=True)

    manifest = {"fetchedAt": now.isoformat(), "source": "data.binance.vision (+ data-api.binance.vision, fapi.binance.com for the current month)",
                "excluded": sorted(set(bases) - set(keep)), "symbols": {}}

    def do(base):
        sym = f"{base}USDT"
        rec = {}
        d = spot_klines(sym, "1d")
        if d:
            rec["daily"] = {"rows": len(d), "first": d[0][0], "last": d[-1][0], "sha": write(os.path.join(out, "spot-1d", f"{sym}.json.gz"), d)}
        if base in UNIVERSE:
            w = spot_klines(sym, "1w")
            if w:
                rec["weekly"] = {"rows": len(w), "first": w[0][0], "last": w[-1][0], "sha": write(os.path.join(out, "spot-1w", f"{sym}.json.gz"), w)}
        if sym in perp_syms:
            f = funding(sym)
            if f:
                rec["funding"] = {"rows": len(f), "first": f[0][0], "last": f[-1][0], "sha": write(os.path.join(out, "funding", f"{sym}.json.gz"), f)}
        return base, rec

    with cf.ThreadPoolExecutor(24) as ex:
        for i, (base, rec) in enumerate(ex.map(do, keep), 1):
            manifest["symbols"][base] = rec
            if i % 25 == 0 or base in UNIVERSE:
                print(f"{i}/{len(keep)} {base}: {json.dumps(rec)}", flush=True)

    with open(os.path.join(out, "MANIFEST.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, sort_keys=True)
    missing = [b for b in UNIVERSE if "daily" not in manifest["symbols"].get(b, {})]
    if missing:
        sys.exit(f"universe symbols missing daily data: {missing}")
    print("done", flush=True)


if __name__ == "__main__":
    main()
