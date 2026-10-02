import { useEffect, useState, Fragment } from "react";
import { useLang, translator } from "../i18n.js";
import { SCOUT_STRINGS, SCOUT_GUIDE, translateReason, translateReasons } from "./scout.i18n.js";

/**
 * SCOUT — narrative discovery dashboard. Reads the snapshot the Mac mini's
 * scout job writes (data/scout/latest.json, served by the dev server at
 * /scout-data/latest.json). Nothing here fetches markets itself; the job does
 * the work hourly so the page opens instantly and shows the same numbers the
 * phone alerts were based on.
 *
 * Visual language follows the Narrative Scout concept page: slate panels,
 * amber accent, IBM Plex type, heatmap cells for relative strength.
 *
 * Bilingual: every label comes from scout.i18n.js via `t`, following whatever
 * language the host page is set to (src/i18n.js). Coin names, tickers and shell
 * commands stay as they are in every language.
 */

// On the Mac's dashboard the dev server serves the local snapshot. The static
// build (pm-brief.com) reads the copy the Mac publishes to the public
// scout-data branch (see scripts/lib/publish.mjs).
const PUBLIC_SNAPSHOT_URL = "https://raw.githubusercontent.com/ear2earGrin/crypto-entry-checker/scout-data/latest.json";
const DATA_URL = import.meta.env.PROD ? PUBLIC_SNAPSHOT_URL : "/scout-data/latest.json";

const pct = (x, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}%`);
const usd = (x) => {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(2)}B`;
  if (Math.abs(x) >= 1e6) return `$${(x / 1e6).toFixed(1)}M`;
  if (Math.abs(x) >= 1e3) return `$${(x / 1e3).toFixed(1)}k`;
  return `$${x.toFixed(2)}`;
};
const px = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x >= 100 ? x.toFixed(2) : x >= 1 ? x.toFixed(4) : x.toPrecision(4));
// "3h ago" is a phrase, so it needs the page's `t` passed in.
const agoWith = (t) => (iso) => {
  if (!iso) return t("none");
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return t("minsAgo", m);
  if (m < 48 * 60) return t("hoursAgo", Math.round(m / 60));
  return t("daysAgo", Math.round(m / 1440));
};
const ymd = (unix) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : "–");

// Heatmap shade for a BTC-relative return.
const heat = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "z" : x >= 10 ? "p2" : x > 1 ? "p1" : x >= -1 ? "z" : x > -10 ? "n1" : "n2");
const signClass = (x) => (x === null || x === undefined || !Number.isFinite(x) ? "" : x > 0 ? "up" : x < 0 ? "down" : "");
const STAGE_CLASS = { ACCELERATING: "s-acc", EMERGING: "s-em", MAINSTREAM: "s-main", EXHAUSTING: "s-exh", COLD: "s-cold", UNKNOWN: "s-cold" };

function Bar({ value, invert = false }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  const good = invert ? 100 - v : v;
  const color = good >= 70 ? "var(--up)" : good >= 45 ? "var(--accent)" : "var(--down)";
  return (
    <span className="bar-wrap">
      <span className="bar"><i style={{ width: `${v}%`, background: color }} /></span>
      <span className="mono">{value ?? "–"}</span>
    </span>
  );
}

export default function Scout() {
  const lang = useLang();
  const t = translator(SCOUT_STRINGS, lang);
  const ago = agoWith(t);

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [grades, setGrades] = useState({ A: true, B: true, C: false });
  const [showRejects, setShowRejects] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [check, setCheck] = useState(null);

  // manual = the Reload button: report whether a newer snapshot arrived, since
  // the page otherwise looks identical between the Mac's hourly publishes.
  async function load(manual = false) {
    setLoading(true);
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "no-data" : `HTTP ${res.status}`);
      const next = await res.json();
      const stamp = (d) => `${d?.generatedAt}|${d?.newsUpdatedAt}`;
      if (manual) setCheck({ at: Date.now(), changed: stamp(next) !== stamp(data), newsUpdatedAt: next.newsUpdatedAt });
      setData(next);
      setError(null);
    } catch (e) {
      setError(String(e.message || e));
      if (manual) setCheck({ at: Date.now(), error: String(e.message || e) });
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) {
    return (
      <div className="ns">
        <style>{CSS}</style>
        <div className="wrap">
          <Header onRefresh={() => load(true)} loading={loading} check={check} t={t} ago={ago} />
          <section className="panel">
            {loading ? <p className="muted">{t("loadingScan")}</p> : (
              <>
                <h3>{t("noDataYet")}{error && error !== "no-data" ? ` (${error})` : ""}</h3>
                {import.meta.env.PROD ? (
                  <p className="muted">{t("noDataProd")} <span className="mono ink">echo on &gt; data/scout/publish.txt &amp;&amp; node scripts/scout.mjs --publish-now</span></p>
                ) : (
                  <>
                    <p className="muted">{t("noDataDev")}</p>
                    <pre className="pre">{`git pull\nnpm install\nnode scripts/scout.mjs        ${t("cmdFirstScan")}\nnode scripts/scout-install.mjs ${t("cmdInstall")}`}</pre>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    );
  }

  const { book, gauge, funnel, btcRegime } = data;
  const bull = btcRegime?.state === "LONG_OK";
  const news = (data.news || []).filter((n) => grades[n.grade]);
  const cfg = data.bookConfig || {};

  return (
    <div className="ns">
      <style>{CSS}</style>
      <div className="wrap">
        <Header onRefresh={() => load(true)} loading={loading} data={data} check={check} t={t} ago={ago} />

        <Guide lang={lang} t={t} open={showGuide} onToggle={() => setShowGuide(!showGuide)} />

        {data.selftest && <div className="banner warn"><b>{t("selftestTitle")}</b> {t("selftestBody")}</div>}
        {data.scanError && (
          <div className="banner bad">
            <b>{t("scanFailedTitle", ago(data.scanError.at))}</b> CoinGecko: {data.scanError.coingecko?.ok ? t("sourceOk") : data.scanError.coingecko?.error || t("sourceUnreached")} · Binance: {data.scanError.binance?.ok ? t("sourceOk") : data.scanError.binance?.error || t("sourceUnreached")}.
            {data.scanDay ? t("lastGoodScan", data.scanDay) : t("neverScanned")}{t("retriesHourly")}
          </div>
        )}
        {!bull && !data.scanError && (
          <div className="banner bad"><b>{t("regimeBannerTitle", btcRegime?.state ?? t("unknown"))}</b> {t("regimeBannerBody")}</div>
        )}

        <section className="rule" aria-label={t("ruleAria")}>
          <div><span className="eyebrow">{t("narrativeDecides")}</span><b>{t("whatToWatch")}</b><span className="muted">{t("scoutBuilds")}</span></div>
          <div><span className="eyebrow">{t("priceDecides")}</span><b>{t("when")}</b><span className="muted">{t("pickRuleFires")}</span></div>
          <div><span className="eyebrow">{t("riskDecides")}</span><b>{t("howMuch")}</b><span className="muted">{t("testPerPick", usd(cfg.testAmount))}</span></div>
        </section>

        <div className="grid2">
          <section className="panel">
            <div className="panel-head"><h2>{t("rotationBoard")}</h2><span className="chip live">{t("live")}</span></div>
            <p className="muted small">{t("rotationHelp")}</p>
            <div className="scroll">
              <table>
                <thead><tr><th>{t("thNarrative")}</th><th>{t("th7dVsBtc")}</th><th>{t("th30d")}</th><th>{t("th200d")}</th><th>{t("thBreadth")}</th><th>{t("thHeat")}</th><th>{t("thStage")}</th></tr></thead>
                <tbody>
                  {(data.narratives || []).map((b) => (
                    <tr key={b.key}>
                      <td>
                        {b.name}
                        {b.leader && <div className="tiny muted">{t("leader", b.leader.symbol)} <span className={signClass(b.leader.rs7)}>{pct(b.leader.rs7, 0)}</span> {t("sevenD")}</div>}
                        {b.singleCoinEvent && <div className="tiny warn-text">{t("oneCoinCarrying")}</div>}
                        {b.missing?.length > 0 && <div className="tiny muted">{t("coinsOutsideTop", b.missing.length)}</div>}
                      </td>
                      <td className={`heat ${heat(b.rs7)}`}>{pct(b.rs7, 0)}</td>
                      <td className={`heat ${heat(b.rs30)}`}>{pct(b.rs30, 0)}</td>
                      <td className={`heat ${heat(b.rs200)}`}>{pct(b.rs200, 0)}</td>
                      <td className="mono">{b.breadth30 === null || b.breadth30 === undefined ? "–" : `${b.breadth30.toFixed(0)}%`}</td>
                      <td><Bar value={b.heat} /></td>
                      <td><span className={`stage ${STAGE_CLASS[b.stage] || "s-cold"}`}>{b.stage ? t(b.stage) : "–"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.categories?.length > 0 && (
              <div className="cats">
                <span className="muted">{t("hottestCategories")}</span>
                {data.categories.slice(0, 8).map((c) => <span key={c.id} className="tag">{c.name} <b className={signClass(c.change24h)}>{pct(c.change24h)}</b></span>)}
              </div>
            )}
          </section>

          <div className="stack">
            <section className="panel">
              <div className="panel-head"><h3>{t("btcRegime")}</h3><span className={`chip ${bull ? "live" : "bad"}`}>{bull ? t("bull") : (btcRegime?.state || t("unknown")).toLowerCase()}</span></div>
              <p className="muted small">
                {btcRegime?.close ? <>{t("weeklyClosePre")}<b className="ink mono">{Math.round(btcRegime.close).toLocaleString("en-US")}</b>{t("weeklyCloseMid")}<b className="ink mono">{Math.round(btcRegime.sma).toLocaleString("en-US")}</b>{". "}</> : null}
                {t("masterSwitch")}
              </p>
            </section>
            <section className="panel">
              <div className="panel-head"><h3>{t("altSeasonGauge")}</h3><span className="chip">{gauge?.label ? t(gauge.label) : "–"}</span></div>
              <div className="gauge" role="img" aria-label={t("gaugeAria", gauge?.score ?? t("unknown"))}>
                <div className="track">{gauge?.score !== null && gauge?.score !== undefined && <span className="needle" style={{ left: `${gauge.score}%` }} />}</div>
                <div className="ends"><span>{t("btcLeading")}</span><span className="mono ink">{gauge?.score ?? "–"}</span><span>{t("altsLeading")}</span></div>
              </div>
              <p className="muted small">
                {gauge?.share30 !== null && gauge?.share30 !== undefined
                  ? t("gaugeShares", gauge.share30.toFixed(0), gauge.sample, gauge.share200?.toFixed(0))
                  : ""}
                {t("altSeasonIs")}
              </p>
            </section>
            <section className="panel">
              <div className="panel-head"><h3>{t("todaysFunnel")}</h3><span className="chip">{data.scanDay || "–"}</span></div>
              <div className="funnel">
                {[
                  [funnel?.universe, "funnelUniverse"],
                  [funnel?.gated, "funnelGated"],
                  [funnel?.watchlist, "funnelWatchlist"],
                  [funnel?.eligible, "funnelEligible"],
                  [funnel?.picked, "funnelPicked"],
                ].map(([n, key]) => <div key={key}><span className="n mono">{n ?? "–"}</span><span className="f">{t(key)}</span></div>)}
              </div>
            </section>
          </div>
        </div>

        <section className="panel">
          <div className="panel-head"><h2>{t("testBook")}</h2><span className="chip">{t("paperWith", usd(cfg.startCash))}</span></div>
          <div className="tiles">
            <div className="tile"><span className="l">{t("equity")}</span><span className={`v ${Math.abs(book?.returnPct ?? 0) < 0.05 ? "" : signClass(book?.returnPct)}`}>{usd(book?.equity)}</span><span className="muted small">{t("sinceStart", pct(book?.returnPct))}</span></div>
            <div className="tile"><span className="l">{t("cashFree")}</span><span className="v">{usd(book?.cash)}</span><span className="muted small">{t("slotsUsed", book?.open?.length ?? 0, cfg.maxOpen ?? 5)}</span></div>
            <div className="tile"><span className="l">{t("closedTrades")}</span><span className="v">{book?.stats?.trades ?? 0}</span><span className="muted small">{t("winRateAvg", book?.stats?.winRate ?? "–", book?.stats?.avgR ?? "–")}</span></div>
            <div className="tile"><span className="l">{t("beatBtc")}</span><span className="v">{book?.stats?.beatBtcRate ?? "–"}{book?.stats?.beatBtcRate !== null && book?.stats?.beatBtcRate !== undefined ? "%" : ""}</span><span className="muted small">{t("ofClosedSameDays")}</span></div>
          </div>
          {book?.open?.length ? (
            <div className="scroll">
              <table>
                <thead><tr><th>{t("thCoin")}</th><th>{t("thOpened")}</th><th>{t("thEntry")}</th><th>{t("thStop")}</th><th>{t("thNow")}</th><th>{t("thResult")}</th><th>{t("thBtcSameDays")}</th><th>{t("thVsBtc")}</th><th>{t("thWhyPicked")}</th></tr></thead>
                <tbody>
                  {book.open.map((p) => (
                    <tr key={p.id + p.entryTime}>
                      <td><b>{p.symbol}</b> {data.picksToday?.includes(p.id) && <span className="chip live">{t("isNew")}</span>}</td>
                      <td className="mono">{p.entryDay}</td>
                      <td className="mono">{px(p.entry)}</td>
                      <td className="mono">{px(p.stop)}</td>
                      <td className="mono">{px(p.price)}</td>
                      <td className={`mono ${signClass(p.retPct)}`}>{pct(p.retPct)}</td>
                      <td className="mono">{pct(p.btcRetPct)}</td>
                      <td className={`mono ${signClass(p.vsBtcPct)}`}>{pct(p.vsBtcPct)}</td>
                      <td className="wrap-cell muted">{translateReason(p.reason, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">{t("noOpenPositions")}{bull ? t("pickNeedsRules") : t("waitingForRegime")}</p>
          )}
          {book?.closed?.length > 0 && (
            <div className="scroll">
              <table>
                <thead><tr><th>{t("thClosed")}</th><th>{t("thCoin")}</th><th>{t("thOpened")}</th><th>{t("thEntry")}</th><th>{t("thExit")}</th><th>{t("thResult")}</th><th>{t("thR")}</th><th>{t("thBtcSameDays")}</th><th>{t("thVsBtc")}</th><th>{t("thExitReason")}</th></tr></thead>
                <tbody>
                  {[...book.closed].reverse().map((trade) => (
                    <tr key={trade.id + trade.entryTime}>
                      <td className="mono">{ymd(trade.exitTime)}</td>
                      <td><b>{trade.symbol}</b></td>
                      <td className="mono">{trade.entryDay}</td>
                      <td className="mono">{px(trade.entry)}</td>
                      <td className="mono">{px(trade.exit)}</td>
                      <td className={`mono ${signClass(trade.retPct)}`}>{pct(trade.retPct)} ({usd(trade.pnl)})</td>
                      <td className="mono">{trade.r ?? "–"}</td>
                      <td className="mono">{pct(trade.btcRetPct)}</td>
                      <td className={`mono ${signClass(trade.vsBtcPct)}`}>{pct(trade.vsBtcPct)}</td>
                      <td>{translateReason(trade.exitReason, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h2>{t("watchlist")}</h2><span className="muted small">{t("clickCoin")}</span></div>
          <div className="scroll">
            <table>
              <thead><tr><th>{t("thCoin")}</th><th>{t("thNarrative")}</th><th>{t("thHeat")}</th><th>{t("thStrength")}</th><th>{t("thQuality")}</th><th>{t("thSupplyRisk")}</th><th>{t("th7dVsBtc")}</th><th>{t("th30dVsBtc")}</th><th>{t("thStatus")}</th></tr></thead>
              <tbody>
                {(data.watchlist || []).map((c) => (
                  <Fragment key={c.id}>
                    <tr className={`clickable ${open === c.id ? "open" : ""}`} onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <td><b>{c.symbol}</b> <span className="muted">{c.name}</span> {c.trending && <span className="chip info">{t("trending")}</span>}</td>
                      <td className="muted">{c.narratives?.join(", ") || "–"}</td>
                      <td><Bar value={c.scores.heat} /></td>
                      <td><Bar value={c.scores.strength} /></td>
                      <td><Bar value={c.scores.quality} /></td>
                      <td><Bar value={c.scores.supplyRisk} invert /></td>
                      <td className={`heat ${heat(c.rs7)}`}>{pct(c.rs7, 0)}</td>
                      <td className={`heat ${heat(c.rs30)}`}>{pct(c.rs30, 0)}</td>
                      <td className="status">
                        {data.picksToday?.includes(c.id) ? <span className="tier on">{t("pickedToday")}</span>
                          : c.eligible ? <span className="up">{t("eligible")}{c.bookBlockers?.length ? ` · ${translateReasons(c.bookBlockers, lang)}` : ""}</span>
                          : <span className="muted">{translateReasons(c.pickFails, lang)}</span>}
                      </td>
                    </tr>
                    {open === c.id && (
                      <tr className="card-row"><td colSpan={9}><CoinCard coin={c} explainer={data.explainers?.[c.id]} news={(data.news || []).filter((n) => n.coins?.includes(c.id))} picked={data.picksToday?.includes(c.id)} t={t} lang={lang} /></td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t("rejectedByVetoes")}</h2>
            <button className="btn small" onClick={() => setShowRejects(!showRejects)}>{showRejects ? t("hide") : t("showN", data.rejects?.length ?? 0)}</button>
          </div>
          {showRejects && (
            <div className="scroll">
              <table>
                <thead><tr><th>{t("thCoin")}</th><th>{t("th7dVsBtc")}</th><th>{t("th30dVsBtc")}</th><th>{t("thWhyRejected")}</th></tr></thead>
                <tbody>
                  {(data.rejects || []).map((c) => (
                    <tr key={c.id}>
                      <td><b>{c.symbol}</b> <span className="muted">{c.name}</span></td>
                      <td className={`heat ${heat(c.rs7)}`}>{pct(c.rs7, 0)}</td>
                      <td className={`heat ${heat(c.rs30)}`}>{pct(c.rs30, 0)}</td>
                      <td className="wrap-cell down">{translateReasons(c.vetoes, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>{t("newsRadar")}</h2>
            <div className="filters">
              <span className="muted small">{t("updatedAgo", ago(data.newsUpdatedAt))}</span>
              {["A", "B", "C"].map((g) => (
                <button key={g} className={`btn small ${grades[g] ? "" : "off"}`} onClick={() => setGrades({ ...grades, [g]: !grades[g] })}>{g}</button>
              ))}
            </div>
          </div>
          <div className="feed">
            {news.slice(0, 40).map((n) => (
              <div key={n.link} className="item">
                <span className={`grade g${n.grade}`}>{n.grade}</span>
                <div>
                  <a href={n.link} target="_blank" rel="noreferrer" className="headline">{n.title}</a>
                  <div className="tags">
                    <span className="muted small">{n.source} · {ago(n.published || n.firstSeen)}</span>
                    {(n.coins || []).map((id) => <span key={id} className="tag">{id}</span>)}
                    {(n.narratives || []).map((k) => <span key={k} className="tag">{k}</span>)}
                    {(n.types || []).map((ty) => <span key={ty} className="tag">{ty}</span>)}
                  </div>
                </div>
              </div>
            ))}
            {!news.length && <p className="muted">{t("noNewsForGrades")}</p>}
          </div>
        </section>

        <footer className="foot">
          <div className="health">
            <span className="muted">{t("sources")}</span>
            <Health label="CoinGecko" h={data.health?.coingecko} t={t} />
            <Health label="Binance" h={data.health?.binance} t={t} />
            <Health label={t("btcRegime")} h={data.health?.btcRegime} t={t} />
            <Health label={t("healthCandles")} h={data.health?.candles} t={t} />
            <span className={(data.newsHealth || []).some((h) => h.ok) ? "up" : "down"}>{t("healthNews", (data.newsHealth || []).filter((h) => h.ok).length, (data.newsHealth || []).length)}</span>
            <Health label={t("healthClaude")} h={data.health?.claude} t={t} />
            <span className="muted">{t("twitterOff")}</span>
          </div>
          <p className="muted small"><b className="ink">{t("baseRateLabel")}</b> {t("baseRateBody")}</p>
        </footer>
      </div>
    </div>
  );
}

/**
 * "How to read this page": collapsed by default so it never gets between a
 * returning reader and the board, and the only place the page explains itself
 * at length — where the data comes from, how a coin gets ranked, what each
 * panel means, and what the whole thing cannot tell you.
 */
function Guide({ lang, t, open, onToggle }) {
  const sections = SCOUT_GUIDE[lang] || SCOUT_GUIDE.en;
  return (
    <section className="panel guide">
      <div className="panel-head">
        <h2>{t("guideTitle")}</h2>
        <button className="btn small" onClick={onToggle} aria-expanded={open}>{open ? t("guideClose") : t("guideOpen")}</button>
      </div>
      {open && (
        <div className="guide-body">
          {sections.map((s) => (
            <div key={s.h} className="sec">
              <h3>{s.h}</h3>
              {(s.p || []).map((para) => <p key={para} className="prose">{para}</p>)}
              {s.dl && (
                <dl className="guide-dl">
                  {s.dl.map(([term, def]) => <Fragment key={term}><dt>{term}</dt><dd>{def}</dd></Fragment>)}
                </dl>
              )}
              {s.after && <p className="prose">{s.after}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Health({ label, h, t }) {
  if (!h) return <span className="muted">{label} –</span>;
  return <span className={h.ok ? "up" : "down"} title={h.error || h.note || ""}>{label} {h.ok ? t("healthOk") : t("healthOff")}</span>;
}

const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function checkNote(check, t) {
  if (!check) return null;
  if (check.error) return t("checkFailed", hhmm(check.at), check.error);
  if (check.changed) return t("checkUpdated", hhmm(check.at));
  const due = check.newsUpdatedAt ? Date.parse(check.newsUpdatedAt) + 65 * 60000 : null;
  const when = due && due > Date.now() ? t("nextAround", hhmm(due)) : t("dueNow");
  return t("checkSame", hhmm(check.at), when);
}

function Header({ onRefresh, loading, data, check, t, ago }) {
  return (
    <header className="top">
      <div className="top-text">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1>{t("title")}</h1>
        <p className="muted">{t("lede")}</p>
        {data && <p className="muted small">{t("lastScan", data.scanDay ?? "–", ago(data.generatedAt), ago(data.newsUpdatedAt))}</p>}
      </div>
      <div className="reload">
        <button className="btn" onClick={onRefresh} disabled={loading}>{loading ? t("checking") : t("reload")}</button>
        {check && <span className="muted small" role="status">{checkNote(check, t)}</span>}
      </div>
    </header>
  );
}

function CoinCard({ coin, explainer, news, picked, t, lang }) {
  const tech = coin.tech;
  // A tier key, not a label: the chips below compare identity, and comparing
  // display strings would break the moment a translation changed a word.
  const tier = picked ? "picked" : coin.eligible ? "eligible" : coin.vetoes?.length ? "reject" : "watchlist";
  const TIERS = [
    ["radar", t("tierRadar")],
    // The middle chip doubles as the current watchlist state: a picked or
    // eligible coin reads as such, a rejected one falls back to plain Watchlist.
    ["watchlist", tier === "picked" ? t("tierPicked") : tier === "eligible" ? t("tierEligible") : t("tierWatchlist")],
    ["reject", t("tierReject")],
  ];
  const activeChip = tier === "picked" || tier === "eligible" ? "watchlist" : tier;
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <span className="eyebrow">{t("deepDive")}</span>
          <div className="ticker-line"><span className="ticker">{coin.symbol}</span><span className="muted">{coin.name}{coin.narratives?.length ? ` · ${coin.narratives.join(", ")}` : ""}</span></div>
        </div>
        <div className="tiers">
          {TIERS.map(([key, label]) => <span key={key} className={`tier ${key === activeChip ? "on" : ""}`}>{label}</span>)}
        </div>
      </div>

      {!coin.eligible && coin.pickFails?.length > 0 && <div className="flag"><b>{t("notPicked")}</b><span>{translateReasons(coin.pickFails, lang)}</span></div>}

      <div className="scores">
        <div className="score"><span className="l">{t("narrativeHeat")}</span><span className="v mono">{coin.scores.heat ?? "–"}</span></div>
        <div className="score"><span className="l">{t("relativeStrength")}</span><span className="v mono">{coin.scores.strength ?? "–"}</span></div>
        <div className="score"><span className="l">{t("quality")}</span><span className="v mono">{coin.scores.quality ?? "–"}</span></div>
        <div className="score"><span className="l">{t("supplyRiskLower")}</span><span className="v mono">{coin.scores.supplyRisk ?? "–"}</span></div>
      </div>

      <div className="sections">
        <div className="sec">
          <div className="panel-head"><h3>{t("whatItIs")}</h3><span className={`chip ${explainer?.ai ? "info" : ""}`}>{explainer?.ai ? "Claude" : t("projectDescription")}</span></div>
          <p className="prose">{explainer?.text || t("noExplainer")}</p>
          <div className="links">
            {explainer?.homepage && <a href={explainer.homepage} target="_blank" rel="noreferrer">{t("homepage")}</a>}
            {explainer?.whitepaper && <a href={explainer.whitepaper} target="_blank" rel="noreferrer">{t("whitepaper")}</a>}
            <a href={`https://www.coingecko.com/en/coins/${coin.id}`} target="_blank" rel="noreferrer">CoinGecko</a>
            {explainer?.categories?.length ? <span className="muted">{t("categoriesLabel", explainer.categories.slice(0, 6).join(", "))}</span> : null}
          </div>
        </div>
        <div className="sec">
          <div className="panel-head"><h3>{t("tokenEconomics")}</h3></div>
          <dl>
            <dt>{t("marketCap")}</dt><dd>{usd(coin.mcap)}</dd>
            <dt>{t("fdv")}</dt><dd>{usd(coin.fdv)}</dd>
            <dt>{t("fdvOverMcap")}</dt><dd>{coin.fdvToMcap ? `${coin.fdvToMcap.toFixed(2)}×` : "–"}</dd>
            <dt>{t("circulatingShare")}</dt><dd>{coin.float !== null && coin.float !== undefined ? `${(coin.float * 100).toFixed(0)}%` : "–"}</dd>
            <dt>{t("unlockSchedule")}</dt><dd className="muted">{t("notConnectedYet")}</dd>
          </dl>
        </div>
        <div className="sec">
          <div className="panel-head"><h3>{t("liquidityAndTrend")}</h3></div>
          <dl>
            <dt>{t("price")}</dt><dd>{px(coin.price)}</dd>
            <dt>{t("volumeShare")}</dt><dd>{usd(coin.vol)} ({coin.turnover ? `${(coin.turnover * 100).toFixed(1)}%` : "–"})</dd>
            <dt>{t("bidDepth")}</dt><dd>{usd(coin.depthUsd)}</dd>
            <dt>{t("above50d")}</dt><dd>{tech ? (tech.above50 ? t("yes") : t("no")) : "–"}</dd>
            <dt>{t("sevenDayMove")}</dt><dd>{pct(tech?.ret7)}</dd>
            <dt>{t("stretchAbove20d")}</dt><dd>{tech?.atrAboveSma20 !== null && tech?.atrAboveSma20 !== undefined ? `${tech.atrAboveSma20.toFixed(1)} ATR` : "–"}</dd>
          </dl>
        </div>
        <div className="sec">
          <div className="panel-head"><h3>{t("vsBtcAndNews")}</h3></div>
          <dl>
            <dt>{t("sevenDays")}</dt><dd className={signClass(coin.rs7)}>{pct(coin.rs7)}</dd>
            <dt>{t("thirtyDays")}</dt><dd className={signClass(coin.rs30)}>{pct(coin.rs30)}</dd>
            <dt>{t("twoHundredDays")}</dt><dd className={signClass(coin.rs200)}>{pct(coin.rs200, 0)}</dd>
            <dt>{t("newsMentions7d")}</dt><dd>{coin.newsCount ?? 0}</dd>
          </dl>
          {news.slice(0, 4).map((n) => (
            <div key={n.link} className="mini-news"><span className={`grade g${n.grade}`}>{n.grade}</span><a href={n.link} target="_blank" rel="noreferrer">{n.title}</a></div>
          ))}
        </div>
      </div>
    </div>
  );
}

const CSS = `
/* Tokens and shared base rules (.ns, .btn, .panel, .chip, .banner ...) live in src/ui/theme.css. */
.ns .wrap { max-width: 1180px; margin: 0 auto; padding-inline: 16px; padding-block: 26px 56px; display: grid; gap: 18px; }
.ns td.heat { font-family: var(--mono); font-variant-numeric: tabular-nums; }

.ns .rule { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.ns .rule div { background: var(--panel); padding: 14px 16px; display: grid; gap: 2px; }
.ns .rule b { font-family: var(--display); font-size: 20px; font-weight: 600; }
@media (max-width: 640px) { .ns .rule { grid-template-columns: 1fr; } }

.ns .grid2 { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr); gap: 18px; }
.ns .stack { display: grid; gap: 18px; align-content: start; min-width: 0; }
@media (max-width: 900px) { .ns .grid2 { grid-template-columns: 1fr; } }

.ns .scroll { overflow-x: auto; }
.ns table { border-collapse: separate; border-spacing: 0 2px; width: 100%; font-size: 13.5px; }
.ns th { font-family: var(--mono); font-weight: 500; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.ns td { padding: 7px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: middle; }
.ns td.heat { text-align: right; border-radius: 3px; border-bottom-color: transparent; }
.ns td.wrap-cell { white-space: normal; min-width: 220px; }
.ns td.status { white-space: normal; min-width: 170px; font-size: 12.5px; }
.ns .p2 { background: var(--up-strong); } .ns .p1 { background: var(--up-bg); } .ns .z { background: var(--flat-bg); }
.ns .n1 { background: var(--down-bg); } .ns .n2 { background: var(--down-strong); }
.ns tr.clickable { cursor: pointer; }
.ns tr.clickable:hover td:not(.heat), .ns tr.open td:not(.heat) { background: #1b2632; }
.ns tr.card-row td { padding: 0; white-space: normal; border-bottom: 0; }

.ns .stage { font-family: var(--mono); font-size: 11px; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.ns .s-acc { background: var(--up-bg); color: var(--up); }
.ns .s-em { background: var(--info-bg); color: var(--info); }
.ns .s-main { background: var(--warn-bg); color: var(--warn); }
.ns .s-exh { background: var(--down-bg); color: var(--down); }
.ns .s-cold { background: var(--flat-bg); color: var(--muted); }

.ns .bar-wrap { display: inline-flex; align-items: center; gap: 7px; }
.ns .bar { height: 6px; width: 56px; background: var(--flat-bg); border-radius: 3px; display: inline-block; overflow: hidden; }
.ns .bar i { display: block; height: 100%; border-radius: 3px; }
.ns .bar-wrap .mono { min-width: 22px; text-align: right; font-size: 12.5px; }

.ns .cats { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 12.5px; }
.ns .tag { font-family: var(--mono); font-size: 11px; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: 0 6px; }

.ns .gauge { display: grid; gap: 8px; }
.ns .track { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--down-strong), var(--flat-bg) 50%, var(--up-strong)); position: relative; }
.ns .needle { position: absolute; top: -5px; width: 3px; height: 22px; margin-left: -1px; background: var(--ink); border-radius: 2px; }
.ns .ends { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 11px; color: var(--muted); }

.ns .funnel { display: grid; gap: 6px; }
.ns .funnel div { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px; align-items: center; }
.ns .funnel .n { text-align: right; font-weight: 500; font-size: 15px; }
.ns .funnel .f { background: var(--accent-soft); border-left: 3px solid var(--accent); padding: 5px 10px; font-size: 13px; border-radius: 0 4px 4px 0; }

.ns .tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 760px) { .ns .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ns .tile { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; display: grid; gap: 2px; }
.ns .tile .l { font-size: 12px; color: var(--muted); }
.ns .tile .v { font-family: var(--mono); font-size: 21px; }

.ns .feed { display: grid; }
.ns .item { display: grid; grid-template-columns: 40px minmax(0, 1fr); gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.ns .item:last-child { border-bottom: 0; }
.ns .grade { font-family: var(--mono); font-weight: 500; font-size: 12px; text-align: center; padding: 3px 0; border-radius: 4px; align-self: start; min-width: 22px; }
.ns .gA { background: var(--up-bg); color: var(--up); } .ns .gB { background: var(--flat-bg); color: var(--ink); } .ns .gC { background: var(--down-bg); color: var(--down); }
.ns .headline { color: var(--ink); font-weight: 600; }
.ns .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px; align-items: center; }
.ns .filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

/* "How to read this page". Two columns on a wide screen so the whole guide is
   scannable without scrolling past the board; one column on a phone. */
.ns .guide-body { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px 24px; margin-top: 4px; }
.ns .guide-body .sec { border-top: 2px solid var(--accent); padding-top: 10px; }
.ns .guide-body h3 { margin: 0 0 6px; }
.ns .guide-body .prose { margin: 0 0 8px; }
.ns dl.guide-dl { grid-template-columns: minmax(0, 1fr); gap: 8px; }
.ns dl.guide-dl dt { color: var(--ink); font-weight: 600; }
.ns dl.guide-dl dd { font-family: inherit; text-align: left; color: var(--muted); line-height: 1.5; }

.ns .card { background: #121a22; border-top: 2px solid var(--accent); padding: 16px; display: grid; gap: 14px; position: sticky; left: 0; box-sizing: border-box; width: min(1144px, calc(100vw - 32px)); }
.ns .card-head { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: flex-end; justify-content: space-between; }
.ns .ticker-line { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.ns .ticker { font-family: var(--display); font-size: 34px; font-weight: 700; line-height: 1; }
.ns .tiers { display: flex; flex-wrap: wrap; gap: 6px; }
.ns .tier { font-family: var(--mono); font-size: 11.5px; padding: 3px 9px; border-radius: 4px; background: var(--flat-bg); color: var(--muted); }
.ns .tier.on { background: var(--warn-bg); color: var(--warn); font-weight: 500; }
.ns .flag { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 6px; background: var(--warn-bg); font-size: 13.5px; }
.ns .flag b { color: var(--warn); font-family: var(--mono); font-size: 12px; letter-spacing: .06em; white-space: nowrap; }
.ns .scores { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 640px) { .ns .scores { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ns .score { border: 1px solid var(--line); border-radius: 6px; padding: 10px; display: grid; gap: 4px; }
.ns .score .v { font-size: 22px; }
.ns .score .l { font-size: 12.5px; color: var(--muted); }
.ns .sections { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 14px; }
.ns .sec { border-top: 2px solid var(--line); padding-top: 10px; display: grid; gap: 8px; min-width: 0; align-content: start; }
.ns .prose { font-size: 13.5px; white-space: pre-wrap; line-height: 1.55; }
.ns .links { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; }
.ns dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 12px; margin: 0; font-size: 13px; }
.ns dt { color: var(--muted); }
.ns dd { margin: 0; font-family: var(--mono); text-align: right; }
.ns .mini-news { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 8px; font-size: 12.5px; }
.ns .mini-news a { color: var(--ink); }

.ns .foot { display: grid; gap: 8px; font-size: 12.5px; }
.ns .health { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.ns .pre { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 12px; font-family: var(--mono); font-size: 12px; white-space: pre-wrap; margin: 0; }
`;
