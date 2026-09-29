/**
 * Narrative Scout configuration. Everything the owner might want to edit lives
 * here: narrative baskets, news feeds, gates, vetoes, pick rule, test book.
 * See docs/NARRATIVE-SCOUT-PLAN.md for the reasoning behind each number.
 *
 * Coin identifiers are CoinGecko ids (the slug in coingecko.com/en/coins/<id>).
 * An id that CoinGecko doesn't return is reported as unresolved, never guessed.
 */

export const NARRATIVES = [
  {
    key: "bank-rails",
    name: "Bank rails / ISO 20022",
    ids: ["quant-network", "ripple", "stellar", "hedera-hashgraph", "algorand", "xdce-crowd-sale", "iota"],
    keywords: ["iso 20022", "swift", "tokenized deposit", "tokenised deposit", "clearing house", "cbdc", "interbank", "sibos", "dtcc", "correspondent bank"],
  },
  {
    key: "rwa",
    name: "Real-world assets",
    ids: ["ondo-finance", "chainlink", "centrifuge", "maple", "polymesh", "pendle"],
    keywords: ["real-world asset", "real world asset", "rwa", "tokenized treasur", "tokenised treasur", "tokenization", "tokenisation", "tokenized fund", "blackrock buidl"],
  },
  {
    key: "ai",
    name: "AI & agents",
    ids: ["bittensor", "artificial-superintelligence-alliance", "render-token", "virtual-protocol", "near"],
    keywords: ["ai agent", "artificial intelligence", "decentralized ai", "agentic", "llm", "gpu compute"],
  },
  {
    key: "depin",
    name: "DePIN",
    ids: ["filecoin", "helium", "akash-network", "theta-token", "arweave", "iotex"],
    keywords: ["depin", "physical infrastructure", "decentralized storage", "wireless network"],
  },
  {
    key: "perp-defi",
    name: "Perp DEX & DeFi",
    ids: ["hyperliquid", "dydx-chain", "gmx", "jupiter-exchange-solana", "aave", "uniswap"],
    keywords: ["perp dex", "perpetual exchange", "defi", "lending protocol", "dex volume"],
  },
  {
    key: "l1",
    name: "Layer-1 platforms",
    ids: ["solana", "avalanche-2", "sui", "aptos", "cardano", "sei-network", "the-open-network"],
    keywords: ["layer 1", "layer-1", "mainnet", "throughput", "validator"],
  },
  {
    key: "privacy",
    name: "Privacy coins",
    ids: ["monero", "zcash", "dash"],
    keywords: ["privacy coin", "zero-knowledge", "shielded", "anonymity"],
  },
  {
    key: "memes",
    name: "Memes",
    ids: ["dogecoin", "shiba-inu", "pepe", "bonk", "dogwifcoin", "floki"],
    keywords: ["memecoin", "meme coin", "meme token"],
  },
];

// Free, keyless RSS feeds. Each is optional: a failing feed is reported in the
// source-health line and skipped.
export const NEWS_FEEDS = [
  { name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { name: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { name: "Decrypt", url: "https://decrypt.co/feed" },
  { name: "The Block", url: "https://www.theblock.co/rss.xml" },
  { name: "Blockworks", url: "https://blockworks.co/feed" },
  { name: "CryptoSlate", url: "https://cryptoslate.com/feed/" },
];

// Excluded from discovery: stablecoins, wrapped/staked/bridged receipts, and the
// two majors the core v2.0 system already trades.
export const EXCLUDE_IDS = new Set(["bitcoin", "ethereum"]);
export const EXCLUDE_SYMBOLS = new Set([
  "USDT", "USDC", "DAI", "FDUSD", "TUSD", "USDE", "USDS", "PYUSD", "USDD", "FRAX", "USD1", "RLUSD",
  "BUSD", "GUSD", "USDP", "LUSD", "EURC", "EURT", "XAUT", "PAXG", "USDX", "USD0", "SUSDE", "SUSDS",
  "WBTC", "WETH", "STETH", "WSTETH", "WEETH", "RETH", "CBBTC", "CBETH", "METH", "EZETH", "RSETH",
  "BTCB", "SOLVBTC", "LBTC", "JITOSOL", "MSOL", "BNSOL", "WBETH", "TBTC", "BSC-USD",
]);
export const EXCLUDE_NAME_PATTERN = /\b(wrapped|staked|bridged|restaked|liquid staking|usd coin|tether)\b/i;

export const GATES = {
  minVolumeUsd: 5_000_000,     // 24h volume
  minMarketCapUsd: 50_000_000,
  requireBinanceUsdt: true,     // needed for honest price data and execution
};

export const VETOES = {
  maxFdvToMcap: 5,              // supply overhang proxy (unlock data not connected yet)
  minFloat: 0.2,                // circulating / total supply
  maxTurnover: 1.0,             // 24h volume / market cap above this = frenzy or wash
  extendedAtrMult: 3,           // close > SMA20 + 3×ATR14 → EXTENDED (watch, don't chase)
  extended7dPct: 60,            // or +60% in 7 days
  minDepthMultiple: 20,         // bid depth within 2% must be ≥ 20× the test amount
};

// The mechanical pick rule, predeclared so it can be judged later.
export const PICK_RULE = {
  minHeat: 50,
  minStrength: 60,
  requireAbove50dSma: true,
  requireBtcRegimeLongOk: true,
};

// The paper test book. Separate from the v2.0 paper robot and its $100k.
export const BOOK = {
  startCash: 10_000,
  testAmount: 1_000,            // notional per pick
  maxOpen: 5,
  maxNewPerDay: 1,
  cooldownDays: 14,             // after an exit, the coin can't be re-picked for 14 days
  feePct: 0.1,                  // per side
  slippagePct: 0.1,             // per fill; alts are thinner than BTC
  atrMult: 2.5,                 // initial stop: closer of entry − 2.5×ATR14 and the 10-day close-low
  trailPeriod: 10,              // exit: close-based 10-day low, only ever raised
};
