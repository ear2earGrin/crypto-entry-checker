import { useEffect, useMemo, useRef, useState } from "react";
import { createChart } from "lightweight-charts";

/**
 * Crypto Entry Checker
 * - Deterministic vetoes + macro + BTC-led derivatives stress + sizing/liquidation
 * - Binance public endpoints via Vite proxy (no keys)
 * - lightweight-charts v4.2.0 embedded chart
 *
 * Vite proxy expected:
 *  - /binance-spot -> https://api.binance.com
 *  - /binance-fut  -> https://fapi.binance.com
 */

const OPTIONS = {
  asset: ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"],
  quote: ["USDT"],
  timeframe: ["5m", "15m", "1H", "2H", "4H", "8H", "12H", "1D", "3D", "1W"],
  direction: ["Long", "Short"],
  regime: ["Trending", "Ranging", "Unsure"],
  trigger: ["Breakout", "Pullback", "Range bounce", "Not sure"],
  confirmation: ["None", "Rejection wick", "Close back inside level"],
  mental: ["Calm", "FOMO", "Revenge", "Tired"],
  timeToEvent: ["<24h", "24–72h", "3–7d"],
  executionMode: ["MARKET", "LIMIT"],
  leverage: [1, 2, 3, 5, 8, 10, 15, 20, 25, 30, 50, 75, 100],
};

const MACRO_EVENTS = [
  { key: "FOMC", label: "FOMC rate decision", tier: "A", base: 5 },
  { key: "CPI", label: "CPI / Core CPI", tier: "A", base: 5 },
  { key: "NFP", label: "Non-Farm Payrolls (NFP)", tier: "A", base: 5 },
  { key: "UNEMP", label: "Unemployment rate", tier: "A", base: 5 },
  { key: "FED_SPEECH", label: "Fed Chair / major Fed speech", tier: "A", base: 5 },
  { key: "ISM", label: "ISM PMI (Mfg/Services)", tier: "B", base: 3 },
  { key: "JOLTS", label: "JOLTS job openings", tier: "B", base: 3 },
  { key: "PCE", label: "PCE / Core PCE", tier: "B", base: 3 },
  { key: "GDP", label: "GDP (advance/revision)", tier: "B", base: 3 },
  { key: "RETAIL", label: "Retail sales", tier: "B", base: 3 },
  { key: "CLAIMS", label: "Jobless claims (weekly)", tier: "C", base: 1 },
  { key: "CONF", label: "Consumer confidence", tier: "C", base: 1 },
  { key: "HOUSING", label: "Housing data (starts/permits)", tier: "C", base: 1 },
  { key: "ADP", label: "ADP employment (noisy)", tier: "C", base: 1 },
];

const DEFAULT = {
  asset: "BTC",
  quote: "USDT",
  timeframe: "4H",
  direction: "Long",
  regime: "Trending",
  trigger: "Pullback",
  confirmation: "None",
  executionMode: "LIMIT",

  price: "",
  support: "",
  resistance: "",
  stop: "",
  target: "",

  mental: "Calm",

  macro: MACRO_EVENTS.reduce((acc, e) => {
    acc[e.key] = { enabled: false, time: "3–7d" };
    return acc;
  }, {}),

  derivs: {
    fundingRate: null,
    openInterest: null,
    oiChange24hPct: null,
    longShortRatio: null,
    updatedAt: null,
    status: "idle",
    error: "",
  },

  sizing: {
    equityUSDT: "10000",
    riskPct: "0.5",
    leverage: "10",
    mmrPct: "0.5",
    feePct: "0.08",
    liqBufferPct: "2",
  },
};

// ---------- utils ----------
function num(v) {
  const n = Number(String(v ?? "").replace(",", ".").trim());
  return Number.isFinite(n) ? n : null;
}
function format(n, decimals = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals });
}
function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function timeframeProfile(tf) {
  if (["5m", "15m"].includes(tf)) return { bucket: "LOW", minRR: 1.2, midRangeBand: [0.35, 0.65], edgeProximityPct: 0.012, description: "Low TF: noisy, strict risk control" };
  if (["1H", "2H", "4H"].includes(tf)) return { bucket: "MID", minRR: 1.5, midRangeBand: [0.35, 0.65], edgeProximityPct: 0.008, description: "Mid TF: balanced" };
  if (["8H", "12H", "1D", "3D"].includes(tf)) return { bucket: "HIGH", minRR: 2.0, midRangeBand: [0.4, 0.6], edgeProximityPct: 0.005, description: "High TF: structure-heavy" };
  return { bucket: "VERY_HIGH", minRR: 2.5, midRangeBand: [0.45, 0.55], edgeProximityPct: 0.003, description: "Very high TF: position trade only" };
}

// ---------- macro ----------
function timeMultiplier(timeBucket) {
  if (timeBucket === "<24h") return 1.0;
  if (timeBucket === "24–72h") return 0.7;
  return 0.4;
}
function densityMultiplier(sum) {
  if (sum <= 4) return 1.0;
  if (sum <= 8) return 1.2;
  if (sum <= 12) return 1.4;
  return 1.6;
}
function macroScoreAndLevel(macroState) {
  const contributions = [];
  let sum = 0;
  for (const e of MACRO_EVENTS) {
    const st = macroState[e.key];
    if (!st?.enabled) continue;
    const mult = timeMultiplier(st.time);
    const val = e.base * mult;
    sum += val;
    contributions.push({ key: e.key, label: e.label, tier: e.tier, base: e.base, time: st.time, mult, val });
  }
  const dens = densityMultiplier(sum);
  const score = sum * dens;

  let level = "None/low";
  if (score >= 4 && score < 7) level = "Scheduled minor";
  if (score >= 7 && score < 11) level = "Scheduled major";
  if (score >= 11) level = "High uncertainty";

  return { score, level, dens, sum, contributions };
}

// ---------- binance ----------
function binanceSymbol(asset, quote) {
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
  try {
    return JSON.parse(text);
  } catch {
    const snippet = text.slice(0, 180).replace(/\s+/g, " ").trim();
    throw new Error(`JSON parse failed for ${url}. Body: ${snippet}`);
  }
}
async function fetchBinanceSpotPrice(asset, quote) {
  const symbol = binanceSymbol(asset, quote);
  const url = `/binance-spot/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`;
  const data = await fetchJson(url);
  const p = num(data?.price);
  if (p === null) throw new Error("Binance spot returned invalid price.");
  return p;
}

function tfToBinanceInterval(tf) {
  const map = { "5m": "5m", "15m": "15m", "1H": "1h", "2H": "2h", "4H": "4h", "8H": "8h", "12H": "12h", "1D": "1d", "3D": "3d", "1W": "1w" };
  return map[tf] || "4h";
}
async function fetchKlines({ asset, quote, timeframe, limit = 300 }) {
  const symbol = binanceSymbol(asset, quote);
  const interval = tfToBinanceInterval(timeframe);
  const url = `/binance-spot/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
  const data = await fetchJson(url);
  if (!Array.isArray(data)) throw new Error("Klines response invalid.");

  return data
    .map((k) => ({
      time: Math.floor(Number(k[0]) / 1000),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
    }))
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close));
}

async function fetchBtcDerivsContext() {
  const symbol = "BTCUSDT";

  const fundingArr = await fetchJson(`/binance-fut/fapi/v1/fundingRate?symbol=${symbol}&limit=1`);
  const fundingRate = num(fundingArr?.[0]?.fundingRate);

  const oiNowObj = await fetchJson(`/binance-fut/fapi/v1/openInterest?symbol=${symbol}`);
  const openInterestNow = num(oiNowObj?.openInterest);

  let oiChange24hPct = null;
  try {
    const hist = await fetchJson(`/binance-fut/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=2`);
    const a = hist?.[0]?.sumOpenInterest ? num(hist[0].sumOpenInterest) : null;
    const b = hist?.[1]?.sumOpenInterest ? num(hist[1].sumOpenInterest) : null;

    let newer = a;
    let older = b;
    if (hist?.[0]?.timestamp && hist?.[1]?.timestamp) {
      if (Number(hist[0].timestamp) < Number(hist[1].timestamp)) {
        newer = b;
        older = a;
      }
    }
    if (newer !== null && older !== null && older > 0) {
      oiChange24hPct = ((newer - older) / older) * 100;
    }
  } catch {
    // ignore
  }

  let longShortRatio = null;
  try {
    const ls = await fetchJson(`/binance-fut/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=4h&limit=1`);
    longShortRatio = num(ls?.[0]?.longShortRatio);
  } catch {
    // ignore
  }

  return { fundingRate, openInterest: openInterestNow, oiChange24hPct, longShortRatio, updatedAt: new Date().toISOString() };
}

// ---------- derivs scoring ----------
function derivsStressFromContext(ctx) {
  const warnings = [];
  const audit = [];
  let riskPoints = 0;

  const fr = ctx?.fundingRate;
  if (fr !== null && fr !== undefined) {
    const frAbs = Math.abs(fr);
    audit.push(`Funding: ${format(fr * 100, 4)}%`);
    if (frAbs >= 0.0005) { riskPoints += 2; warnings.push("Funding extreme → crowding / squeeze risk."); }
    else if (frAbs >= 0.00025) { riskPoints += 1; warnings.push("Funding elevated → positioning crowded."); }
  } else audit.push("Funding: unavailable");

  const oiPct = ctx?.oiChange24hPct;
  if (oiPct !== null && oiPct !== undefined) {
    audit.push(`OI 24h Δ: ${format(oiPct, 2)}%`);
    if (oiPct >= 6) { riskPoints += 2; warnings.push("Open interest surged → leverage piling in → wick risk."); }
    else if (oiPct >= 3) { riskPoints += 1; warnings.push("Open interest rising → more leverage in system."); }
  } else audit.push("OI 24h Δ: unavailable");

  const lsr = ctx?.longShortRatio;
  if (lsr !== null && lsr !== undefined) {
    audit.push(`L/S ratio: ${format(lsr, 2)}`);
    if (lsr >= 1.35) { riskPoints += 1; warnings.push("L/S high → longs crowded → squeeze-down risk."); }
    else if (lsr <= 0.75) { riskPoints += 1; warnings.push("L/S low → shorts crowded → squeeze-up risk."); }
  } else audit.push("L/S ratio: unavailable");

  let level = "Low";
  if (riskPoints >= 3) level = "High";
  else if (riskPoints >= 2) level = "Medium";

  return { level, riskPoints, warnings, audit };
}

// ---------- sizing ----------
function computeSizingAndLiq(f) {
  const p = num(f.price);
  const stop = num(f.stop);
  const target = num(f.target);

  const eq = num(f.sizing.equityUSDT);
  const riskPct = num(f.sizing.riskPct);
  const lev = num(f.sizing.leverage);
  const mmrPct = num(f.sizing.mmrPct);
  const feePct = num(f.sizing.feePct);
  const liqBufPct = num(f.sizing.liqBufferPct);

  const warnings = [];
  const metrics = {
    equityUSDT: eq,
    riskPct,
    leverage: lev,
    mmrPct,
    feePct,
    liqBufferPct: liqBufPct,
    riskUSDT: null,
    qty: null,
    notional: null,
    initialMargin: null,
    stopDistance: null,
    rr: null,
    pnlAtStop: null,
    pnlAtTarget: null,
    liqPriceApprox: null,
    stopToLiqBufferPct: null,
  };

  if (p === null || stop === null) return { warnings: ["Sizing needs Price + Stop."], metrics };
  if (eq === null || riskPct === null || lev === null || mmrPct === null || feePct === null || liqBufPct === null) {
    return { warnings: ["Sizing inputs missing (equity, risk%, leverage, mmr%, fee%, buffer%)."], metrics };
  }
  if (eq <= 0) return { warnings: ["Equity must be > 0."], metrics };
  if (riskPct <= 0) return { warnings: ["Risk% must be > 0."], metrics };
  if (lev <= 0) return { warnings: ["Leverage must be > 0."], metrics };

  const riskUSDT = eq * (riskPct / 100);
  const perUnitRisk = Math.abs(p - stop);
  if (perUnitRisk <= 0) return { warnings: ["Stop equals Price → per-unit risk is 0."], metrics };

  const qty = riskUSDT / perUnitRisk;
  const notional = qty * p;
  const initialMargin = notional / lev;

  const estFees = notional * (feePct / 100);
  if (estFees > riskUSDT) warnings.push("Fees estimate exceeds risk budget → your stop may be meaningless at this size.");

  const pnlAtStop = f.direction === "Long" ? (stop - p) * qty : (p - stop) * qty;

  let pnlAtTarget = null;
  let rr = null;
  if (target !== null) {
    pnlAtTarget = f.direction === "Long" ? (target - p) * qty : (p - target) * qty;
    if (pnlAtStop !== 0) rr = Math.abs(pnlAtTarget / pnlAtStop);
  }

  const mmr = mmrPct / 100;
  const invLev = 1 / lev;
  const liqPriceApprox = f.direction === "Long" ? p * (1 - invLev + mmr) : p * (1 + invLev - mmr);

  const stopToLiqBufferPct =
    f.direction === "Long" ? ((stop - liqPriceApprox) / p) * 100 : ((liqPriceApprox - stop) / p) * 100;

  if (initialMargin > eq) warnings.push("Initial margin > equity (cross/isolated mismatch). Reduce size or leverage.");
  if (stopToLiqBufferPct <= 0) warnings.push("Stop is beyond (or at) estimated liquidation → unacceptable.");
  if (stopToLiqBufferPct > 0 && stopToLiqBufferPct < liqBufPct) warnings.push(`Stop-to-liq buffer too small (< ${liqBufPct}%). Wick risk = liquidation risk.`);

  metrics.riskUSDT = riskUSDT;
  metrics.qty = qty;
  metrics.notional = notional;
  metrics.initialMargin = initialMargin;
  metrics.stopDistance = perUnitRisk;
  metrics.rr = rr;
  metrics.pnlAtStop = pnlAtStop - estFees;
  metrics.pnlAtTarget = pnlAtTarget !== null ? pnlAtTarget - estFees : null;
  metrics.liqPriceApprox = liqPriceApprox;
  metrics.stopToLiqBufferPct = stopToLiqBufferPct;

  return { warnings, metrics };
}

// ---------- evaluate ----------
function evaluate(f) {
  const vetoes = [];
  const reasons = [];
  const warnings = [];

  const tfp = timeframeProfile(f.timeframe);

  const p = num(f.price);
  const s = num(f.support);
  const r = num(f.resistance);
  const stop = num(f.stop);
  const target = num(f.target);

  const macro = macroScoreAndLevel(f.macro);
  const derivsScore = derivsStressFromContext(f.derivs);

  const sizing = computeSizingAndLiq(f);
  warnings.push(...(sizing.warnings || []));

  if (["FOMO", "Revenge", "Tired"].includes(f.mental)) vetoes.push(`Psych veto: mental state = ${f.mental}`);
  if (f.regime === "Unsure") vetoes.push("Structure veto: regime is Unsure");
  if (p === null) vetoes.push("Structure veto: current price must be a number");
  if (s === null || r === null) vetoes.push("Structure veto: support/resistance must be numbers");
  if (s !== null && r !== null && s >= r) vetoes.push("Structure veto: support must be below resistance");
  if (stop === null) vetoes.push("Risk veto: stop is required (no stop = no trade)");

  if (p !== null && stop !== null) {
    if (f.direction === "Long" && stop >= p) vetoes.push("Risk veto: Long stop must be BELOW current price");
    if (f.direction === "Short" && stop <= p) vetoes.push("Risk veto: Short stop must be ABOVE current price");
  }

  const stopToLiq = sizing?.metrics?.stopToLiqBufferPct;
  if (Number.isFinite(stopToLiq) && stopToLiq <= 0) {
    vetoes.push("Liq veto: stop is beyond estimated liquidation (reduce leverage / adjust stop / smaller size).");
  }

  if (vetoes.length) {
    return { verdict: "NO TRADE", score: 0, blockedBy: vetoes, warnings, reasons: ["Action: reset risk (stop/leverage/size) before thinking about entry."], metrics: { macro, derivsScore, tfp, sizing: sizing.metrics } };
  }

  let score = 0;

  if (f.regime === "Trending" || f.regime === "Ranging") { score += 2; reasons.push("Regime: clear (+2)"); }
  score += 2; reasons.push("Levels: valid (+2)");

  if (macro.level === "None/low") { score += 2; reasons.push("Macro: low catalyst week (+2)"); }
  else if (macro.level === "Scheduled minor") { score += 1; reasons.push("Macro: scheduled minor (+1)"); }
  else if (macro.level === "Scheduled major") { reasons.push("Macro: scheduled major (+0)"); warnings.push("Major macro week → expect volatility / invalidation risk."); }
  else { score -= 1; reasons.push("Macro: high uncertainty (−1)"); warnings.push("High uncertainty week → wicks / invalidations more likely."); }

  if (derivsScore.level === "Low") reasons.push("Derivs (BTC-led): low stress (+0)");
  else if (derivsScore.level === "Medium") { score -= 1; reasons.push("Derivs (BTC-led): medium stress (−1)"); warnings.push(...derivsScore.warnings); }
  else { score -= 2; reasons.push("Derivs (BTC-led): high stress (−2)"); warnings.push(...derivsScore.warnings); }

  if (f.executionMode === "MARKET") {
    if (f.confirmation === "None") { score -= 1; reasons.push("Market mode: no confirmation (−1)"); warnings.push("Market entries without confirmation tend to be impulse entries."); }
    else { score += 1; reasons.push("Market mode: confirmation present (+1)"); }
  } else reasons.push("Limit mode: edge proximity required (+0)");

  const range = r - s;
  const posRaw = (p - s) / range;
  const pos = clamp01(posRaw);

  const distToSupportPct = (p - s) / p;
  const distToResPct = (r - p) / p;
  const nearSupport = distToSupportPct <= tfp.edgeProximityPct;
  const nearResistance = distToResPct <= tfp.edgeProximityPct;

  const [midA, midB] = tfp.midRangeBand;
  const inMidRange = pos > midA && pos < midB;

  if (inMidRange) {
    reasons.push(`Positioning: mid-range for ${f.timeframe} (+0)`);
    warnings.push("Mid-range entries are low edge unless trigger is very specific.");
  } else {
    const edgeOk = (f.direction === "Long" && nearSupport) || (f.direction === "Short" && nearResistance);
    if (edgeOk) { score += 2; reasons.push(`Positioning: near edge for ${f.timeframe} (+2)`); }
    else {
      reasons.push(`Positioning: not tight to correct edge on ${f.timeframe} (+0)`);
      warnings.push("On this timeframe, entry is not close enough to the correct edge.");
      if (f.executionMode === "LIMIT") { score -= 1; reasons.push("Limit mode: poor edge proximity (−1)"); }
    }
  }

  if (f.trigger === "Range bounce") {
    if (f.regime !== "Ranging") warnings.push("Trigger mismatch: Range bounce outside Ranging can be low probability.");
    if (f.confirmation === "None") { score -= 2; reasons.push("Range bounce: no confirmation (−2)"); warnings.push("Range bounce without confirmation = anticipation."); }
    else { score += 1; reasons.push(`Range bounce confirmation: ${f.confirmation} (+1)`); }
  }

  let rr = null;
  if (target !== null) {
    const risk = f.direction === "Long" ? p - stop : stop - p;
    const reward = f.direction === "Long" ? target - p : p - target;
    if (risk > 0 && reward > 0) {
      rr = reward / risk;
      if (rr < tfp.minRR) { reasons.push(`R:R ≈ ${format(rr, 2)} (< ${tfp.minRR} for ${f.timeframe}) (+0)`); warnings.push(`R:R too low for ${f.timeframe}. Minimum ≈ ${tfp.minRR}.`); }
      else { score += rr >= tfp.minRR + 1.0 ? 2 : 1; reasons.push(rr >= tfp.minRR + 1.0 ? `R:R ≈ ${format(rr, 2)} (strong for ${f.timeframe}) (+2)` : `R:R ≈ ${format(rr, 2)} (ok for ${f.timeframe}) (+1)`); }
    } else { warnings.push("R:R invalid (check stop/target direction)."); reasons.push("R:R invalid (+0)"); }
  } else { reasons.push("R:R not computed (no target) (+0)"); warnings.push("No target set → you can’t properly judge R:R."); }

  const bufNeed = num(f.sizing.liqBufferPct);
  if (bufNeed !== null && Number.isFinite(stopToLiq)) {
    if (stopToLiq < bufNeed) { score -= 2; reasons.push(`Liq buffer: ${format(stopToLiq, 2)}% (<${bufNeed}%) (−2)`); }
    else if (stopToLiq < bufNeed * 2) { score -= 1; reasons.push(`Liq buffer: ${format(stopToLiq, 2)}% (thin) (−1)`); }
    else reasons.push(`Liq buffer: ${format(stopToLiq, 2)}% (ok) (+0)`);
  }

  score = Math.max(0, Math.min(10, Number.isFinite(score) ? score : 0));

  let verdict = "WATCHLIST";
  if (score <= 5) verdict = "NO TRADE";
  if (score >= 8) verdict = "OK TO TRADE";

  const highMacro = macro.level === "Scheduled major" || macro.level === "High uncertainty";
  if (highMacro && verdict === "OK TO TRADE") { verdict = "WATCHLIST"; reasons.push("Capped to WATCHLIST due to macro risk."); }
  if (derivsScore.level === "High" && verdict === "OK TO TRADE") { verdict = "WATCHLIST"; reasons.push("Capped to WATCHLIST due to derivatives stress."); }

  reasons.push(verdict === "OK TO TRADE" ? "Action: stop first, size by risk, execute only per mode rules." : verdict === "WATCHLIST" ? "Action: wait; don’t force it." : "Action: no trade.");

  return { verdict, score, blockedBy: [], warnings, reasons, metrics: { price: p, support: s, resistance: r, pos, rr, macro, derivsScore, tfp, sizing: sizing.metrics } };
}

// ---------- UI components ----------
function SelectField({ label, value, onChange, options, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, letterSpacing: 1.2, opacity: 0.85, marginBottom: 6 }}>{label}</div>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={styles.select}>
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>{String(o)}</option>
        ))}
      </select>
      {hint ? <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>{hint}</div> : null}
    </div>
  );
}
function InputField({ label, value, onChange, placeholder, hint }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, letterSpacing: 1.2, opacity: 0.85, marginBottom: 6 }}>{label}</div>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} style={styles.input} />
      {hint ? <div style={{ fontSize: 12, opacity: 0.65, marginTop: 6 }}>{hint}</div> : null}
    </div>
  );
}
function Pill({ text }) {
  return <span style={styles.pill}>{text}</span>;
}
function ModeSwitch({ mode, setMode }) {
  return (
    <div style={styles.modeWrap}>
      <div style={{ fontSize: 12, letterSpacing: 1.4, opacity: 0.85, marginBottom: 10 }}>EXECUTION MODE</div>
      <div style={styles.modeRow}>
        {OPTIONS.executionMode.map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{ ...styles.modeBtn, ...(active ? styles.modeBtnActive : {}) }}
              type="button"
            >
              <div style={{ fontWeight: 900, letterSpacing: 2 }}>{m}</div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                {m === "MARKET" ? "Reactive • needs confirmation" : "Passive • needs edge proximity"}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, opacity: 0.65, marginTop: 10 }}>
        Market mode rewards confirmation. Limit mode rewards level quality; if you’re not tight to the edge, score is capped/penalized.
      </div>
    </div>
  );
}

// ---------- styles ----------
const styles = {
  page: {
    maxWidth: 1150,
    margin: "26px auto",
    padding: "0 14px",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    color: "#d7ffe8",
  },
  header: {
    border: "1px solid #2cff9c33",
    background: "radial-gradient(1200px 280px at 10% 0%, #1cff8a22, transparent), linear-gradient(180deg, #07110e, #050807)",
    padding: 16,
    borderRadius: 18,
    boxShadow: "0 0 0 1px #0d2a1d inset, 0 30px 80px #00000088",
    display: "grid",
    gridTemplateColumns: "1fr auto",
    gap: 16,
    alignItems: "center",
  },
  title: { margin: 0, letterSpacing: 3, fontWeight: 900, fontSize: 22 },
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.3, fontSize: 12 },
  btn: {
    padding: "10px 12px",
    borderRadius: 14,
    border: "1px solid #2cff9c33",
    background: "linear-gradient(180deg, #0b1712, #070b09)",
    color: "#d7ffe8",
    cursor: "pointer",
    letterSpacing: 1.4,
    fontWeight: 800,
    boxShadow: "0 10px 25px #00000088",
  },
  grid: { display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: 14, marginTop: 14 },
  card: {
    border: "1px solid #2cff9c33",
    background: "linear-gradient(180deg, #050807, #050b09)",
    padding: 16,
    borderRadius: 18,
    boxShadow: "0 0 0 1px #0d2a1d inset, 0 20px 50px #00000088",
  },
  sectionTitle: { margin: "0 0 10px 0", letterSpacing: 2, fontSize: 12, opacity: 0.9 },
  input: { width: "100%", padding: 10, borderRadius: 14, border: "1px solid #2cff9c2a", background: "#050b09", color: "#d7ffe8", outline: "none" },
  select: { width: "100%", padding: 10, borderRadius: 14, border: "1px solid #2cff9c2a", background: "#050b09", color: "#d7ffe8", outline: "none" },
  pill: { display: "inline-block", padding: "3px 9px", borderRadius: 999, border: "1px solid #2cff9c33", background: "#08110d", fontSize: 12, opacity: 0.95 },
  modeWrap: { border: "1px solid #2cff9c22", padding: 14, borderRadius: 18, background: "linear-gradient(180deg, #06120e, #050807)", marginBottom: 14 },
  modeRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  modeBtn: { borderRadius: 16, border: "1px solid #2cff9c22", background: "linear-gradient(180deg, #050b09, #050807)", padding: 14, textAlign: "left", color: "#d7ffe8", cursor: "pointer", boxShadow: "0 16px 40px #00000077" },
  modeBtnActive: {
    border: "1px solid #2cff9c88",
    boxShadow: "0 0 0 1px #2cff9c22 inset, 0 20px 60px #000000aa",
    background: "radial-gradient(800px 180px at 20% 0%, #2cff9c22, transparent), linear-gradient(180deg, #06120e, #050807)",
  },
  pre: { whiteSpace: "pre-wrap", background: "#06120e", color: "#d7ffe8", padding: 12, borderRadius: 16, maxHeight: 380, overflow: "auto", border: "1px solid #2cff9c22" },
  chartWrap: { border: "1px solid #2cff9c22", borderRadius: 18, background: "linear-gradient(180deg, #06120e, #050807)", padding: 12, marginBottom: 12 },
  chartBox: { height: 320, borderRadius: 14, overflow: "hidden", border: "1px solid #2cff9c22" },
};

// ---------- App ----------
export default function App() {
  const [f, setF] = useState(DEFAULT);
  const [res, setRes] = useState(null);
  const [spotStatus, setSpotStatus] = useState({ state: "idle", message: "" });

  const [chartStatus, setChartStatus] = useState({ state: "idle", message: "" });
  const [clickMode, setClickMode] = useState("NONE"); // NONE | ENTRY | STOP | TARGET
  const clickModeRef = useRef("NONE");

  // chart refs
  const chartDivRef = useRef(null);
  const chartApiRef = useRef(null);
  const candleSeriesRef = useRef(null);

  // price lines
  const entryLineRef = useRef(null);
  const stopLineRef = useRef(null);
  const targetLineRef = useRef(null);

  useEffect(() => { clickModeRef.current = clickMode; }, [clickMode]);

  function update(key, value) { setF((prev) => ({ ...prev, [key]: value })); }
  function updateSizing(key, value) { setF((prev) => ({ ...prev, sizing: { ...prev.sizing, [key]: value } })); }
  function updateMacro(eventKey, patch) { setF((prev) => ({ ...prev, macro: { ...prev.macro, [eventKey]: { ...prev.macro[eventKey], ...patch } } })); }

  async function fetchSpotPrice() {
    setSpotStatus({ state: "loading", message: "Fetching spot price..." });
    try {
      const p = await fetchBinanceSpotPrice(f.asset, f.quote);
      setF((prev) => ({ ...prev, price: String(p) }));
      setSpotStatus({ state: "ok", message: `Updated: ${format(p, 2)}` });
    } catch (e) {
      setSpotStatus({ state: "error", message: e?.message || "Failed to fetch spot price." });
    }
  }
  async function fetchDerivs() {
    setF((prev) => ({ ...prev, derivs: { ...prev.derivs, status: "loading", error: "" } }));
    try {
      const ctx = await fetchBtcDerivsContext();
      setF((prev) => ({ ...prev, derivs: { ...prev.derivs, ...ctx, status: "ok", error: "" } }));
    } catch (e) {
      setF((prev) => ({ ...prev, derivs: { ...prev.derivs, status: "error", error: e?.message || "Derivs fetch failed." } }));
    }
  }
  async function refreshContext() { await Promise.allSettled([fetchSpotPrice(), fetchDerivs()]); }
  function run() { setRes(evaluate(f)); }
  function reset() {
    setF(DEFAULT);
    setRes(null);
    setSpotStatus({ state: "idle", message: "" });
    setChartStatus({ state: "idle", message: "" });
    setClickMode("NONE");
  }

  // ---- chart init ONCE (v4) ----
  useEffect(() => {
    const el = chartDivRef.current;
    if (!el) return;

    // If you still get "addCandlestickSeries missing" here, you did NOT install v4 correctly.
    const width = el.clientWidth > 0 ? el.clientWidth : 600;

    const chart = createChart(el, {
      width,
      height: 320,
      layout: { background: { color: "#050807" }, textColor: "#d7ffe8" },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
      crosshair: { mode: 1 },
    });

    if (typeof chart.addCandlestickSeries !== "function") {
      // hard fail with a precise message
      throw new Error("lightweight-charts v4 required. addCandlestickSeries is missing. Your install is not v4.");
    }

    const series = chart.addCandlestickSeries();

    chartApiRef.current = chart;
    candleSeriesRef.current = series;
    setChartStatus({ state: "ok", message: "Chart ready." });

    const onResize = () => {
      const w = el.clientWidth > 0 ? el.clientWidth : 600;
      chart.applyOptions({ width: w });
    };
    window.addEventListener("resize", onResize);

    const onClick = (param) => {
      const mode = clickModeRef.current;
      if (mode === "NONE") return;
      if (!param?.point) return;

      const price = series.coordinateToPrice(param.point.y);
      if (!Number.isFinite(price)) return;

      const pStr = String(Number(price.toFixed(6)));
      if (mode === "ENTRY") setF((prev) => ({ ...prev, price: pStr }));
      if (mode === "STOP") setF((prev) => ({ ...prev, stop: pStr }));
      if (mode === "TARGET") setF((prev) => ({ ...prev, target: pStr }));
    };

    chart.subscribeClick(onClick);

    return () => {
      window.removeEventListener("resize", onResize);
      try { chart.unsubscribeClick(onClick); } catch {}
      try { chart.remove(); } catch {}
      chartApiRef.current = null;
      candleSeriesRef.current = null;
      entryLineRef.current = null;
      stopLineRef.current = null;
      targetLineRef.current = null;
    };
  }, []);

  // ---- sync price lines ----
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    function upsertLine(lineRef, value, title) {
      const v = num(value);
      if (!Number.isFinite(v)) {
        if (lineRef.current) {
          try { series.removePriceLine(lineRef.current); } catch {}
          lineRef.current = null;
        }
        return;
      }

      if (lineRef.current) {
        try { series.removePriceLine(lineRef.current); } catch {}
        lineRef.current = null;
      }

      lineRef.current = series.createPriceLine({
        price: v,
        title,
        lineWidth: 2,
        lineStyle: 2,
        axisLabelVisible: true,
      });
    }

    upsertLine(entryLineRef, f.price, "Entry");
    upsertLine(stopLineRef, f.stop, "Stop");
    upsertLine(targetLineRef, f.target, "Target");
  }, [f.price, f.stop, f.target]);

  async function loadChart() {
    setChartStatus({ state: "loading", message: "Loading klines..." });
    try {
      const series = candleSeriesRef.current;
      if (!series) throw new Error("Chart not ready.");

      const candles = await fetchKlines({ asset: f.asset, quote: f.quote, timeframe: f.timeframe, limit: 300 });
      series.setData(candles);

      try { chartApiRef.current?.timeScale()?.fitContent(); } catch {}
      setChartStatus({ state: "ok", message: `Loaded ${candles.length} candles (${binanceSymbol(f.asset, f.quote)} • ${f.timeframe}).` });

      if (!f.price && candles.length) {
        const last = candles[candles.length - 1]?.close;
        if (Number.isFinite(last)) setF((prev) => ({ ...prev, price: String(last) }));
      }
    } catch (e) {
      setChartStatus({ state: "error", message: e?.message || "Chart load failed." });
    }
  }

  const macroComputed = useMemo(() => macroScoreAndLevel(f.macro), [f.macro]);
  const derivsComputed = useMemo(() => derivsStressFromContext(f.derivs), [f.derivs]);
  const sizingComputed = useMemo(() => computeSizingAndLiq(f), [f]);

  const journal = useMemo(() => {
    if (!res) return "";
    const m = res.metrics?.macro;
    const d = res.metrics?.derivsScore;
    const tfp = res.metrics?.tfp;
    const sz = res.metrics?.sizing;

    const lines = [
      `Trade Check — ${new Date().toLocaleString()}`,
      `Symbol: ${binanceSymbol(f.asset, f.quote)}`,
      `Mode: ${f.executionMode}`,
      `TF: ${f.timeframe} (${tfp?.bucket || "-"})`,
      `Dir: ${f.direction}`,
      `Regime: ${f.regime}`,
      `Trigger: ${f.trigger}`,
      `Confirmation: ${f.confirmation}`,
      `Price: ${f.price || "-"}`,
      `Support: ${f.support || "-"}`,
      `Resistance: ${f.resistance || "-"}`,
      `Stop: ${f.stop || "-"}`,
      `Target: ${f.target || "-"}`,
      `Mental: ${f.mental}`,
      ``,
      `Macro: ${m?.level || "-"} (score≈${format(m?.score, 2)})`,
      `Derivs (BTC-led): ${d?.level || "-"} (riskPts=${d?.riskPoints ?? "-"})`,
      ``,
      `Sizing (approx):`,
      `- Equity: ${format(sz?.equityUSDT, 2)} USDT`,
      `- Risk: ${format(sz?.riskUSDT, 2)} USDT (${format(sz?.riskPct, 2)}%)`,
      `- Leverage: ${format(sz?.leverage, 0)}x`,
      `- Qty: ${format(sz?.qty, 6)} ${f.asset}`,
      `- Notional: ${format(sz?.notional, 2)} USDT`,
      `- Init margin: ${format(sz?.initialMargin, 2)} USDT`,
      `- Liq (approx): ${format(sz?.liqPriceApprox, 2)}`,
      `- Stop→Liq buffer: ${format(sz?.stopToLiqBufferPct, 2)}%`,
      ``,
      `Verdict: ${res.verdict} (Score: ${res.score}/10)`,
    ];

    if (res.warnings?.length) {
      lines.push("", "Warnings:");
      res.warnings.forEach((w) => lines.push(`- ${w}`));
    }

    lines.push("", "Checks:");
    res.reasons.forEach((r) => lines.push(`- ${r}`));

    if (d?.audit?.length) {
      lines.push("", "Derivs audit:");
      d.audit.forEach((a) => lines.push(`- ${a}`));
    }
    if (m?.contributions?.length) {
      lines.push("", "Macro selected:");
      m.contributions.forEach((c) => lines.push(`- ${c.label} (${c.time}) → +${format(c.val, 2)}`));
    }

    return lines.join("\n");
  }, [f, res]);

  async function copyJournal() {
    if (!journal) return;
    await navigator.clipboard.writeText(journal);
    alert("Copied to clipboard.");
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>CRYPTO ENTRY CHECKER</h1>
          <div style={styles.subtitle}>
            Deterministic vetoes + macro + BTC-led derivatives stress + sizing/liquidation.
            Blocks bad trades; does not find trades. (Now with chart for faster sim.)
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <button style={styles.btn} onClick={refreshContext} type="button">REFRESH CONTEXT</button>
          <button style={styles.btn} onClick={fetchSpotPrice} type="button">FETCH PRICE</button>
          <button style={styles.btn} onClick={fetchDerivs} type="button">FETCH BTC DERIVS</button>
        </div>
      </div>

      <div style={styles.grid}>
        {/* LEFT */}
        <div style={styles.card}>
          <div style={styles.sectionTitle}>INPUTS</div>

          <ModeSwitch mode={f.executionMode} setMode={(m) => update("executionMode", m)} />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <SelectField label="Asset" value={f.asset} options={OPTIONS.asset} onChange={(v) => update("asset", v)} />
            <SelectField label="Quote" value={f.quote} options={OPTIONS.quote} onChange={(v) => update("quote", v)} />

            <SelectField label="Timeframe" value={f.timeframe} options={OPTIONS.timeframe} onChange={(v) => update("timeframe", v)} hint="Higher TF requires tighter edge proximity. Limit mode punishes loose entries." />
            <SelectField label="Direction" value={f.direction} options={OPTIONS.direction} onChange={(v) => update("direction", v)} />

            <SelectField label="Regime" value={f.regime} options={OPTIONS.regime} onChange={(v) => update("regime", v)} />
            <SelectField label="Entry trigger" value={f.trigger} options={OPTIONS.trigger} onChange={(v) => update("trigger", v)} />

            <SelectField label="Confirmation" value={f.confirmation} options={OPTIONS.confirmation} onChange={(v) => update("confirmation", v)} hint="Market mode rewards confirmation. Range bounce without confirmation gets penalized." />
            <SelectField label="Mental state" value={f.mental} options={OPTIONS.mental} onChange={(v) => update("mental", v)} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end", marginTop: 6 }}>
            <InputField
              label="Current price (spot / intended entry)"
              value={f.price}
              placeholder="Fetch, click chart, or type"
              onChange={(v) => update("price", v)}
              hint={spotStatus.message ? (spotStatus.state === "error" ? `⚠️ ${spotStatus.message}` : `✅ ${spotStatus.message}`) : ""}
            />
            <button onClick={fetchSpotPrice} style={styles.btn} type="button">FETCH</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <InputField label="Support (pivot)" value={f.support} placeholder="e.g., 0.133" onChange={(v) => update("support", v)} />
            <InputField label="Resistance (pivot)" value={f.resistance} placeholder="e.g., 0.151" onChange={(v) => update("resistance", v)} />
            <InputField label="Stop (required)" value={f.stop} placeholder="Click chart or type" onChange={(v) => update("stop", v)} />
            <InputField label="Target (recommended)" value={f.target} placeholder="Click chart or type" onChange={(v) => update("target", v)} />
          </div>

          {/* SIZING */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #2cff9c22" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={styles.sectionTitle}>RISK + SIZING (NO KEYS)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill text={`Qty≈${format(sizingComputed.metrics.qty, 6)} ${f.asset}`} />
                <Pill text={`Liq≈${format(sizingComputed.metrics.liqPriceApprox, 2)}`} />
              </div>
            </div>

            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
              Liquidation is <b>approx</b>. Exchanges use tiered maintenance margin and fee rules. Use this as a safety margin check.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <InputField label="Equity (USDT)" value={f.sizing.equityUSDT} onChange={(v) => updateSizing("equityUSDT", v)} placeholder="e.g., 10000" />
              <InputField label="Risk % per trade" value={f.sizing.riskPct} onChange={(v) => updateSizing("riskPct", v)} placeholder="e.g., 0.5" />

              <SelectField label="Leverage (isolated)" value={String(f.sizing.leverage)} options={OPTIONS.leverage.map(String)} onChange={(v) => updateSizing("leverage", v)} hint="Used for liquidation approximation + margin display." />
              <InputField label="Maintenance margin % (MMR)" value={f.sizing.mmrPct} onChange={(v) => updateSizing("mmrPct", v)} placeholder="e.g., 0.5" />

              <InputField label="Fee % (rough, round-trip)" value={f.sizing.feePct} onChange={(v) => updateSizing("feePct", v)} placeholder="e.g., 0.08" />
              <InputField label="Min stop→liq buffer %" value={f.sizing.liqBufferPct} onChange={(v) => updateSizing("liqBufferPct", v)} placeholder="e.g., 2" hint="Default=2%. If stop is too close to liquidation, score is penalized and warnings appear." />
            </div>

            <div style={{ marginTop: 10, padding: 12, borderRadius: 16, border: "1px solid #2cff9c22", background: "#06120e" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 12, opacity: 0.95 }}>
                <div>Risk (USDT): <b>{format(sizingComputed.metrics.riskUSDT, 2)}</b></div>
                <div>Notional (USDT): <b>{format(sizingComputed.metrics.notional, 2)}</b></div>
                <div>Init margin (USDT): <b>{format(sizingComputed.metrics.initialMargin, 2)}</b></div>
                <div>Stop→Liq buffer: <b>{format(sizingComputed.metrics.stopToLiqBufferPct, 2)}%</b></div>
                <div>PnL @ Stop (fees incl.): <b>{format(sizingComputed.metrics.pnlAtStop, 2)}</b></div>
                <div>PnL @ Target (fees incl.): <b>{format(sizingComputed.metrics.pnlAtTarget, 2)}</b></div>
              </div>

              {sizingComputed.warnings?.length ? (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                  {sizingComputed.warnings.map((w, i) => (<div key={i}>⚠️ {w}</div>))}
                </div>
              ) : null}
            </div>
          </div>

          {/* Macro */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #2cff9c22" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={styles.sectionTitle}>MACRO CATALYSTS (MANUAL)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill text={`Macro: ${macroComputed.level}`} />
                <Pill text={`Score≈${format(macroComputed.score, 2)}`} />
              </div>
            </div>

            <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
              {MACRO_EVENTS.map((e) => (
                <div key={e.key} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "center", padding: "8px 10px", border: "1px solid #2cff9c22", borderRadius: 16, background: "#06120e" }}>
                  <input type="checkbox" checked={!!f.macro[e.key]?.enabled} onChange={(ev) => updateMacro(e.key, { enabled: ev.target.checked })} />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ opacity: 0.95 }}>{e.label}</span>
                    <Pill text={`Tier ${e.tier}`} />
                    <Pill text={`w=${e.base}`} />
                  </div>
                  <select value={f.macro[e.key]?.time || "3–7d"} onChange={(ev) => updateMacro(e.key, { time: ev.target.value })} style={styles.select} disabled={!f.macro[e.key]?.enabled}>
                    {OPTIONS.timeToEvent.map((t) => (<option key={t} value={t}>{t}</option>))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Derivs */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #2cff9c22" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={styles.sectionTitle}>BTC-LED DERIVATIVES CONTEXT (BINANCE)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Pill text={`Derivs: ${derivsComputed.level}`} />
                <Pill text={`riskPts=${derivsComputed.riskPoints}`} />
              </div>
            </div>

            <div style={{ marginTop: 10, padding: 12, borderRadius: 16, border: "1px solid #2cff9c22", background: "#06120e" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.9 }}>
                <div>Status: {f.derivs.status}{f.derivs.error ? ` — ⚠️ ${f.derivs.error}` : ""}</div>
                <div style={{ opacity: 0.7 }}>Updated: {f.derivs.updatedAt ? new Date(f.derivs.updatedAt).toLocaleString() : "-"}</div>
              </div>

              <ul style={{ marginTop: 10, marginBottom: 0, fontSize: 12, opacity: 0.95 }}>
                <li>Funding: {f.derivs.fundingRate !== null ? `${format(f.derivs.fundingRate * 100, 4)}%` : "-"}</li>
                <li>Open interest: {f.derivs.openInterest !== null ? format(f.derivs.openInterest, 0) : "-"}</li>
                <li>OI 24h Δ: {f.derivs.oiChange24hPct !== null ? `${format(f.derivs.oiChange24hPct, 2)}%` : "-"}</li>
                <li>L/S ratio: {f.derivs.longShortRatio !== null ? format(f.derivs.longShortRatio, 2) : "-"}</li>
              </ul>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button style={styles.btn} onClick={run} type="button">RUN CHECK</button>
            <button style={styles.btn} onClick={reset} type="button">RESET</button>
          </div>
        </div>

        {/* RIGHT */}
        <div style={styles.card}>
          <div style={styles.chartWrap}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={styles.sectionTitle}>CHART</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                {chartStatus.state === "error" ? `⚠️ ${chartStatus.message}` : chartStatus.message || ""}
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
              <button style={styles.btn} onClick={loadChart} type="button">LOAD CHART</button>

              <select value={clickMode} onChange={(e) => setClickMode(e.target.value)} style={{ ...styles.select, width: 220 }}>
                <option value="NONE">Click mode: off</option>
                <option value="ENTRY">Click sets: Entry</option>
                <option value="STOP">Click sets: Stop</option>
                <option value="TARGET">Click sets: Target</option>
              </select>

              <div style={{ fontSize: 12, opacity: 0.7 }}>Set mode → click chart → it fills field + draws line.</div>
            </div>

            <div style={styles.chartBox} ref={chartDivRef} />
          </div>

          <div style={styles.sectionTitle}>RESULT</div>

          {!res ? (
            <div style={{ opacity: 0.85, lineHeight: 1.4 }}>
              No result yet. Fill inputs, pick execution mode, fetch context if needed, then <b>Run check</b>.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: 2 }}>{res.verdict}</div>
                <div style={{ opacity: 0.9 }}>Score: <b>{res.score}/10</b></div>
              </div>

              <div style={{ marginTop: 10, opacity: 0.85, fontSize: 12, lineHeight: 1.4 }}>
                TF policy: <b>{res.metrics?.tfp?.bucket}</b> — {res.metrics?.tfp?.description} (min R:R ≈ {res.metrics?.tfp?.minRR})
              </div>

              {res.blockedBy?.length ? (
                <>
                  <div style={{ marginTop: 12, fontWeight: 900, letterSpacing: 1.4 }}>BLOCKED BY</div>
                  <ul style={{ marginTop: 8 }}>{res.blockedBy.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </>
              ) : null}

              {res.warnings?.length ? (
                <>
                  <div style={{ marginTop: 12, fontWeight: 900, letterSpacing: 1.4 }}>WARNINGS</div>
                  <ul style={{ marginTop: 8 }}>{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </>
              ) : null}

              <div style={{ marginTop: 12, fontWeight: 900, letterSpacing: 1.4 }}>CHECKS</div>
              <ul style={{ marginTop: 8 }}>{res.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
                <button style={styles.btn} onClick={copyJournal} type="button">COPY JOURNAL NOTE</button>
                <div style={{ opacity: 0.7, fontSize: 12 }}>(includes macro + derivs + sizing)</div>
              </div>

              <div style={{ marginTop: 12, fontWeight: 900, letterSpacing: 1.4 }}>JOURNAL PREVIEW</div>
              <pre style={styles.pre}>{journal}</pre>
            </>
          )}
        </div>
      </div>

      <div style={{ marginTop: 12, opacity: 0.65, fontSize: 12, lineHeight: 1.35 }}>
        Notes: Liquidation is an approximation; treat it as a safety margin check. Macro + derivs mostly add friction to prevent “good R:R” trades in unstable conditions.
      </div>
    </div>
  );
}
