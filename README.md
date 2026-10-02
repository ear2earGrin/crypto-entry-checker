# Market-data snapshot for the strategy audit

`.github/workflows/market-data.yml` runs `fetch_market_data.py` on a GitHub
runner and force-pushes the result to the **`market-data`** branch:

- `spot-1d/<SYMBOL>.json.gz`: daily klines for every USDT spot pair in Binance's
  public archive (data.binance.vision), **including delisted coins**, minus
  stablecoins, fiat and leveraged tokens. Rows:
  `[openTimeSec, open, high, low, close, volume, quoteVolume, takerBuyBase]`
- `spot-1w/<SYMBOL>.json.gz`: weekly klines for the 9-coin strategy universe
  (to cross-check weeks derived from dailies)
- `funding/<SYMBOL>.json.gz`: USDT-M perpetual funding history `[timeSec, rate]`
- `MANIFEST.json`: coverage and checksums per symbol

Why: the audit runs in a sandbox that cannot reach Binance. Public data only,
no keys. To refresh, re-run the workflow (Actions tab → Run workflow, or push
to this branch). Safe to delete both branches after the audit.
