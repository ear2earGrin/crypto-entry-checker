import { useMemo, useState } from "react";
import {
  loadTrades, addTrade, closeTrade, updateTrade, deleteTrade,
  exportTradesJSON, importTrades,
  tradeToObsidianMarkdown, obsidianFilename,
} from "../data/tradeLog.js";

const ASSETS = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "DOGE"];

function fmt(n, d = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}
function ymd(unix) {
  if (!unix) return "-";
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

// Two lanes, two scorecards. "system" = mechanical v2.0 signals followed to the
// dot; "discretionary" = Market Cipher / judgment trades. Legacy values map:
// scanner->system, manual->discretionary.
function laneOf(t) {
  const s = (t.systemSource || "").toLowerCase();
  return s === "manual" || s === "discretionary" ? "DISCRETIONARY" : "SYSTEM";
}

function laneStats(trades) {
  if (!trades.length) return { count: 0, wins: 0, losses: 0, pnl: 0, avgR: 0 };
  let pnl = 0, wins = 0, losses = 0, rSum = 0;
  for (const t of trades) {
    const p = t.exit ? (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price) : 0;
    pnl += p;
    if (p > 0) wins++; else losses++;
    if (t.entry?.riskDollar) rSum += p / t.entry.riskDollar;
  }
  return { count: trades.length, wins, losses, pnl, avgR: rSum / trades.length };
}

export default function TradeLog() {
  const [trades, setTrades] = useState(loadTrades());
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = () => setTrades(loadTrades());

  const open = useMemo(() => trades.filter((t) => t.status === "OPEN"), [trades]);
  const closed = useMemo(() => trades.filter((t) => t.status === "CLOSED"), [trades]);

  const sysStats = useMemo(() => laneStats(closed.filter((t) => laneOf(t) === "SYSTEM")), [closed]);
  const discStats = useMemo(() => laneStats(closed.filter((t) => laneOf(t) === "DISCRETIONARY")), [closed]);

  function downloadJSON() {
    const blob = new Blob([exportTradesJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadObsidianMd(t) {
    const md = tradeToObsidianMarkdown(t);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = obsidianFilename(t);
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadAllObsidianMd() {
    if (!trades.length) return;
    // Single combined Markdown with separators — paste into vault and split, or
    // use Obsidian's "import" workflow.
    const combined = trades.map((t) => `\n\n<!-- file: ${obsidianFilename(t)} -->\n${tradeToObsidianMarkdown(t)}`).join("\n");
    const blob = new Blob([combined], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trades-bundle-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyMd(t) {
    navigator.clipboard.writeText(tradeToObsidianMarkdown(t)).then(() => {
      setNotice(`Copied ${obsidianFilename(t)} to clipboard.`);
      setTimeout(() => setNotice(""), 3000);
    });
  }

  function handleImport(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importTrades(String(reader.result));
        refresh();
        setNotice(`Imported ${n} trades.`);
        setTimeout(() => setNotice(""), 3000);
      } catch (err) {
        setNotice(`Import error: ${err.message}`);
        setTimeout(() => setNotice(""), 5000);
      }
    };
    reader.readAsText(f);
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>TRADE LOG</h1>
          <div style={styles.subtitle}>
            Persisted in this browser. Every trade exports as Obsidian-flavored Markdown
            with YAML frontmatter — drop the file into your vault and your Memory Wiki
            indexes it.
          </div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <button style={styles.btn} onClick={() => setShowNew(true)} type="button">NEW TRADE</button>
          <button style={styles.btnGhost} onClick={downloadJSON} type="button">EXPORT JSON</button>
          <label style={{ ...styles.btnGhost, cursor: "pointer", display: "inline-block", textAlign: "center" }}>
            IMPORT JSON
            <input type="file" accept="application/json" onChange={handleImport} style={{ display: "none" }} />
          </label>
          <button style={styles.btnGhost} onClick={downloadAllObsidianMd} type="button">EXPORT ALL TO MD</button>
        </div>
      </div>

      {notice ? <div style={styles.notice}>{notice}</div> : null}

      <div style={styles.laneLabel}>SYSTEM LANE (mechanical v2.0 — followed to the dot)</div>
      <div style={styles.statsRow}>
        <Stat label="Open" value={String(open.filter((t) => laneOf(t) === "SYSTEM").length)} />
        <Stat label="Closed" value={String(sysStats.count)} />
        <Stat label="Wins / Losses" value={`${sysStats.wins} / ${sysStats.losses}`} />
        <Stat label="Win rate" value={sysStats.count ? `${((sysStats.wins / sysStats.count) * 100).toFixed(1)}%` : "-"} />
        <Stat label="Realized PnL" value={`${fmt(sysStats.pnl, 2)} USDT`} good={sysStats.pnl > 0} bad={sysStats.pnl < 0} />
        <Stat label="Avg R" value={fmt(sysStats.avgR, 2)} />
      </div>
      <div style={styles.laneLabel}>DISCRETIONARY LANE (Market Cipher / your judgment)</div>
      <div style={styles.statsRow}>
        <Stat label="Open" value={String(open.filter((t) => laneOf(t) === "DISCRETIONARY").length)} />
        <Stat label="Closed" value={String(discStats.count)} />
        <Stat label="Wins / Losses" value={`${discStats.wins} / ${discStats.losses}`} />
        <Stat label="Win rate" value={discStats.count ? `${((discStats.wins / discStats.count) * 100).toFixed(1)}%` : "-"} />
        <Stat label="Realized PnL" value={`${fmt(discStats.pnl, 2)} USDT`} good={discStats.pnl > 0} bad={discStats.pnl < 0} />
        <Stat label="Avg R" value={fmt(discStats.avgR, 2)} />
      </div>

      <Section title="OPEN POSITIONS">
        {open.length === 0 ? <Empty text="No open positions." /> : (
          <TradeTable
            trades={open}
            onClose={(t) => setEditing({ ...t, _mode: "close" })}
            onEdit={(t) => setEditing({ ...t, _mode: "edit" })}
            onDelete={(t) => { if (confirm("Delete this trade?")) { deleteTrade(t.id); refresh(); } }}
            onMd={copyMd}
            onMdFile={downloadObsidianMd}
          />
        )}
      </Section>

      <Section title="CLOSED">
        {closed.length === 0 ? <Empty text="No closed trades yet." /> : (
          <TradeTable
            trades={closed.slice().reverse()}
            onClose={null}
            onEdit={(t) => setEditing({ ...t, _mode: "edit" })}
            onDelete={(t) => { if (confirm("Delete this trade?")) { deleteTrade(t.id); refresh(); } }}
            onMd={copyMd}
            onMdFile={downloadObsidianMd}
          />
        )}
      </Section>

      {showNew ? (
        <NewTradeModal
          onClose={() => setShowNew(false)}
          onSave={(t) => { addTrade(t); refresh(); setShowNew(false); }}
        />
      ) : null}

      {editing ? (
        <EditModal
          trade={editing}
          mode={editing._mode}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            if (editing._mode === "close") {
              closeTrade(editing.id, patch);
            } else {
              updateTrade(editing.id, patch);
            }
            refresh();
            setEditing(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={styles.sectionTitle}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }) {
  return <div style={styles.empty}>{text}</div>;
}

function Stat({ label, value, good, bad }) {
  return (
    <div style={styles.stat}>
      <div style={{ fontSize: 10, letterSpacing: 1.2, opacity: 0.6 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 900, marginTop: 4, color: bad ? "#ff7c9c" : good ? "#7cffb1" : "#d7ffe8" }}>{value}</div>
    </div>
  );
}

function TradeTable({ trades, onClose, onEdit, onDelete, onMd, onMdFile }) {
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Date</th>
            <th style={styles.th}>Lane</th>
            <th style={styles.th}>Asset</th>
            <th style={styles.th}>Dir</th>
            <th style={styles.th}>Entry</th>
            <th style={styles.th}>Stop</th>
            <th style={styles.th}>Qty</th>
            <th style={styles.th}>Risk $</th>
            <th style={styles.th}>Exit</th>
            <th style={styles.th}>PnL</th>
            <th style={styles.th}>R</th>
            <th style={styles.th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => {
            const pnl = t.exit ? (t.direction === "LONG" ? 1 : -1) * t.entry.qty * (t.exit.price - t.entry.price) : null;
            const r = pnl !== null && t.entry?.riskDollar ? pnl / t.entry.riskDollar : null;
            return (
              <tr key={t.id}>
                <td style={styles.td}>{ymd(t.entry?.time)}</td>
                <td style={styles.td}>
                  <span style={{ ...styles.laneBadge, background: laneOf(t) === "SYSTEM" ? "#0d2f3a" : "#2a1a3a", color: laneOf(t) === "SYSTEM" ? "#7cd8ff" : "#c99cff" }}>
                    {laneOf(t) === "SYSTEM" ? "SYS" : "DISC"}
                  </span>
                </td>
                <td style={{ ...styles.td, fontWeight: 700 }}>{t.asset}</td>
                <td style={{ ...styles.td, color: t.direction === "LONG" ? "#7cffb1" : "#ff7c9c", fontWeight: 700 }}>{t.direction}</td>
                <td style={styles.td}>{fmt(t.entry?.price, 4)}</td>
                <td style={styles.td}>{fmt(t.entry?.stop, 4)}</td>
                <td style={styles.td}>{fmt(t.entry?.qty, 6)}</td>
                <td style={styles.td}>{fmt(t.entry?.riskDollar, 2)}</td>
                <td style={styles.td}>{t.exit ? `${ymd(t.exit.time)} @ ${fmt(t.exit.price, 4)}` : "-"}</td>
                <td style={{ ...styles.td, color: pnl > 0 ? "#7cffb1" : pnl < 0 ? "#ff7c9c" : "#888" }}>{fmt(pnl, 2)}</td>
                <td style={styles.td}>{fmt(r, 2)}</td>
                <td style={styles.td}>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {onClose ? <button style={styles.actBtn} onClick={() => onClose(t)} type="button">close</button> : null}
                    <button style={styles.actBtn} onClick={() => onEdit(t)} type="button">edit</button>
                    <button style={styles.actBtn} onClick={() => onMd(t)} type="button" title="Copy Markdown">md</button>
                    <button style={styles.actBtn} onClick={() => onMdFile(t)} type="button" title="Download .md">↓</button>
                    <button style={styles.actBtnDanger} onClick={() => onDelete(t)} type="button">×</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function NewTradeModal({ onClose, onSave }) {
  const [form, setForm] = useState({
    asset: "BTC", direction: "LONG",
    lane: "system",
    entryDate: new Date().toISOString().slice(0, 10),
    price: "", stop: "", qty: "", riskDollar: "", leverage: "",
    regimeState: "LONG_OK", weeklySma: "", weeklyHist: "", weeklyAdx: "", weeklyRsi: "",
    dailyClose: "", dailyRsi: "", dailyAtr: "", signalReason: "",
    notes: "",
  });

  function update(k, v) { setForm((p) => ({ ...p, [k]: v })); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function save() {
    const entryTime = Math.floor(new Date(form.entryDate + "T12:00:00Z").getTime() / 1000);
    const trade = {
      asset: form.asset,
      direction: form.direction,
      entry: {
        time: entryTime,
        price: num(form.price),
        stop: num(form.stop),
        qty: num(form.qty),
        riskDollar: num(form.riskDollar),
        leverage: num(form.leverage),
      },
      regimeSnapshot: {
        state: form.regimeState,
        sma: num(form.weeklySma),
        hist: num(form.weeklyHist),
        adx: num(form.weeklyAdx),
        rsi: num(form.weeklyRsi),
      },
      signalSnapshot: {
        action: form.direction,
        reason: form.signalReason,
        close: num(form.dailyClose),
        rsi: num(form.dailyRsi),
        atr: num(form.dailyAtr),
      },
      notes: form.notes,
      systemSource: form.lane,
    };
    onSave(trade);
  }

  return (
    <Modal title="NEW TRADE" onClose={onClose} onSave={save}>
      <div style={modalStyles.grid2}>
        <Field label="Asset">
          <select value={form.asset} onChange={(e) => update("asset", e.target.value)} style={modalStyles.input}>
            {ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={form.direction} onChange={(e) => update("direction", e.target.value)} style={modalStyles.input}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </Field>
        <Field label="Lane">
          <select value={form.lane} onChange={(e) => update("lane", e.target.value)} style={modalStyles.input}>
            <option value="system">SYSTEM (scanner signal)</option>
            <option value="discretionary">DISCRETIONARY (Cipher / judgment)</option>
          </select>
        </Field>
        <Field label="Entry date"><input type="date" value={form.entryDate} onChange={(e) => update("entryDate", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Entry price"><input value={form.price} onChange={(e) => update("price", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Stop price"><input value={form.stop} onChange={(e) => update("stop", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Quantity"><input value={form.qty} onChange={(e) => update("qty", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Risk $"><input value={form.riskDollar} onChange={(e) => update("riskDollar", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Leverage"><input value={form.leverage} onChange={(e) => update("leverage", e.target.value)} style={modalStyles.input} /></Field>
      </div>

      <div style={{ ...modalStyles.sectionTitle, marginTop: 14 }}>WEEKLY REGIME (at entry)</div>
      <div style={modalStyles.grid4}>
        <Field label="State">
          <select value={form.regimeState} onChange={(e) => update("regimeState", e.target.value)} style={modalStyles.input}>
            {["LONG_OK", "SHORT_OK", "FLAT", "WARMUP"].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="50W SMA"><input value={form.weeklySma} onChange={(e) => update("weeklySma", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="MACD hist"><input value={form.weeklyHist} onChange={(e) => update("weeklyHist", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="ADX"><input value={form.weeklyAdx} onChange={(e) => update("weeklyAdx", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="RSI"><input value={form.weeklyRsi} onChange={(e) => update("weeklyRsi", e.target.value)} style={modalStyles.input} /></Field>
      </div>

      <div style={{ ...modalStyles.sectionTitle, marginTop: 14 }}>DAILY SIGNAL (at entry)</div>
      <div style={modalStyles.grid4}>
        <Field label="Close"><input value={form.dailyClose} onChange={(e) => update("dailyClose", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="RSI(14)"><input value={form.dailyRsi} onChange={(e) => update("dailyRsi", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="ATR(14)"><input value={form.dailyAtr} onChange={(e) => update("dailyAtr", e.target.value)} style={modalStyles.input} /></Field>
        <Field label="Reason / setup"><input value={form.signalReason} onChange={(e) => update("signalReason", e.target.value)} style={modalStyles.input} /></Field>
      </div>

      <div style={{ marginTop: 14 }}>
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => update("notes", e.target.value)} style={{ ...modalStyles.input, minHeight: 80 }} />
        </Field>
      </div>
    </Modal>
  );
}

function EditModal({ trade, mode, onClose, onSave }) {
  const isClose = mode === "close";
  const [form, setForm] = useState({
    exitDate: trade.exit?.time ? new Date(trade.exit.time * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
    exitPrice: trade.exit?.price ?? "",
    exitReason: trade.exit?.reason ?? "trailing stop hit",
    notes: trade.notes ?? "",
  });

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  function save() {
    if (isClose) {
      onSave({
        time: Math.floor(new Date(form.exitDate + "T12:00:00Z").getTime() / 1000),
        price: num(form.exitPrice),
        reason: form.exitReason,
      });
    } else {
      onSave({ notes: form.notes });
    }
  }

  return (
    <Modal title={isClose ? "CLOSE TRADE" : "EDIT TRADE"} onClose={onClose} onSave={save}>
      {isClose ? (
        <>
          <div style={modalStyles.grid2}>
            <Field label="Exit date"><input type="date" value={form.exitDate} onChange={(e) => setForm({ ...form, exitDate: e.target.value })} style={modalStyles.input} /></Field>
            <Field label="Exit price"><input value={form.exitPrice} onChange={(e) => setForm({ ...form, exitPrice: e.target.value })} style={modalStyles.input} /></Field>
          </div>
          <Field label="Reason">
            <select value={form.exitReason} onChange={(e) => setForm({ ...form, exitReason: e.target.value })} style={modalStyles.input}>
              <option value="trailing stop hit">trailing stop hit</option>
              <option value="regime flip">regime flip</option>
              <option value="discretionary exit">discretionary exit</option>
              <option value="manual stop">manual stop</option>
            </select>
          </Field>
        </>
      ) : (
        <Field label="Notes">
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...modalStyles.input, minHeight: 120 }} />
        </Field>
      )}
    </Modal>
  );
}

function Modal({ title, children, onClose, onSave }) {
  return (
    <div style={modalStyles.overlay} onClick={onClose}>
      <div style={modalStyles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={modalStyles.modalHead}>
          <div style={{ fontWeight: 900, letterSpacing: 2, fontSize: 14 }}>{title}</div>
          <button style={modalStyles.closeX} onClick={onClose} type="button">×</button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
        <div style={modalStyles.modalFoot}>
          <button style={styles.btnGhost} onClick={onClose} type="button">CANCEL</button>
          <button style={styles.btn} onClick={onSave} type="button">SAVE</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label style={{ fontSize: 11, letterSpacing: 1.2, opacity: 0.7 }}>{label}</label>
      {children}
    </div>
  );
}

const styles = {
  page: { maxWidth: 1400, margin: "26px auto", padding: "0 14px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", color: "#d7ffe8" },
  header: {
    border: "1px solid #2cff9c33",
    background: "radial-gradient(1200px 280px at 10% 0%, #1cff8a22, transparent), linear-gradient(180deg, #07110e, #050807)",
    padding: 16, borderRadius: 18,
    boxShadow: "0 0 0 1px #0d2a1d inset, 0 30px 80px #00000088",
    display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "center",
  },
  title: { margin: 0, letterSpacing: 3, fontWeight: 900, fontSize: 22 },
  subtitle: { marginTop: 6, opacity: 0.78, lineHeight: 1.3, fontSize: 12, maxWidth: 760 },
  btn: { padding: "10px 14px", borderRadius: 14, border: "1px solid #2cff9c33", background: "linear-gradient(180deg, #0b1712, #070b09)", color: "#d7ffe8", cursor: "pointer", letterSpacing: 1.4, fontWeight: 800, boxShadow: "0 10px 25px #00000088" },
  btnGhost: { padding: "8px 12px", borderRadius: 12, border: "1px solid #2cff9c22", background: "#06120e", color: "#d7ffe8", cursor: "pointer", letterSpacing: 1.2, fontWeight: 700, fontSize: 11 },
  notice: { marginTop: 12, padding: 10, borderRadius: 12, border: "1px solid #2cff9c33", background: "#0d3a25", color: "#7cffb1", fontSize: 12 },
  statsRow: { display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10, marginTop: 8 },
  laneLabel: { marginTop: 16, fontSize: 11, letterSpacing: 1.6, opacity: 0.75, fontWeight: 800 },
  laneBadge: { display: "inline-block", padding: "2px 7px", borderRadius: 6, fontSize: 10, fontWeight: 800, letterSpacing: 1 },
  stat: { padding: 12, borderRadius: 14, border: "1px solid #2cff9c22", background: "#06120e" },
  sectionTitle: { fontSize: 12, letterSpacing: 2, opacity: 0.85, fontWeight: 700, marginBottom: 8 },
  tableWrap: { borderRadius: 18, border: "1px solid #2cff9c22", overflow: "auto", background: "#06120e" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
  th: { textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #2cff9c22", background: "#08120e", position: "sticky", top: 0, fontSize: 11, letterSpacing: 1, opacity: 0.9 },
  td: { padding: "10px 12px", borderBottom: "1px solid #2cff9c11", whiteSpace: "nowrap" },
  actBtn: { padding: "4px 8px", borderRadius: 6, border: "1px solid #2cff9c22", background: "#08120e", color: "#d7ffe8", cursor: "pointer", fontSize: 11 },
  actBtnDanger: { padding: "4px 8px", borderRadius: 6, border: "1px solid #ff7c9c33", background: "#1f0d12", color: "#ff7c9c", cursor: "pointer", fontSize: 11 },
  empty: { padding: 24, borderRadius: 18, border: "1px dashed #2cff9c22", textAlign: "center", opacity: 0.6, fontSize: 13 },
};

const modalStyles = {
  overlay: { position: "fixed", inset: 0, background: "#000c", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60, zIndex: 200 },
  modal: { width: 720, maxWidth: "94vw", maxHeight: "84vh", overflow: "auto", borderRadius: 18, border: "1px solid #2cff9c33", background: "#050807", boxShadow: "0 30px 80px #000c" },
  modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", borderBottom: "1px solid #2cff9c22" },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "12px 16px", borderTop: "1px solid #2cff9c22" },
  closeX: { background: "transparent", border: "none", color: "#d7ffe8", fontSize: 22, cursor: "pointer", opacity: 0.7 },
  input: { padding: 10, borderRadius: 12, border: "1px solid #2cff9c2a", background: "#050b09", color: "#d7ffe8", outline: "none", width: "100%", fontFamily: "inherit", fontSize: 13 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  grid4: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 },
  sectionTitle: { fontSize: 11, letterSpacing: 1.8, opacity: 0.75, fontWeight: 700 },
};
