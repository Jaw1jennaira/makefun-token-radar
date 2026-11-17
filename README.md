# Token Launch Radar — make.fun token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Jaw1jennaira/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Jaw1jennaira/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A program plus the dashboard it writes: it reads a sealed DefiLlama snapshot of the
protocol universe, ranks the protocols that record no token by what their launch would
be worth, and hands in a web dashboard with the board, a detail view for every protocol,
and the steps to farm each one.

## The model (radar-4)

Implied value follows only from the snapshot's own figures:

```
implied = round( 10^(3.02 + 0.52 × log10(TVL) + tilt)
  × (1 + clamp(change_7d, -60, 120) / 100 × 1.0) )
```

The one idea a flat TVL multiple misses is that the market does not price every kind
of protocol alike — and it does not price value linearly in TVL either. Regressing
log10(market cap) on log10(TVL) over this snapshot's 128 live tokens gives a slope of
0.52, not 1.0: value grows sublinearly, so a protocol with 100x the TVL is worth ~11x
the value, not 100x. The linear model overpriced the TVL giants by up to 15x and lost
to a flat multiple in leave-one-out (5.23x vs 5.07x). Radar-4 fits the power law
instead, then tilts it per category: each category's median log-residual, shrunk hard
toward zero (prior weight 25), so a category with one live token barely moves the
curve. Maturity (age) and chain count were tested as extra terms and removed — both
made leave-one-out worse (see the ablation table in the dashboard's Method page).
Leave-one-out on this snapshot: radar-4 3.25x median miss / 47.7% within 3x, vs flat
5.07x / 35.2%; walk-forward 2.91x / 54.2% vs flat 5.29x / 33.3%. No protocol name is
special-cased; the fit and the tilts the run used are shown in the dashboard's
methodology panel and Method page.

Radar-3 also tightens what counts as a launch. The watchlist's own rule leaves out
wrapped, staked and bridged products of a token that already trades, and radar-2 only
applied half of that rule — its board ranked 48 bridges, liquid-staking and staking
products (Ink Bridge, Polygon zkEVM Bridge, Definity Staked SOL) that are not protocols
waiting on a launch of their own. Radar-3 applies the whole rule to the early rows too:
no Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX
category, no versioned name, no whole word wrapped, staked or staking, and no name
beginning with an exchange's name.

Every row also carries a confidence score (how complete its record is, and how many
live comparables back its tilt), a value thesis and a profile written from its own
figures, its rank inside its category, a P10–P90 uncertainty band and a rank range
across 200 bootstrap refits, and the signals the thesis rests on. The farm
plan is derived the same way — the action, the weekly rhythm, the check and the hold
all change with the category, the chain and the seven-day trend — never from a
hand-written list of names.

The board covers all 40 watchlist protocols (TVL ≥ $50M, no token on record) and adds
138 pre-token protocols below the floor — 178 rows, $1.83B of total implied value.
Live-token protocols are set aside with their market caps shown, never mixed into the
ranking. "No token" means the snapshot records none, not that the protocol has none.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `board.json`, `data.js`, and copies
`dashboard/` and `screenshots/` into the output directory, then writes `dossier.json`
with the vendored `vendor/makefun-board.ts`.

## Dashboard

`dashboard/` is a static page with no network: `index.html`, `app.css`, `app.js`, fed
by `data.js`. It has a sortable board (rank, TVL, 7d, age, implied value with a P10–P90
band bar, slice, net, break-even, net/hour, farm verdict), search, category and chain
filters, a pre-token / live-token switch, a "Watchlist only" scope toggle and a "Farm
plan complete only" toggle (every row is labelled watchlist or early so the floor is
visible), a farm-book summary that follows the current filter, a category chart of
total implied value, a fastest-growers list, a methodology panel with the power-law
formula, the curve fit and the validation, a full Method page (ablation, every tilt,
limits), and a detail page per protocol with its one-line value equation, record,
deposit-size table, nearest traded tokens with their miss, uncertainty band and rank
range, and a seven-step farm plan (action, cost, time).

## License

MIT — see `LICENSE`.
