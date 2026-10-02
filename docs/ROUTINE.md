# Daily and weekly routine (v2.0)

A mechanical system only works if you run it mechanically. This is the checklist.
It describes **v2.0**: long only, one entry a day, exits only by the trailing stop.
Rewritten 2026-10-02 after the audit found the old routine still described v1.1.

## Where your instructions come from

**The PAPER tab's "Today's orders" box (or the robot's phone push) is the instruction
set.** It is the validated portfolio engine itself, with every rule applied. Do not
trade from the Scanner's raw LONG badges: most of them are coins already held or
entries a portfolio rule blocks. The Scanner's **System** column shows what the
engine actually does for each coin.

## Every day, after the daily close (00:00 UTC), 7 days a week

00:00 UTC = 02:00 CEST, 03:00 EEST, 20:00 EDT. Crypto doesn't close on weekends and
neither does the system. If you can't check, the robot's push tells you when
something needs doing.

1. Open **PAPER → Check paper track** (or read the robot's push).
2. **New entry ("BUY")?** Place a **market order** promptly. **Never** use a resting
   limit at the close: it fills on the trades that go nowhere and misses the
   breakouts that run. Size = the quantity shown for your account and risk.
3. **Every open position:** make sure a **reduce-only stop-market sell** rests at the
   stop shown (trigger on Mark price if you use perpetuals). Move it **up** to the new
   level after each close. **Never move it down.** It fires intraday when price trades
   through it; there is no waiting for a daily close.
4. **"Closed yesterday by stop"?** Check that your exchange stop filled. If it didn't,
   sell now.
5. **Log** any fill in the Trade Log (system lane).

That's the whole job. There are no targets, no exits on regime flips, no shorts and
no averaging down.

### Portfolio rules (the engine applies them; know them so nothing surprises you)

- At most **4 positions**: at most **1 of BTC/ETH** plus at most **3 others**.
- At most **1 new entry per day**. When several coins signal the same day, the
  engine takes the **widest stop (as % of price)** first.
- **3-day cooldown** after a stop-out on the same coin.
- Nothing is entered while a coin's last weekly close is below its 50-week average.

## Execution and risk (from the 2026-10 audit)

- **Venue: spot.** Perpetual funding cost about 0.1R per trade in the backtest; spot
  removes it and the system never needs leverage. On perps: isolated margin, 1x, a
  reduce-only stop-market order, Mark-price trigger.
- **Risk per trade: 0.35%** of the account (the audit's pre-registered rule; up to
  0.5% if you accept a real chance of a 25-30% drawdown over several years).
- **Drawdown rules**, measured on the live account from its highest value:
  - at **−15%**: halve risk; go back to full risk once the drawdown is shallower than −7.5%;
  - at **−20%**: stop new entries, let the stops run, review data and execution.
    Resume at half risk only if nothing was wrong.
- **Step up risk** only after **100+ closed trades** with clean execution (every
  robot entry and exit matched by a live order on the same UTC day). Never step up
  because of a good month.

## Weekly (5 minutes, any day)

1. **Scanner → Run scan.** Note which coins are in a bull regime (weekly close above
   the 50-week average). That is the whole tradeable universe for the week.
2. Check that your exchange stops match the PAPER tab.
3. Check the robot's daily "ran OK" pushes arrived every day. **No push means the
   robot did not run**: wake the Mac or run `node scripts/papertrade.mjs`.

## When you feel like overriding the system

This will happen, especially when:
- the system says buy and the chart "looks toppy";
- the system has been in cash for weeks and you're bored;
- the system just had three stop-outs in a row;
- someone makes a compelling case for the opposite trade.

**The rules:** you may NOT take an entry the system didn't give, and you may NOT skip
an exit. Skipping system entries is technically possible but costly. A trend system
makes almost all its money on a few trades: in the 2020-26 backtest the top 5 of
205 trades made over half the profit. A skipped entry is very likely to be one of
those. If you skip one anyway, write down why in the journal before the next close.

## Monthly review (30 minutes)

1. Read every journal entry from the month.
2. **Count:** system entries, entries taken, entries skipped, stop-outs.
3. **Parity check:** compare your live fills to the robot's fills for the same trades.
   Median entry difference should be ≤ 0.15% and stop fills ≤ 0.30%. This measures
   execution, which you control.
4. Note the worst moment of the month emotionally. Did you stick to the system?

## What to expect, and what not to conclude

- **Live results are very noisy.** Even with the full historical edge, 22% of
  12-month windows lost money, and the longest stretch without a new equity high was
  about two years. Six months of P&L says almost nothing about whether the edge is
  real; that takes **years** of trades.
- So judge the first year on **execution parity** (did you do what the engine did?),
  not on profit.
- The audit's planning figure is about **0.15-0.45R per trade**, with 0.16R as the
  cautious planning number. At 0.35% risk that is a few percent a year on top of what
  the idle cash earns, not the backtest's 20%. A losing year is normal.
