import { useEffect, useRef, useState } from "react";
import { createChart } from "lightweight-charts";
import { fetchKlinesRange, fetchFundingHistory, dropUnclosedCandle, binanceSymbol } from "../data/binance.js";
import { productionEngineOptions } from "../strategy/presets.js";
import { backtestOne } from "../backtest/engine.js";
import { computeMetrics } from "../backtest/metrics.js";
import { T, HEX, CHART_FONT, ui } from "../ui/theme.js";
import { Page, PageHeader, Field, Tile } from "../ui/Page.jsx";

const UNIVERSE = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const START_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

const LS_KEY = "backtest.config.v1";
const DEFAULT_CFG = { asset: "BTC", startYear: 2020, equity: 100000, riskPct: 1, feePct: 0.08 };

function loadCfg() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT_CFG;
    return { ...DEFAULT_CFG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CFG;
  }
}
function saveCfg(cfg) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* empty */ }
}

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function fmtDate(unixSecs) {
  if (!unixSecs) return "-";
  return new Date(unixSecs * 1000).toISOString().slice(0, 10);
}

export default function Backtest() {
  const [cfg, setCfg] = useState(loadCfg());
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [result, setResult] = useState(null);

  const chartDivRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

  useEffect(() => { saveCfg(cfg); }, [cfg]);

  useEffect(() => {
    const el = chartDivRef.current;
    if (!el) return;

    const chart = createChart(el, {
      width: el.clientWidth || 800,
      height: 300,
      layout: { background: { color: HEX.panel }, textColor: HEX.muted, fontFamily: CHART_FONT },
      grid: { vertLines: { visible: false }, horzLines: { color: HEX.line } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const series = chart.addAreaSeries({
      lineColor: HEX.accent,
      topColor: `${HEX.accent}40`,
      bottomColor: `${HEX.accent}05`,
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const onResize = () => chart.applyOptions({ width: el.clientWidth || 800 });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { chart.remove(); } catch { /* empty */ }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!result || !seriesRef.current) return;
    seriesRef.current.setData(
      result.equityCurve.map((p) => ({ time: p.time, value: p.equity })),
    );
    try { chartRef.current?.timeScale()?.fitContent(); } catch { /* empty */ }
  }, [result]);

  async function run() {
    setStatus({ state: "loading", message: "Fetching history..." });
    setResult(null);
    try {
      const startTime = Date.UTC(Number(cfg.startYear), 0, 1);
      const [weeklyRaw, dailyRaw] = await Promise.all([
        // weekly needs ~50 extra bars of warmup history before the start date for the 50W SMA
        fetchKlinesRange({ asset: cfg.asset, timeframe: "1W", startTime: startTime - 55 * 7 * 86400 * 1000 }),
        fetchKlinesRange({ asset: cfg.asset, timeframe: "1D", startTime }),
      ]);
      const weekly = dropUnclosedCandle(weeklyRaw);
      const daily = dropUnclosedCandle(dailyRaw);

      if (daily.length < 60) throw new Error(`Only ${daily.length} daily candles — not enough history for ${cfg.asset} from ${cfg.startYear}.`);

      // Funding is best-effort: the validation charged it, but a failed fetch
      // must not block the replay (the status line says so).
      let funding = null;
      try { funding = await fetchFundingHistory({ asset: cfg.asset, startTime }); } catch { funding = null; }

      setStatus({ state: "loading", message: `Replaying ${daily.length} days...` });

      const bt = backtestOne({
        asset: cfg.asset,
        weekly,
        daily,
        startEquity: Number(cfg.equity) || 100000,
        riskPct: Number(cfg.riskPct) || 1,
        ...productionEngineOptions(),
        feePct: Number(cfg.feePct) || 0,
        funding,
      });
      const metrics = computeMetrics(bt);
      setResult({ ...bt, metrics, candles: daily.length });
      setStatus({ state: "ok", message: `Done: ${daily.length} days, ${bt.trades.length} trades.${funding?.length ? "" : " Funding history unavailable, so funding was not charged."}` });
    } catch (e) {
      setStatus({ state: "error", message: e?.message || "Backtest failed." });
    }
  }

  const m = result?.metrics;

  return (
    <Page>
      <PageHeader
        eyebrow="Historical replay · Crypto System v2.0"
        title="Backtest"
        actions={
          <button style={ui.btnPrimary} onClick={run} type="button" disabled={status.state === "loading"}>
            {status.state === "loading" ? "Running…" : "Run backtest"}
          </button>
        }
      >
        <p className="muted">
          The production v2 rules on ONE coin, with fees, slippage and funding, but without the
          portfolio rules (max positions, one entry a day), so trades can differ from the Paper tab.
          Weekly regime → daily Donchian-20 breakout →
          fixed-fractional risk → Donchian-10 trail. If you wouldn't have followed this
          equity curve through its worst stretch, don't trade it live.
        </p>
      </PageHeader>

      <section style={ui.panel} aria-label="Backtest settings">
        <div style={ui.controls}>
          <Field label="Asset">
            <select value={cfg.asset} onChange={(e) => setCfg({ ...cfg, asset: e.target.value })} style={ui.input}>
              {UNIVERSE.map((a) => <option key={a} value={a}>{binanceSymbol(a)}</option>)}
            </select>
          </Field>
          <Field label="From year">
            <select value={cfg.startYear} onChange={(e) => setCfg({ ...cfg, startYear: e.target.value })} style={ui.input}>
              {START_YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </Field>
          <Field label="Start equity">
            <input value={cfg.equity} onChange={(e) => setCfg({ ...cfg, equity: e.target.value })} style={ui.input} />
          </Field>
          <Field label="Risk %">
            <input value={cfg.riskPct} onChange={(e) => setCfg({ ...cfg, riskPct: e.target.value })} style={ui.input} />
          </Field>
          <Field label="Fee % (per side)">
            <input value={cfg.feePct} onChange={(e) => setCfg({ ...cfg, feePct: e.target.value })} style={ui.input} />
          </Field>
        </div>
        {status.message ? (
          <p style={{ fontSize: 13, color: status.state === "error" ? T.down : T.muted }}>
            {status.state === "error" ? "⚠️ " : ""}{status.message}
          </p>
        ) : null}
      </section>

      <section style={ui.panel}>
        <h2 style={ui.h2}>Equity curve</h2>
        <div ref={chartDivRef} style={{ borderRadius: 6, overflow: "hidden" }} />
      </section>

      {m ? (
        <>
          <div style={ui.tiles}>
            <Tile label="Trades" value={String(m.numTrades)} />
            <Tile label="Win rate" value={`${fmt(m.winRate * 100, 1)}%`} />
            <Tile label="Expectancy" value={`${fmt(m.expectancyR, 2)}R`} sub={`${fmt(m.expectancy, 0)} USDT`} />
            <Tile label="Profit factor" value={m.profitFactor === Infinity ? "∞" : fmt(m.profitFactor, 2)} />
            <Tile label="Total return" value={`${fmt(m.totalReturnPct, 1)}%`} sub={`${fmt(m.totalReturn, 0)} USDT`} good={m.totalReturn > 0} bad={m.totalReturn < 0} />
            <Tile label="CAGR" value={`${fmt(m.cagr, 1)}%`} />
            <Tile label="Max drawdown" value={`${fmt(m.maxDDPct, 1)}%`} sub={`${fmt(m.maxDD, 0)} USDT / ${fmt(m.maxDDDays, 0)}d`} bad={m.maxDDPct > 20} />
            <Tile label="Avg hold" value={`${fmt(m.avgBarsHeld, 0)} days`} />
            <Tile label="Avg win" value={fmt(m.avgWin, 0)} />
            <Tile label="Avg loss" value={fmt(m.avgLoss, 0)} />
            <Tile label="Best trade" value={fmt(m.bestTrade?.pnl, 0)} />
            <Tile label="Worst trade" value={fmt(m.worstTrade?.pnl, 0)} />
          </div>

          {m.maxDDPct > 20 ? (
            <div style={ui.bannerWarn}>
              ⚠️ Max drawdown {fmt(m.maxDDPct, 1)}% exceeds your 20% circuit-breaker threshold.
              Either reduce risk % or accept that you WILL see this drawdown live and plan for it.
            </div>
          ) : null}

          <div style={{ ...ui.tableWrap, maxHeight: 480 }}>
            <h2 style={{ ...ui.h2, padding: "14px 12px 6px" }}>Trades ({result.trades.length})</h2>
            <table style={ui.table}>
              <thead>
                <tr>
                  <th style={styles.th}>#</th>
                  <th style={styles.th}>Dir</th>
                  <th style={styles.th}>Entry date</th>
                  <th style={styles.th}>Entry</th>
                  <th style={styles.th}>Exit date</th>
                  <th style={styles.th}>Exit</th>
                  <th style={styles.th}>Days</th>
                  <th style={styles.th}>PnL</th>
                  <th style={styles.th}>R</th>
                  <th style={styles.th}>Exit reason</th>
                </tr>
              </thead>
              <tbody>
                {result.trades.map((t, i) => (
                  <tr key={i}>
                    <td style={styles.td}>{i + 1}</td>
                    <td style={{ ...styles.td, color: t.direction === "LONG" ? T.up : T.down }}>{t.direction}</td>
                    <td style={styles.td}>{fmtDate(t.entryTime)}</td>
                    <td style={styles.td}>{fmt(t.entry, 4)}</td>
                    <td style={styles.td}>{fmtDate(t.exitTime)}</td>
                    <td style={styles.td}>{fmt(t.exit, 4)}</td>
                    <td style={styles.td}>{t.barsHeld}</td>
                    <td style={{ ...styles.td, color: t.pnl >= 0 ? T.up : T.down }}>{fmt(t.pnl, 0)}</td>
                    <td style={{ ...styles.td, color: t.rMultiple >= 0 ? T.up : T.down }}>{fmt(t.rMultiple, 2)}</td>
                    <td style={{ ...styles.td, fontFamily: T.body, color: T.muted }}>{t.exitReason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div style={ui.empty}>
          Pick asset + start year, click RUN BACKTEST. Single asset for now — portfolio-level
          replay (correlation caps, 1-entry-per-day across assets) comes later.
        </div>
      )}
    </Page>
  );
}

const styles = {
  th: ui.th,
  td: ui.td,
};
