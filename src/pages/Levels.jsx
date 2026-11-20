import { useEffect, useMemo, useRef, useState } from "react";
import { createChart, LineStyle } from "lightweight-charts";
import { fetchKlinesRange, dropUnclosedCandle } from "../data/binance.js";
import { computeLevels, suggestStops, defaultStop, planTakeProfits, pricePrecision, fmt } from "../levels/levels.js";
import { Page, PageHeader, Field, Tile } from "../ui/Page.jsx";
import { ui, T, HEX, CHART_FONT, signColor } from "../ui/theme.js";

/**
 * LEVELS — support/resistance zones and a take-profit planner for
 * discretionary trades. Data comes straight from Binance in the browser (with
 * the market-data mirror as fallback), so it works on the Mac dashboard and on
 * pm-brief.com alike. The mechanical system does not use any of this.
 */

const COINS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];
const STORE_KEY = "levels.asset.v1";
const DAY_MS = 86400 * 1000;

const loadAsset = () => { try { return localStorage.getItem(STORE_KEY) || "BTC"; } catch { return "BTC"; } };
const saveAsset = (a) => { try { localStorage.setItem(STORE_KEY, a); } catch { /* private window */ } };
const pct = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%` : "–");

export default function Levels() {
  const [asset, setAsset] = useState(loadAsset);
  const [custom, setCustom] = useState("");
  const [status, setStatus] = useState({ state: "idle", message: "" });
  const [data, setData] = useState(null); // { asset, daily, weekly, price, levels }
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");

  const chartEl = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const linesRef = useRef([]);

  async function load(sym = asset) {
    const a = String(sym || "").trim().toUpperCase();
    if (!a) return;
    setStatus({ state: "loading", message: `Loading ${a}…` });
    try {
      const now = Date.now();
      const [weeklyRaw, dailyRaw] = await Promise.all([
        fetchKlinesRange({ asset: a, timeframe: "1W", startTime: now - 3.5 * 365 * DAY_MS }),
        fetchKlinesRange({ asset: a, timeframe: "1D", startTime: now - 420 * DAY_MS }),
      ]);
      if (!dailyRaw.length) throw new Error(`No Binance data for ${a}USDT.`);
      const daily = dropUnclosedCandle(dailyRaw);
      const weekly = dropUnclosedCandle(weeklyRaw);
      const price = dailyRaw.at(-1).close; // live price from the forming bar
      const levels = computeLevels({ daily, weekly, price });
      setData({ asset: a, daily: dailyRaw, weekly, price, levels });
      const best = defaultStop(suggestStops(levels, price));
      setEntry(String(Number(price.toPrecision(6))));
      setStop(best ? String(Number(best.price.toPrecision(6))) : "");
      setAsset(a);
      saveAsset(a);
      setStatus({ state: "ok", message: "" });
    } catch (e) {
      setStatus({ state: "error", message: String(e.message || e) });
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const entryN = Number(entry);
  const stopN = Number(stop);
  const plan = useMemo(
    () => (data?.levels && entry && stop ? planTakeProfits({ entry: entryN, stop: stopN, levels: data.levels }) : null),
    [data, entry, stop, entryN, stopN],
  );
  const stops = useMemo(() => (data?.levels ? suggestStops(data.levels, Number(entry) || data.price) : []), [data, entry]);

  // Chart: created once, data and lines replaced on each load / plan change.
  useEffect(() => {
    const el = chartEl.current;
    if (!el) return;
    const chart = createChart(el, {
      width: el.clientWidth || 800,
      height: 420,
      layout: { background: { color: HEX.panel }, textColor: HEX.muted, fontFamily: CHART_FONT },
      grid: { vertLines: { visible: false }, horzLines: { color: HEX.line } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false },
    });
    const series = chart.addCandlestickSeries({
      upColor: HEX.up, downColor: HEX.down, borderVisible: false, wickUpColor: HEX.up, wickDownColor: HEX.down,
    });
    chartRef.current = chart;
    seriesRef.current = series;
    const onResize = () => chart.applyOptions({ width: el.clientWidth || 800 });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { chart.remove(); } catch { /* already gone */ }
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !data) return;
    if (chartEl.current) chartRef.current?.applyOptions({ width: chartEl.current.clientWidth || 800 });
    const precision = pricePrecision(data.price);
    series.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
    series.setData(data.daily.slice(-260).map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close })));
    for (const l of linesRef.current) { try { series.removePriceLine(l); } catch { /* stale */ } }
    linesRef.current = [];
    const add = (price, color, title, style = LineStyle.Dashed, width = 1) => {
      if (!Number.isFinite(price)) return;
      linesRef.current.push(series.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
    };
    const lv = data.levels;
    lv?.resistances.forEach((z, i) => add(z.low, HEX.down, `R${i + 1} · ${z.touches}×`));
    lv?.supports.forEach((z, i) => add(z.high, HEX.up, `S${i + 1} · ${z.touches}×`));
    if (lv?.refs.sma50w) add(lv.refs.sma50w, HEX.accent, "50W avg", LineStyle.Dotted);
    if (plan && !plan.error) {
      add(entryN, HEX.ink, "Entry", LineStyle.Solid);
      add(stopN, HEX.down, "Stop", LineStyle.Solid, 2);
      plan.targets.filter((t) => t.price).forEach((t) => add(t.price, HEX.info, t.name, LineStyle.Solid, 2));
    }
    try { chartRef.current?.timeScale()?.fitContent(); } catch { /* empty */ }
  }, [data, plan, entryN, stopN]);

  const lv = data?.levels;
  const nearestS = lv?.supports[0];
  const nearestR = lv?.resistances[0];

  return (
    <Page>
      <PageHeader
        eyebrow="Levels · support, resistance and take-profit"
        title="Levels"
        actions={<button style={ui.btnPrimary} onClick={() => load(custom || asset)} disabled={status.state === "loading"}>{status.state === "loading" ? "Loading…" : "Load"}</button>}
      >
        <p style={ui.small}>
          Support and resistance zones from weekly and daily swing points, and a take-profit plan for a long trade.
          For discretionary trades only: the mechanical system exits on the 10-day low and ignores these levels.
        </p>
      </PageHeader>

      <section style={ui.panel}>
        <div style={ui.controls}>
          <Field label="Coin">
            <select style={ui.input} value={COINS.includes(asset) ? asset : ""} onChange={(e) => { setCustom(""); load(e.target.value); }}>
              {COINS.map((c) => <option key={c} value={c}>{c}</option>)}
              {!COINS.includes(asset) && <option value="">{asset}</option>}
            </select>
          </Field>
          <Field label="Other Binance coin" hint="Ticker against USDT, e.g. QNT, HBAR. Press Enter or Load.">
            <input style={ui.input} value={custom} placeholder="e.g. QNT" onChange={(e) => setCustom(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter") load(custom); }} />
          </Field>
        </div>
        {status.state === "error" && <div style={ui.bannerBad}>{status.message}</div>}
      </section>

      {lv && (
        <>
          <div style={ui.tiles}>
            <Tile label={`${data.asset} price`} value={fmt(data.price)} sub={`daily ATR ${fmt(lv.atr)} (${((lv.atr / data.price) * 100).toFixed(1)}%)`} />
            <Tile label="Nearest support" value={nearestS ? fmt(nearestS.high) : "–"} sub={nearestS ? `${pct(nearestS.distPct)} · ${nearestS.touches} touches` : "none below"} />
            <Tile label="Nearest resistance" value={nearestR ? fmt(nearestR.low) : "none"} sub={nearestR ? `${pct(nearestR.distPct)} · ${nearestR.touches} touches` : "price discovery"} />
            <Tile label="50-week average" value={fmt(lv.refs.sma50w)} sub={data.price > lv.refs.sma50w ? "price above · regime bullish" : "price below · regime bearish"} good={data.price > lv.refs.sma50w} bad={data.price <= lv.refs.sma50w} />
          </div>

          {lv.supports.length === 0 && (
            <div style={ui.bannerWarn}>
              No support zone below: price is under every level in the last 3 years. There's no floor to lean a stop on, so the plan uses an ATR stop.
            </div>
          )}
          {lv.atPrice.length > 0 && (
            <div style={ui.bannerWarn}>
              Price is inside a zone right now ({lv.atPrice.map((z) => `${fmt(z.low)}–${fmt(z.high)}`).join(", ")}). Expect chop until it clearly leaves it.
            </div>
          )}

        </>
      )}

      {/* One chart container, always mounted (createChart runs once), hidden until data loads. */}
      <section style={lv ? ui.panel : { display: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
          <h2 style={ui.h2}>{data?.asset} daily chart</h2>
          <span style={ui.small}>
            <span style={{ color: T.up }}>S</span> support · <span style={{ color: T.down }}>R</span> resistance · <span style={{ color: T.accent }}>50W avg</span> · <span style={{ color: T.info }}>TP</span> targets · 3× = touches
          </span>
        </div>
        <div ref={chartEl} style={{ width: "100%", minWidth: 0 }} />
      </section>
      {!lv && status.state === "ok" && <div style={ui.empty}>Not enough history to find levels for this coin.</div>}

      {lv && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18 }}>
            <ZoneTable title="Resistance above" zones={lv.resistances} price={data.price} empty="None in 3 years of data: price discovery. Use R-multiples for targets." prefix="R" color={T.down} />
            <ZoneTable title="Support below" zones={lv.supports} price={data.price} empty="No support zone below in the data." prefix="S" color={T.up} />
          </div>

          <section style={ui.panel}>
            <h2 style={ui.h2}>Take-profit plan (long)</h2>
            <div style={ui.controls}>
              <Field label="Entry" hint="Defaults to the current price.">
                <input style={ui.input} inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} />
              </Field>
              <Field label="Stop" hint={stops.length ? "Suggestions below; click one to use it." : "Below the nearest support."}>
                <input style={ui.input} inputMode="decimal" value={stop} onChange={(e) => setStop(e.target.value)} />
              </Field>
            </div>
            {stops.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {stops.map((s) => (
                  <button key={s.label} style={ui.btnSmall} onClick={() => setStop(String(Number(s.price.toPrecision(6))))}
                    title={s.tooTight ? "Less than one day's average range away: normal noise can hit it." : s.tooWide ? "More than 4 days' average range away: the position gets very small." : ""}>
                    {s.label}: {fmt(s.price)} ({pct(((s.price - entryN) / entryN) * 100)})
                    {s.tooTight ? <span style={{ color: T.warn }}> · too tight</span> : s.tooWide ? <span style={{ color: T.warn }}> · wide</span> : null}
                  </button>
                ))}
              </div>
            )}

            {plan?.error && <div style={ui.bannerBad}>{plan.error}</div>}
            {plan && !plan.error && (
              <>
                <div style={ui.small}>
                  Risk per unit {fmt(plan.R)} ({plan.riskPct.toFixed(1)}% from entry). 1R = that distance.
                </div>
                {plan.warnings.map((w) => <div key={w} style={ui.bannerWarn}>{w}</div>)}
                <div style={ui.tableWrap}>
                  <table style={ui.table}>
                    <thead><tr>{["Target", "Price", "R", "Gain", "Sell", "Why"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {plan.targets.map((t) => (
                        <tr key={t.name}>
                          <td style={{ ...ui.td, color: T.info, fontWeight: 600 }}>{t.name}</td>
                          <td style={ui.td}>{t.price ? fmt(t.price) : "trailing"}</td>
                          <td style={ui.td}>{t.r !== null ? `${t.r.toFixed(1)}R` : "–"}</td>
                          <td style={{ ...ui.td, color: signColor(t.pct) }}>{t.pct !== null ? pct(t.pct) : "–"}</td>
                          <td style={ui.td}>{t.sell}%</td>
                          <td style={{ ...ui.td, whiteSpace: "normal", fontFamily: T.body, color: T.muted, minWidth: 220 }}>{t.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={ui.tableWrap}>
                  <table style={ui.table}>
                    <thead><tr>{["Plain R-multiple", "Price", "Gain", "In the way"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
                    <tbody>
                      {plan.rTargets.map((t) => (
                        <tr key={t.r}>
                          <td style={ui.td}>{t.r}R</td>
                          <td style={ui.td}>{fmt(t.price)}</td>
                          <td style={{ ...ui.td, color: signColor(t.pct) }}>{pct(t.pct)}</td>
                          <td style={{ ...ui.td, whiteSpace: "normal", fontFamily: T.body, color: t.blockedBy ? T.warn : T.muted }}>
                            {t.blockedBy ? `resistance ${fmt(t.blockedBy.low)}–${fmt(t.blockedBy.high)} first` : "clear"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <p style={ui.foot}>
            How levels are found: swing highs and lows (a bar that is the extreme of the bars on either side) over 3 years of weekly and
            about 1 year of daily candles, merged into zones about one daily ATR wide. Strength counts touches, with weekly touches worth 3×,
            older touches fading, and a bonus for zones that were both support and resistance. Levels are areas, not exact prices:
            targets sit a little under resistance because sellers show up early. The system's own lines today: entry above
            {" "}{fmt(lv.refs.breakout20)} (20-day close high), exit below {fmt(lv.refs.trail10)} (10-day close low).
          </p>
        </>
      )}
    </Page>
  );
}

function ZoneTable({ title, zones, price, empty, prefix, color }) {
  return (
    <section style={ui.panel}>
      <h2 style={ui.h2}>{title}</h2>
      {zones.length === 0 ? <p style={ui.small}>{empty}</p> : (
        <div style={ui.tableWrap}>
          <table style={ui.table}>
            <thead><tr>{["", "Zone", "Distance", "Touches", "Strength"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
            <tbody>
              {zones.map((z, i) => (
                <tr key={z.low}>
                  <td style={{ ...ui.td, color, fontWeight: 600 }}>{prefix}{i + 1}</td>
                  <td style={ui.td}>{fmt(z.low) === fmt(z.high) ? fmt(z.low) : `${fmt(z.low)}–${fmt(z.high)}`}{z.flip ? <span style={{ ...ui.badge, marginLeft: 6, background: T.warnBg, color: T.warn }}>flip</span> : null}</td>
                  <td style={ui.td}>{pct(((z.edge - price) / price) * 100)}</td>
                  <td style={ui.td}>{z.touches}{z.weeklyTouches ? ` (${z.weeklyTouches}W)` : ""}</td>
                  <td style={ui.td}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 54, height: 6, borderRadius: 3, background: T.flatBg, display: "inline-block", overflow: "hidden" }}>
                        <i style={{ display: "block", height: "100%", width: `${z.strength}%`, background: color }} />
                      </span>
                      {z.strength}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
