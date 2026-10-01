import { ui } from "./theme.js";

/** Full-width slate page with the centred content column every tab uses. */
export function Page({ children }) {
  return (
    <div className="ns">
      <div style={ui.wrap}>{children}</div>
    </div>
  );
}

/**
 * The Scout-style page header: amber eyebrow, condensed title, muted lead,
 * actions bottom-right (they wrap under the text on narrow screens).
 */
export function PageHeader({ eyebrow, title, children, actions }) {
  return (
    <header className="top">
      <div className="top-text">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {children}
      </div>
      {actions ? <div className="top-actions">{actions}</div> : null}
    </header>
  );
}

/** Label-over-big-number tile. */
export function Tile({ label, value, sub, good, bad }) {
  const color = bad ? "var(--down)" : good ? "var(--up)" : undefined;
  return (
    <div style={ui.tile}>
      <span style={ui.tileLabel}>{label}</span>
      <span style={color ? { ...ui.tileValue, color } : ui.tileValue}>{value}</span>
      {sub ? <span style={ui.tileSub}>{sub}</span> : null}
    </div>
  );
}

/** Labelled form control. */
export function Field({ label, hint, children }) {
  return (
    <div style={ui.fieldWrap}>
      <label style={ui.label}>{label}</label>
      {children}
      {hint ? <div style={ui.hint}>{hint}</div> : null}
    </div>
  );
}
