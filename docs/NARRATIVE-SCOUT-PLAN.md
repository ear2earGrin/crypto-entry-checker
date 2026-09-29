# Narrative Scout — plan (proposed 2026-09-29, not built yet)

A discovery system for altcoins that sits NEXT TO the mechanical trend system,
never inside it. Owner's thesis: alts can outperform this cycle and narratives
(e.g. bank rails / ISO 20022: QNT, HBAR, XLM, XRP) drive the moves, so we need a
dashboard that finds them early, explains them, and measures them.

## The one rule

**Narrative decides WHAT to watch. Price decides WHEN. Risk decides HOW MUCH.**

The Scout never places or suggests a trade by itself. Its output is a watchlist.
A coin on the watchlist is traded only when the mechanical rules fire on it, with
a stop and fixed-fractional size. This keeps the "react, don't predict" core
intact: the owner's alt-season belief shapes the universe, the market still has
to confirm it.

## Design test case: QNT, Sep 24-27 2026

QNT went ~$90 (Sep 24 close) to ~$353 intraday (Sep 27) after The Clearing House
(25 US banks incl. BofA, JPMorgan) selected Quant as the interoperability layer
for its On-Chain Money / tokenized-deposit initiative, days before Sibos 2026
(Miami, Sep 28-Oct 1). What each layer should have produced:

| Layer | Output on QNT |
|---|---|
| Radar | Sep 24: tier-1 institutional catalyst, named counterparties, primary source available. Cluster: "Bank rails / tokenized deposits". Grade A event. |
| Rotation board | Did the whole bank-rails basket move, or only QNT? (single-coin event vs narrative wave — decides whether to scan the basket for followers) |
| Deep dive | Plain-English: what Overledger does, who pays for it, how the token captures value (licence fees paid in QNT?). Supply: unlock/overhang risk. Liquidity: can a position enter and exit. |
| Calendar | Sibos Sep 28-Oct 1 flagged ahead of time → "event window, sell-the-news risk" |
| Extension flag | 4x in 3 days, RSI extreme → "EXTENDED — do not chase; wait for mechanical setup" |
| Trading | Only if the alt-sleeve rules fire: breakout close, ATR/Donchian stop, 0.5% risk |

Being honest about it: nothing would have caught QNT *before* the Sep 24
announcement. That move was news, not a pattern. The realistic edges are:
1. **Speed**: know within the hour, with the primary source, instead of days later on X.
2. **Substance vs hype**: a named-bank contract is not a tweet from an influencer.
3. **Supply risk**: avoid coins where unlocks or insiders will sell into the pump.
4. **Second-order movers**: other coins in the same narrative that have not moved yet.
5. **Pre-positioning**: narratives with dated catalysts ahead (conferences, ETF
   deadlines, mainnets) are on the calendar weeks in advance.

## Architecture — seven layers

### L1 Narrative Radar (news → narratives)
- Ingest: crypto news RSS (CoinDesk, The Block, Decrypt, Blockworks), CryptoPanic
  API, exchange listing announcements (Binance, Coinbase, Upbit), project blogs and
  governance forums, SEC EDGAR (ETF S-1/19b-4 filings), GitHub release feeds.
  Optional paid: Kaito (narrative mindshare), LunarCrush/Santiment (social).
- AI step (Claude API): tag each item → coins, narrative cluster, event type
  (partnership / listing / unlock / hack / regulation / product launch / ETF),
  source quality (primary source, tier-1 press, aggregator, influencer), and a
  one-line "why it matters". Numbers are never taken from the AI.
- Narrative momentum = mention velocity (7d vs 30d baseline) × source breadth
  (how many independent outlets) × source quality.
- Lifecycle stage per narrative: EMERGING → ACCELERATING → MAINSTREAM → EXHAUSTING.
  MAINSTREAM (on TV, in every feed) is a warning, not a buy signal.

### L2 Narrative Rotation Board (the quant core — build first)
- Each narrative = equal-weight basket of its liquid coins (CoinGecko categories
  as the seed taxonomy, curated by hand).
- Per basket: relative strength vs BTC over 7/30/90d, breadth (% of members above
  their 50-day average), volume share trend (is money rotating in).
- Plus an "alt-season gauge": alt basket vs BTC, and BTC dominance trend. This
  turns the owner's thesis into something the data confirms or denies.
- Heatmap: narratives × timeframes. This alone answers "where is money going".

### L3 Discovery funnel (universe → candidates)
~800 tokens with a CoinGecko listing → liquidity gate (e.g. ≥ $5M daily spot
volume, listed on at least one tier-1 exchange, ≥ 6 months of price history) →
in a narrative with rising momentum or RS → pass hard vetoes (L5) → candidates.

### L4 Coin deep-dive card
1. **What it is** (AI, plain English, citing the whitepaper/docs with links):
   problem it solves, who the customer is, how the token captures value, what
   would have to be true for it to be worth 10x more.
2. **Token economics**: market cap, FDV, float % (circulating/total), FDV/MC,
   unlocks in next 30/90/365 days as % of float, inflation/emissions, insider +
   VC share, last private-round price vs current price (VCs in 20x profit = sellers).
3. **Liquidity & market structure**: spot volume, order-book depth ±2%, exchange
   tier, perp open interest, funding, OI/MC ratio, spot vs perp volume (a
   perp-led pump with spot lagging is fragile).
4. **Fundamentals**: fees and revenue, TVL, active addresses, developer activity,
   treasury runway. (DefiLlama, Token Terminal/Artemis, GitHub.)
5. **Holders**: top-10/top-100 concentration excluding exchange wallets.
6. **Catalysts ahead**: unlocks, mainnets, listings, ETF deadlines, conferences,
   airdrops/points programs.
7. **Integrity & risk**: audits, hack history, admin keys/upgradeability,
   regulatory status (SEC, MiCA), team doxxed, lawsuits.
8. **Claims check**: for each narrative claim, what is verifiable and where.
   Example: ISO 20022 is a messaging standard for bank payments; there is no
   official certification of a token as "ISO 20022 compliant". The claim to check
   is the concrete one: which banks or payment networks actually use the project.

### L5 Scoring and vetoes
Four sub-scores 0-100, shown separately (never collapsed into one magic number):
- **Narrative heat** (L1 momentum + stage)
- **Relative strength** (price momentum vs BTC and vs its basket)
- **Quality** (fundamentals, liquidity, integrity)
- **Supply risk** (unlocks, FDV/MC, insider share, VC profit) — lower is better

Hard vetoes (any one → REJECT with the reason shown):
- unlocks > 5% of float within 30 days
- FDV/MC > 5 with material unlocks inside 12 months
- depth ±2% below the size we would trade × 20
- top-10 non-exchange holders > 60%
- unresolved hack / admin key can mint / active securities action
- EXTENDED: > 3× ATR above the 20-day average (watch, don't chase)

Tiers: RADAR (just noticed) → WATCHLIST (passes vetoes, eligible for the alt
sleeve) → REJECT (with reason, kept for the journal).

### L6 Handoff to trading: the Alt Sleeve
- Same mechanical logic as v2.0 (Donchian breakout entry, Donchian-10 trailing
  exit, stop-derived size), applied only to WATCHLIST coins.
- Master switch: BTC regime must be LONG_OK (alts get crushed in BTC bear markets).
- Coin regime: new coins lack 50 weeks of history, so the coin filter must be
  tested (candidates: close > 20W SMA, or > 100D SMA).
- Risk 0.5% per trade, max 3 alt positions, alt sleeve open risk ≤ 1.5%,
  position ≤ 1% of the coin's daily volume.
- MUST be validated before going live: backtest on a survivorship-bias-free
  universe (include delisted Binance pairs; testing only coins alive today
  inflates results massively), walk-forward, Monte Carlo, same bars as v2.0.

### L7 Scout Journal (how the Scout itself gets validated)
Historical narratives and tokenomics snapshots cannot be reconstructed honestly
for free, so the Scout cannot be backtested like the trend system. Instead every
RADAR/WATCHLIST/REJECT decision is logged with timestamp, scores, and reasons.
After 3-6 months: did high-score coins beat low-score coins and BTC? Did vetoes
avoid losers? That forward record is the validation. Until it exists, the scores
are opinions with structure, and sizing must reflect that.

## Where it lives
- New **SCOUT** tab in the web app (and in the pm-brief bundle).
- Daily job on the Mac mini (launchd, like the paper robot) → `data/scout/*.json`
  → dashboard reads it. News radar hourly. Phone push via the existing ntfy topic
  for Grade-A events on watchlist coins and for narrative stage changes.

## Build phases
1. **Rotation Board + coin metrics** (no AI, free data: CoinGecko + Binance).
   Heatmap, alt-season gauge, funnel, basic tokenomics columns.
2. **Deep-dive cards + unlocks** (DefiLlama/Tokenomist unlocks; Claude API
   explainer — needs the owner's Anthropic API key on the Mac).
3. **News radar + catalyst calendar + phone alerts.**
4. **Alt-sleeve backtest** (survivorship-free); paper-trade it only if it passes.
5. **Scout Journal review** at 3 and 6 months.

## Base rates (keep this visible on the dashboard)
Most altcoins underperform BTC over a full cycle and many go to zero. A 10-100x
is a rare right-tail event. The Scout raises the odds and, more importantly,
filters out the known blow-up patterns (supply overhang, thin liquidity, hype
without substance). The money is made the same way as in the trend system: many
small, stopped-out attempts and a few large winners that are allowed to run.
