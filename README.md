# Bitfinex daily history for the strategy audit

`.github/workflows/bitfinex-data.yml` runs `fetch_bitfinex.py` on a GitHub
runner and force-pushes daily USD candles to the **`market-data-bitfinex`**
branch (`bitfinex-1d/<PAIR>.json.gz`, rows `[openTimeSec, open, high, low,
close, volumeBase]`, plus `MANIFEST.json`).

Why: the audit needs crypto history the strategy was never tuned on. Binance's
archive starts in mid-2017; Bitfinex reaches back to 2013 (BTC, LTC) and 2016
(ETH, ETC, XMR, ZEC, DASH, ...), covering the 2014 bear market, the 2017 bubble
and the 2018 crash. Public data, no keys. Safe to delete both branches after
the audit.
