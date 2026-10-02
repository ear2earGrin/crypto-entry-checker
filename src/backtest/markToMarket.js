import { slip } from "./portfolio.js";

/**
 * What an open position would net if it were closed at `price` right now:
 * exit slippage, round-trip fees and the funding it has accrued, exactly as
 * backtestPortfolio settles a position (including its "end of data" close).
 *
 * @param {object} p
 * @param {object} p.pos      An entry of backtestPortfolio().openPositions
 * @param {number} p.price    Mark price (e.g. the latest traded price)
 * @param {number} [p.feePct=0.08]      Round-trip fee %, as passed to the engine
 * @param {number} [p.slippagePct=0]    Slippage %, as passed to the engine
 * @returns {null | { price, exit, net, fees, funding, movePct, r }}
 *   net    — unrealized PnL after costs (USDT)
 *   movePct — price move from entry in the trade's favour (%)
 *   r      — net / initial risk
 */
export function markOpenPosition({ pos, price, feePct = 0.08, slippagePct = 0 }) {
  if (!pos || !Number.isFinite(price) || price <= 0 || !Number.isFinite(pos.entry) || !(pos.qty > 0)) return null;
  const dir = pos.direction === "SHORT" ? -1 : 1;
  const exit = slip(price, dir === 1 ? "sell" : "buy", slippagePct);
  const gross = dir * pos.qty * (exit - pos.entry);
  const fees = (Math.abs(pos.entry) + Math.abs(exit)) * pos.qty * (feePct / 100);
  const funding = pos.fundingCost || 0;
  const net = gross - fees - funding;
  return {
    price, exit, net, fees, funding,
    movePct: (dir * (price - pos.entry) / pos.entry) * 100,
    r: pos.riskAmount > 0 ? net / pos.riskAmount : null,
  };
}
